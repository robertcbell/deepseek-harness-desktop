---
name: graphify
description: Codebase AST Knowledge Graph and topology engine. Builds deterministic dependency graphs of functions, classes, and imports across multi-language projects.
---

# 🕸️ Graphify AST Knowledge Graph

Inspired by `Graphify-Labs/graphify`. Analyzes source code files and builds a structured dependency topology stored in `.planning/graphs/code_graph.json`.

## CLI Usage
```bash
# Build/Update knowledge graph for workspace
bun ~/.dsh/scripts/graphify_engine.mjs [directory]
```
