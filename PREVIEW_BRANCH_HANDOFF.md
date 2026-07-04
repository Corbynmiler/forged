# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** turn Forged from a habit-tracker-with-a-chatbot into a memory-first AI companion where conversation is the front door. Full product design doc: see the artifact linked in chat history, or ask for it to be regenerated.
**Last updated:** 2026-07-04, end of Phase 2.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 1. What has been changed (cumulative, all phases so far)

### Phase 1 — Companion-first landing (shipped)

One change: **the app now opens straight into the AI coach conversation instead of the Today dashboard**, for onboarded, signed-in users, once per session. This is the smallest possible slice of "conversation is the product, not a dashboard" — it uses the existing, unmodified coach panel, so it's low-risk and immediately testable.

- `src/App.jsx`: added a `useEffect` (near the `accountDataReady` state declaration, before any early-return JSX branches, so it's always registered — required for React's rules of hooks) that fires exactly once per app load: once `loading` is false, there's no auth screen showing, account data has loaded, and the user is confirmed onboarded, it calls the **existing, untouched** `openCoachWithMode(null)` function. That function already existed and is what the mic/chat FAB has always called — passing `null` as the mode means it opens the panel without forcing mic permission or text-field focus, so the user lands on the greeting + starter-prompt chips with the mic button ready to tap, not a permission prompt.
- Nothing else changed. `screen` still defaults to `"today"` underneath — closing the coach panel (the × button) lands the user exactly where it always did. Today/Arc/You/Hub/Social are 100% untouched, still one tap away.

**What this does NOT include** (see §4 — deferred, not forgotten):
- No custom "What's on your mind?" screen, no situation selector, no day-title/status chip, no subtle XP indicator on a new home surface. Those need the system-prompt builder to be reusable outside `AICoach.jsx`, which is blocked — see §3.
- No streaming TTS, no pgvector/memory_facts, no AI-judged XP, no conversational onboarding rebuild, no notification rewrite. All still ahead, per the roadmap in §6.

### Phase 2 — Faster, chunked voice replies (shipped)

Goal: make spoken coach replies feel far faster and more conversational, without touching the protected coach files. Two changes, both in files the coach-personality guardrail does **not** cover:

- **`api/tts.js`** — the server used to wait for ElevenLabs to finish synthesizing the *entire* clip, buffer it into one `Buffer`, then send it as a single response. It now relays ElevenLabs' audio stream to the client as bytes arrive (`res.write()` per chunk, `res.end()` when done — the same streaming pattern `api/chat.js` already uses, including the `X-Accel-Buffering: no` header so no intermediate proxy re-buffers it). Auth, Pro-gating, and the monthly character-quota logic are byte-for-byte unchanged.
- **`src/hooks/useCoachTts.jsx`** — `speak(text)` used to make one TTS request for the whole reply and wait for it before any audio played. It now splits the reply into sentence-sized chunks (new exported helper `splitIntoSpeechChunks`), fetches chunk 1, and — while chunk 1 is playing — fetches chunk 2 in the background, and so on, so playback is gapless but starts as soon as the *first sentence* is ready instead of the whole reply. A chunk sequence is cancelled cleanly (in-flight fetches ignored, object URLs revoked) if `stopSpeaking()` is called or a new `speak()` interrupts it. Hitting the monthly quota mid-reply stops the sequence after the first failed chunk instead of retrying every remaining sentence.

**What this does NOT include** (true "starts speaking while Claude is still generating" streaming — see §4): that would require hooking into the SSE parsing loop inside `AICoach.jsx`, which is protected and out of scope per this session's explicit instruction not to touch it. What shipped instead cuts the wait to "first sentence's synthesis + download," which is the largest share of the latency for any multi-sentence reply, without needing that file at all.

The hook's public interface (`speak`, `stopSpeaking`, `primeAudio`, `speaking`, `ttsError`, `clearTtsError`) is 100% unchanged, so `AICoach.jsx` needed zero edits — confirmed by grepping every call site (`coachTts.primeAudio?.()`, `coachTts.speak(finalContent)` — nothing else in the codebase touches this hook).

---

## 2. Files touched

