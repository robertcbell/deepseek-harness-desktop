---
name: token-telemetry
description: Local token consumption and request telemetry HUD tracking API usage across providers (TabiAI, AgentRouter).
---

# 📊 Token Telemetry Plugin

Local telemetry recorder and session usage monitor.

## 🛠️ CLI Interface & Invocations

Executable: `bun ~/.dsh/scripts/telemetry_hud.mjs <action> [arguments]`

### 1. Record Request Usage
```bash
bun ~/.dsh/scripts/telemetry_hud.mjs record tabiai claude-3-7-sonnet 1200 450
```

### 2. View Usage Summary
```bash
bun ~/.dsh/scripts/telemetry_hud.mjs summary
```
