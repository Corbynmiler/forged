# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface. Being built for one user first — the bar is "would you use this instead of ChatGPT for life updates, reflection, planning, and thinking."
**Last updated:** 2026-07-05 (strategic re-baseline + small fixes) — implemented the Blue Ember direction, investigated (but did not blind-fix) the mid-pause transcription drop, and — the main thing this round — wrote an honest reassessment of what this branch has actually become, a concrete memory architecture design, and a real Phase 2 proposal. **No large removal/rename work was done this round — that's a decision for you to review first, per your explicit instruction.**

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. The honest reassessment (read this first)

You asked directly: have we accidentally discovered a better product than the one we planned? **Yes, I think so — and the evidence is in what's actually happened over the last five rounds, not just in how it feels.**

Every round of real feedback has been about the companion surface (the Ember, the greeting, the conversation modes, memory, voice) — never once about Today, Arc, habits, streaks, or XP-as-a-tally. Those systems haven't been discussed, tuned, or endorsed in this entire branch; they've just been sitting underneath, unquestioned, while the actual product got redesigned around them three times. Your own benchmark for this branch was never "is this a better habit tracker" — it was "would I use this instead of ChatGPT for life updates, reflection, planning, and thinking." That's not a habit-tracker question. That's a different product category, and this branch has been quietly building toward it for a while without the roadmap ever saying so out loud.

The deeper tension is structural, not cosmetic: this branch's own stated direction — *"the AI should judge progress using context, not checklists," "keep XP explainable, but don't make it dependent on habits"* — is in direct conflict with Arc/habits/streaks, which is a fixed, deterministic, checklist-driven system by design. You can't fully get to "judged from context" while the thing supplying most of the context is a rigid proof-action checklist. Every round of prompt-tightening on the rollover job has been quietly working *around* that tension, not resolving it. It doesn't resolve until the underlying model changes.

**What I don't think this means:** delete Today/Arc/habits outright, today, in this round. That data model (habits, logs, streaks, Arc, XP) is real, live, working code with real rows in a shared production database — and per your own instruction this round, big removal work happens *after* you've reviewed the plan, not before. What it does mean is that the plan below (Phase 2) treats the companion as the product going forward and treats Today/Arc/habits as a *backing data source the companion reads and writes on your behalf* — not a set of screens you actively manage. That's a real, large shift, and I think it's the right one.

---

## 1. Phase 2 — the new roadmap

**If Phase 1 was "prove a voice-first companion is technically viable"** (Ember, memory schema, streaming voice, conversation modes, the greeting) **— Phase 2 is "stop layering the companion on top of the old app, and start collapsing the old app into the companion."**

Proposed sequence — each step is a real prerequisite for the next one, not an arbitrary ordering:

**2a. Build the real memory architecture first.** Everything else below depends on this existing. See §2 for the full design. Without it, "remove the old mental model" just means deleting screens with nowhere for that functionality to actually go — the companion needs somewhere to read/write habit-like state from conversation before habits-as-screens can stop being the primary interface for it.

**2b. Retire the redundant old chat surface** (CoachBar + modal `AICoach` drawer). Flagged for five rounds now. This is overdue on its own merits, and it's also a prerequisite for 2c-2e: you can't credibly "remove the old mental model" while a second, parallel implementation of it is still sitting there.

**2c. Reframe Today around the companion, not a checklist.** Today's current job — "show habit-completion state, let the user tick things off" — assumes the user is the one doing the bookkeeping. If the companion is doing that bookkeeping *by noticing what you say*, Today's job changes to something more like: a quiet, secondary log of what got captured (for correction/inspection), not a screen you visit to manage your day. This is a real redesign of that screen's purpose, not a rename.

**2d. Make an explicit call on XP.** Right now there are two XP systems running in parallel: the real, deterministic, per-tap total (production, load-bearing), and the AI-judged observational total (preview-only, currently just logged, not shown). They are on a collision course by design — this branch has spent two rounds pushing the AI-judged version further from checklists specifically. Phase 2 needs to pick one of: (i) the AI-judged version becomes the real, user-facing total and the per-tap system is retired, (ii) they're formally merged with clear rules for how each contributes, or (iii) they stay parallel on purpose (weakest option — it's the thing currently keeping both mental models alive at once).

