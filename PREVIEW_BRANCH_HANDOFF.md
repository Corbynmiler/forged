# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface.
**Last updated:** 2026-07-05 — replaced the mic-icon/chat-bubble presentation with a living "ember" presence and a homepage that never defaults to showing a transcript. Rewrote the nightly extraction prompt for natural phrasing and context-over-checklist judgment.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. Roadmap at a glance

| Milestone | What it does | Status |
|---|---|---|
| **The Ember / living homepage** | Replaces the mic-icon + chat-bubble screen with: a living, breathing ember (not a generic orb — an actual fire metaphor, tied to the name "Forged") that IS the mic control; a natural-language morning greeting composed from real memory; the transcript demoted to a secondary "History" view instead of the default surface | ✅ **Done, this session** |
| Companion home screen (mic-first, situations) | The screen this replaces — shipped previous session | ✅ Superseded by the above, same backend wiring |
| Faster voice replies | Sentence-chunked TTS, streamed/played back-to-back | ✅ Done |
| Memory layer (schema + extraction) | Daily titles, atomic facts, commitments, emotional context | ✅ Done and live — **prompt tightened this session** for natural phrasing + context-over-checklist judgment (see §3) |
| AI-judged XP (observation only) | Nightly 0-50 judgment + reason, stored, not wired to the real total | ✅ Done and live |
| ChatGPT memory import | Onboarding paste-and-review step | ✅ Done and live |
| Retire the old CoachBar / modal drawer | Now a second, redundant way to reach the same conversation | ⛔ **Still not done — see §4** |
| `conversation_messages` (raw transcript, server-side) | Lets the nightly judgment reason over what was actually said, not just curated notes — the deeper fix for "judge from context, not checklists" | ⛔ **Not started — flagged as the next real infrastructure step** |
| Embedding generation + hybrid retrieval | Real semantic search over stored facts | ⛔ Not started — vendor decision + protected-file sign-off |
| Notifications rewrite | Specific-or-silent messages | ⛔ Not started |
| "What I remember" + Arc inference | View/delete facts; AI suggests an Arc from patterns | ⛔ Not started |

---

## 1. This session's pivot — why, and what changed

**The feedback, in one line:** the Companion screen from last session was a good step, but it still felt like "the old app with another chat screen" — a mic icon in a circle, a scrolling bubble list, a pill dropdown. Competent chat-app assembly, not a companion. The instruction: stop optimizing "how do we fit AI into Forged" and start from "how would you build the best AI life companion possible if the backend already existed" — reuse the backend, memory, auth, APIs, ElevenLabs; do not reuse UI just because it exists.

**What actually changed:**

### The Ember replaces the mic-icon-in-a-circle

