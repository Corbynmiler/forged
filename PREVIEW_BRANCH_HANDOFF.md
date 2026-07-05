# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface.
**Last updated:** 2026-07-05 (taste pass + roadmap re-baseline) — greeting rewritten from bullets to natural prose, conversation modes redesigned a second time around how AI actually gets used day-to-day, several Ember color/material concepts proposed (not implemented — pending your call), and the roadmap below re-baselined against how much the plan has actually moved since the original phase list.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. Master plan — re-baselined 2026-07-05

The original roadmap was written before the mid-session pivot ("stop asking how AI fits into Forged, ask how you'd build the best companion if the backend already existed"). That pivot changed what several phases actually mean. Re-baselined here rather than patched incrementally, per your request.

### Complete, and still the right shape
- **Faster voice replies** — sentence-chunked TTS, streamed/played back-to-back. Untouched by the pivot, still correct as originally scoped.
- **Memory layer (schema + extraction)** — `memory_facts`, `xp_events`, extended `daily_summaries` (title/commitments/emotional_context/structured/xp). Migrations applied and live. If anything, *more* central now than originally scoped — the pivot's whole thesis is "memory is the product."
- **ChatGPT memory import** — onboarding paste-and-review step. Done, unaffected by the pivot.

### Complete as originally scoped, but the direction has since evolved further
- **AI-judged XP.** Originally: a cautious, additive nightly 0-50 judgment that observes but never touches the real total — that part is done and live. But the standing instruction since the pivot ("don't make XP dependent on habits... judge progress using context, not checklists") asks for more than the original scope intended. The rollover prompt has been tightened twice toward this (natural phrasing, weigh-narrative-over-tally), but the structural ceiling is real: the judgment still can't see actual conversation content, only curated notes and habit logs. Not finished — it grew a longer tail than the original phase list accounted for. See "Remaining" below.
- **The Companion screen itself.** Originally scoped as "a mic-first screen added to the existing Forged navigation." It's since become the thing the pivot was actually about: the home screen's default identity, with the old app chrome suppressed entirely, its own visual presence (the Ember), its own interaction model (a floating carousel, never a chat log), and its own conversation-mode taxonomy designed around real AI usage patterns rather than generic coaching postures. This is now three redesign rounds deep (see §1 history below) and still actively being refined at your direction — that's expected, not scope creep, given this is explicitly the exploratory part of the branch.

