---
name: fable-verify
description: Falsify a substantial implementation and collect fresh acceptance evidence before completion. Use for review, release readiness, post-repair verification, or any task where static plausibility is not enough.
---

# Fable Verify

Assume the implementation may be wrong until the affected behavior is proven.

## Contract

1. Re-read the user-visible acceptance criteria and relevant repository rules.
2. Inspect the actual diff or changed paths, not an implementation summary.
3. Try to falsify correctness, edge cases, regressions, integration behavior, and security boundaries.
4. Run the narrowest meaningful checks first, then the broader repository gate when appropriate.
5. Exercise the real affected product path when static checks cannot prove behavior.
6. After the final fix, re-run the complete affected path.
7. Record the command or observation, result, and concrete evidence.

## Completion gate

Substantial work is not complete without at least one passing evidence record tied to the requested behavior.

If verification fails and the diagnosis is already clear, return one bounded repair to `$fable-execute`. If the failure source is uncertain, repeated, stale, or contradictory, route to `$fable-recover` first.
