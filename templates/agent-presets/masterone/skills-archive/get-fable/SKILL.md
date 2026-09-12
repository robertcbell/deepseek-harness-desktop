---
name: get-fable
description: Route substantial software work through get-fable's evidence, planning, execution, verification, and recovery contracts. Use when the user explicitly requests get-fable or Fable-style rigor, or when the current project has an active .fable directory.
---

# get-fable

This is the entry skill. It improves execution discipline and does not claim to change the underlying model.

## Routing contract

Use the canonical graph in `skills/get-fable/registry.json` when the host can read repository files. Otherwise apply the same order directly:

1. `$fable-recover` when repeated failure, stale execution, or contradictory evidence is already present
2. `$fable-verify` for review, proof, release readiness, or completion checks
3. `$fable-discover` when load-bearing facts about code, runtime, or current documentation are unknown
4. `$fable-plan` for architecture, migrations, broad refactors, or multi-file design
5. `$fable-execute` for an already bounded change with a clear acceptance condition

Do not route by task size alone. Route by what information or proof is missing.

## Durable state

When `.fable/state.json` exists, treat it as the strict runtime state and the Markdown files as the human-readable working record.

- `docs/SPEC.md` holds requirements and decisions
- `.fable/LEDGER.md` holds cards and acceptance evidence
- `.fable/PROGRESS.md` holds concise resumable context
- `.fable/state.json` holds phase, routing, failure streak, and evidence semantics

Never overwrite project-owned content just to normalize formatting.

## Frontier-like behavior contract

For substantial work:

- resolve load-bearing unknowns before architecture
- keep implementation cards bounded
- run acceptance immediately after each card
- verify the real affected path before completion
- after repeated failure, change the diagnosis before changing more code
- report fresh evidence instead of confidence language

## Handoffs

A handoff is a workflow contract, not a claim that the host automatically spawned another agent. If the host cannot invoke another skill, follow that skill inline.

A substantial task is complete only after `$fable-verify` has produced passing evidence or a precise blocker has been reported.
