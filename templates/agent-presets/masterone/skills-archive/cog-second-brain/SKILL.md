---
name: cog-second-brain
description: Cognitive Obsidian & Git Second Brain knowledge engine. Automatically captures, organizes, and synthesizes architectural decisions, code patterns, and project insights into a versioned knowledge graph.
---

# 🧠 COG Second Brain (Cognitive Knowledge Engine)

Inspired by `huytieu/COG-second-brain`. Maintains an evolving Markdown-based second brain inside `.second-brain/` with bi-directional links and automated knowledge graph synthesis.

## CLI Usage
```bash
# Capture insight or decision
bun ~/.dsh/scripts/cog_brain.mjs capture "<Title>" "<Body & Insights...>"

# Search knowledge vault
bun ~/.dsh/scripts/cog_brain.mjs search <query>

# Auto-synthesize and build INDEX.md
bun ~/.dsh/scripts/cog_brain.mjs synthesize
```
