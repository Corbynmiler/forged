# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** turn Forged from a habit-tracker-with-a-chatbot into a memory-first AI companion where conversation is the front door.
**Last updated:** 2026-07-05 — the real Companion home screen shipped, replacing the Phase 1 auto-open hack. Roadmap revised mid-session after the user flagged that prior phases, while real, hadn't touched what the app actually looks like.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. Roadmap at a glance

Revised 2026-07-05. The original Phase 1-8 numbering undersold how much depended on one blocker; this table reflects what's actually true now.

| Phase | What it does | Status |
|---|---|---|
| **Companion home screen** | Mic-first, one conversation surface, situation selector, day-status line — the actual default landing screen | ✅ **Done, this session** — replaces the old "auto-open a modal on top of the Today dashboard" approach |
| Faster voice replies | Coach replies chunked into sentences, streamed/played back-to-back instead of waiting for the whole reply to synthesize as one clip | ✅ Done |
| Memory layer (schema + extraction) | Real daily titles, atomic durable facts, commitments, emotional context — extracted nightly, stored | ✅ Done and live (migration applied) |
| AI-judged XP (observation only) | Nightly judgment of a 0-50 XP amount + a one-sentence reason, stored for review | ✅ Done and live — **deliberately not wired to the real XP total yet** (see §3) |
| ChatGPT memory import | Onboarding step: paste existing ChatGPT memory, review extracted facts, save | ✅ Done and live |
| Retire the old CoachBar / modal drawer | The floating mic bar + popup chat panel is now redundant now that the Companion screen exists | ⛔ **Not done yet — next up** |
| Embedding generation + hybrid retrieval | Turn stored facts into real semantic search | ⛔ Not started — needs a vendor decision + protected-file sign-off |
| Notifications rewrite | Morning/midday/evening messages that reference something specific and real, or say nothing | ⛔ Not started — correctly demoted behind the home screen |
| "What I remember" + Arc inference | View/delete stored facts; AI notices patterns and suggests an Arc | ⛔ Not started |

**What changed in the revision:** the user correctly pointed out that four phases of real, shipped work (memory schema, XP judgment, TTS speed, ChatGPT import) hadn't touched what the app actually *looks and feels like* — it still opened to the Today dashboard with a coach panel auto-triggered on top. The root cause: the actual custom Companion screen (originally "Phase 1b") had been blocked on exporting functions from the protected `AICoach.jsx`, and every phase since routed around that blocker instead of resolving it. This session resolved it — see §3 — and the real screen is now built and live as the default.

---

## 1. What has been changed (cumulative)

### The Companion home screen (shipped this session, supersedes the old Phase 1)

The app now opens directly to `src/screens/CompanionScreen.jsx` — no dashboard, no auto-opened modal on top of one. This is the actual screen from the original design brief:

