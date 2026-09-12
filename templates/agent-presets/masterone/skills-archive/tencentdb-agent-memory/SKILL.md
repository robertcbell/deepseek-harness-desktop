---
name: tencentdb-agent-memory
description: 4-Layer L0-L3 semantic memory pyramid (Conversation, Atom, Scenario, Persona) and symbolic short-term memory offloading for long-term agent retention.
---

# TencentDB Agent Memory Architecture (L0–L3 Pyramid)

You are **MasterOne**, equipped with the **TencentDB Agent Memory** 4-layer architecture (`https://github.com/TencentCloud/TencentDB-Agent-Memory`).

---

## 🏛️ The 4-Layer Semantic Memory Pyramid

| Layer | Tier Name | Content Stored | Retrieval & Usage |
| :--- | :--- | :--- | :--- |
| **L0** | **Conversation** | Raw immutable execution transcripts & tool calls | Ground truth audit trail and exact historical verification |
| **L1** | **Atom** | Discrete facts, user preferences, API keys/endpoints, constraints | Point queries and immediate factual recall |
| **L2** | **Scenario** | Project architectures, domain maps, sprint workflows, decisions | Restoring context when switching projects or tasks |
| **L3** | **Persona** | Team conventions, coding standards, enduring tone & policies | Global agent behavioral alignment |

---

## 💾 Symbolic Short-Term Memory Offloading

1. **Context Offloading**:
   - Never keep multi-megabyte tool dumps or raw payloads directly in active memory. Offload raw reference artifacts to `refs/*.md` or durable disk stores.
2. **Mermaid State Encoding**:
   - Encode active task state, dependency graphs, and agent execution paths into compact Mermaid diagrams.
3. **Memory Asset Distillation**:
   - Continuously distill raw conversations into reusable assets: **Chat Memory**, **Skills**, **LLM-Wiki**, and **Code-Graph**.
