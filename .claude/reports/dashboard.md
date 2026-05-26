# Forged Builder Dashboard

_Refreshed: 2026-05-22 22:08 AEST_
_Overall risk: **M**_ · _Last daily sweep: 2026-05-22_ · _Audits this week: 8_ · _Commits this week: 29_

## Today's Readout
- **Watch a couple of things this week** — nothing is on fire, but there are two open doors on your Anthropic budget and a real retention leak worth understanding.
- This week was mostly polish: **Loose Ends** shipped (a new task layer with overload nudges), the iOS PWA mic stack stabilised after five fix commits, and the Today screen got calmer.
- **Biggest risk:** two AI endpoints (`onboard-chat`, `coach-intro`) accept anonymous calls — anyone with the URL can spend your Anthropic credit.
- **Best quick win:** a 2-character Sentry fix on `journal-generate` plus a `100vh → 100dvh` find-and-replace across 11 screens. Both ~10 minutes.
- **Best product/marketing opportunity:** half of all signups (11/22) never log a single habit. Closing that gap is bigger than any retention curve tweak. The marketing draft about "an app that nudges you to add *fewer* habits" is the right counter-positioning to lead with.
- **Suggested focus next session:** lock the two open AI endpoints, then dig into the 11 zero-log profiles to learn where they drop off.

## 🔥 Do First

> Three highest-leverage next actions. Nothing has been applied.

1. **Lock the unauthenticated AI endpoints** · `H`
   _Why it matters:_ Two backend routes (`onboard-chat`, `coach-intro`) call Anthropic without checking who's asking. Anyone hitting the URL spends your API budget. CORS is wide open. This isn't theoretical — it's a fuse waiting to be lit.
   _Suggested action:_ Add the standard Bearer + `userClient.auth.getUser()` block (you have a clean copy in `api/chat.js`) and ideally add the same `chat_usage` daily cap. ~30 min.
   _Source:_ [bug-risk](.claude/reports/2026-05-22-bug-risk.md)

2. **Find out why half your signups never log anything** · `M`
   _Why it matters:_ 11 of 22 profiles have zero habit logs ever. They signed up, presumably finished onboarding (16/22 marked onboarded=true), then quit before tapping a single thing. Every retention conversation is downstream of this one.
   _Suggested action:_ Pull the 11 user_ids; check whether they completed onboarding, whether they actually have a habit created, and what their last activity was. The answer probably points to one specific drop-off step.
   _Source:_ [retention](.claude/reports/2026-05-22-retention.md)

3. **Sweep `100vh` to `100dvh` on app shells** · `M`
   _Why it matters:_ Eleven full-screen containers across App.jsx, auth.jsx, the coach, and main.jsx use the wrong viewport unit for iOS. On a real iPhone in standalone PWA mode the URL-bar/keyboard cycle will make these screens jump. The fix is mechanical and matches the pattern you already use on modals.
   _Suggested action:_ Find-and-replace the 11 exact sites listed in the UX report. ~15 min. Worth a quick iPhone smoke test after.
   _Source:_ [ux-audit](.claude/reports/2026-05-22-ux-audit.md)

## ⚡ Quick Wins

Small safe changes. Tag tells you the blast radius.

- **Sentry tag fix on journal-generate** — `withSentry(handler, "journal-generate")` — restores correct error tagging. Two-character change at `api/journal-generate.js:407`. · _safe code_ — [bug-risk](.claude/reports/2026-05-22-bug-risk.md)
- **No-cache header for `/manifest.json`** — mirror the existing `index.html` block in `vercel.json`. Prevents future "PWA stuck on stale manifest" pain. · _safe code_ — [mobile-pwa](.claude/reports/2026-05-22-mobile-pwa.md)
- **Update AGENTS.md** — the doc says free coach quota is 10/day but the live cap is 3/day; Journal isn't listed as a product pillar; the App.jsx split plan still references a layout you've already collapsed into `src/utils.js`. · _safe doc/copy_ — [product](.claude/reports/2026-05-22-product-audit.md), [tech-debt](.claude/reports/2026-05-22-tech-debt.md)
- **Tidy `.gitignore`** — add `.vite/` and `.cursor/`. They're sitting in `git status` for no reason. · _safe doc/copy_ — [tech-debt](.claude/reports/2026-05-22-tech-debt.md)
- **Delete stray screenshots from `public/`** — six unreferenced PNGs (`IMG_5611–14.PNG`, two `Screenshot 2026-05-14…`) ship in every build. Confirm nothing references them, then remove. · _needs care_ — [bug-risk](.claude/reports/2026-05-22-bug-risk.md), [tech-debt](.claude/reports/2026-05-22-tech-debt.md)