**2e. Only then, rename.** "Coach" frames the AI as an instructor in a hierarchical relationship; "companion" (your own word, and "mate-to-mate" for the default mode) implies a peer. That's not just UI copy — `coachMemory`, `coachName`, `buildCoachSystemPrompts`, `AICoach.jsx` are load-bearing identifiers throughout the codebase. Renaming them is mechanical but not risk-free (it's the protected personality file, plus every consumer of its exports), and renaming before 2a-2d are actually true would just be cosmetic — the code would say "companion" while still behaving like a coach watching a checklist. Do this last, once it's true.

**On "Eyes":** I couldn't find this as a literal feature/screen name anywhere in the codebase — if you meant something specific, point me at it directly next round. I've read it as shorthand for the tracking/surveillance framing of habit-logging in general ("is the app watching whether I did the thing") and addressed that as part of 2c/2d above.

**What I'm not proposing:** deleting the Arc/habit data model or its tables. Proof-actions-as-habits is still a reasonable mechanism for the companion to use *when you actually want to commit to something concrete* (Build mode already implies this) — the change is that it stops being the primary interface and the primary source of truth for progress. If, after 2a-2d, it turns out large parts of that code are genuinely dead weight, I'd rather say so explicitly then and cut it than pre-emptively guess now.

---

## 2. Memory architecture — designed now, not yet built

