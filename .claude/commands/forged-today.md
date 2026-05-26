---
description: Run today's audits per the weekly rotation, then refresh the dashboard. L1 only.
---

You are running the Forged daily rotation. **Tier L1: read-only.**

## Rotation

| Day of week | Audits to run |
| ----------- | ------------- |
| Mon | `/forged-product-audit` + `/forged-retention-audit` |
| Tue | `/forged-bug-risk-audit` + (then call sub-agent `forged-cost-watcher` against `api/chat.js`, `api/coach-summary.js`, `api/coach-intro.js` and save its output to `.claude/reports/<date>-cost-watch.md`) |
| Wed | `/forged-ux-audit` + `/forged-mobile-pwa-audit` |
| Thu | `/forged-tech-debt-audit` |
| Fri | `/forged-daily` + `/forged-marketing-audit` |
| Sat | _(rest — no audits)_ |
| Sun | _(rest — no audits)_ |

## Steps

1. Run `date +%u` to get the day-of-week as a number (1=Mon … 7=Sun). Also keep the local YYYY-MM-DD for filenames.
2. Look up today's audit list in the rotation table.
3. If today is Sat or Sun:
   - Print a one-line message: "Weekend — no scheduled audits. Run any individual `/forged-*-audit` if needed, or `/forged-dashboard` to view existing reports."
   - Stop. Do not run anything.
4. Otherwise, run each audit for today **in sequence**, waiting for each to finish before the next. Each audit writes its own report file per the dashboard spec.
5. For the cost-watcher leg on Tuesday: invoke the `forged-cost-watcher` sub-agent explicitly, ask it to review the three coach routes, and capture its verdict block into `.claude/reports/<date>-cost-watch.md` with the standard `Risk:` / `One-line headline:` header so the dashboard picks it up.
6. After every today-rotation audit completes, run `/forged-dashboard` to refresh the dashboard.

## Rules

- **Do not run any audit not listed for today.** If the user wants a full sweep, they'll type `/forged-daily` themselves.
- **Do not skip the dashboard refresh** — that's the whole point of the wrapper.
- **Do not modify app source, commit, or push.**
- If any single audit fails, log the failure into the dashboard refresh and continue with the rest.
- Print a short summary at the end:
  ```
  Today: <weekday>, <date>
  Audits run: <N>
  Reports written: <list of paths>
  Dashboard: .claude/reports/dashboard.md
  ```

## Manual override

If the user passes an argument naming a different day (e.g. `/forged-today fri`), use that day's rotation instead of the actual weekday. Useful for catching up after a missed day.