Not a generic glowing orb (every AI assistant has one of those now — Siri's ripple, Gemini's blob, Copilot's circle). Since the product is called **Forged** — shaped by fire — the companion's presence is a small, living ember: a hot white-to-cream core that cools through gold/orange to a charred red-black edge, wrapped in a soft warm glow, with a handful of tiny sparks drifting up and fading on staggered, non-mechanical timing, and organic (not perfectly circular) edges via an animated SVG turbulence filter. It has four genuinely distinct states, not one animation reused everywhere:
- **idle** — slow, quiet breathing, waiting.
- **listening** — brighter, tighter rhythm; on desktop, real mic amplitude drives extra reactivity on top of the CSS rhythm (reusing the existing volume-meter mechanism already in `useSpeechInput.jsx` via `setRingEl`); mobile (where that meter isn't available — a pre-existing, deliberate limitation in this codebase, not something introduced here) gets the CSS rhythm alone.
- **thinking** — a color-shift/shimmer, not breathing — reads as "processing," not "waiting."
- **speaking** — pulses toward the AI's own voice's real amplitude via a Web Audio analyser attached to the TTS `<audio>` element (best-effort — if the analyser setup fails for any reason, it falls back to a steady rhythmic pulse; this can never affect actual audio playback, only the visualization).

Tapping the ember **is** the mic control — press to talk, press to stop, stopping sends. Exactly the interaction model already validated last session; only the visual representation changed.

**I actually rendered and looked at this before shipping it**, not just code-reviewed it — screenshotted a standalone preview of all four states, judged the first version too smooth/uniform (read as "marble," not "ember"), and iterated the gradient contrast, added the turbulence filter, and added the sparks before committing. Screenshots aren't saved anywhere (they were throwaway verification, not deliverables) but the design decisions they drove are captured above.

### The homepage stops defaulting to a transcript

"I don't think the first thing I should see is a conversation history" and "the transcript itself is not the product" — taken literally. The default view is now: a quiet day-title line, a natural-language greeting, the ember, and (once a conversation has started) only the **current exchange** — the last thing said, ephemeral, replacing itself each turn rather than accumulating in a scrollback list. The full transcript still exists — reachable via a quiet "Today's conversation →" link — but it's a secondary view you pull up on purpose, not the thing that greets you.

### The greeting is composed, not generated fresh, and never shows raw backend text

"Good morning. Yesterday you: • Finished the Companion redesign • Played poker • Postponed the Azir meeting. What's on your mind?" — this is assembled **client-side, at zero extra LLM cost**, from `daily_summaries.structured.wins` (already extracted nightly) plus `title`. The bulleted block is rendered as an actual left-aligned list — not one long center-justified string, which was a real, ugly bug in the first draft I caught by looking at a screenshot before shipping.

The harder fix was upstream: nothing previously stopped the nightly extraction from writing clinical phrasing like "maintained physical baseline" instead of "Played poker." Tightened `api/memory-rollover.js`'s system prompt to explicitly demand natural, specific, human phrasing — "if a sentence could apply to any user on any day, rewrite it" — since `structured.wins` now gets shown verbatim to the user the next morning, not just archived.

### XP judgment now explicitly told to weigh the narrative over the checklist

"If I spend a week building something that was never defined as a proof action, the AI should recognise that... judge progress using context, not checklists." The nightly XP-judgment prompt already read notes/evidence alongside habit logs, but nothing told it to *weight* them that way. Added an explicit instruction: habit logs are one signal among several, not the source of truth; real, sustained, undefined effort deserves real credit even with zero matching habit logs, and ticking boxes on autopilot doesn't automatically outscore someone who showed up honestly on a hard day.

**The deeper version of this fix is still ahead of us** — the rollover job still can't see the actual conversation, only whatever made it into a note via a tool call. See §4.

### The outer app chrome disappears on this screen

No "Forged" wordmark, no dashboard-style header sitting above the ember. The Companion screen owns the whole viewport. Bottom nav stays (still the way to reach Today/Arc/You), everything above it doesn't.

### What did NOT change

The backend wiring is identical to last session: same `buildCoachSystemPrompts`/day-persistence/quota helpers reused from the now-exported `AICoach.jsx`, same `/api/chat` streaming loop, same situations, same free-tier quota, same fail-soft memory writes. This was a presentation-layer rewrite, not a re-plumb.

---

## 2. Files touched this session

| File | What | Risk |
|---|---|---|
| `src/screens/CompanionScreen.jsx` | Substantial rewrite: `Ember` component (replaces the plain mic button), `composeGreeting`/`latestDayTitle` (natural-language homepage text), transcript demoted to a `showHistory` secondary view, live-exchange-only default view, Web Audio analyser wiring for speaking-state reactivity. | Medium — large diff, but additive to the existing send/stream logic, which is untouched. |
| `src/hooks/useCoachTts.jsx` | Exposes `audioElRef` (the already-existing internal audio element) so a consumer can attach a Web Audio analyser. Zero change to playback behavior. | Low |
| `api/memory-rollover.js` | Tightened system prompt: natural-phrasing requirement + explicit "judge from the whole picture, not a checklist" instruction for XP/facts. No schema change, no new LLM call, same cost. | Low-medium — prompt-only change to a real nightly job, not protected. |
| `src/App.jsx` | Extended the `daily_summaries` select to include `structured` (needed for the greeting's wins bullets). Suppressed the outer top-bar chrome entirely when `screen === "companion"`. | Low — additive select, one conditional render change. |

**Still fully untouched:** `api/chat.js`, `src/coach/CoachApp.jsx`, `api/coach-summary.js`, `api/coach-intro.js`, the real `supabase/migrations/` directory, all Stripe/billing files, `package.json`.

---

## 3. Decisions made this session (and why)

**Committed to a specific visual metaphor instead of offering options.** Asked to "explore alternatives" to a mic icon without being told what to build. Chose the ember specifically because "Forged" already has an unused metaphor (shaped by fire) sitting right there, and a generic glowing orb is exactly the AI-assistant cliché worth avoiding right now. This was a judgment call made and committed to, not a menu handed back.

**Verified the visual by actually rendering it, not just describing it.** Built a throwaway standalone preview page (deleted before committing, never part of the repo), screenshotted all four ember states, and judged the first version too smooth/marble-like — then iterated the gradient contrast and added the turbulence filter and sparks based on what the screenshot actually showed, not on how the code read. Caught and fixed a real bug the same way: the greeting's bulleted list was center-justified per line in the first draft, which looks broken/staggered for a list — only visible in a screenshot, not in the code.

**Greeting composed client-side from existing data, not a new LLM call.** The "Yesterday you: • ..." format could have been generated fresh each morning via its own model call. Chose not to — `structured.wins` is already exactly this shape (short human phrases, one per win) once the rollover prompt writes it well, so composing the greeting is a pure client-side string operation. Zero new cost, matches this branch's consistent cost-consciousness.

**Fixed the phrasing problem at the source (the extraction prompt) rather than downstream (a rewrite step at greeting-render time).** Could have kept the extraction prompt as-is and added a "translate to warm language" pass when composing the greeting. Rejected that — it would mean paying for the same translation on every app open, and it treats the symptom (bad phrasing shown to the user) rather than the cause (bad phrasing stored as the permanent record of that day). Fixing the extraction prompt means `daily_summaries` itself is better, for every future consumer of that data, not just this screen.

**Audio-reactive speaking state is best-effort, deliberately fails open.** `createMediaElementSource` can only be called once per audio element, ever, and Web Audio has real cross-browser quirks (especially iOS autoplay/suspend rules). Wrapped the entire analyser setup in a try/catch that falls back to a steady CSS pulse on any failure — this was a deliberate choice to accept "the ember doesn't react to the actual audio waveform on this browser" as a fine outcome, while treating "TTS audio goes silent because I broke the routing" as never acceptable. Untested against real audio in this sandbox (no ElevenLabs credentials here) — first thing to verify by hand.

**The `conversation_messages` table was flagged, not built, this session.** The user's ask ("judge progress using context, not checklists") has a real ceiling with the current data: the rollover job only sees habit logs and whatever made it into a note via a tool call, never the actual conversation. A server-side `conversation_messages` table (staged, not applied — same established pattern as the earlier migrations) is the right next piece of infrastructure for this, but it's a meaningfully separate scope (new table + wiring the Companion screen to persist every turn + updating the rollover job's digest-builder to read from it) from a presentation-layer rewrite, and this session was already large. Prompt-tightening now, real infrastructure next — not done in the same pass so this diff stays reviewable on its own.

---

## 4. What requires human action / what's next

**Immediate — retire the redundant old chat surface.** The floating CoachBar + modal `AICoach` drawer on Today/Arc/Social/Hub still exist and now duplicate the ember. This was already flagged last session as the next step and still hasn't been done — recommend doing it once the ember has actually been used for real and feels right, not rushed.

**Next real infrastructure piece — `conversation_messages`.** Stage (not apply) a new table for the raw per-turn transcript, and wire the Companion screen to persist each turn to it (fail-soft, same pattern as every other new write on this branch). Then extend `api/memory-rollover.js`'s digest-builder to read from it. This is what actually closes the loop on "judge from context, not checklists" — the prompt tightening this session helps with what's already visible to the model, but the raw conversation is the richer signal it still can't see.

**Blocker — choose an embeddings approach** (unblocks real semantic retrieval): Voyage AI (API key) or a Supabase Edge Function (`gte-small`). Neither configured. Also gates the `recall` tool's keyword→vector swap in the protected `api/chat.js`.

**Whenever it comes up:** decide how AI-judged XP should reconcile with the existing deterministic per-tap system before wiring `daily_summaries.xp_awarded` into anything user-visible.

**Smaller polish flagged, not urgent:** there's a brief window between "text starts streaming in" and "TTS starts speaking" where the ember shows idle-breathing rather than a distinct "generating" state — not broken, just a state-machine gap worth tightening later.

---

## 5. Risks / open items

- **The ember and new homepage have not been visually tested end-to-end in the real app** — no real login credentials in this sandbox. Verified by: production build succeeding, a standalone rendered preview of the ember's four states (screenshotted, iterated, then ported into the real component), and a pre-auth boot smoke test of the full app. **Not yet confirmed:** how it actually feels to use — press-to-talk, the live-exchange transition, the History toggle, the greeting with real `structured.wins` data instead of the hand-written example used in preview.
- **Audio-reactive speaking state is unverified against real TTS audio** — no ElevenLabs credentials in this sandbox. Should fail open safely (see §3) but "should" isn't "confirmed." First real test: enable voice replies, get a reply, watch whether the ember's core visibly reacts to the voice or just runs the fallback rhythm — either is an acceptable outcome, silence is not.
- **Rollover prompt changes (natural phrasing, context-over-checklist XP) are unverified against a real model call** — same standing limitation as before, no Anthropic credentials here. First real test: let a real day roll over, then read the actual `structured.wins` phrasing and the `xp_reason` text — do they sound like a person, and does the XP reasoning actually reference narrative effort rather than just habit ticks.
- **Two chat surfaces (ember + old modal drawer) are still live simultaneously** — same open item as last session, not yet resolved.
- Everything else from prior sessions (embedding column unpopulated, `xp_events` no dedup guard but doesn't need one, migrations already applied and verified) still stands unchanged.

---

## 6. How to test safely

- **The ember / homepage:** sign in → confirm you land on a quiet greeting + a warm, breathing ember, not a dashboard or a chat log → tap the ember, say something, tap again to stop → confirm the ember visibly changes state through listening → thinking → (speaking, if voice replies are on) → confirm the live exchange shows just the current turn, not a growing list → confirm "Today's conversation →" reveals the full history and "← Back" returns you to the living view → confirm the situation pill and "Progress →" still work.
- **Greeting quality:** after at least one full day has rolled over for a test account, reopen the app and read the actual greeting text — does it sound like something a person would say, referencing real things from yesterday, not generic/clinical phrasing.
- **Everything else** (memory/XP data, ChatGPT import) — test steps unchanged from prior sessions, still valid.

---

## 7. Next recommended step

Test the ember and homepage by hand first — this is the highest-visibility, least-verified change on the branch and the one the last two rounds of feedback were specifically about. After that: retire the old CoachBar/modal drawer, then stage `conversation_messages` as the real fix for context-based judgment.
