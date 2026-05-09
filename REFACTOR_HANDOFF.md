# Forged — App.jsx Refactor Handoff

**Status as of 2026-05-05**
**Safe to pause here: YES — App.jsx is completely untouched and working.**

---

## 1. Current State

The refactor is **additive only**. `src/App.jsx` has NOT been modified to import from any new file. The new files sit alongside the monolith as verified, ready-to-wire modules. The app builds and deploys normally right now.

### Files Created (all new, all untracked in git)

| File | Lines | Status |
|------|-------|--------|
| `src/theme.js` | 157 | ✅ Complete — all constants, theme, CSS |
| `src/utils.js` | 2,004 | ✅ Complete — all pure utility functions |
| `src/components/ui.jsx` | 434 | ✅ Complete — shared UI components |
| `src/hooks/useSpeechInput.js` | 759 | ✅ Complete — speech hook + MicBtn |
| `src/components/habitCards.jsx` | 1,375 | ✅ Complete — all habit cards, modals, tour constants |
| `src/screens/TodayScreen.jsx` | 184 | ✅ Complete — TodayScreen + CoachGreeting |
| `src/screens/JournalScreen.jsx` | 1,249 | ✅ Complete — BetaModal + JournalScreen + helpers |
| `src/screens/OnboardingScreen.jsx` | 818 | ✅ Complete — OnboardingScreen + helpers |

### Files NOT Yet Created

| File | What it needs | Approx lines in App.jsx |
|------|--------------|------------------------|
| `src/screens/InsightsScreen.jsx` | InsightsScreen (search: line ~6700+) | ~800 |
| `src/screens/SocialScreen.jsx` | LogGoalModal, AddGoalModal, EditGoalModal, AddActionSheet, CoachSettingsSheet, CoachComingSoonSheet, SocialTeaserCard, SocialScreen | ~2,200 |
| `src/screens/ProfileScreen.jsx` | UpgradeModal, AvatarPickerModal, ShareCardModal, AVATARS const, ProfileScreen | ~1,800 |
| `src/screens/auth.jsx` | DemoBanner, BetaPaywallModal, WelcomeModal, ProThankYouModal, PaywallScreen, AuthScreen, SetPasswordScreen, CheckEmailScreen | ~1,200 |
| `src/coach/AICoach.jsx` | coachRichTextToElements, CoachReceiptChips, CoachFormattedBubble, CoachRecordingBar, GoalPlanPreview, AICoach | ~3,320 |
| `src/coach/CoachApp.jsx` | DEMO_CLIENTS, _demoLast7, CoachClientRow, CoachClientDetail, CoachPaywall, CoachSectionLabel, CoachApp, CoachWelcomeScreen | ~760 |
| `src/components/CoachBar.jsx` (or add to AICoach.jsx) | CoachBar (lines 4224–4346) | ~122 |

**Also needed:** `src/coach/` directory (empty, needs `mkdir`).

---

## 2. The Final Step (After All Files Are Created)

Once all files above exist, **rewrite `src/App.jsx`** to import from them.

App.jsx currently has 3 imports at the very top (lines 1–4):
```javascript
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { flushSync, createPortal } from "react-dom";
import { supabase, habitToRow, rowToHabit, rowToGoal, goalToRow } from "./supabase.js";
```

The final App.jsx should:
1. Keep those 3 imports
2. Add imports for every extracted file
3. Keep ONLY: lines 1–65 (startup helpers), and the main `App()` function
4. Remove all the extracted definitions from its body

The `App()` function starts around **line 14344** (search for `export default function App(`).

---

## 3. How to Find Line Numbers Fast

