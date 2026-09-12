---
name: smart-git
description: Smart Git management plugin for generating clean conventional commits, managing feature branches, and inspecting repository state.
---

# 📦 Smart Git Plugin

Structured Git workflow manager enforcing clean commit conventions and safe branch branching.

## 🛠️ CLI Interface & Invocations

Executable: `bun ~/.dsh/scripts/git_sentinel.mjs <action> [arguments]`

### 1. Smart Conventional Commit
Stage all changes and commit with type, scope, and message:
```bash
bun ~/.dsh/scripts/git_sentinel.mjs commit "feat" "auth" "add passkey authentication support"
bun ~/.dsh/scripts/git_sentinel.mjs commit "fix" "ui" "resolve modal backdrop z-index glitch"
```

### 2. Feature Branch Creation
Create and switch to a feature branch:
```bash
bun ~/.dsh/scripts/git_sentinel.mjs branch "feat/supabase-realtime-sync"
```

### 3. Compact Status
Inspect dirty files:
```bash
bun ~/.dsh/scripts/git_sentinel.mjs status
```
