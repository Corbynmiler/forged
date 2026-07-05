# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface. Being built for one user first — the bar is "would you use this instead of ChatGPT for life updates, reflection, planning, and thinking."
**Last updated:** 2026-07-05 (Phase 2a, step 2) — `conversation_messages` (staged last round) is now applied and confirmed writing correctly. This round wires `api/memory-rollover.js` to actually read from it, folding real conversation content into the nightly extraction digest alongside the existing habit/journal signals. No new migration this round — schema unchanged.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. The honest reassessment (read this first)

You asked directly: have we accidentally discovered a better product than the one we planned? **Yes — and the evidence is in what's actually happened over the last several rounds, not just in how it feels.**

Every round of real feedback has been about the companion surface (the Ember, the greeting, the conversation modes, memory, voice) — never once about Today, Arc, habits, streaks, or XP-as-a-tally. Those systems haven't been discussed, tuned, or endorsed in this entire branch; they've just been sitting underneath, unquestioned, while the actual product got redesigned around them repeatedly. Your own benchmark for this branch was never "is this a better habit tracker" — it was "would I use this instead of ChatGPT for life updates, reflection, planning, and thinking." That's a different product category, and this branch has been quietly building toward it without the roadmap ever saying so out loud.

The deeper tension is structural, not cosmetic: this branch's own stated direction — *"the AI should judge progress using context, not checklists," "keep XP explainable, but don't make it dependent on habits"* — is in direct conflict with Arc/habits/streaks, a fixed, deterministic, checklist-driven system by design. Every round of prompt-tightening on the rollover job has been quietly working *around* that tension, not resolving it. This round is the first one that actually starts resolving it — see §3.

**What this doesn't mean:** delete Today/Arc/habits outright. That data model is real, live, working code with real rows in a shared production database. It means the plan treats the companion as the product going forward and treats Today/Arc/habits as a *backing data source the companion reads and writes on your behalf* — not a set of screens you actively manage.

---

## 1. Phase 2 — the roadmap

**If Phase 1 was "prove a voice-first companion is technically viable" — Phase 2 is "stop layering the companion on top of the old app, and start collapsing the old app into the companion."**

| Step | What | Status |
|---|---|---|
| **2a. Memory architecture** | `conversation_messages` (raw per-turn log) → extraction → embeddings/retrieval. | 🔶 **In progress.** Write side: done, applied, verified. Read side (rollover extraction): done this round, unverified against a real rollover run (see §6). Embeddings/retrieval: not started — still the real blocker for genuine cross-time recall. |
| **2b. Retire the old CoachBar/modal drawer** | The floating chat surface that duplicates the Companion screen. | ⛔ Not started — next up, can run in parallel with the rest of 2a. |
| **2c. Reframe Today around the companion** | Today stops being a checklist you manage and becomes a quiet log of what the companion already captured. | ⛔ Not started — depends on 2a existing first. |
| **2d. Resolve the XP collision** | Deterministic per-tap XP vs. AI-judged observational XP — pick one, merge them, or make a deliberate call to keep both. | ⛔ Not started — your call, not mine (three options preserved in the appendix). |
| **2e. Rename Coach → Companion** | Only once 2a-2d make it true, not just cosmetic. | ⛔ Not started, intentionally last. |

Full reasoning for this sequencing is preserved in the appendix rather than repeated every round.

---

## 2. Memory architecture design (unchanged, still the target)

```
conversation_messages (raw, every turn) → nightly extraction (existing job)
  → daily_summaries / memory_facts / coach_memory
  → embeddings on memory_facts → similarity search at reply-time (retrieval)
  → ChatGPT import eventually converges onto this same pipeline, backdated
```

This round builds the arrow between box 1 and box 2 — real conversation content now actually reaches the extraction job. Box 3 (embeddings/retrieval) is still the piece that turns "you changed your opinion since April" from wishful thinking into something real; not started. Full diagram and reasoning preserved in the appendix.

---

## 3. This round's change — Phase 2a, step 2: rollover reads real conversation

**What changed, in `api/memory-rollover.js` only:**

1. **New query** against `conversation_messages` for the same candidate date window the job already computes, isolated in its own `try`/`catch` (not folded into the existing `Promise.all`) — so an environment where the migration somehow hasn't landed still gets the existing habit/journal digest working exactly as before, unaffected.
2. **New `buildConversationDigest(rows)` function** — turns a day's raw turns into a compact `User: .../Companion: ...` transcript, capped at `CONVERSATION_DIGEST_MAX_CHARS_PER_DAY` (**default 4000 characters/day**, overridable via that env var — a one-line change if you want it higher, no new config system).
3. **Merged into the existing per-day digest** — a day's final digest is now the habit/journal digest plus (if any exists) a "Conversation that day:" section, joined together. Both empty is skipped (unchanged); either one alone is enough to include the day (see next point).
4. **Real correctness fix, not just an addition:** previously, a day with real conversation but zero habit logs/journal entries produced an *empty* digest and was silently skipped — never summarized at all. That gap is now closed; conversation alone is enough to trigger a summary.
5. **No prompt rewrite needed.** The extraction system prompt already said it receives "habit logs, personal notes, evidence entries, conversation content" and already instructs "read what they actually said — notes, evidence entries, conversation content" when judging XP. That's been true in *wording* since two rounds ago; this change is what finally makes it true in *fact*. Nothing about the prompt text changed this round.

