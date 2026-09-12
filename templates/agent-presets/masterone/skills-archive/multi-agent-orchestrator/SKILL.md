---
name: multi-agent-orchestrator
description: Autonomous orchestration pipeline for executing multi-stage development workflows with continuous Dev-QA and Security loops.
---

# Multi-Agent Orchestrator Pipeline

## Pipeline Execution Loop

For complex software engineering and product features, the God Agent executes the standard 5-stage orchestration pipeline:

### 1. Specification & Requirements (PM Phase)
- Analyze requirements, define milestones, specify acceptance criteria.
- Target: Grounded, decision-complete plan before coding.

### 2. Architecture & Design Contract (Architect/UX Phase)
- Establish system boundaries, data contracts, and design tokens.
- Choose clean, unslop patterns (no forbidden clichés).

### 3. Implementation with Continuous QA Loops (Dev ↔ QA)
- Implement discrete chunks.
- For each chunk:
  - Write implementation.
  - Run verification / tests immediately.
  - Fix any failures before proceeding to next chunk.

### 4. Security & Quality Gate Audit
- Scan for hardcoded credentials, input validation gaps, and authorization rules.
- Review with `security-ai-generated-code-auditor` standards.

### 5. Final Delivery & Walkthrough
- Verify end-to-end functionality.
- Provide crisp, structured summary of changes and validation evidence.

