# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7` (preview only — `main`/production untouched)
**Purpose:** this is not "Forged with AI added." It's a new AI life companion that reuses Forged's backend, auth, memory, and APIs — but earns its UI from scratch. Wins on continuity, not capability: memory is the product, conversation is the interface.
**Last updated:** 2026-07-05 (polish pass) — fixed the live-transcript-disappearing-on-pause bug, redesigned the Ember from a "lumpy" turbulence-distorted blob into a clean glassy orb, replaced the single-pair/History-page transcript with an inline floating conversation carousel, redesigned each conversation "situation" to actually change response shape (not just tone), and cleaned up leftover old-Forged onboarding copy.

This file is the single source of truth for anyone (human or Cursor) picking this branch up cold. Update it at the end of every phase — do not let it drift from what's actually in the diff.

---

## 0. Roadmap at a glance

| Milestone | What it does | Status |
|---|---|---|
| **Polish pass — transcript, Ember, carousel, conversation modes** | Live transcript never disappears on a speech pause or during thinking; Ember redesigned to a clean orb (no more turbulence-warped "lumpy" shape); single-pair-then-History-page replaced with an inline scrollable floating carousel (fixed height, mask-fade, no chat bubbles); each "situation" now asks for a genuinely different response shape; onboarding's "Protect the Arc" notification screen and final-screen pitch reworded to sound companion-first | ✅ **Done, this session** |
| The Ember / living homepage | Replaces the mic-icon + chat-bubble screen with a living presence + natural-language greeting | ✅ Done — **visual redesigned this session**, see §1 |
| Companion home screen (mic-first, situations) | The screen this replaces — shipped two sessions ago | ✅ Superseded, same backend wiring |
| Faster voice replies | Sentence-chunked TTS, streamed/played back-to-back | ✅ Done |
| Memory layer (schema + extraction) | Daily titles, atomic facts, commitments, emotional context | ✅ Done and live |
| AI-judged XP (observation only) | Nightly 0-50 judgment + reason, stored, not wired to the real total | ✅ Done and live |
| ChatGPT memory import | Onboarding paste-and-review step | ✅ Done and live |
| Retire the old CoachBar / modal drawer | Now a second, redundant way to reach the same conversation | ⛔ **Still not done — see §4** |
| `conversation_messages` (raw transcript, server-side) | Lets the nightly judgment reason over what was actually said, not just curated notes | ⛔ **Not started — flagged as the next real infrastructure step** |
| Embedding generation + hybrid retrieval | Real semantic search over stored facts | ⛔ Not started — vendor decision + protected-file sign-off |
| Notifications rewrite | Specific-or-silent messages | ⛔ Not started |
| "What I remember" + Arc inference | View/delete facts; AI suggests an Arc from patterns | ⛔ Not started |

---

## 1. This session's pivot — why, and what changed

**The feedback, in one line:** the ember/homepage shipped last session was the right direction but had real rough edges — the live transcript vanished mid-sentence during any pause, the Ember itself looked "accidental" rather than intentional, the transcript UX was still either "one pair, then a full-page History view" (a jarring view-swap) rather than a calm scrollback, and the AI still leaned on follow-up questions the way a coaching app does rather than the way a sharp conversational partner does.

### Bug: live transcript disappearing during a pause in speech

**Root cause:** the old display logic branched on `speech.listening && speech.interim?.trim()`. The Web Speech API clears `interim` to `""` the instant a phrase gets finalized — including during an ordinary mid-sentence pause — so the instant that happened, the condition went false and the view fell through to showing the *previous* completed exchange instead of what the user was currently saying. It looked like the transcript had vanished.

**Fix:** the visible "live" text while listening is no longer `interim` alone — it's the accumulated `input` (finalized dictation so far, which persists across pauses) concatenated with whatever `interim` currently holds. The condition for showing it is just `speech.listening`, full stop — not gated on `interim` having content right now. So a pause shows the same accumulated line, unchanged, until the user speaks again or taps to stop.

### Bug: transcript hidden during "thinking"

**Root cause:** the old code's "thinking" branch (three dots) was a hard `if`/`else` against the branch that rendered the last user message — so while `loading` was true, the user's own line was replaced by dots instead of sitting above them.

**Fix:** this is really the same underlying fix as above, generalized — see "conversation carousel" below. The user's message is now a persistent entry in the same rendered list the assistant's (still-thinking) turn gets appended to, so it never gets swapped out for a loading indicator.

### The Ember: redesigned from "lumpy" to a clean orb

