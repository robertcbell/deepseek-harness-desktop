---
name: ponytail-minimalist
description: Lazy Senior Developer minimal-code discipline and scoreboard. Prioritizes YAGNI, standard libraries, and native APIs to eliminate bloat.
---

# ✂️ Ponytail Minimal-Code Discipline

Inspired by `DietrichGebert/ponytail`. Enforces the 5-step Decision Ladder:

1. **Skip (YAGNI)**: Delete unnecessary complexity.
2. **Standard Library**: Prefer native built-ins.
3. **Platform Native**: Use OS/Node/Bun APIs directly.
4. **Existing Utilities**: Reuse what's already written.
5. **New Package**: Last resort only.

## CLI Usage
```bash
# View decision ladder
bun ~/.dsh/scripts/ponytail_scoreboard.mjs ladder

# View performance and code savings scoreboard
bun ~/.dsh/scripts/ponytail_scoreboard.mjs score
```
