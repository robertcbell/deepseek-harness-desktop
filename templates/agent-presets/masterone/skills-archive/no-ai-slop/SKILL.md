---
name: no-ai-slop
description: 20+ pattern AI slop linter and sanitizer. Strips binary contrasts, throat-clearing openings, fake-profound sign-offs, and hype adjectives to maintain authentic human prose.
---

# 🚫 No-AI-Slop Linter & Sanitizer

Inspired by `petergyang/no-ai-slop`. Detects and eliminates the 20+ telltale markers of AI-generated robotic text.

## Rules & Banned Patterns
- **Binary Contrasts**: *"It's not just X, it's Y"* $\rightarrow$ direct affirmative phrasing.
- **Throat-Clearing Openers**: *"In today's fast-paced world..."*, *"Here's what nobody tells you..."* $\rightarrow$ start with the core thesis immediately.
- **Fake-Profound Endings**: *"Only time will tell..."*, *"The future belongs to those..."* $\rightarrow$ clean summary or clear next steps.
- **Pretentious Buzzwords**: *delve*, *seamless*, *tapestry*, *transformative*, *groundbreaking*.

## CLI Usage
```bash
# Detect AI slop patterns and calculate authenticity score
bun ~/.dsh/scripts/no_ai_slop_lint.mjs detect <file_or_text>

# Sanitize and rewrite text
bun ~/.dsh/scripts/no_ai_slop_lint.mjs clean <file_or_text>
```