The previous version used an SVG `feTurbulence`/`feDisplacementMap` filter directly on the ember's core to fake an organic fire edge — but at the shape's actual outline, that distortion reads as an accident (an uneven blob) rather than as a deliberate design. Rebuilt it around a simple principle: **the core itself is always a perfect circle** — the "alive" feeling comes entirely from what surrounds it (a breathing ambient bloom, a couple of quiet sonar-style rings that only appear while listening/speaking, a soft light-sweep across the core while thinking, and a few faint drifting sparks), never from warping the shape itself. Verified by rendering all four states in a disposable Playwright-screenshotted harness (not committed) before porting the result into `CompanionScreen.jsx` — the new version reads as a warm, glassy, intentional orb, not a marble or a blob.

### Conversation carousel replaces "one pair, then a full History page"

The prior version showed only the very last user+assistant pair by default, with a separate full-page "Today's conversation →" view (chat bubbles, its own scroll, a "← Back" button) as the only way to see anything older — a real view-swap, which is exactly the kind of unnecessary UI movement that was flagged. Replaced both with a single fixed-height (230px), scrollable, floating-text region: no chat bubbles, user lines right-aligned/dim, assistant lines left-aligned/full-color, a soft top mask-fade so anything scrolled above the fold fades rather than hard-cuts, and it auto-scrolls to the newest line as the conversation grows. Scrolling back through today's earlier turns happens inside that same fixed region — nothing pushes the Ember or the footer down, and there's no separate page to navigate to or back out of.

### Conversation "situations" redesigned around response *shape*, not just tone

Added a `RESPONSE_STYLE_STEER` block that's now appended to every situation, including "Just chat" (which previously had no steering text at all): it explicitly tells the model that most replies should *not* end in a question, and gives it permission to lead with an observation, a take, an explanation, a story/analogy, or a connection to something it remembers — the same range a well-read friend has, not a coaching app's reflex follow-up loop. Then rewrote each situation's own steer to ask for a genuinely different shape on top of that shared baseline: planning leads with tradeoffs-and-a-real-opinion, building is terse-and-concrete with no filler questions, stuck states an observed pattern rather than asking about it, perspective brings an outside view/story rather than just reflecting feelings back.

This is prompt-only — it changes what's asked of the same model, not the chat/streaming/memory plumbing, and it lives entirely in the non-protected `CompanionScreen.jsx` (the situation steer text was already this screen's own addition, not part of the protected coach personality in `AICoach.jsx`).

### Onboarding copy: removed the leftover "old Forged" language

The notifications step's title was literally "Protect the Arc" — a phrase that reads like the old habit-tracker pitch, not a companion talking to you. Reworded that screen's title/copy/first bullet, and reworded the final "you're in" screen's body copy for the no-Arc-yet case to lead with "talk to me, I'll remember it" rather than a straight habit-tracker feature pitch. Left the actual Arc/habit-creation flow itself untouched — Arc is still a real, functioning feature (and this pass didn't touch the underlying habit/proof-action system) — this was a copy-only pass on the specific phrases that clashed with the companion framing, not a restructuring of the onboarding wizard.

### What did NOT change

Same backend wiring as every prior session: `/api/chat` streaming loop, `buildCoachSystemPrompts`, day-persistence, free-tier quota, fail-soft memory writes — none of that was touched. This was entirely a presentation-layer + prompt-steering pass.

---

## 2. Files touched this session

| File | What | Risk |
|---|---|---|
| `src/screens/CompanionScreen.jsx` | Ember rebuilt (clean circle core, no turbulence, sonar rings, thinking sweep); live-transcript bug fixed (accumulated `input`+`interim`, gated on `listening` alone); single-pair/History-page replaced with an inline scrollable floating carousel (`showHistory` state and the whole History branch removed); added `RESPONSE_STYLE_STEER` + rewrote each situation's steer text. | Medium — large diff, but additive/replacement to the existing send/stream logic, which is untouched. |
| `src/screens/OnboardingScreen.jsx` | Reworded the notifications step's title/copy/first bullet and the final screen's no-Arc-yet body copy. No logic, state, or flow changes. | Low — copy-only. |

**Still fully untouched:** `api/chat.js`, `src/coach/AICoach.jsx`, `src/coach/CoachApp.jsx`, `api/coach-summary.js`, `api/coach-intro.js`, `api/memory-rollover.js`, `src/App.jsx`, `src/hooks/useCoachTts.jsx`, the real `supabase/migrations/` directory, all Stripe/billing files, `package.json`.

---

## 3. Decisions made this session (and why)

**Fixed the transcript bug at its actual root cause, not by patching the symptom.** Could have special-cased "if interim is empty but we were just listening, keep showing the old interim" — instead recognized that `input` (the already-accumulating merged dictation) is the right source of truth for "what has the user said so far this turn," and interim is only ever a suffix on top of it. This removes an entire class of pause-related flicker, not just the one pause length that got reported.

