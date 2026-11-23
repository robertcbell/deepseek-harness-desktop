---
name: verify-gate8-claim
description: Re-check the Gate 8 rule "one Queue item has at most one owner" after any change to scripts/gate8/claim.mjs (claimItem, fileClaimLock), to how gate8_claim / gate8-queue.mjs claim call it, or to the Queue store semantics. Runs a real-code interleaving explorer, multi-process claim tests on a fake Queue, a mutation check, and TLC.
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
- M1–M3 and M5–M7 are KILLED with a numbered trace, and M4 is labelled "SURVIVED as expected";
- every TLC config meets its expectation. `Gate8Claim*` pass (`OneOwner` and `LockHygiene`). Each `Mutant-*` and `Witness-*` reports the single invariant named in its cfg as violated.

Without the jar the last line says `tlc=SKIPPED`, never PASS; `REQUIRE_TLC=1` makes that a failure. `--quick` skips mutations. A full run takes about 6 s. TLC runs with a temp `-metadir` and `-noGenerateSpecTE`, so it writes nothing into `verify/`.

## What is checked, by which tool

| Check | Tool | Status at last check |
|---|---|---|
| `verify/gate8-claim/explore.mjs` | Real-code interleaving explorer, **NOT a TLC model check**. It runs a DFS over every order of the Queue GET/PATCH steps, with the real `claimItem` and the real file lock. Each PATCH may end as applied, applied with the response lost, rejected (HTTP 422), timed out and never applied, or timed out and **applied later**. A delayed commit is its own step and may be scheduled after any later step. It also checks for a LEAK: a lock file left after a run with no ambiguous PATCH. | GREEN, exhaustive. claim-x2 10 schedules; claim-x2-faults 70; claim-x2-delayed 94; claim-x2-savefail 10; claim-x3 96. Every witness is reached where it applies: claimed, skipLock, skipStatus, lostResponse, failedPatch, threw, delayedLanded, needsOperator and keptLock. |
| `tests/gate8/claim.test.mjs` | `node --test`. Two real OS processes against a local fake Queue HTTP server, plus unit cases. | 6/6 pass. Without the lock, the forced rank-5 order gives 2 × claimed; with it, 5 rounds give exactly one owner. Review regressions: a delayed timed-out PATCH keeps the lock, the next claimer skips and the skip names the lock path. Timeouts, network errors and 5xx keep the lock; only 4xx releases it. ENOSPC during the lock metadata write leaves no lock and no temp file. On `8b51cb5` the three regression tests FAIL (3/6). |
| `verify/gate8-claim/mutate.sh` | Removes real guards in a temp copy of `claim.mjs` | KILLED: M1 no lock, M2 no Ready check and M3 early release (9-step traces). Also KILLED: M5 release on an ambiguous PATCH (= `8b51cb5`) and M6 timeout treated as definite, with 11-step delayed-commit traces, and M7 lock kept after a 4xx (LEAK). M4 no readback is equivalent here and SURVIVES. |
| `Gate8Claim.tla` + 13 cfgs | TLA+, TLC model check, including `PatchOwnerTimeout`/`PatchDoingTimeout` followed by `DelayedOwner`/`DelayedDoing` | Results in the table below. The only warning is TLC's standard fingerprint-collision notice. |

| TLC config | Expected | Generated/distinct states |
|---|---|---|
| Gate8Claim (2 claimers: PATCH reject/lost/timeout + delayed commit, crashes) | pass | 167/116 |
| Gate8Claim-x3 (3 claimers) | pass | 154/85 |
| Mutant-NoLock (= original helper) | OneOwner violated | 111/79, BFS trace |
| Mutant-NoStatusCheck | OneOwner violated | 39/31 |
| Mutant-EarlyRelease | OneOwner violated | 115/84 |
| Mutant-ReleaseOnAmbiguous (= `8b51cb5`) | OneOwner violated | 387/232, BFS trace: c1 owner-PATCH times out, c2 claims, c1's PATCH lands |
| Mutant-KeepOnDefinite | LockHygiene violated | 59/47 |
| Witness-Claimed | NeverClaimed violated | 79/58 |
| Witness-SkipLock | NeverSkipLock violated | 19/16 |
| Witness-SkipStatus | NeverSkipStatus violated | 35/27 |
| Witness-Failed | NeverFailed violated | 63/49 |
| Witness-Operator | NeverOperator violated | 103/86 |
| Witness-DelayedLands | NeverLanded violated | 87/64 |