- **Mic-first, user-controlled, no auto-cutoff.** Tap the mic, talk as long as you want, tap again to stop — stopping *is* the send action, no separate confirm step. Uses the same `useSpeechInput({ autoRestart: true, meter: true })` continuous-dictation mode the old coach drawer already used, so this isn't new/unproven behavior, just a new home for it.
- **Day-status line** at the top ("Yesterday: [title]") once a real title exists from the memory-rollover job; blank otherwise. Wired via a small additive change to `App.jsx`'s existing `daily_summaries` query (added `title` to the select).
- **Situation selector** — a collapsed pill (default "Just chat"), tap to reveal the five situations from the design (I'm planning / I'm building / I'm stuck / I need perspective). Selecting one appends 1-3 sentences of steering text to the cached `system_stable` block for that conversation — memory, retrieval, and tool access are identical across situations, only tone changes.
- **Reuses the tuned coach personality**, not a fork of it. `buildCoachSystemPrompts`, `loadCoachDayMessages`, `saveCoachDayMessages`, `COACH_API_MESSAGE_CAP`, the free-tier quota helpers, and the message-rendering components (`CoachFormattedBubble`, `CapturedLine`, `CaptureSavingLine`, `formatCoachMsgTime`) are all imported from `AICoach.jsx`, which now exports them (see §3 for how that got unblocked). The screen owns its own UI shell and its own streaming/send loop — the personality itself was never forked.
- **Same day-thread key as the old coach drawer** (`forged_coach_day:v1:<userId>:<day>`) — both surfaces read/write the same localStorage-persisted conversation, so nothing is lost or duplicated during the transition period where both still technically exist.
- **Text fallback always reachable** — a quiet "type instead" link, not a competing input bar, matching "mic-first, not mic-only."
- **A small "Progress →" link** at the bottom routes to the existing Today screen — Arc/Hub/Social/You are unchanged and reachable from there exactly as before.
- Added to the bottom nav as the first item ("Talk"), alongside the existing Today/Arc/You — none of those were touched, removed, or restructured.

**Removed:** the Phase 1 `companionAutoOpenedRef` `useEffect` that auto-triggered the old modal drawer — superseded, since the Companion screen is now the default `screen` state directly, nothing needs auto-opening on top of anything.

**Not included in this pass** (see §4/§5):
- The old CoachBar (floating mic bar above the bottom nav on Today/Arc/Social/Hub) and the modal `AICoach` drawer it opens still exist, unremoved — they're now a redundant second way to reach the same conversation. Retiring them is the very next step, not done yet.
- Goal-plan-preview cards (the `<goal_plan>` confirmation UI) aren't rendered on this screen — deliberately scoped out; if the coach proposes a goal via Companion, the block is stripped from display but no confirmation card shows yet. Users can still set goals via Arc/Hub.
- True mid-generation TTS streaming still needs the protected SSE loop — unaffected by this change either way.

### Faster, chunked voice replies (shipped)

- **`api/tts.js`** — relays ElevenLabs' audio stream to the client as bytes arrive instead of buffering the whole clip first. Auth/Pro-gating/quota logic unchanged.
- **`src/hooks/useCoachTts.jsx`** — `speak(text)` splits a reply into sentence chunks and plays them back-to-back, prefetching the next chunk while the current one plays. Public API unchanged.
- Bug caught and fixed before commit: a mid-stream ElevenLabs failure would have tried to send a second response after headers were already committed ("headers already sent") — fixed by catching the relay error locally instead of letting it re-throw.

### Memory layer: schema + fact/title extraction (shipped, live)

- `supabase/pending_migrations/20260704120000_pgvector_memory_facts.sql` — **applied 2026-07-05**, verified live: `pgvector` enabled, `memory_facts` table exists (embedding column present, `NULL` until an embeddings vendor is chosen), `daily_summaries` extended with `title`/`commitments`/`emotional_context`/`xp_awarded`/`xp_reason`.
- `api/memory-rollover.js` — the nightly Haiku call now also produces a per-day title, commitments, emotional context, and 0-6 atomic facts, same single LLM call, no new cost. Facts are deduped against existing DB rows *and* against each other within the same batch — a real bug (missing in-batch dedup) was caught with a mock-data unit test and fixed before commit.
- All new writes are fail-soft — wrapped separately from the pre-existing `summary`/`structured`/`coach_memory` writes, so this never risked breaking the working nightly job even before the migration was applied.

### AI-judged XP, observation only (shipped, live, NOT wired to the real total)

- Same nightly call now also returns an `xp_delta` (0-50, clamped server-side regardless of what the model returns) and a one-sentence `xp_reason`, written to `daily_summaries` and a new, applied `xp_events` audit table.
- **Deliberately not written to `profiles.xp`** — that column already has a separate, deterministic per-habit-tap XP path; writing this too would double-count every user's daily XP. This is a product decision (how should the two systems reconcile?) that hasn't been made yet, not an oversight.

### ChatGPT memory import in onboarding (shipped, live)

- New step in `OnboardingScreen.jsx`, right after name entry: explains where to find Memory in ChatGPT, paste box, equal-weight skip. New `api/onboarding-memory-import.js` extracts up to 12 atomic facts from the unstructured paste via one Haiku call. Facts are shown for review/removal before saving; confirmed facts write directly to `memory_facts` from the client (RLS already permits it).
- **Bug caught and fixed after the fact:** the admin "Preview onboarding" path explicitly promises "no changes will be saved," but the import's save function bypassed that and would have written real rows regardless of preview mode. Fixed by threading an `isPreview` prop through and skipping the write when set.
- Onboarding itself was already conversational for Arc setup before this branch touched it (`api/onboard-chat.js`, unprotected, distinct from the main coach) — this phase only needed to add the one genuinely missing piece.

---

## 2. Files touched (cumulative)

| File | What | Risk |
|---|---|---|
| `src/screens/CompanionScreen.jsx` | **New.** The real home screen. | Medium — new, substantial, but additive; doesn't touch the protected file it reuses logic from. |
| `src/App.jsx` | Default `screen` → `"companion"`; removed the old auto-open effect; added `CompanionScreen` import/render/NAV entry; added `title` to the `daily_summaries` select for the day-status line. | Low-medium — real routing change, but every other screen is untouched and still reachable. |
| `src/coach/AICoach.jsx` | **12 functions/consts changed from `function`/`const` to `export function`/`export const`. No other change.** Done by the user directly (not by this session), verified via `git show` before building on top of it. | None — confirmed zero logic change, just visibility. |
| `api/tts.js` | Buffer-then-send → stream-then-end; fixed a double-response bug. | Low-medium |
| `src/hooks/useCoachTts.jsx` | `speak()` rewritten to chunk-and-prefetch; public API unchanged. | Low |
| `supabase/pending_migrations/20260704120000_pgvector_memory_facts.sql` | Applied. | None — done |
| `supabase/pending_migrations/20260704130000_xp_events.sql` | Applied. | None — done |
| `api/memory-rollover.js` | Extended prompt/schema with title/commitments/emotional_context/facts/xp_delta/xp_reason; fail-soft writes. | Low-medium |
| `api/onboarding-memory-import.js` | **New.** Extraction endpoint, no DB write. | Low |
| `src/screens/OnboardingScreen.jsx` | New import step + `isPreview` safety fix. | Low-medium |

**Still fully untouched:** `api/chat.js`, `src/coach/CoachApp.jsx`, `api/coach-summary.js`, `api/coach-intro.js`, the real `supabase/migrations/` directory, all Stripe/billing files, `package.json`.

---

## 3. Decisions made (and why)

**The protected-file blocker got resolved this session, deliberately, after being routed around for four phases.** Building the real Companion screen required the coach personality/prompt logic that only exists in the protected `AICoach.jsx`. Rather than fork it into a second, drifting copy, the user made the 12 required `export`-keyword additions themselves — a genuinely zero-risk change (verified via `git show`: exactly those 12 lines, nothing else). This was the right call in hindsight from day one; the earlier "route around it" pattern optimized for not-fighting-the-permission-system at the cost of never shipping the actual product surface.

**Why the Companion screen writes its own send/stream loop instead of extracting a shared hook.** `AICoach.jsx`'s internal `send()` function (the SSE-parsing loop, Arc-edit routing, etc.) wasn't itself exported — only the pure helper functions around it were. Extracting a shared `useCoachSession` hook that both surfaces could use would be the cleaner long-term shape, but it means modifying the tuned, working drawer file more deeply than "add export to 12 lines." Given this was already a big step, duplicating the send/stream loop (while reusing every exported pure helper) was the lower-risk choice — flagged as a real follow-up once both surfaces have been live for a while and the drawer is either retired or proven still necessary.

**Why the old CoachBar/modal drawer wasn't removed in the same step.** It's the very next thing to do, but this step was already large (new screen, new routing, a real behavior change to the default landing experience) — cutting the old surface in the same commit would have made this diff harder to review and roll back independently if something about the new screen needs adjusting first.

**Goal-plan-preview cards deliberately left out of the Companion screen.** The `GoalPlanPreview` component that renders a "create this goal" confirmation card isn't exported from `AICoach.jsx`, and re-implementing it wasn't judged worth the scope for this step — voice/text goal-planning is a secondary path (most goal creation happens via Arc/Hub). The `<goal_plan>` block is still stripped cleanly from display so it doesn't leak as raw text; it just doesn't get a confirmation card yet.

*(Prior-phase decisions — embedding deferral, XP double-counting risk, migration staging, dedup bugs caught in review — are preserved from earlier versions of this file; ask if you need the full history restated.)*

---

## 4. What requires human action

**Immediate — retire the redundant old chat surface.** The floating CoachBar + modal `AICoach` drawer (on Today/Arc/Social/Hub) now duplicates the Companion screen. Recommend hiding the CoachBar's floating mic button (keep the underlying `AICoach` component and its logic intact, just stop surfacing the *trigger* for it) once the Companion screen has been used for real and feels right — don't cut the fallback before that.

**Blocker C — choose an embeddings approach** (unblocks real semantic retrieval): Voyage AI (needs an API key) or a Supabase Edge Function calling the built-in `gte-small` model (needs a new deployment). Neither is configured. This also gates the `recall` tool's keyword→vector swap in `api/chat.js`, which is protected and needs its own sign-off.

**Whenever it comes up:** decide how AI-judged XP (already computed, stored, and auditable) should reconcile with the existing deterministic per-tap system before wiring `daily_summaries.xp_awarded` into anything user-visible.

**Optional, not blocking anything:** wire ChatGPT-imported facts into `onboard-chat.js`'s own system prompt so the Arc-setup conversation "already knows" what was imported, instead of only seeding `memory_facts` for later.

---

## 5. Risks / open items

- **The Companion screen has not been visually tested** — no real login credentials in this sandbox. Verified by: production build succeeding with the new screen actually in the bundle (confirmed by module count), a Playwright smoke test to the pre-auth sign-in screen (clean, no crash), and close code review including two real bugs caught before commit (see below). **First thing to check by hand:** sign in, confirm you land directly on the Companion screen (not Today), confirm the mic press/release/send cycle works end to end, confirm voice replies play, confirm the situation pill and "Progress →" link both work, confirm Today/Arc/You still work exactly as before via the bottom nav.
- **Two real bugs caught in self-review before commit, not by testing:** (1) the mic-stop-to-send handler originally read `input` via a stale closure instead of a ref, which would have sent an incomplete message missing the last flushed dictation segment — fixed. (2) `captureSaving` (the "Saving what mattered…" indicator) was rendered but nothing ever set it true — the polling effect that drives it (mirrored from `AICoach.jsx`) was missing — added.
- **Both this screen and the old modal drawer are live simultaneously** until the drawer is retired — they share the same day-thread key, so conversation continuity is fine, but having two mic entry points is exactly the "confusing second entry point" this whole revision was trying to eliminate. Don't leave this in place long.
- **`onOpenProgress` currently routes to `"today"` specifically** — reasonable default, but if a different secondary landing makes more sense (e.g. a dedicated hub), that's a one-line change.
- Everything from prior phases (rollover unverified against a live model call, `xp_events` has no dedup guard but doesn't need one, embedding column unpopulated) still applies unchanged.

---

## 6. How to test safely

- **Companion screen:** sign in → confirm you land directly on it, no dashboard first → tap the mic, say something, tap again to stop → confirm it sends automatically and a reply streams in → confirm the situation pill opens/closes and changes tone plausibly → confirm "type instead" and the send button work → confirm voice replies play if enabled → confirm "Progress →" takes you to Today, and Arc/You from the bottom nav both still work exactly as before → reload the app and confirm today's conversation is still there.
- **Memory/XP (now live):** trigger a real rollover for a test account with some real conversation history, then check `daily_summaries`/`memory_facts`/`xp_events` directly in Supabase.
- **ChatGPT import:** covered in the previous test pass — still valid, unaffected by this step.

---

## 7. Next recommended step

Retire the old CoachBar/modal drawer's floating trigger once the Companion screen has been used for real and feels right — don't rush this the same day the new screen ships. After that, the two open blockers (embeddings vendor, XP reconciliation) are the real remaining gates; neither blocks starting the notifications rewrite if that's preferred instead.