| File | Change | Risk |
|---|---|---|
| `src/App.jsx` | Added one `useRef` + one `useEffect` (~15 lines) near line 320, calling the existing `openCoachWithMode(null)`. No other lines changed. | Low — additive, reuses existing function untouched, hook correctly placed before all early-return branches. |
| `api/tts.js` | Changed the success path from buffer-then-send to stream-then-end. Added a local `catch` around the relay loop so a mid-stream failure can't try to send a second (JSON error) response after headers/status are already committed — this was a real bug caught in review before commit, not shipped broken. | Low-medium — not protected, but it's the real ElevenLabs cost/quota path; the quota check and `tts_usage` accounting logic are untouched, only the response-sending mechanics changed. |
| `src/hooks/useCoachTts.jsx` | Rewrote `speak()` to chunk-and-prefetch instead of one request/one play. Added `splitIntoSpeechChunks` (exported), `fetchChunkAudioUrl`, `playChunkUrl`, and a `sessionRef` counter so overlapping/interrupted `speak()` calls cancel cleanly. Public API unchanged. | Low — not protected, isolated file, only consumer (`AICoach.jsx`) uses the same two functions as before. |

No migrations, no `api/chat.js`/`src/coach/AICoach.jsx` changes, no `package.json` changes.

---

## 3. Decisions made this phase (and why)

**Protected-file wall hit and how it was resolved.** `src/coach/AICoach.jsx`, `api/chat.js`, and `supabase/migrations/**` are locked by a repo guardrail (`.claude/hooks/protected-paths.txt`) specifically to stop agents from touching coach personality, cost invariants, or schema without explicit human sign-off. The original Phase 1 plan needed `buildCoachSystemPrompts` (and a few day-persistence/quota helpers) exported from `AICoach.jsx` so a new `CompanionScreen.jsx` could reuse the exact same system prompt instead of forking coach personality into a second copy. The user approved that narrow, additive export — but the session's own auto-mode safety classifier independently blocked setting the `FORGED_OVERRIDE_PROTECTED` env var, on the grounds that a vague chat approval doesn't name the specific bypass mechanism. Rather than fight that a second time, the user chose (this session) to ship a reduced Phase 1 that needs zero protected-file changes, deferring the full custom screen to Phase 1b.

**Why "auto-open the existing coach" is a legitimate Phase 1, not a cop-out.** The core hypothesis to validate isn't the visual design of a new screen — it's *does opening straight into conversation, instead of a dashboard, actually feel better day to day.* That's testable with the existing, tuned coach panel exactly as it is. The custom minimal UI (headline, situations, day-status) is additive polish on top of a validated interaction pattern, not a prerequisite to validating it.

**Why the hook is a `useEffect` near the top of `App.jsx`, not right before the final `return`.** `App.jsx` has several early `return (...)` branches (demo mode, onboarding preview, onboarding-in-progress) between roughly line 2895 and line 2950, before the main app JSX at line ~3929. React requires the same hooks to be called in the same order on every render for a given mounted component instance. Placing a new hook after those early returns would only register it on renders that fall through to the bottom, which is a rules-of-hooks violation. Placing it near the other top-level state declarations (before any conditional return) guarantees it's always called, matching how the rest of this component's ~60 hooks are already declared.

**Daily conversation lifecycle — recommendation, not yet built.** The user asked how "one conversation per day, continuable across app opens" should work. Investigated the existing coach: today's conversation is *already* persisted per local calendar day, but **only to `localStorage`** (`forged_coach_day:v1:<userId>:<day>`, in the protected `AICoach.jsx`), not to Supabase — so it survives reopening the app on the same device/browser, but isn't durable, isn't cross-device, and critically isn't visible to the nightly `memory-rollover.js` job (which only ever sees `journal_entries.daily_context`, the small subset the coach explicitly saves via the `add_daily_note` tool — never the raw transcript). Recommended model going forward, to build in the memory-layer phase:
- **Raw transcript = ephemeral, local, day-scoped** (as today) — it's scratch space, not the product asset.
- **Compressed daily memory (`daily_summaries` + future `memory_facts`) = durable, server-side, cross-device** — this is the actual permanent record of "yesterday."
- Missed days need no special handling: no local key, no `daily_summaries` row, rollover and future morning-message generation just skip silently — already resilient by construction.
- A real `conversation_messages` Supabase table (server-side transcript, not just localStorage) should be added when the memory layer lands (Phase 3 below), because that's when it starts earning its keep — feeding fact-extraction with the actual conversation instead of the narrower `daily_context` notes. Building it earlier, just for "continue today's chat across devices," would be infrastructure ahead of validated need.

**Situations/modes — finalized design, not yet wired (blocked on §4).**

| User-facing | Internal | Behavior |
|---|---|---|
| Just chat *(default)* | Companion | No steering text added — this is the existing coach personality, unchanged. |
| I'm planning | Strategist | Surface tradeoffs/criteria, ask a clarifying question before opining, don't rush to a conclusion. |
| I'm building | Builder | Terse, concrete, turn what they say into a specific next action, track commitments. |
| I'm stuck | Pattern Finder (Reflector-paced) | Slow down, don't jump to advice, look for a loop/pattern (reference history if known), ask only if it helps them see the loop. |
| I need perspective | Reflector | Listen first, don't rush to fix, offer an outside view only once it feels wanted. |

