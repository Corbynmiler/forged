# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7`
**Status:** preview/experimental only. `main` (production) has not been touched, merged into, or modified at any point on this branch.
**Last updated:** 2026-07-05 — full rewrite for a cold handoff (e.g. to Cursor). Consolidates everything shipped across many rounds into one current-state document instead of a round-by-round log. If you're picking this branch up without prior context, read this file top to bottom before touching code.

---

## 0. Product direction — what this branch is trying to become

Forged today (on `main`) is a habit-tracker app with an AI coach bolted on. This branch is not "Forged with AI added" — it's a bet that the real product hiding inside Forged is a **memory-first voice companion**: something you'd open instead of ChatGPT to think out loud, plan, decide, or reflect on your day, specifically *because* it remembers you — not because it's a better habit tracker. The working benchmark for every decision on this branch is: **"would the user open this instead of ChatGPT for life updates, reflection, planning, and thinking?"**

The practical consequence: memory is the product, conversation is the interface. The old habit/Arc/streak/XP machinery isn't being deleted, but it's being demoted — from "the thing you manage" to "a data source the companion reads and writes on your behalf in the background." See §7 for the phased plan this implies.

This branch is being built for one specific user first (not generic users yet) — expect opinionated, personal defaults rather than configurable-for-everyone choices.

---

## 1. ⚠️ Shared Supabase database — read this before touching schema

