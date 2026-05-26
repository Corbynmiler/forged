---
description: Run all Forged L1 audits and roll up findings into one dated report.
---

You are running the Forged daily audit. **Tier L1: read-only. No edits, no commits, no pushes, no installs.**

Sequentially invoke the following Forged commands and write a single rolled-up report to `.claude/reports/$(date +%Y-%m-%d)-daily.md`:

1. `/forged-ux-audit`
2. `/forged-product-audit`
3. `/forged-bug-risk-audit`
4. `/forged-mobile-pwa-audit`
5. `/forged-marketing-audit`
6. `/forged-retention-audit`
7. `/forged-tech-debt-audit`

Each sub-audit already writes its own dated report. For the rollup, write **only** a summary index in this exact shape:

```
# Forged daily audit — $(date)

Top 3 things to look at first (across all audits):
1. ...
2. ...
3. ...

## Audit reports

- [UX](.claude/reports/<date>-ux-audit.md) — <one-line headline + risk rating L/M/H>
- [Product](.claude/reports/<date>-product-audit.md) — <headline + L/M/H>
- [Bug/risk](.claude/reports/<date>-bug-risk.md) — <headline + L/M/H>
- [Mobile/PWA](.claude/reports/<date>-mobile-pwa.md) — <headline + L/M/H>
- [Marketing](.claude/reports/<date>-marketing.md) — <headline + L/M/H>
- [Retention](.claude/reports/<date>-retention.md) — <headline + L/M/H>
- [Tech debt](.claude/reports/<date>-tech-debt.md) — <headline + L/M/H>

## Suggested next actions
- <action> — proposed command e.g. `/forged-propose-fix <topic>`
```

Rules:
- Never auto-run anything proposed under "Suggested next actions" — the user picks.
- If a sub-audit fails, note it in the rollup and continue with the others.
- Do not summarise twice — keep the rollup tight, the details live in the linked files.
