# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface. Being built for one user first — the bar is "would you use this instead of ChatGPT for life updates, reflection, planning, and thinking."
**Last updated:** 2026-07-05 (Phase 2, step 1) — started building the memory architecture (Phase 2a): staged a `conversation_messages` table (**not yet applied — needs your review**, see §3) and wired the Companion screen to write every turn to it, fail-soft. Nothing else from Phase 2 has been touched yet — this is deliberately the smallest safe first step.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. The honest reassessment (read this first)

You asked directly: have we accidentally discovered a better product than the one we planned? **Yes — and the evidence is in what's actually happened over the last several rounds, not just in how it feels.**

Every round of real feedback has been about the companion surface (the Ember, the greeting, the conversation modes, memory, voice) — never once about Today, Arc, habits, streaks, or XP-as-a-tally. Those systems haven't been discussed, tuned, or endorsed in this entire branch; they've just been sitting underneath, unquestioned, while the actual product got redesigned around them repeatedly. Your own benchmark for this branch was never "is this a better habit tracker" — it was "would I use this instead of ChatGPT for life updates, reflection, planning, and thinking." That's a different product category, and this branch has been quietly building toward it without the roadmap ever saying so out loud.

The deeper tension is structural, not cosmetic: this branch's own stated direction — *"the AI should judge progress using context, not checklists," "keep XP explainable, but don't make it dependent on habits"* — is in direct conflict with Arc/habits/streaks, a fixed, deterministic, checklist-driven system by design. Every round of prompt-tightening on the rollover job has been quietly working *around* that tension, not resolving it. It doesn't resolve until the underlying model changes — which is exactly what Phase 2 (§1) is for.

**What this doesn't mean:** delete Today/Arc/habits outright. That data model is real, live, working code with real rows in a shared production database. It means the plan below treats the companion as the product going forward and treats Today/Arc/habits as a *backing data source the companion reads and writes on your behalf* — not a set of screens you actively manage.

---

## 1. Phase 2 — the roadmap

**If Phase 1 was "prove a voice-first companion is technically viable" — Phase 2 is "stop layering the companion on top of the old app, and start collapsing the old app into the companion."**

| Step | What | Status |
|---|---|---|
| **2a. Memory architecture** | `conversation_messages` (raw per-turn log) → extraction → embeddings/retrieval, so the companion has real, growing context to draw from. | 🔶 **In progress — step 1 of several, see §3.** |
| **2b. Retire the old CoachBar/modal drawer** | The floating chat surface that duplicates the Companion screen. | ⛔ Not started — next up, can run in parallel with the rest of 2a. |
| **2c. Reframe Today around the companion** | Today stops being a checklist you manage and becomes a quiet log of what the companion already captured. | ⛔ Not started — depends on 2a existing first. |
| **2d. Resolve the XP collision** | Deterministic per-tap XP vs. AI-judged observational XP — pick one, merge them, or make a deliberate call to keep both. | ⛔ Not started — your call, not mine (see §1 of the prior revision of this doc for the three options, preserved below in §8). |
| **2e. Rename Coach → Companion** | Only once 2a-2d make it true, not just cosmetic. | ⛔ Not started, intentionally last. |

Full reasoning for this sequencing (why each step blocks the next) is preserved in §8 (carried over from the round that proposed it) rather than repeated here.

---

## 2. Memory architecture design (unchanged from last round, still the target)

```
conversation_messages (raw, every turn) → nightly extraction (existing job)
  → daily_summaries / memory_facts / coach_memory
  → embeddings on memory_facts → similarity search at reply-time (retrieval)
  → ChatGPT import eventually converges onto this same pipeline, backdated
```

Full diagram, reasoning, and the deliberate "don't embed raw conversation_messages, only memory_facts" scope decision are preserved in §8. This round builds the first box in that diagram.

---

## 3. This round's change — Phase 2a, step 1: `conversation_messages`

