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

### Base Drafts (v1)

#### Version A — "Motivation didn't show up today."
- File: `marketing/reels/forged_reel_A.mp4`
- Duration: ~16s — Assembly script: `scripts/assemble-reels.mjs`
- Resolution: 1080×1920 H264, 30fps, silent AAC — Size: ~1.0 MB

#### Version B — "I nearly skipped today."
- File: `marketing/reels/forged_reel_B.mp4`
- Duration: ~16s
- Resolution: 1080×1920 H264, 30fps, silent AAC — Size: ~1.0 MB

---

### Polished Versions (v2) — **USE THESE**

**Why Reel B is the priority version:**
Reel B ("I nearly skipped today. So I logged proof instead.") uses a first-person confessional hook that lowers the barrier to identification. The viewer sees themselves in the moment of resistance — not as someone who failed, but as someone who acted anyway. This is lower-funnel and more shareable than Reel A's third-person framing.

#### Reel B Polished — **Primary deliverable**
- File: `marketing/reels/forged_reel_B_polished.mp4`
- Duration: **13.3s** (within 12–16s spec)
- Resolution: 1080×1920 H264, 30fps, silent AAC — Size: 6.0 MB
- Thumbnail: `marketing/reels/forged_reel_B_thumbnail.png` (frame at t=1s)
- Assembly script: `scripts/assemble-reels-polished.mjs`

| Segment | Duration | Asset | Overlay text | Position |
|---------|----------|-------|-------------|---------|
| 1 | 2.0s | A1 (0/5 state, subtle zoom) | "I nearly skipped today." — white 58px | y=1625 |
| 2 | 3.5s | R1 trim ss=5.0 | "So I logged proof instead." — gold #C8902A 52px | y=1625 |
| 3 | 4.0s | R2 trim ss=5.0 | "Not perfect. Recorded." — white 60px | y=1625 |
| 4 | 3.0s | D3 receipt (subtle zoom) | "The day didn't disappear." — white 52px | y=1625 |
| 5 | 2.0s | End card (dark bg, DM Serif Display) | "Forged" white 136px + "Proof over promises." gold 50px | center |

Transitions: 0.3s xfade fade between all segments (4 cuts).
Text: 0.25s fade-in per caption. Two-layer dark gradient bar at bottom 22% for legibility.
End card: FFmpeg near-black `#0F0F0D` with warm amber glow overlay. "Forged" wordmark in DM Serif Display.

#### Reel A Polished — Secondary
- File: `marketing/reels/forged_reel_A_polished.mp4`
- Duration: 13.3s — Same pipeline as Reel B, third-person hook
- End card tagline: "Build the evidence."

---

## 9. Export Paths

```
marketing/reels/forged_reel_B_polished.mp4     — PRIMARY (post this first)
marketing/reels/forged_reel_B_thumbnail.png    — Thumbnail for Reel B
marketing/reels/forged_reel_A_polished.mp4     — Secondary
marketing/reels/forged_reel_A.mp4              — Base draft (v1)
marketing/reels/forged_reel_B.mp4              — Base draft (v1)
```

Polished assembly script: `scripts/assemble-reels-polished.mjs`
Re-run with: `node scripts/assemble-reels-polished.mjs`

Base assembly script: `scripts/assemble-reels.mjs`

> Note: `marketing/reels/` is in `.gitignore`. MP4s and thumbnails are not committed.
> Re-run the scripts from captured assets to regenerate.

---

## 10. Exact Captions & Hashtags

**Reel B caption (APPROVED — use this):**
> I nearly skipped today, so I logged proof instead. One day doesn't have to be perfect to be on the record.

**Reel B hashtags (3–6 max):**
`#proofoverpromises` `#habitbuilding` `#selfimprovement` `#forgedapp`

**Reel A caption:**
> Motivation didn't show up today. Proof still can. Forged tracks what you actually did — not what you planned.

**Reel A hashtags:**
`#proofoverpromises` `#productivity` `#selfimprovement` `#forgedapp`

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

## 12. Higgsfield Usage This Session

### Credits spent: 2

| Job | ID | Model | What | Cost | Used? |
|-----|-----|-------|------|------|-------|
| End card background | `170993fb-b9d8-46d3-9045-9e9e7e0217f3` | `marketing_studio_image` | Near-black charcoal abstract bg, 9:16, 768×1376 | 2 credits | NOT used — CDN domain blocked by container egress policy |

