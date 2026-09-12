---
name: karpathy-invariants
description: Andrej Karpathy LLM coding invariants and behavioral heuristics. Enforces zero silent assumptions, anti-overcomplication, minimal diff boundaries, and verifiable proof.
---

# 🧠 Andrej Karpathy Coding Invariants

Inspired by `multica-ai/andrej-karpathy-skills`. Core principles to prevent common LLM coding failures:

1. 🛑 **No Silent Assumptions**: Never guess parameters, types, or user intent. If unclear, ask or verify empirical evidence first.
2. 📐 **Prevent Over-Complication**: Refuse premature abstractions and unnecessary helper classes. Write direct, simple code.
3. ✂️ **Touch Only Relevant Code**: Never touch, reformat, or refactor adjacent lines/files outside the direct task boundary.
4. 🧪 **Explicit Verifiable Success Criteria**: Define concrete assertions and verify running tests before declaring task completion.
