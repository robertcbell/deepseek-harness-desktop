---
name: fable-discover
description: Gather the smallest set of repository, environment, documentation, and runtime evidence needed before planning or changing code. Use when load-bearing facts are unknown, current behavior must be traced, or external API behavior can change the design.
---

# Fable Discover

Resolve the facts that would materially change the implementation before committing to an approach.

## Contract

1. Read repository instructions and the real execution path before broad search.
2. List only load-bearing unknowns. Ignore facts that cannot change the solution.
3. Resolve each unknown with the cheapest reliable evidence source available: code, test, runtime probe, primary documentation, or current source.
4. Tag conclusions as measured, inferred, or unresolved.
5. Stop gathering when the architecture no longer depends on an unanswered question.
6. Hand off to `$fable-plan` when the work is broad or risky, or `$fable-execute` when the target is already bounded and acceptance is obvious.

## Context rule

Return a compact evidence packet, not a transcript of exploration. Include paths, commands, outputs, and source references that the next phase actually needs.

## Failure rule

If a probe contradicts the current assumption, replace the assumption. Do not preserve a preferred design by searching for confirming evidence.
