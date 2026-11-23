------------------------------- MODULE Gate8Claim -------------------------------
(***************************************************************************)
(* Rule: one Gate 8 Queue item has at most one owner. At most one claimer  *)
(* receives action:"claimed", and the record keeps that claimer's owner.   *)
(*                                                                         *)
(* The Queue record is last-writer-wins (Airtable PATCH has no condition). *)
(* Each action is one atomic step of scripts/gate8/claim.mjs claimItem,    *)
(* run by an independent process (gate8_claim -> node gate8-queue.mjs):    *)
(*                                                                         *)
(*  Acquire(c)    fileClaimLock.acquire: open(lock,'wx'); EEXIST -> skip   *)
(*  Read(c)       await get(); Ready/unclaimed check (CheckStatus)         *)
(*  PatchOwner(c) await patch({Claimed By}) -- ok, or a fault:             *)
(*                applied+response lost, or failed not applied -> throw    *)
(*  Readback(c)   await get(); owner mismatch -> throw (Readback flag)     *)
(*  PatchDoing(c) await patch({Status:Doing}) -- ok or a fault (throw)     *)
(*  Finish(c)     save(owner) then return claimed; finally release         *)
(*  Crash(c)      process dies at any point: lock file is NOT removed      *)
(*                                                                         *)
(* Flags model the guards so a mutation is a one-line cfg change:          *)
(*   UseLock      the O_EXCL claim lock                                    *)
(*   CheckStatus  `Status !== 'Ready' || Claimed By` -> skip               *)
(*   HoldToEnd    lock held until return (FALSE = released after Read)     *)
(*   Readback     re-read owner after PATCH                                *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Claimers, UseLock, CheckStatus, HoldToEnd, Readback, Faults

None == "none"

VARIABLES
    pc,        \* pc[c]: "idle","read","patchOwner","readback","patchDoing","finish","claimed","skipped","failed","crashed"
    status,    \* record Status: "Ready" | "Doing"
    owner,     \* record Claimed By: a claimer or None
    lock,      \* holder of the lock file, or None
    held,      \* held[c]: TRUE iff c created the lock file and has not removed it
    claimed    \* set of claimers that returned action:"claimed" (local success receipts)

vars == <<pc, status, owner, lock, held, claimed>>

Pcs == {"idle", "read", "patchOwner", "readback", "patchDoing", "finish", "claimed", "skipped", "failed", "crashed"}

TypeOK ==
    /\ pc \in [Claimers -> Pcs]
    /\ status \in {"Ready", "Doing"}
    /\ owner \in Claimers \cup {None}
    /\ lock \in Claimers \cup {None}
    /\ held \in [Claimers -> BOOLEAN]
    /\ claimed \subseteq Claimers

Init ==
    /\ pc = [c \in Claimers |-> "idle"]
    /\ status = "Ready"
    /\ owner = None
    /\ lock = None
    /\ held = [c \in Claimers |-> FALSE]
    /\ claimed = {}

\* finally { lock.release() }: rmSync removes the file whoever created it.
\* Only the creator reaches the try block, so in the correct code it removes its
\* own file. (The early-release mutant is modeled as dropping ownership at Read.)
Release(c) ==
    IF held[c]
    THEN /\ lock' = None
         /\ held' = [held EXCEPT ![c] = FALSE]
    ELSE UNCHANGED <<lock, held>>

End(c, to) == /\ pc' = [pc EXCEPT ![c] = to] /\ Release(c)

Acquire(c) ==
    /\ pc[c] = "idle"
    /\ IF ~UseLock
       THEN /\ pc' = [pc EXCEPT ![c] = "read"] /\ UNCHANGED <<lock, held>>
       ELSE IF lock = None
            THEN /\ lock' = c /\ held' = [held EXCEPT ![c] = TRUE]
                 /\ pc' = [pc EXCEPT ![c] = "read"]
            ELSE /\ pc' = [pc EXCEPT ![c] = "skipped"] /\ UNCHANGED <<lock, held>>
    /\ UNCHANGED <<status, owner, claimed>>

Read(c) ==
    /\ pc[c] = "read"
    /\ IF CheckStatus /\ (status # "Ready" \/ owner # None)
       THEN End(c, "skipped")
       ELSE /\ pc' = [pc EXCEPT ![c] = "patchOwner"]
            /\ IF HoldToEnd THEN UNCHANGED <<lock, held>>
               ELSE /\ lock' = IF held[c] THEN None ELSE lock
                    /\ held' = [held EXCEPT ![c] = FALSE]
    /\ UNCHANGED <<status, owner, claimed>>

PatchOwnerOk(c) ==
    /\ pc[c] = "patchOwner"
    /\ owner' = c /\ pc' = [pc EXCEPT ![c] = IF Readback THEN "readback" ELSE "patchDoing"]
    /\ UNCHANGED <<status, lock, held, claimed>>

PatchOwnerLost(c) ==     \* applied, response lost: claimItem throws
    /\ Faults /\ pc[c] = "patchOwner"
    /\ owner' = c /\ End(c, "failed")
    /\ UNCHANGED <<status, claimed>>

PatchOwnerFailed(c) ==   \* not applied: claimItem throws
    /\ Faults /\ pc[c] = "patchOwner"
    /\ End(c, "failed")
    /\ UNCHANGED <<status, owner, claimed>>

ReadbackStep(c) ==
    /\ pc[c] = "readback"
    /\ IF owner # c THEN End(c, "failed")
       ELSE /\ pc' = [pc EXCEPT ![c] = "patchDoing"] /\ UNCHANGED <<lock, held>>
    /\ UNCHANGED <<status, owner, claimed>>

PatchDoingOk(c) ==
    /\ pc[c] = "patchDoing"
    /\ status' = "Doing" /\ pc' = [pc EXCEPT ![c] = "finish"]
    /\ UNCHANGED <<owner, lock, held, claimed>>

PatchDoingLost(c) ==
    /\ Faults /\ pc[c] = "patchDoing"
    /\ status' = "Doing" /\ End(c, "failed")
    /\ UNCHANGED <<owner, claimed>>

PatchDoingFailed(c) ==
    /\ Faults /\ pc[c] = "patchDoing"
    /\ End(c, "failed")
    /\ UNCHANGED <<status, owner, claimed>>

Finish(c) ==
    /\ pc[c] = "finish"
    /\ claimed' = claimed \cup {c}
    /\ End(c, "claimed")
    /\ UNCHANGED <<status, owner>>

\* A killed process: its lock file stays (fail closed for later claimers).
Crash(c) ==
    /\ Faults /\ pc[c] \in {"read", "patchOwner", "readback", "patchDoing", "finish"}
    /\ pc' = [pc EXCEPT ![c] = "crashed"]
    /\ UNCHANGED <<status, owner, lock, held, claimed>>

Next == \E c \in Claimers :
    \/ Acquire(c) \/ Read(c) \/ PatchOwnerOk(c) \/ PatchOwnerLost(c) \/ PatchOwnerFailed(c)
    \/ ReadbackStep(c) \/ PatchDoingOk(c) \/ PatchDoingLost(c) \/ PatchDoingFailed(c)
    \/ Finish(c) \/ Crash(c)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

\* ---- the rule ----
OneOwner ==
    /\ Cardinality(claimed) <= 1
    /\ \A c \in claimed : owner = c

\* ---- non-vacuity witnesses: each must be VIOLATED ----
NeverClaimed    == claimed = {}
\* With the Ready/unclaimed check, a skip while the record is still Ready and
\* unowned can only be the lock refusal.
NeverSkipLock   == \A c \in Claimers : ~(pc[c] = "skipped" /\ status = "Ready" /\ owner = None)
NeverSkipStatus == \A c \in Claimers : ~(pc[c] = "skipped" /\ status = "Doing")
NeverFailed     == \A c \in Claimers : pc[c] # "failed"

\* Every claimer terminates (no lock deadlock).
AllDone == <>(\A c \in Claimers : pc[c] \in {"claimed", "skipped", "failed", "crashed"})
=============================================================================
