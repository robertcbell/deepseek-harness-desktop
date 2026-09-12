# Client Adapters

## Hard enforcement

Use a client lifecycle hook or API middleware that runs without relying on model tool choice.

Recommended interception points:

- session start: establish clock context
- user prompt submit: classify freshness and inject the TemporalEnvelope
- before dependency-changing tool calls: remind the agent to verify unpinned versions
- after context compaction: restore temporal context
- subagent start: provide compact temporal context
- stop/final response: run the bounded freshness gate

## Soft enforcement

A Skill, MCP tool, AGENTS.md, or CLAUDE.md rule improves behavior but depends on the model/client reaching that instruction or selecting the tool. Use it when hard lifecycle interception is unavailable.

## MCP role

MCP supplies deterministic clock/classification/audit tools and can expose organization-specific evidence sources. MCP by itself is not the universal per-message enforcement point because tool invocation is controlled by the host/model unless the host adds its own mandatory policy.