The image was generated successfully and is viewable at the Higgsfield job URL. However, the remote execution container's egress policy blocks the CloudFront CDN (`d8j0ntlcm91z4.cloudfront.net`), so the file could not be downloaded locally. The polished reel end card fell back to a pure FFmpeg dark background (`#0F0F0D` + warm amber glow).

**To use the Higgsfield end card:** download the image manually from Higgsfield's media library and place it at `/tmp/forged_endcard_bg.jpg`, then re-run `node scripts/assemble-reels-polished.mjs`. The script auto-detects the file and uses it if present and >1KB.

---

## 13. Higgsfield Rules

### DO NOT
- Do not use Higgsfield for random lifestyle images
- Do not use Higgsfield to replace app footage — the UI is the product
- Do not spend Higgsfield credits without explicit concept approval, cost confirmation, and shot list sign-off
- Do not generate image/video/audio until: (1) concept approved, (2) cost confirmed, (3) shot list approved
- Do not generate humans, desks, laptops, generic productivity scenes, or fake phone UIs

### WHEN IT WOULD HELP
Higgsfield adds value ONLY when:
1. You need a premium brand background for an end card (abstract, atmospheric, no people)
2. You need a human moment that grounds the viewer before showing the app (e.g., "phone on a desk at 6am, hand reaches for it")
3. You need a transition between product shots that would feel abrupt without a real-world bridge

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

## 14. Future Higgsfield Ideas (NOT APPROVED)

These are brainstorm ideas only. Do not run any of these without explicit approval.

| Concept | What it adds | Estimated use |
|---------|-------------|---------------|
| "Phone on a desk, 6am, hand reaches for it" | Opens Reel 3 with human context before 0/5 ring | 2s, generate_video, ~1 credit |
| "Person closes laptop, picks up phone" | Transition between D1 (complete) and Arc evidence | 1.5s, generate_video |
| "Handwritten journal open next to phone" | Context for receipt card (D3) | Still image, generate_image |
| Premium dark end card background (retry) | Better than FFmpeg fallback — deep cinematic bg | generate_image, 2 credits — already approved concept, re-run when egress allows download |

**None of the first three are approved.** The end card background concept is approved (already spent 2 credits); retry the download when running outside the restricted container.

---

## 15. Continuing in Cursor or a New Claude Session

### Current state
1. Branch: `claude/forge-companion-preview-7z10r3` (working branch)
2. All product cleanup is merged to `main` at `2762185`
3. Asset captures: `scripts/captures/` (17 PNGs), `scripts/recordings/` (4 WebMs) — not committed (gitignored)
4. Polished reels: `marketing/reels/forged_reel_B_polished.mp4` + `_A_polished.mp4` — not committed (gitignored)
5. Thumbnail: `marketing/reels/forged_reel_B_thumbnail.png` — not committed (gitignored)
6. Assembly scripts committed: `scripts/assemble-reels.mjs`, `scripts/assemble-reels-polished.mjs`

### To regenerate polished reels (no product changes needed)
```bash
# Ensure fonts are present
ls /tmp/DMSerifDisplay-Regular.ttf /tmp/DMSans-Variable.ttf || \
  node scripts/download-fonts.mjs   # or download manually

# Ensure captures/recordings exist (run capture scripts if not)

node scripts/assemble-reels-polished.mjs
```

### To use the Higgsfield end card
```bash
# Download the already-generated image (job 170993fb-...) from Higgsfield's media library
# Save as /tmp/forged_endcard_bg.jpg
node scripts/assemble-reels-polished.mjs  # script auto-detects the file
```

### To recapture assets (if product changes)
```bash
npm run dev &
node scripts/capture-proofstates.mjs
node scripts/capture-recordings.mjs
node scripts/assemble-reels-polished.mjs
```

### What needs approval before posting
1. Watch `forged_reel_B_polished.mp4` — approve timing, text, end card
2. Decide on audio: silent (current), lo-fi ambient, or branded sting
3. Confirm CTA approach: link-in-bio, App Store URL, or no CTA
4. Approve caption and 4 hashtags (or adjust)
5. Optionally: download Higgsfield end card bg and rebuild for premium look

### What NOT to do without approval
- Do not post to social channels
- Do not push product code to `main` without testing
- Do not spend additional Higgsfield credits (2 already spent this session)
- Do not generate humans, desks, or lifestyle footage
- Do not touch Three.js or the Forge Companion branch