## 🛡 Risks To Watch

> Grouped by area. Plain English first.

**Security / auth / cost**
- Anonymous traffic can hit `onboard-chat` and `coach-intro` and burn Anthropic credit — see Do First #1. — [bug-risk](.claude/reports/2026-05-22-bug-risk.md)
- One subscription that was supposed to be cancelled still has a `stripe_subscription_id` set in `profiles` (with `is_pro=false`). Could be a missed webhook event. Worth a manual check in the Stripe dashboard. — [retention](.claude/reports/2026-05-22-retention.md)

**Product / retention**
- 11 of 22 signups have never logged a habit. D7 retention on the most recent 5-user cohort is 1/5 (20%). Small sample, but the zero-log half is the bigger story. — [retention](.claude/reports/2026-05-22-retention.md)
- Onboarding is at the 5-screen ceiling. Don't add a sixth — the audit suggests trimming the "welcome" copy screen before adding anything new. — [retention](.claude/reports/2026-05-22-retention.md)
- Coach is underused, not overused — nobody hit the 3/day cap last week, and only 2 distinct users used it at all. Discoverability problem, not a quota problem. — [retention](.claude/reports/2026-05-22-retention.md)

**Mobile / PWA**
- 11 shell containers use `100vh` instead of `100dvh` — iOS Safari layout risk in standalone PWA mode. — [ux-audit](.claude/reports/2026-05-22-ux-audit.md)
- Bundle is one 959 KB JS file (260 KB gzip). Fine on 4G/5G; soft ceiling on slow connections. Code-splitting `AICoach` and `Insights` would likely drop initial JS 30–40%. — [mobile-pwa](.claude/reports/2026-05-22-mobile-pwa.md)
- `manifest.json` has no explicit no-cache header — see Quick Wins. — [mobile-pwa](.claude/reports/2026-05-22-mobile-pwa.md)

**Tech debt**
- `src/App.jsx` is 3,913 lines (~9% above the 3.6k baseline AGENTS.md still references). `src/coach/AICoach.jsx` is now 4,345 lines — bigger than App. — [tech-debt](.claude/reports/2026-05-22-tech-debt.md)
- The auth boilerplate (Bearer extraction + `getUser`) is copy-pasted across 10 API files in two different idioms. A single `_lib/auth.js` would collapse ~200 lines of incidental code. — [tech-debt](.claude/reports/2026-05-22-tech-debt.md)
- A handful of ad-hoc hex colours (`#e74c3c`, `#8E44AD`, paywall palette) have crept in outside the `T` token object — most visibly in `auth.jsx` and `ProfileScreen.jsx`. — [ux-audit](.claude/reports/2026-05-22-ux-audit.md)

## 🧠 Product Signals

> Roadmap-shaping observations, not bugs.

- **Journal is now a fourth product pillar.** Most 14-day commits (and 7 of the 7 new migrations) are journal- or weekly-brief-related. AGENTS.md still describes the product as "habit / goal / coach"; landing already says "Habit tracker · AI coach · Daily journal". The doc and the surface are out of sync. — [product](.claude/reports/2026-05-22-product-audit.md)
- **Loose Ends introduces a fifth concept (tasks).** Phase 1 just shipped. Decide soon whether tasks are permanent product surface or a temporary scaffold — the answer shapes landing copy and AGENTS.md. — [product](.claude/reports/2026-05-22-product-audit.md), [marketing](.claude/reports/2026-05-22-marketing.md)
- **Positioning sharpened this week.** The "add fewer habits, not more" stance (5/8 overload nudges) is a real differentiator. Landing doesn't say it yet — currently leads with the journal/voice angle. Worth a hero update once Phase 2 lands. — [marketing](.claude/reports/2026-05-22-marketing.md)
- **Weekly brief / momentum signals are being undersold.** Multiple commits invested, now an above-the-fold Insights pillar — landing doesn't mention it. — [product](.claude/reports/2026-05-22-product-audit.md), [marketing](.claude/reports/2026-05-22-marketing.md)
- **The coach is undersubscribed, not overused.** Free cap is 3/day; no one hit it last week. Discoverability is the lever. — [retention](.claude/reports/2026-05-22-retention.md)

