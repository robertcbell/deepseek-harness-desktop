---
name: fable-plan
description: Convert sufficiently grounded requirements into bounded implementation cards with explicit acceptance criteria. Use for architecture, migrations, broad refactors, or multi-file work after load-bearing unknowns are resolved.
---

# Fable Plan

Produce an executable contract, not a brainstorming transcript.

## Contract

1. Start from current evidence. If a load-bearing fact is still unknown, route to `$fable-discover` instead of guessing.
2. Define the requested outcome, constraints, non-goals, and affected boundaries.
3. Decompose work into cards small enough to understand and verify independently.
4. Give every card one concrete acceptance command or observable acceptance condition.
5. Mark dependencies and safe parallelism explicitly.
6. Record remaining assumptions as assumptions, not facts.
7. For an initialized project, update only the task-relevant portions of `docs/SPEC.md` and `.fable/LEDGER.md`.

## Exit condition

Planning is complete when the next card has a stable target, bounded scope, and acceptance condition. Hand that card to `$fable-execute`.

Do not implement during planning unless the host cannot separate phases and the task is already trivially bounded.
