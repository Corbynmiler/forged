---
description: UX/UI audit. Mobile-first PWA, T design tokens, iOS Safari quirks. Report-only (L1).
---

You are running the Forged UX/UI audit. **Tier L1: read-only.**

Output file: `.claude/reports/$(date +%Y-%m-%d)-ux-audit.md`

Report headings must conform to [`.claude/dashboard-spec.md`](../dashboard-spec.md) so `/forged-dashboard` can parse them. In particular, include `Risk: <L|M|H>` and `One-line headline: ...` near the top, and end with a `## Suggested fixes (do NOT apply)` section.

## Audit scope

1. **Token discipline** — grep `src/screens/`, `src/components/`, `src/coach/` for raw hex values (`#[0-9a-fA-F]{3,6}`) that aren't `T.something`. Report any new occurrences vs the existing baseline. Per `AGENTS.md`, all colors come from the `T` object.
2. **Inline-style hygiene** — flag any imports of CSS files, styled-components, Tailwind classes, or `className=` props in components (Forged uses inline `style={}` only).
3. **iOS Safari risks** — grep for patterns that historically break in PWAs:
   - `window.scrollTo` without `behavior: 'instant'` smoothing
   - `position: fixed` inside scrollable containers
   - `navigator.mediaDevices.getUserMedia` calls not gated by a user gesture (per recent mic fallback commits)
   - `100vh` (use `100dvh` or JS-measured viewport)
4. **Tap-target heuristic** — flag any `button`/`role="button"` with a height < 40px from inline styles or padding < 8px.
5. **Coach UI invariants** — confirm `src/coach/AICoach.jsx` and `src/coach/CoachApp.jsx` still wire SSE streaming and quota indicator (don't open, just grep for the patterns).
6. **Recent regressions** — read `git log --since="7 days ago" --oneline -- src/`. Note any commit messages mentioning iOS, mic, PWA, scroll, tap, or contrast.

## Report shape

```
# Forged UX audit — <date>

Risk: L | M | H
One-line headline: ...

## Findings

### Token discipline
- ...

### Inline-style hygiene
- ...

### iOS Safari risks
- ...

### Tap targets
- ...

### Coach UI invariants
- pass | fail (with detail)

### Recent regressions
- ...

## Suggested fixes (do NOT apply)
- ...
```

Rules:
- Never edit a file. If something is wrong, write it in the report and stop.
- Cite `file:line` for every finding.
- Do not run `npm run dev` or the preview tools — the audit is static.
