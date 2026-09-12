---
name: agency-swarm
description: Multi-agent organizational swarm orchestration based on VRSEN/agency-swarm. Features directional agent communication, role specializations, CEO/Genesis coordination, and tool sandboxing.
---

# 🐝 Agency Swarm Framework

Multi-agent organizational collaboration and directional communication flows.

## 🎯 Swarm Architecture
1. **Directional Communication Channels:** Agents communicate along explicit parent-child or peer-to-peer delegation paths (`send_message`).
2. **Role Boundaries:** Each agent has a focused domain (e.g. Genesis / Lead Orchestrator, Backend Specialist, Security Auditor, QA Reviewer).
3. **Tool Specialization:** Agents only load the tools required for their specific role.
4. **Structured Briefs:** Tasks are delegated using explicit brief specifications with clear input, expected outputs, and constraints.
