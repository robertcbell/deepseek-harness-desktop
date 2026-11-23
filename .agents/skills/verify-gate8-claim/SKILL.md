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
- M1–M3 are KILLED with a numbered trace, and M4 is labelled "SURVIVED as expected";
- every TLC config meets its expectation. `Gate8Claim*` pass, `Mutant-*` report `Invariant OneOwner is violated`, and each `Witness-*` reports its own invariant violated.

Without the jar the last line says `tlc=SKIPPED`, never PASS; `REQUIRE_TLC=1` makes that a failure. `--quick` skips mutations. A full run takes about 6 s. TLC runs with a temp `-metadir` and `-noGenerateSpecTE`, so it writes nothing into `verify/`.

## What is checked, by which tool

| Check | Tool | Status at last check |
|---|---|---|
| `verify/gate8-claim/explore.mjs` | Real-code interleaving explorer, **NOT a TLC model check**. It runs a DFS over every order of the Queue GET/PATCH steps, with the real `claimItem` and the real O_EXCL file lock. | GREEN, exhaustive. claim-x2 10 schedules; claim-x2-faults 50 (PATCH lost-after-apply and failed-before-apply); claim-x2-savefail 10; claim-x3 96. Witnesses claimed, skipLock and skipStatus are reached in every scenario; lostResponse, failedPatch and threw are reached where faults apply. |
| `tests/gate8/claim.test.mjs` | `node --test`. Two real OS processes against a local fake Queue HTTP server. | 4/4 pass. Without the lock, the rank-5 interleaving (forced by the server) gives 2 × claimed. With the lock, 5 rounds give exactly one owner. Also covers held-lock skip, ambiguous PATCH and readback-mismatch release. |
| `verify/gate8-claim/mutate.sh` | Removes real guards in a temp copy of `claim.mjs` | M1 no lock, M2 no Ready check and M3 lock released early are KILLED (9-step numbered traces). M4 no readback is equivalent here and SURVIVES. |
| `Gate8Claim.tla` + 9 cfgs | TLA+, TLC model check | Results in the table below. The only warning is TLC's standard fingerprint-collision notice. |

| TLC config | Expected | Generated/distinct states |
|---|---|---|
| Gate8Claim (2 claimers, PATCH faults, crashes) | pass | 123/84 |
| Gate8Claim-x3 (3 claimers) | pass | 154/85 |
| Mutant-NoLock (= original helper) | OneOwner violated | 113/81, 10-state BFS trace |
| Mutant-NoStatusCheck | OneOwner violated | 39/31 |
| Mutant-EarlyRelease | OneOwner violated | 114/84 |
| Witness-Claimed | NeverClaimed violated | 79/54 |
| Witness-SkipLock | NeverSkipLock violated | 19/16 |
| Witness-SkipStatus | NeverSkipStatus violated | 35/27 |
| Witness-Failed | NeverFailed violated | 63/49 |

The violated configs stop at the first error, so their state counts vary slightly between runs. The configs also check `AllDone`: every claimer terminates and no lock wait hangs.

`verify/gate8-claim/repro-helper.mjs` is a manual reproduction and is not part of `run.sh`. It copies the gitignored local helper `gate8-queue.mjs`, rewrites only its credential path, proof root, base URL and Jev writer import, and checks that the claim branch is otherwise byte-identical. It runs two `claim` processes against a scripted fake Airtable. Without the fix both return `claimed`. With `--adopt`, which swaps in `claimItem`, one claims and one skips.

## Model actions mapped to real atomic steps (`scripts/gate8/claim.mjs`)

| Model action | Real code |
|---|---|
| `Acquire` | `fileClaimLock.acquire`: `openSync(lock,'wx')`. EEXIST → `skip claim-lock-held` |
| `Read` | `claimItem`: `await get()`, then `Status !== 'Ready' \|\| Claimed By` → skip |
| `PatchOwner*` | `await patch({'Claimed By','Claimed At'})`: ok, applied with the response lost (throws), or failed (throws) |
| `ReadbackStep` | `await get()`. An owner mismatch throws |
| `PatchDoing*` | `await patch({Status:'Doing'})`: ok, lost or failed |
| `Finish` | `save(owner)`, return `claimed`, then `finally` `lock.release()` |
| `Crash` | process killed mid-claim. The lock file stays, so later claims skip (fail closed) |
| `Release` (in `End`) | `finally { lock.release() }` on every return or throw |

Original code (helper `gate8-queue.mjs` lines 35–38, local and gitignored): the same GET/PATCH/GET/PATCH sequence with no lock. This is `Mutant-NoLock` and M1.

## Bounds and assumptions

- 2 claimers (3 in `-x3` and `claim-x3`), one record. Faults are applied per PATCH; crashes are in TLC only.
- **Host-local only.** The lock serializes claimers on one host that share the lock path (`<proof root>/gate8-claim.lock`). Claimers on another host, or a human editing `Claimed By`, are **not** excluded and are not modeled. Airtable's Web API offers no conditional or versioned update, so no store-side compare-and-set is available. Cross-host exclusion would need an external lease service.
- After a crash, the stale lock is left for an operator to clear (no automatic expiry). This trades liveness for safety. Removing a lock while its holder is alive would break the rule.
- `save()` failure after both PATCHes: the claimer throws and the record still names it. That is one owner with no local receipt, so this does not break the rule. Recovery needs operator review.
- The Queue is modeled as atomic last-writer-wins per request.
- The installed `~/.dsh/scripts/gate8-queue.mjs` and the claim tool are **not** changed by this lane. The fix is in the portable module only until it is adopted and deployed.

## Tool versions

Node v26.13.1. TLC2 2026.11.19.180144 (rev bc1b506), Eclipse Adoptium 21.0.13.1 aarch64, from `/Users/agentwork/Work/Repos/.tools/`. The jar is unchecksummed.

## Last checked

Last-checked commit `f4c5feb`. Covered-file hashes:

- sha256 9a0faf7468a7276ca5ac08a4f352c6b2ff10bbdaff084e5805808a63c1fdfcf6 `scripts/gate8/claim.mjs`

## When covered code changes

1. Remap the action table. Look for new `await`s between the lock and the save, new writers of `Claimed By`, and any change to the lock path or release.
2. Rerun `run.sh` with mutations and TLC.
3. Update the hashes and the commit.

Never widen the rule, shrink bounds or relabel a mutant to get green. A red result is a finding for the Lead.
