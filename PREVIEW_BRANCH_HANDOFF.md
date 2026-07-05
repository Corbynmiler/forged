# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7`
**Status:** preview/experimental only. `main` (production) has not been touched, merged into, or modified at any point on this branch.
**Last updated:** 2026-07-05 — two separate, real problems found and fixed this round, from actual hands-on feedback plus screenshots:

1. **Audio was still silent even after the concurrency fix, with no error shown at all** — a genuinely different bug from every previous one this session, and probably the actual root cause behind "no audio" the whole time. `CompanionScreen.jsx`'s Web Audio analyser setup (the thing that makes the Ember visually react to the AI's voice) creates an `AudioContext` and reroutes the `<audio>` element's entire output through it via `createMediaElementSource()`. New `AudioContext`s commonly start `'suspended'` (especially iOS Safari) — and once an element's output is rerouted through a suspended context, **that element is permanently silent from then on**, even though `.play()` still resolves fine and the element still reports "playing." Every previous fix this session (fetch latency, `Content-Length`, concurrency) was real and worth keeping, but none of them could have mattered if this was true underneath the whole time. Fixed by creating/resuming the `AudioContext` as early as possible — synchronously inside the actual tap/send gesture, not only once a reply finishes and TTS playback begins — and re-attempting `.resume()` every time speaking starts. See §5.
2. **The coach's personality is too rigidly fixated on the Arc/proof actions/goals**, even in "Just chat" mode, refusing simple requests ("tell me a joke" → "Not my lane, mate. I'm here to track whether you hit your proof actions...") instead of just engaging like a normal AI assistant. Added an explicit, forceful counter-instruction to the shared response-style steering and hardened "Just chat" specifically to switch that instinct off entirely unless the user brings up goals themselves. **Important limit on this fix, stated plainly:** the underlying fixation almost certainly comes from the base coach personality in the protected `AICoach.jsx`/`buildCoachSystemPrompts` — this fix layers a strong counter-instruction on top of that (in the non-protected `CompanionScreen.jsx`), which should meaningfully help, but can't guarantee it fully overrides a personality trait that's this deliberately, heavily emphasized at the source. If it's still not loose enough after testing, the real fix requires touching the protected file itself, which needs your explicit sign-off, not something to do unilaterally.