**Preview and `main` (production) currently share one Supabase project** (ref `apdmvbzfjuvxworjepze`) — same database, same tables, same users. Only the *deployed application code* differs between the two (they're separate Vercel deployments built from separate branches). This means:

- Any schema change (new table, new column) is visible to **both** deployments immediately, whether or not `main`'s code ever references it.
- `main`'s deployed frontend/API code has zero references to anything added on this branch (new tables/columns), so adding schema doesn't change `main`'s *behavior* — but it does still change the *shared database*, permanently, for real production data.
- **Every schema change on this branch must be additive-only** (new tables/columns, never drop/rename/alter existing ones) and **staged for human review before being applied** — see §8 for exactly how.
- **Never** modify `supabase/migrations/` directly — it's a protected path (see `.claude/hooks/protected-paths.txt`). Real, reviewed schema changes get staged in `supabase/pending_migrations/` instead, and a human applies them manually (SQL editor or CLI) after reviewing.
- **Never** run a destructive migration (drop/rename on anything with real data) without explicit, explained, human-approved sign-off first.

---

## 2. What has shipped (current state, by area)

### Companion screen ("Talk" tab) — the new home surface
Replaces the old auto-opened coach drawer as the app's default landing screen. Lives in `src/screens/CompanionScreen.jsx`.
- **The Ember** — a calm, living presence (not a mic icon) that is the mic control itself (tap to talk, tap to stop = send). Currently a **Blue** palette (soft sky-blue core cooling to muted steel-blue) — went through Moonstone (lavender) and the original warm-orange "fireball" before landing here. Shape is a deliberately clean, undistorted circle (an earlier SVG-turbulence version read as "lumpy"/accidental). Idle state dims toward the background (~half opacity); listening/thinking/speaking are full brightness and visually distinct from each other.
- **The greeting** — composed client-side (zero extra LLM cost) from `daily_summaries.structured.narrative`, a short, casual, specific 1-2 sentence recap written by the nightly extraction job specifically for this purpose (not a bulleted list — that was an earlier, rejected version). Rendered at normal body-text size/font, not a display-serif headline (an earlier version read as "a dramatic poster").
- **The conversation carousel** — the current exchange only, floating text (no chat bubbles), fixed-height scrollable region with a top mask-fade. Replaced an earlier "single pair, then a separate full-page History view" pattern.
- **Live transcript reliability** — fixed two real bugs: the transcript used to disappear during a natural mid-sentence pause (was gated on `speech.interim`, which the browser clears on every finalized phrase including pauses — now shows accumulated dictation regardless), and it used to get replaced by a "thinking" indicator instead of staying visible above it.
- **Conversation modes** — Just chat / Build / Think / Decide / Reflect (`SITUATIONS` array in `CompanionScreen.jsx`). Confirmed, by tracing the real code path, that these are genuinely injected into the model's system prompt every request (not decorative) — see §5 for the exact path. Each mode's steer text has been rewritten twice to sharpen the behavioral difference between modes (not just tone): Build is terse/direct/names your actual projects (Forged, CloseCraft, sales, websites); Think explicitly requires long-form depth (a short reply is a stated failure unless you ask for brevity); Decide must state a real recommendation before tradeoffs; Reflect targets emotional tone and durable patterns explicitly. A shared baseline instruction (`RESPONSE_STYLE_STEER`) tells the model, as a hard constraint, not to default to ending replies with a question. A persistent one-line description of the current mode now shows under the Ember's status text at all times (not just a transient flash on selection).

### Memory architecture (Phase 2a — in progress)
The bet: real long-term memory, not fake/hallucinated callbacks.
- **`conversation_messages`** — a new table (raw per-turn transcript, one row per user message and one per assistant reply, written live). **Applied and confirmed working** — real rows verified via direct SQL query after using the Companion screen. Written from `CompanionScreen.jsx` via `persistConversationMessage()`, fire-and-forget, fail-soft.
- **`api/memory-rollover.js`** (the nightly extraction job) now reads from `conversation_messages` and folds real conversation content into what it feeds the model, alongside the existing habit-log/journal digest — capped at `CONVERSATION_DIGEST_MAX_CHARS_PER_DAY` (default 4000 chars/day, env-overridable). This is the actual mechanism behind "judge progress from context, not checklists" — previously the job only ever saw curated notes and habit ticks, never what you actually said. Bundled correctness fix: a day with real conversation but zero habit logs used to be silently skipped entirely (never summarized) — that gap is closed.
- **Still missing — the real blocker for genuine cross-time recall:** embeddings + similarity search over `memory_facts`. Right now the model only ever sees a small rolling summary + last few days — nothing lets it reach back to "you changed your opinion on this in April" from something real. Vendor undecided (Voyage AI API vs. a Supabase Edge Function running `gte-small`). See §7.

### AI-judged XP (observational only, not live-facing yet)
Nightly job judges each day 0-50 based on genuine effort/follow-through (now informed by real conversation, see above), writes to `daily_summaries.xp_awarded`/`xp_reason` and an audit table `xp_events`. **Deliberately not wired into `profiles.xp`** (the real, user-facing lifetime total, which still only updates via the existing deterministic per-habit-tap system in `src/arcProgress.js`) — these two systems are on a collision course by design and a human needs to decide how they reconcile (see §6, "the XP collision").

### Voice / TTS (ElevenLabs) — wired, investigated this round, **not yet enabled**
Full technical writeup in §5. Short version: the code is complete and structurally correct end-to-end (client → `/api/tts` → ElevenLabs → streamed audio → Web-Audio-reactive Ember), but **`ELEVENLABS_API_KEY` has not been confirmed set in Vercel**, and nothing about this path has ever been tested against a real key or a real login session. The UX for turning it on currently lives only in the old Profile screen — a redesign moving voice controls onto the Talk screen itself is proposed (not built) in §9.

### Onboarding copy
Reworded the notifications screen ("Protect the Arc" → warmer, companion-voiced copy) and the final "you're in" screen's pitch, to stop reading like the old habit-tracker's marketing copy. The underlying Arc-creation flow/wizard itself was not restructured — copy-only pass on the specific phrases flagged as jarring.

### Reliability fixes
- **iOS Chrome mic bug** — tapping the mic, granting permission, then nothing happening. Root cause: iOS Chrome/Edge/Firefox were wrongly routed through a desktop-Chromium-only "prime the mic via `getUserMedia` first" step, whose `await` breaks the synchronous user-gesture requirement WebKit needs for `SpeechRecognition.start()` on iOS. Fixed in `src/hooks/useSpeechInput.jsx`; also added a generic 4-second start-watchdog so any *other* silent-start failure surfaces a message instead of doing nothing.
- **Stale PWA on iPhone home screen** — diagnosed as iOS keeping the installed web app's process alive across icon taps rather than reloading (not a caching bug — headers/service-worker were already correct). Added a version-check banner in `src/main.jsx` that offers a manual refresh when it detects a newer deploy, without ever auto-reloading mid-conversation.
- **Transcription word-loss after a 1-2s pause** — investigated, **not fixed**. On desktop, `continuous=true` is already active (confirmed by reading the code), which rules out a JS-level session restart — the likely cause is a native browser-engine artifact below anything the code can observe. On iOS/Android, `continuous=false` is an intentional prior workaround for a *worse*, previously-discovered bug, so it wasn't flipped blind without a real device to verify against. Real fix, if ever needed: bypass the browser's native speech recognition entirely (custom audio capture + a real streaming ASR backend) — a genuine infrastructure project, not attempted here.

---

## 3. Verified vs. unverified — be honest about this distinction

This entire branch has been built in a sandboxed environment with **no real login session, no ElevenLabs credentials, no Anthropic credentials, and no physical iOS device**. Everything below marked "unverified" has been reasoned through and code-reviewed carefully, but never actually run for real. Don't treat "shipped" as "confirmed working."

**Verified (real testing happened):**
- `conversation_messages` migration applied; real rows confirmed via direct SQL query after using the Companion screen.
- `memory_facts` / `xp_events` schema applied (confirmed via `list_tables` earlier in this branch's history).
- Build passes (`npm run build`) after every change on this branch.
- Conversation-mode injection path is real (traced in code — `SITUATIONS[].steer` → `system_stable` → `buildSystemBlocks()` in `api/chat.js` → sent to Claude).

**Unverified (reasoned/tested in isolation only, never run live):**
- iOS Chrome mic fix — no iPhone in this sandbox.
- Stale-PWA banner — needs a real home-screen install across a real new deploy.
- The Blue Ember and all prior Ember iterations — confirmed only via disposable rendered previews (screenshotted with Playwright, never inside a real authenticated session).
- Greeting quality (`structured.narrative`) and XP judgment quality from real conversation — no Anthropic credentials to run a real rollover against.
- Whether the 5 conversation modes actually *feel* distinct in real replies — the wiring is confirmed real, but extensive live back-and-forth testing across all 5 modes hasn't happened.
- Voice replies end-to-end — no ElevenLabs key, no real login session tested.
- The transcription pause bug — diagnosed via code reading only.

---

## 4. Current blockers

1. **ElevenLabs API key not confirmed set in Vercel.** Blocks voice replies entirely. See §6 for the exact steps.
2. **Embeddings vendor decision** (Voyage AI vs. Supabase Edge Function/`gte-small`) — blocks real cross-time memory retrieval. Sitting unresolved for several rounds.
3. **The XP collision** — deterministic per-tap XP (`profiles.xp`, live) vs. AI-judged observational XP (`daily_summaries.xp_awarded`, not live-facing) need a human decision: merge them, let one replace the other, or deliberately keep both (weakest option). Not the AI's call.
4. **The old CoachBar / modal `AICoach` drawer still exists**, duplicating the Companion screen — flagged as overdue for seven-plus rounds now, never actioned.

---

## 5. ElevenLabs / voice — exact current state

- **Fully wired, end to end, in code:** `api/tts.js` (server: auth, Pro-gating, monthly character cap, calls ElevenLabs `eleven_flash_v2_5`, streams `audio/mpeg` back) ↔ `src/hooks/useCoachTts.jsx` (client: chunks replies into sentences, plays back-to-back, exposes the `<audio>` element for the Ember's audio-reactive speaking animation).
- **Schema already applied** (this one is NOT a preview-only pending migration — it's a normal, already-merged migration: `supabase/migrations/20260611080100_tts_usage_and_voice_prefs.sql`). Added `profiles.voice_replies_enabled`, `profiles.coach_voice_id`, and the `tts_usage` table (per-user-per-month character counter).
- **Cost is bounded in code**, not just by ElevenLabs' own billing: `TTS_MONTHLY_CHAR_LIMIT` in `api/tts.js` (default 50,000 chars/month/user, env-overridable via `TTS_MONTHLY_CHAR_LIMIT`) hard-stops with a 429 once hit. At ElevenLabs' current Flash v2.5 rate (~$0.05/1,000 chars), that's a ~$2.50/month ceiling per user regardless of usage. **Known inconsistency:** this same constant is duplicated in `src/theme.js` (for display text only) and is not automatically kept in sync — if the env var is ever raised, that file needs a matching manual update or the displayed "X remaining" text will be quietly wrong.
- **4 premade ElevenLabs voices** configured: Adam, Sarah, Daniel, Rachel (`COACH_VOICE_OPTIONS` in `src/theme.js`), selectable today only via the old Profile screen.
- **What's missing:** confirmation that `ELEVENLABS_API_KEY` is actually set in Vercel (cannot be checked from this sandbox — no dashboard access), and any real test of the flow.
- **UX gap, proposed but not built:** voice on/off and voice selection currently only live on the Profile screen, buried away from the Talk screen where they're actually used. §9 proposes moving this onto the Talk screen directly. Not implemented this round.

---

## 6. Next recommended phase

In priority order, with reasoning:

1. **Build the Talk-screen voice controls** (design proposed in §9 of this doc) — the most immediately actionable, well-scoped next build item, and it directly serves this branch's core thesis (voice is the product, not a buried settings toggle). Do this once `ELEVENLABS_API_KEY` is confirmed set (§ "ElevenLabs setup checklist" below) so it can actually be tested as it's built.
2. **Retire the old CoachBar/modal drawer (Phase 2b)** — doesn't depend on anything else, been overdue longest, and having two chat surfaces is a real, growing inconsistency the longer it's left.
3. **Embeddings vendor decision + wire up retrieval (Phase 2a, remaining piece)** — the actual unlock for genuine cross-time memory ("you changed your opinion since April"). Bigger and more architecturally significant than 1-2; do it once those are settled.
4. **Phase 2c/2d/2e** (reframe Today, resolve the XP collision, rename Coach→Companion) — each depends on the above being further along; see the phased plan in §7.

---

## 7. The full phased plan (Phase 2), for context

| Step | What | Status |
|---|---|---|
| 2a. Memory architecture | `conversation_messages` → extraction → embeddings/retrieval | Write + read sides done. Embeddings/retrieval not started — the real blocker. |
| 2b. Retire old CoachBar/modal drawer | One true conversation surface | Not started. |
| 2c. Reframe Today around the companion | Today becomes a quiet log, not a checklist | Not started — depends on 2a. |
| 2d. Resolve the XP collision | See blocker #3 above | Not started — needs a human decision. |
| 2e. Rename Coach → Companion | `coachMemory`/`coachName`/`AICoach.jsx` etc. — once 2a-2d make it true, not cosmetic | Not started, intentionally last. |

Full original reasoning for why each step blocks the next, and the full memory-architecture diagram, are preserved in this branch's git history (this file, prior revisions) if a deeper rationale is ever needed — not repeated here to keep this document focused for a cold read.

---

## 8. How schema changes get made on this branch (process)

1. Write the migration SQL to `supabase/pending_migrations/<timestamp>_<name>.sql` — never `supabase/migrations/` directly.
2. Explain plainly, before the human applies anything: what it changes, whether it affects shared/production data, whether it's additive-only, exact rollback SQL, and a pre/post-apply checklist.
3. The human reviews and applies it manually (Supabase SQL editor, or moving the file into `supabase/migrations/` with a fresh timestamp and running it through the normal process) — never applied by an agent directly.
4. **Note on current state:** all three schema changes staged so far on this branch (`memory_facts`+`daily_summaries` extensions, `xp_events`, `conversation_messages`) have already been reviewed and applied by the human. Their `.sql` files are still sitting in `supabase/pending_migrations/` with header comments that say "NOT YET APPLIED" — **that comment is now stale/inaccurate for all three.** This wasn't corrected this round (a documentation-only fix bundled into a "no more code this round" instruction) — trust this handoff document's status over those files' internal comments until they're corrected.

---

## 9. Proposed: Talk-screen voice controls (design only — not built)

**The ask:** move voice on/off and voice selection onto the Talk screen itself (mirroring the existing top-right conversation-mode pill with a top-left voice pill), so using voice never requires a trip to the Profile screen.

**Proposed interaction** (refines the requested layout, explained below):

- **Top-left pill**, visually matching the existing top-right situation pill exactly (same border/background/font treatment, mirrored position). Shows a small speaker icon + the current voice's name (e.g. "🔊 Sarah"), or a muted-speaker icon + "Muted" when off.
- **Tapping the main body of the pill instantly toggles mute/unmute** — no dropdown, no navigation. This is the fast, one-tap control you asked for, for the common case of "shut it up right now."
- **A small chevron at the end of the pill** (matching the existing situation pill's "▾") opens a short dropdown listing the 4 voices. **Tapping any voice both selects it and enables spoken replies**, per your requirement — this is a deliberate, single action, not two.
- **Why split into two zones (tap vs. chevron) instead of one:** mute/unmute is something you'll want instantly and often, mid-conversation, without hunting through a menu; changing *which* voice is much rarer. Splitting a fast, frequent action from a rare, deliberate one is a standard pattern (a "split button") and avoids overloading a single tap with two different meanings depending on context. If you'd rather have one single tap always open the dropdown (matching the situation pill's own behavior exactly, with "Mute" as just another item in that list), that's a simpler, more consistent alternative — slightly slower to mute (two taps instead of one) in exchange for one less interaction pattern to learn. Worth a quick preference call before building.
- **Non-Pro accounts:** show the same pill in a quiet locked state (small lock glyph) that opens the upgrade flow when tapped, rather than hiding it — keeps the top-of-screen layout stable and still advertises the feature, matching the existing `locked`/`onLockedClick` pattern already used elsewhere in this codebase (`MicBtn`).
- **The old Profile-screen toggle:** left in place as a secondary/advanced-settings location (both write to the same `profiles.voice_replies_enabled`/`coach_voice_id` fields, so nothing conflicts) rather than removed — removing it is a separate, small decision, not required to satisfy "no requirement to visit Profile just to use voice."

**Not built this round** — this is a spec for the next work session (this branch, or via Cursor) to implement against.

---

## 10. Files that matter (and their role)

| File | Role | Protected? |
|---|---|---|
| `src/screens/CompanionScreen.jsx` | The Talk screen — Ember, greeting, carousel, conversation modes, mic handling, conversation persistence. The main surface almost everything in this doc touches. | No |
| `src/hooks/useSpeechInput.jsx` | Speech-to-text (Web Speech API wrapper) — iOS Chrome fix, start-watchdog, dictation merging. | No |
| `src/hooks/useCoachTts.jsx` | Text-to-speech playback — chunking, sequential playback, exposes `<audio>` for the Ember's audio reactivity. | No |
| `api/tts.js` | ElevenLabs server route — auth, Pro-gating, quota, streams audio back. | No |
| `api/memory-rollover.js` | Nightly extraction job — reads habits/journal/conversation, writes `daily_summaries`/`memory_facts`/`xp_events`/`coach_memory`. | No |
| `api/chat.js` | Main coach chat endpoint — receives `system_stable`/`system_volatile` from the client and calls Claude. This is where mode-steering text actually reaches the model. | **Yes** — coach personality/cost invariants. Read carefully; don't edit without explicit sign-off. |
| `src/coach/AICoach.jsx` | Personality/prompt-building logic (`buildCoachSystemPrompts`, day-persistence, quota helpers) — reused by `CompanionScreen.jsx` via exports rather than forked. | **Yes** |
| `src/main.jsx` | App bootstrap — service worker registration, stale-PWA version-check banner. | No |
| `src/App.jsx` | Screen routing/nav, top-level state (`voiceRepliesEnabled`, `coachVoiceId`, `isPro`, `coachMemory`), `daily_summaries` fetch. | No |
| `src/screens/ProfileScreen.jsx` | Existing account/settings screen — current (soon supplemented) voice toggle + picker lives here. | No |
| `src/screens/OnboardingScreen.jsx` | Signup flow — Arc creation wizard, ChatGPT memory import, reworded companion-first copy. | No |
| `src/theme.js` | Design tokens (`T`), `COACH_VOICE_OPTIONS`, `TTS_MONTHLY_CHAR_LIMIT` (display-only duplicate — see §5's known inconsistency). | No |
| `supabase/pending_migrations/*.sql` | Staged schema changes — **all three files present are already applied**, see §8. | No (but treat as reviewed-then-applied-manually, never auto-applied) |
| `supabase/migrations/` | Real, already-merged schema (includes the TTS/voice-prefs migration, applies to both preview and main). | **Yes** — never edit directly |
| `api/coach-summary.js`, `api/coach-intro.js` | Other coach-related endpoints, untouched this branch. | **Yes** |
| `.claude/hooks/protected-paths.txt` | The actual list of protected paths, if in doubt. | — |

---

## 11. How to test what's here today

- **Modes:** open the mode dropdown on Talk, confirm descriptions show; pick different modes and send the same real message in each — Build should be terse/direct, Think noticeably longer/deeper, Decide should state an actual recommendation, Reflect should surface a pattern rather than ask a question.
- **Memory:** have a real conversation, let the day roll over naturally, then `select date, title, structured->>'narrative' as narrative, xp_awarded, xp_reason from public.daily_summaries where user_id = auth.uid() order by date desc limit 3;` — check whether it references something you only said, not logged.
- **Voice (once ElevenLabs is enabled — see checklist below):** turn on spoken replies via Profile (until the Talk-screen redesign in §9 ships), send a message, confirm audio plays and the Ember visibly reacts to it while speaking.
- **iOS Chrome mic / stale PWA:** needs a real iPhone — see §3, both currently unverified.
