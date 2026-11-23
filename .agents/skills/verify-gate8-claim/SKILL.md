---
name: verify-gate8-claim
description: Re-check the Gate 8 rule "one Queue item has at most one owner" after any change to scripts/gate8/claim.mjs (claimItem, fileClaimLock, clearAmbiguousLock / clear-ambiguous), to how gate8_claim / gate8-queue.mjs claim call it, or to the Queue store semantics. Runs a real-code interleaving explorer, multi-process claim tests on a fake Queue, a mutation check, and TLC.
---

# Verify: Gate 8 one-owner claim

**Rule.** One Gate 8 Queue item has at most one owner: at most one claimer receives `action:"claimed"`, and once one has, the record's `Claimed By` is that claimer. (Stated in `DeepSeekHarness/specialists/research/invariant-targets-20261122/REPORT.md` rank 5, and implied by the helper's "Lost claim" checks in `checkpoint`, `publish-evidence` and `complete`.) Breaking it starts two workers on one item. They share one report path and state file. The first worker's ownership evidence is false from the moment it is issued.

## Rerun

```bash
bash verify/gate8-claim/run.sh
```

With TLC, as the gate runs it:

```bash
bash /Users/agentwork/Work/Repos/DeepSeekHarness/specialists/scripts/run-invariant-checks.sh <repo>
```

Exit 0 means all of the following:

- the explorer is GREEN with every witness reached;
- `tests/gate8/claim.test.mjs` passes;
- M1–M3 and M5–M8 are KILLED with a numbered trace, and M4 and M9 are labelled "SURVIVED as expected";
- every TLC config meets its expectation. `Gate8Claim*` pass (`OneOwner` and `LockHygiene`). Each `Mutant-*` and `Witness-*` reports the single invariant named in its cfg as violated.

Without the jar the last line says `tlc=SKIPPED`, never PASS; `REQUIRE_TLC=1` makes that a failure. `--quick` skips mutations. A full run takes about 20 s. TLC runs with a temp `-metadir` and `-noGenerateSpecTE`, so it writes nothing into `verify/`.

## What is checked, by which tool

| Check | Tool | Status at last check |
|---|---|---|
| `verify/gate8-claim/explore.mjs` | Real-code interleaving explorer, **NOT a TLC model check**. It runs a DFS over every order of the Queue GET/PATCH steps, with the real `claimItem` and the real file lock. Each PATCH may end as applied, applied with the response lost, rejected (HTTP 422), timed out and never applied, or timed out and **applied later**. A delayed commit is its own step and may be scheduled after any later step. It also checks for a LEAK: a lock file left after a run with no ambiguous PATCH. | GREEN, exhaustive. claim-x2 10 schedules; claim-x2-faults 70; claim-x2-delayed 94; claim-x2-savefail 10; claim-x3 96; claim-x2-clear 2298. Every witness is reached where it applies: claimed, skipLock, skipStatus, lostResponse, failedPatch, threw, delayedLanded, needsOperator, keptLock, and in claim-x2-clear cleared, clearRefused and claimAfterClear. claim-x2-clear runs the real `clearAmbiguousLock` as an operator step (its settle pause is a separate step, so delayed PATCHes can land between its two reads) plus one clock step of `CLEAR_QUIESCENCE_MS`, which is enabled only once no delayed PATCH is in flight (the timing assumption below). Claimer 2 has no PATCH faults there, to bound the space. |
| `tests/gate8/claim.test.mjs` | `node --test`. Two real OS processes against a local fake Queue HTTP server, plus unit cases. | 14/14 pass. Clear-ambiguous: a clear inside the window is refused at 0 s, 60 s and window−1 ms, and the lock stays; a delayed PATCH landing inside the window is blocked (B skips) and the later clear reports `patchLanded:true`, after which B skips on the owned record; a PATCH landing between the two settle reads gives `record-changing` and the lock stays; a clear after the window succeeds, reports `patchLanded:false`, and B then claims; a running claimer's lock is never cleared; concurrent clears are serialized; and a loopback test with real `fetch`/`AbortSignal.timeout` repeats the reviewer's sequence. The messages name `gate8-queue.mjs clear-ambiguous <item>` and never advise deleting the lock. Earlier cases: without the lock, the forced rank-5 order gives 2 × claimed; with it, 5 rounds give exactly one owner. Review regressions: a delayed timed-out PATCH keeps the lock, the next claimer skips and the skip names the lock path. Timeouts, network errors and 5xx keep the lock; only 4xx releases it. ENOSPC during the lock metadata write leaves no lock and no temp file. On `8b51cb5` the three regression tests FAIL (3/6). |
| `verify/gate8-claim/mutate.sh` | Removes real guards in a temp copy of `claim.mjs` | KILLED: M1 no lock, M2 no Ready check and M3 early release (9-step traces). Also KILLED: M5 release on an ambiguous PATCH (= `8b51cb5`) and M6 timeout treated as definite, with 11-step delayed-commit traces, and M7 lock kept after a 4xx (LEAK). M8 clear without the quiescence window (= the old "remove the lock" advice) is KILLED with the reviewer's 16-step trace: A times out, the operator clears, B claims, A's PATCH lands. M4 no readback and M9 clear with one read (no settle re-read) are equivalent here and SURVIVE: M9 is equivalent only under the timing assumption, and the double read is covered directly by the unit test. M1 and M3 also disable `mark()`, because its lost-lock check (`ELOCKLOST`) would otherwise stop them. |
| `Gate8Claim.tla` + 16 cfgs | TLA+, TLC model check, including `PatchOwnerTimeout`/`PatchDoingTimeout` followed by `DelayedOwner`/`DelayedDoing`, a crash with a PATCH in flight, and the operator `Clear` | Results in the table below. The only warning is TLC's standard fingerprint-collision notice. |

