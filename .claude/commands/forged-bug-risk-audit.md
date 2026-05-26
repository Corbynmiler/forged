---
description: Bug + correctness audit. withSentry coverage, auth checks, date handling, TODO debt. Report-only (L1).
---

You are running the Forged bug/risk audit. **Tier L1: read-only.**

Output file: `.claude/reports/$(date +%Y-%m-%d)-bug-risk.md`

Report headings must conform to [`.claude/dashboard-spec.md`](../dashboard-spec.md) so `/forged-dashboard` can parse them. In particular, include `Risk: <L|M|H>` and `One-line headline: ...` near the top, and end with a `## Suggested fixes (do NOT apply)` section.

## Audit scope

For every `api/*.js` route (not files starting with `_`):

1. **withSentry coverage** — confirm the file imports `withSentry` from `./_lib/sentry.js` and exports `withSentry(handler, "...")` per `AGENTS.md`. List any route missing this.
2. **Auth gate** — if the file calls Supabase, confirm it pulls the Bearer token, creates a `userClient` with the token in headers, and calls `userClient.auth.getUser()` before any service-role client work. List any route that skips this.
3. **`client_date` handling** — if the file writes any user-facing log row that has a `log_date` / `created_for_date` / similar column, confirm it uses `safeClientDate()` and accepts a `client_date` from the request body. Per `AGENTS.md`, never use `new Date().toISOString().slice(0,10)` server-side for a user-facing log date.
4. **Stripe webhook integrity** — `api/stripe-webhook.js` must keep `bodyParser: false` and use the raw body for signature verification. Confirm.
5. **Cron auth** — `api/cron-reminders.js` should verify a Bearer token equal to `process.env.CRON_SECRET` (or Vercel's automatic cron header). Confirm.

Also:

6. **TODO/FIXME/HACK debt** — grep `src/` and `api/` for `TODO|FIXME|HACK|XXX`. Bucket by file, count per file, show the top 10.
7. **Untracked production assets** — list any files in `dist/` not produced by `vite build` (PNG/JPG/PDF in the repo root of dist that shouldn't ship).
8. **Anthropic cost invariants** — confirm `api/chat.js` still has `cache_control: { type: "ephemeral" }` on both the tools array and the system prompt, that `messages.slice(-12)` is intact, that the model id is `claude-haiku-4-5`, and that the chat_usage daily quota check is present.

## Report shape

```
# Forged bug/risk audit — <date>

Risk: L | M | H
One-line headline: ...

## Per-route findings
| Route | withSentry | Auth | client_date | Notes |
| ----- | ---------- | ---- | ----------- | ----- |
| ...

## Stripe webhook integrity
- pass | fail (detail)

## Cron auth
- pass | fail (detail)

## Anthropic cost invariants
- cache_control on tools: pass | fail
- cache_control on system: pass | fail
- messages.slice(-12): pass | fail
- model claude-haiku-4-5: pass | fail
- chat_usage quota: pass | fail

## TODO/FIXME debt (top 10 files)
- ...

## Untracked dist/ assets
- ...

## Suggested fixes (do NOT apply)
- ...
```

Rules:
- Cite `file:line` for every finding.
- Do not edit files.
- Do not delete dist/ contents.
