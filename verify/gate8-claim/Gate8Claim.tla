------------------------------- MODULE Gate8Claim -------------------------------
(***************************************************************************)
(* Rule: one Gate 8 Queue item has at most one owner. At most one claimer  *)
(* receives action:"claimed", and the record keeps that claimer's owner.   *)
(*                                                                         *)
(* The Queue record is last-writer-wins (Airtable PATCH has no condition). *)
(* Each action is one atomic step of scripts/gate8/claim.mjs claimItem,    *)
(* run by an independent process (gate8_claim -> node gate8-queue.mjs):    *)
(*                                                                         *)
(*  Acquire(c)    fileClaimLock.acquire: write temp metadata, link(tmp,    *)
(*                lock); EEXIST -> skip                                    *)
(*  Read(c)       await get(); Ready/unclaimed check (CheckStatus)         *)
(*  PatchOwner*   await patch({Claimed By}). Outcomes:                     *)
(*                 Ok        applied, answered                             *)
(*                 Rejected  HTTP 4xx, not applied (definite) -> release   *)
(*                 Lost      applied, response lost (ambiguous)            *)
(*                 Timeout   no answer; the request may be applied LATER   *)
(*                           (pendOwner[c]; DelayedOwner(c) applies it)    *)
(*                Ambiguous -> "operator": lock kept iff KeepOnAmbiguous   *)
(*  Readback(c)   await get(); owner mismatch -> throw, release            *)
(*  PatchDoing*   await patch({Status:Doing}), same four outcomes          *)
(*  Finish(c)     save(owner) then return claimed; finally release         *)
(*  Crash(c)      process dies at any point: lock file is NOT removed      *)
(*  Clear(c)      operator runs `gate8-queue.mjs clear-ambiguous <item>`   *)
(*                (clearAmbiguousLock) on c's lock after c ended in        *)
(*                "operator" or "crashed". With ClearWaits it is enabled   *)
(*                only once no PATCH of c is still in flight: this is the  *)
(*                TIMING ASSUMPTION that CLEAR_QUIESCENCE_MS (10 min after *)
(*                the last PATCH started) outlasts every in-flight PATCH.  *)
(*                TLC does not check that assumption; it checks that, if   *)
(*                it holds, clearing never yields two owners.              *)
(*                                                                         *)
(* Flags model the guards so a mutation is a one-line cfg change:          *)
(*   UseLock          the claim lock                                       *)
(*   CheckStatus      `Status !== 'Ready' || Claimed By` -> skip           *)
(*   HoldToEnd        lock held until return (FALSE = released at Read)    *)
(*   Readback         re-read owner after PATCH                            *)
(*   KeepOnAmbiguous  keep the lock after an ambiguous PATCH (review fix 1)*)
(*   KeepOnDefinite   keep the lock after a definite 4xx (wrong; leaks)    *)
(*   AllowClear       the operator clear action exists                     *)
(*   ClearWaits       clear waits out the quiescence window (FALSE = the   *)
(*                    old advice: delete the lock once no claimer runs)    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Claimers, UseLock, CheckStatus, HoldToEnd, Readback, Faults,
          KeepOnAmbiguous, KeepOnDefinite, AllowClear, ClearWaits

None == "none"

VARIABLES
    pc,         \* per claimer, see Pcs
    status,     \* record Status: "Ready" | "Doing"
    owner,      \* record Claimed By: a claimer or None
    lock,       \* holder of the lock file, or None
    held,       \* held[c]: TRUE iff c created the lock file and has not removed it
    claimed,    \* claimers that returned action:"claimed" (local success receipts)
    pendOwner,  \* claimers whose owner PATCH timed out and may still be applied
    pendDoing,  \* claimers whose Doing PATCH timed out and may still be applied
    ambiguous,  \* claimers that saw an ambiguous PATCH result
    landed,     \* number of delayed PATCHes applied (witness)
    clears      \* number of operator clears (witness)

vars == <<pc, status, owner, lock, held, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

Pcs == {"idle", "read", "patchOwner", "readback", "patchDoing", "finish",
        "claimed", "skipped", "failed", "operator", "crashed"}
Active == {"read", "patchOwner", "readback", "patchDoing", "finish"}

TypeOK ==
    /\ pc \in [Claimers -> Pcs]
    /\ status \in {"Ready", "Doing"}
    /\ owner \in Claimers \cup {None}
    /\ lock \in Claimers \cup {None}
    /\ held \in [Claimers -> BOOLEAN]
    /\ claimed \subseteq Claimers
    /\ pendOwner \subseteq Claimers /\ pendDoing \subseteq Claimers
    /\ ambiguous \subseteq Claimers
    /\ landed \in Nat
    /\ clears \in Nat

Init ==
    /\ pc = [c \in Claimers |-> "idle"]
    /\ status = "Ready"
    /\ owner = None
    /\ lock = None
    /\ held = [c \in Claimers |-> FALSE]
    /\ claimed = {}
    /\ pendOwner = {} /\ pendDoing = {} /\ ambiguous = {}
    /\ landed = 0
    /\ clears = 0

\* finally { if (!keep) lock.release() }. Only the creator reaches the try
\* block, so a release removes its own file.
Release(c) ==
    IF held[c]
    THEN /\ lock' = None
         /\ held' = [held EXCEPT ![c] = FALSE]
    ELSE UNCHANGED <<lock, held>>

End(c, to)  == /\ pc' = [pc EXCEPT ![c] = to] /\ Release(c)
Keep(c, to) == /\ pc' = [pc EXCEPT ![c] = to] /\ UNCHANGED <<lock, held>>
EndAmbiguous(c) == IF KeepOnAmbiguous THEN Keep(c, "operator") ELSE End(c, "operator")
EndDefinite(c)  == IF KeepOnDefinite THEN Keep(c, "failed") ELSE End(c, "failed")

Acquire(c) ==
    /\ pc[c] = "idle"
    /\ IF ~UseLock
       THEN /\ pc' = [pc EXCEPT ![c] = "read"] /\ UNCHANGED <<lock, held>>
       ELSE IF lock = None
            THEN /\ lock' = c /\ held' = [held EXCEPT ![c] = TRUE]
                 /\ pc' = [pc EXCEPT ![c] = "read"]
            ELSE /\ pc' = [pc EXCEPT ![c] = "skipped"] /\ UNCHANGED <<lock, held>>
    /\ UNCHANGED <<status, owner, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

Read(c) ==
    /\ pc[c] = "read"
    /\ IF CheckStatus /\ (status # "Ready" \/ owner # None)
       THEN End(c, "skipped")
       ELSE /\ pc' = [pc EXCEPT ![c] = "patchOwner"]
            /\ IF HoldToEnd THEN UNCHANGED <<lock, held>>
               ELSE /\ lock' = IF held[c] THEN None ELSE lock
                    /\ held' = [held EXCEPT ![c] = FALSE]
    /\ UNCHANGED <<status, owner, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

PatchOwnerOk(c) ==
    /\ pc[c] = "patchOwner"
    /\ owner' = c /\ pc' = [pc EXCEPT ![c] = IF Readback THEN "readback" ELSE "patchDoing"]
    /\ UNCHANGED <<status, lock, held, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

PatchOwnerRejected(c) ==   \* HTTP 4xx: definitely not applied
    /\ Faults /\ pc[c] = "patchOwner"
    /\ EndDefinite(c)
    /\ UNCHANGED <<status, owner, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

PatchOwnerLost(c) ==       \* applied, response lost: ambiguous
    /\ Faults /\ pc[c] = "patchOwner"
    /\ owner' = c /\ ambiguous' = ambiguous \cup {c} /\ EndAmbiguous(c)
    /\ UNCHANGED <<status, claimed, pendOwner, pendDoing, landed, clears>>

PatchOwnerTimeout(c) ==    \* no answer; may be applied later: ambiguous
    /\ Faults /\ pc[c] = "patchOwner"
    /\ pendOwner' = pendOwner \cup {c} /\ ambiguous' = ambiguous \cup {c} /\ EndAmbiguous(c)
    /\ UNCHANGED <<status, owner, claimed, pendDoing, landed, clears>>

DelayedOwner(c) ==         \* the store applies a timed-out owner PATCH
    /\ c \in pendOwner
    /\ owner' = c /\ pendOwner' = pendOwner \ {c} /\ landed' = landed + 1
    /\ UNCHANGED <<pc, status, lock, held, claimed, pendDoing, ambiguous, clears>>

DropOwner(c) ==            \* ...or never applies it
    /\ c \in pendOwner
    /\ pendOwner' = pendOwner \ {c}
    /\ UNCHANGED <<pc, status, owner, lock, held, claimed, pendDoing, ambiguous, landed, clears>>

ReadbackStep(c) ==
    /\ pc[c] = "readback"
    /\ IF owner # c THEN End(c, "failed")
       ELSE /\ pc' = [pc EXCEPT ![c] = "patchDoing"] /\ UNCHANGED <<lock, held>>
    /\ UNCHANGED <<status, owner, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

PatchDoingOk(c) ==
    /\ pc[c] = "patchDoing"
    /\ status' = "Doing" /\ pc' = [pc EXCEPT ![c] = "finish"]
    /\ UNCHANGED <<owner, lock, held, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

PatchDoingRejected(c) ==
    /\ Faults /\ pc[c] = "patchDoing"
    /\ EndDefinite(c)
    /\ UNCHANGED <<status, owner, claimed, pendOwner, pendDoing, ambiguous, landed, clears>>

PatchDoingLost(c) ==
    /\ Faults /\ pc[c] = "patchDoing"
    /\ status' = "Doing" /\ ambiguous' = ambiguous \cup {c} /\ EndAmbiguous(c)
    /\ UNCHANGED <<owner, claimed, pendOwner, pendDoing, landed, clears>>

PatchDoingTimeout(c) ==
    /\ Faults /\ pc[c] = "patchDoing"
    /\ pendDoing' = pendDoing \cup {c} /\ ambiguous' = ambiguous \cup {c} /\ EndAmbiguous(c)
    /\ UNCHANGED <<status, owner, claimed, pendOwner, landed, clears>>

DelayedDoing(c) ==
    /\ c \in pendDoing
    /\ status' = "Doing" /\ pendDoing' = pendDoing \ {c} /\ landed' = landed + 1
    /\ UNCHANGED <<pc, owner, lock, held, claimed, pendOwner, ambiguous, clears>>

DropDoing(c) ==
    /\ c \in pendDoing
    /\ pendDoing' = pendDoing \ {c}
    /\ UNCHANGED <<pc, status, owner, lock, held, claimed, pendOwner, ambiguous, landed, clears>>

Finish(c) ==
    /\ pc[c] = "finish"
    /\ claimed' = claimed \cup {c}
    /\ End(c, "claimed")
    /\ UNCHANGED <<status, owner, pendOwner, pendDoing, ambiguous, landed, clears>>

\* A killed process: its lock file stays (fail closed for later claimers).
\* A process killed while a PATCH is on the wire leaves that PATCH in flight.
Crash(c) ==
    /\ Faults /\ pc[c] \in Active
    /\ pc' = [pc EXCEPT ![c] = "crashed"]
    /\ \/ UNCHANGED <<pendOwner, pendDoing>>
       \/ pc[c] = "patchOwner" /\ pendOwner' = pendOwner \cup {c} /\ UNCHANGED pendDoing
       \/ pc[c] = "patchDoing" /\ pendDoing' = pendDoing \cup {c} /\ UNCHANGED pendOwner
    /\ UNCHANGED <<status, owner, lock, held, claimed, ambiguous, landed, clears>>

\* clearAmbiguousLock: the operator removes the lock of a claimer that ended
\* after an ambiguous PATCH or crashed (never a running claimer). With
\* ClearWaits, only when none of c's PATCHes is still in flight; this stands
\* for "CLEAR_QUIESCENCE_MS has passed since the last PATCH started", which
\* is an assumption about Airtable, not something TLC can check.
Clear(c) ==
    /\ AllowClear /\ held[c] /\ pc[c] \in {"operator", "crashed"}
    /\ ClearWaits => c \notin pendOwner \cup pendDoing
    /\ lock' = None /\ held' = [held EXCEPT ![c] = FALSE] /\ clears' = clears + 1
    /\ UNCHANGED <<pc, status, owner, claimed, pendOwner, pendDoing, ambiguous, landed>>

Next == \E c \in Claimers :
    \/ Acquire(c) \/ Read(c)
    \/ PatchOwnerOk(c) \/ PatchOwnerRejected(c) \/ PatchOwnerLost(c) \/ PatchOwnerTimeout(c)
    \/ DelayedOwner(c) \/ DropOwner(c) \/ ReadbackStep(c)
    \/ PatchDoingOk(c) \/ PatchDoingRejected(c) \/ PatchDoingLost(c) \/ PatchDoingTimeout(c)
    \/ DelayedDoing(c) \/ DropDoing(c)
    \/ Finish(c) \/ Crash(c) \/ Clear(c)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

\* ---- the rule ----
OneOwner ==
    /\ Cardinality(claimed) <= 1
    /\ \A c \in claimed : owner = c

\* ---- lock hygiene: a lock outlives its claimer only after an ambiguous
\* PATCH or a crash (never after a clean or definite outcome) ----
LockHygiene ==
    \A c \in Claimers : held[c] => (pc[c] \in Active \cup {"crashed"} \/ (pc[c] = "operator" /\ c \in ambiguous))

\* ---- non-vacuity witnesses: each must be VIOLATED ----
NeverClaimed    == claimed = {}
\* With the Ready/unclaimed check, a skip while the record is still Ready and
\* unowned can only be the lock refusal.
NeverSkipLock   == \A c \in Claimers : ~(pc[c] = "skipped" /\ status = "Ready" /\ owner = None)
NeverSkipStatus == \A c \in Claimers : ~(pc[c] = "skipped" /\ status = "Doing")
NeverFailed     == \A c \in Claimers : pc[c] # "failed"
NeverOperator   == \A c \in Claimers : pc[c] # "operator"
NeverLanded     == landed = 0
NeverCleared    == clears = 0
\* A clear followed by another claimer's successful claim.
NeverClaimAfterClear == ~(clears > 0 /\ claimed # {})

\* Every claimer terminates (no lock deadlock).
AllDone == <>(\A c \in Claimers : pc[c] \in {"claimed", "skipped", "failed", "operator", "crashed"})
=============================================================================
