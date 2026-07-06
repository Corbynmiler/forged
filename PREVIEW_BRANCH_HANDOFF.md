# Forged — Preview Branch Handoff

**Branch:** `claude/forged-ai-companion-redesign-agyjl7`
**Status:** preview/experimental only. `main` (production) has not been touched, merged into, or modified at any point on this branch.
**Last updated:** 2026-07-06 (fifteenth round today) — the fourteenth round's rail was still a from-scratch approximation and looked visibly different from the real thing. This round replaces it with an actual port: Noticed's week rail now renders using the *same* `RailCheckpoint`/`ProofRing`/`useRailCenterSelection` code the Arc screen uses (exported from `ArcTimeline.jsx`, not reimplemented), in the same single-selected-week-detail arrangement, just swapping "Arc week, habit proof" for "calendar week, chapter count." See "Fifteenth round" below.

### Fifteenth round — the rail is now an actual port, not a lookalike

**What was wrong:** side-by-side screenshots (Noticed vs. the real Arc screen) showed the fourteenth round's rail was a rough, from-scratch guess — plain numbered rings, a broken label (every node said "Mon" because the code read the weekday off `weekStart`, which is *always* a Monday), no checkmark/pulsing-dot states, no connecting bars, no scroll-snap-to-center, and the day list below was a permanently-expanded stack of every week at once instead of the Arc screen's one-week-at-a-time view.

**What changed:** stopped re-deriving the rail from scratch and instead reused the actual components:
- Exported `RailCheckpoint`, `RailConnector`, `useRailCenterSelection`, `ARC_MOTION_CSS`, `NODE`, `RAIL_PAD` from `src/components/ArcTimeline.jsx` (previously private to that file) — these are all already generic/data-agnostic, so reusing them guarantees pixel-identical rail mechanics (scroll-snap centering, tap-to-center smooth scroll, connector bars, the pulsing "current" ring) rather than a hand-rolled approximation of them.
- `MemoryWeekNode` (in `TodayScreen.jsx`) is a direct adaptation of the Arc screen's `WeekNode` — same ring/badge/pulse visual code, just showing "days with a chapter / 7" instead of "habit proof done / total," a checkmark for a fully-captured past week, a pulsing gold dot for the current week, and a plain count otherwise. The top label bug is fixed (shows the week-start day-of-month, or "NOW" for the current week, instead of always "Mon").
- **Behavior now matches the Arc screen exactly: one week selected at a time.** The rail is oldest → newest, left → right, and stops at the most recent week with a chapter in it — there's no Arc duration to draw future weeks against, so it simply doesn't extend past "now," which is exactly what was asked for. Tapping a node (or scrolling the rail) selects that week and its `MemoryWeekDetail` (gold kicker, serif caption, "Daily evidence" connected day-spine) renders below — replacing whichever week was showing, not stacking underneath it.
- `fmtWeekRange` (already existed in `utils.js`, unused until now) replaces the ad-hoc range string from last round, which had its own bug: it built the label from `fmtEntryDate(weekStart)`/`fmtEntryDate(weekEnd)`, and `fmtEntryDate` special-cases "Today"/"Yesterday" — so a week ending yesterday rendered as "MON, JUN 29 – YESTERDAY" instead of a clean date range.

