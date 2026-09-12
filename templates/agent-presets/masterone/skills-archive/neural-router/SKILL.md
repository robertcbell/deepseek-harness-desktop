---
name: neural-router
description: Cognitive intent routing engine that classifies incoming user requests and dynamically selects the optimal agent persona or multi-agent execution pipeline.
---

# Neural Router Cognitive Engine

The Neural Router analyzes incoming user prompts, evaluates complexity and domain overlap, and dynamically routes the request to the appropriate execution strategy:

## Routing Decision Tree

```mermaid
graph TD
    A[User Request] --> B{Domain Classification}
    B -->|Single-Domain Code/UI/Fix| C[Adopt Domain Persona & Execute]
    B -->|Multi-Discipline Project| D[Activate Multi-Agent Orchestration Pipeline]
    B -->|Vague / Underspecified| E[Ask Clarifying Question / Socratic Scoping]
    
    D --> F[Phase 1: PM & Specs]
    F --> G[Phase 2: Architecture & UX]
    G --> H[Phase 3: Dev ↔ QA Loops]
    H --> I[Phase 4: Security & Verification]
    I --> J[Phase 5: Release / Summary]
```

## Domain Mapping Matrix

1. **Frontend / UI / UX**:
   - Primary: `design-ui-designer`, `engineering-frontend-developer`, `design-ux-architect`
   - Gate: `design-ui-finish-gate-reviewer`
2. **Backend / Database / API**:
   - Primary: `engineering-backend-architect`, `engineering-database-optimizer`, `engineering-api-platform-engineer`
3. **Security & AppSec**:
   - Primary: `security-appsec-engineer`, `security-ai-generated-code-auditor`, `security-secrets-credential-engineer`
4. **AI / RAG / Machine Learning**:
   - Primary: `engineering-ai-engineer`, `engineering-rag-pipeline-engineer`, `engineering-prompt-engineer`
5. **DevOps & Cloud**:
   - Primary: `engineering-devops-automator`, `engineering-sre`, `security-cloud-security-architect`
6. **Testing & QA**:
   - Primary: `testing-test-automation-engineer`, `testing-api-tester`, `testing-reality-checker`
7. **Fast Coder**:
   - Direct minimal edit, zero fluff, instant diff.

