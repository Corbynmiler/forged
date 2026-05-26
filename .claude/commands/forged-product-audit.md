---
description: Product/CEO audit. Drift, narrative coherence, feature sprawl. Report-only (L1).
---

You are running the Forged product audit. **Tier L1: read-only.**

Output file: `.claude/reports/$(date +%Y-%m-%d)-product-audit.md`

Report headings must conform to [`.claude/dashboard-spec.md`](../dashboard-spec.md) so `/forged-dashboard` can parse them. In particular, include `Risk: <L|M|H>` and `One-line headline: ...` near the top, and end with a `## Suggested actions (do NOT apply)` section.

## Audit scope

1. **Narrative coherence** — read `AGENTS.md` ("What Forged is" section). Then read `git log --since="14 days ago" --no-merges --oneline`. Identify any commits whose topic doesn't fit the stated product (habit / goal / coach).
2. **Feature sprawl signal** — count distinct top-level screens (`src/screens/*.jsx`), distinct API routes (`api/*.js`), distinct migrations added in the last 14 days. Flag if any of these is growing without commits removing or consolidating elsewhere.
3. **Coach role drift** — grep `api/chat.js`, `api/coach-summary.js`, `api/coach-intro.js` for the system-prompt strings. Note if anything added in the last 14 days changes coach voice/personality wording (this is in the protected paths list — confirm no edits have slipped through).
4. **Pricing/paywall coherence** — grep `is_pro`, `STRIPE_*PRICE_ID`, `paywall`, `upgrade` across `src/` and `api/`. Confirm the free-tier daily chat quota (10/day per `AGENTS.md`) is still server-enforced in `api/chat.js` via the `chat_usage` table.
5. **Top-of-funnel** — if `public/landing.html` exists, compare its primary CTA + value prop against the most recent product commits. Flag stale claims.
6. **Open questions** — list any commits with `WIP`, `TODO`, `FIXME`, `?` in title.

## Report shape

```
# Forged product audit — <date>

Risk: L | M | H
One-line headline: ...

## Narrative coherence
- <commit shas + summary of drift, if any>

## Feature sprawl
- screens: N (delta +/- vs 14d ago)
- api routes: N (delta)
- migrations added (14d): N

## Coach role drift
- <findings>

## Pricing/paywall coherence
- <findings>

## Landing alignment
- <findings>

## Suggested actions (do NOT apply)
- ...
```

Rules:
- Do not modify files.
- Do not run migrations or call Supabase write endpoints. Read-only Supabase MCP queries are fine (`list_tables`, `execute_sql` SELECT-only).
- Do not propose copy changes to coach personality without flagging them as protected.
