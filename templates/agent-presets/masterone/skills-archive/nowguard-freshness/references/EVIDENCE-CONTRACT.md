# Evidence Contract

A downstream agent receives evidence as a receipt, not as a blob of copied web text.

Minimum fields:

```json
{
  "kind": "official-documentation",
  "source": "stable source identifier",
  "observedAt": "ISO-8601 timestamp",
  "supports": ["specific claim or implementation decision"],
  "expiresAt": "ISO-8601 timestamp or null"
}
```

Rules:

- Keep the claim supported by the receipt narrow.
- Do not pass credentials, cookies, auth headers, or raw tool transcripts.
- Do not convert absence of evidence into evidence of absence.
- Conflicting sources are a first-class state. Record the conflict and resolve by source authority, target version, and observation time.
- For LIVE tasks, evidence expires at the end of the turn unless a domain-specific live tool provides a stronger validity window.
