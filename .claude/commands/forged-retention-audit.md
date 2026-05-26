---
description: Retention + onboarding audit. Supabase read queries + funnel metrics. Read-only (L1).
---

You are running the Forged retention/onboarding audit. **Tier L1: read-only.**

Output file: `.claude/reports/$(date +%Y-%m-%d)-retention.md`

Report headings must conform to [`.claude/dashboard-spec.md`](../dashboard-spec.md) so `/forged-dashboard` can parse them. In particular, include `Risk: <L|M|H>` and `One-line headline: ...` near the top, and end with a `## Suggested actions (do NOT apply)` section.

You may use the Supabase MCP server but **only SELECT queries**. Never INSERT, UPDATE, DELETE, DROP, ALTER, or run a migration. If the MCP server is unavailable, write the queries into the report so the user can run them manually, and continue with whatever you can grep from the codebase.

## Audit scope

Try to answer these. For each, state the number AND the query you used.

1. **Active users** — count of distinct user_ids with any habit log in the last 1, 7, 28 days. If a `habit_logs` (or similar) table exists, use it; otherwise note the table you'd query.
2. **D1 / D7 retention** — of users created in the last 28 days, what fraction logged a habit on day 1 and day 7?
3. **Free-tier chat quota hits** — count rows in `chat_usage` in the last 7 days where the user hit the 10/day cap.
4. **Push subscriptions** — count rows in `push_subscriptions`. Estimate stale rate (subscriptions older than 30 days that haven't been used — if you can detect "used"). If unclear, just count total.
5. **Stripe Pro funnel** — count of `profiles` where `is_pro=true`. Count distinct `stripe_customer_id` values. Note the ratio.
6. **Onboarding completion** — if there's an onboarding completion column or flag, count completed vs not. Otherwise grep `src/screens/OnboardingScreen.jsx` for the completion event and flag if no completion is persisted.
7. **Pro conversion lag** — for the Pro users, average days from `profiles.created_at` to `is_pro=true`. If `is_pro` was set without a timestamp column, note the limitation.

Also static checks:

8. **Onboarding length** — read `src/screens/OnboardingScreen.jsx` and count the number of distinct screens/steps. Flag if >5.
9. **First-day path** — confirm that a fresh user lands on TodayScreen (not an empty state that requires navigating). Grep `src/App.jsx` for the initial route logic.

## Report shape

```
# Forged retention audit — <date>

Risk: L | M | H
One-line headline: ...

## Numbers
| Metric | Value | Query / source |
| ------ | ----- | -------------- |
| ...

## Funnel
- created (28d): N
- D1 active: N (X%)
- D7 active: N (X%)
- Pro conversions: N (X% of created)

## Onboarding shape
- steps: N
- completion persisted: yes | no

## Push health
- total subscriptions: N
- estimated stale: N

## Suggested actions (do NOT apply)
- ...
```

Rules:
- SELECT-only via Supabase MCP.
- Never write to the DB.
- Never expose `auth.users.email` in the report — use ids and aggregates only.
- Do not propose schema changes here (that's protected — flag for `/forged-tech-debt-audit` instead).