Cut from the original brainstorm: "Executor" (redundant with Builder) and "Prompt Engineer" (contradicts the product thesis — the user shouldn't feel like they're operating a tool). This mapping is final; implementing it just needs a place to append 1-3 sentences of steering text to `system_stable`, which requires the export in §4.

**XP, ChatGPT import, Arc-inference, notifications — design carried over unchanged from the design doc, not yet built.** See the roadmap in §6 for sequencing. Key commitments, restated so they don't get lost:
- XP stays AI-judged but bounded (0-50/day) and always shown with a one-line reason, logged to a new `xp_events` table for auditability. Never silent.
- ChatGPT import stays in onboarding: paste box, plain-language instructions to find ChatGPT's Memory settings, unstructured-text extraction (never assume a stable export schema), show what got extracted before saving.
- Arcs are not removed. For this preview branch, don't require manual Arc setup — Arc-inference-from-conversation is a future direction (AI notices a repeated theme, suggests an Arc, user accepts/renames/ignores), explicitly not built yet.
- Daily titles ("Planting in the Rain Again", "Hope Contract Finally Lands") are first-class and land with the memory-layer phase (Phase 3), generated by the same nightly extraction call that produces `daily_summaries`/`memory_facts`.

**Phase 2 scope call — chunked-after-complete, not true token-level streaming.** The ideal version of "speaks back immediately" starts synthesizing audio while Claude is still generating text (sentence 1 spoken while sentence 4 is still being written). That requires hooking into the SSE-parsing loop in `AICoach.jsx`, which is protected, and per this session's explicit instruction the export block was not to be fought this round. What shipped instead — chunk the *complete* reply into sentences, then fetch/play them back-to-back with next-chunk prefetch — still eliminates the biggest chunk of the delay (no longer waiting for the entire reply's audio to synthesize as one clip before anything plays), and required zero protected-file changes. True mid-generation streaming stays queued behind the export unblock (§4).

**Quota accounting is now split across more requests, same total cost.** The server still enforces `TTS_MONTHLY_CHAR_LIMIT` per request based on that chunk's text length; summed across a reply's chunks it's the same character count as one request for the whole reply, just spread across a few more round-trips (one `tts_usage` read+upsert per sentence instead of per reply). Negligible cost/latency overhead, not optimized further — flagged as a minor follow-up, not a blocker.

**Bug caught and fixed during this phase, before commit.** The first draft of the `api/tts.js` streaming change had a real bug: if the ElevenLabs relay loop threw mid-stream (e.g. a dropped connection), the code would call `res.end()` in a `finally` block and then let the error propagate to the outer `catch`, which tried to send a *second* response (`res.status(500).json(...)`) after headers/status were already committed — Node would throw "headers already sent." Fixed by catching the relay error locally (log + Sentry-report it) instead of letting it re-throw, so there's only ever one response per request. Caught in self-review, not by external testing — worth an extra look given it's real-money ElevenLabs traffic.

---

## 4. What still needs doing

**Immediate blocker to unblock Phase 1b (the actual custom Companion screen):** someone with real repo permissions needs to either (a) grant a Bash permission rule allowing `FORGED_OVERRIDE_PROTECTED=1` for this kind of narrow, additive change, or (b) manually add `export` to these ~8 already-existing, unchanged functions in `src/coach/AICoach.jsx` (this is a trivial, zero-logic-change edit — literally prepending the word `export`):
`buildCoachSystemPrompts`, `loadCoachDayMessages`, `saveCoachDayMessages`, `COACH_API_MESSAGE_CAP`, `syncCoachMsgCountFromStorage`, `bumpCoachMsgCountInStorage`, `applyCoachRemainingFromServer`, `buildCoachGreeting` (and ideally `CoachFormattedBubble`, `CapturedLine`, `CaptureSavingLine`, `formatCoachMsgTime` for consistent bubble rendering). Once that's done, Phase 1b (custom `CompanionScreen.jsx`: "What's on your mind?" headline, situation selector wired to the table in §3, day-status placeholder, subtle XP chip) can proceed without further blockers. Not pursued this phase per explicit instruction — left for later.

