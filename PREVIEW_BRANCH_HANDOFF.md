# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface. Explicitly being built for one user first (not generic users yet) — the bar is "would you use this instead of ChatGPT for life updates, reflection, planning, and thinking."
**Last updated:** 2026-07-05 (bug-fix pass) — fixed iOS Chrome's mic silently doing nothing after permission grant, added a stale-PWA version-check banner for the home-screen-app case, shrank the greeting from a giant serif headline to calm body text and made its wording casual/compressed, redesigned conversation modes a third time with real per-mode behavioral steering + visible descriptions, strengthened the anti-question-loop instruction into a hard constraint, and implemented the Moonstone color direction on the Ember (was previously proposed-only).

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. Master plan (roadmap)

### Complete, and still the right shape
- **Faster voice replies** — sentence-chunked TTS, streamed/played back-to-back.
- **Memory layer (schema + extraction)** — `memory_facts`, `xp_events`, extended `daily_summaries` (title/commitments/emotional_context/structured/xp). Migrations applied and live.
- **ChatGPT memory import** — onboarding paste-and-review step.
- **The Ember's shape** (clean circle, breathing bloom, sonar rings, thinking-sweep, sparks) — settled two rounds ago, only its color has changed since.

### Complete as originally scoped, direction still evolving
- **AI-judged XP.** The observational nightly judgment (0-50, stored, not wired to the real total) is done and live. The standing instruction ("judge from context, not checklists") still has a real ceiling: the judgment can't see actual conversation content yet, only curated notes and habit logs. `conversation_messages` (below) is what actually closes this.
- **The Companion screen itself.** Now four redesign rounds deep (mic-first screen → Ember/homepage pivot → transcript/carousel bug fixes → this round's taste + reliability pass). Expected to keep moving at your direction — that's the exploratory point of this branch, not scope creep.

### This round's fixes, superseding prior versions
- **Conversation modes v3** (Just chat / Build / Think / Decide / Reflect) — same five labels as last round, but steering text rewritten to be measurably more directive per mode (see §2), plus a `desc` one-liner shown in the dropdown and as a transient caption on selection. Supersedes last round's v2 steer text, which the testing feedback said still "felt undercooked."
- **Greeting v3** — same `structured.narrative` field from last round, but the extraction prompt now explicitly asks for a short, casual, topic-compressed sentence ("Yesterday was mostly CloseCraft, pouch discipline, and keeping the basics alive") instead of a fully-clausal sentence, and the client renders it at body size in the UI font, not display-size serif. Supersedes last round's font/size choice and the prompt's clausal-sentence bias.
- **Ember palette: Moonstone, implemented.** Last round proposed six untouched concepts; this round actually swapped the core/bloom/ring/spark colors in `CompanionScreen.jsx` to the Moonstone palette (pale lavender-white cooling to muted slate). Shape/animation are unchanged. If it doesn't land, Amber Glass's exact values are still sitting in the git history of the previous round's disposable preview harness commit message / this doc's prior revision — a same-shape recolor, not a rebuild.

### Newly identified and fixed this round (not roadmap items — real bugs)
- **iOS Chrome mic silently doing nothing after permission grant.**
- **Stale UI on the iPhone home-screen PWA.**
- **TTS/voice failures (e.g. ElevenLabs not configured) were completely silent** — found while investigating the ElevenLabs question below; not something you reported, but the same "don't silently fail" principle applied.

### No longer relevant — superseded, not just done
- Everything listed here last round (coach auto-open, the notifications-vs-real-screen framing, conversation modes v1) — unchanged, still dead.
- **Conversation modes v2** — replaced by v3 above (same names, meaningfully rewritten steering + new UI).
- **Greeting v2 (bullets → prose, display-serif at 21px)** — replaced by v3 above (same data source, smaller/calmer presentation + casual phrasing).

### Remaining roadmap
1. **Hand-test this round.** Everything below in §6.
2. **Retire the old CoachBar / modal drawer.** Flagged for four sessions running now. Two ways to reach the same conversation is a real inconsistency.
3. **`conversation_messages` (raw per-turn transcript, server-side).** The structural fix for "judge from context, not checklists" — stage the table, wire the Companion screen to persist every turn (fail-soft), extend the rollover digest-builder to read from it.
4. **Embeddings vendor decision** (Voyage API vs. a Supabase Edge Function running `gte-small`) — unblocks real semantic retrieval.
5. **Notifications rewrite**, **"What I remember" screen + Arc inference** — lower priority, unstarted.

---

## 1. This round's bug-fix pass — root causes and fixes

### 1. iOS Chrome mic: tap → permission prompt → Allow → nothing happens

**Root cause, found in `src/hooks/useSpeechInput.jsx`:** every browser on iOS (Chrome, Edge, Firefox included — "CriOS" is just Chrome's UI chrome around the same engine) is required by Apple to run on WebKit under the hood. WebKit requires `SpeechRecognition.start()` to be called **synchronously inside the original user-gesture handler** — the same tap that triggered it. `shouldPrimeMicBeforeWebSpeech()` was matching iOS Chrome/Edge/Firefox against the desktop-Chromium branch (their UA string contains "Chrome" too), which does an `await navigator.mediaDevices.getUserMedia(...)` "priming" step *before* starting recognition. That `await` doesn't resolve until after the user taps "Allow" on the permission dialog — by which point the synchronous gesture context is gone, so `recog.start()` silently does nothing: no error event, no transcript, nothing. Real Safari never hit this because it was already excluded from the priming branch (`pureWebKitSafari`); iOS Chrome/Edge/Firefox weren't.

**Fix:** `shouldPrimeMicBeforeWebSpeech()` now excludes all of iOS (`isAppleMobileDevice()`), not just literal Safari — iOS Chrome now goes straight to `beginRecognition()` synchronously inside the tap handler, exactly like Safari does, preserving the gesture chain.

**Also added — a watchdog for any *other* silent failure mode:** if `recog.start()` is called but neither `onstart` nor `onerror` fires within 4 seconds (permission dialogs, other iOS quirks, anything not yet seen), it's now treated as a failure: `errorOccurredRef` is set, `stopAll()` runs, and a message is surfaced via the new `speechStartWatchdogMessage()` — which specifically says "try Safari" when the browser is a known iOS non-Safari wrapper (CriOS/FxiOS/EdgiOS/OPiOS), otherwise a generic "try again or type instead." This directly satisfies "don't silently fail" as a backstop, independent of whether the root-cause fix above covers every case.

**Unverified — no iPhone in this sandbox.** The root-cause fix (removing the priming step) is a well-understood, direct match for the reported symptom, not a guess. The watchdog is defense-in-depth. First real test: iPhone, Chrome, tap the Ember, grant mic permission, confirm it actually starts listening.

### 2. Stale UI on the iPhone home-screen PWA

**Investigated:** `vercel.json` already serves `index.html` with `Cache-Control: no-cache, no-store, must-revalidate`, and every build gets a uniquely-hashed JS bundle filename (`/assets/index-HASH.js`) — so a real network reload always gets the latest deploy. `public/sw.js` has no `fetch`/cache-API logic at all (it only handles push notifications) — it was never caching anything. **This is not a caching bug; there's nothing to purge.**

**Actual cause:** iOS keeps a home-screen web app's WKWebView process alive in the background rather than reloading it on every icon tap — exactly like a native app being backgrounded and resumed. Tapping the icon can just bring the *same in-memory session* back to the foreground, with no network request made at all — headers don't matter if no request happens. This is a well-known iOS PWA behavior, not something fixable from response headers.

**Also worth checking on your end:** if the URL you added to your home screen is a specific Vercel *preview deployment* URL (the unique-per-deploy `...-git-....vercel.app` link) rather than the branch's stable alias, that link is permanently frozen to whatever was deployed at that moment by design — a second, simpler explanation worth ruling out alongside the fix below.

**Fix — `src/main.jsx`:** on every resume (`visibilitychange` → visible, and `pageshow`), fetch `/index.html` with `cache: "no-store"`, compare the `<script type="module">` path it references against the one actually running, and if they differ, show a small non-intrusive bottom banner ("A newer version of Forged is ready" + a Refresh button). Deliberately never auto-reloads — that could cut off an in-progress conversation or dictation. Debounced to at most once per 30 seconds so it doesn't spam-fetch on rapid focus events. No-ops harmlessly in local dev (unhashed script path never differs).

**Unverified — needs a real iPhone home-screen install + a real new deploy to trigger against.** First test: reopen the installed app after a new deploy has gone out; confirm the banner appears and Refresh actually updates it.

### 3. Greeting was "a giant formal sentence with weird phrasing"

Two independent fixes, since this was both a visual and a content problem:

**Visual — `CompanionScreen.jsx`:** was `T.serif` (DM Serif Display, a display headline font) at 21px, center-block. Now `T.font` (the same DM Sans used everywhere else in the app) at 16.5px, rendered as one flowing paragraph (opener + narrative + closer inline, not stacked). A greeting is something a companion says to you, not a poster headline.

**Content — `api/memory-rollover.js`:** the `structured.narrative` prompt (added last round) asked for "one to two flowing sentences" without a length/register ceiling, which the model was filling with full, elaborately-claused sentences. Rewrote the instruction to explicitly demand brevity and to prefer a compressed topic-list over spelled-out clauses — with your own example baked directly into the prompt as the target: *"Yesterday was mostly CloseCraft, pouch discipline, and keeping the basics alive."* beats *"You worked on CloseCraft, showed pouch discipline, and kept up the basics."* Full clauses are now reserved for days with one or two genuinely distinct, name-worthy events — never three-plus stacked clauses.

Also softened the time-of-day prefix itself: `timeOfDayGreeting()` now returns "Morning"/"Afternoon"/"Evening"/"Still up" instead of "Good morning"/"Good afternoon" — casual, matches your example.

**Unverified against a real model call** — no Anthropic credentials in this sandbox. First test: let a real day roll over, read the actual `structured.narrative` text.

### 4 & 5. Conversation modes undercooked + over-asking questions

**Modes now carry a `desc` field** (e.g. Build → "Practical and direct — product & execution.") shown two ways: inline under each option in the dropdown (so you can tell them apart before picking), and as a small transient caption that fades in near the pill for ~3 seconds right after you pick one — so switching modes is *felt* immediately, not just something that silently changes the next reply.

**Steering text rewritten to be measurably more directive**, not just longer — each mode now names its own specific failure mode and forbids it explicitly:
- **Just chat** — mate-to-mate, no agenda; a question is fine sometimes but never the default move.
- **Build** — co-founder-mid-build energy; terse, direct, practical; *does not ask a clarifying question unless the next action is genuinely impossible to name without one.*
- **Think** — long-form is a hard requirement here, not a suggestion; *a short reply is explicitly called out as wrong in this mode*; never ends on a question.
- **Decide** — must state a real opinion before listing tradeoffs, must name the strongest counter-case; *sitting on the fence or handing the decision back with a question is named as this mode's one failure mode.*
- **Reflect** — weekly-review energy; surfaces patterns as plain observations; explicitly not about prompting the user to share more.

**The shared baseline instruction (`RESPONSE_STYLE_STEER`) is now a hard constraint, not a soft preference** — it literally says "THIS IS A HARD CONSTRAINT, NOT A SOFT PREFERENCE" and asks the model to check itself before adding a question rather than just discouraging the habit.

**Important honesty check:** this is prompt engineering, not a mechanism with a verifiable guarantee. Claude (or any LLM) can still ask a question at the end of a reply despite explicit instructions not to — prompts shift the *tendency*, they don't enforce a hard rule the way code does. If this still feels present after testing, the next lever (not pulled yet) is a lightweight server-side check that flags/regenerates a reply if it detects a trailing question mark when the situation calls for none — a real mechanism, not another paragraph of instructions. Flagging this now rather than promising prompt tuning alone will fully solve it.

**Unverified against real replies** — needs a handful of real exchanges per mode to judge.

### 6. Ember color

Implemented **Moonstone** directly in `CompanionScreen.jsx` (previously proposed-only, in a disposable preview harness, last round). Core gradient, ambient bloom, sonar rings, and sparks all recolored from warm orange/gold to pale lavender-white cooling to a muted slate edge. Shape, animation timing, and state logic (idle/listening/thinking/speaking) are byte-for-byte unchanged — this was purely a materials swap, verified visually in a disposable Playwright-screenshotted preview before porting in (see screenshot delivered in chat this round).

**If it doesn't land in real use:** Amber Glass was the other candidate you named — it's a same-shape recolor (different core/bloom/ring/spark hex values only), not a rebuild, so trying it is a small, low-risk change.

### Bonus fix found while answering the ElevenLabs question (§3 below)

**TTS failures were completely silent in the UI.** `useCoachTts.jsx` already tracked a `ttsError` string (e.g. "Spoken replies are not configured yet." when `ELEVENLABS_API_KEY` is unset server-side) — but `CompanionScreen.jsx` never rendered it anywhere. If voice replies were on but misconfigured, a reply would just never get spoken with zero visible sign why. Now rendered next to the existing chat-error line. Same "don't silently fail" principle as the mic fix above, just a different subsystem.

---

## 2. Files touched this round

| File | What | Risk |
|---|---|---|
| `src/hooks/useSpeechInput.jsx` | `shouldPrimeMicBeforeWebSpeech()` now excludes all iOS, not just literal Safari (the actual mic fix). Added a 4s start-watchdog + `speechStartWatchdogMessage()` for any other silent-start case. | Medium — touches the real mic-start path for every platform, but the change is narrowly scoped (one added exclusion + a bounded, cleanly-cleared timeout) and every existing platform's behavior is unchanged. |
| `src/main.jsx` | Added the stale-PWA version-check banner (visibilitychange/pageshow → no-store fetch of index.html → compare bundle path → manual-refresh banner). | Low — purely additive, no-ops in dev, never auto-reloads. |
| `api/memory-rollover.js` | Tightened the `structured.narrative` prompt instruction for brevity/casualness with your example baked in. | Low — prompt-only change to a real nightly job, not protected. |
| `src/screens/CompanionScreen.jsx` | Greeting: smaller/calmer typography, casual time-of-day words. Modes: `desc` field, transient selection caption, rewritten per-mode steer text, hardened shared baseline. Ember: Moonstone palette swap. Rendered the previously-silent `coachTts.ttsError`. | Medium — large diff by line count, but each piece (typography, prompt steer text, color values, one new error render) is independently low-risk; no changes to send/stream logic. |

**Nothing implemented for anything beyond the 7 numbered items requested.** No new features.

**Still fully untouched:** `api/chat.js`, `src/coach/AICoach.jsx`, `src/coach/CoachApp.jsx`, `api/coach-summary.js`, `api/coach-intro.js`, `src/App.jsx`, `src/hooks/useCoachTts.jsx`, `src/screens/OnboardingScreen.jsx`, `public/sw.js`, `vercel.json`, the real `supabase/migrations/` directory, all Stripe/billing files, `package.json`.

---

## 3. ElevenLabs — is it actually connected, and what to do if not

**I cannot check your Vercel project's environment variables from this sandbox** — there's no access to your Vercel dashboard or its env var store from here, so I genuinely don't know whether `ELEVENLABS_API_KEY` is set for this preview deployment. Here's exactly how to check and fix it yourself:

1. **Go to** vercel.com → your Forged project → **Settings → Environment Variables**.
2. **Look for `ELEVENLABS_API_KEY`.** If it's missing entirely, voice replies are not connected — `/api/tts` returns a 503 with "Spoken replies are not configured yet." (this is a deliberate fail-safe, not a crash).
3. **Check which environments it's scoped to.** Vercel env vars are scoped to Production / Preview / Development independently — a key set only for "Production" will NOT be available to this preview branch's deployments. Make sure Preview is checked (or "All Environments").
4. **Get a key:** elevenlabs.io → your account → Profile → API Keys. Any paid or free-tier key works; the app uses their `eleven_flash_v2_5` model specifically (fast/cheap, not their highest-quality model).
5. **Optional:** `ELEVENLABS_DEFAULT_VOICE_ID` — if unset, falls back to a default ElevenLabs stock voice ID already hardcoded in `api/tts.js`. Only needed if you want a specific voice.
6. **After adding/changing env vars, redeploy** — Vercel doesn't hot-reload serverless function env vars into already-running deployments.

**Separately, even with the key configured, voice replies won't play unless BOTH of these are true for the account you're testing with:**
- The account's `profiles.is_pro` is `true` (voice replies are a Pro-only feature in the existing code, unrelated to this branch).
- The in-app "voice replies" toggle is turned on (Profile screen → voice settings) — it defaults to **off** for every account.

If you turn both on and it still doesn't speak, the newly-added `ttsError` line in the Companion screen (see §1, bonus fix) should now actually tell you why instead of failing silently.

---

## 4. Decisions made this round (and why)

**Fixed the iOS Chrome mic bug at the actual WebKit-constraint root cause, not with a retry/fallback wrapper.** Could have added a "if it fails, try again automatically" loop. Rejected that — the async-gap-breaks-the-gesture problem is deterministic on WebKit, so retrying the same broken sequence would just fail the same way every time. Fixed the actual branching logic that misclassified iOS Chrome as needing desktop Chromium's priming step.

**Added a watchdog in addition to the root-cause fix, not instead of it.** The explicit instruction was "don't silently fail" as a general principle, not just for the one reported case. A 4-second no-onstart/no-onerror watchdog is a cheap, generic backstop for whatever the *next* undiscovered silent-failure mode turns out to be, on any platform — not just iOS Chrome.

**Diagnosed the PWA issue as "not a caching bug" rather than reflexively adding a service-worker cache-clearing routine.** Reading `vercel.json` and `sw.js` first showed the server-side caching story is already correct and the SW does no caching at all — adding cache-clearing logic to a service worker with no cache would have been solving a problem that doesn't exist while missing the real one (iOS process suspension). The version-check banner targets the actual mechanism.

**Rewrote the modes' steering text around explicit failure modes, not just longer descriptions of the desired behavior.** "Be terse" is weaker than "do not ask a clarifying question unless the next action is genuinely impossible to name without one" — naming the specific thing NOT to do, per mode, is more concrete for a model to actually follow than a general vibe description.

**Was explicit in this doc about prompt engineering's real limits on "stop asking questions."** Could have just said "fixed" and left it there. Chose to flag that this is inherently probabilistic, not a hard guarantee, and named the actual mechanism-level fix (a trailing-question-mark check/regeneration) that would exist if prompt tuning alone doesn't fully close it — so the next round of feedback (if this still shows up) has a concrete next lever already identified instead of another round of "make the prompt even more forceful."

**Implemented Moonstone rather than asking for confirmation first.** You'd already narrowed it to "likely Moonstone or Amber Glass" and said "pick... and implement one cleaner version" — that's a decision delegated to me, not still open. Verified visually before committing, same as every other visual change this branch.

---

## 5. Risks / open items

- **The iOS Chrome mic fix is unverified on a real iPhone** — no iOS device in this sandbox. The root-cause diagnosis (synchronous-gesture requirement broken by an awaited permission prompt) is a well-documented WebKit constraint, not a guess, but "should work" isn't "confirmed."
- **The stale-PWA banner is unverified against a real home-screen install** — needs an actual new deploy to go out while the app is installed and backgrounded to trigger meaningfully.
- **Greeting content is unverified against a real model call** — no Anthropic credentials in this sandbox.
- **Conversation mode steering is unverified against real replies**, and — per §1 — is inherently probabilistic rather than a hard guarantee even once tested.
- **ElevenLabs connection status is genuinely unknown from this sandbox** — see §3, this requires you to check the Vercel dashboard directly.
- **Two chat surfaces (Ember + old modal drawer) are still live simultaneously** — unchanged open item, still not resolved, now five sessions running.
- Everything else from prior sessions (embedding column unpopulated, `conversation_messages` not built, migrations already applied and verified) still stands unchanged.

---

## 6. How to test safely

1. **iOS Chrome mic:** open the preview link in Chrome on an iPhone, tap the Ember, grant mic permission — confirm it actually starts listening (ring/state changes, words appear) instead of nothing happening.
2. **Stale PWA:** after this branch's next deploy goes out, reopen the already-installed home-screen app — confirm the "newer version ready" banner appears within ~30s of foregrounding, and that Refresh actually updates it.
3. **Greeting:** after a real day rolls over, check the greeting reads as one calm, normal-sized line — not a giant headline, not a report.
4. **Modes:** open the mode dropdown — confirm each one shows a one-line description. Pick one — confirm a caption briefly appears near the pill. Send the same real message in a couple of different modes — confirm the replies are genuinely different in shape (Think noticeably longer, Decide stating an opinion, etc.) and check whether replies still default to ending in a question.
5. **Ember:** confirm it now reads as pale/cool/calm (Moonstone) rather than orange/gold.
6. **ElevenLabs:** follow §3 — check the Vercel env var, confirm `is_pro` + the voice-replies toggle are both on, and if a voice reply still doesn't play, check whether the new `ttsError` text now explains why.

---

## 7. Continuing in Cursor — orientation for a cold start

If you're picking this branch up in Cursor without this conversation's context: this file (§0-§6 above) is the full state of the world. In short — this is `CompanionScreen.jsx` (the new home screen, an Ember presence + natural greeting + a floating conversation carousel, not a chat log) sitting on top of the existing Forged backend (Supabase auth/DB, `/api/chat` streaming, `/api/memory-rollover` nightly extraction, `/api/tts` for voice). The old Forged UI (Today/Arc/Social/Hub screens, the floating CoachBar) still exists and still works — it's reachable via the bottom nav — but the Companion screen is now the default landing screen and the thing actively being iterated on. `src/coach/AICoach.jsx` is protected (see `.claude/hooks/protected-paths.txt`) and has several functions exported specifically so `CompanionScreen.jsx` could reuse its tuned personality/prompt logic without forking it — don't fork that file, extend the export list further if you need something else from it. Everything else touched this session (`useSpeechInput.jsx`, `main.jsx`, `memory-rollover.js`) is a normal, editable file.

---

## 8. Next 3 steps

1. **Hand-test this round** (§6) — especially the iOS Chrome mic fix and the PWA banner, since those are the two most "will this actually work in the real world" items and the ones this sandbox has zero way to verify directly.
2. **Retire the old CoachBar/modal drawer.** Overdue — flagged five sessions running.
3. **Stage `conversation_messages`** — the real structural fix for context-aware XP/facts judgment, and a likely prerequisite for the mode-steering work above to have richer material to work with (a full turn history to reason over, not just the current message).
