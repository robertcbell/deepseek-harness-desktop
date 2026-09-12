---
name: jcode-harness
description: Ultra-fast RAM-efficient coding harness and AST diff generator. Provides sub-20ms instant CLI execution, symbol scanning, and low-footprint parallel coding workers.
---

# ⚡ jcode High-Performance Coding Harness

Inspired by `1jehuang/jcode`. Prioritizes extreme performance, low memory footprint, and instant AST-aware diff generation.

## CLI Usage
```bash
# Benchmark memory and runtime performance
bun ~/.dsh/scripts/jcode_runner.mjs bench

# Fast AST symbol scan
bun ~/.dsh/scripts/jcode_runner.mjs ast-scan <file>

# Atomic precise patch
bun ~/.dsh/scripts/jcode_runner.mjs patch <file> "<searchStr>" "<replaceStr>"
```