```bash
grep -n "^function InsightsScreen\|^function SocialScreen\|^function ProfileScreen\|^function UpgradeModal\|^function AvatarPickerModal\|^function ShareCardModal\|^function AuthScreen\|^function SetPasswordScreen\|^function CheckEmailScreen\|^function DemoBanner\|^function BetaPaywallModal\|^function WelcomeModal\|^function ProThankYouModal\|^function PaywallScreen\|^function AICoach\|^function CoachApp\|^function CoachClientRow\|^function CoachBar\|^export default function App" /Users/corbynmiller/Desktop/Forged/src/App.jsx
```

---

## 4. Exact Next Steps for Cursor

### Step A — Create missing directory
```bash
mkdir -p /Users/corbynmiller/Desktop/Forged/src/coach
```

### Step B — Create `src/screens/InsightsScreen.jsx`

Read App.jsx from the `function InsightsScreen` definition to just before the next top-level `function`. Export `InsightsScreen`.

Imports:
```javascript
import { useState, useEffect, useMemo } from "react";
import { T } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, daysAgo, weekStartFor, getStreak, getBestStreak,
  getCompletionRate, get7DayActivity, getBestDayOfWeek,
  isSatisfiedForTodayRing, getGoalProgress, analyzeDeepInsights,
  mergedLast7, WEEKLY_SUMMARY_TTL_MS,
} from "../utils.js";
import { GBtn, PBtn, ActivityDots, CompletionBar } from "../components/ui.jsx";
import { HabitGrid } from "../components/habitCards.jsx";
```

### Step C — Create `src/screens/SocialScreen.jsx`

Read App.jsx from `function LogGoalModal` to just before `function ProfileScreen` (or wherever SocialScreen ends). Export `SocialScreen`. Keep helpers non-exported.

Imports:
```javascript
import { useState, useEffect, useRef, useMemo } from "react";
import { T, COLORS, COACH_ICON_OPTIONS } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, fmtEntryDate, getGoalProgress, goalBarFillWidthPct,
  getGoalPacing, fmtGoalDueHuman, formatWithUnit, getStreak,
  openForgedFeedbackMailto, normalizeCoachIcon,
} from "../utils.js";
import { Modal, GBtn, PBtn, FG, lbl, inp, JoinCoachSection, Ring } from "../components/ui.jsx";
import { TodayGoalCard, GoalDetailSheet } from "../components/habitCards.jsx";
```

### Step D — Create `src/screens/ProfileScreen.jsx`

Read App.jsx from around `function UpgradeModal` through `function ProfileScreen`. Also capture the `AVATARS` constant (around line 11206). Export `ProfileScreen`, `UpgradeModal`.

Imports:
```javascript
import { useState, useEffect, useRef, useCallback } from "react";
import { T, COLORS, COACH_ICON_OPTIONS, XP_LEVELS, FREE_DAILY_LIMIT, CREATOR_ID } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, getLevel, nextLevel, getStreak, getBestStreak,
  getCompletionRate, openForgedFeedbackMailto, normalizeCoachIcon,
  syncCoachMsgCountFromStorage,
} from "../utils.js";
import { Modal, GBtn, PBtn, FG, lbl, inp, Toggle, ToggleSwitch, NotifCategoryRow, Ring } from "../components/ui.jsx";
import { XPModal } from "../components/habitCards.jsx";
```

### Step E — Create `src/screens/auth.jsx`

Read App.jsx from `function DemoBanner` (or `function AuthScreen`) through `function CheckEmailScreen`. Export `AuthScreen`, `SetPasswordScreen`, `CheckEmailScreen`, `DemoBanner`, `BetaPaywallModal`, `WelcomeModal`, `ProThankYouModal`, `PaywallScreen`.

Imports:
```javascript
import { useState, useEffect, useRef } from "react";
import { T } from "../theme.js";
import { supabase } from "../supabase.js";
import { todayStr } from "../utils.js";
import { Modal, GBtn, PBtn, FG, lbl, inp } from "../components/ui.jsx";
```

### Step F — Create `src/coach/AICoach.jsx`

