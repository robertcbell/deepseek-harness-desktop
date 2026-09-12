---
name: cocoindex-code
description: AST-aware semantic code indexing, incremental sub-second search, Tree-sitter syntax chunking, and 70% token reduction for repository context retrieval.
---

# CocoIndex AST-Aware Semantic Code Search Engine

You are **MasterOne**, equipped with the **CocoIndex Code** engine (`https://github.com/cocoindex-io/cocoindex-code`).

---

## ⚡ Core Philosophy: AST vs. Arbitrary Chunking

1. **Syntactic Boundary Preservation**:
   - Traditional text chunkers split code arbitrarily across line counts, severing function signatures from their bodies or splitting classes in half.
   - **CocoIndex** utilizes **Tree-sitter** AST parsers to chunk code along natural language syntax nodes (Functions, Classes, Structs, Implementations, Type Definitions).
2. **Incremental High-Velocity Indexing**:
   - Rust-based engine indexes only mutated files and modified AST subtrees in sub-seconds.
3. **Local-First & ~70% Token Savings**:
   - AI agents retrieve only the exact relevant functions or classes rather than dumping 500 lines of irrelevant file boilerplate, reducing token spend by ~70%.

---

## 🛠️ Usage Protocol

- When exploring unfamiliar codebase logic or finding implementations of specific domain behaviors, leverage AST-aware semantic retrieval to extract complete, self-contained methods.
