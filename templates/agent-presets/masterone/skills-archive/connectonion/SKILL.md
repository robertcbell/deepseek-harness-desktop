---
name: connectonion
description: ConnectOnion multi-agent networking and P2P discovery framework. Connects agents across local and distributed runtimes using host() and connect() channels.
---

# 🧅 ConnectOnion Multi-Agent Mesh

Enables dynamic peer-to-peer networking, agent capability advertising, and message dispatch.

## CLI Usage
```bash
# Host an agent on the mesh
bun ~/.dsh/scripts/connect_onion.mjs host <agentId> <endpoint> [capabilities...]

# Discover active agents in the mesh
bun ~/.dsh/scripts/connect_onion.mjs discover

# Connect and send a task packet
bun ~/.dsh/scripts/connect_onion.mjs connect <fromAgent> <toAgent> "<message>"
```