## 📣 Content Ideas

_Drafts from the latest marketing audit. Sign off before posting._

### Social post 1
A new habit app that nudges you to add *fewer* habits.

Forged now caps the noise: hit 5 and we ask if it's really worth tracking. Hit 8 and we push back harder. Most people overload on day one and quit by day six. We'd rather you stick.

### Social post 2
Added Loose Ends to Forged — a one-line checklist that sits next to your habits.

It's the stuff that doesn't deserve to be a habit but you don't want to forget. Tap it done, pin it forward, move on. Half the XP of a habit. Same calm logging.

### Social post 3
Voice logging in PWAs works again on iPhone.

Two weeks of mic plumbing later: gesture-safe start, clearer fallback when Safari blocks it, no more silent failures. Open the app, hit the mic, ramble about your day. The coach sorts it.

### Changelog entry
**2026-05-22 — Loose Ends, less bloat, calmer Today**

- **Loose Ends.** A lightweight checklist next to your habits — the small things that don't deserve to be a tracked habit but you still want to remember. Add inline, pin to carry over, complete for +5 XP.
- **Overload guidance.** Add Habit now nudges you at 5 habits and pushes back at 8. Most habit apps reward you for adding more. We don't.
- **Today, calmer.** Yesterday's receipt hides once today is logged. Ring title reflects what's left, not what's done.
- **Voice in PWAs.** iPhone home-screen install + mic now plays nice. Tap, talk, the coach handles the rest.
- **More reliable coach.** Retries on 529, never drops your message, rolls back on error.

### IG caption
We added a feature that tells you when you're tracking too much. Most apps reward bloat. Forged now nudges you at 5 habits, pushes back at 8. Plus a new Loose Ends checklist for everything that doesn't deserve to be a habit. Calmer Today, same coach.

## Recent Changes

**29** commits this week. Highlights:
- **Loose Ends shipped** (Phase 1) — task layer next to habits, plus habit-overload nudges at 5 and 8 habits.
- **iOS PWA mic stack stabilised** — five fix commits land gesture-safe voice start, clearer fallback strip, and the add-habit pill overlap.
- **Today screen got calmer** — yesterday's receipt hides once today's logged, ring title is progress-aware, new yesterday-morning callback card.
- **Coach reliability** — retries on 529, preserves input on failure, rolls back on error.
- **Journal polish** — duplicate-row collapses, richer brain-dump responses, Done ✓ row suppression on AI-logged entries.

_Full list: [latest daily report](.claude/reports/2026-05-22-daily.md)._

## 🧾 Audit Reports

| Audit | Date | Risk | Headline | Link |
| ----- | ---- | ---- | -------- | ---- |
| daily | 2026-05-22 | — | Friday sweep — 7 sub-audits, top 3 at top of file | [open](.claude/reports/2026-05-22-daily.md) |
| ux-audit | 2026-05-22 | M | iOS viewport units + raw hex drift in paywall; coach SSE/quota intact | [open](.claude/reports/2026-05-22-ux-audit.md) |
| product-audit | 2026-05-22 | M | Journal is now a fourth pillar; AGENTS.md and the live quota disagree | [open](.claude/reports/2026-05-22-product-audit.md) |
| bug-risk | 2026-05-22 | M | Two AI endpoints accept anonymous calls; one Sentry tag missing | [open](.claude/reports/2026-05-22-bug-risk.md) |
| mobile-pwa | 2026-05-22 | L | Build green; one 959 KB JS chunk; manifest no-cache header missing | [open](.claude/reports/2026-05-22-mobile-pwa.md) |
| marketing | 2026-05-22 | L | Loose Ends is the headline story; landing hasn't caught up yet | [open](.claude/reports/2026-05-22-marketing.md) |
| retention | 2026-05-22 | M | Half of signups never log a habit; one Stripe sub mismatch | [open](.claude/reports/2026-05-22-retention.md) |
| tech-debt | 2026-05-22 | M | App.jsx still 3.9k lines; auth boilerplate copy-pasted across 10 routes | [open](.claude/reports/2026-05-22-tech-debt.md) |

<details><summary>Older reports — click to expand</summary>

_No prior dated reports on disk — today's sweep (2026-05-22) is the first under the current spec._

</details>

---

_Spec: [.claude/dashboard-spec.md](.claude/dashboard-spec.md). Generated by `/forged-dashboard` — re-run, don't hand-edit._
