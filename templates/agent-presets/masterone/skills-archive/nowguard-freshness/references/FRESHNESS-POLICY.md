# Freshness Policy

## STATIC

Use for transformations and reasoning whose correctness is not materially changed by today's world state.

Examples: translation, rewriting supplied text, arithmetic, a timeless algorithm explanation.

No current evidence is required unless the task itself introduces a present-time factual dependency.

## VERSIONED

Use when the user pins a concrete version, revision, date, or historical state.

Rules:

- Do not silently replace the pinned target with the newest release.
- Prefer documentation matching the pinned version.
- If only current docs are available, state the mismatch before relying on them.

## VOLATILE

Use when information often changes but is not second-by-second live.

Examples: package versions, API support, product plans, deprecations, pricing tables, laws, platform capabilities, release guidance.

Default evidence TTL: 24 hours. A host may configure a shorter TTL for high-risk domains.

## LIVE

Use for facts whose value is explicitly about now, today, a current status, current officeholder, market data, weather, live scores, outages, or latest state.

Evidence must be obtained in the current turn. Cached memory is insufficient.

## Coding escalation

Treat these as at least VOLATILE when not version-pinned:

- dependency installation
- framework setup
- SDK/API integration
- deployment platform configuration
- authentication flows
- migration instructions
- deprecation replacements
- model/product capability checks

The purpose is not to browse for every line of code. It is to prevent version-sensitive decisions from being made from stale recall.
