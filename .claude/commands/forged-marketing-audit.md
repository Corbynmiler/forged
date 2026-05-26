---
description: Marketing/content audit. Drafts only, never posts. Files-only (L1).
---

You are running the Forged marketing/content audit. **Tier L1: read-only. Files only. NEVER posts anywhere.**

Output file: `.claude/reports/$(date +%Y-%m-%d)-marketing.md`

Report headings must conform to [`.claude/dashboard-spec.md`](../dashboard-spec.md). In particular, include `Risk: <L|M|H>` and `One-line headline: ...` near the top. The drafts go under `## Drafts (review, do NOT post)` so the dashboard's "Suggested content ideas" section can pick them up verbatim.

## Audit scope

1. **What shipped (last 14 days)** — read `git log --since="14 days ago" --no-merges --pretty="%h %s"`. Bucket commits into: user-facing feature, fix/polish, infra, copy.
2. **Landing alignment** — if `public/landing.html` exists, extract its hero headline + primary CTA. Compare to the user-facing features bucket. Flag stale claims.
3. **Content drafts** — produce, in the report only:
   - 3 short social posts (≤280 chars) framed around the biggest user-facing change in the last 7 days. Voice: calm, direct, no hype, no emoji unless the commit log uses one.
   - 1 changelog entry (Markdown, dated, ≤120 words) suitable for a "What's new" sheet inside the app.
   - 1 IG caption (≤220 chars) with no hashtags.
4. **Coach voice safety** — confirm none of the drafts impersonate the Forged coach or quote coach output verbatim. The coach's voice is product, not marketing.
5. **Frequency check** — read existing marketing audit reports in `.claude/reports/`. If three are within 7 days and contain similar headlines, flag that the user is shipping faster than they're communicating.

## Report shape

```
# Forged marketing audit — <date>

Risk: L | M | H
One-line headline: ...

## What shipped (14d)
- features: ...
- fixes: ...
- infra: ...

## Landing alignment
- ...

## Drafts (review, do NOT post)

### Social post 1
<text>

### Social post 2
<text>

### Social post 3
<text>

### Changelog entry
<dated markdown>

### IG caption
<text>

## Notes
- ...
```

Rules:
- Never call a posting API.
- Never write to `public/landing.html` or anywhere outside `.claude/reports/`.
- Do not push.
- Do not impersonate the coach.
