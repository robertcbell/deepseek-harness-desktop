---
name: claude-mem
description: Persistent cross-session memory and observation graph. Stores conventions, user preferences, and architectural observations across sessions.
---

# 🧠 claude-mem Cross-Session Memory

Inspired by `thedotmack/claude-mem`. Automatically maintains durable memories and user preferences in `~/.dsh/.claude-mem.json`.

## CLI Usage
```bash
# Remember a project convention or user preference
bun ~/.dsh/scripts/claude_mem.mjs remember convention "<Rule / Pattern>"
bun ~/.dsh/scripts/claude_mem.mjs remember pref "<User Preference>"

# Recall memories
bun ~/.dsh/scripts/claude_mem.mjs recall [query]
```