**Files touched:** `src/components/ArcTimeline.jsx` (exports only, no logic changed), `src/screens/TodayScreen.jsx` (`MemoryWeekNode`, `MemoryWeekRail`, `MemoryWeekDetail` replace last round's `WeekRailNode`/`WeekRail`/`WeekChapterGroup`; `DailyChapters` now tracks a single `selectedWeekStart` instead of rendering every week stacked).

**Verified:** `npm run build` passes. **Not verified:** real visual side-by-side in a browser — this was built by directly reusing the real Arc-screen components rather than eyeballing a screenshot, which should close most of the visual gap, but a real look is still owed given the last two rounds both looked wrong on inspection.

**What to test:** open Noticed — the rail should now look and behave like the Arc screen's week rail (same ring style, checkmarks, pulsing current-week dot, connecting bars, smooth-scroll-to-center on tap), ending at the current week with no empty/future nodes after it. Tapping a node should swap the detail panel below to that week only, not add to a stacked list. Also worth re-checking: is the proof-action habit grid (fixed last round to collapse by default) still collapsed on a fresh load, or did something about "the old app still down the bottom" persist — no fresh screenshot showed the bottom of the page this round, so that fix hasn't been re-confirmed against new evidence.

### Fourteenth round — the actual horizontal rail, and a real bug fix (from live screenshots)

**Two separate things were wrong, both found from real screenshots, not guessed at:**

**1. The horizontal rail was still missing.** Rounds twelve/thirteen built the *vertical* pieces correctly (week header, connected day-spine) but never added `main`'s other defining visual: a horizontal scroll-snap strip of circular week nodes across the top. Added now as `WeekRail`/`WeekRailNode` in `TodayScreen.jsx`, reusing the **exact same `ProofRing` component** `main`'s `ArcTimeline.jsx` uses for its week checkpoints (now exported from that file instead of kept private) — each node's ring fills based on "how many of that week's 7 days got a chapter" instead of "how much proof got shown," since there's no Arc proof concept here. Nodes run oldest → newest, left → right, tapping one smooth-scrolls the page to that week's full section below (a "jump to," not a "hide everything else" selector — Noticed is a scrollable archive, `main`'s Arc screen is a bounded one-season viewer, so the two shouldn't behave identically here).

**2. Real bug: the old habit/proof grid was fully exposed on Noticed whenever an Arc is active.** A screenshot showed the exact thing this whole redesign has been trying to get away from — the full "Build the System" Arc hero, a "0/7 PROOF" ring card, and then a completely open "PROOF ACTIONS" list (Workout, Forged Build, Pouches, Drink Water, full stat cards) sitting right below the chapters, taking up most of the scroll. Root cause, in `TodayScreen.jsx`: the "collapse the habit grid by default" fix from several rounds ago (`SectionCollapsible` around `trackedSection`) only wrapped the **no-Arc** path. The **Arc-active** path (`proofSection`) was left rendering its card list in full, unconditionally — an oversight from when that path was written under a different, earlier assumption ("Arc Takeover: proof IS the point"). Fixed: `proofSection`'s card list now renders inside the same `SectionCollapsible` pattern (`defaultOpen={false}`, labeled `"Proof actions — X of Y"`), so it's reachable on purpose instead of dominating the screen by default. The compact Hub/Edit-order controls stay visible above it (not worth hiding, they're one row); only the actual wall of habit cards collapses.

**Files touched:** `src/components/ArcTimeline.jsx` (exported `ProofRing`), `src/screens/TodayScreen.jsx` (`WeekRail`, `WeekRailNode`, `scrollToWeek`/section refs in `DailyChapters`; `proofCardsInner` extraction + `SectionCollapsible` wrap in the main `TodayScreen` body).

**Verified:** `npm run build` passes. **Not verified:** real visual review in a browser — everything in this round was diagnosed directly from the screenshots provided, not blind guessing, but still needs a real look, especially the rail's scroll-snap feel on an actual phone.

**What to test:** open Noticed — there should now be a horizontal row of small ring nodes above the chapter list; tapping one scrolls to that week. Scroll all the way to the bottom of Noticed with an Arc active — the "Proof actions" habit cards should now be **collapsed by default** (a single "Proof actions — X of Y ▸" row), not a fully expanded wall of cards; tapping it should still open the same cards as before, unchanged in function.

### Thirteenth round — Noticed archive actually redone (storage system fix, take 2)

**Why this round exists:** the twelfth round's fix was correctly told it wasn't good enough — it grouped chapters by week and added a gold date-range label above each group, but the days themselves were still rendered as the same plain bordered boxes as before. That's not what "copy the main branch's layout" meant. The actual thing worth copying from `main`'s `ArcTimeline.jsx` is the connected-spine day list: a vertical line running through small circular nodes, one per day, each showing a short headline instead of a full card — the "journal" feel, not a stack of boxes.

**What changed this round:** within each week group, the flat `DailyChapterCard` list is replaced by `ChapterSpineRow` — ported directly from `main`'s `WeekDayJourney`/`DaySpineNode`: a 16px circular node connected top-and-bottom by a vertical spine line, date label above a single-line headline (the chapter's narrative opening sentence, same `dayDisplayTitle`-style preference for a real sentence over a raw title). Since every chapter rendered here already has real content (empty days are filtered out before this point), every node renders in the same "captured" state `main` uses for a day with a receipt — green-bordered circle with a checkmark — there's no proof-ring/percentage version of this because nothing here measures habit completion; it's purely "did the companion write about this day."

The week header itself (gold accent bar + kicker + serif caption) is unchanged from last round — that part matched `main`'s `WeekDetail` panel already. What was missing was the day list underneath, which is what's fixed now.

**Files touched:** `src/screens/TodayScreen.jsx` (`ChapterSpineRow`, `WeekAccent`, `chapterHeadline`, rewired `WeekChapterGroup` to render the spine instead of flat cards). `src/lib/arcTimeline.js` untouched this round (last round's exports still apply).

**Verified:** `npm run build` passes. **Not verified:** real visual review in a browser (no live session in this sandbox) — this is exactly the kind of thing that needs an actual look before calling it done twice in a row.

**What to test:** open Noticed with a few days of history — each week section should now show a connecting vertical line through small green checkmark nodes, one per day, with the day's opening sentence next to it (not a boxed card). Tap a node or its text — should open the same chapter detail sheet as before.

### Twelfth round — Noticed archive regrouped into weeks (the "storage system" redesign)

**What was asked:** the flat day-by-day list in Noticed ("your companion noticed") read as "pretty loud... very basic" compared to the old Arc timeline on `main`, which grouped days under weeks, each week titled with a caption summarizing it. The ask was to bring that same visual shape back — weeks containing days, each week captioned — but *without* a fixed Arc duration to number the weeks against, since Noticed's archive has no Arc-style start date/duration governing it.

**How it works:** the flat list of chapters (`daily_summaries` rows) is now bucketed into Monday-start calendar weeks via a new `groupChaptersByWeek()` in `TodayScreen.jsx`, using the same `weekStartFor()` week boundary already used everywhere else in the app (Insights, weekly briefs) — one consistent definition of "a week," not a new one. Each week renders as a `WeekChapterGroup`: a gold uppercase kicker (date range, or "This week" for the current week) plus a serif caption line, then that week's `DailyChapterCard`s nested below — visually the same shape as the old Arc rail's week-detail panel (gold kicker → serif title → days), just as a vertical section instead of a horizontal scrolling rail, since Noticed is a normal scroll page.

**The caption is free — no new AI call.** `deriveWeekChapterFromDays()` (new export in `src/lib/arcTimeline.js`) picks the single best day-title out of that week's chapters, reusing the *exact same* scoring heuristic (`scoreChapterCandidate`/`isWeakChapterCandidate`, now exported instead of private) the old Arc chapter-title logic already used to pick a good, specific headline over a generic mood word ("Building the closecraft system" over "Solid week"). Every candidate title was already written by the nightly rollover when it created that day's `daily_summaries` row — this only *selects* one, it doesn't generate new prose. So there's no per-week Anthropic cost, no new schema, and it degrades gracefully: a week with only vague day-titles still falls back to the most recent one rather than showing nothing.

**Why not reuse the AI-generated weekly brief (`/api/weekly-summary`) instead?** That endpoint (already in the repo, already wired to Insights) only ever covers *the current* ISO week and is quota-gated (1/week free, 2/week Pro) — it has no concept of writing a brief for a past week on demand, and stretching it to do so would mean either burning quota against past weeks or adding new schema/quota semantics. Given the caption is meant to be an always-there scanning aid for potentially many weeks of history, the free local derivation was the right fit; the AI weekly brief remains Insights' separate, deliberate, quota-gated "ask for a real weekly review" feature — untouched.

**Free/Pro gating unchanged:** only the already-unlocked chapters get grouped into weeks. The existing blurred "N more chapters — Unlock full archive" block for locked days is untouched and still renders below the week groups exactly as before — this round didn't touch paywall logic, only the visual grouping of what a user can already see.

**Verified:** `npm run build` passes. **Not verified:** real visual review in a browser (no live session in this sandbox) — worth a real look, especially how a week header with only 1-2 days in it (partial current week, or a week that starts right at the free-tier's 7-day cutoff) reads.

**Files touched:** `src/lib/arcTimeline.js` (exported `scoreChapterCandidate`/`isWeakChapterCandidate`, added `deriveWeekChapterFromDays`), `src/screens/TodayScreen.jsx` (`groupChaptersByWeek`, `WeekChapterGroup`, wired into `DailyChapters`).

**What to test:** open Noticed with more than ~7-10 days of history — chapters should now appear under week headers ("This week", then date ranges like "Jun 23 – Jun 29") each with a short italic-free serif caption above that week's day cards, instead of one long flat list. Tap into a couple of day cards to confirm they still open the same detail sheet as before (grouping is purely visual, `ChapterDetailSheet` untouched). Confirm the locked/blurred section for free accounts still appears below the visible week groups.

### Eleventh round — TTS cap raised for real testing + You screen coherence pass

**1. `TTS_MONTHLY_CHAR_LIMIT` raised to 1,000,000 chars/mo (~$50 at Flash pricing), explicitly requested** for heavy personal testing — not a literal "no limit" (that removes a real safety backstop against a genuine bug spending unboundedly), but a generous ceiling sized to an actual dollar amount the user said they're comfortable with. Changed in `theme.js`, `api/tts.js`, `api/tts-usage.js`'s fallback.

**Important, not fixable from this side — needs action on elevenlabs.io:** this is the *app's own* self-imposed cap. It does not and cannot raise ElevenLabs' real account quota. The ElevenLabs account itself was confirmed still on the free tier (10,000 chars/mo, account-wide) — raising the app's cap past that just means the app will keep trying and ElevenLabs will keep rejecting once its own real 10k/mo is hit. **To actually get more usable characters, the ElevenLabs account needs a paid plan.** Recalled from training knowledge, not verified live: ElevenLabs' tiers are roughly Starter (~$5/mo, ~30k chars), Creator (~$22/mo, ~100k chars, also raises the concurrent-request limit from 2 to 3+, which would let `useCoachTts.jsx`'s `CONCURRENT_TTS_FETCH_WINDOW` safely go up too), Pro (~$99/mo, ~500k chars) — confirm current numbers/names on elevenlabs.io → Subscription before picking one, pricing pages change. Creator fits the stated $20-50/mo range well. Once upgraded, no code change is needed for the higher ElevenLabs ceiling itself — only for raising `CONCURRENT_TTS_FETCH_WINDOW` if the new plan supports more concurrent requests (see the comment at that constant in `useCoachTts.jsx`).

**2. You screen coherence pass.** Talk and Noticed had both had full redesign rounds; `ProfileScreen.jsx` (the screen behind the "You" tab) hadn't been touched all session and still read as a generic settings page with the old "coach" vocabulary in a few places and one section (push notifications) visually louder than everything around it.

- **Merged two sections that were about the same thing.** The companion's name/icon lived in "Account"; spoken-replies + voice picker lived in a separate "Companion voice" section above it — two blocks about the same relationship, split apart. Now one section, "Your companion": name → spoken replies toggle → voice picker, in that order.
- **Push notifications detoned.** Was the loudest thing on the page — a 40px icon in a gold-gradient box, a gold-gradient section background, a gold-tinted sub-panel for the category toggles. Rewritten to match the plain `T.raised`/`T.border` treatment every other section on this screen already uses. Same toggles, same categories, same behavior — visual weight only.
- **Remaining "coach" copy fixed**: the header tagline ("Your account — coach, notifications…" → "…companion, notifications…"), the notification subtitle ("from your coach" → "from your companion"), two feature-list rows in `UpgradeModal` ("Arc coach" → "Arc companion", "Unlimited Arc coach" → "Unlimited Arc companion"), and the toggle's screen-reader label ("Spoken coach replies" → "Spoken companion replies").
- **Fixed a real display bug the char-limit raise exposed**: the "~Xk characters/month included" line did a naive `/1000` — at the new 1,000,000 limit that would have read "~1000k characters/month," which is wrong-looking. New `fmtCharAllowance()` helper shows "10k" or "1M" correctly depending on magnitude.
- **Fixed a stale onboarding tour step** (`profile-account` in `habitCards.jsx`) that said "rename your AI companion here," pointing at a spot that no longer contains that control after the section merge above.

**What did NOT change:** the Pro/paywall section, referral, feedback, data export, dev tools, sign-out — all untouched, all still there, exactly where they were. This was a coherence/terminology/visual-weight pass, not a restructure of what's on the page.

**Verified:** `npm run build` passes after every step. **Not verified:** real visual review in a browser — no live session in this sandbox.

**Files touched:** `src/theme.js`, `api/tts.js`, `api/tts-usage.js` (char cap), `src/screens/ProfileScreen.jsx` (You screen pass, `fmtCharAllowance` helper), `src/components/habitCards.jsx` (tour copy fix).

**What to test:** open You — confirm "Your companion" is one section (name, then spoken replies, then voice picker) instead of two; confirm push notifications no longer has a gold-gradient background/icon; confirm the char allowance line reads "~1M characters/month," not "~1000k"; confirm no visible "coach" wording remains on this screen or in the upgrade sheet.

### Tenth round — voice-aware cache key + quieter usage readout

**1. Real bug, caught by the user asking the right question: "if I switch voice, does replaying a message use the new voice, or cost more?"** Checked the code — the answer was neither, and worse than either: the per-message cache key was `${messageTs}:${chunkIndex}`, with no voice in it. Switching voice and tapping "Listen" on a message you'd already heard would silently replay the **old voice's** cached audio — not regenerate in the new voice, and not warn you it was stale. Fixed: the cache key is now `${messageTs}:${voiceId}:${chunkIndex}` in both `useCoachTts.jsx`'s in-memory cache and `ttsCache.js`'s IndexedDB layer. Correct behavior now: first listen to a message in a given voice costs real ElevenLabs characters (unavoidable — a different voice is a genuinely different, separately-billed synthesis, same cost as the very first generation); every later replay in that *same* voice stays free; switching voice and replaying correctly re-synthesizes instead of reusing stale audio.

**2. The ElevenLabs usage readout (under the voice pill) redesigned to be quieter.** Was a bordered pill with a background fill and a microphone emoji, expanding into a boxed panel with its own border/background — visually heavier than anything else on this screen, for what's explicitly internal developer information. Rewritten to match the screen's existing "quiet utility link" pattern (the same understated underlined-text style as the "type instead" link) — no border, no background fill, no emoji, smaller/thinner progress bar. Same data, same tap-to-expand behavior, same creator-only gating — appearance only.

**Interpretation check, worth confirming:** the request said "the storage system is pretty loud... very basic." Read this as the ElevenLabs usage readout (the only "storage"-adjacent UI built this session) and fixed that — flag it back if something else was meant (e.g. the playback bar, the Listen button, or something on Noticed).

**Files touched:** `src/hooks/useCoachTts.jsx` (cache key), `src/screens/CompanionScreen.jsx` (`TtsUsageBadge` redesign).

**What to test:** play a message in one voice, switch to a different voice, replay the *same* message — should re-synthesize (a brief real delay, new usage in the readout) rather than instantly replaying the old voice. Replay it again in that same (new) voice — should now be instant/free. Check the usage readout under the voice pill reads as a quiet text link, not a boxed badge.

### Ninth round — tap-to-play TTS, per-message caching, voice roster fix

**1. Auto-play removed. Each assistant message now has its own "Listen" button.**
`CompanionScreen.jsx` no longer calls `coachTts.speak()` when a reply finishes streaming (that call site is gone — see the comment left in its place). Instead, every assistant bubble in the carousel gets a real, labeled `ListenButton` (icon + the word "Listen," not a bare tiny icon — per direct request that it "should not be tiny or hidden"), shown whenever `isPro && voiceRepliesEnabled`. Tapping it calls `coachTts.speak(coachMain, m.ts)` — `coachMain` is the already-cleaned/display-formatted text (receipt stripped, goal-plan stripped, markdown formatted), the same text the bubble actually shows, not the raw stream text the old auto-play used — so what you hear now always matches what you read. `m.ts` (the message's creation timestamp) is the per-message cache key — the only field guaranteed to survive both this session and a page reload (message `.id` does not persist through `saveCoachDayMessages`/`loadCoachDayMessages`, `.ts` does).

While a message is playing, its `ListenButton` is replaced in place by the same `PlaybackBar` (pause/resume/rewind 10s/stop) from last round — now driven by `coachTts.speakingKey` (sits alongside `speaking`/`paused`, set to whatever cacheKey was passed to `speak()`) so the controls appear on the *correct* message, not a single global indicator. Starting a new message's audio still stops whatever was playing first, same as before.

**2. Generated audio is cached — replaying never re-calls ElevenLabs.**
Two layers, both keyed by `${m.ts}:${chunkIndex}` (per sentence-chunk, matching how replies are already synthesized):
- **In-memory** (`audioCacheRef` in `useCoachTts.jsx`) — decoded `AudioBuffer`s kept for the life of the session. Free, instant replays within one visit.
- **IndexedDB** (new `src/lib/ttsCache.js`) — raw MP3 bytes, survives a page refresh. Every cache write is tagged with today's date; a prune pass (once per session, on first `AudioContext` creation) deletes anything not from today, so this is explicitly "cached for today only," never an unbounded store. `fetchChunkBuffer` checks in-memory → IndexedDB → real fetch, in that order, and writes back to both on a genuine miss.
- **Not done, and explained rather than guessed at:** cross-day persistence (e.g. "still cached tomorrow") was deliberately not built — the request was "today only," and a longer-lived cache raises real questions (staleness if a voice is changed, unbounded IndexedDB growth) that weren't part of this ask.

**3. Voice roster fixed — was accidentally half female, despite "prefer male voices."**
Two of the four previous entries (labeled generically as "Calm" and "Grounded") were actually ElevenLabs' premade **Sarah** and **Rachel** — both female voices, with labels that gave no indication of that. All four `COACH_VOICE_OPTIONS` entries are now male, renamed to companion-style names instead of mood words or human first names: **Atlas** (George — already live, unchanged), **Vale** (Daniel — already live, unchanged), **Orion** (Antoni), **Echo** (Josh). Name and description no longer repeat each other (e.g. "Vale — Measured and deliberate," not "Measured — Measured, steady").
- **Honest gap, not guessed past:** Orion's and Echo's voice IDs (`ErXwobaYiN019PkySvjV`, `TxGEqnHWrfWFTfGW9XjX`) are recalled from training knowledge of ElevenLabs' long-standing premade voice library — these are commonly-referenced, globally-available IDs, not account-specific — but **not verified against a live ElevenLabs call in this sandbox**. Test both by ear before trusting them. If either is wrong, ElevenLabs' Voice Library (elevenlabs.io → Voices) shows the correct ID for any premade voice by name — swap it into `theme.js`'s `COACH_VOICE_OPTIONS`, one line, no other code changes needed.

**4. `TTS_MONTHLY_CHAR_LIMIT` — already fixed last round, confirmed still correct.** 10,000 in `theme.js`, `api/tts.js`, and `api/tts-usage.js`'s fallback — no change needed this round, just verified.

**Also fixed in passing:** `ProfileScreen.jsx`'s "Spoken replies" toggle description said "Companion reads replies aloud after you speak" — described the now-removed auto-play behavior. Updated to describe the real tap-to-listen behavior.

**Files touched:** `src/hooks/useCoachTts.jsx` (caching, `speakingKey`, `speak(text, cacheKey)` signature change), `src/lib/ttsCache.js` (new), `src/screens/CompanionScreen.jsx` (`ListenButton`, per-message wiring, auto-play call removed), `src/theme.js` (voice roster), `src/screens/ProfileScreen.jsx` (copy fix).

**What to test:**
- Send a message, confirm it does NOT speak automatically.
- Tap "Listen" on an assistant reply — confirm it plays, and the button becomes pause/rewind/stop controls while it does.
- Let it finish or stop it, tap "Listen" again on the *same* message — should play instantly with no network delay (cached) and should not show up as new usage in the ElevenLabs usage badge.
- Refresh the page, tap "Listen" on a message from earlier today — should still play from cache (IndexedDB), not re-fetch.
- Try each of the 4 voices in the picker — confirm all read as male, and that "Orion"/"Echo" (the two new ones) actually work and sound distinct; report back if either voice ID is wrong so it can be swapped.
- Confirm the usage badge (creator-only, under the voice pill) still shows a 10,000-char monthly limit.

### Eighth round — fixed the TTS monthly cap: it was 5x the real ElevenLabs limit

**The bug:** `TTS_MONTHLY_CHAR_LIMIT` was set to 50,000 chars/mo everywhere (`theme.js`, `api/tts.js`, `api/tts-usage.js`'s fallback), based on "~$2.50 COGS at Flash pricing" — math that only applies on a **paid** ElevenLabs plan. The user confirmed the real account is still on ElevenLabs' **free tier**, which caps at 10,000 chars/mo, account-wide. So the app had been enforcing (and displaying, once the round-seven usage monitor shipped) a self-imposed cap 5x higher than what ElevenLabs would actually allow — meaning a user could see "usage: fine, plenty left" from the app's own tracking right up until ElevenLabs itself started rejecting requests outright, with no warning.

**Fixed:** the constant is now `10000` in all three places (`theme.js`'s display copy, `api/tts.js`'s server-enforced cap, `api/tts-usage.js`'s local-estimate fallback), plus the stale "50000" reference in `AGENTS.md`'s env var docs. `ProfileScreen.jsx`'s "~Xk characters/month included" line already computed off the constant, so it updates automatically — no separate fix needed there.

**Still worth knowing:** this app currently runs on **one shared ElevenLabs account** (one `ELEVENLABS_API_KEY`) — the 10,000/mo limit is account-wide, not per-user. Right now there's effectively one real user, so a 10,000/mo *per-user* cap and a 10,000/mo *account-wide* cap are the same thing in practice. If this app ever has multiple real users sharing this same free-tier key, a per-user cap of 10,000 each would let them collectively blow past the account's real 10,000 total — that's a genuine future problem, not solved here, just worth flagging before it surprises anyone.

### Seventh round — spoken-reply playback controls + ElevenLabs usage monitor

**1. Playback controls (pause / resume / stop / rewind 10s)**

`useCoachTts.jsx` plays a reply as a sequence of gapless `AudioBufferSourceNode`s scheduled on one `AudioContext` clock (see the round-4 stutter fix). That made pause/resume genuinely simple: **pause/resume now suspend/resume the whole `AudioContext`** — every scheduled source freezes and continues in lockstep automatically, no per-chunk offset bookkeeping needed. Stop reuses the existing `stopSpeaking()` (already stopped cleanly whenever a new reply started, per the original request — confirmed, not new this round).

Rewind is the genuinely new piece: every decoded chunk this reply is recorded as `{start, end, buffer}` in reply-elapsed seconds (`chunkMarksRef`). Rewinding derives "how far into this reply are we" from `ctx.currentTime` minus a tracked origin, jumps back 10s, stops everything currently scheduled, and reschedules the already-decoded chunks that cover the new position — using `AudioBufferSourceNode.start(when, offset)`'s own offset parameter for the one chunk that gets entered mid-buffer. No re-fetching, since you can only ever rewind into content that's already played (and therefore already decoded). If `speak()`'s loop is still fetching *later* chunks when a rewind happens, a shared ref (`nextStartTimeRef`, not a closure-local) redirects where those land once they arrive, so they queue up after the rewound audio instead of at their stale pre-rewind time. Traced through by hand with concrete numbers (chunk durations, mid-chunk rewind targets) rather than just written and hoped — see the code comments in `useCoachTts.jsx` for the exact reasoning.

New floating `PlaybackBar` in `CompanionScreen.jsx`: rewind-10s / pause-or-resume / stop, shown only while `coachTts.speaking` is true, right below the Ember's status caption. Deliberately **not** `position: fixed` — it's in normal document flow within that already-dynamic caption area, so it never overlaps the conversation carousel above it and reserves no space when nothing's playing. Caption text also now distinguishes "Paused" from "Speaking…".

**Unverified:** real playback in a browser — the AudioContext suspend/resume and `start(when, offset)` behavior is standard, well-documented Web Audio API, and the arithmetic was hand-traced, but this needs a real listen (pause mid-sentence, resume, rewind across a chunk boundary, rewind near the very start) before calling it solid.

**2. ElevenLabs usage monitor (creator-only, preview-only)**

New `api/tts-usage.js`. Tries the **real** ElevenLabs number first: `GET https://api.elevenlabs.io/v1/user/subscription` (a documented, stable ElevenLabs endpoint) returns `character_count`/`character_limit` for the account tied to `ELEVENLABS_API_KEY` — the actual constraint that matters, since this is one shared ElevenLabs account behind every user of this app, not a per-user limit. Falls back to our own `tts_usage` table (already written on every synthesis in `api/tts.js`) if the ElevenLabs call fails or its response shape doesn't match what's expected — clearly labeled `"local_estimate"` vs `"elevenlabs"` in the response so the client never presents an estimate as the real number.

**Honest caveat:** the ElevenLabs response field names (`character_count`, `character_limit`, `next_character_count_reset_unix`) are from training knowledge of ElevenLabs' documented API, not verified against a live call in this sandbox (no network access to elevenlabs.io here). The code is defensive — if the shape doesn't match, it falls through to the local estimate rather than showing broken numbers — but this needs a real test against the actual account before fully trusting the "real ElevenLabs number" path.

Client side: `TtsUsageBadge` in `CompanionScreen.jsx`, under the voice pill. Collapsed badge, expands on tap to show used/remaining/limit, a thin progress bar, which source it came from, and a reset date when ElevenLabs provides one. Gated to `isPro && user?.id === CREATOR_ID` — belt-and-suspenders on top of this whole branch never reaching `main`: only the creator account sees it, not every preview tester, and definitely never a production user. Fetches once on first expand, not proactively on every screen load — refresh button for a manual re-check.

**Files touched:** `src/hooks/useCoachTts.jsx` (playback controls), `src/screens/CompanionScreen.jsx` (`PlaybackBar`, `TtsUsageBadge`), `api/tts-usage.js` (new).

### Sixth round — Noticed's hierarchy redesign: memory leads, old Forged chrome demoted

**The diagnosis, in the user's own words:** the top of Noticed was still dominated by "old Forged" — the Arc hero card (giant serif title, gradient background), the "Alive" status badge, the proof ring, "7/7 proof" — with the new companion archive sitting below it. First impression on opening the app: habit tracker with AI attached. Goal: first impression should be "this is my companion's memory of my life."

**What shipped in `TodayScreen.jsx` (plus small threads through `App.jsx`):**

1. **`DailyChapters` now leads the entire screen** — moved above the Arc banner/strip, above the ring/status card, above everything. It's the first thing rendered, full stop. This alone is the single biggest hierarchy fix: memory first, tracking chrome after.
2. **Chapters are now genuinely tappable — "opening a chapter should feel like opening a beautiful journal entry."** `DailyChapterCard` collapsed to a scannable 2-line teaser (date, title, clamped narrative, "Read →"); tapping opens `ChapterDetailSheet`, a full bottom sheet with: date, title, full narrative, **"How it felt"** (`daily_summaries.emotional_context` — newly added to the fetch, same row, no extra query), **"What you said you'd do"** (`daily_summaries.commitments`, same deal), **"Companion's read"** (XP + reason), and — when that day also has a real evidence/receipt entry in `journal_entries` — a bonus **"Evidence entry"** section rendering its full structured content (proof shown, wins, hard parts, pattern, etc.) via `ReceiptExpandedBody`, imported directly from `components/ArcTimeline.jsx`. This is the literal "old Arc layout is a better foundation" instruction acted on: the richest existing per-day detail component in the codebase, reused as-is for the new chapter viewer instead of rebuilt from scratch.
   - **Deliberately not done:** fetching raw `conversation_messages` for the day. The instruction called this optional; doing it well needs a new per-day query (not free like the fields above), and this round already had real scope. Flagged as the natural next enhancement to this exact component, not silently dropped.
3. **`ArcStrip` completely redesigned — this was the actual "Build the System card + Alive badge" the user was pointing at.** Was: full-width gradient hero, 22px serif Arc title, its own status badge row, a progress bar. Now: a single quiet compact row — small uppercase "Direction · Day X of Y" label, a 14px medium-weight title (not serif, not oversized), the same status pill inline and small. Same data, same tap-through to the Arc screen, same underlying `getArcDayStatus`/`ArcStatusPill` logic — only the visual weight changed, from "hero card" to "secondary status strip," matching where it now sits in the page (after the memory archive, not before it).
4. **The ring/status card was left alone.** Considered shrinking it further, decided against it: it's already a compact single-row utility (ring + two lines), not a second hero card, and now that it renders *after* the archive and the quieted Arc strip, its position alone does the necessary demotion — it reads as "today's log status," not "the app's whole personality."

**What did NOT change:** `journal_entries`, `daily_summaries`, habit/goal data, proof-action logic, the Arc screen itself, `ArcTimeline.jsx`/`ReceiptExpandedBody` (read-only reuse, zero edits to that file). Nothing deleted — every removed visual element (gradient, big serif title, progress bar) was decorative; the underlying `ArcStrip`/`ArcStatusPill` props and behavior are identical.

**Verified:** `npm run build` passes after every step; grepped for orphaned imports/variables after the `ArcStrip` rewrite (`arcHeaderSubtitle`, `arcDurationWeeksLabel` were now-unused imports, removed). **Not verified:** real visual review in a browser — no live session in this sandbox, so the chapter sheet's layout, the new compact `ArcStrip`, and the reordered hierarchy are reasoned from the same design tokens/patterns already proven elsewhere in this codebase, not screenshotted. Worth a real look before calling this final.

**Files touched:** `src/screens/TodayScreen.jsx` (the whole milestone), `src/App.jsx` (added `commitments`/`emotional_context` to the `daily_summaries` select, passed the full `journalEntries` array to `TodayScreen` — previously it only received `todayJournalEntry`, a single day).

### Fifth round — Noticed becomes a real daily-memory archive (milestone, complete)

**The ask:** turn Noticed into the real daily memory archive; make daily chapters feel worth revisiting; keep reducing the old habit-tracker feeling; bundle related work into one finished milestone instead of stopping after the first piece.

**What shipped, as one coherent pass through `TodayScreen.jsx` (the screen behind the "Noticed" tab), `App.jsx`, and `utils.js`:**

1. **A real archive, not a single teaser line.** The "Your companion noticed" block from round three (one sentence about yesterday) is replaced by `DailyChapters` — every day the nightly rollover has actually summarized, most recent first, each rendered as a small chapter: date, title, the full narrative recap, and the AI-judged "Companion's read" (XP + reason) for that specific day when present. `daily_summaries` fetch depth raised from 7 to 30 days in `App.jsx` (`loadCoachMemory`) to give the archive real depth — Talk's own greeting/memory context is unaffected (it slices the most recent 3-7 from this same pool, same as before).
2. **A "Today — still being written" placeholder always leads the archive.** Makes the metaphor complete: today isn't a gap or something you're behind on, it's a page that's filling in as the day happens and becomes a real chapter tonight.
3. **Free/Pro gating reuses the app's existing convention, not a new rule.** Chapters older than 7 days are blurred with the same lock-and-unlock visual pattern already used for habit history (`HistoryModal`'s `daysAgo(6)` cutoff) — same monetization story everywhere, not a one-off invented here.
4. **The habit/goal grid is now collapsed by default when there's no active Arc** — wrapped in the same `SectionCollapsible` pattern already used elsewhere in this file (Goals/Other-habits when an Arc is active), labeled `"Today's log — {X of Y logged}"`. This was the single biggest remaining "checklist, not companion" visual signal on the screen; now it's a tool you open on purpose, with the ring above still giving the at-a-glance status. Onboarding's `GLOBAL_TOUR` (`habitCards.jsx`) updated to match — its copy was also badly stale (referenced "Five screens: Today, Journal, Insights, Social, Profile," none of which are real top-level screens anymore) — rewritten for the real 3-tab structure and the new collapsed-section interaction, plus a new step introducing Talk itself via the `companion-nav` tour anchor added last round.
5. **Removed a genuinely redundant status line.** `TodayScreen` was showing TWO independently-computed "how's today going" messages stacked on top of each other — the old `CoachGreeting` mini-header (icon + name + its own rules-engine line) directly above the ring/status card, which computes its own separate greeting text. `CoachGreeting`'s underlying logic (`buildCoachGreetingLine`) is genuinely more specific than the ring's plain text (it surfaces goal deadlines, streaks, and skip-day patterns) — so rather than deleting it, it's now folded into the ring card's own subtitle line, and the separate mini-header is gone. One status message, not two, and no real signal lost. (`CoachGreeting` the component still exists and is still used in the zero-habits empty state, where there's no ring to fold into.)

**What did NOT change:** all underlying data (habits, goals, logs, `daily_summaries`, journal entries) and every interaction inside the habit/proof cards (tap, undo, reflect, skip, drag-reorder) — untouched, just reached through one extra tap when there's no active Arc. Arc-active mode's "proof actions only" behavior is unchanged.

**Verified:** `npm run build` passes after every step. Not verified: real visual review in a browser (no live session in this sandbox) — the archive's card layout, the collapsed section's default state, and the blur/unlock treatment are reasoned from the same patterns already proven elsewhere in this codebase, not screenshotted.

**Files touched:** `src/screens/TodayScreen.jsx` (the bulk of this milestone), `src/App.jsx` (fetch depth, `isPro`/`onUpgrade` passthrough), `src/utils.js` (added then removed `composeCompanionNarrative` — superseded mid-round by per-entry rendering directly in `DailyChapterCard`, removed rather than left as dead code), `src/components/habitCards.jsx` (`GLOBAL_TOUR` rewrite).

---

### Fourth round — Version 2 information architecture (proposed) + step 1 (shipped)

**The one-sentence product bet, restated as the design brief:** "A companion that remembers me, notices patterns, helps me think clearly, and quietly helps me move forward." Everything below is designed against that sentence, not against preserving Today/Arc/You as they exist on `main`.

**V2 IA proposal — three surfaces, not four:**

1. **Talk** (unchanged) — the front door. Conversation, voice, modes (including the new opt-in long-form Ramble mode). This already matches the vision; not touched this round beyond what already shipped.
2. **Noticed** (replaces "Today" as a tab; absorbs "Arc"'s role as a tab) — a single reverse-chronological feed of your life through the companion's eyes. Today's live state (quick logging, what's pending) sits at the top; narrated past days (`daily_summaries`) scroll below as entries, not a separate "History" destination. An active direction (today's "Arc") surfaces as a contextual strip *within this feed*, not a dedicated tab — visible when relevant, invisible when not, exactly like the vision's "helps me think clearly, quietly helps me move forward" rather than "here is a mandatory progress bar." Habits/proof actions become things you tap to log inline in this feed, not a grid you're required to visit and clear.
3. **You** — the quiet control panel underneath everything: profile, the structured management console (habit/goal list editing, direction/Arc setup when you want one, social/friends, voice + subscription settings). Visited rarely, on purpose — it's infrastructure, not a daily surface.
4. **(Future, not yet buildable) Patterns** — once embeddings/retrieval (Phase 2a's remaining piece) exist, this could become a real 4th surface: a companion-narrated view of actual long-term trends ("you've mentioned burnout every Sunday for a month"), which is a genuinely new capability rather than a repurposed old screen. Proposed as the natural next surface once the memory layer can support it — not before.

**What this deliberately does NOT preserve:** a permanent, always-visible "Arc" destination. The current product structurally implies every user should have an active Arc at all times (a whole tab dedicated to it, empty or nagging when you don't). The vision explicitly wants Arc optional — so in V2, it isn't a place you go, it's a strip that appears in Noticed when it's relevant to what the companion is already showing you.

**Step 1, shipped this round:** collapsed the bottom nav from 4 tabs (Talk/Today/Arc/You) to 3 (Talk/Noticed/You) in `App.jsx`'s `NAV` array. "Today" relabeled **"Noticed"** (ties directly to the "Your companion noticed" block shipped last round — same word, same idea, reinforcing it's one voice) — still routes to the same `TodayScreen.jsx` (id `"today"` unchanged internally; this is a nav/label change, not a screen rewrite). "Arc" removed as a persistent tab — **not deleted, not hidden**: `ArcScreen.jsx` is fully intact and reachable exactly as before via the existing `onViewArc` navigation (the ArcStrip when a direction is active, or the "Want to set a season?" card when it isn't — both already present in Today/Noticed from last round, both already call `setScreen("arc")`). Every state of Noticed except the true zero-habits empty state already surfaces a way into Arc; the zero-habits state instead leads to Talk, where the companion can create a direction through conversation. No functionality removed — only the permanent nav slot.

**What was NOT done this round (bigger, deliberately deferred, needs its own review):**
- Actually merging Today's and Arc's *content* into one literal feed component — this round only collapsed the *navigation*; `TodayScreen.jsx` and `ArcScreen.jsx` remain separate components/files. A true unified "Noticed" feed (today's state + narrated past days + Arc's proof timeline all in one scroll) is a substantially bigger rewrite of both screens and deserves its own dedicated, reviewed pass.
- Shrinking the habit/proof-action grid's visual dominance within Today/Noticed itself (still the same layout as before, just reframed by the header above it last round).
- Any change to `You`/Profile's structure.
- The "Patterns" surface (blocked on embeddings/retrieval, Phase 2a).

**Risk assessment for this step:** Nav-only change (`App.jsx`'s `NAV` array + one label string). No component deleted, no route removed from the `screen === "..."` switch, no data model touched. Every existing path to Arc (`onViewArc`, `navigateTo("arc")`, the journal/insights redirects) still works identically — verified by reading each call site, not just assumed. Fully reversible by restoring the 4th `NAV` entry if it doesn't feel right in practice.

### Third round — product coherence (Today reframe + Arc de-emphasis)

**What was asked:** Talk stays the front door; Today becomes quieter, reframed around what the companion noticed; Arc becomes optional long-term direction, not the mandatory centre; habits/proof actions become tools the companion uses, not the main experience; keep all data/functionality working, change the story/hierarchy only; nothing deleted without asking first.

**What shipped (smallest coherent step, not the full redesign):**
- **`composeCompanionNarrative()`** — new shared helper in `utils.js`, extracted from the same `daily_summaries.structured.narrative` logic the Talk screen's greeting already uses. Given the exact same `recentSummaries` data, Today and Talk now say the same thing about the same day — one companion's voice, not two separate personalities (Today previously only had its own deterministic, rules-based `CoachGreeting` nudge, e.g. "2 habits left").
- **Today now leads with "Your companion noticed"** — a new `CompanionNoticed` block in `TodayScreen.jsx`, rendered above everything else (both the zero-habits empty state and the normal view), fed by `recentSummaries` now passed down from `App.jsx` (`coachMemory?.recentSummaries` — already-fetched data, no new fetch, no new cost). The existing deterministic `CoachGreeting` line is unchanged and still renders below it — nothing removed, just no longer the lead.
- **The "NO ACTIVE ARC" banner softened.** Previously: shouty gold-bordered card, uppercase "NO ACTIVE ARC" label, "What season are you in?" — reads like a missing-feature alert. Now: neutral border/background, "Optional — long-term direction" label, "Want to set a season?" copy that explicitly says an Arc is for when there's a real bounded outcome, "not required to use Forged day to day." Same button, same `onStartArc` handler, same functionality — copy and visual weight only.
- **The zero-habits empty state reframed.** Was "Start with an Arc" as the only presented path for a brand-new user. Now "Tell your companion what's going on" — Arc is named as one possible outcome of that conversation, not the labeled starting requirement. "Talk to your coach" → "Talk to your companion" (same handler).
- **Remaining "coach" → "companion" copy cleanup in `TodayScreen.jsx`** caught in the same pass (wrap-today CTA subtext, "set a goal with your..." CTA) — internal prop/function names (`onOpenCoachMic`, `buildCoachGreetingLine`, etc.) intentionally left alone; this was a UI-copy pass, not a variable rename.

**What did NOT change:** the habit checklist/grid, proof-action mechanics, Arc timeline/reviews, Hub, streaks, XP — all fully intact, same data, same behavior. This round only touched *framing*: what leads the page and how the no-Arc state is worded. "Habits/proof actions become tools the companion suggests, not the main experience" is **not yet done** — that's a bigger visual-hierarchy change (de-emphasizing the grid itself, not just the header above it) and deserves its own round with its own review, not bundled in here.

**Nav/IA vision proposed here was superseded and then partly built in the very next round — see "Fourth round" near the top of this document for the full V2 IA proposal and what actually shipped.**

**This round's changes:**
1. **"Ramble" mode — a genuine long-form (5-10 min) companion mode.** New `SITUATIONS` entry in `CompanionScreen.jsx` for real ChatGPT-caliber long replies (humor, real callbacks to what the companion remembers, no forced structure) — explicitly calibrated to only go long when the message actually calls for it, not a standing "always 10 minutes" default (per explicit decision: opt-in per message, not a standing mode, to keep monthly TTS cost bounded). `MAX_SPEECH_CHUNKS` in `useCoachTts.jsx` raised from 8→60 so a genuinely long reply doesn't merge its overflow sentences into one oversized chunk that would fail `api/tts.js`'s per-request 2000-char cap.
2. **AI-judged XP now visible, still fully separate from the real XP.** `daily_summaries.xp_awarded`/`xp_reason` already existed (never wired to `profiles.xp`) but had no UI. Added `xp_awarded, xp_reason` to the `daily_summaries` select in `App.jsx`, and a small, clearly-labeled "Companion's read (experimental)" line under the Talk screen's greeting (`CompanionScreen.jsx`) showing the most recent day with an AI-judged reason. No schema change, no merge with the real Arc/XP system — exactly what was asked for.
3. **Old modal coach drawer (CoachBar + AICoach) retired.** `App.jsx` no longer mounts the docked bottom mic-bar or the `<AICoach>` chat modal on any screen — Talk (`CompanionScreen.jsx`) is now the one true conversation surface. Nudges elsewhere that used to open that modal with a pre-filled/auto-sent message (Today's "missed habits" nudge, Hub/limit-card "lower this budget?" nudge, Arc's "add a new proof action" flow) now navigate to Talk instead and pre-fill the input via a new `initialDraft`/`onDraftConsumed` prop pair on `CompanionScreen` — deliberately NOT auto-sent (some of these can mutate the Arc; worth a beat to review before sending, where the old drawer used to fire immediately on mount). The "link the next created habit as an Arc proof action" mechanism (`proofActionLinkNextRef`) already worked identically through `CompanionScreen`'s existing `onHabitCreated`, so that part needed no new plumbing.
   - **Known regression, not yet fixed:** `CompanionScreen.jsx` never got a `<goal_plan>` card renderer (the "propose a goal, tap Create this goal" two-step flow AICoach.jsx supported). `handleGoalPlanConfirm` in `App.jsx` is now unreachable dead code — left in place on purpose as a marker for restoring this, not deleted. Regular goal creation via the Add flow is unaffected; only the conversational "help me set a goal" shortcut is gone. Worth a fast-follow.
   - Demo-mode's pre-login marketing preview (a separate, unrelated `CoachBar` usage shown to logged-out users) was NOT touched — out of scope, not the live conversation surface.
4. **Renamed "Coach"→"Companion" across all non-protected UI copy** — default name fallbacks (`theme.js`'s `clampProfileCoachName`, onboarding, sign-out reset, `CompanionScreen`/`TodayScreen`/`ArcCoachSheet`/`SocialScreen`), settings labels (`ProfileScreen`'s "Companion voice"/"AI companion name", `SocialScreen`'s rename sheet), body copy (`JournalScreen`, `TodayScreen`, `ArcSetupSheet`... — the sentinel comparisons that detect "has the user customized this name" (`JournalScreen.jsx`) were updated from `!== "Coach"` to `!== "Companion"` to match, so **existing users who already have a literal "Coach" saved in `profiles.coach_name` correctly keep seeing "Coach"** (their own established name, not silently renamed) — only new/reset accounts get "Companion" as the default going forward. Onboarding's tour step targeting the old floating coach FAB (`data-tour="coach-fab"`, removed along with the drawer) was retargeted to the Talk nav tab instead (`data-tour="companion-nav"`, added to the nav button in `App.jsx`), with updated copy.
   - **Not fully done — blocked, same reason as the personality fix below:** three `|| "Coach"` fallbacks remain inside the protected `AICoach.jsx` (lines 35, 385, 1450). Low-visibility now (only hit when `coachName` is empty, which is rare now that every upstream default was fixed) but not zero-risk to leave — bundled with the ask below.

**Not done — blocked on a real safety gate, needs your action:** the personality fix (making the base coach stop leading with Arc/proof-actions even in casual conversation — confirmed still happening: a "just entertain me" request in Just Chat mode used Arc/day-41 material as its actual content) requires editing the protected `src/coach/AICoach.jsx`. You explicitly authorized this in conversation, but this repo has a **separate, independent technical guardrail** (`.claude/hooks/pre_tool_use.py`) that blocks edits to protected paths unless `FORGED_OVERRIDE_PROTECTED=1` is set in the real environment — and correctly, the agent auto-mode classifier refused to let me set that variable myself, since doing so would be circumventing the very safety net it exists to enforce. **This needs you to set `FORGED_OVERRIDE_PROTECTED=1` yourself** (or explicitly instruct skipping the direct edit) before this can proceed. The edit itself is fully drafted and described in §5b below — two added sentences to the "HOW TO SOUND" block in `buildCoachSystemPrompts` — ready to apply the moment the override is set.

**Also earlier this same day:** the full ElevenLabs voice-pipeline fix sequence (gapless Web Audio buffer scheduling replacing `<audio>`-element chunk playback, silent-AudioContext fix, concurrency-limit fix, `Content-Length` fix, latency fix) — all still in place, see §5.

**Prior note on process, still worth keeping in mind:** an earlier attempt at the Talk-screen voice pill (via Cursor) reported a commit hash that was verified, directly against the remote repository, to not exist on any branch — nothing had actually reached GitHub, which is why it never appeared live. That work was redone from scratch instead of debugged, since there was nothing on the remote to inspect. If a tool reports a commit/milestone as complete, verify it landed on `origin` (`git log origin/<branch>`) before trusting the report or building further on top of it.

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
- **Round 4, a new symptom found after Round 3 shipped — inter-chunk glitches at every boundary, not just some:** Round 3's fix (above) permanently routed the shared `<audio>` element's output through a Web Audio graph via `createMediaElementSource()`. That graph works fine for a single unchanging audio source, but `useCoachTts.jsx` reassigns that same element's `.src` once per sentence-chunk — and doing that on an element already wired into a Web Audio graph forces the browser to reload/resync the pipeline every time, which is audible as a brief glitch. With one chunk per sentence, that's a glitch at *every* sentence boundary — reported as "a couple words, cut out, a couple words, cut out." Fixed by removing the `<audio>` element from TTS playback entirely: `useCoachTts.jsx` now fetches each chunk, decodes it via `ctx.decodeAudioData()` into a raw `AudioBuffer`, and schedules playback with `AudioBufferSourceNode.start(time)` — each chunk's start time is set to exactly when the previous chunk's buffer ends, on the `AudioContext`'s own clock, so on-schedule chunks play back-to-back with no reload step and no seam. The Ember's visualizer reads frequency data from this same hook's analyser (exposed as `coachTts.analyserRef`) instead of `CompanionScreen.jsx` creating a second, separate `AudioContext`/`MediaElementSource` — one audio pipeline now, not two. **Unverified by ear** — needs a real listen to confirm the stutter is actually gone.
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

1. ~~Build the Talk-screen voice controls~~ **Done** — see §9.
2. ~~Retire the old CoachBar/modal drawer (Phase 2b)~~ **Done** — see the top of this doc. One known regression to fast-follow: `<goal_plan>` card rendering never made it to `CompanionScreen.jsx`.
3. ~~Rename Coach→Companion (Phase 2e)~~ **Done for all non-protected UI copy** — see the top of this doc. Three fallback strings remain in the protected `AICoach.jsx`, bundled with item 4 below.
4. **Fix the personality at the source (protected `AICoach.jsx`) — blocked, needs you to set `FORGED_OVERRIDE_PROTECTED=1`.** Fully drafted, described at the top of this doc and in §5b. Top of the list the moment it's unblocked.
5. **Embeddings vendor decision + wire up retrieval (Phase 2a, remaining piece)** — the actual unlock for genuine cross-time memory ("you changed your opinion since April"). The one genuinely big, separable project left.
6. **The XP collision (Phase 2d)** — resolved as "don't merge, keep observing separately," not "merge them." Done via item 2 above (the "Companion's read" line); no further action needed unless you want the two systems reconciled later.

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
| `src/hooks/useCoachTts.jsx` | Text-to-speech playback — chunking, gapless Web-Audio-buffer scheduling (`AudioContext`/`AudioBufferSourceNode`, no `<audio>` element), exposes `analyserRef` for the Ember's audio reactivity. | No |
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