**What changed:**
1. **Staged a new migration** — `supabase/pending_migrations/20260705120000_conversation_messages.sql` — creating one new table. **Not applied. Needs your review before it exists anywhere.**
2. **Wired `src/screens/CompanionScreen.jsx`** to write every turn (your message, and the assistant's finalized reply) to that table, fail-soft — a missing table (before you apply the migration) just logs a warning and changes nothing else.

**What this deliberately does NOT do yet:** nothing reads from this table. `api/memory-rollover.js` still extracts from curated notes/habit logs exactly as before — it hasn't been touched this round. Once you've confirmed real rows are accumulating correctly (§6), the next step is extending the rollover job to read from this table instead of (or alongside) its current sources. That's a separate, slightly bigger step, kept out of this one on purpose.

### Migration package — full review

**File:** `supabase/pending_migrations/20260705120000_conversation_messages.sql` (full contents also below)

**1. Does it affect shared Supabase data?** It adds one new table and nothing else — no existing table, column, row, or RLS policy is touched. Preview and `main` share this database; `main`'s deployed code has no reference to this table anywhere, so applying this migration changes nothing about how `main` behaves. Real data only ever gets written when your account uses the Companion screen (preview-only UI) — there's no other writer.

**2. Is it additive-only?** Yes — entirely `create table if not exists` / `create index if not exists` / a single RLS policy scoped to `auth.uid() = user_id`. Nothing is altered, dropped, or renamed.

**3. Rollback, if you ever want to undo it:**
```sql
drop table if exists public.conversation_messages;
```
Safe — nothing else references this table yet (the rollover job hasn't been wired to read from it).

**4. Pre-apply checklist:**
- [ ] Read the full SQL below (or the file directly).
- [ ] Confirm you're applying it to the same Supabase project this branch already uses (`apdmvbzfjuvxworjepze`, per the prior migrations' verified checks).
- [ ] No backup needed beyond your normal one — this is a brand-new, empty table.

**5. How to apply:** same as the two prior migrations on this branch — either (a) paste the SQL into the Supabase SQL editor and run it, or (b) move/rename the file into `supabase/migrations/` with a fresh timestamp and run it through this project's normal migration process.

**6. Post-apply checklist:**
- [ ] `select * from public.conversation_messages limit 1;` — should return zero rows, no error (confirms the table exists and RLS didn't block an empty select).
- [ ] Use the Companion screen (send a message, get a reply).
- [ ] `select role, day, situation, left(content, 60), created_at from public.conversation_messages order by created_at desc limit 10;` — should show your just-sent turn(s), one row per user message and one per assistant reply.
- [ ] Confirm the app itself shows no difference in behavior — this is purely a background write, nothing user-visible changes.

**Full migration SQL** (identical to the staged file):
```sql
create table if not exists public.conversation_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  situation  text,
  created_at timestamptz not null default now()
);

create index if not exists conversation_messages_user_day_idx
  on public.conversation_messages (user_id, day);

alter table public.conversation_messages enable row level security;

drop policy if exists "Own conversation_messages" on public.conversation_messages;
create policy "Own conversation_messages"
  on public.conversation_messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```
(The staged file has considerably more inline commentary explaining each choice — this is the executable content only.)

---

## 4. Files touched this round

| File | What | Risk |
|---|---|---|
| `supabase/pending_migrations/20260705120000_conversation_messages.sql` | New, staged, **not applied**. See §3 for full review. | None until applied — it's just a file. Once applied: low (additive-only, new table, no existing data touched). |
| `src/screens/CompanionScreen.jsx` | Added `persistConversationMessage()` (fail-soft insert) and three call sites: after a user message is added, after an assistant reply is finalized (streaming path), and after the non-streaming fallback path. Not awaited at the call site — never adds latency to the conversation. | Low — purely additive; if the table doesn't exist yet, every call catches its own error and logs a console warning, with zero effect on the existing send/receive flow (verified: `npm run build` passes, logic path unchanged for anyone who hasn't applied the migration). |

**No other files changed this round.**

---

## 5. Decisions made this round (and why)

**Split "build the memory architecture" into write-then-read instead of one big step.** The temptation was to stage the table *and* wire the rollover job to read from it in one pass, since that's the actual end goal. Didn't do that — writing to a new table is a small, easily-verified, fully reversible change (check row count, done); rewiring an existing, real, production-relied-upon nightly job to read from a *new, unverified* data source in the same pass would compound two unverified things together. Confirming rows land correctly first de-risks the read-side change that follows.

**No embedding column on this table.** Matches the memory-architecture design from last round explicitly: `conversation_messages` is a recency-bounded window for the rollover job to read, not something searched directly by similarity. Only the compressed `memory_facts` layer gets embedded. Kept that decision consistent rather than convenient-but-inconsistent (adding a vector column "just in case" would contradict the design written down last round).

**Reused the exact RLS/insert pattern from the existing `memory_facts` client-side write**, rather than inventing a new trust model. `OnboardingScreen.jsx`'s ChatGPT-import save already establishes "client-side insert is fine because RLS already scopes it to `auth.uid() = user_id`" — same reasoning applies here, no reason to route this through a new server endpoint.

**Fire-and-forget, not awaited.** The persistence call is genuinely background bookkeeping — awaiting it would tie the visible "did my message send" experience to a write whose only job is helping a future nightly job, which is exactly backwards.

---

## 6. Risks / open items

- **Nothing has been verified against a real database yet** — no Supabase write access from this sandbox. The `npm run build` passing confirms the code is syntactically and logically sound (no reference errors, same control flow for both the migration-applied and migration-not-yet-applied cases), but "rows actually land correctly" needs your hands (see the post-apply checklist in §3).
- **The migration is unapplied by design** — nothing changes about your actual data until you choose to run it.
- **The rollover job still doesn't read this table** — extraction, XP judgment, and the greeting narrative are all unaffected by this round; they still work exactly as before, from the same sources as before.
- Everything from the prior round's risk list (Blue Ember unverified in the real app, transcription word-loss diagnosed-not-fixed, XP collision needs your call, two chat surfaces still both live, ElevenLabs connectivity unknown from this sandbox) still stands unchanged — see §8 for the preserved detail.

---

## 7. How to test

1. **Before applying the migration:** use the Companion screen normally — nothing should look or feel different. If you open the browser console, you may see a warning like `[companion] conversation_messages insert failed (migration likely not applied yet)` — that's expected and harmless.
2. **Apply the migration** — see §3 for the exact SQL and steps.
3. **After applying:** use the Companion screen again (send a couple of messages, get replies) — then run the verification query from §3's post-apply checklist and confirm rows are showing up with the right `role`/`day`/`situation`/`content`.
4. **Confirm no regression:** the conversation itself should look, sound, and behave identically to before this change — this step is invisible by design.

---

## 8. Next 3 steps

1. **You confirm rows are landing correctly** (§7) once you've applied the migration — this is the gate before touching the rollover job.
2. **Extend `api/memory-rollover.js` to read from `conversation_messages`** instead of (or alongside) curated notes/habit logs — the actual payoff of this step, and a real code change to a live nightly job, so it'll get its own careful review pass rather than being bundled into this step.
3. **Start 2b in parallel** — retire the old CoachBar/modal drawer. Doesn't depend on 2a, and it's been flagged for six rounds now.

---

## Appendix — preserved detail from the round that proposed Phase 2

*(Kept verbatim for reference rather than re-litigated each round. Supersedes nothing above; §1-§2 are the current summary of this material.)*

### Full Phase 2 sequencing reasoning

**2a. Build the real memory architecture first.** Everything else depends on this existing. Without it, "remove the old mental model" just means deleting screens with nowhere for that functionality to actually go — the companion needs somewhere to read/write habit-like state from conversation before habits-as-screens can stop being the primary interface for it.

**2b. Retire the redundant old chat surface** (CoachBar + modal `AICoach` drawer). This is also a prerequisite for 2c-2e: you can't credibly "remove the old mental model" while a second, parallel implementation of it is still sitting there.

**2c. Reframe Today around the companion, not a checklist.** Today's current job assumes the user is the one doing the bookkeeping. If the companion is doing that bookkeeping by noticing what you say, Today's job changes to a quiet, secondary log of what got captured (for correction/inspection), not a screen you visit to manage your day.

**2d. Make an explicit call on XP.** Two systems running in parallel: the real, deterministic, per-tap total (production, load-bearing), and the AI-judged observational total (preview-only, currently just logged, not shown). Pick one of: (i) the AI-judged version becomes the real, user-facing total and the per-tap system is retired, (ii) formally merge them with clear rules, or (iii) keep them parallel on purpose (weakest option).

**2e. Only then, rename.** "Coach" frames the AI as an instructor; "companion" implies a peer. `coachMemory`, `coachName`, `buildCoachSystemPrompts`, `AICoach.jsx` are load-bearing identifiers — renaming before 2a-2d are actually true would just be cosmetic.

**On "Eyes":** no literal feature/screen by that name was found in the codebase — read as shorthand for the tracking/surveillance framing of habit-logging in general, addressed via 2c/2d. Flag directly if something more specific was meant.

**Not proposed:** deleting the Arc/habit data model or its tables. Proof-actions-as-habits remains a reasonable mechanism for the companion to use when committing to something concrete — the change is that it stops being the primary interface and primary source of truth for progress.

### Full memory architecture diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. RAW LAYER — conversation_messages                             │
│    Every turn, every day. Ground truth, written live.             │
└───────────────────────────┬────────────────────────────────────┘
                             │ nightly rollover reads recent days
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. EXTRACTION (existing job)                                      │
│    - daily_summaries row (title, narrative, structured, xp)       │
│    - memory_facts rows (atomic, durable, embeddable)               │
│    - updated coach_memory.content (rolling prose, size-capped)     │
└───────────────────────────┬────────────────────────────────────┘
                             │ embeddings generated for memory_facts
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. RETRIEVAL (the missing piece)                                   │
│    Embed the current message, vector-search memory_facts (top-K,  │
│    regardless of recency), inject into system_volatile.           │
└───────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. IMPORTED HISTORY (ChatGPT export)                               │
│    Long-term: converge onto the same pipeline as #2, backdated.   │
└─────────────────────────────────────────────────────────────────┘
```

Deliberate scope decision: don't embed raw `conversation_messages` for long-term semantic search — only `memory_facts`. Keep `conversation_messages` as a recency-bounded window (30-90 days) the rollover job reads, not something queried directly at reply-time.

### Prior round's other changes (still live, unrelated to this round)

- **Blue Ember** — implemented: calm mid-blue (soft sky-blue core cooling to muted steel-blue), idle state dims toward the background (opacity-only, ~half-brightness, new `emberBreatheDormant` animation), full brightness on listening/thinking/speaking. Unverified in the real app — confirmed only via a disposable rendered preview.
- **Transcription word-loss after a pause** — investigated, not fixed. Confirmed `continuous=true` is already active on desktop (rules out a JS-level restart there); the likely cause is a native browser-engine artifact below the level of any event the code receives. `continuous=false` on iOS/Android is an intentional prior workaround for a worse bug — not changed blind. Real fix (custom audio capture bypassing native `SpeechRecognition` chunking) named as a sized future item, not attempted this round.