Read App.jsx from line 4224 (`CoachBar`) and from line 8919 (`coachRichTextToElements`) through line ~12940. This is ~3,500 lines. Export `CoachBar`, `AICoach`. Keep helpers non-exported.

Imports:
```javascript
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { T, COACH_ICON_OPTIONS, WEEKLY_SUMMARY_TTL_MS, FREE_DAILY_LIMIT, CREATOR_ID } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, parseLocal, fmtDate, fmtEntryDate,
  getStreak, isSatisfiedForTodayRing, getGoalProgress, goalBarFillWidthPct,
  getGoalPacing, fmtGoalDueHuman, getProgressStats, formatWithUnit,
  mergedLast7, clientRowMeta, clientInsightLine, buildSessionBrief,
  buildCoachSystemPrompt, buildCreatorGreeting, coachGreetingForNow,
  loadCoachDayMessages, saveCoachDayMessages, formatCoachMsgTime,
  COACH_STREAM_ID, COACH_DAY_MAX_MESSAGES, COACH_API_MESSAGE_CAP,
  syncCoachMsgCountFromStorage, splitCoachReceipt, parseGoalPlan,
  getHabitCardStreakSuffix, truncateText, pickCreatorLine, CREATOR_RECENT_KEY,
  COACH_NUDGE_DURATION_MS, COACH_SUMMARY_UUID_RE,
} from "../utils.js";
import { Modal, GBtn, PBtn, lbl, inp } from "../components/ui.jsx";
import { useSpeechInput, MicBtn, mergeDictationIntoText, polishInterimDisplay } from "../hooks/useSpeechInput.js";
```

### Step G — Create `src/coach/CoachApp.jsx`

