---
name: fable-execute
description: Implement one bounded work card against an explicit acceptance condition. Use only when scope is stable enough that implementation does not need a new architecture decision.
---

# Fable Execute

Make the smallest coherent change that satisfies the accepted card.

## Contract

1. Read the active card, its constraints, and its acceptance condition.
2. Trace only the code needed to prove the real execution path.
3. Match repository conventions and avoid unrelated cleanup.
4. Implement one bounded change.
5. Run the card acceptance check immediately.
6. Record concrete evidence before marking the card complete.

## Failure boundary

One failure may justify a targeted correction when the diagnosis is clear. Repeated failure, unchanged retries, stale execution, or contradictory evidence routes to `$fable-recover` before another edit.

## Exit condition

After all accepted cards are implemented, route the complete affected behavior to `$fable-verify`. Passing a narrow unit test does not by itself prove the final product path.
