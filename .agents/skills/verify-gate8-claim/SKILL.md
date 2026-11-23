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
- M1–M3 and M5–M10 are KILLED with a numbered trace, and M4 is labelled "SURVIVED as expected";
- every TLC config meets its expectation. `Gate8Claim*` pass (`OneOwner` and `LockHygiene`). Each `Mutant-*` and `Witness-*` reports the single invariant named in its cfg as violated.

Without the jar the last line says `tlc=SKIPPED`, never PASS; `REQUIRE_TLC=1` makes that a failure. `--quick` skips mutations. A full run takes about 3 minutes. TLC runs with a temp `-metadir` and `-noGenerateSpecTE`, so it writes nothing into `verify/`.

## What is checked, by which tool

| Check | Tool | Status at last check |
|---|---|---|
| `verify/gate8-claim/explore.mjs` | Real-code interleaving explorer, **NOT a TLC model check**. It runs a DFS over every order of the Queue GET/PATCH steps, with the real `claimItem` and the real file lock. Each PATCH may end as applied, applied with the response lost, rejected (HTTP 422), timed out and never applied, or timed out and **applied later**. A delayed commit is its own step and may be scheduled after any later step, including after a clear. It also checks for a LEAK: a lock file left after a run with no ambiguous PATCH. | GREEN, exhaustive. claim-x2 10 schedules; claim-x2-faults 70; claim-x2-delayed 94; claim-x2-savefail 10; claim-x3 96; claim-x2-clear 2624. Every witness is reached where it applies: claimed, skipLock, skipStatus, lostResponse, failedPatch, threw, delayedLanded, needsOperator, keptLock, and in claim-x2-clear cleared (360 schedules), clearRefused, skipAfterClear (a clear accepted A's applied PATCH and the next claimer then skips the owned record) and landedAfterRefusal (a delayed PATCH lands after a refused clear). claim-x2-clear runs the real `clearAmbiguousLock` (without `--force-accept-risk`) as an operator step at any point; its record read is a separate step. There is **no clock and no timing assumption** in this scenario: a delayed PATCH may land at any later step. An always-enabled step jumps the local wall clock forward a day, to show it has no effect. Claimer 2 has no PATCH faults there, to bound the space. |
| `tests/gate8/claim.test.mjs` | `node --test`. Two real OS processes against a local fake Queue HTTP server, plus unit cases and loopback HTTP through the real `scripts/gate8/airtable-api.mjs`. | 19/19 pass. Clock-free clear: the lock records the exact PATCH fields and the expected record values (`Claimed By` = owner and `Claimed At` = this claim's id; plus `Status: Doing` for the Doing step) before each PATCH; **fsync** of the lock file and then its directory precedes each PATCH (fs stubbed, calls counted, order checked); a PATCH that has not applied is refused (`patch-outcome-unknown`, lock kept, message names rerun and `--force-accept-risk`), B skips and A's late PATCH overwrites nobody; a landed PATCH is accepted as A's claim (`outcome:'patch-applied'`, lock removed, B then skips the owned record); the match is exact (another owner, another claim id, or a Doing step whose Status PATCH has not applied are refused; Airtable's normalized datetime form of the same instant is accepted); `--force-accept-risk` removes the lock and logs one `WARNING: --force-accept-risk` line (and the test shows the documented risk: B claims, A's late PATCH overwrites B); legacy locks without recorded PATCH values (four formats, incl. the `c03cf0a` and `befa310` ones) are refused and only the override removes them; a current-format `claiming` lock of a dead claimer is cleared (`no-patch-sent`); a live claimer is never cleared; clears are serialized. **Reviewer attacks on loopback HTTP** (stale Date header 10 min old, invalid Date `0`, Date going backwards between the clear reads, local clock +10 min): each refuses while A's PATCH is in flight and accepts A once it lands. The stale, invalid and backward Date tests yield two owners on `befa310`; the local-clock test yields two owners on `0ad0135`. Earlier cases: without the lock, the forced rank-5 order gives 2 × claimed; with it, 5 rounds give exactly one owner. Timeouts, network errors and 5xx keep the lock; only 4xx releases it. ENOSPC during a lock write leaves no lock and no temp file. |
| `verify/gate8-claim/mutate.sh` | Removes real guards in a temp copy of `claim.mjs` | KILLED: M1 no lock, M2 no Ready check and M3 early release. Also KILLED: M5 release on an ambiguous PATCH (= `8b51cb5`) and M6 timeout treated as definite, with delayed-commit traces, and M7 lock kept after a 4xx (LEAK). M8 clear regardless of the record (= `--force-accept-risk` on every clear, and the old "remove the lock" advice): KILLED, A times out, the operator clears, B claims, A's PATCH lands. M9 clear exactly when the record does NOT show the recorded values: KILLED. M10 treat every recorded PATCH as "none sent": KILLED. M4 no readback is equivalent here and SURVIVES. M1 and M3 also disable `mark()`, because its lost-lock check (`ELOCKLOST`) would otherwise stop them. |
| `Gate8Claim.tla` + 18 cfgs | TLA+, TLC model check, including `PatchOwnerTimeout`/`PatchDoingTimeout` followed by `DelayedOwner`/`DelayedDoing`, a crash before or after the lock record or with a PATCH in flight, and the operator `Clear`. `rec[c]` is the PATCH recorded in c's lock before sending; `Clear` with `ClearMode = "match"` is enabled only when the record shows it (or none was recorded). No clock variable and no timing assumption. | Results in the table below. The only warning is TLC's standard fingerprint-collision notice. |

| TLC config | Expected | Generated/distinct states |
|---|---|---|
| Gate8Claim (2 claimers: PATCH reject/lost/timeout + delayed commit, crashes incl. PATCH in flight, operator Clear on a record match) | pass | 427/309 |
| Gate8Claim-x3 (3 claimers) | pass | 154/85 |
| Mutant-NoLock (= original helper) | OneOwner violated | 113/81, BFS trace |
| Mutant-NoStatusCheck | OneOwner violated | 39/31 |
| Mutant-EarlyRelease | OneOwner violated | 115/84 |
| Mutant-ReleaseOnAmbiguous (= `8b51cb5`) | OneOwner violated | 723/465, BFS trace: c2 owner-PATCH times out, c1 claims, c2's PATCH lands |
| Mutant-ClearMismatch (clear when the record does NOT show the recorded values) | OneOwner violated | 1269/730, BFS trace: c2 times out, Clear(c2), c1 claims, c2's PATCH lands |
| Mutant-ForceAcceptRisk (clear regardless of the record = the override, and the old "remove the lock" advice) | OneOwner violated | 1667/1001, BFS trace: the documented risk |
| Mutant-KeepOnDefinite | LockHygiene violated | 50/43 |
| Witness-Claimed | NeverClaimed violated | 81/67 |
| Witness-SkipLock | NeverSkipLock violated | 19/16 |
| Witness-SkipStatus | NeverSkipStatus violated | 35/27 |
| Witness-Failed | NeverFailed violated | 101/84 |
| Witness-Operator | NeverOperator violated | 74/64 |
| Witness-DelayedLands | NeverLanded violated | 155/124 |
| Witness-Cleared | NeverCleared violated | 97/82 |
| Witness-AppliedClear (a clear accepts a recorded, applied PATCH as the claim) | NeverAppliedClear violated | 97/82 |
| Witness-ClaimAfterClear | NeverClaimAfterClear violated | 411/300 |

The violated configs stop at the first error, so their state counts vary slightly between runs. The configs also check `AllDone`: every claimer terminates and no lock wait hangs.

`verify/gate8-claim/repro-helper.mjs` is a manual reproduction and is not part of `run.sh`. It copies the gitignored local helper `gate8-queue.mjs`, rewrites only its credential path, proof root, base URL and Jev writer import, and checks that the claim branch is otherwise byte-identical. It runs two `claim` processes against a scripted fake Airtable. Without the fix both return `claimed`. With `--adopt`, which swaps in `claimItem` and adds the `clear-ambiguous <item> [--force-accept-risk]` branch, one claims and one skips (its message names `clear-ambiguous <recordId>`), and `clear-ambiguous` answers `no-lock`.

## Model actions mapped to real atomic steps (`scripts/gate8/claim.mjs`)

| Model action | Real code |
|---|---|
| `Acquire` | `fileClaimLock.acquire`: write metadata (format `gate8-claim-lock/2`, owner, pid, item) to a private temp file (`wx`) and fsync it, then `linkSync(tmp, lock)`, remove the temp file and fsync the directory. EEXIST → `skip claim-lock-held` with `lockPath` and a message naming `gate8-queue.mjs clear-ambiguous <item>`, never deleting the file. A failed metadata write never creates the lock. |
| `Read` | `claimItem`: `await get()`, then `Status !== 'Ready' \|\| Claimed By` → skip |
| `PatchOwner*` | `guardedPatch({'Claimed By': owner, 'Claimed At': claim id}, 'owner', expect)`: first `lock.mark({state:'patching', step, patch: fields, expect})` (temp file fsynced, renamed over the lock, directory fsynced; throws `ELOCKLOST` and sends nothing if the lock is gone; model `rec[c]`), then the PATCH. The claim id is `Claimed At`, whole seconds from the local clock: it only has to be unique to this claim, never ordered. Ok continues. An HTTP 4xx (`definitePatchFailure`) throws and releases the lock. Any other error is **ambiguous**: the code keeps the lock, marks it `state:'ambiguous'` and returns `needs-operator`. A timed-out PATCH may be applied later (`DelayedOwner`). |
| `ReadbackStep` | `await get()`. An owner mismatch throws |
| `PatchDoing*` | `guardedPatch({Status:'Doing'}, 'doing', {Status:'Doing', Claimed By, Claimed At})`, same outcomes; `DelayedDoing` |
| `Finish` | `save(owner)`, return `claimed`, then `finally` `lock.release()` |
| `Crash` | process killed mid-claim: before the lock record (nothing recorded or sent), after it (recorded, not sent), or with a PATCH on the wire (recorded and pending). The lock file stays, so later claims skip (fail closed) |
| `Clear` | `clearAmbiguousLock` (`gate8-queue.mjs clear-ambiguous <item>`): under a second O_EXCL file `<lock>.clear`, refuse a wrong item or a live non-ambiguous holder. A current-format `claiming` lock recorded no PATCH, so none was sent: removed (`no-patch-sent`). Otherwise one GET: if the record shows the lock's `expect` values (`recordShows`; datetimes compared by instant), the PATCH has applied and nothing is pending, so the claim is the holder's and the lock is removed (`patch-applied`); otherwise refused (`patch-outcome-unknown`, or `legacy-lock` when no values were recorded) and the lock kept. The lock must be unchanged before removal. No clock is read. The model's `ClearMode = "match"` / `Shows(c)` guard is this check. `--force-accept-risk` (`forceAcceptRisk`) removes the lock anyway after logging a warning: model `ClearMode = "any"`, which violates OneOwner |
| `Release` (in `End`) | `finally { if (!keep) lock.release() }`. Release happens on a return, a read failure, a readback mismatch or a 4xx, and never after an ambiguous PATCH |

Original code (helper `gate8-queue.mjs` lines 35–38, local and gitignored): the same GET/PATCH/GET/PATCH sequence with no lock. This is `Mutant-NoLock` and M1.

## Bounds and assumptions

- 2 claimers (3 in `-x3` and `claim-x3`), one record. Faults are applied per PATCH; crashes are in TLC only.
- **Host-local only.** The lock serializes claimers on one host that share the lock path (`<proof root>/gate8-claim.lock`). Claimers on another host, or a human editing `Claimed By`, are **not** excluded and are not modeled. Airtable's Web API offers no conditional or versioned update, so no store-side compare-and-set is available. Cross-host exclusion would need an external lease service.
- A crash or an ambiguous PATCH leaves the lock for an operator to clear (no automatic expiry). This trades liveness for safety. The only supported clear is `gate8-queue.mjs clear-ambiguous <item>`. Deleting the lock by hand while an ambiguous PATCH could still land breaks the rule (`Mutant-ForceAcceptRisk`, M8, and the reviewer's loopback reproduction).
- **No timing assumption.** Without `--force-accept-risk`, `clear-ambiguous` is safe with no assumption about clocks, Date headers or how long Airtable may hold a request. It relies only on: (1) the lock record of a PATCH reaching disk before the PATCH is sent (fsync of file and directory, tested); (2) Airtable applying each PATCH at most once, so a record showing the recorded values means that PATCH is no longer pending; (3) the recorded values being unique to this claim (owner plus the claim id `Claimed At`; for the Doing step also `Status: Doing`); (4) the record being changed only by claimers that use this lock (the host-local limit above). Earlier designs used a 10-minute window on the local clock and then on Airtable's Date header; reviewers broke both (clock jump; stale, invalid or backward Date). Both are removed.
- **Liveness cost.** If A's PATCH never applies, the record never shows its values and the lock is never cleared without the override. The operator then chooses between waiting and rerunning, or `clear-ambiguous <item> --force-accept-risk`, which removes the lock and logs `WARNING: --force-accept-risk ...`: a late write of A's could then overwrite a later claimer. Gate 8 is synthetic, so this documented override is accepted. TLC (`Mutant-ForceAcceptRisk`) and the unit test show that this risk is real.
- Clearing a crashed claimer's lock: allowed when its pid is dead. A current-format lock still in `claiming` state recorded no PATCH and so sent none; it is removed. A lock without recorded PATCH values (older `claim.mjs` formats) is refused (`legacy-lock`) except with `--force-accept-risk`. That code was never deployed, so such locks cannot exist in practice.
- An ambiguous result is any PATCH error other than an HTTP 4xx answer: a timeout, a network error, a 5xx or an unknown error. A 4xx is treated as "not applied", which is Airtable's documented behaviour for rejected requests.
- `save()` failure after both PATCHes: the claimer throws and the record still names it. That is one owner with no local receipt, so this does not break the rule. Recovery needs operator review.
- The Queue is modeled as atomic last-writer-wins per request.
- The installed `~/.dsh/scripts/gate8-queue.mjs` and the claim tool are **not** changed by this lane. The fix is in the portable module only until it is adopted and deployed.

## Tool versions

Node v26.13.1. TLC2 2026.11.19.180144 (rev bc1b506), Eclipse Adoptium 21.0.13.1 aarch64, from `/Users/agentwork/Work/Repos/.tools/`. The jar is unchecksummed.

## Last checked

Last-checked commit `30b8130` (previous `fc90b8f`: review blockers "stale/invalid/backward Date header", fixed by replacing the time window with the clock-free record match; before that `5447598`: "legacy lock cleared from its acquisition time" and "forward local clock jump opens the window"; before that `c03cf0a`: review blocker "remove the lock" advice was unsafe, replaced by `clear-ambiguous`; before that `f4c5feb`, NOT-READY: ambiguous-PATCH release and leaked lock on write failure). Covered-file hashes:

- sha256 e9bde63991c38e95c0ba5ec279a2b9d6b6b45aa64c4b564e737af0778e57c049 `scripts/gate8/claim.mjs`

## When covered code changes

1. Remap the action table. Look for new `await`s between the lock and the save, new writers of `Claimed By`, any change to the lock path or release, and any change to `clearAmbiguousLock`, `recordShows`, the recorded `expect` values or the fsync before each PATCH.
2. Rerun `run.sh` with mutations and TLC.
3. Update the hashes and the commit.

Never widen the rule, shrink bounds or relabel a mutant to get green. A red result is a finding for the Lead.