The goal stated directly: real callbacks like *"you're doing the same thing you did while rebuilding Forged"* or *"you've changed your opinion on this since April"* — not fabricated, not vague, actually grounded in something real that happened. Here's how the four pieces already in play (or already planned) compose into one system:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. RAW LAYER — conversation_messages (not yet built)             │
│    Every turn, every day, forever (or until pruned). Ground      │
│    truth. Written live as the conversation happens, not just     │
│    reconstructed after the fact from localStorage.                │
└───────────────────────────┬────────────────────────────────────┘
                             │ nightly rollover reads recent days
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. EXTRACTION (existing job, already reading real content)       │
│    Produces, per day:                                            │
│    - daily_summaries row (title, narrative, structured, xp)      │
│    - memory_facts rows (atomic, durable, embeddable)              │
│    - updated coach_memory.content (rolling prose, size-capped)    │
└───────────────────────────┬────────────────────────────────────┘
                             │ embeddings generated for memory_facts
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. RETRIEVAL (the missing piece — this is what makes callbacks   │
│    real instead of recency-biased or fabricated)                 │
│    Before each reply: embed the user's current message, run a    │
│    vector similarity search against memory_facts (top-K,         │
│    regardless of recency), inject the results into                │
│    system_volatile alongside the existing rolling summary.        │
└───────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. IMPORTED HISTORY (ChatGPT export — exists today, onboarding-   │
│    only, bespoke one-shot extraction straight to memory_facts).   │
│    Long-term: converge this onto the SAME extraction pipeline as  │
│    #2, just backdated — "day zero," not a permanently separate    │
│    code path.                                                     │
└─────────────────────────────────────────────────────────────────┘
```

**Why this, specifically, answers "you changed your mind since April":** today, the model only ever sees the rolling `coach_memory` prose plus the last 3-7 days of `daily_summaries` — genuinely nothing from April survives that window unless it happens to still be phrased into the ever-shrinking rolling summary. Without retrieval, asking the model to recall April forces a choice between hallucinating a plausible-sounding answer (fake memory — exactly what you said you don't want) or honestly saying it doesn't know. Layer 3 (retrieval) is what actually closes that gap — it's not a new idea, it's the same `recall` tool / embeddings-vendor decision already sitting on the roadmap as a blocked item; this design just makes explicit *why* it's the thing that matters most, not just another nice-to-have.

**A deliberate scope decision, stated explicitly so it doesn't get silently assumed later:** don't embed raw `conversation_messages` for long-term semantic search — only `memory_facts` (already compressed, durable, individually meaningful). Keep `conversation_messages` itself as a recency-bounded window (say, 30-90 days) that the *rollover job* reads for extraction, not something queried directly at reply-time. This keeps embedding cost and retrieval complexity bounded — search the compressed signal, not the entire raw transcript of a life.

**Sequencing relative to Phase 2 above:** this is 2a. Nothing else in Phase 2 has real teeth without it.

---

## 3. This round's concrete changes

### Blue Ember — implemented
Recolored (not reshaped) from Moonstone (pale lavender-white) to a calm mid-blue: a soft sky-blue highlight cooling to a muted steel-blue edge — deliberately not cyan/electric, not navy-dark, landing between ChatGPT voice mode's blue and Apple Intelligence's blue. **New this round, not just a recolor:** the idle state is now deliberately dimmed — both the core and the ambient bloom drop to roughly half-opacity at idle (a smooth 0.7s transition, no size/shape change) and use a much subtler dedicated breathing animation (`emberBreatheDormant`, new — previously idle and thinking incorrectly shared one animation). Listening/thinking/speaking are all full-brightness and visually distinct from each other, same as before. Verified visually in a disposable Playwright-screenshotted preview (delivered in chat this round) before porting into `CompanionScreen.jsx`.

### Transcription word-loss after a 1-2s pause — investigated, not blind-fixed
Traced through `useSpeechInput.jsx` carefully rather than guessing at a fix. Findings:

- **On desktop** (the likely test environment, based on "I paused for 1-2 seconds"): `recog.continuous` is already `true` — confirmed by reading the actual branching logic, not assumed. In `continuous` mode, the browser's own speech engine is *not* supposed to end the session over a short pause; it should keep listening and simply mark the just-spoken phrase as final while continuing to accept new audio in the same session. **This means the JS-level "session ends, then gets restarted" theory does not apply on desktop** — there is no restart happening for a short pause there. The most likely explanation is a boundary artifact inside the browser's own native continuous-recognition pipeline itself (a documented behavior across Chrome/Safari's Web Speech implementations: the first fragment of a new utterance right after a VAD-detected pause can get clipped) — this happens below the level of any event our code receives. There is no hook that exposes "the engine briefly stopped buffering audio internally"; we only ever see whatever transcript it decides to hand back.
- **On iOS/Android** (the SR-only path), `continuous` is intentionally forced `false` — a deliberate, previously-discovered workaround for a *worse* bug ("iOS WebKit: continuous=true often stops immediately," per the existing code comment). On these platforms, a pause genuinely does end the recognition session and trigger a real restart (a new `SpeechRecognition` instance, `.start()` called synchronously in `onend` — already the fastest the JS event loop allows), and there is a real, physical gap here where audio capture briefly isn't happening. This is a plausible, if smaller, contributor on mobile specifically.

**Why I didn't change `continuous` for iOS/Android this round:** flipping it back to `true` to close that gap directly risks reintroducing the "stops immediately" bug that caused it to be set to `false` in the first place — a platform quirk discovered through real device testing previously, which I have no way to re-verify in this sandbox. Changing platform-specific recognition config blind, on a bug I can't reproduce or test against a real mic, is exactly the kind of unverified guess that breaks things quietly on someone else's phone.

**The real, durable fix, named honestly rather than promising another prompt-level patch will close it:** stop relying on the browser's native `SpeechRecognition` chunking entirely — capture continuous raw audio ourselves (`MediaRecorder`/`AudioWorklet`) and run our own VAD/chunking against a real streaming ASR backend. That removes the "black box" behavior entirely, at the cost of being a genuine infrastructure project (server-side streaming ASR, cost, latency work), not a quick patch. Flagging this as a sized future item rather than shipping something unverified.

### Everything else requested this round
Deliberately **not** touched: Today/Arc/You/Coach naming, screen removal, memory-architecture implementation. Per your explicit instruction, this round's job was the reassessment above, not execution of it.

---

## 4. Files touched this round

| File | What | Risk |
|---|---|---|
| `src/screens/CompanionScreen.jsx` | Ember recolored to Blue; idle state now dims (opacity-only) instead of staying fully lit; new `emberBreatheDormant` keyframe replaces the idle/thinking animation that was previously (incorrectly) shared. | Low — color/opacity/animation-name change only, shape and state logic untouched. |

**No other files changed this round.** The transcription investigation produced no code change (see §3 for why). The strategic/architecture work is entirely this document.

---

## 5. Decisions made this round (and why)

**Wrote the reassessment as an actual opinion, not a balanced menu of options.** You asked directly whether we'd found a better product and said not to preserve old ideas out of inertia. Giving a hedged "here are three possible directions, you decide" answer would have dodged the actual question. Said plainly: yes, the evidence points at a category shift, here's the specific structural tension (checklist-XP vs. context-judged-XP) that proves it's not just a feeling, and here's a concrete sequenced plan — while being equally direct about what I'm *not* recommending (wholesale deletion, right now, without your review).

**Sequenced Phase 2 around a real dependency chain, not just a priority-ordered wishlist.** Each step (2a→2e) actually blocks the next one technically, not just "feels more important" — memory architecture has to exist before Today can stop being the primary interface for progress; the XP collision has to be resolved before renaming "Coach"→"Companion" means anything real instead of cosmetic.

**Did not implement the memory architecture or any renaming/removal this round.** You were explicit: "update the roadmap with this new direction before building anything major." Writing the design and the plan is this round's job; building 2a onward is next round's, after you've had a chance to push back on the sequencing itself.

**Investigated the transcription bug thoroughly and reported the finding honestly instead of shipping a guess.** Confirmed via code-reading (not assumption) that `continuous=true` already applies on desktop, which rules out the "restarting recognition" theory for the most likely test environment and points at a native-engine artifact instead. Named the real fix (custom audio capture, bypassing the browser's native chunking) rather than implying a small tweak would close what looks like an engine-level limitation.

**Implemented the Blue Ember directly, including the "recede at idle" behavior, rather than proposing more concepts first.** You'd already converged on a direction ("somewhere between ChatGPT voice blue and Apple Intelligence blue") specific enough to build, unlike the six-way fireball/moonstone exploration two rounds ago. Verified visually before committing, same discipline as every prior visual change.

---

## 6. Risks / open items

- **The Blue Ember is unverified in the real app** — confirmed visually via a disposable rendered preview (screenshot delivered in chat), not inside a real authenticated session.
- **The transcription word-loss is diagnosed, not fixed** — see §3. If it's mainly a mobile-only issue (the more likely-to-be-fixable half of it), worth confirming which platform you were testing on when you noticed it, so the next round's investigation (if you want one) starts from a narrower, more confident base.
- **Phase 2 (§1) and the memory architecture (§2) are designs, not code** — nothing about them has been built, tested, or even started.
- **The XP collision (2d) has no default answer yet** — this needs your call, not mine, since it changes what the user-facing number actually means.
- **Two chat surfaces (Ember + old modal drawer) are still live simultaneously** — unchanged, now six rounds flagged.
- Everything else from prior rounds (embedding column unpopulated, `conversation_messages` not built, migrations already applied and verified, ElevenLabs connectivity unknown from this sandbox — see the previous revision of this doc in git history for that checklist) still stands unchanged.

---

## 7. How to test / what to look at

- **Blue Ember:** open the Companion screen — confirm idle reads as calm/receded (not glowing), and confirm listening/thinking/speaking each clearly "wake up" to full brightness. Confirm the color reads as blue, not cyan, not navy, not purple/lavender.
- **Transcription:** if you're able, note specifically which browser/device you were on when you noticed the word-loss — that's the single most useful piece of information for narrowing this further, since desktop and mobile have genuinely different underlying mechanisms per §3.
- **Phase 2 / memory architecture:** nothing to click through — read §1 and §2, push back on anything that's wrong before it becomes code.

---

## 8. Next 3 steps

1. **Your review of §1 and §2** — specifically: does the 2a→2e sequencing seem right, and do you want to make the XP call (2d) now or defer it until 2a-2c are further along?
2. **If approved, start 2a** — stage `conversation_messages` (table only, not applied — same pattern as every prior migration on this branch) and design the retrieval step (embeddings vendor decision is the actual blocker here, still unresolved: Voyage API vs. a Supabase Edge Function running `gte-small`).
3. **Retire the old CoachBar/modal drawer (2b)** — can start in parallel with 2a since it doesn't depend on the memory architecture, and it's been overdue for five rounds independent of any of this.