**Everything else, roughly in the order it should happen** (full detail in §6):
1. Phase 1b — custom Companion screen + situations, once unblocked.
2. ~~Streaming TTS~~ — done this phase (chunked-after-complete version; true mid-generation streaming still needs the export, see §3).
3. Memory layer — `pgvector` + `memory_facts` table, extend `daily_summaries` with `title`/`commitments`/`emotional_context`/`xp_awarded`/`xp_reason`, upgrade nightly rollover to extract atomic facts + generate the daily title, replace the `recall` tool's keyword search with vector similarity. This is also when a real server-side `conversation_messages` table should be added (see §3).
4. AI-judged XP with `xp_events` audit table + always-visible reason string.
5. Conversational onboarding rebuild + ChatGPT import.
6. Notification philosophy rewrite (silence-by-default, specific-or-nothing).
7. "What I remember" trust screen (view/delete `memory_facts`) + Arc-inference exploration.

---

## 5. Risks / open bugs

- **Not verified end-to-end with a real login (Phase 1 auto-open).** This sandbox has no valid Supabase credentials, so the auto-open behavior was verified by (a) a clean production build, (b) a Playwright smoke test confirming the app renders without crashing up to the sign-in screen, and (c) code review confirming correct hook placement and reuse of the existing, already-tested `openCoachWithMode`. **It has not been visually confirmed that the coach panel actually auto-opens post-login.** First thing to check by hand.
- **First-session mic permission.** Opening the coach panel automatically does not itself trigger a mic permission prompt (mode is `null`, not `"mic"`) — this was a deliberate choice to avoid a jarring cold-load permission dialog. Worth confirming this reads as intended rather than confusing ("why did chat just open on its own").
- **Repeat sign-ins within the same tab session.** The auto-open only fires once per component mount (`companionAutoOpenedRef`), not once per calendar day — so if a user is already deep in the Today screen and something causes a full remount (rare, but e.g. a hard reload), they'd land back in the coach panel again. This matches "open into conversation by default" but worth watching for annoyance if it happens more than once per real day.
- **Phase 2 TTS changes are unverified with real audio.** No `ELEVENLABS_API_KEY`/Supabase credentials exist in this sandbox, so nothing here was heard end-to-end. Verified instead by: production build succeeding, `node --check` on `api/tts.js`, a standalone unit test of `splitIntoSpeechChunks` against realistic coach-reply shapes (short replies, multi-sentence replies, no-terminal-punctuation, the 8-chunk cap merging overflow correctly), and close code review of the session-cancellation/race-condition logic. **First thing to check by hand: enable voice replies as a Pro user, send a multi-sentence message, and listen for (a) audio starting noticeably sooner than before, (b) no gap or overlap between sentence chunks, (c) interrupting mid-reply (closing the coach or sending a new message) actually stops audio rather than continuing to play a stale chunk.**
- **Duplication risk flagged, not yet real.** Once Phase 1b builds a second send/stream loop in `CompanionScreen.jsx` reusing exported helpers from `AICoach.jsx`, there will be two chat surfaces sharing prompt-building logic but each with their own fetch/stream code — a future consolidation into a shared `useCoachSession` hook is recommended once both surfaces exist and are stable, not before.

---

## 6. Roadmap (unchanged from the design doc, restated for reference)

Phase 1 (done, reduced scope) → Phase 1b (custom Companion screen + situations, blocked on export, deferred) → Phase 2 (done — chunked TTS) → Phase 3 (pgvector + memory_facts + daily titles + rollover upgrade) → Phase 4 (AI-judged XP + xp_events) → Phase 5 (conversational onboarding + ChatGPT import) → Phase 6 (notification rewrite) → Phase 7 (memory trust screen + Arc inference).

---

## 7. Next recommended step

**Phase 3 (memory layer) is the next-most-valuable unblocked work.** It doesn't need the export either (it's schema + `memory-rollover.js` + the `recall` tool in `api/chat.js` — wait: `api/chat.js` *is* protected, so the `recall` tool swap needs the same sign-off conversation as Phase 1b before it can touch that file. The `pgvector`/`memory_facts` schema work and the `memory-rollover.js` extraction upgrade are not protected and can proceed independently — recommend starting there and treating the `recall`-tool swap as a small follow-up once schema exists).

Alternatively, if you'd rather validate Phase 2 before building more on top of it: **just test the voice changes by hand first** (see §5's checklist) before starting Phase 3, since Phase 3's rollover upgrade will eventually also touch voice-adjacent memory context and it's cheaper to catch a TTS regression now than after more work sits on top of it.

**To test what's shipped right now:**
- *Phase 1:* sign in to a real account, confirm the AI coach panel opens automatically instead of landing on the Today dashboard, confirm × still returns to Today exactly as before, confirm Arc/You/Hub/Social are all unaffected.
- *Phase 2:* as a Pro user with voice replies enabled, send the coach a message long enough to produce a multi-sentence reply, and listen for faster, gapless audio compared to before.
