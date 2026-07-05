# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface. Being built for one user first — the bar is "would you use this instead of ChatGPT for life updates, reflection, planning, and thinking."
**Last updated:** 2026-07-05 (conversation modes, strengthened) — confirmed modes are genuinely injected into the model's system prompt (traced the exact path, see §3), then rewrote all five modes' steering text to mirror your exact requirements more precisely (Build now names your actual projects, Think explicitly allows a short-reply exception, Reflect explicitly targets emotional tone), and added a persistent mode-hint line under the Ember's status text so you never have to reopen the dropdown to remember what the current mode is for.

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

## 3. This round's change — conversation modes, confirmed and strengthened

**First, the direct answer you asked for: are modes actually injected into the model's prompt?** Yes — traced the exact path rather than assuming:
1. `CompanionScreen.jsx`'s `send()` builds `stableWithSituation` by appending the selected mode's `steer` text (plus the shared `RESPONSE_STYLE_STEER`) onto `system_stable`.
2. That's sent as `system_stable` in the `/api/chat` request body.
3. In `api/chat.js` (protected, read-only for this check), `buildSystemBlocks(systemStable, ...)` takes that exact string and makes it the primary cached system-prompt text block sent to Claude.

So this was never decorative — every mode's steering text has been reaching the model since it was introduced. What needed work was precision: the existing steer text (written two rounds ago, in paraphrase) didn't fully match what you'd now specified in your own words.

**What changed, in `src/screens/CompanionScreen.jsx` only:**
- **All five modes' steer text rewritten** to mirror your requirements directly instead of an earlier paraphrase:
  - **Just chat** — now explicitly "relaxed... but still genuinely useful, not just filler."
  - **Build** — now explicitly names your actual projects ("Forged, CloseCraft, sales, websites, product and business decisions") as real, not-hypothetical territory, and adds "take a real position, don't hedge into a menu of options."
  - **Think** — now explicitly says a short reply is a failure *unless you explicitly ask for something short* (previously had no exception at all), and explicitly lists "ideas, context, memory, patterns, and possible futures" as what to connect, matching your wording almost verbatim.
  - **Decide** — tightened to "give a real recommendation... and explain the tradeoffs that led you there, not instead of giving one" (previously implied this, now states it directly).
  - **Reflect** — now explicitly names "the emotional tone underneath it" and "what's actually worth remembering going forward" as its own targets, not folded into "patterns" generically.
- **New persistent mode-hint line**, under the Ember's "Tap to talk"/"Listening…"/"Thinking…"/"Speaking…" status text — always shows the current mode's one-line description (e.g. "Long-form, deep, connects ideas and patterns.") so you never have to reopen the dropdown mid-conversation to remember what mode you're in. This is separate from and in addition to the transient caption that flashes near the mode pill right when you switch (that one confirms "you just changed it"; this one is the permanent "here's what you're currently in").

**Verified:** `npm run build` passes; visually confirmed the new persistent hint line's layout/spacing via a disposable rendered preview (tight, unobtrusive, doesn't crowd the Ember) before shipping.

---

## 4. Files touched this round

| File | What | Risk |
|---|---|---|
| `src/screens/CompanionScreen.jsx` | Rewrote all five `SITUATIONS` entries' `steer` and `desc` text; added a persistent mode-hint line under the Ember's status text. No changes to `send()`'s plumbing, the carousel, or the Ember itself. | Low — text and one small additive UI element; the injection mechanism itself (already correct) is untouched. |

**No other files changed this round. No migration.**

---

## 5. Decisions made this round (and why)

**Answered "is this actually wired up" by tracing the real code path, not by re-describing the design.** You asked to confirm, and specifically to be shown where, if it's real — pointing at the exact three-hop path (steer text → `system_stable` → `buildSystemBlocks` in the protected `api/chat.js`) is a stronger answer than "yes, it's wired up," and it's also how the gaps between your wording and the existing steer text actually got found.

**Rewrote steer text to mirror your own phrasing rather than re-paraphrasing again.** Two rounds of my own paraphrasing had already drifted slightly from what you actually wanted (e.g., Build never named your real projects, Think had no explicit short-reply exception). Copying your intent more literally into the prompt reduces that drift and makes it easier for you to spot-check that the prompt says what you meant, next time you read this file.

