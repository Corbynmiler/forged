---
description: Mobile + PWA audit. Build, manifest, sw.js, bundle size. Read-only build only (L1).
---

You are running the Forged mobile/PWA audit. **Tier L1: read-only.**

You may run `npm run build` (read-only — produces `dist/` but does not modify source). Do not run `npm install`. Do not run any other npm script.

Output file: `.claude/reports/$(date +%Y-%m-%d)-mobile-pwa.md`

Report headings must conform to [`.claude/dashboard-spec.md`](../dashboard-spec.md) so `/forged-dashboard` can parse them. In particular, include `Risk: <L|M|H>` and `One-line headline: ...` near the top, and end with a `## Suggested fixes (do NOT apply)` section.

## Audit scope

1. **Build** — run `npm run build`. Capture exit code and any warnings. If build fails, stop and report.
2. **Manifest** — confirm `public/manifest.json` exists and includes: name, short_name, start_url, display (standalone or fullscreen), theme_color, background_color, icons (at least 192 and 512), and is referenced from `index.html`.
3. **Service worker** — confirm `public/sw.js` exists (or is generated into `dist/`). Confirm `vercel.json` headers section sets `Cache-Control: no-cache` and `Service-Worker-Allowed: /` for `/sw.js` (per current config).
4. **No-cache on shell** — confirm `index.html` and `manifest.json` have `Cache-Control: no-cache` headers in `vercel.json`.
5. **Bundle size** — list every file in `dist/assets/` with size; total JS, total CSS. Compare against any previous report (`.claude/reports/<prev-date>-mobile-pwa.md` — grep last "## Bundle sizes" block). Flag >10% growth.
6. **PWA install prompt** — grep `src/` for `beforeinstallprompt`. Note where it's wired.
7. **iOS install hints** — grep for `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` in `index.html`. Flag if missing.
8. **Push subscription** — confirm `public/sw.js` handles the `push` event and `notificationclick`. Don't open the file deeply; grep for `addEventListener('push'`, `addEventListener('notificationclick'`.

## Report shape

```
# Forged mobile/PWA audit — <date>

Risk: L | M | H
One-line headline: ...

## Build
- exit: 0 | N
- warnings: ...

## Manifest
- pass | fail (detail)

## Service worker
- pass | fail (detail)

## Headers (vercel.json)
- pass | fail (detail)

## Bundle sizes
- index-<hash>.js: NN KB
- index-<hash>.css: NN KB
- total JS: NN KB
- total CSS: NN KB
- delta vs last audit: + or - %

## PWA + iOS install
- ...

## Push handlers in sw.js
- ...

## Suggested fixes (do NOT apply)
- ...
```

Rules:
- Do not commit anything dist/ produces.
- Do not modify source files.
- Do not push.
