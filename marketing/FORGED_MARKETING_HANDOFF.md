# Forged — Marketing Handoff

Session: 2026-06-13
Branch at time of capture: `claude/arc-proof-review-fixes` (at commit `1f8c808`, same content as `main` `2762185`)

---

## 1. Current Product Positioning

**Tagline:** Proof over promises.

**Core loop:** Set an Arc (6-week commitment). Define proof actions (the 5 daily habits that prove you're becoming who you said you would be). Tap them each day. Forged logs it, writes a receipt, and builds a timeline of evidence. No motivation required — just the record.

**Differentiator from other habit apps:** Forged is not a streak counter. It generates written receipts for completed proof days and stores an evidence timeline (the Arc). The question it answers: "Did I show up for who I said I'd become?" — answered in writing, daily.

**Target user:** Someone who has tried habits apps before and failed not because they're lazy, but because nothing held them accountable to a narrative. They plan without shipping. They start without finishing. Forged replaces motivation with evidence.

---

## 2. Current Marketing Angle

Two proven hooks, both tested:

**A — Third-person behavioral:** "Motivation didn't show up today. Proof still can."
- For the audience that already knows motivation is unreliable
- Positions Forged as the fallback system, not the inspiration

**B — First-person confessional:** "I nearly skipped today. So I logged proof instead."
- More relatable, lower barrier to identification
- Positions the user as the hero who acted despite resistance

Both angles show the same product loop: 0/5 → taps → 5/5 complete → receipt → Arc timeline.

---

## 3. Assets Captured

### Screenshots (scripts/captures/)

| File | Content | State |
|------|---------|-------|
| A1_proof_0of5_top.png | Today screen — 0/5 ring + Arc block | Morning, nothing logged |
| A2_proof_0of5_cards.png | Today screen — scrolled down to proof cards | 0/5 |
| B1_proof_2of5_cards.png | Today screen — 2 done | 2/5 mid-day |
| C1_proof_3of5_cards.png | Today screen — 3 done | 3/5 |
| D1_proof_5of5_hero.png | Today screen — ring complete + "Today is complete." | 5/5 perfect day |
| D2_proof_5of5_cards.png | Today screen scrolled — all cards checked + hub link | 5/5 |
| D3_receipt_top.png | Today screen — "TODAY'S VERDICT" receipt visible | 5/5 + journal entry |
| D4_receipt_card.png | Today screen scrolled — receipt card details | 5/5 + journal entry |
| E1_arc_overview.png | Arc screen — overview + W3 current week + evidence | 5/5 no receipt |
| E2_arc_timeline.png | Arc screen — week timeline scrolled | 5/5 no receipt |
| E3_arc_details.png | Arc screen — Details tab | 5/5 |
| E4_arc_today_evidence_overview.png | Arc screen — Week 3 shows 4/7 days + today's evidence | 5/5 + receipt |
| E5_arc_today_evidence_timeline.png | Arc screen scrolled — evidence spine with today | 5/5 + receipt |
| G1_coach_chat.png | Coach open — Day 21 greeting, suggested prompts | Fresh open |
| H1_desktop_today.png | Desktop 1440px viewport — Today 2/5 state | 2/5 |
| I1_hub_top.png | Hub screen — "All habits & goals" header | Empty (proof-only user) |
| I2_hub_habits.png | Hub screen scrolled | Quick tasks section |

### Recordings (scripts/recordings/)

| File | Duration | Content |
|------|----------|---------|
| R1_proof_0to2.webm | 11.36s | 0/5 → tap Deep work + Move daily → 2/5 |
| R2_proof_3to5_complete.webm | 11.52s | 3/5 → tap Post + Evening check-in → 5/5 complete |
| R3_arc_scroll.webm | ~11s | Arc evidence spine scroll |
| R4_coach_nudge_and_open.webm | ~11s | Coach nudge appears → coach opens |

All recordings: VP8 WebM, 390×844 @ 1x (device scale 2x), 25fps. Headless Chrome capture, no audio.

---

## 4. Screenshot Save Path

```
/home/user/forged/scripts/captures/
```

---

## 5. Recording Save Path

```
/home/user/forged/scripts/recordings/
```

---

## 6. Product Commits That Matter

| Commit | Description |
|--------|-------------|
| `2762185` (main) | All product cleanup complete — proof actions, Arc display, Generate Entry |
| `1f8c808` | Hub copy "loose ends" → "quick tasks" fix + capture script update |

Key features confirmed working at these commits:
- Proof actions show on Today, not Hub
- "Wrap today" → Generate Entry calls the API and shows receipt
- Arc week display: chapter title from journal receipts (no stale AI text)
- Coach can create proof actions with `is_proof_action:true`
- "All habits & goals" hub button visible with subcopy on Today
- Hub scrolls to top on mount
- "Quick tasks" renamed throughout (was "loose ends")

---

## 7. Product Cleanup Completed This Session

1. **Generate Entry flow**: `onWrapToday` now calls `handleGenerateReceipt()`, stays on Today, shows success/failure toast
2. **All habits & goals button**: More visible with subcopy "Non-Arc habits, goals & quick tasks" and `→` arrow
3. **Hub scroll-to-top**: `useEffect(() => window.scrollTo(0,0))` on mount
4. **"Loose ends" → "Quick tasks"**: Renamed throughout TodayScreen, HubScreen (all occurrences including empty state body copy)
5. **"Write in journal" removed**: From AddActionSheet in SocialScreen
6. **Add proof action → Create new**: Opens coach with prefill "I want to add a new proof action for this Arc."
7. **Arc linkage for coach-created proof actions**: `create_habit` tool supports `is_proof_action` + `block_id`; Arc ID in system prompt; safety rule in coach instructions
8. **Weekly review AI text removed**: Removed `chapterSummary`, `briefText`, and "Write weekly review" button from ArcTimeline WeekDetail
9. **Arc nav selector bug**: Fixed in capture script (`button:has-text("Arc")` was matching "Non-Arc" subcopy before nav button)

---

## 8. Reels Created

### Version A — "Motivation didn't show up today."
- File: `marketing/reels/forged_reel_A.mp4`
- Duration: ~16s (1s over 15s spec — extra time used for R2 completion banner)
- Resolution: 1080×1920 H264, 30fps, AAC audio (silent)
- Size: ~1.0 MB

| Segment | Duration | Asset | Overlay text |
|---------|----------|-------|-------------|
| 1 | 2s | A1 (0/5 state) | "Motivation didn't show up today." — white, 52px |
| 2 | 3.5s | R1 trim (ss=5.0) | "Proof still can." — gold, 68px |
| 3 | 4.0s | R2 trim (ss=5.0) | "Day 21.  5 of 5." — white, 64px |
| 4 | 3s | D3 (receipt) | "Every day gets a record." — white, 52px |
| 5 | 3.5s | E4 (arc evidence) | "Forged" (gold 72px) + "build the evidence." (white 46px) |

Caption: "Motivation didn't show up today. Proof still can. Forged tracks what you actually did — not what you planned."

### Version B — "I nearly skipped today."
- File: `marketing/reels/forged_reel_B.mp4`
- Duration: ~16s
- Resolution: 1080×1920 H264, 30fps, AAC audio (silent)
- Size: ~1.0 MB

| Segment | Duration | Asset | Overlay text |
|---------|----------|-------|-------------|
| 1 | 2s | A1 (0/5 state) | "I nearly skipped today." — white, 58px |
| 2 | 3.5s | R1 trim (ss=5.0) | "So I logged proof instead." — gold, 52px |
| 3 | 4.0s | R2 trim (ss=5.0) | "Not perfect.  Recorded." — white, 60px |
| 4 | 3s | D3 (receipt) | "The day didn't disappear." — white, 52px |
| 5 | 3.5s | E4 (arc evidence) | "Forged" (gold 72px) + "proof over promises." (white 46px) |

Caption: "I nearly skipped today, so I logged proof instead. One day doesn't have to be perfect to be on the record."

---

## 9. Export Paths

```
marketing/reels/forged_reel_A.mp4   — Version A
marketing/reels/forged_reel_B.mp4   — Version B
```

Assembly script: `scripts/assemble-reels.mjs`
Re-run with: `node scripts/assemble-reels.mjs`

---

## 10. Exact Captions

**Version A caption:**
> Motivation didn't show up today. Proof still can. Forged tracks what you actually did — not what you planned.

**Version B caption:**
> I nearly skipped today, so I logged proof instead. One day doesn't have to be perfect to be on the record.

**Hashtags (Version A — productivity-coded):**
`#productivity` `#habittracking` `#deepwork` `#proofoverpromises` `#selfimprovement` `#forgedapp`

**Hashtags (Version B — confessional/relatable):**
`#habitbuilding` `#selfimprovement` `#dailyroutine` `#atomichabits` `#proofoverpromises` `#forgedapp`

---

## 11. Recommended Next Reels

**Reel 3 — Arc evidence reveal**
- Hook: "This is what 21 days looks like."
- Open: E4 (Arc overview with evidence spine)
- Scroll slowly through E5 (timeline)
- Close: D1 (5/5 ring) → "Not a streak. Evidence."
- Uses: R3_arc_scroll.webm for the scroll section

**Reel 4 — Coach as context partner**
- Hook: "Your AI coach reads the day and calls it."
- Show: G1 (coach open) → coach message "Day 21 of Build the System"
- Show: D3 (receipt after coach wraps the day)
- Close: Arc evidence
- Uses: R4_coach_nudge_and_open.webm

**Reel 5 — The 0/5 face (hardest to make without lifestyle shot)**
- Hook: "You don't need to want it."
- Open on 0/5 ring — pause — text fades in
- Then taps
- This is where Higgsfield could add value: a 1-second "phone in hand at a messy desk" clip before the 0/5 ring, to ground the viewer emotionally before showing the product

---

## 12. Higgsfield Rules

### DO NOT
- Do not use Higgsfield for random lifestyle images
- Do not use Higgsfield to replace app footage — the UI is the product
- Do not spend Higgsfield credits without explicit concept approval, cost confirmation, and shot list sign-off
- Do not generate image/video/audio until: (1) concept approved, (2) cost confirmed, (3) shot list approved

### WHEN IT WOULD HELP
Higgsfield adds value ONLY when:
1. You need a human moment that grounds the viewer before showing the app (e.g., "phone on a desk at 6am, hand reaching for it")
2. You need a transition between product shots that would feel abrupt without a real-world bridge
3. You're making a brand video that needs to establish a character before showing the loop

In those cases: document the exact shot, the duration, the number of seconds, and the Higgsfield tool/cost estimate, and get approval before running.

---

## 13. Future Higgsfield Ideas (NOT APPROVED)

These are brainstorm ideas only. Do not run any of these without explicit approval.

| Concept | What it adds | Estimated use |
|---------|-------------|---------------|
| "Phone on a desk, 6am, hand reaches for it" | Opens Reel 3 with human context before 0/5 ring | 2s, generate_video, ~1 credit |
| "Person closes laptop, picks up phone" | Transition between D1 (complete) and Arc evidence | 1.5s, generate_video |
| "Handwritten journal open next to phone" | Context for receipt card (D3) | Still image, generate_image |
| Split-screen: messy desk vs clean receipt | Visual metaphor for "proof over plans" | Static composite, generate_image |

**None of these are approved. Do not run them.** Bring a specific concept (exact shot, exact purpose, exact seconds) for approval before spending credits.

---

## 14. Continuing in Cursor or a New Claude Session

### State to restore
1. Working branch: `claude/arc-proof-review-fixes` — same content as `main` at `2762185`
2. All product cleanup is merged to main
3. Asset captures are at `scripts/captures/` (17 PNGs) and `scripts/recordings/` (4 WebMs)
4. Two reels assembled at `marketing/reels/`
5. Assembly script at `scripts/assemble-reels.mjs`

### To recapture assets (if you change the product)
```bash
npm run dev &          # start dev server
node scripts/capture-proofstates.mjs    # regenerate screenshots
node scripts/capture-recordings.mjs    # regenerate recordings
node scripts/assemble-reels.mjs         # rebuild reels
```

### To rebuild reels only (no product changes)
```bash
node scripts/assemble-reels.mjs
```

### What needs approval before doing anything else
1. Watch both reels and approve or reject the timing/text
2. Approve Version A or B (or both) for posting
3. Confirm caption hashtag set
4. Decide whether to add audio (lo-fi track, silent, or other)
5. Decide whether to trim to exactly 15s (trim R2 segment from 4s to 3s)
6. Decide on CTA: link-in-bio, App Store URL, or QR code overlay

### What NOT to do without approval
- Do not push product code to main without testing
- Do not spend Higgsfield credits
- Do not post to social channels
- Do not generate new assets
- Do not touch Three.js or the Forge Companion branch