Read App.jsx from line ~12941 (`CoachClientRow`) to ~14423 (`CoachWelcomeScreen`). Note: `DEMO_CLIENTS` and `_demoLast7` are defined around line 13555 — include them in this file (they're only used here). Export `CoachApp`, `CoachWelcomeScreen`.

Imports:
```javascript
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { T, CREATOR_ID } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, fmtEntryDate, fmtDate, mergedLast7, clientRowMeta,
  buildSessionBrief, previewAiBriefFromClient, clientInsightLine,
  CREATOR_RECENT_KEY, getStreak, truncateText,
} from "../utils.js";
import { Modal, GBtn, PBtn, lbl, inp, ActivityDots } from "../components/ui.jsx";
import { AICoach } from "./AICoach.jsx";
```

### Step H — Rewrite App.jsx

This is the final and most critical step. Do it last. 

Find `export default function App(` in App.jsx and note its line number.
Find the startup helpers section (lines 1–65 roughly).

New App.jsx structure:
```javascript
// Lines 1-4: existing React/supabase imports (keep exactly)
import { useState, useEffect, ... } from "react";
import { flushSync, createPortal } from "react-dom";
import { supabase, habitToRow, rowToHabit, rowToGoal, goalToRow } from "./supabase.js";

// New imports from extracted files:
import { T, CSS, COLORS, HABIT_TYPES, XP_LEVELS, DAYS, MONTHS, COACH_ICON_OPTIONS, WEEKLY_SUMMARY_TTL_MS, FREE_DAILY_LIMIT, CREATOR_ID, cssPadTopSafe, cssPadXSafe, cssPadBottomSafe, COACH_PAGE_NUDGES, PAGE_GUIDE_PAGES } from "./theme.js";
import { /* all used utils */ } from "./utils.js";
import { Particle, XPFlash, Toast, Ring, SLabel, Stat, Modal, FG, PBtn, GBtn, Toggle, DoneBanner, TourOverlay, ToggleSwitch, NotifCategoryRow, JoinCoachSection, ActivityDots, CompletionBar, lbl, inp } from "./components/ui.jsx";
import { useSpeechInput, MicBtn, mergeDictationIntoText, polishInterimDisplay } from "./hooks/useSpeechInput.js";
import { NoteStrip, DailyCard, WeeklyCard, ProjectCard, LimitCard, LogCard, TodayGoalCard, GoalDetailSheet, LinkHabitsSheet, LogProjectModal, ReflectModal, EditModal, AddModal, AddLogModal, XPModal, HabitGrid, HistoryModal, TYPE_META, GLOBAL_TOUR, PAGE_TOURS } from "./components/habitCards.jsx";
import { TodayScreen, CoachGreeting } from "./screens/TodayScreen.jsx";
import { JournalScreen, BetaModal } from "./screens/JournalScreen.jsx";
import { InsightsScreen } from "./screens/InsightsScreen.jsx";
import { SocialScreen } from "./screens/SocialScreen.jsx";
import { ProfileScreen, UpgradeModal } from "./screens/ProfileScreen.jsx";
import { AuthScreen, SetPasswordScreen, CheckEmailScreen, DemoBanner, BetaPaywallModal, WelcomeModal, ProThankYouModal, PaywallScreen } from "./screens/auth.jsx";
import { OnboardingScreen } from "./screens/OnboardingScreen.jsx";
import { AICoach, CoachBar } from "./coach/AICoach.jsx";
import { CoachApp, CoachWelcomeScreen } from "./coach/CoachApp.jsx";

// Keep lines ~1-65: startup helpers (isLikelyHomeScreenPwa, hasStoredSupabaseSession, etc.)
// Then: export default function App() { ... }  ← keep the full App() component intact
```

**⚠️ CRITICAL**: When rewriting App.jsx, do NOT delete any code until you've confirmed the new file for it exists and is complete. Remove code in sections, not all at once.

---

## 5. What NOT to Touch

- **`src/App.jsx`** — do not modify until ALL new files are complete and verified
- **`src/supabase.js`** — do not touch
- **`src/main.jsx`** — do not touch
- **`api/`** directory — do not touch
- **`supabase/migrations/`** — do not touch

---

## 6. Known Risks

### Risk 1: Import name mismatches
Some functions in the new files may have slightly different names than what App.jsx expects. **Fix**: before wiring App.jsx, do a quick grep to confirm every exported name matches what App.jsx calls.

### Risk 2: OnboardingScreen.jsx redefines helpers
The agent that created `OnboardingScreen.jsx` defined `daysAgo`, `isLegacyProgressType`, and `inferProgressDirection` locally (seen in the file). These are already exported from `utils.js`. Before using OnboardingScreen.jsx, remove the local copies and import them from utils.js instead.

### Risk 3: JournalScreen.jsx import verification
JournalScreen.jsx imports `fmtWeekRange`, `loadJournalMissedMap`, `saveJournalMissedMap` from utils.js — **confirmed these ARE exported from utils.js**. ✅

### Risk 4: AICoach.jsx is ~3,500 lines
The AICoach component is the most complex in the app. Extract it last among the new files and test the coach modal thoroughly after wiring.

### Risk 5: DEMO_CLIENTS is in App.jsx
`DEMO_CLIENTS` and `_demoLast7` are constants defined around line 13555 of App.jsx. They need to go into `CoachApp.jsx`, NOT `theme.js`.

---

## 7. Testing Checklist (After Wiring App.jsx)

Run `npm run dev` and check:

- [ ] App loads without console errors
- [ ] Can sign in / sign out
- [ ] Today screen shows habits and goals
- [ ] Can log a habit (daily, weekly, project, limit)
- [ ] Rest day / skip works
- [ ] Note strip works (type + voice)
- [ ] Reflect modal works
- [ ] Journal screen loads and shows entries
- [ ] Insights screen loads and shows stats
- [ ] Social screen loads (even if coach section is gated)
- [ ] Profile screen loads and shows XP
- [ ] Upgrade modal works
- [ ] Coach floating bar appears (CoachBar)
- [ ] Coach AI chat opens and sends a message
- [ ] Weekly brief generates (Pro or free trial)
- [ ] XP modal opens from header
- [ ] Add habit modal (all 5 types)
- [ ] Edit habit modal
- [ ] History modal (habit grid)
- [ ] Goal detail sheet
- [ ] `npm run build` completes without errors

---

## 8. Rollback

If anything breaks after wiring App.jsx:

```bash
git stash          # stash the App.jsx changes
git stash pop      # to restore if needed
```

Or just revert App.jsx to the last committed state:
```bash
git checkout HEAD -- src/App.jsx
```

The new files in `src/components/`, `src/hooks/`, `src/screens/`, `src/coach/`, `src/theme.js`, and `src/utils.js` are all **additive** — removing them from App.jsx imports simply reverts to the original monolith. Nothing is lost.

---

## 9. Git Commit Advice

1. Commit all new files first (additive, safe):
   ```bash
   git add src/theme.js src/utils.js src/components/ src/hooks/ src/screens/ src/coach/
   git commit -m "refactor: extract modules from App.jsx monolith (additive, App.jsx unchanged)"
   ```
2. Then commit the App.jsx wire-up separately:
   ```bash
   git add src/App.jsx
   git commit -m "refactor: wire App.jsx to use extracted modules"
   ```
3. Deploy and verify, then optionally delete the now-dead definitions from App.jsx body.

---

## 10. Summary of Extracted vs Remaining

**Already in new files (do not re-extract):**
- All theme constants and CSS → `theme.js`
- All pure utility functions → `utils.js`
- Particle, XPFlash, Toast, Ring, SLabel, Stat, Modal, FG, PBtn, GBtn, Toggle, DoneBanner, TourOverlay, ToggleSwitch, NotifCategoryRow, JoinCoachSection, ActivityDots, CompletionBar, lbl, inp → `components/ui.jsx`
- useSpeechInput, MicBtn, mergeDictationIntoText, polishInterimDisplay, all speech helpers → `hooks/useSpeechInput.js`
- NoteStrip, cardStyle, IconBox, CheckBtn, PlusBtn, useTodayHabitLongPeekHandlers, TodayOverflowDotsBtn, TodayHabitMenuDropdown, DailyCard, WeeklyCard, ProjectCard, LimitCard, LogCard, LinkHabitsSheet, GoalDetailSheet, TodayGoalCard, LogProjectModal, ReflectModal, TYPE_META, EditModal, AddModal, AddLogModal, XPModal, HabitGrid, HistoryModal, GLOBAL_TOUR, PAGE_TOURS → `components/habitCards.jsx`
- TodayScreen, CoachGreeting, buildCoachGreetingLine → `screens/TodayScreen.jsx`
- BetaModal, JournalScreen, EntryCard → `screens/JournalScreen.jsx`
- OnboardingScreen → `screens/OnboardingScreen.jsx`

**Still only in App.jsx (needs extraction):**
- InsightsScreen (~line 6700)
- LogGoalModal, AddGoalModal, EditGoalModal, AddActionSheet, CoachSettingsSheet, CoachComingSoonSheet, SocialTeaserCard, SocialScreen
- AVATARS const, UpgradeModal, AvatarPickerModal, ShareCardModal, ProfileScreen
- DemoBanner, BetaPaywallModal, WelcomeModal, ProThankYouModal, PaywallScreen, AuthScreen, SetPasswordScreen, CheckEmailScreen
- CoachBar (~line 4224)
- coachRichTextToElements, CoachReceiptChips, CoachFormattedBubble, CoachRecordingBar, GoalPlanPreview, AICoach (~line 8919)
- DEMO_CLIENTS, _demoLast7, CoachClientRow, CoachClientDetail, CoachPaywall, CoachSectionLabel, CoachApp, CoachWelcomeScreen (~line 12941)
- All startup helpers + the main App() component — these STAY in App.jsx

---

*Handoff created: 2026-05-05*
*App.jsx SHA: check `git log --oneline -1`*