| TLC config | Expected | Generated/distinct states |
|---|---|---|
| Gate8Claim (2 claimers: PATCH reject/lost/timeout + delayed commit, crashes incl. PATCH in flight, operator Clear) | pass | 487/352 |
| Gate8Claim-x3 (3 claimers) | pass | 154/85 |
| Mutant-NoLock (= original helper) | OneOwner violated | 113/81, BFS trace |
| Mutant-NoStatusCheck | OneOwner violated | 39/31 |
| Mutant-EarlyRelease | OneOwner violated | 115/84 |
| Mutant-ReleaseOnAmbiguous (= `8b51cb5`) | OneOwner violated | 673/403, BFS trace: c2 owner-PATCH times out, c1 claims, c2's PATCH lands |
| Mutant-ClearNoWait (= the old "remove the lock" advice) | OneOwner violated | 1327/664, BFS trace: c2 times out, Clear(c2), c1 claims, c2's PATCH lands |
| Mutant-KeepOnDefinite | LockHygiene violated | 79/67 |
| Witness-Claimed | NeverClaimed violated | 94/75 |
| Witness-SkipLock | NeverSkipLock violated | 19/16 |
| Witness-SkipStatus | NeverSkipStatus violated | 35/27 |
| Witness-Failed | NeverFailed violated | 92/77 |
| Witness-Operator | NeverOperator violated | 95/82 |
| Witness-DelayedLands | NeverLanded violated | 104/84 |
| Witness-Cleared | NeverCleared violated | 75/62 |
| Witness-ClaimAfterClear | NeverClaimAfterClear violated | 387/281 |

The violated configs stop at the first error, so their state counts vary slightly between runs. The configs also check `AllDone`: every claimer terminates and no lock wait hangs.

`verify/gate8-claim/repro-helper.mjs` is a manual reproduction and is not part of `run.sh`. It copies the gitignored local helper `gate8-queue.mjs`, rewrites only its credential path, proof root, base URL and Jev writer import, and checks that the claim branch is otherwise byte-identical. It runs two `claim` processes against a scripted fake Airtable. Without the fix both return `claimed`. With `--adopt`, which swaps in `claimItem` and adds the `clear-ambiguous <item>` branch, one claims and one skips (its message names `clear-ambiguous <recordId>`), and `clear-ambiguous` answers `no-lock`.

## Model actions mapped to real atomic steps (`scripts/gate8/claim.mjs`)

| Model action | Real code |
|---|---|
| `Acquire` | `fileClaimLock.acquire`: write metadata (owner, pid, item) to a private temp file (`wx`), then `linkSync(tmp, lock)`, then remove the temp file. EEXIST → `skip claim-lock-held` with `lockPath` and a message naming `gate8-queue.mjs clear-ambiguous <item>`, never deleting the file. A failed metadata write never creates the lock (review blocker 2). |
| `Read` | `claimItem`: `await get()`, then `Status !== 'Ready' \|\| Claimed By` → skip |
| `PatchOwner*` | `guardedPatch({'Claimed By','Claimed At'})`: first `lock.mark({state:'patching', step, patchStartedAt})` (throws `ELOCKLOST` and sends nothing if the lock is gone), then the PATCH. Ok continues. An HTTP 4xx (`definitePatchFailure`) throws and releases the lock. Any other error is **ambiguous**: the code keeps the lock, marks it `state:'ambiguous'` and returns `needs-operator` (review blocker 1). A timed-out PATCH may be applied later (`DelayedOwner`). |
| `ReadbackStep` | `await get()`. An owner mismatch throws |
| `PatchDoing*` | `guardedPatch({Status:'Doing'})`, same outcomes; `DelayedDoing` |
| `Finish` | `save(owner)`, return `claimed`, then `finally` `lock.release()` |
| `Crash` | process killed mid-claim, possibly with a PATCH on the wire (then pending). The lock file stays, so later claims skip (fail closed) |
| `Clear` | `clearAmbiguousLock` (`gate8-queue.mjs clear-ambiguous <item>`): under a second O_EXCL file `<lock>.clear`, refuse a live non-ambiguous holder, a wrong item, or a time less than `CLEAR_QUIESCENCE_MS` after the latest lock timestamp (`patchStartedAt`, `ambiguousAt`, …). Then two GETs `CLEAR_SETTLE_MS` apart must be identical, the lock must be unchanged, and only then is it removed. Reports `patchLanded`. The model's `ClearWaits` guard (no PATCH of c pending) stands for the window |
| `Release` (in `End`) | `finally { if (!keep) lock.release() }`. Release happens on a return, a read failure, a readback mismatch or a 4xx, and never after an ambiguous PATCH |