**Added a persistent hint instead of only relying on the existing transient one.** The transient caption (added two rounds ago) answers "did my tap register" for a few seconds; it doesn't answer "what am I currently in" five minutes into a conversation. Both together cover both moments without removing something that already worked.

**Did not touch `RESPONSE_STYLE_STEER` (the shared anti-question-loop baseline) this round.** Your five mode descriptions were about *shape and stance* differences between modes, not about the shared baseline itself, which was already hardened last round ("hard constraint, not a soft preference"). No reason to re-open something not in scope this time.

---

## 6. Risks / open items

- **Unverified against real replies.** Same standing limitation as every prompt-steering change on this branch — this needs a handful of real exchanges per mode to judge whether the rewritten text actually produces the sharper differences described in §3, not just a stronger-sounding prompt.
- **Prompt engineering is still not a hard guarantee.** Flagged before and still true: even explicit, forceful instructions can be departed from by the model on a given reply. If a specific mode still doesn't feel distinct enough after real testing, the next lever is a mechanism (e.g., a server-side check), not a fourth round of stronger wording.
- Everything from prior rounds' risk lists (embeddings/retrieval not started, XP collision needs your call, two chat surfaces still both live, Blue Ember/transcription items, ElevenLabs connectivity) still stands unchanged — preserved in the appendix.

---

## 7. How to test (plain English)

1. **Open the mode dropdown** — confirm all five show a short description under the label.
2. **Pick a mode** — confirm the small caption flashes near the pill, and confirm a second, permanent line now sits under "Tap to talk" showing that same mode's description, staying there (not fading) until you switch modes again.
3. **Try the same real message in at least two different modes** — good test pairs: something work-related in **Build** vs. **Think** (Build should be short/direct/name-a-next-action; Think should be noticeably longer and more developed, connecting to things it remembers), or a real open decision in **Decide** (should state an actual recommendation, not a list) vs. **Just chat** (should feel like a relaxed reaction, not an analysis).
4. **Check Think specifically** — ask something that would normally get a one-line answer; the reply should still be substantive unless you explicitly say "briefly" or "short answer."

---

## 8. Next steps

1. **Real-world read on whether the modes now feel distinct** — the actual point of this round, needs your hands.
2. **Embeddings vendor decision** — still the real blocker for genuine cross-time retrieval (box 3 of the memory architecture), unresolved for several rounds now.
3. **2b — retire the old CoachBar/modal drawer** — doesn't depend on anything above, flagged for seven-plus rounds now.

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

### Phase 2a, step 2 (read side) — rollover reads real conversation, preserved for reference

`api/memory-rollover.js` now queries `conversation_messages` for the same candidate date window it already computes (isolated in its own `try`/`catch`, not folded into the main `Promise.all`, so a read failure falls back to the pre-existing habit/journal-only digest rather than breaking the job). `buildConversationDigest(rows)` turns a day's raw turns into a compact `User: .../Companion: ...` transcript, capped at `CONVERSATION_DIGEST_MAX_CHARS_PER_DAY` (default 4000 chars/day, env-overridable). Merged into the per-day digest sent to the extraction model alongside the existing habit/journal digest. Real correctness fix bundled in: a day with conversation but zero habit logs previously produced an empty digest and was silently skipped forever — conversation content alone is now enough to trigger a summary. Verified via a standalone mock-data logic test (formatting, truncation, blank-content filtering, and the conversation-only-day fix specifically) — not yet verified against a real Haiku call with real data (no Anthropic credentials in this sandbox; still needs a real rollover run to judge quality, per this round's §8).

### Other prior-round changes (still live, unrelated to memory architecture)

- **Blue Ember** — calm mid-blue (soft sky-blue core cooling to muted steel-blue), idle state dims toward the background (opacity-only, ~half-brightness, `emberBreatheDormant` animation), full brightness on listening/thinking/speaking. Unverified in the real app — confirmed only via a disposable rendered preview.
- **Transcription word-loss after a pause** — investigated, not fixed. `continuous=true` confirmed already active on desktop (rules out a JS-level restart there); likely a native browser-engine artifact below the level of any event the code receives. `continuous=false` on iOS/Android is an intentional prior workaround for a worse bug — not changed blind. Real fix (custom audio capture bypassing native `SpeechRecognition` chunking) named as a sized future item.
- **Conversation modes v3, greeting v3, iOS Chrome mic fix, stale-PWA banner, ElevenLabs connectivity checklist** — all still live and unchanged; see git history of this file for the full original write-ups if needed.
