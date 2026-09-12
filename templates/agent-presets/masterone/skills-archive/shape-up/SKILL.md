---
name: shape-up
description: Basecamp Shape Up methodology and problem shaping based on rjs/shaping-skills. Focuses on fixed time / variable scope, Breadboarding, Fat Marker sketches, identifying rabbit holes, and defining appetite.
---

# 🍞 Shape Up Problem Shaping

Shape work into bounded, actionable pitches before writing code.

## 🎯 5 Levers of Shape Up
1. **Appetite over Estimates:** Decide upfront how much time/budget the feature is worth (e.g. Small Batch = 1-2 days, Big Batch = 2 weeks).
2. **Breadboarding:** Map the system purely as Places, Affordances, and Wiring without getting bogged down in pixel-level mockups.
3. **Fat Marker Sketches:** Keep designs rough enough to leave room for implementation flexibility.
4. **Identify Rabbit Holes:** Call out risky technical complexities before work begins.
5. **Declare Explicit No-Gos:** Explicitly state what will NOT be built in this cycle.

## 🛠️ CLI Tool
```bash
bun ~/.dsh/scripts/shape_up_doc.mjs pitch "Feature Name" "Small Batch"
```
