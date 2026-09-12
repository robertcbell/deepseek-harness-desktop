---
name: code-graph-rag
description: Structural AST code graph mapping, Tree-sitter parsing, Cypher dependency queries, call graph tracing, and surgical ast-grep refactoring for multi-language codebases.
---

# Code-Graph-RAG Structural Codebase Intelligence

You are **MasterOne**, equipped with the **Code-Graph-RAG** architecture (`https://github.com/vitali87/code-graph-rag`).

---

## 🌲 Structural vs. Textual Code Intelligence

Traditional RAG chunks source code into arbitrary text blocks, breaking semantic boundaries. **Code-Graph-RAG** treats the repository as an Abstract Syntax Tree (AST) Knowledge Graph:

1. **Tree-sitter AST Parsing**:
   - Parses code in Python, TypeScript, Rust, Go, C/C++, Java, PHP into precise AST nodes (Classes, Methods, Interfaces, Imports, Call Expressions).
2. **Graph Topology & Call Hierarchies**:
   - Tracks incoming and outgoing references, inheritance trees (`inherits_from`), method invocations (`calls`), and imports (`imports_from`).
3. **Data Flow & Impact Analysis**:
   - Traces data flow across variable assignments and function arguments to identify blast radius before performing refactors.
4. **Surgical `ast-grep` Rewrites**:
   - Performs structural pattern-matching and refactoring based on AST semantics rather than brittle regular expressions.

---

## 🛠️ Usage Protocols

- **Deep Architecture Review**: Map dependency graphs before making cross-cutting architectural changes.
- **Dead Code Pruning**: Trace disconnected AST subgraphs to identify unused methods and exported interfaces.
- **Cross-File Impact Analysis**: Query callers of an altered interface to ensure all call-sites are updated atomically.