**Verified without live credentials, honestly:** wrote a standalone logic test (mock rows, no network — same pattern as this branch's earlier `test-rollover-logic.mjs`/`test-xp-clamp.mjs` checks) covering: empty/null rows, basic formatting, blank-content filtering, truncation past the 4000-char cap, and — the important one — that a conversation-only day (no habit logs) now produces a non-empty digest while a habit-only day (no conversation) is completely unaffected. All passed. This confirms the logic is sound; it does not confirm what a real Haiku call does with real conversation content in front of it — that needs a real rollover run (§6).

---

## 4. Files touched this round

| File | What | Risk |
|---|---|---|
| `api/memory-rollover.js` | Added `CONVERSATION_DIGEST_MAX_CHARS_PER_DAY` constant, `buildConversationDigest()`, a new fail-soft query against `conversation_messages`, and merged its output into the per-day digest fed to the extraction model. Fixed the "conversation-only day gets silently skipped" gap as a side effect of the merge logic. | Medium — this is a real behavioral change to a live, production-relied-upon nightly job (what the model actually sees, which affects `xp_delta`/`facts`/`narrative` output). Mitigated: fail-soft on the new query (falls back to old behavior on any read error), a character cap bounding cost, and standalone logic tests before shipping. Since preview and `main` are separate deployments, this only runs inside the preview deployment regardless. |

**No other files changed this round. No migration — schema was already applied last round.**

---

## 5. Decisions made this round (and why)

**Isolated the new query in its own try/catch rather than adding it to the existing `Promise.all`.** `Promise.all` fails all-or-nothing; if the new query ever errored in some environment, bundling it in would risk breaking the four existing, working queries (habit rows, journal rows, rolling memory, active Arc) that this job has depended on for months. Isolating it means the worst case is "no conversation content this run," never "the whole job breaks."

**Fixed the conversation-only-day gap deliberately, not as an accidental side effect left unremarked.** Calling it out explicitly here because it's a real behavior change beyond "wire up the new data source" — previously, a day where you only talked to the companion and logged nothing would never get a title, a narrative, or an XP judgment at all. Worth knowing this was silently true before this round.

**Capped conversation length per day with a plain constant + env override, not a smarter summarization/pre-truncation scheme.** You said "make it easy to increase later... but don't overcomplicate it yet." A `parseInt(process.env.X || "4000", 10)` constant is a one-line change to raise, matches the exact pattern already used by `TTS_MONTHLY_CHAR_LIMIT` in `api/tts.js`, and needed zero new infrastructure. Truncates from the end with a visible `[…truncated]` marker rather than trying to be clever about *which* part of a day's conversation matters most — that's a real design problem (recency vs. importance) worth solving properly later if it ever actually triggers, not guessed at now.

**Verified via a standalone logic test instead of just reading the code twice.** Same discipline as this branch's very first XP-clamping check — a plain assertion script costs a few minutes and catches real edge cases (the conversation-only-day gap was actually confirmed, not just asserted, this way) that re-reading code carefully can still miss.

**Did not touch the system prompt.** It already asked for exactly this ("conversation content") in language written two rounds ago — changing prompt wording in the same pass as changing what data actually flows in would make it harder to tell, later, whether an output-quality change came from the new data or new wording. Isolate the variable.

---

## 6. Risks / open items

- **Unverified against a real Haiku call with real conversation content.** No Anthropic credentials in this sandbox. The logic that assembles the digest is tested (§3); what the model actually *does* with a real transcript in front of it — does `xp_delta` genuinely start reflecting conversation-only effort, does `narrative` start naming things you only ever said out loud, not logged — needs a real rollover run against real data.
- **Cost is now somewhat conversation-length-dependent** where it wasn't before, bounded by the 4000 char/day cap (roughly ~1000 extra tokens/day in the worst case, on top of the existing habit/journal digest) — worth keeping an eye on `input_tokens` in the job's own logging (already present) after a few real runs.
- **The embeddings/retrieval piece (box 3 of the architecture) still doesn't exist.** This round makes the *input* to nightly extraction richer; it does not yet give the companion a way to reach back further than the rolling summary window at reply-time. "You changed your opinion since April" still isn't possible yet — that's still blocked on the embeddings vendor decision.
- Everything from prior rounds' risk lists (Blue Ember unverified in the real app, transcription word-loss diagnosed-not-fixed, XP collision needs your call, two chat surfaces still both live, ElevenLabs connectivity unknown from this sandbox) still stands unchanged — preserved in the appendix.

---

## 7. How to test (plain English)

Rollover only processes **unsummarized** days — it never re-runs a day that already has a `daily_summaries` row. So the real test needs either a fresh day to roll over naturally, or a day you know is still unsummarized:

1. **Talk to the Companion screen today** (or on any day that hasn't rolled over yet) — a real conversation, not just a one-line test, so there's actual substance for the model to work with.
2. **Let that day roll over naturally** — this happens the next time the app calls the rollover endpoint for an account with an unsummarized prior day (normally triggered automatically; if you want to force it sooner, the endpoint is `POST /api/memory-rollover` with your auth token and a `client_date`, but the normal flow of just using the app the next day is the simplest test and needs nothing extra from you).
3. **Read the result** — the greeting on the day *after* the rollover, and/or query `daily_summaries` directly for that date:
   ```sql
   select date, title, structured->>'narrative' as narrative, xp_awarded, xp_reason
   from public.daily_summaries
   where user_id = auth.uid()
   order by date desc limit 3;
   ```
4. **Judge it against what actually happened that day, specifically in conversation** — did the narrative/xp_reason reference something you only ever *said*, not logged as a habit? That's the signal this round's change is supposed to produce. If a day had real conversation but no habit logs and it still got a title/narrative/xp at all (rather than being skipped entirely), that alone confirms the correctness fix in §3.4 worked.

---

## 8. Next steps

1. **A real rollover run against real data** — the only way to actually judge whether this round's change improved anything, per §7. Needs a day or two of normal use.
2. **Embeddings vendor decision** (Voyage API vs. a Supabase Edge Function running `gte-small`) — this is the actual remaining blocker for real cross-time retrieval, box 3 of the architecture, and has been sitting unresolved for a while now.
3. **2b — retire the old CoachBar/modal drawer.** Doesn't depend on any of the above, and it's been flagged for six-plus rounds now.

---

## Appendix — preserved detail from earlier rounds

*(Kept verbatim for reference rather than re-litigated each round. §1-§2 are the current summary of this material.)*

### Full Phase 2 sequencing reasoning

**2a. Build the real memory architecture first.** Everything else depends on this existing. Without it, "remove the old mental model" just means deleting screens with nowhere for that functionality to actually go.

**2b. Retire the redundant old chat surface** (CoachBar + modal `AICoach` drawer). A prerequisite for 2c-2e: you can't credibly "remove the old mental model" while a second, parallel implementation of it is still sitting there.

**2c. Reframe Today around the companion, not a checklist.** Today's job changes to a quiet, secondary log of what got captured (for correction/inspection), not a screen you visit to manage your day.

**2d. Make an explicit call on XP.** Two systems running in parallel: the real, deterministic, per-tap total (production, load-bearing), and the AI-judged observational total (preview-only, currently just logged, not shown). Pick one of: (i) the AI-judged version becomes the real, user-facing total and the per-tap system is retired, (ii) formally merge them with clear rules, or (iii) keep them parallel on purpose (weakest option).

**2e. Only then, rename.** "Coach" frames the AI as an instructor; "companion" implies a peer. `coachMemory`, `coachName`, `buildCoachSystemPrompts`, `AICoach.jsx` are load-bearing identifiers — renaming before 2a-2d are actually true would just be cosmetic.

**On "Eyes":** no literal feature/screen by that name was found in the codebase — read as shorthand for the tracking/surveillance framing of habit-logging in general, addressed via 2c/2d.

**Not proposed:** deleting the Arc/habit data model or its tables. Proof-actions-as-habits remains a reasonable mechanism for the companion to use when committing to something concrete.

### Full memory architecture diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. RAW LAYER — conversation_messages                             │
│    Every turn, every day. Ground truth, written live.             │
│    ✅ Applied. ✅ Client writes confirmed. ✅ Rollover now reads it. │
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
│ 3. RETRIEVAL (the missing piece — not started)                    │
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

### Phase 2a, step 1 (write side) — migration review, preserved for reference

Applied and confirmed working (verified: real rows landed with correct `role`/`day`/`situation`/`content` after using the Companion screen). Full original SQL:

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

Rollback if ever needed: `drop table if exists public.conversation_messages;` — no longer fully side-effect-free now that the rollover job reads from it (see §3), but still safe (rollover's read is fail-soft and falls back to the pre-existing habit/journal-only digest if the table disappears).

`src/screens/CompanionScreen.jsx` writes to this table via `persistConversationMessage()` — fire-and-forget, not awaited, three call sites (user message, streaming assistant finalization, non-streaming fallback).

### Other prior-round changes (still live, unrelated to memory architecture)

- **Blue Ember** — calm mid-blue (soft sky-blue core cooling to muted steel-blue), idle state dims toward the background (opacity-only, ~half-brightness, `emberBreatheDormant` animation), full brightness on listening/thinking/speaking. Unverified in the real app — confirmed only via a disposable rendered preview.
- **Transcription word-loss after a pause** — investigated, not fixed. `continuous=true` confirmed already active on desktop (rules out a JS-level restart there); likely a native browser-engine artifact below the level of any event the code receives. `continuous=false` on iOS/Android is an intentional prior workaround for a worse bug — not changed blind. Real fix (custom audio capture bypassing native `SpeechRecognition` chunking) named as a sized future item.
- **Conversation modes v3, greeting v3, iOS Chrome mic fix, stale-PWA banner, ElevenLabs connectivity checklist** — all still live and unchanged; see git history of this file for the full original write-ups if needed.
