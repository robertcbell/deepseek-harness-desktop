---
name: ecc-orchestrator
description: Everything Claude Code (ECC) multi-tier orchestration harness. Coordinates sub-agent workflows, phased planning, and multi-round quality reviews.
---

# 🏛️ ECC Multi-Tier Orchestration Harness

Inspired by `affaan-m/ECC`. Integrates structured engineering phases (Discovery $\rightarrow$ TDD $\rightarrow$ Review $\rightarrow$ UAT) with machine-checkable verification.

## CLI Usage
```bash
# Initialize phased engineering plan
bun ~/.dsh/scripts/ecc_runner.mjs plan "<Task Description>"

# Run multi-gate quality review
bun ~/.dsh/scripts/ecc_runner.mjs review
```
