---
name: fable-recover
description: Diagnose repeated failures, stale execution, context drift, or contradictory evidence before another code edit. Use when retrying the same approach is no longer producing new information.
---

# Fable Recover

Change the diagnosis before changing more code.

## Attribution ladder

1. **Harness**: prove the command, test driver, fixture, expectation, permissions, and environment are valid.
2. **Execution path**: prove the changed code is the code actually running. Check branch, worktree, build output, generated files, caches, runtime selection, and deployment identity.
3. **Product logic**: inspect implementation only after the first two sources are supported by evidence.
4. **Invariant**: restate the failure as a violated general rule and repair that class of failure instead of one visible symptom.

## Contract

- Never repeat an unchanged failed command as if repetition were diagnosis.
- Record new evidence and the revised hypothesis.
- If a load-bearing assumption changed, route to `$fable-discover` or `$fable-plan`.
- If the diagnosis is stable, return exactly one bounded repair to `$fable-execute`.
- After any repair, route to `$fable-verify` and rerun the complete affected path.

The purpose of recovery is to reduce blind edit loops, not to add more retries.
