---
description: Tech-debt audit. App.jsx size, candidate extractions, lint/test gaps. Report-only (L1).
---

You are running the Forged tech-debt audit. **Tier L1: read-only.**

Output file: `.claude/reports/$(date +%Y-%m-%d)-tech-debt.md`

Report headings must conform to [`.claude/dashboard-spec.md`](../dashboard-spec.md) so `/forged-dashboard` can parse them. In particular, include `Risk: <L|M|H>` and `One-line headline: ...` near the top, and end with a `## Suggested next moves (do NOT apply)` section.

## Audit scope

1. **App.jsx size trend** — `wc -l src/App.jsx`. Compare to the previous tech-debt audit (grep prior reports for "App.jsx lines"). Flag if growth >5% in the last week.
2. **Candidate extractions** — per `AGENTS.md`, the planned split starts with `lib/dates.js`. Grep `src/App.jsx` for these functions and report whether they still live in App.jsx:
   - `todayStr`, `daysAgo`, `parseLocal`, `fmtDate`, `weekStartFor`
   - `getDailyStreak`, `getWeeklyStreak`
   - `urlBase64ToUint8Array`
   List each: in App.jsx (line N) | extracted (path).
3. **Function size offenders** — find top 10 longest functions in `src/App.jsx` (lines between `function X` and matching close). Just heuristic.
4. **Inline-style audit** — count occurrences of `style={{` in `src/App.jsx` and the screens dir. Note total + average per file (informational, not necessarily a problem).
5. **API route duplication** — look for repeated patterns across `api/*.js` (e.g., same Bearer-token extraction in 5+ files). If a clear helper opportunity exists in `api/_lib/`, suggest it.
6. **No-linter / no-tests reminder** — per `AGENTS.md` these are deliberate. Don't suggest installing them. But do flag if any file imports something that looks test-runner-shaped (`vitest`, `jest`, `mocha`) without a config.
7. **Untracked status** — `git status --short`. List untracked / unignored files that shouldn't be checked in (PNGs, screenshots, logs).
8. **Dependency drift** — `npm outdated` if available; otherwise read `package.json` and note any deps last bumped >6 months ago by reading the lockfile dates (heuristic).

## Report shape

```
# Forged tech debt audit — <date>

Risk: L | M | H
One-line headline: ...

## App.jsx size
- lines: NNNN
- delta vs prior audit: +/- N (+/- X%)

## Candidate extractions (per AGENTS.md split plan)
| Function | Status | Note |
| -------- | ------ | ---- |
| todayStr | in App.jsx:NNN or extracted | ... |
| ...

## Top long functions in App.jsx
1. <name>: ~NNN lines (start :NNN)
2. ...

## Inline-style density
- App.jsx: N occurrences
- screens/: N total, avg N/file

## API route duplication candidates
- ...

## Untracked files
- ...

## Dependency drift (informational)
- ...

## Suggested next moves (do NOT apply)
- ...
```

Rules:
- Do not edit files.
- Do not propose installing a test runner or linter.
- Do not start splitting App.jsx — only report.
- Do not delete untracked files; only list them.