Original code (helper `gate8-queue.mjs` lines 35–38, local and gitignored): the same GET/PATCH/GET/PATCH sequence with no lock. This is `Mutant-NoLock` and M1.

## Bounds and assumptions

- 2 claimers (3 in `-x3` and `claim-x3`), one record. Faults are applied per PATCH; crashes are in TLC only.
- **Host-local only.** The lock serializes claimers on one host that share the lock path (`<proof root>/gate8-claim.lock`). Claimers on another host, or a human editing `Claimed By`, are **not** excluded and are not modeled. Airtable's Web API offers no conditional or versioned update, so no store-side compare-and-set is available. Cross-host exclusion would need an external lease service.
- A crash or an ambiguous PATCH leaves the lock for an operator to clear (no automatic expiry). This trades liveness for safety. The only supported clear is `gate8-queue.mjs clear-ambiguous <item>`. Deleting the lock by hand while an ambiguous PATCH could still land breaks the rule (`Mutant-ClearNoWait`, M8, and the reviewer's loopback reproduction).
- **Timing assumption (not checked by TLC or the explorer).** `CLEAR_QUIESCENCE_MS` = 10 min. No PATCH is applied by Airtable more than 10 min after the claimer started it. Basis: the client aborts every Airtable request after `ownershipReadPolicy.deadlineMs` (20 s), and a dead process closes its socket, so no request bytes leave the host after about 20 s. Airtable documents no server-side request lifetime, so 10 min (30× the client deadline) is a conservative margin, not a documented guarantee. Both models encode the assumption as "Clear is enabled only when nothing is in flight". They show the clear is safe **if** it holds, not that it holds. The two identical reads `CLEAR_SETTLE_MS` (5 s) apart are a second, independent check: they catch a late PATCH that lands between them, but not one that lands after the clear. A record that never settles keeps the lock (fail closed).
- Clearing a crashed claimer's lock: allowed when its pid is dead, after the same window. A crash before any PATCH has no `patchStartedAt`, so the window runs from the acquire time.
- An ambiguous result is any PATCH error other than an HTTP 4xx answer: a timeout, a network error, a 5xx or an unknown error. A 4xx is treated as "not applied", which is Airtable's documented behaviour for rejected requests.
- `save()` failure after both PATCHes: the claimer throws and the record still names it. That is one owner with no local receipt, so this does not break the rule. Recovery needs operator review.
- The Queue is modeled as atomic last-writer-wins per request.
- The installed `~/.dsh/scripts/gate8-queue.mjs` and the claim tool are **not** changed by this lane. The fix is in the portable module only until it is adopted and deployed.

## Tool versions

Node v26.13.1. TLC2 2026.11.19.180144 (rev bc1b506), Eclipse Adoptium 21.0.13.1 aarch64, from `/Users/agentwork/Work/Repos/.tools/`. The jar is unchecksummed.

## Last checked

Last-checked commit `5447598` (previous `c03cf0a`: review blocker "remove the lock" advice was unsafe, replaced by `clear-ambiguous`; before that `f4c5feb`, NOT-READY: ambiguous-PATCH release and leaked lock on write failure). Covered-file hashes:

- sha256 9663142ad4359a69dffdd6f5da3472fb3776c392ec18a967092c25dd184c887d `scripts/gate8/claim.mjs`

## When covered code changes

1. Remap the action table. Look for new `await`s between the lock and the save, new writers of `Claimed By`, any change to the lock path or release, and any change to `clearAmbiguousLock`, `CLEAR_QUIESCENCE_MS` or the Airtable request deadline (the window must stay well above it).
2. Rerun `run.sh` with mutations and TLC.
3. Update the hashes and the commit.

Never widen the rule, shrink bounds or relabel a mutant to get green. A red result is a finding for the Lead.