The violated configs stop at the first error, so their state counts vary slightly between runs. The configs also check `AllDone`: every claimer terminates and no lock wait hangs.

`verify/gate8-claim/repro-helper.mjs` is a manual reproduction and is not part of `run.sh`. It copies the gitignored local helper `gate8-queue.mjs`, rewrites only its credential path, proof root, base URL and Jev writer import, and checks that the claim branch is otherwise byte-identical. It runs two `claim` processes against a scripted fake Airtable. Without the fix both return `claimed`. With `--adopt`, which swaps in `claimItem`, one claims and one skips.

## Model actions mapped to real atomic steps (`scripts/gate8/claim.mjs`)

| Model action | Real code |
|---|---|
| `Acquire` | `fileClaimLock.acquire`: write metadata to a private temp file (`wx`), then `linkSync(tmp, lock)`, then remove the temp file. EEXIST → `skip claim-lock-held` with `lockPath` and a message naming the file to remove. A failed metadata write never creates the lock (review blocker 2). |
| `Read` | `claimItem`: `await get()`, then `Status !== 'Ready' \|\| Claimed By` → skip |
| `PatchOwner*` | `guardedPatch({'Claimed By','Claimed At'})`. Ok continues. An HTTP 4xx (`definitePatchFailure`) throws and releases the lock. Any other error is **ambiguous**: the code keeps the lock, marks it `state:'ambiguous'` and returns `needs-operator` (review blocker 1). A timed-out PATCH may be applied later (`DelayedOwner`). |
| `ReadbackStep` | `await get()`. An owner mismatch throws |
| `PatchDoing*` | `guardedPatch({Status:'Doing'})`, same outcomes; `DelayedDoing` |
| `Finish` | `save(owner)`, return `claimed`, then `finally` `lock.release()` |
| `Crash` | process killed mid-claim. The lock file stays, so later claims skip (fail closed) |
| `Release` (in `End`) | `finally { if (!keep) lock.release() }`. Release happens on a return, a read failure, a readback mismatch or a 4xx, and never after an ambiguous PATCH |

Original code (helper `gate8-queue.mjs` lines 35–38, local and gitignored): the same GET/PATCH/GET/PATCH sequence with no lock. This is `Mutant-NoLock` and M1.

## Bounds and assumptions

- 2 claimers (3 in `-x3` and `claim-x3`), one record. Faults are applied per PATCH; crashes are in TLC only.
- **Host-local only.** The lock serializes claimers on one host that share the lock path (`<proof root>/gate8-claim.lock`). Claimers on another host, or a human editing `Claimed By`, are **not** excluded and are not modeled. Airtable's Web API offers no conditional or versioned update, so no store-side compare-and-set is available. Cross-host exclusion would need an external lease service.
- A crash or an ambiguous PATCH leaves the lock for an operator to clear (no automatic expiry). The skip message names the lock path. This trades liveness for safety. Removing a lock while its holder is alive, or while an ambiguous PATCH could still land, would break the rule.
- An ambiguous result is any PATCH error other than an HTTP 4xx answer: a timeout, a network error, a 5xx or an unknown error. A 4xx is treated as "not applied", which is Airtable's documented behaviour for rejected requests.
- `save()` failure after both PATCHes: the claimer throws and the record still names it. That is one owner with no local receipt, so this does not break the rule. Recovery needs operator review.
- The Queue is modeled as atomic last-writer-wins per request.
- The installed `~/.dsh/scripts/gate8-queue.mjs` and the claim tool are **not** changed by this lane. The fix is in the portable module only until it is adopted and deployed.

## Tool versions

Node v26.13.1. TLC2 2026.11.19.180144 (rev bc1b506), Eclipse Adoptium 21.0.13.1 aarch64, from `/Users/agentwork/Work/Repos/.tools/`. The jar is unchecksummed.

## Last checked

Last-checked commit `c03cf0a` (previous `f4c5feb`, independent review NOT-READY: ambiguous-PATCH release and leaked lock on write failure). Covered-file hashes:

- sha256 d71282d42ca9bc3078fd558a7004c5f964a55f67e2130d4d90e78980f5109dc6 `scripts/gate8/claim.mjs`

## When covered code changes

1. Remap the action table. Look for new `await`s between the lock and the save, new writers of `Claimed By`, and any change to the lock path or release.
2. Rerun `run.sh` with mutations and TLC.
3. Update the hashes and the commit.

Never widen the rule, shrink bounds or relabel a mutant to get green. A red result is a finding for the Lead.
