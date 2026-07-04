# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** turn Forged from a habit-tracker-with-a-chatbot into a memory-first AI companion where conversation is the front door. Full product design doc: see the artifact linked in chat history, or ask for it to be regenerated.
**Last updated:** 2026-07-04, end of Phase 4.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. Roadmap at a glance — 8 phases total (+1 unnumbered step)

This is the answer to "how many phases and what does each do." Read this table first; everything below is supporting detail.

| # | Phase | What it does | Status |
|---|---|---|---|
| 1 | Companion-first landing | App opens straight into the AI coach conversation instead of the Today dashboard | ✅ **Done** |
| 1b | Custom Companion screen | Purpose-built "What's on your mind?" home screen with a situation selector (Just chat / I'm planning / I'm building / I'm stuck / I need perspective), day-status, XP chip | ⛔ **Blocked** — needs a human to export ~8 functions from the protected `AICoach.jsx` (see §4) |
| 2 | Faster voice replies | Coach replies get chunked into sentences and streamed/played back-to-back instead of waiting for the whole reply to synthesize as one clip | ✅ **Done** |
| 3 | Memory layer (schema + extraction) | Real daily titles ("Planting in the Rain Again"), atomic durable facts, commitments, emotional context — extracted nightly and stored | ✅ **Done, but inert** — code is written, migration is staged but **not applied** anywhere (see §4) |
| — | Embedding generation + hybrid retrieval | Turn stored facts into real semantic search (replacing the coach's current keyword search) | ⛔ **Not started** — needs an embeddings vendor decision (no API key configured) *and* touches the protected `api/chat.js` |
| 4 | AI-judged XP (observation only) | Nightly Haiku call judges a 0-50 XP amount + a one-sentence reason per day, stores it for review | ✅ **Done, but inert** — same as Phase 3: code written, migration staged, not applied. **Deliberately not wired into the real, user-facing XP total yet** — see §3 for why |
| 5 | Conversational onboarding + ChatGPT import | Replace the onboarding form with a real conversation; add a "paste your ChatGPT memory" option | ⛔ **Not started** |
| 6 | Notification philosophy rewrite | Morning/midday/evening messages that reference something specific and real, or say nothing at all | ⛔ **Not started** |
| 7 | "What I remember" + Arc inference | A screen to view/delete stored facts; AI notices patterns and suggests an Arc instead of requiring manual setup | ⛔ **Not started** |

**Net position:** 3 of 8 numbered phases are code-complete (1, 2, 4-worth-of-logic — though 3 and 4 need a migration applied to actually take effect). One phase (1b) and one unnumbered step (embeddings/retrieval) are blocked on human decisions, not on more agent work. Phases 5-7 haven't been started.

---

## 1. What has been changed (cumulative, all phases so far)

### Phase 1 — Companion-first landing (shipped)

The app now opens straight into the AI coach conversation instead of the Today dashboard, for onboarded, signed-in users, once per session.

- `src/App.jsx`: added a `useRef` + `useEffect` (near the `accountDataReady` state declaration, before any early-return JSX branches — required so React's hook-call-order rule isn't violated) that fires exactly once per app load, calling the **existing, untouched** `openCoachWithMode(null)`. Passing `null` opens the panel without forcing mic permission or text focus — the user lands on the greeting + starter chips, mic ready to tap.
- Nothing else changed. `screen` still defaults to `"today"` underneath — closing the panel lands the user exactly where it always did. Today/Arc/You/Hub/Social are 100% untouched.

### Phase 2 — Faster, chunked voice replies (shipped)

- **`api/tts.js`** — now relays ElevenLabs' audio stream to the client as bytes arrive instead of buffering the whole clip first (same pattern `api/chat.js` already uses for its own streaming). Auth/Pro-gating/quota logic byte-for-byte unchanged.
- **`src/hooks/useCoachTts.jsx`** — `speak(text)` now splits a reply into sentence chunks (new exported `splitIntoSpeechChunks`) and plays them back-to-back, prefetching the next chunk while the current one plays. Public API (`speak`, `stopSpeaking`, `primeAudio`, `speaking`, `ttsError`, `clearTtsError`) unchanged — zero edits needed in `AICoach.jsx`.
- **Not included:** true mid-generation streaming (speaking while Claude is still writing) — needs the protected SSE loop in `AICoach.jsx`.

### Phase 3 — Memory layer: schema + fact/title extraction (shipped, migration staged not applied)

- **`supabase/pending_migrations/20260704120000_pgvector_memory_facts.sql`** (staged, NOT applied): enables `pgvector`, creates `memory_facts` (atomic facts — `kind`/`content`/`embedding vector(384)` left NULL/`importance`/`status`, RLS matching existing tables), extends `daily_summaries` with `title`/`commitments`/`emotional_context`/`xp_awarded`/`xp_reason` (last two schema-only, populated in Phase 4).
- **`api/memory-rollover.js`**: the existing nightly Haiku call now also produces a per-day `title`, `commitments`, `emotional_context`, and 0-6 atomic `facts` — same single LLM call, larger JSON schema, no new cost. Facts are deduped against existing DB rows *and* against each other within the same batch (a real bug found and fixed via a mock-data unit test — see §3).
- **Fail-soft by design:** the new writes are wrapped in their own try/catch, isolated from the pre-existing `summary`/`structured`/`coach_memory` writes, so a database that hasn't run the migration keeps working exactly as it did before this branch — the new fields just silently don't get written yet (logged, not thrown).
- **Not included:** no vector similarity search (needs the embeddings decision + `api/chat.js` sign-off), no embedding generation, no "What I remember" UI.

### Phase 4 — AI-judged XP, observation only (shipped, migration staged not applied, NOT wired to live XP)

Original Phase 4 scope was "AI-judged XP + `xp_events` audit table." Before writing anything, I flagged a real risk: `profiles.xp` (the live, user-facing lifetime XP total shown throughout the app) is already incremented by an existing, separate, deterministic system (`lifetimeXpForHabitLog()` in `src/arcProgress.js`, fired from habit taps). If the new AI-judged amount were *also* written to `profiles.xp`, every user would get double XP each day — a real correctness bug, not a style choice. So this phase is scoped to computation and storage only, not to touching the live total. See §3 for the full reasoning.

- **`api/memory-rollover.js`** (further extended): the same nightly Haiku call now also returns, per day, an `xp_delta` (instructed to stay 0-50, but **clamped server-side regardless** — the model is never trusted to self-enforce the range) and a one-sentence `xp_reason` ("You followed through on a difficult conversation and still made progress despite low energy"). Written to `daily_summaries.xp_awarded`/`xp_reason` (staged in Phase 3's migration) — same fail-soft pattern as everything else in Phase 3.
- **`supabase/pending_migrations/20260704130000_xp_events.sql`** (new, staged, NOT applied): an append-only, read-only-to-clients audit table (`user_id`, `event_date`, `amount`, `reason`, `source`, `created_at`) so every AI-judged award is traceable later. `memory-rollover.js` already writes to it, wrapped fail-soft like everything else.
- **Deliberately NOT done:** no write to `profiles.xp`, no UI surfacing (no XP flash, no reason shown anywhere) — there's no live number changing yet, so there's nothing honest to show. Reconciling the two XP systems (or deciding the AI-judged number *replaces* the deterministic one, per the original design doc's intent) is a product decision for a human, not something to quietly pick mid-phase.

---

## 2. Files touched (cumulative)

| File | Phase | Change | Risk |
|---|---|---|---|
| `src/App.jsx` | 1 | One `useRef` + `useEffect` (~15 lines), calls existing `openCoachWithMode(null)`. | Low |
| `api/tts.js` | 2 | Buffer-then-send → stream-then-end; fixed a double-response bug caught in review. | Low-medium (real ElevenLabs traffic, not protected) |
| `src/hooks/useCoachTts.jsx` | 2 | `speak()` rewritten to chunk-and-prefetch; public API unchanged. | Low |
| `supabase/pending_migrations/20260704120000_pgvector_memory_facts.sql` | 3 | New file, staged, not applied. | None until applied |
| `api/memory-rollover.js` | 3 | Extended prompt/schema with title/commitments/emotional_context/facts; two new fail-soft write blocks. | Low-medium (real nightly job, not protected) |
| `api/memory-rollover.js` | 4 | Further extended prompt/schema with xp_delta/xp_reason; one new fail-soft write to `daily_summaries`, one new fail-soft insert into `xp_events`. | Low-medium (same file as above; deliberately not touching `profiles.xp`) |
| `supabase/pending_migrations/20260704130000_xp_events.sql` | 4 | New file, staged, not applied. | None until applied |

**No changes, ever, to:** `api/chat.js`, `src/coach/AICoach.jsx`, `src/coach/CoachApp.jsx`, `api/coach-summary.js`, `api/coach-intro.js`, anything under the real `supabase/migrations/` directory, `api/stripe-webhook.js`, `api/create-checkout.js`, `api/create-portal-session.js`, `package.json`. All protected paths remain fully untouched across all four phases.

---

## 3. Decisions made (and why) — all phases

**Protected-file wall, hit twice, resolved two different ways.** `src/coach/AICoach.jsx`/`api/chat.js` (coach personality) and `supabase/migrations/**` (schema) are both locked by `.claude/hooks/protected-paths.txt`, requiring explicit human sign-off. Phase 1b needed the former; Phase 3 needed the latter. For the coach-file case, the user approved an export but the session's own auto-mode safety classifier independently blocked the env-var override anyway — resolved by shipping a reduced Phase 1 (auto-open the existing panel) instead of fighting it twice. For the migration case, recognized upfront (before writing code) that it would block the *entire* phase, asked first, and the resolution was to stage migrations in `supabase/pending_migrations/` — a sibling directory the protected-path glob doesn't match — rather than re-attempt the same override fight.

**Why "auto-open the existing coach" (Phase 1) is a legitimate validation, not a cop-out.** The hypothesis to test isn't a screen's visual design — it's whether landing in conversation instead of a dashboard actually feels better day to day. That's testable with the existing, tuned panel exactly as it is.

**Daily conversation lifecycle — recommendation.** Today's conversation is already persisted per local day, but only to `localStorage` (in the protected `AICoach.jsx`) — durable on one device, invisible to the nightly rollover job. Recommended model: raw transcript stays ephemeral/local (scratch space); compressed memory (`daily_summaries` + `memory_facts`) is the durable, cross-device record. A real server-side `conversation_messages` table is worth adding once it can feed richer fact-extraction than today's `daily_context` notes — not before.

**Situations/modes — finalized design, not yet wired (blocked on the same export as Phase 1b).**

| User-facing | Internal | Behavior |
|---|---|---|
| Just chat *(default)* | Companion | Existing coach personality, unchanged |
| I'm planning | Strategist | Surface tradeoffs, ask before opining, don't rush to a conclusion |
| I'm building | Builder | Terse, concrete, ends in a next action, tracks commitments |
| I'm stuck | Pattern Finder (Reflector-paced) | Slow down, look for a loop/pattern, ask only if it helps |
| I need perspective | Reflector | Listen first, offer a view only once it's wanted |

Cut: "Executor" (redundant with Builder), "Prompt Engineer" (contradicts the product thesis).

**Phase 2 scope call.** True token-level streaming (speaking while Claude is still generating) needs the protected SSE loop. What shipped instead — chunk the *complete* reply, then play back-to-back with prefetch — removes the biggest share of the delay (no longer waiting for the whole reply's audio as one clip) without needing that file. Quota accounting is split across more requests but sums to the same total character cost.

**Phase 2 bug caught before commit.** First draft of the `api/tts.js` streaming change would, on a mid-stream failure, call `res.end()` in a `finally` and then let the error re-throw into the outer `catch`, which tried to send a *second* response after headers were already committed — Node would throw "headers already sent." Fixed by catching the relay error locally instead of re-throwing.

**Embedding generation deliberately deferred.** `memory_facts.embedding` exists (`vector(384)`) but nothing populates it — needs either a new vendor + API key (Voyage AI recommended in the design doc) or a Supabase Edge Function for the built-in `gte-small` model, and no credentials for either exist in this environment. Fact extraction/storage is still valuable without embeddings; the column is ready whenever that decision gets made.

**Phase 3 in-batch dedup bug caught before commit.** First draft only deduped new facts against existing DB rows, not against each other within the same rollover run (which processes up to 2 pending days at once) — would have inserted near-duplicates on a user's first run. Caught with a standalone mock-data unit test, fixed by tracking normalized content already queued within the batch.

**Phase 4 — why XP is observation-only, not wired to `profiles.xp`.** The existing app already increments `profiles.xp` deterministically per habit tap (`lifetimeXpForHabitLog()`). Writing the new AI-judged amount to the same column would double every user's daily XP, silently, forever — a correctness bug shipped as a "feature." Reconciling the two systems (does AI-judged XP *replace* the deterministic path, run alongside it with a shared daily cap, or something else) is a product decision, not an engineering default to pick alone. What Phase 4 ships instead: the judgment is computed, clamped, reasoned, and stored (in `daily_summaries` and a new audit table) — fully reviewable, fully reversible, zero effect on any number a real user currently sees.

**Phase 4 XP clamping verified against edge cases.** A standalone unit test confirmed the clamp handles: negative deltas (→0), over-cap deltas (→50), fractional deltas (→rounded), and — importantly — a stringly-typed `"38"` from the model instead of a number `38` (→ rejected to `null` rather than silently coerced, since `Number.isFinite("38")` is `false`). Malformed model output results in no XP recorded for that day rather than a guessed value.

---

## 4. What requires human action (blockers)

**Blocker A — export from `AICoach.jsx` (unblocks Phase 1b).** Someone with repo permissions needs to either (a) grant a Bash permission rule allowing `FORGED_OVERRIDE_PROTECTED=1` for this narrow, additive change, or (b) manually add the word `export` in front of these already-existing, unchanged functions in `src/coach/AICoach.jsx`:
`buildCoachSystemPrompts`, `loadCoachDayMessages`, `saveCoachDayMessages`, `COACH_API_MESSAGE_CAP`, `syncCoachMsgCountFromStorage`, `bumpCoachMsgCountInStorage`, `applyCoachRemainingFromServer`, `buildCoachGreeting` (and ideally `CoachFormattedBubble`, `CapturedLine`, `CaptureSavingLine`, `formatCoachMsgTime`). Zero logic changes either way.

**Blocker B — apply the two staged migrations (unblocks Phases 3 and 4 taking effect).** Both files are currently inert. Exact steps, in order:

1. **Review both files first** — they're real schema changes (a new Postgres extension, two new tables with RLS, six new nullable columns on an existing table):
   - `supabase/pending_migrations/20260704120000_pgvector_memory_facts.sql`
   - `supabase/pending_migrations/20260704130000_xp_events.sql`
2. **Apply in that order** (the second doesn't depend on the first, but keeping the original sequence is simplest to reason about). Two ways to do it — pick whichever matches how this repo normally runs migrations:
   - **Option 1 (matches this repo's existing convention):** copy each file into `supabase/migrations/` with a fresh timestamp prefix (e.g. `supabase/migrations/20260705090000_pgvector_memory_facts.sql`), so it sits alongside the other 31 migrations, then run this project's normal migration command against the target Supabase project.
   - **Option 2 (fastest, no file move):** open the Supabase dashboard's SQL editor for the project, paste the contents of each `.sql` file, and run it directly. Functionally identical to Option 1 for a `create table if not exists`/`add column if not exists` migration like these — both are idempotent and safe to re-run.
3. **After applying, nothing else needs to change in the code.** `api/memory-rollover.js` already writes to every new column/table — the fail-soft wrapping just means those writes start *succeeding* instead of logging a warning. No redeploy-and-tweak cycle needed.
4. **Verify** by triggering a rollover for a test account (has the app call `/api/memory-rollover` the normal way, or invoke it manually with a valid user token) and then checking, directly in the Supabase table editor: `daily_summaries` should show non-null `title`/`commitments`/`emotional_context`/`xp_awarded`/`xp_reason` for a processed day; `memory_facts` should have new rows; `xp_events` should have one row per processed day.

**Blocker C — choose an embeddings approach (unblocks real semantic retrieval).** Pick one:
   - **Voyage AI** (recommended in the design doc — cheap, simple, no new infra beyond an API key). Needs `VOYAGE_API_KEY` (or similar) added to the environment.
   - **Supabase Edge Function** calling the built-in `gte-small` model. No new vendor, but needs an Edge Function deployed (new runtime surface for this project).
   Neither is configured in this environment. This also gates the `recall` tool's keyword→vector swap in `api/chat.js`, which needs its own sign-off since that file is protected too.

**Everything else, in order, once the above is resolved:**
5. Embedding generation + hybrid retrieval (needs Blocker C + Blocker B applied + a protected-file sign-off for the `api/chat.js` swap).
6. Conversational onboarding rebuild + ChatGPT import.
7. Notification philosophy rewrite.
8. "What I remember" trust screen + Arc-inference exploration.
9. (Whenever it comes up) Decide how AI-judged XP reconciles with the existing deterministic system, then wire `daily_summaries.xp_awarded` into something user-visible.

---

## 5. Risks / open items

- **Phase 1 auto-open not visually confirmed post-login** — no real Supabase credentials in this sandbox. Verified by build + Playwright smoke test to the sign-in screen + code review only.
- **First-session mic permission / repeat-open behavior** — opening the panel doesn't force a mic prompt (deliberate); the auto-open only fires once per component mount, not once per calendar day, so a rare full remount could reopen it.
- **Phase 2 TTS unverified with real audio** — no ElevenLabs/Supabase credentials here. Verified by build, `node --check`, and a standalone unit test of the sentence-splitter. **Test by hand:** Pro user, voice replies on, multi-sentence message — listen for faster/gapless audio and clean interruption.
- **Phase 3 & 4 rollover changes unverified against a live model call** — no Anthropic/Supabase credentials here. The larger JSON schema has never actually been sent to or parsed from a real Claude response, only mock data. **Test by hand once migrations are applied:** trigger a real rollover, inspect `daily_summaries`/`memory_facts`/`xp_events` directly. Also worth confirming `max_tokens: 1200` (unchanged despite a much larger JSON schema) doesn't cause truncated/unparseable output with 2 pending days' worth of the new fields — bump it if rollover logs start showing "unparseable model output" more than very rarely.
- **Both migrations are unreviewed by anyone but this session** — real schema, review before applying.
- **`xp_events` has no dedup/idempotency guard**, unlike `daily_summaries`/`memory_facts` — but it doesn't need one under normal operation, since a day is only ever in the rollover's `pending` list once (the base `daily_summaries` write, which always happens first and is never skipped, is what marks a day "already summarized" for future runs).
- **Two chat surfaces will eventually share prompt-building logic with separate fetch/stream code** once Phase 1b exists — flagged for a future consolidation into a shared hook, not urgent now.

---

## 6. How to test safely (does not require applying anything)

Everything below is safe to test right now, on the preview branch, without applying either staged migration:

- **Phase 1:** sign in to a real account → confirm the AI coach panel opens automatically instead of the Today dashboard → close it (×) → confirm you land on Today exactly as before → confirm Arc/You/Hub/Social are unaffected.
- **Phase 2:** as a Pro user with voice replies enabled, send a message long enough to produce a multi-sentence reply → listen for noticeably faster, gapless audio compared to before this branch.
- **Phase 3 & 4 (code-only, before migration):** trigger `/api/memory-rollover` for a test account and check the server logs — you should see the existing `"[memory-rollover] updated"` success log exactly as before (proving the core job still works), plus two new `console.warn` lines (`"extended daily_summaries fields not written"` and `"memory_facts not written"`/`"xp_events not written"`) confirming the new code path is reached and fails *safely* rather than breaking the job. Seeing those warnings right now is the expected, correct behavior pre-migration — not a bug.
- **Phase 3 & 4 (full, after applying both migrations — see §4 Blocker B):** re-trigger a rollover for the same test account and confirm the warnings are gone and `daily_summaries`/`memory_facts`/`xp_events` are populated as described in §4's verification step.

**Do not** apply the migrations, move anything into `supabase/migrations/`, or attempt the `AICoach.jsx` export yourself through this session unless you want to explicitly unblock the next phase — this document assumes those three things remain deliberately untouched until you say otherwise.

---

## 7. Next recommended step

Given none of the three blockers (§4) are resolved, the highest-leverage next move is **your call on which blocker to unblock first** — they gate different work:
- Unblocking **Blocker A** (export) → enables Phase 1b (the custom Companion screen you originally asked for).
- Unblocking **Blocker B** (apply migrations) → makes Phases 3 and 4's already-written code actually take effect, and is a prerequisite for everything else touching memory or XP.
- Unblocking **Blocker C** (embeddings vendor) → enables real semantic retrieval, the biggest remaining gap in the memory story.

If you'd rather I keep building without any blockers resolved, the next available work is **Phase 5 (conversational onboarding + ChatGPT import)** — it doesn't touch protected files or need new schema beyond what Phase 3 already staged (onboarding-extracted facts can use the same `memory_facts` write path, fail-soft, same as the rollover job).
