---
name: ralph-loop
description: Iterative autonomous code review, testing, and refinement loop based on zomars/ralph (Ralph-Loop / RLCR). Continuously tests, inspects diffs, and converges code to 100% green without human intervention.
---

# 🔄 Ralph-Loop Iterative Refinement

Autonomous loop: Execute $\rightarrow$ Test/Lint $\rightarrow$ Inspect Diff $\rightarrow$ Refine $\rightarrow$ Converge.

## 🎯 Protocol
1. **Reproduce & Execute:** Run the test suite (`bun test`, `vitest`, `pytest`) to identify exact failing lines.
2. **Minimal Surgical Edit:** Modify only the broken invariant.
3. **Automated Re-test:** Re-execute the verification command immediately.
4. **Loop Budget:** Cap autonomous attempts at 5 iterations. If not converged, escalate with structured diagnostic.

## 🛠️ CLI Runner
```bash
bun ~/.dsh/scripts/ralph_runner.mjs "bun test" 5
```