**Ember: committed to "boring but perfect" as the core shape, put all the personality in what surrounds it.** The instinct after "it looks lumpy" could have been to tune the turbulence parameters further. Rejected that — any shape-level distortion risks reading as an accident again on some frame/device. A perfect circle can't look like a mistake; the sonar rings, breathing bloom, thinking-sweep, and sparks carry all the "alive" feeling instead, and are additive rather than shape-destructive.

**Removed the separate History page instead of fixing its transition.** The brief was explicit: "older messages can be scrolled back through without pushing the interface downward" and "avoid unnecessary UI movement." A separate full-page view is itself a form of UI movement (a hard cut, a "← Back" round-trip) — no amount of polishing that transition would satisfy the brief as well as removing the page-swap entirely in favor of an inline scrollable region.

**Put the response-style instruction in `CompanionScreen.jsx`, not in the protected coach personality file.** The ask was "make each situation produce a genuinely different response style" — that's squarely a prompt-steering change, and the situation steer text was already this screen's own addition on top of the protected `buildCoachSystemPrompts()` output, not a fork of it. Editing it here means zero risk to the tuned personality/cost invariants in `AICoach.jsx`/`api/chat.js`, and it's the same pattern already established for situations.

**Onboarding: scoped to the flagged phrase, not a full rewrite of the wizard.** The ask specifically named "Protect the Arc" as the example of leftover old-Forged language, grouped under "Priority 1 (bugs)" alongside genuine bugs — read as "fix the jarring copy," not "redesign the Arc-creation conversation flow," which is a large, separately-scoped feature (habit generation from proof actions, first-evidence capture) that still works and wasn't asked to change. Reworded the specific screens that clashed; left the flow structure alone.

---

## 4. What requires human action / what's next

**Immediate — actually use it.** Every fix in this pass (transcript-during-pause, transcript-during-thinking, the Ember redesign, the carousel, the response-style change) needs real hands-on testing — see §6. None of it has run against a real login session or a real model call in this sandbox.

**Retire the redundant old chat surface.** The floating CoachBar + modal `AICoach` drawer on Today/Arc/Social/Hub still exist and duplicate the Companion screen. Flagged for three sessions running now — still not done.

**Next real infrastructure piece — `conversation_messages`.** Unchanged from last session: stage a raw per-turn transcript table so the nightly XP/facts judgment can reason over what was actually said, not just curated notes.

**Blocker — choose an embeddings approach:** Voyage AI (API key) or a Supabase Edge Function (`gte-small`). Neither configured.

---

## 5. Risks / open items

- **Nothing in this pass has been tested against a real login session.** The transcript-persistence fix, the carousel's scroll/auto-scroll behavior, and the Ember's four states were reasoned through and (for the Ember specifically) visually verified in a disposable rendered preview — but none of it has been used in the real app with real speech recognition, a real streaming reply, and real TTS audio together.
- **The response-style prompt change is unverified against real model output.** This is inherently a model-behavior change, not something a build or unit test can confirm — first real test is a handful of real conversations across situations, checking whether replies actually vary in shape and stop defaulting to a closing question.
- **The carousel's auto-scroll uses `element.scrollTop = element.scrollHeight`, not smooth scrolling** — deliberate, for calmness (no bounce/animation competing with the fade-in), but not yet confirmed to feel right on a real device with a real virtual keyboard open (the "type instead" case).
- **Two chat surfaces (Ember + old modal drawer) are still live simultaneously** — unchanged open item.
- Everything else from prior sessions (embedding column unpopulated, `conversation_messages` not built, migrations already applied and verified) still stands unchanged.

---

## 6. How to test safely

- **Transcript-during-pause:** tap the Ember, start talking, pause mid-sentence for a couple of seconds without tapping anything, then keep talking — confirm what you already said never disappears or gets replaced during the pause.
- **Transcript-during-thinking:** say something and stop — confirm your own line stays visible above the thinking dots, not replaced by them.
- **The Ember:** cycle through idle (open the screen) → listening (tap, talk) → thinking (stop talking) → speaking (if voice replies are on) — confirm each state looks distinct and the core itself always stays a clean circle, never warped.
- **The carousel:** have a few exchanges, confirm only ~1-2 are visible at a time with older ones fading at the top edge, and that scrolling up inside that region reveals earlier turns without the Ember or footer moving.
- **Conversation quality:** try the same message in a couple of different situations (e.g. "Just chat" vs "I'm building") — confirm the replies actually differ in shape, and that most replies aren't ending in a question.
- **Onboarding:** run through a fresh signup — confirm the notifications screen no longer says "Protect the Arc" and the final screen's copy (no-Arc-yet case) reads as companion-first.

---

## 7. Next recommended step

Test this pass by hand — it's four fixes/redesigns that are all inherently "does it feel right" judgment calls (transcript behavior, Ember visuals, carousel feel, conversation-mode quality) rather than things a build can confirm. After that: retire the old CoachBar/modal drawer, then stage `conversation_messages`.
