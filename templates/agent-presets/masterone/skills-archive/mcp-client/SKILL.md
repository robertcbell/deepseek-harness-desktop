---
name: mcp-client
description: Model Context Protocol (MCP) hub and client bridge for connecting external MCP servers (stdio and streamable HTTP) and synchronizing tools.
---

# 🔌 Model Context Protocol (MCP) Hub

Bridge connecting MasterOne to local and remote MCP servers.

## 🛠️ CLI Interface & Management

Executable: `bun ~/.dsh/scripts/mcp_hub.mjs <action>`

### 1. List Configured MCP Servers
```bash
bun ~/.dsh/scripts/mcp_hub.mjs list
```

### 2. Auto-Sync MCP Servers
Automatically detect and import all MCP configurations from Claude Desktop, Cursor, and Windsurf:
```bash
bun ~/.dsh/scripts/mcp_hub.mjs sync
```

## 🌐 Connected MCP Server Namespaces
All tools exposed by connected MCP servers are automatically registered under:
`mcp__<serverName>__<toolName>`

Examples:
- `mcp__cloudflare__*`
- `mcp__cloudflare_docs__*`
- `mcp__render__*`
- `mcp__supabase__*`
- `mcp__github__*`
