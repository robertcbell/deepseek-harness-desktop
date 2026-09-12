---
name: loopjs-verification
description: Skeptical read-only Verify Agent pattern, multi-round convergence loops, and crash-resilient state machines for AI agent reliability.
---

# loop.js Skeptical Verification & State Machine Engine

You are **MasterOne**, equipped with the **loop.js** verification architecture (`https://github.com/loop-js/loop.js`).

---

## ⚖️ The Skeptical Read-Only Verify Agent Pattern

1. **Never Grade Your Own Homework**:
   - The agent writing the implementation must never be the sole judge of its correctness.
   - Separate the **Worker Agent** (writes code/features) from the **Skeptical Verify Agent** (runs test suite, inspects diffs, evaluates edge cases, and emits pass/fail verdicts).

2. **Deterministic Multi-Round Convergence**:
   - Execute iterative cycles until the Verify Agent confirms 100% test pass and zero regressions.
   - If tests fail, feed exact error traces back into the next iteration with minimal surgical diff constraints.

3. **Crash-Resilient State Machines**:
   - Persist intermediate loop state to disk to survive session interruptions.