**Also earlier this session:** fixed the actual root cause of "cuts out especially at full stops" (staggered chunk prefetching gave each next sentence too little lead time), then fixed a regression that first fix introduced (exceeding ElevenLabs' concurrency limit by firing every chunk at once), then fixed a separate regression from the round before that (a missing `Content-Length` header that briefly broke audio outright). All still in place; see §5 for the full sequence.

**Prior note on process, still worth keeping in mind:** an earlier attempt at the Talk-screen voice pill (via Cursor) reported a commit hash that was verified, directly against the remote repository, to not exist on any branch — nothing had actually reached GitHub, which is why it never appeared live. That work was redone from scratch instead of debugged, since there was nothing on the remote to inspect. If a tool reports a commit/milestone as complete, verify it landed on `origin` (`git log origin/<branch>`) before trusting the report or building further on top of it.

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
- **Voice replies work end-to-end** — confirmed by real use: ElevenLabs key set, audio played, Ember reacted. First genuinely live-tested subsystem on this branch. Real feedback from that test (robotic voice, slow pace, mid-reply cutouts, human names, ~3s delay) drove this round's fixes — see §5.

**Unverified (reasoned/tested in isolation only, never run live):**
- iOS Chrome mic fix — no iPhone in this sandbox.
- Stale-PWA banner — needs a real home-screen install across a real new deploy.
- The Blue Ember and all prior Ember iterations — confirmed only via disposable rendered previews (screenshotted with Playwright, never inside a real authenticated session).
- Greeting quality (`structured.narrative`) and XP judgment quality from real conversation — no Anthropic credentials to run a real rollover against.
- Whether the 5 conversation modes actually *feel* distinct in real replies — the wiring is confirmed real, but extensive live back-and-forth testing across all 5 modes hasn't happened.
- **This round's voice fixes specifically** — the latency fix, the cutting-out fix, the speed bump, and the "George" swap are all reasoned from code and a real API doc lookup, not re-confirmed by ear in this sandbox. Needs a real listen to confirm they actually landed.
- The transcription pause bug — diagnosed via code reading only.

---

## 4. Current blockers

1. **ElevenLabs API key not confirmed set in Vercel.** Blocks voice replies entirely. See §6 for the exact steps.
2. **Embeddings vendor decision** (Voyage AI vs. Supabase Edge Function/`gte-small`) — blocks real cross-time memory retrieval. Sitting unresolved for several rounds.
3. **The XP collision** — deterministic per-tap XP (`profiles.xp`, live) vs. AI-judged observational XP (`daily_summaries.xp_awarded`, not live-facing) need a human decision: merge them, let one replace the other, or deliberately keep both (weakest option). Not the AI's call.
4. **The old CoachBar / modal `AICoach` drawer still exists**, duplicating the Companion screen — flagged as overdue for seven-plus rounds now, never actioned.

---

## 5. ElevenLabs / voice — exact current state

**Real hands-on testing happened across several rounds now — each round of feedback found a genuinely different bug, not the same one persisting.** Worth reading the sequence below in order; "confirmed working" earlier in this document turned out to be premature more than once.

- **Voice names:** dropped human names (Adam/Sarah/Daniel/Rachel) from `COACH_VOICE_OPTIONS` in `src/theme.js` — the picker now shows descriptive labels (Warm/Calm/Measured/Grounded) instead, per direct request not to have human names.
- **Adam replaced:** reported as "sounds like a robot." Swapped its underlying ElevenLabs voice ID for "George," one of ElevenLabs' own default-library voices (documented as a warm British male) — **unverified by ear in this sandbox** (no audio playback here), worth confirming it's actually an improvement once you can listen, not just different. `DEFAULT_VOICE_ID` in `api/tts.js` updated to match (it's the fallback used if `voice_replies_enabled` is on but no specific voice was ever picked).
- **Voice speed:** added `voice_settings.speed` (ElevenLabs' documented range is 0.7-1.2, default 1.0) to the API request in `api/tts.js`, set to `1.08` — a modest speedup rather than an aggressive one, since extreme values start audibly degrading quality per ElevenLabs' own docs. Env-overridable via `ELEVENLABS_VOICE_SPEED` if it needs tuning after listening.
- **Fixed a real ~3 second latency bug:** `useCoachTts.jsx` was calling `supabase.auth.getSession()` fresh on *every single sentence chunk* instead of once per reply — a needless async round-trip sitting directly in the critical path of the very first, most latency-sensitive chunk. Now fetched once per `speak()` call and reused. Also parallelized two Supabase reads in `api/tts.js` (profile + usage lookup) that didn't depend on each other but were running sequentially.
- **Round 1 theory of "cutting out" (mid-reply stream truncation) — real, but probably not the dominant cause:** `api/tts.js` used to relay ElevenLabs' audio stream to the client as bytes arrived, which meant a network hiccup mid-transfer could silently truncate a reply with no error shown. Fixed by having the server fully buffer ElevenLabs' response first, so a failed/incomplete upstream response gets caught and turned into a real error instead. This introduced its own regression (missing `Content-Length` broke audio outright — fixed, see the note at the top of this document) but the underlying reliability improvement is real and stayed.
- **Round 2, the actual dominant cause — inter-chunk gaps, found after "cuts out especially at full stops, doesn't feel continuous" made the pattern clear:** `useCoachTts.jsx` speaks a reply one sentence-chunk at a time, and was prefetching *staggered* — chunk N+1's fetch only started once chunk N's own fetch resolved, racing it against chunk N's playback. That gives chunk N+1 exactly chunk N's playback duration to finish downloading — for a short sentence (well under a second to speak), that's often not enough time for a real network+synthesis round trip, producing an audible gap right at the sentence boundary. This is very likely what both rounds of "cutting out" feedback were actually describing, more than the stream-truncation theory above.
- **Round 2's first attempted fix made it worse — a real lesson in what "fixed" needs to mean here:** fired every chunk's fetch in parallel, immediately, on the theory that more head start is strictly better. It isn't — **ElevenLabs caps concurrent requests per account** (free tier: 2 simultaneous requests; Starter: 3), and firing e.g. 6-8 chunk requests at once blew straight through that limit, so the excess got rejected outright by ElevenLabs (`"Could not generate speech right now"` — no audio at all, worse than the original gap complaint). This shipped, was tested, and confirmed broken before being caught.
- **Round 2, corrected — bounded sliding window of 2 concurrent fetches:** stays safely within even the free tier's limit. Chunk N now starts fetching as soon as chunk N-2's fetch *resolves* (immediately, before chunk N-2 has even started playing) rather than only once chunk N-1's playback is already underway — real improvement over the original staggered bug, without exceeding ElevenLabs' concurrency cap. **Verified the windowing logic itself** with a standalone simulation (mocked variable-latency fetches, confirmed max concurrency never exceeds 2 and chunks still play back in the correct order, across chunk counts from 1 to 8) — this confirms the *scheduling logic* is correct, not that the audio itself sounds gapless, which still needs a real listen.
- **Round 3, an entirely different bug — silent AudioContext, likely the real explanation for "no audio at all" across multiple earlier reports:** `CompanionScreen.jsx`'s Ember audio-reactivity effect creates a Web Audio `AudioContext` and reroutes the TTS `<audio>` element's output through it (`createMediaElementSource`) so the Ember can visually pulse with the AI's actual voice. New `AudioContext`s commonly start in a `'suspended'` state (especially iOS Safari's autoplay/audio policy) — and once an element's output has been rerouted through a suspended context, that element is **permanently silent from that point on**: `.play()` still resolves without error, the element still reports itself as playing, but zero signal reaches the speakers. This had nothing to do with fetching, buffering, or concurrency — every one of those fixes was real and needed, but none of them could have mattered if this was true underneath. Fixed by creating/resuming the `AudioContext` as early as possible: synchronously inside the actual Ember-tap and send-button gestures (`primeEmberAudioContext()`), not only once a reply finishes streaming and TTS playback begins several async hops later — and by re-attempting `.resume()` every time speaking starts, in case a browser suspends an idle context again.
- **Worth knowing, unrelated to any bug:** ElevenLabs' entire default-voice library (all 4 voice IDs currently in use, including the new "George" swap) is documented by ElevenLabs as retiring end of 2026. Worth planning a real voice-ID refresh before then rather than discovering it's broken on the day.
- **If gaps are still audible after all of the above:** the next lever is raising `CONCURRENT_TTS_FETCH_WINDOW` in `useCoachTts.jsx` from 2 to 3 — but only if this ElevenLabs account is confirmed to be on at least the Starter plan (3 concurrent requests), otherwise that would reintroduce the exact regression already fixed once. Confirm the plan tier before touching that constant.
- **Still applies:** `TTS_MONTHLY_CHAR_LIMIT` cost bound (~$2.50/month ceiling per user at 50,000 chars/month default), the `theme.js`/`api/tts.js` duplicate-constant sync risk if that limit is ever raised, and the Talk-screen voice pill (§9) as the way to actually use any of this day to day.
- **Still unverified:** whether audio actually plays now at all (this is the one that matters most — the AudioContext fix is a strong, well-understood diagnosis but every fix in this section has needed a correction so far, so treat "should work" skeptically until confirmed), whether the windowed-prefetch fix closes the sentence-boundary gaps, whether the latency fix meaningfully shortened the delay before speech starts, and whether "George" is genuinely better than "Adam" — all need your ears, not mine.

---

## 5b. Coach personality too rigidly fixated on the Arc/goals — fixed, with an honest limit

**What was reported:** in "Just chat" mode — the most casual, no-agenda mode — asking for a joke got: *"Not my lane, mate. I'm here to track whether you hit your proof actions and call out the patterns — not to make you laugh."* Pushed on it, the model half-loosened up but still tied its own joke back to "proof actions," then explicitly defended the rigidity: *"I'm just not going to default to comedy when you're running a build Arc and we both know what actually matters."* This is a real, structural problem, not a one-off — the model is accurately reflecting a strong, deliberate "accountability coach" identity that's baked into the base personality.

**Where that identity actually lives:** `buildCoachSystemPrompts()` in the protected `src/coach/AICoach.jsx` — not editable without explicit sign-off (see `.claude/hooks/protected-paths.txt`), and not touched this round.

**What was done instead:** strengthened the non-protected steering layer that `CompanionScreen.jsx` already appends on top of that base prompt (`RESPONSE_STYLE_STEER` and the "Just chat" mode's own steer, both in `CompanionScreen.jsx`) with an explicit, forceful counter-instruction: don't reflexively redirect to the Arc/proof actions/habits/goals; only bring them up when genuinely relevant, never as a reflex; if asked for a joke, tell an actual joke; "Just chat" mode specifically switches that redirect instinct off entirely unless the user brings goals up themselves.

**The honest limit, stated plainly:** this is a strong counter-instruction layered on top of the base personality, not a rewrite of the base personality itself. It should meaningfully help — later, more specific instructions generally carry real weight — but there's no guarantee it fully overrides a trait this deliberately and heavily emphasized at the source. If it's still not loose enough after real testing, the actual fix requires editing `AICoach.jsx` directly, which needs your explicit authorization to touch, not something to do unilaterally. Worth naming now rather than implying a prompt patch is guaranteed to fully solve a personality that was clearly built, on purpose, to be this insistent.

---

## 6. Next recommended phase

In priority order, with reasoning:

1. ~~Build the Talk-screen voice controls~~ **Done** — see §9. Needs a real test once `ELEVENLABS_API_KEY` is confirmed set (§5).
2. **Retire the old CoachBar/modal drawer (Phase 2b)** — doesn't depend on anything else, been overdue longest, and having two chat surfaces is a real, growing inconsistency the longer it's left. **This is now the top of the list.**
3. **Embeddings vendor decision + wire up retrieval (Phase 2a, remaining piece)** — the actual unlock for genuine cross-time memory ("you changed your opinion since April"). Bigger and more architecturally significant than 2; do it once that's settled.
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

## 9. Talk-screen voice controls — built

**Status: implemented, committed, and pushed to `origin/claude/forged-ai-companion-redesign-agyjl7`.** (A prior attempt at this via Cursor reported a commit that never actually reached the remote — see the note at the top of this document. This is the real implementation.)

**What it is:** a top-left voice pill on the Talk screen, mirroring the existing top-right conversation-mode pill, split into two zones:
- **Pill body** — tapping it instantly mutes/unmutes spoken replies. If a reply is actively being spoken, muting stops playback immediately (`coachTts.stopSpeaking()`), not just future replies. Shows "🔊 {voice name}" when on, "🔇 Muted" when off.
- **Chevron (▾)** — opens a 4-voice picker (Adam/Sarah/Daniel/Rachel). Selecting any voice both sets it and turns spoken replies on, in one action (per the original requirement — not two separate steps).
- **Non-Pro accounts** see a quiet locked "🔒 Voice" pill in the same spot that opens the upgrade flow when tapped, instead of the pill disappearing — keeps the layout stable and still advertises the feature (matches the existing `locked`/`onLockedClick` pattern used by `MicBtn` elsewhere in this codebase).
- **Opening one top-corner dropdown closes the other** (voice picker and mode picker can't both be open at once).
- **The old Profile-screen toggle is untouched** and still works — both surfaces call the same shared handler (`handleSaveVoicePrefs` in `App.jsx`), writing the same `profiles.voice_replies_enabled`/`coach_voice_id` fields, so neither can leave the other showing stale state.

**Files touched:** `src/screens/CompanionScreen.jsx` (the pill UI, `toggleVoiceMute`, `pickVoice`), `src/App.jsx` (extracted the inline voice-prefs handler that only `ProfileScreen` had into a shared `handleSaveVoicePrefs`, passed to both `ProfileScreen` and `CompanionScreen` — the old `AICoach` modal drawer deliberately was NOT given this prop, since it's slated for retirement in 2b, not further investment).

**Verified:** `npm run build` passes; the pill's visual layout (both open/dropdown and closed/muted states) confirmed via a disposable rendered preview before shipping — reads clean and symmetric with the existing mode pill.

**Not verified (same standing limitation as everything voice-related on this branch):** no ElevenLabs key or real login session in this sandbox, so actual audio playback, the mute-mid-reply behavior, and the picker's real-world feel have not been tested live. First real test: see §5 and §11.

**Interaction question resolved by building, not asking again:** went with the split-button pattern (tap = mute, chevron = picker) as the primary recommendation from the original proposal, since it best serves "one tap to mute/unmute" literally. If it feels wrong in practice, the single-tap-always-opens-dropdown alternative (with "Mute" as just another list item) is a small, contained change to the same component.

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
- **Voice (once ElevenLabs is enabled — see §5):** on the Talk screen as a Pro account, tap the chevron on the top-left pill, pick a voice (pill should update to "🔊 Warm"/"🔊 Calm"/etc — no human names anymore), send a message, confirm audio plays and the Ember visibly reacts while speaking. Tap the pill body mid-reply — audio should stop immediately and the pill should switch to "🔇 Muted". Tap it again — should resume with the same voice still selected. As a non-Pro account, the same spot should show a locked "🔒 Voice" pill that opens the upgrade flow.
- **Voice quality/reliability fixes — specifically judge these against the original complaints:** does audio play *at all* now (the AudioContext fix in §5 is the one most likely to matter here); does the delay between a reply's text finishing and audio starting feel noticeably shorter; does the audio ever still cut out/pause at sentence boundaries; does "Warm" (formerly Adam) sound less robotic; does the overall pace feel slightly quicker without sounding rushed or degraded.
- **Personality looseness (§5b):** in "Just chat" mode specifically, ask for something with nothing to do with goals/habits/the Arc (a joke, a random question, banter) — it should just engage directly, not redirect to tracked progress or explain that "that's not its lane." If it still does, that's the honest limit described in §5b — the base personality itself would need editing, which needs your explicit go-ahead.
- **iOS Chrome mic / stale PWA:** needs a real iPhone — see §3, both currently unverified.
