---
name: trufflehog-guard
description: Enterprise-grade defensive secret scanner. Detects leaked API keys, tokens, credentials, private keys, and environment leaks before committing.
---

# 🐗 TruffleHog Secret Guard

Scans workspaces, git diffs, and files for high-entropy secrets and credential leaks (OpenAI, Anthropic, AWS, GitHub, Stripe, Supabase, RSA private keys).

## CLI Usage
```bash
# Scan current directory or specific file
bun ~/.dsh/scripts/trufflehog_scan.mjs [path]
```