### No longer relevant — superseded, not just "done"
- **"Coach auto-open on load"** (the original Phase 1 idea — make the coach the first thing you see, inside the old app shell). Fully obsolete: there's no more "old app + auto-opened coach," the Companion screen replaced the home experience outright. Subsumed and exceeded.
- **"Phase 6 as a notifications-vs-real-screen decision."** The original roadmap had these competing for the same slot. That framing is dead — the real screen already got built (that's the entire pivot), and notifications are now just a smaller, non-blocking future item, not a fork in the road.
- **Conversation modes v1** (I'm planning / I'm building / I'm stuck / I need perspective) — literally replaced this turn by v2 (Just chat / Build / Think / Decide / Reflect), which is designed around actual AI-usage patterns rather than generic coaching postures. The old five no longer exist in the code.
- **Greeting-as-bullet-list** — replaced this turn by natural prose. The bulleted format itself (not just its content) is gone from the code.

### Remaining roadmap, re-baselined
1. **Ember color/material direction — your call, blocking further Ember work.** Several concepts proposed this turn (not implemented). Nothing else Ember-related should move until you pick a direction or ask for more concepts.
2. **Hand-test this round** — greeting prose, modes v2, and everything from the prior polish pass (transcript bugs, carousel, Ember shape). In progress on your end.
3. **Retire the old CoachBar / modal drawer.** Flagged for three sessions running, still not done. Two ways to reach the same conversation is a real inconsistency, not a nice-to-have cleanup.
4. **`conversation_messages` (raw per-turn transcript, server-side).** The actual structural fix for "judge from context, not checklists" — stage the table, wire the Companion screen to persist every turn (fail-soft, same pattern as every other new write this branch), then extend the rollover digest-builder to read from it. This is what finally lets XP judgment (and the greeting narrative, and facts extraction) see what was really said instead of only curated notes.
5. **Embeddings vendor decision** (Voyage API vs. a Supabase Edge Function running `gte-small`). Unblocks real semantic retrieval and the `recall` tool's keyword→vector swap in the protected `api/chat.js`.
6. **Notifications rewrite.** Lower priority now — no longer gates anything.
7. **"What I remember" screen + Arc inference.** Lower priority, unstarted.

---

## 1. Session history (how we got here)

**Round 1 — mic-first Companion screen.** Situations, day-status line, dedicated Talk tab, transcript bubbles. Still read as "the old app with another chat screen."

**Round 2 — the pivot: Ember + living homepage.** Killed transcript-as-homepage, added the natural-language greeting, first Ember version (SVG turbulence filter distorting the core to fake an organic fire edge), demoted the transcript to a secondary "History" view.

**Round 3 — bug fixes + carousel.** Fixed the live-transcript-disappears-on-pause bug (was gated on `speech.interim`, which clears on every finalized phrase including ordinary pauses) and the transcript-hidden-while-thinking bug. Rebuilt the Ember around a clean, undistorted circle (the turbulence-warped shape read as an accident, not fire) with a breathing bloom, sonar rings, and a thinking-sweep instead. Replaced the single-pair/History-page pattern with an inline scrollable floating carousel. Shipped conversation modes v1 (planning/building/stuck/perspective) with a shared anti-question-loop steer. Cleaned up "Protect the Arc" and other old-Forged onboarding copy.

**Round 4 (this turn) — taste pass.**
- **Greeting: bullets → natural prose.** The "Yesterday you: • X • Y • Z" format still read as a generated report, not a friend recapping your day. Fixed at the source: `api/memory-rollover.js`'s extraction prompt now writes a `structured.narrative` field — one to two flowing, second-person sentences naming real events/projects/people ("You wrapped up the Companion redesign, played poker with the guys, and pushed the Azir meeting to next week.") — which the greeting shows verbatim. Older rows written before this field existed fall back to reading the old `wins` array as a joined sentence (`joinWinsAsSentence()`) rather than bullets, so nothing regresses for existing data; title/summary remains the final fallback.
- **Conversation modes v2 — designed around actual AI usage, not coaching postures.** Replaced I'm planning/I'm building/I'm stuck/I need perspective with **Just chat**, **Build** (founder/execution — terse, concrete, opinionated, assumes competence, skips clarifying questions), **Think** (long-form — explicitly told a short reply is a *failure* in this mode; tells stories, connects memories, goes deep instead of asking another question), **Decide** (has to have an opinion, challenges the framing, names the strongest counter-case — not neutral tradeoffs), **Reflect** (weekly-review energy, names patterns across memory as observations, not questions). Each mode's steer text now changes actual response *shape* (length, structure, stance), not just tone, on top of the shared `RESPONSE_STYLE_STEER` baseline from last round.
- **Ember color exploration — concepts only, nothing implemented.** See §8. Rendered and screenshotted six color/material directions on the exact same clean-circle shape/animation from last round (shape unchanged; only core gradient, bloom, ring, and spark colors vary), so the comparison is apples-to-apples. The current warm-ember palette is included as the baseline for comparison, not as a recommendation.

---

## 2. Files touched this session (Round 4)

| File | What | Risk |
|---|---|---|
| `api/memory-rollover.js` | Added `structured.narrative` to the extraction prompt — one to two ready, flowing, second-person sentences for tomorrow's greeting. No schema change (`structured` is already a jsonb column); `wins`/`hard_parts`/`slips` extraction unchanged. | Low — prompt-only change to a real nightly job, not protected. |
| `src/screens/CompanionScreen.jsx` | `composeGreeting()` now prefers `structured.narrative`, falls back to joining `wins` into a sentence for older rows, then to title/summary. Replaced `SITUATIONS` (v1 → v2, five new modes). No changes to send/stream logic, carousel, or Ember shape from last round. | Low-medium — greeting logic + prompt-steering text only. |

**Nothing was implemented for the Ember color exploration** — `ember-concepts-entry.jsx`/`ember-concepts.html` were a disposable rendering harness, screenshotted and deleted, never part of the repo.

**Still fully untouched:** `api/chat.js`, `src/coach/AICoach.jsx`, `src/coach/CoachApp.jsx`, `api/coach-summary.js`, `api/coach-intro.js`, `src/App.jsx`, `src/hooks/useSpeechInput.jsx`, `src/hooks/useCoachTts.jsx`, `src/screens/OnboardingScreen.jsx`, the real `supabase/migrations/` directory, all Stripe/billing files, `package.json`.

---

## 3. Decisions made this session (and why)

**Fixed the greeting's phrasing problem at the source again, not with a client-side rewrite.** Could have kept extracting `wins` as short phrases and joined them into a sentence at render time (which is in fact what the fallback path does). Chose to have the model write the actual greeting sentence directly instead, because "naming real events, projects, and people... in plain English" is a genuine prose-writing task — connective tissue, emphasis, which detail leads — and that's something the model does better in one pass than a client-side string-join ever will. Same reasoning as the phrasing fix two rounds ago: fix it where the data is written, so every future consumer of `daily_summaries` benefits, not just this screen.

**Kept the `wins`-joining fallback instead of only supporting the new field.** Existing rows in the database were written under the old prompt and will never retroactively gain a `narrative` field. Rather than let those users see a broken/empty greeting until their next rollover, `joinWinsAsSentence()` reads the old data as a flowing sentence too — strictly better than the bullet list it replaces, even though it's not as good as a purpose-written narrative.

**Redesigned conversation modes around usage patterns, not coaching postures, on the second attempt.** The first version (planning/building/stuck/perspective) was still implicitly a life-coach's mental model of a conversation. The brief this round was explicit: design around how you actually reach for AI — chat, build, think, decide, reflect are real, distinct jobs-to-be-done, and each one now changes concrete things (response length, whether questions are allowed, whether the model must hold an opinion) rather than just steering tone.

**Ember color: proposed concepts, implemented nothing.** You were explicit — "don't implement yet." Built a disposable multi-concept rendering harness (same pattern as prior visual verification), screenshotted six directions side by side on the identical shape/animation so the *only* variable is color/material, and wrote up the emotional read of each in §8. Nothing in `CompanionScreen.jsx` changed as a result.

**Re-baselined the roadmap as a rewrite, not an incremental patch.** Asked directly which phases are done/changed/dead/remaining. A quick patch to the existing roadmap table wouldn't actually answer "what changed because the product direction evolved" — that requires explaining *why* a phase's scope moved, not just its status. Wrote §0 as a standalone answer to exactly the four questions asked, and kept the prior per-round history in §1 as the supporting detail rather than the primary artifact.

---

## 4. What requires human action / what's next

See "Remaining roadmap, re-baselined" in §0 — that list is now the authoritative next-steps list, replacing the old §4 in previous versions of this doc.

---

## 5. Risks / open items

- **Greeting narrative is unverified against a real model call.** No Anthropic credentials in this sandbox. First real test: let a real day roll over, then read the actual `structured.narrative` text — does it sound like a person recapping your day, does it correctly name real specifics, does it ever leak back into report-speak.
- **Conversation modes v2 are unverified against real replies.** Same standing limitation — this is inherently a "does it actually feel different" judgment call that needs a handful of real exchanges per mode, not something a build can confirm.
- **Ember color concepts are static screenshots of the idle state only** — none of the six directions have been seen animated (breathing, sonar rings, sparks) or in the listening/thinking/speaking states. If a direction gets chosen, expect a follow-up look at how it behaves across all four states before calling it final.
- **Nothing from the prior round (transcript bugs, carousel, Ember shape, onboarding copy) has been confirmed by hand yet** — that testing was in progress when this round's requests came in.
- **Two chat surfaces (Ember + old modal drawer) are still live simultaneously** — unchanged open item, still not resolved.
- Everything else from prior sessions (embedding column unpopulated, `conversation_messages` not built, migrations already applied and verified) still stands unchanged.

---

## 6. How to test safely

- **Greeting:** after at least one full day has rolled over, reopen the app and read the actual greeting — one to two sentences, naming something real, no bullets, no report-speak. If the account's most recent `daily_summaries` row predates this change, you'll see the `wins`-joined-as-sentence fallback instead — still prose, not bullets, but not as polished as the purpose-written version.
- **Conversation modes:** try the same real message in a couple of different modes (e.g. "Build" vs "Think") — confirm the replies genuinely differ in length/shape/stance, not just wording. "Think" should feel noticeably longer and more developed; "Decide" should state an actual opinion, not a balanced list; "Reflect" should reference a pattern, not ask how you're doing.
- **Ember concepts:** nothing to test in the app yet — this is a decision to make from the writeup/screenshot in §8, not something running in the build.

---

## 7. Next recommended step

Waiting on you: (1) finish hand-testing the prior round's fixes, (2) hand-test this round's greeting/mode changes, (3) pick — or ask for more of — an Ember color direction from §8. No further building until those land, per your instruction.

---

## 8. Ember color/material concepts (proposed — nothing implemented)

Shape, animation, and behavior are identical across all six — the breathing ambient bloom, the two sonar rings during listening/speaking, the light-sweep during thinking, the drifting sparks, all unchanged from last round. The **only** variable below is color/material. Screenshot shows all six at rest (idle state); rendered via a disposable harness, not wired into the app.

1. **Warm Ember (current)** — orange-gold core, warm amber bloom. *Included as the baseline for comparison, not a recommendation given your note that it may not be the final identity.* Emotional read: energetic, primal, urgent — a literal small fire. Good for "alive," works against "calm."

2. **Moonstone** — pale lavender-white core, cool silver-violet bloom. Emotional read: serene, contemplative, quietly luminous — like moonlight on stone, or the inside of a shell. Reads as a companion that *listens* rather than one that *acts*. Strongest "calm" candidate of the six.

3. **Amber Glass** — muted honey core, softer and less saturated than the current warm ember, more translucent-feeling. Emotional read: warm but composed — candlelit rather than flame-lit. Keeps some of the current identity's warmth while dialing back the "fireball" intensity considerably.

4. **Pearl** — near-white/cream core with the faintest warm blush, very low saturation throughout. Emotional read: refined, understated, almost jewelry-like — the calmest and most minimal of the six. Risk: could read as *too* quiet/inert next to something that's supposed to feel "alive."

5. **Embered Slate** — deep charcoal-brown core with a warm rim-light highlight, like a cooling coal or brushed metal catching firelight. Emotional read: grounded, serious, quietly strong — ties back to "Forged" as a *smithing/metal* metaphor rather than a literal flame. Most "premium/masculine" of the six; least screenshot-flattering of the batch as currently tuned (reads slightly muddy at rest — would need contrast tuning if chosen).

6. **Aurora** — teal-to-violet gradient core, cool blue-green bloom. Emotional read: alive, a little mysterious, ethereal — "something that shifts, not something that burns." Furthest from the current identity; most distinctive; risk is it reads more "generic sci-fi AI" than the others, which cuts against wanting to avoid the Siri-ripple/Gemini-blob cliché.

**If asked for a recommendation:** Moonstone or Amber Glass are the two that most directly answer "calmer and more premium without losing the sense that something's alive" — Moonstone leans further into calm, Amber Glass keeps more continuity with the current warm identity. Embered Slate is the most interesting *conceptually* (fire → forged metal is a real, unused metaphor) but needs real tuning work before it'd look premium rather than muddy. Waiting on your read before touching any code.
