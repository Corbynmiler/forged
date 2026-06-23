
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { flushSync, createPortal } from "react-dom";
import { supabase, habitToRow, rowToHabit, rowToGoal, goalToRow, rowToTask, taskToRow, rowToForgeBlock, rowToArcDailyScore } from "./supabase.js";
import {
  calculateArcProofPercent,
  computeTodayArcXpAward,
  getArcRankDisplay,
  isProofHabitForBlock,
  getProofItemsForBlock,
  lifetimeXpForHabitLog,
  LIFETIME_XP_DURING_ARC_NON_PROOF,
  LIFETIME_XP_LIMIT_NONE,
} from "./arcProgress.js";

// Theme
import {
  T, CSS, COLORS, HABIT_TYPES, XP_LEVELS, DAYS, MONTHS,
  COACH_ICON_OPTIONS, WEEKLY_SUMMARY_TTL_MS, FREE_DAILY_LIMIT,
  CREATOR_ID, cssPadTopSafe, cssPadXSafe, cssPadBottomSafe,
  COACH_PAGE_NUDGES, PAGE_GUIDE_PAGES,
  PROFILE_DISPLAY_NAME_MAX, PROFILE_COACH_NAME_MAX,
  clampProfileDisplayName, clampProfileCoachName,
} from "./theme.js";

// Utils — only what App() uses directly
import {
  buildPageGuideMessage,
  clearAllPageGuideSeen,
  COACH_NUDGE_DURATION_MS,
  entityIdEq,
  fmtDate,
  fmtDateLong,
  getGoalProgress,
  goalStateAfterLogRemoval,
  isGoalLikeHabitType,
  isLegacyProgressType,
  normalizeSharedGoalHabitType,
  projectPersonalLogsForSharedMember,
  readForgedBetaEmailOptIn,
  readNudgeWatermark,
  readPageGuideSeen,
  resolveGoalForModal,
  sameUserId,
  splitDbRowsIntoGoalsAndHabits,
  todayLogs,
  todayStr,
  daysAgo,
  isSatisfiedForTodayRing,
  urlBase64ToUint8Array,
  weekStartFor,
  writeForgedBetaEmailOptIn,
  writeNudgeWatermarkIfNewer,
  writePageGuideSeen,
} from "./utils.js";
import { resolveArcTitle, normalizeArcDuration } from "./arcProofMatch.js";

// UI primitives
import {
  Particle, XPFlash, Toast, Ring, SLabel, Stat, Modal, FG,
  PBtn, GBtn, Toggle, DoneBanner, TourOverlay, ToggleSwitch,
  NotifCategoryRow, lbl, inp,
} from "./components/ui.jsx";

// Hooks
import {
  isLikelyHomeScreenPwa,
  copyForgedUrlToClipboard,
} from "./hooks/useSpeechInput.jsx";
import { useScrollLock } from "./hooks/useScrollLock.js";

// Habit cards
import {
  NoteStrip, DailyCard, WeeklyCard, ProjectCard, LimitCard,
  LogCard, TodayGoalCard, GoalDetailSheet, LinkHabitsSheet,
  LogProjectModal, ReflectModal, EditModal, AddModal, AddLogModal,
  HabitGrid, HistoryModal, TYPE_META, cardStyle,
  GLOBAL_TOUR, PAGE_TOURS,
} from "./components/habitCards.jsx";

// Screens
import { TodayScreen, CoachGreeting } from "./screens/TodayScreen.jsx";
import { ArcScreen } from "./screens/ArcScreen.jsx";
import { HubScreen } from "./screens/HubScreen.jsx";
import ArcSetupSheet from "./screens/ArcSetupSheet.jsx";
import ArcCoachSheet from "./screens/ArcCoachSheet.jsx";
import { ArcCompletedSheet, hasDecidedArc, markArcDecided } from "./components/ArcCompletedSheet.jsx";
import {
  SocialScreen,
  AddGoalModal,
  EditGoalModal,
  LogGoalModal,
  AddActionSheet,
  CoachComingSoonSheet,
} from "./screens/SocialScreen.jsx";
import { ProfileScreen, ShareCardModal } from "./screens/ProfileScreen.jsx";
import {
  AuthScreen,
  SetPasswordScreen,
  CheckEmailScreen,
  DemoBanner,
  DemoCoachModal,
  BetaPaywallModal,
  WelcomeModal,
  ProThankYouModal,
} from "./screens/auth.jsx";
import { OnboardingScreen, buildDemoHabits } from "./screens/OnboardingScreen.jsx";

// Coach
import { CoachBar, AICoach } from "./coach/AICoach.jsx";

/**
 * Returns true if Supabase has stored any session tokens in localStorage.
 * Supabase v2 stores session as "sb-{project-ref}-auth-token".
 * We use this to distinguish "genuinely new/signed-out user" (no tokens → show demo)
 * from "returning user with an expired access token being refreshed" (tokens exist → wait).
 * Prevents ghost-account flash on deployed apps where INITIAL_SESSION fires null
 * while Supabase is mid-refresh of an expired access token.
 */
function hasStoredSupabaseSession() {
  if (typeof localStorage === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      // Supabase v2: { access_token, refresh_token, ... }
      // Wrapped form:  { data: { session: { access_token, refresh_token } } }
      if (parsed?.refresh_token || parsed?.access_token) return true;
      if (parsed?.data?.session?.access_token || parsed?.data?.session?.refresh_token) return true;
    }
  } catch { /* ignore — read-only check, never throws to caller */ }
  return false;
}

// ── Startup reload recovery ───────────────────────────────────────────────
// Track the startup timestamp in the URL `_fst` (first-startup-time) param.
// Survives window.location.reload() (URL is preserved) but is cleared when
// the user opens the PWA home-screen tile fresh (loads the manifest start_url
// which has no params). This replaces the sessionStorage-based reload counter
// which persisted across PWA background/foreground cycles and caused the
// "stuck forever after 2 reloads" bug.
const _fstParam = (() => {
  try { return new URLSearchParams(window.location.search).get("_fst"); } catch { return null; }
})();
const _startupTs = (_fstParam && /^\d+$/.test(_fstParam)) ? parseInt(_fstParam, 10) : Date.now();
/** True once we have been attempting startup recovery for more than 60 s. */
const startupReloadExpired = Boolean(_fstParam) && (Date.now() - _startupTs) > 60000;

/** Hard-reload the page, preserving the _fst timestamp so we can detect timeout across reloads. */
function reloadForStartupRecovery(label) {
  try {
    if (label) console.log("[Forged] startup reload:", label, "elapsed:", Date.now() - _startupTs, "ms");
    const url = new URL(window.location.href);
    url.searchParams.set("_fst", String(_startupTs));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

export default function App() {
  const [onboarded,   setOnboarded]  = useState(null);
  const [user,        setUser]        = useState({ name:"", avatarUrl:null });
  const [habits,      setHabits]     = useState([]);
  const [goals,       setGoals]      = useState([]);
  // Active Arc (forge_block). Null when the user has no active Arc.
  // Phase 1: written on signup via onSaveProgress; loaded on every signed-in
  // session via loadUserData. Phase 2+3 will consume this for Today + coach.
  const [activeBlock, setActiveBlock] = useState(null);
  /** Latest completed Arc (for Insights end-of-Arc review display). */
  const [completedArcBlock, setCompletedArcBlock] = useState(null);
  const [showArcCoach, setShowArcCoach] = useState(false);
  const [arcCoachMode, setArcCoachMode] = useState("create");
  /** runItBack | evolve — pre-seeds ArcCoachSheet from a completed Arc. */
  const [arcCoachSeed, setArcCoachSeed] = useState(null);
  const [showArcSetup, setShowArcSetup] = useState(false);
  /** Arc form opened from ArcCoachSheet — Cancel returns to chat, not full dismiss. */
  const [arcSetupFromCoach, setArcSetupFromCoach] = useState(false);
  /** True while Arc proof habits are being linked/created — suppresses empty proof CTA on Today. */
  const [arcProofSyncing, setArcProofSyncing] = useState(false);
  const [arcLedgerRows, setArcLedgerRows] = useState([]);
  const [todayArcScore, setTodayArcScore] = useState(null);
  const [screen,      setScreen]     = useState("today");
  /** Active section inside the Arc screen: "arc" | "evidence" | "reviews". */
  const [arcTab,      setArcTab]     = useState("arc");
  const [xp,          setXp]         = useState(0);
  const [particles,   setParticles]  = useState([]);
  const [flashes,     setFlashes]    = useState([]);
  const [toasts,      setToasts]     = useState([]);
  const [showAdd,     setShowAdd]    = useState(false);
  const [showAddGoal,    setShowAddGoal]    = useState(false);
  const [showAddChoice,  setShowAddChoice]  = useState(false);
  const [showAddLog,        setShowAddLog]        = useState(false);
  const [tasks,             setTasks]             = useState([]);
  const [journalEntries,    setJournalEntries]    = useState([]);
  /** Layered coach memory: { content, recentSummaries: [{date, summary}] } (oldest first). */
  const [coachMemory,       setCoachMemory]       = useState(null);
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(false);
  const [coachVoiceId,        setCoachVoiceId]        = useState(null);
  const [showJournalCompose,setShowJournalCompose]= useState(false);
  const [generatingReceipt, setGeneratingReceipt] = useState(false);
  const [journalOpenTab,    setJournalOpenTab]    = useState(null);
  const [journalAutoGenerate, setJournalAutoGenerate] = useState(false);
  const [logGoalId,      setLogGoalId]      = useState(null);
  const [editGoalId,     setEditGoalId]     = useState(null);
  const [openGoalId,     setOpenGoalId]     = useState(null);
  const [showHistory, setShowHistory]= useState(false);
  const [showCoach,   setShowCoach]  = useState(false);
  /** How the coach sheet should prime input after open: voice vs keyboard. */
  const [coachOpenMode, setCoachOpenMode] = useState(null);
  // Whether the user has ever opened the AI coach in this browser. Used to drive
  // a subtle pulse on the FAB for first-time users so it doesn't vanish into the bg.
  const [coachEverOpened, setCoachEverOpened] = useState(() => {
    try { return localStorage.getItem("forged_coach_opened") === "1"; } catch { return false; }
  });
  const [showCoachTeaser, setShowCoachTeaser] = useState(false);
  /** Message auto-sent when AICoach mounts (e.g. nudge flows). Cleared after use. */
  const [coachPendingMsg, setCoachPendingMsg] = useState(null);
  /** Pre-fills the coach text input on open (not auto-sent). Cleared on close. */
  const [coachDraftInput, setCoachDraftInput] = useState(null);
  /** Guards duplicate auto-send when Add proof action → Create new habit is tapped twice. */
  const proofCoachLaunchRef = useRef(false);
  /** After coach creates a habit in the proof-action flow, link it to the active Arc. */
  const proofActionLinkNextRef = useRef(false);
  /** Ephemeral bubble above the coach FAB: `{ id, text }` while visible; `id` ties to the navigation that triggered it. */
  const [coachPageNudge, setCoachPageNudge] = useState(null);
  const coachNudgeSeqRef = useRef(0);
  // First-time AI page guide — persistent bubble shown once per page/user on
  // first visit to Today, Journal, Insights, or Social. `{ page, text }` while
  // visible, null when dismissed or away. Stays until the user closes it or
  // navigates to a different screen. Replayable via Dev Tools on creator acct.
  const [pageGuide, setPageGuide] = useState(null);
  // Bumped by the Dev Tools "Replay AI page tour" control so the guide effect
  // re-runs even when the user is already on a guided page.
  const [pageGuideReplayTick, setPageGuideReplayTick] = useState(0);
  const [reflectId,   setReflectId]  = useState(null);
  const [editId,      setEditId]     = useState(null);
  const [logId,       setLogId]      = useState(null);
  const [loading,          setLoading]          = useState(true);
  const [authScreen,       setAuthScreen]        = useState(false);
  const [pendingEmail,     setPendingEmail]       = useState(null);
  const [passwordRecovery, setPasswordRecovery]  = useState(false);
  // Tour temporarily disabled — state kept for re-enabling
  const [showShare,   setShowShare]   = useState(false);
  const [isPro,          setIsPro]          = useState(false);
  const [isAdmin,        setIsAdmin]        = useState(false);
  const [previewNormalCoachGreeting, setPreviewNormalCoachGreeting] = useState(false);
  /** From profiles.stripe_customer_id — used for Stripe Customer Portal */
  const [stripeCustomerId, setStripeCustomerId] = useState(null);
  const [coachName,      setCoachName]      = useState("Coach");
  const [coachIcon,      setCoachIcon]      = useState("");

  // ── Notification state (App-level so it survives tab switches) ───────────────
  const [notifEnabled,    setNotifEnabled]    = useState(false);
  // Default reminder time is 6 pm local. Most users react better to an
  // evening nudge to log the day than a morning one. Existing users who
  // already chose a different time keep theirs (loaded from DB below).
  const [notifTime,       setNotifTime]       = useState("18:00");
  // Per-category toggles. All default ON so existing subscribers keep their
  // current behaviour; the migration `20260423000000_notification_categories`
  // adds these columns server-side with the same default.
  const [dailyRemindersEnabled, setDailyRemindersEnabled] = useState(true);
  const [nudgesEnabled,         setNudgesEnabled]         = useState(true);
  const [invitesEnabled,        setInvitesEnabled]        = useState(true);
  const [notifLoading,    setNotifLoading]    = useState(false);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [notifNudgeDismissed, setNotifNudgeDismissed] = useState(
    () => !!localStorage.getItem("forged_notif_nudge_dismissed")
  );
  // ─────────────────────────────────────────────────────────────────────────────

  // ── Social state ─────────────────────────────────────────────────────────────
  const [friends,              setFriends]              = useState([]);
  const [friendRequests,       setFriendRequests]       = useState([]);
  const [sentRequests,         setSentRequests]         = useState([]);
  const [friendsLoading,       setFriendsLoading]       = useState(false);
  const [sharedGoals,          setSharedGoals]          = useState([]);
  const [sharedGoalsLoading,   setSharedGoalsLoading]   = useState(false);
  const [sharedGoalInvites,    setSharedGoalInvites]    = useState([]);
  // Forged beta leaderboard — top users by XP, refreshed on Social tab entry.
  const [betaLeaderboard,      setBetaLeaderboard]      = useState([]);
  const [leaderboardLoading,   setLeaderboardLoading]   = useState(false);
  const [myBetaRank,           setMyBetaRank]           = useState(null);
  const [betaTotalCount,       setBetaTotalCount]       = useState(null);
  // Recent public activity across beta users (for Social ticker) — populated via RPC; safe fallback if RPC missing.
  const [betaTicker,           setBetaTicker]           = useState([]);
  const betaTickerLoadedRef = useRef(false);
  /** While linking a habit to a new shared goal (Today → Share) — prevents duplicate goals from double-tap */
  const [sharingHabitId,       setSharingHabitId]       = useState(null);
  /** After sharing/linking a habit, auto-open the invite picker for that goal on Social page */
  const [pendingInviteGoalId,  setPendingInviteGoalId]  = useState(null);
  const sharingHabitIdRef = useRef(null);
  const createSharedGoalInFlightRef = useRef(false);
  // ─────────────────────────────────────────────────────────────────────────────

  const [showUpgrade,    setShowUpgrade]    = useState(false);
  const [checkingPayment,setCheckingPayment]= useState(false);
  const [showWelcome,    setShowWelcome]    = useState(false);
  const [showProFollowup, setShowProFollowup] = useState(false);
  const [demoMode,       setDemoMode]       = useState(false);
  const [demoCoachOpen,  setDemoCoachOpen]  = useState(false);
  const shownDemoRef = useRef(false); // prevent demo re-showing after sign-out
  const [previewOnboarding, setPreviewOnboarding] = useState(false); // admin preview only — never touches DB
  const [refCode,     setRefCode]     = useState(null);
  const [authEmail,   setAuthEmail]   = useState(null);
  /** Supabase auth user id when signed in; null when logged out */
  const [sessionUserId, setSessionUserId] = useState(null);
  const [xpAwardedDates, setXpAwardedDates] = useState(() => new Set());
  /** True only after profile/habits load succeeded for this session (never true while data is missing) */
  const [accountDataReady, setAccountDataReady] = useState(false);
  /** Load failed after retries — show retry UI while session still valid */
  const [accountLoadError, setAccountLoadError] = useState(false);
  const userIdRef     = useRef(null);
  const loadingUidRef = useRef(null); // uid currently being loaded — prevents concurrent loads
  const accountDataLoadedRef = useRef(false); // sync with accountDataReady for auth callbacks (no stale closures)
  const lastResumeDataFetchRef = useRef(0);
  const mountTimeRef = useRef(Date.now());
  const initialAuthHandledRef = useRef(false);
  const lastSignedInUidRef = useRef(null);
  const noteDebounceRef = useRef({});
  const retryLoadPromiseRef = useRef(null);
  const retryLoadUidRef = useRef(null);
  // Soft-recovery guard: only auto-attempt once per mount so we don't loop
  // if Supabase is genuinely offline or the session is truly invalid.
  const softRecoveryAttemptedRef = useRef(false);
  const softRecoveryInFlightRef = useRef(false);
  // Coordination: set while INITIAL_SESSION(null) is waiting for TOKEN_REFRESHED.
  // The watchdog must not call refreshSession() during this window — it races
  // with Supabase's own internal token refresh and leaves the client in a
  // confused state that causes PostgREST 401s / timeouts.
  const waitingForTokenRefreshRef = useRef(false);
  // Prevents the accountLoadError auto-retry from looping on persistent failures.
  const autoRetryFiredRef = useRef(false);

  // XP anti-abuse guard: once a habit earns XP for a specific day, toggling
  // it off/on again that day should never mint extra XP.
  useEffect(() => {
    setXpAwardedDates(new Set());
  }, [sessionUserId]);

  useEffect(() => {
    const today = todayStr();
    setXpAwardedDates(prev => {
      const next = new Set(prev);
      habits.forEach(h => {
        const todayLogs = (h.logs || []).filter(l => l.date === today);
        if (todayLogs.length === 0) return;
        if (h.habitType === "project") {
          // Any project session today means the first-log XP was already awarded.
          next.add(`project-first:${h.id}:${today}`);
          const mins = todayLogs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
          const targetMins = h.dailyTargetMinutes ?? 60;
          if (mins >= targetMins) next.add(`project-target:${h.id}:${today}`);
        } else if (h.habitType === "limit") {
          // "None today" (+15 XP) was awarded iff there's a value:0 log today.
          if (todayLogs.some(l => l.value === 0)) next.add(`limit-none:${h.id}:${today}`);
        } else if (todayLogs.some(l => l.value === true)) {
          // Daily / weekly tap (+10 XP).
          next.add(`${h.id}:${today}`);
        }
      });
      goals.forEach(g => {
        const todayNums = (g.logs || [])
          .filter(l => l.date === today)
          .map(l => (typeof l.value === "number" ? l.value : Number(l.value)))
          .filter(Number.isFinite);
        if (todayNums.length > 0) next.add(`goal:${g.id}:${today}`);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [habits, goals]);

  useEffect(() => {
    try {
      setPreviewNormalCoachGreeting(localStorage.getItem("forged_coach_preview_normal_greeting") === "1");
    } catch { /* ignore */ }
  }, []);

  // Sync Arc daily score when habits or active Arc change (refresh + proof edits).
  useEffect(() => {
    if (!activeBlock?.id || !accountDataReady) return;
    void (async () => {
      await loadArcLedgerForBlock(activeBlock.id);
      await reconcileArcProgress(activeBlock, habits);
    })();
  }, [activeBlock?.id, accountDataReady, habits]);

  // ── App-level notification restore (survives tab switches) ───────────────────
  useEffect(() => {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return;
    setNotifPermission(Notification.permission);
    if (Notification.permission !== "granted") return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        setNotifEnabled(true); // browser has live subscription — show as on immediately
        const uid = sessionUserId;
        if (!uid) return;
        // SELECT * tolerates the new category columns being absent before the
        // 20260423 migration runs — we just fall back to the all-on defaults.
        const { data } = await supabase
          .from("push_subscriptions")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();
        if (data) {
          setNotifEnabled(data.notifications_enabled);
          setNotifTime(data.reminder_time || "18:00");
          setDailyRemindersEnabled(data.daily_reminders_enabled !== false);
          setNudgesEnabled(data.nudges_enabled !== false);
          setInvitesEnabled(data.social_invites_enabled !== false);
        } else {
          // Browser subscribed but no DB row — re-save with the new 6 pm default.
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          await supabase.from("push_subscriptions").upsert({
            user_id: uid, subscription: sub.toJSON(),
            reminder_time: "18:00", notifications_enabled: true,
            timezone: tz, updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
        }
      } catch (e) { console.warn("[Forged] notif restore:", e); }
    })();
  }, [sessionUserId]);

  // ── Load social data whenever sessionUserId is available ─────────────────────
  useEffect(() => {
    if (!sessionUserId) return;
    const uid = sessionUserId;
    loadFriends(uid);
    loadFriendRequests(uid);
    loadSentRequests(uid);
    loadSharedGoals(uid);
    loadSharedGoalInvites(uid);
    syncLastActive();

    // Real-time: re-fetch friend requests the instant one arrives
    const friendChannel = supabase
      .channel(`friend-reqs-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friendships", filter: `addressee_id=eq.${uid}` },
        () => loadFriendRequests(uid)
      )
      .subscribe();

    // Real-time: re-fetch shared goal invites the instant one arrives
    const inviteChannel = supabase
      .channel(`goal-invites-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shared_goal_invites", filter: `invitee_id=eq.${uid}` },
        () => loadSharedGoalInvites(uid)
      )
      .subscribe();

    // Real-time: reload shared goal roster whenever any member logs progress.
    // Works now because the updated RLS SELECT policy lets all members of the same
    // goal see each other's rows, so UPDATE/INSERT events from teammates propagate here.
    const memberChannel = supabase
      .channel(`shared-goal-members-${uid}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shared_goal_members" },
        () => loadSharedGoals(uid))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shared_goal_members" },
        () => loadSharedGoals(uid))
      .subscribe();

    // Real-time: show an in-app toast when someone nudges this user
    const nudgeChannel = supabase
      .channel(`nudges-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "nudges", filter: `recipient_id=eq.${uid}` },
        (payload) => {
          const row = payload.new;
          const senderName = row?.sender_name || "A friend";
          const msg = row?.message ? ` "${row.message}"` : "";
          addToast(`💪 ${senderName} nudged you!${msg}`);
          if (row?.sent_at) writeNudgeWatermarkIfNewer(uid, row.sent_at);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(friendChannel);
      supabase.removeChannel(inviteChannel);
      supabase.removeChannel(memberChannel);
      supabase.removeChannel(nudgeChannel);
    };
  }, [sessionUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Refresh shared goals + beta leaderboard when navigating to Social ──
  useEffect(() => {
    if (screen === "social" && sessionUserId) {
      loadSharedGoals(sessionUserId);
      loadBetaLeaderboard(sessionUserId);
      // Ticker only needs to load once per mount — cheap and doesn't depend on uid.
      loadBetaTicker();
    }
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle /join/[code] invite URLs ──────────────────────────────────────────
  useEffect(() => {
    const match = window.location.pathname.match(/^\/join\/([a-zA-Z0-9]+)$/);
    if (match) {
      localStorage.setItem("forged_pending_join", match[1]);
      // Clean up URL without reloading
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    const code = localStorage.getItem("forged_pending_join");
    if (!code) return;
    localStorage.removeItem("forged_pending_join");
    joinSharedGoal(code).then(result => {
      if (result?.success) {
        addToast(`✓ Joined "${result.goal.emoji} ${result.goal.name}"`);
        setScreen("social");
      } else if (result?.error) {
        addToast(`Invite: ${result.error}`);
      }
    });
  }, [sessionUserId]); // eslint-disable-line react-hooks/exhaustive-deps
  // ─────────────────────────────────────────────────────────────────────────────

  async function handleNotifToggle() {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
      alert("Notifications aren't supported in this browser. Try Chrome on Android or Safari on iOS 16.4+.");
      return;
    }
    setNotifLoading(true);
    try {
      if (notifEnabled) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("user_id", sessionUserId);
        setNotifEnabled(false);
      } else {
        const permission = await Notification.requestPermission();
        setNotifPermission(permission);
        if (permission !== "granted") { setNotifLoading(false); return; }
        const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidKey) { alert("Setup error: VAPID key missing."); setNotifLoading(false); return; }
        let reg;
        try {
          reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, rej) => setTimeout(() => rej(new Error("SW timeout")), 8000)),
          ]);
        } catch (swErr) {
          alert("Service worker not ready: " + swErr.message + ". Try reloading the app.");
          setNotifLoading(false); return;
        }
        let sub;
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          });
        } catch (subErr) {
          alert("Could not subscribe to push: " + subErr.message);
          setNotifLoading(false); return;
        }
        setNotifEnabled(true); // flip immediately — don't wait for DB
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { error: upsertErr } = await supabase.from("push_subscriptions").upsert({
          user_id: sessionUserId, subscription: sub.toJSON(),
          reminder_time: notifTime, notifications_enabled: true,
          timezone: tz, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (upsertErr) alert("Saved to browser but DB save failed: " + upsertErr.message);
      }
    } catch (err) {
      alert("[Forged] Unexpected error: " + err.message);
      const reg2 = await navigator.serviceWorker.ready.catch(() => null);
      const sub2 = reg2 ? await reg2.pushManager.getSubscription().catch(() => null) : null;
      if (!sub2) setNotifEnabled(false);
    }
    setNotifLoading(false);
  }

  async function handleNotifTimeChange(newTime) {
    setNotifTime(newTime);
    if (!notifEnabled || !sessionUserId) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await supabase.from("push_subscriptions").update({
      reminder_time: newTime,
      timezone: tz,
      updated_at: new Date().toISOString(),
    }).eq("user_id", sessionUserId);
  }

  // ── Per-category toggles (daily reminders / nudges / social invites) ───────
  // Each updates the corresponding column in push_subscriptions independently
  // so the user can, for example, accept friend nudges in real time but turn
  // off the daily push without losing their subscription. We update local
  // state immediately for snappy UI; if the DB write fails we revert.
  async function handleNotifCategoryChange(category, value) {
    if (!sessionUserId) return;
    const setters = {
      daily_reminders_enabled:  setDailyRemindersEnabled,
      nudges_enabled:           setNudgesEnabled,
      social_invites_enabled:   setInvitesEnabled,
    };
    const setter = setters[category];
    if (!setter) return;
    setter(value);
    const { error } = await supabase
      .from("push_subscriptions")
      .update({ [category]: value, updated_at: new Date().toISOString() })
      .eq("user_id", sessionUserId);
    if (error) {
      console.warn("[Forged] notif category save failed:", error.message);
      setter(!value);
      addToast(`Couldn't save preference: ${error.message}`);
    }
  }
  // ── End App-level notification ────────────────────────────────────────────────

  // ── Social: helpers ───────────────────────────────────────────────────────────
  function syncLastActive() {
    const uid = userIdRef.current;
    if (!uid || demoMode) return;
    const today = todayStr();
    const maxStreak = habits.length ? Math.max(0, ...habits.map(h => h.streak || 0)) : 0;
    supabase.from("profiles")
      .update({ last_active_date: today, current_streak: maxStreak })
      .eq("id", uid).then(() => {});
  }

  async function loadFriends(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    setFriendsLoading(true);
    try {
      const { data: fships } = await supabase
        .from("friendships")
        .select("id, requester_id, addressee_id")
        .or(`requester_id.eq.${id},addressee_id.eq.${id}`)
        .eq("status", "accepted");
      if (!fships?.length) { setFriends([]); return; }
      const friendIds = fships.map(f => f.requester_id === id ? f.addressee_id : f.requester_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, avatar_url, xp, last_active_date, current_streak")
        .in("id", friendIds);
      const today = todayStr();
      setFriends((profiles || []).map(p => ({
        id: p.id,
        name: p.name || "Friend",
        avatarUrl: p.avatar_url,
        xp: p.xp || 0,
        streak: p.current_streak || 0,
        loggedToday: p.last_active_date === today,
        friendshipId: fships.find(f => f.requester_id === p.id || f.addressee_id === p.id)?.id,
      })).sort((a, b) => b.xp - a.xp));
    } catch(e) { console.warn("[Forged] loadFriends:", e); }
    finally { setFriendsLoading(false); }
  }

  async function loadBetaLeaderboard(uid) {
    const id = uid || userIdRef.current;
    setLeaderboardLoading(true);
    try {
      // Top 10 by XP (skip 0-xp so the board doesn't show new sign-ups).
      const { data: top } = await supabase
        .from("profiles")
        .select("id, name, username, avatar_url, xp, current_streak, is_pro, last_active_date")
        .gt("xp", 0)
        .order("xp", { ascending: false })
        .limit(10);
      const today = todayStr();
      const rows = (top || []).map((p, i) => ({
        rank:        i + 1,
        id:          p.id,
        name:        p.name || p.username || "Forged user",
        avatarUrl:   p.avatar_url,
        xp:          p.xp || 0,
        streak:      p.current_streak || 0,
        isPro:       !!p.is_pro,
        loggedToday: p.last_active_date === today,
        isMe:        id && p.id === id,
      }));
      setBetaLeaderboard(rows);

      // Total active beta testers (xp > 0) for the social-proof pill on the hero.
      try {
        const { count: totalActive } = await supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .gt("xp", 0);
        setBetaTotalCount(totalActive ?? null);
      } catch (e) {
        console.warn("[Forged] betaTotalCount:", e);
      }

      // If the current user isn't in the top 10, compute their rank separately
      // so we can still show "You're #47" under the board.
      if (id && !rows.some(r => r.isMe)) {
        const { data: me } = await supabase
          .from("profiles").select("xp").eq("id", id).maybeSingle();
        const myXp = me?.xp || 0;
        if (myXp > 0) {
          const { count } = await supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .gt("xp", myXp);
          setMyBetaRank((count ?? 0) + 1);
        } else {
          setMyBetaRank(null);
        }
      } else {
        const me = rows.find(r => r.isMe);
        setMyBetaRank(me ? me.rank : null);
      }
    } catch (e) {
      console.warn("[Forged] loadBetaLeaderboard:", e);
    } finally {
      setLeaderboardLoading(false);
    }
  }

  // Fetches a tiny feed of recent habit logs across public beta users.
  // Uses the `recent_beta_activity` RPC (security-definer; returns first-name + habit only).
  // If the RPC isn't present yet, we silently render nothing — no ticker is a safe fallback.
  async function loadBetaTicker() {
    if (betaTickerLoadedRef.current) return;
    betaTickerLoadedRef.current = true;
    try {
      const { data, error } = await supabase.rpc("recent_beta_activity", { p_limit: 3 });
      if (error) {
        console.warn("[Forged] recent_beta_activity RPC unavailable:", error.message || error);
        setBetaTicker([]);
        return;
      }
      const rows = Array.isArray(data) ? data : [];
      setBetaTicker(rows.map(r => ({
        firstName: r.first_name || "Someone",
        habitName: r.habit_name || "a habit",
        emoji: r.emoji || "",
        habitType: r.habit_type || "daily",
        streak: Number(r.streak) || 0,
        logDate: r.log_date || null,
      })));
    } catch (e) {
      console.warn("[Forged] loadBetaTicker:", e);
      setBetaTicker([]);
    }
  }

  async function loadFriendRequests(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    const { data: reqs } = await supabase
      .from("friendships")
      .select("id, requester_id, created_at")
      .eq("addressee_id", id)
      .eq("status", "pending");
    if (!reqs?.length) { setFriendRequests([]); return; }
    const { data: profiles } = await supabase
      .from("profiles").select("id, name, avatar_url").in("id", reqs.map(r => r.requester_id));
    setFriendRequests(reqs.map(r => ({
      friendshipId: r.id,
      requesterId:  r.requester_id,
      name:    profiles?.find(p => p.id === r.requester_id)?.name || "Someone",
      avatarUrl: profiles?.find(p => p.id === r.requester_id)?.avatar_url,
    })));
  }

  async function loadSentRequests(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    const { data: sent, error } = await supabase
      .from("friendships")
      .select("id, addressee_id, created_at")
      .eq("requester_id", id)
      .eq("status", "pending");
    if (error) {
      console.warn("[Forged] loadSentRequests:", error);
      setSentRequests([]);
      return;
    }
    if (!sent?.length) {
      setSentRequests([]);
      return;
    }
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", sent.map(r => r.addressee_id));
    setSentRequests(sent.map(r => ({
      friendshipId: r.id,
      addresseeId:  r.addressee_id,
      name:         profiles?.find(p => p.id === r.addressee_id)?.name || "Someone",
      avatarUrl:    profiles?.find(p => p.id === r.addressee_id)?.avatar_url,
    })));
  }

  async function sendFriendRequest(identifier) {
    const uid = userIdRef.current;
    if (!uid) return { error: "Not signed in" };
    const raw = (identifier || "").trim();
    if (!raw) return { error: "Enter their email or @username" };
    let targetId = null;
    if (raw.includes("@")) {
      const { data, error } = await supabase.rpc("find_user_by_email", { p_email: raw.toLowerCase() });
      if (error || !data) return { error: "No Forged account found with that email" };
      targetId = data;
    } else {
      const handle = raw.replace(/^@+/, "").trim().toLowerCase();
      if (!handle) return { error: "Enter an @handle or email address." };
      const { data: profileRow, error: profErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", handle)
        .maybeSingle();
      if (profErr || !profileRow) {
        return { error: `No account found with @${handle}. They must set their handle in Profile → Social first.` };
      }
      targetId = profileRow.id;
    }
    if (targetId === uid) return { error: "That's you!" };
    const { data: existing } = await supabase.from("friendships").select("id, status")
      .or(`and(requester_id.eq.${uid},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${uid})`)
      .maybeSingle();
    if (existing?.status === "accepted") return { error: "Already friends!" };
    if (existing?.status === "pending")  return { error: "Request already sent" };
    const { error: err } = await supabase.from("friendships").insert({ requester_id: uid, addressee_id: targetId, status: "pending" });
    if (err) return { error: "Couldn't send — try again" };
    await loadSentRequests(uid);
    // Non-blocking push notification to recipient
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return;
      fetch("/api/nudge-friend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ recipientId: targetId, type: "friend_request" }),
      }).catch(() => {});
    });
    return { success: true };
  }

  async function acceptFriendRequest(friendshipId) {
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
    const uid = userIdRef.current;
    await Promise.all([loadFriends(uid), loadFriendRequests(uid), loadSentRequests(uid)]);
  }

  async function declineFriendRequest(friendshipId) {
    await supabase.from("friendships").update({ status: "declined" }).eq("id", friendshipId);
    const uid = userIdRef.current;
    await Promise.all([loadFriendRequests(uid), loadSentRequests(uid)]);
  }

  async function cancelFriendRequest(friendshipId) {
    await supabase.from("friendships").delete().eq("id", friendshipId);
    await loadSentRequests(userIdRef.current);
  }

  async function sendNudge(recipientId, message = "") {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { error: "Not signed in" };
      const res = await fetch("/api/nudge-friend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          recipientId,
          type: "nudge",
          message: message || undefined,
          client_date: todayStr(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 429) {
        return {
          error:
            json.error ||
            "You've nudged them 3 times today. Give them a bit of breathing room and try again tomorrow.",
          limit: json.limit,
        };
      }
      if (!res.ok) return { error: json.error || "Couldn't send nudge" };
      return { success: true, ...json };
    } catch(e) {
      return { error: "Couldn't send nudge" };
    }
  }

  async function removeFriend(friendshipId) {
    await supabase.from("friendships").delete().eq("id", friendshipId);
    setFriends(f => f.filter(fr => fr.friendshipId !== friendshipId));
  }

  async function loadSharedGoals(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    setSharedGoalsLoading(true);
    try {
      const { data: memberships, error: memErr } = await supabase
        .from("shared_goal_members")
        .select("id, shared_goal_id, logs, joined_at")
        .eq("user_id", id);
      if (memErr) throw memErr;
      if (!memberships?.length) {
        setSharedGoals([]);
        return;
      }
      const goalIds = [...new Set(memberships.map(m => m.shared_goal_id))];
      const { data: goalsRows, error: goalsErr } = await supabase
        .from("shared_goals")
        .select("*")
        .in("id", goalIds);
      if (goalsErr) throw goalsErr;
      const goalById = Object.fromEntries((goalsRows || []).map(g => [g.id, g]));

      const rosterByGoalId = {};
      for (const goalId of goalIds) {
        const { data: roster, error: rpcErr } = await supabase.rpc("get_shared_goal_roster", { p_goal_id: goalId });
        if (rpcErr) {
          console.warn("[Forged] get_shared_goal_roster", goalId, rpcErr);
          rosterByGoalId[goalId] = [];
        } else {
          rosterByGoalId[goalId] = roster || [];
        }
      }

      const builtGoals = memberships.map(m => {
        const goal = goalById[m.shared_goal_id];
        if (!goal) return null;
        const roster = rosterByGoalId[m.shared_goal_id] || [];
        const myRowLogs = m.logs || [];
        const rosterUid = mem => mem.user_id ?? mem.userId ?? mem.userid;
        let members = roster.map(mem => {
          const uid = rosterUid(mem);
          return {
            userId: uid,
            name: mem.name || "Member",
            avatarUrl: mem.avatar_url ?? mem.avatarUrl,
            // Roster RPC can disagree with shared_goal_members; Today-linked truth is m.logs for the current user.
            logs: sameUserId(uid, id) ? myRowLogs : (mem.logs || []),
            isMe: sameUserId(uid, id),
          };
        });
        if (!members.some(mem => mem.isMe)) {
          members = [
            ...members,
            { userId: id, name: "You", avatarUrl: undefined, logs: myRowLogs, isMe: true },
          ];
        }
        // Sort key: max log date across all members, falling back to joined_at so brand-new goals
        // don't get buried under stale ones before anyone has logged.
        let lastActiveKey = "";
        for (const mem of members) {
          for (const l of mem.logs || []) {
            const d = typeof l?.date === "string" ? l.date : "";
            if (d && d > lastActiveKey) lastActiveKey = d;
          }
        }
        if (!lastActiveKey && m.joined_at) {
          const s = String(m.joined_at);
          lastActiveKey = s.length >= 10 ? s.slice(0, 10) : "";
        }
        return {
          id: goal.id,
          creatorId: goal.creator_id,
          name: goal.name,
          emoji: goal.emoji,
          habitType: goal.habit_type,
          weeklyTarget: goal.weekly_target,
          targetDate: goal.target_date,
          color: goal.color,
          inviteCode: goal.invite_code,
          myLogs: m.logs || [],
          myMembershipId: m.id,
          members,
          _lastActiveKey: lastActiveKey,
        };
      }).filter(Boolean);
      // Most-recently-active first; stable ordering for ties.
      builtGoals.sort((a, b) => {
        const ka = a._lastActiveKey || "";
        const kb = b._lastActiveKey || "";
        if (kb !== ka) return kb.localeCompare(ka);
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      // Strip internal sort key before exposing goals to the UI.
      setSharedGoals(builtGoals.map(({ _lastActiveKey, ...rest }) => rest));
    } catch (e) {
      console.warn("[Forged] loadSharedGoals:", e);
    } finally {
      setSharedGoalsLoading(false);
    }
  }

  async function loadSharedGoalInvites(uid) {
    const id = uid || userIdRef.current;
    if (!id) return;
    try {
      const { data: invites } = await supabase
        .from("shared_goal_invites")
        .select("id, goal_id, invite_code, inviter_id, goal_name, goal_emoji, inviter_name, created_at")
        .eq("invitee_id", id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      setSharedGoalInvites(invites || []);
    } catch (e) {
      console.warn("[Forged] loadSharedGoalInvites:", e);
    }
  }

  async function acceptSharedGoalInvite(invite) {
    const result = await joinSharedGoal(invite.invite_code);
    await supabase.from("shared_goal_invites").update({ status: "accepted" }).eq("id", invite.id);
    setSharedGoalInvites(prev => prev.filter(i => i.id !== invite.id));
    if (result?.error) {
      addToast(`Couldn't join goal: ${result.error}`);
      return;
    }
    const goalData = result?.goal;
    if (goalData) {
      // Auto-create a linked personal habit so the joiner can sync from Today page
      await createLinkedHabit(goalData);
      addToast(`✓ Joined "${goalData.name}" — added to your Today page`);
    } else {
      addToast(`✓ Joined "${invite.goal_name || "shared goal"}" — check Social for details`);
    }
  }

  async function declineSharedGoalInvite(inviteId) {
    await supabase.from("shared_goal_invites").update({ status: "declined" }).eq("id", inviteId);
    setSharedGoalInvites(prev => prev.filter(i => i.id !== inviteId));
  }

  async function createSharedGoal({ name, emoji, habitType, weeklyTarget, color }) {
    if (createSharedGoalInFlightRef.current) {
      addToast("Please wait — creating a shared goal…");
      return undefined;
    }
    const uid = userIdRef.current;
    if (!uid || !name?.trim()) return null;
    createSharedGoalInFlightRef.current = true;
    try {
      const ht = normalizeSharedGoalHabitType(habitType || "daily");
      const wt = ht === "weekly"
        ? Math.min(7, Math.max(1, Number(weeklyTarget) || 3))
        : null;
      const { data: goal, error } = await supabase.from("shared_goals")
        .insert({ creator_id: uid, name: name.trim(), emoji: emoji || "🎯",
          habit_type: ht, weekly_target: wt,
          color: color || "#C0392B" })
        .select().single();
      if (error || !goal) {
        console.error("[Forged] createSharedGoal:", error);
        addToast(error?.message ? `Couldn't create goal — ${error.message}` : "Couldn't create goal");
        return null;
      }
      await supabase.from("shared_goal_members").insert({ shared_goal_id: goal.id, user_id: uid, logs: [] });
      await loadSharedGoals(uid);
      return goal;
    } finally {
      createSharedGoalInFlightRef.current = false;
    }
  }

  async function shareHabit(habitId) {
    if (demoBounce()) return null;
    const uid = userIdRef.current;
    if (!uid) return null;
    if (sharingHabitIdRef.current) return null;
    sharingHabitIdRef.current = habitId;
    setSharingHabitId(habitId);
    try {
      const habit = habits.find(h => h.id === habitId);
      if (!habit || habit.habitType === "log" || habit.sharedGoalId) return null;
      const newGoal = await createSharedGoal({
        name: habit.name,
        emoji: habit.emoji,
        habitType: habit.habitType,
        weeklyTarget: habit.weeklyTarget,
        color: habit.color,
      });
      if (newGoal === undefined) return null;
      if (!newGoal) return null;
      const { error } = await supabase.from("habits").update({ shared_goal_id: newGoal.id }).eq("id", habit.id);
      if (error) {
        console.error("[Forged] shareHabit link:", error);
        addToast("Couldn't link habit to shared goal");
        return null;
      }
      const linked = { ...habit, sharedGoalId: newGoal.id };
      setHabits(prev => prev.map(h => h.id === habitId ? { ...h, sharedGoalId: newGoal.id } : h));
      await pushSharedMemberProgressFromLinked(linked);
      return { ...newGoal, inviteCode: newGoal.invite_code };
    } finally {
      sharingHabitIdRef.current = null;
      setSharingHabitId(null);
    }
  }

  async function deleteSharedGoal(goalId) {
    const uid = userIdRef.current;
    if (!uid) {
      addToast("Not signed in");
      return { error: "Not signed in" };
    }
    const { data: goalRow, error: gErr } = await supabase.from("shared_goals")
      .select("id, creator_id").eq("id", goalId).maybeSingle();
    if (gErr || !goalRow) {
      addToast("Goal not found");
      return { error: "Goal not found" };
    }
    if (goalRow.creator_id !== uid) {
      addToast("Only the goal creator can delete it");
      return { error: "Only the person who created this goal can delete it" };
    }
    await supabase.from("habits").update({ shared_goal_id: null }).eq("user_id", uid).eq("shared_goal_id", goalId);
    const { error } = await supabase.from("shared_goals").delete().eq("id", goalId);
    if (error) {
      console.error("[Forged] deleteSharedGoal:", error);
      addToast("Couldn't delete — try again");
      return { error: "Couldn't delete — try again" };
    }
    setHabits(prev => prev.map(h => (h.sharedGoalId === goalId ? { ...h, sharedGoalId: undefined } : h)));
    await loadSharedGoals(uid);
    addToast("Shared goal removed");
    return { success: true };
  }

  async function handleShareHabit(habitId) {
    const habit = habits.find(h => h.id === habitId);
    if (!habit || habit.habitType === "log") return;
    // If this habit is already linked to a shared goal, just open invite picker for it
    if (habit.sharedGoalId) {
      setPendingInviteGoalId(habit.sharedGoalId);
      setScreen("social");
      return;
    }
    // Create a new shared goal linked to this habit
    const goal = await shareHabit(habitId);
    if (!goal) return;
    setPendingInviteGoalId(goal.id);
    setScreen("social");
    addToast("✓ Goal shared — invite your friends below");
  }

  async function handleShareGoal(goalId) {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    // Already shared — open invite picker
    if (goal.sharedGoalId) {
      setPendingInviteGoalId(goal.sharedGoalId);
      setScreen("social");
      return;
    }
    // Create a new shared goal linked to this goal
    const uid = userIdRef.current;
    if (!uid) return;
    const newSharedGoal = await createSharedGoal({
      name:        goal.name,
      emoji:       goal.emoji || "🎯",
      habitType:   "goal",
      weeklyTarget: null,
      color:       goal.color || "#E67E22",
    });
    if (!newSharedGoal) return;
    // Link the goal row to the new shared goal
    const { error } = await supabase
      .from("habits")
      .update({ shared_goal_id: newSharedGoal.id })
      .eq("id", goal.id);
    if (error) {
      console.error("[Forged] handleShareGoal link:", error);
      addToast("Couldn't link goal — try again");
      return;
    }
    const linkedGoal = { ...goal, sharedGoalId: newSharedGoal.id };
    setGoals(prev => prev.map(g => g.id === goalId ? { ...g, sharedGoalId: newSharedGoal.id } : g));
    await pushSharedMemberProgressFromLinked(linkedGoal);
    setPendingInviteGoalId(newSharedGoal.id);
    setScreen("social");
    addToast("✓ Goal shared — invite your friends below");
  }

  async function joinSharedGoal(inviteCode) {
    const uid = userIdRef.current;
    if (!uid) return { error: "Not signed in" };
    // Use SECURITY DEFINER RPC to bypass RLS — non-members can't read shared_goals directly
    const { data: result, error: rpcErr } = await supabase.rpc("join_shared_goal_by_code", { p_code: inviteCode });
    if (rpcErr) {
      console.error("[Forged] join_shared_goal_by_code:", rpcErr);
      return { error: "Failed to join goal — try again" };
    }
    if (result?.error) return { error: result.error };
    await loadSharedGoals(uid);
    return {
      success: true,
      goal: {
        id:          result.goal_id,
        name:        result.name,
        emoji:       result.emoji,
        habitType:   result.habit_type,
        weeklyTarget:result.weekly_target,
        color:       result.color,
      },
    };
  }

  /** Auto-creates a personal habit linked to a shared goal so the joiner can sync from Today page */
  async function createLinkedHabit(goalData) {
    const uid = userIdRef.current;
    if (!uid || !goalData?.id) return null;
    // Don't create a duplicate if the user already has a habit linked to this shared goal
    if (habits.some(h => h.sharedGoalId === goalData.id)) return null;
    const newHabit = {
      id:          crypto.randomUUID(),
      name:        goalData.name,
      emoji:       goalData.emoji || "🎯",
      habitType:   goalData.habitType || "daily",
      weeklyTarget:goalData.weeklyTarget ?? null,
      color:       goalData.color || "#C0392B",
      sharedGoalId:goalData.id,
      logs:        [],
      streak:      0,
      bestStreak:  0,
      reflection:  true,
      reflectionPrompt: "",
      tapIncrement:1,
      dailyTargetMinutes: 60,
    };
    const { error } = await supabase.from("habits").insert(habitToRow(newHabit, uid));
    if (error) {
      console.error("[Forged] createLinkedHabit:", error);
      return null;
    }
    setHabits(prev => [...prev, newHabit]);
    await pushSharedMemberProgressFromLinked(newHabit);
    return newHabit;
  }

  /**
   * Writes shared_goal_members.logs from the linked personal habit/goal (Today is source of truth).
   * Call after every successful habits upsert for linked rows and on initial load.
   */
  async function pushSharedMemberProgressFromLinked(linked) {
    if (demoMode || !linked?.sharedGoalId) return;
    const uid = userIdRef.current;
    if (!uid) return;
    const projected = projectPersonalLogsForSharedMember(linked);
    const { data: member, error: selErr } = await supabase
      .from("shared_goal_members")
      .select("id")
      .eq("shared_goal_id", linked.sharedGoalId)
      .eq("user_id", uid)
      .maybeSingle();
    if (selErr) {
      console.warn("[Forged] pushSharedMemberProgressFromLinked select:", selErr.message);
      return;
    }
    if (!member) {
      console.warn("[Forged] pushSharedMemberProgressFromLinked: no membership row for shared goal", linked.sharedGoalId);
      return;
    }
    const { error: upErr } = await supabase
      .from("shared_goal_members")
      .update({ logs: projected })
      .eq("id", member.id);
    if (upErr) {
      console.warn("[Forged] pushSharedMemberProgressFromLinked update:", upErr.message);
      return;
    }
    setSharedGoals(prev => prev.map(g => {
      if (String(g.id) !== String(linked.sharedGoalId)) return g;
      const list = g.members || [];
      const mapped = list.map(m =>
        sameUserId(m.userId, uid) ? { ...m, logs: projected, isMe: true } : { ...m }
      );
      const members = mapped.some(m => sameUserId(m.userId, uid))
        ? mapped
        : [...mapped, { userId: uid, name: "You", avatarUrl: undefined, logs: projected, isMe: true }];
      return { ...g, myLogs: projected, members };
    }));
    syncLastActive();
    // Defer refetch so PostgREST returns the committed `logs` json (immediate fetch can race the update).
    setTimeout(() => { void loadSharedGoals(uid); }, 400);
  }
  // ── End social helpers ────────────────────────────────────────────────────────

  // ─── Supabase helpers ──────────────────────────────────────────────────────
  async function syncHabit(habit) {
    if (demoMode) return false;
    const uid = userIdRef.current;
    if (!uid) {
      console.warn("syncHabit: no user id — session not ready yet, skipping save");
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Session loading — please wait a moment and try again" }]);
      return false;
    }
    try {
      const { error } = await supabase.from("habits").upsert(habitToRow(habit, uid));
      if (error) {
        console.error("syncHabit error:", error.message);
        const id = Date.now();
        setToasts(t => [...t, { id, msg: "⚠️ Couldn't save — check your connection" }]);
        return false;
      }
      if (habit.sharedGoalId) await pushSharedMemberProgressFromLinked(habit);
      return true;
    } catch (err) {
      console.error("syncHabit exception:", err);
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Couldn't save — check your connection" }]);
      return false;
    }
  }

  async function syncGoal(goal) {
    if (demoMode) return false;
    const uid = userIdRef.current;
    if (!uid) {
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Session loading — please wait a moment and try again" }]);
      return false;
    }
    try {
      const { error } = await supabase.from("habits").upsert(goalToRow(goal, uid));
      if (error) {
        console.error("syncGoal error:", error.message);
        const id = Date.now();
        setToasts(t => [...t, { id, msg: "⚠️ Couldn't save goal — check your connection" }]);
        return false;
      }
      if (goal.sharedGoalId) await pushSharedMemberProgressFromLinked(goal);
      return true;
    } catch (err) {
      console.error("syncGoal exception:", err);
      const id = Date.now();
      setToasts(t => [...t, { id, msg: "⚠️ Couldn't save goal — check your connection" }]);
      return false;
    }
  }

  /** @param {Record<string, unknown>} updates */
  async function syncProfile(updates, { quiet = false } = {}) {
    if (demoMode) return null;
    const uid = userIdRef.current;
    if (!uid) return null;
    const payload = { ...updates, updated_at: new Date().toISOString() };
    delete payload.id;
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) return null;
    const { error } = await supabase.from("profiles").update(clean).eq("id", uid);
    if (error) {
      console.warn("[Forged] syncProfile:", error.code, error.message, error);
      if (!quiet) {
        if (error.code === "23505") addToast("That @handle is already taken");
        else if (
          error.code === "42703"
          || error.code === "PGRST204"
          || /visible_to_friends_of_friends|schema cache|column/i.test(error.message || "")
        ) {
          addToast("Privacy setting needs the latest DB migration (profiles.visible_to_friends_of_friends). Run Supabase migrations, then reload.");
        } else {
          addToast(error.message || "Couldn't save profile");
        }
      }
      return error;
    }
    return null;
  }

  async function handleSaveJournalEntry(date, content) {
    const uid = userIdRef.current;
    if (!uid || !date || !content?.trim()) return;
    const { data, error } = await supabase
      .from("journal_entries")
      .upsert({ user_id: uid, date, content: content.trim(), updated_at: new Date().toISOString(), manually_edited: true }, { onConflict: "user_id,date" })
      .select()
      .single();
    if (error) {
      console.error("[Forged] saveJournalEntry:", error.message);
      addToast("⚠️ Couldn't save journal entry");
      return;
    }
    // Update local state (upsert by date), preserving manually_edited flag
    setJournalEntries(prev => {
      const exists = prev.some(e => e.date === date);
      if (exists) return prev.map(e => e.date === date ? { ...e, content, updated_at: data.updated_at, manually_edited: true } : e);
      return [data, ...prev].sort((a, b) => b.date.localeCompare(a.date));
    });
  }

  async function handleJournalGenerated() {
    const uid = userIdRef.current;
    if (!uid) return;
    supabase.from("journal_entries").select("id, date, content, daily_context, is_ai_generated, manually_edited, created_at, updated_at")
      .eq("user_id", uid).order("date", { ascending: false })
      .then(({ data: jRows }) => { if (jRows) setJournalEntries(jRows); });
  }

  async function handleGenerateReceipt() {
    const uid = userIdRef.current;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token || !uid) return false;
    setGeneratingReceipt(true);
    try {
      const res = await fetch("/api/journal-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date: todayStr(), habits, goals, name: user.name || "" }),
      });
      await handleJournalGenerated();
      return res.ok;
    } catch (err) {
      console.error("[Forged] generateReceipt:", err);
      return false;
    } finally {
      setGeneratingReceipt(false);
    }
  }

  async function handleAvatarUpload(file) {
    const uid = userIdRef.current;
    if (!file || !uid) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${uid}/avatar.${ext}`;
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (error) { console.error('Avatar upload error:', error); return; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = data.publicUrl;
    setUser(u => ({ ...u, avatarUrl }));
    await syncProfile({ avatar_url: avatarUrl });
  }

  /** @returns {Promise<boolean>} true if profile/habits were loaded and applied; false on hard failure */
  /** Rolling memory + recent day summaries for the coach prompt (non-fatal). */
  async function loadCoachMemory(uid) {
    try {
      const [{ data: mem }, { data: sums }] = await Promise.all([
        supabase.from("coach_memory").select("content, updated_at").eq("user_id", uid).maybeSingle(),
        supabase.from("daily_summaries").select("date, summary").eq("user_id", uid)
          .order("date", { ascending: false }).limit(7),
      ]);
      setCoachMemory({
        content: mem?.content || "",
        recentSummaries: (sums || []).slice().reverse(), // oldest first for the prompt
      });
    } catch { /* non-fatal — coach works without memory */ }
  }

  /**
   * Lazy day-rollover: once per local day, ask the server to summarize any
   * recent finished days and refresh the rolling memory. Cheap (one Haiku
   * call, max 2 days) and fire-and-forget.
   */
  async function maybeRunMemoryRollover(uid) {
    const key = `forged_memory_rollover:${uid}`;
    const today = todayStr();
    try { if (localStorage.getItem(key) === today) return; } catch { /* ignore */ }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch("/api/memory-rollover", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ client_date: today }),
      });
      if (res.ok) {
        try { localStorage.setItem(key, today); } catch { /* ignore */ }
        const json = await res.json().catch(() => null);
        if (json?.updated) loadCoachMemory(uid);
      }
    } catch { /* non-fatal */ }
  }

  async function loadUserData(uid) {
    // Mutex: skip if already loading this uid
    if (loadingUidRef.current === uid) return false;
    loadingUidRef.current = uid;
    try {
      // 8 s per query: allows slow-but-working mobile connections while still
      // detecting truly stuck connections quickly. Both queries together = 16 s
      // max per attempt before loadUserData returns false and the retry loop fires.
      const FETCH_MS = 8000;
      async function runQueryWithTimeout(label, queryFactory) {
        const aborter = new AbortController();
        let timeoutId = null;
        const queryPromise = queryFactory(aborter.signal);
        const timeoutPromise = new Promise((_, rej) => {
          timeoutId = setTimeout(() => {
            aborter.abort();
            rej(new Error(`${label}_timeout`));
          }, FETCH_MS);
        });
        try {
          return await Promise.race([queryPromise, timeoutPromise]);
        } finally {
          if (timeoutId != null) clearTimeout(timeoutId);
        }
      }

      let profileRes;
      let habitsRes;
      try {
        profileRes = await runQueryWithTimeout("profile", (signal) =>
          supabase.from("profiles").select("*").eq("id", uid).single().abortSignal(signal)
        );

        habitsRes = await runQueryWithTimeout("habits", (signal) =>
          supabase.from("habits").select("*").eq("user_id", uid).order("created_at").abortSignal(signal)
        );

        // Load journal entries (non-fatal — failure doesn't block the app)
        supabase.from("journal_entries").select("id, date, content, daily_context, is_ai_generated, manually_edited, created_at, updated_at")
          .eq("user_id", uid).order("date", { ascending: false })
          .then(({ data: jRows }) => {
            if (jRows) setJournalEntries(jRows);
          });

        // Coach memory + recent day summaries; also kicks the once-per-day
        // rollover summarizer (both non-fatal)
        loadCoachMemory(uid);
        maybeRunMemoryRollover(uid);

        // Load tasks: today's tasks + pinned undone carry-overs from previous days (non-fatal)
        const todayIso = new Date().toISOString().slice(0, 10);
        supabase.from("tasks").select("*")
          .eq("user_id", uid)
          .or(`date.eq.${todayIso},and(pinned.eq.true,done.eq.false)`)
          .order("created_at")
          .then(({ data: tRows }) => {
            if (tRows) setTasks(tRows.map(rowToTask));
          });
      } catch (err) {
        console.error("loadUserData: fetch failed —", err.message);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        return false;
      }

      const { data: profile, error: pErr } = profileRes;
      const { data: rows,    error: hErr  } = habitsRes;

      const profileFailed = pErr && pErr.code !== "PGRST116";
      const habitsFailed  = hErr != null;

      // Either query failing means data is incomplete — return false so the retry loop fires.
      // A genuine empty habits list returns hErr=null and rows=[], not an error.
      if (profileFailed) {
        console.error("[Forged] loadUserData: profile query failed — code:", pErr.code, "msg:", pErr.message);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        return false;
      }
      if (habitsFailed) {
        console.error("[Forged] loadUserData: habits query failed — code:", hErr.code, "msg:", hErr.message);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        return false;
      }

      let isOnboarded = null;

      if (profile) {
        setUser({
          id: profile.id,
          name: profile.name || "",
          avatarUrl: profile.avatar_url || null,
          username: profile.username || "",
          visibleToFriendsOfFriends: !!profile.visible_to_friends_of_friends,
        });
        setXp(profile.xp ?? 0);
        const proStatus = !!(profile.is_pro || profile.is_admin);
        setIsPro(proStatus);
        setIsAdmin(!!profile.is_admin);
        // Detect a completed payment on any sign-in path (session survived or user re-authenticated)
        if (proStatus && localStorage.getItem('forged_checkout_pending') === '1') {
          localStorage.removeItem('forged_checkout_pending');
          setShowWelcome(true);
        }
        setRefCode(profile.ref_code ?? null);
        setStripeCustomerId(profile.stripe_customer_id ?? null);
        setCoachName(profile.coach_name || "Coach");
        setCoachIcon((profile.coach_icon && String(profile.coach_icon).trim()) || "");
        setVoiceRepliesEnabled(profile.voice_replies_enabled === true);
        setCoachVoiceId(profile.coach_voice_id || null);
        isOnboarded = profile.onboarded ?? false;
        if (!isOnboarded && profile.name && profile.name.trim()) {
          isOnboarded = true;
          supabase.from("profiles").update({ onboarded: true, updated_at: new Date().toISOString() }).eq("id", uid);
        }
      } else {
        setStripeCustomerId(null);
      }

      if (rows && rows.length > 0) {
        if (isOnboarded === null) isOnboarded = false;
        if (!isOnboarded) {
          isOnboarded = true;
          supabase.from("profiles").upsert({ id: uid, onboarded: true, updated_at: new Date().toISOString() });
        }
      }

      if (isOnboarded === null) isOnboarded = false;
      setOnboarded(isOnboarded);

      if (rows) {
        const progressRows = rows.filter(r => r.habit_type === "progress");

        // Migrate legacy progress habits → goals (fire-and-forget DB update)
        if (progressRows.length > 0) {
          const progressIds = progressRows.map(r => r.id);
          supabase.from("habits")
            .update({ habit_type: "goal", goal_status: "active", updated_at: new Date().toISOString() })
            .in("id", progressIds)
            .then(({ error }) => {
              if (error) console.error("[Forged] progress→goal migration failed:", error.message);
            });
        }

        const { goals: nextGoals, habits: nextHabits } = splitDbRowsIntoGoalsAndHabits(rows);
        setGoals(nextGoals);
        setHabits(nextHabits);
        const linkedPushers = [
          ...nextHabits.filter(h => h.sharedGoalId).map(h => () => pushSharedMemberProgressFromLinked(h)),
          ...nextGoals.filter(g => g.sharedGoalId).map(g => () => pushSharedMemberProgressFromLinked(g)),
        ];
        if (linkedPushers.length) await Promise.all(linkedPushers.map(fn => fn()));
      }

      await reloadForgeBlocks(uid);

      userIdRef.current = uid;
      accountDataLoadedRef.current = true;
      setAccountLoadError(false);
      setAccountDataReady(true);
      return true;
    } catch (err) {
      console.error("loadUserData exception:", err);
      accountDataLoadedRef.current = false;
      setAccountDataReady(false);
      return false;
    } finally {
      loadingUidRef.current = null;
    }
  }

  function applyArcHabitsPatch(prev, habitsPatch) {
    if (!habitsPatch?.length) return prev;
    const patchById = new Map(habitsPatch.map(h => [String(h.id), h]));
    const merged = prev.map(h => patchById.get(String(h.id)) || h);
    const existingIds = new Set(prev.map(h => String(h.id)));
    const added = habitsPatch.filter(h => !existingIds.has(String(h.id)));
    return [...merged, ...added];
  }

  async function handleArcCoachCreated({ block, habitsPatch }, toastMsg = "✓ Arc started") {
    if (block) setActiveBlock(rowToForgeBlock(block));
    if (habitsPatch?.length) setHabits(prev => applyArcHabitsPatch(prev, habitsPatch));
    setArcProofSyncing(false);
    setShowArcCoach(false);
    addToast(toastMsg);
    void reloadForgeBlocks();
  }


  async function handleArcStoryGenerated(blockRow) {
    if (blockRow) setCompletedArcBlock(rowToForgeBlock(blockRow));
    else await reloadForgeBlocks();
  }

  function handleArcContinue(completedBlock) {
    if (!completedBlock?.id) return;
    markArcDecided(completedBlock.id);
    setCompletedArcBlock(null);
    setArcCoachSeed({ type: "runItBack", block: completedBlock });
    setArcCoachMode("create");
    setShowArcCoach(true);
  }

  function handleArcEvolve(completedBlock) {
    if (completedBlock?.id) markArcDecided(completedBlock.id);
    setCompletedArcBlock(null);
    setArcCoachSeed({ type: "evolve", block: completedBlock });
    setArcCoachMode("create");
    setShowArcCoach(true);
  }

  function handleArcClose(completedBlock) {
    if (completedBlock?.id) markArcDecided(completedBlock.id);
  }

  function openArcCoachCreate() {
    setArcCoachSeed(null);
    setArcCoachMode("create");
    setShowArcCoach(true);
  }

  function openArcCoachEdit() {
    setShowCoach(false);
    setCoachOpenMode(null);
    setArcCoachMode("edit");
    setShowArcCoach(true);
  }

  async function linkHabitAsProof(habitId) {
    const blockId = activeBlock?.id;
    const uid = userIdRef.current;
    if (!blockId || !uid || !habitId) return;
    const habit = habits.find(h => h.id === habitId);
    if (habit) {
      if (habit.habitType === "log") return;
      if (habit.blockId === blockId && habit.isProofAction) return;
      const updated = { ...habit, blockId, isProofAction: true };
      const ok = await syncHabit(updated);
      if (!ok) {
        addToast("⚠️ Couldn't link habit — check your connection");
        return;
      }
      const nextHabits = habits.map(h => (h.id === habitId ? updated : h));
      setHabits(nextHabits);
      if (activeBlock?.id) void reconcileArcProgress(activeBlock, nextHabits);
      addToast("✓ Added as proof action");
      return;
    }
    const goal = goals.find(g => entityIdEq(g.id, habitId));
    if (!goal) return;
    if (goal.blockId === blockId && goal.isProofAction) return;
    const updatedGoal = { ...goal, blockId, isProofAction: true };
    const ok = await syncGoal(updatedGoal);
    if (!ok) {
      addToast("⚠️ Couldn't link goal — check your connection");
      return;
    }
    const nextGoals = goals.map(g => (entityIdEq(g.id, habitId) ? updatedGoal : g));
    setGoals(nextGoals);
    if (activeBlock?.id) void reconcileArcProgress(activeBlock, habits, nextGoals);
    addToast("✓ Added as proof action");
  }

  /** Move a habit or goal off the active Arc's proof list, back to the Hub. */
  async function unlinkProofItem(itemId) {
    const uid = userIdRef.current;
    if (!uid || !itemId) return;
    const habit = habits.find(h => h.id === itemId);
    if (habit) {
      if (!habit.isProofAction && !habit.blockId) return;
      const updated = { ...habit, blockId: null, isProofAction: false };
      const ok = await syncHabit(updated);
      if (!ok) {
        addToast("⚠️ Couldn't move habit — check your connection");
        return;
      }
      const nextHabits = habits.map(h => (h.id === itemId ? updated : h));
      setHabits(nextHabits);
      if (activeBlock?.id) void reconcileArcProgress(activeBlock, nextHabits);
      addToast("Moved to Hub");
      return;
    }
    const goal = goals.find(g => entityIdEq(g.id, itemId));
    if (!goal) return;
    if (!goal.isProofAction && !goal.blockId) return;
    const updatedGoal = { ...goal, blockId: null, isProofAction: false };
    const ok = await syncGoal(updatedGoal);
    if (!ok) {
      addToast("⚠️ Couldn't move goal — check your connection");
      return;
    }
    const nextGoals = goals.map(g => (entityIdEq(g.id, itemId) ? updatedGoal : g));
    setGoals(nextGoals);
    if (activeBlock?.id) void reconcileArcProgress(activeBlock, habits, nextGoals);
    addToast("Moved to Hub");
  }

  async function loadArcLedgerForBlock(blockId) {
    if (!blockId) {
      setArcLedgerRows([]);
      setTodayArcScore(null);
      return;
    }
    const today = todayStr();
    const { data, error } = await supabase
      .from("arc_daily_scores")
      .select("id, user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day")
      .eq("block_id", blockId)
      .order("date", { ascending: true });
    if (error) {
      console.warn("[Forged] arc_daily_scores load:", error.message);
      setArcLedgerRows([]);
      return;
    }
    const rows = (data || []).map(rowToArcDailyScore).filter(Boolean);
    setArcLedgerRows(rows);
    const todayRow = rows.find(r => r.date === today);
    setTodayArcScore(todayRow || {
      date: today, proofTotal: 0, proofDone: 0, arcXpAwarded: 0, perfectDay: false,
    });
  }

  /**
   * Recompute today's Arc XP from proof habits, upsert ledger, adjust forge_blocks.arc_xp.
   * Idempotent: safe on retick/untick and page refresh.
   */
  async function reconcileArcProgress(block, habitsList, goalsList = goals) {
    const uid = userIdRef.current;
    if (!block?.id || !uid) return { ok: true, delta: 0 };

    const blockId = block.id;
    const today = todayStr();
    const proofHabits = getProofItemsForBlock(habitsList, goalsList, blockId);
    const proofTotal = proofHabits.length;
    const proofDone = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;
    const newAward = computeTodayArcXpAward({ proofTotal, proofDone });
    const perfectDay = proofTotal > 0 && proofDone === proofTotal;

    const { data: existing, error: fetchErr } = await supabase
      .from("arc_daily_scores")
      .select("*")
      .eq("block_id", blockId)
      .eq("date", today)
      .maybeSingle();

    if (fetchErr) {
      console.warn("[Forged] arc_daily_scores fetch:", fetchErr.message);
      return { ok: false, delta: 0 };
    }

    const prevAward = existing?.arc_xp_awarded ?? 0;
    const delta = newAward - prevAward;

    const upsertPayload = {
      user_id: uid,
      block_id: blockId,
      date: today,
      proof_total: proofTotal,
      proof_done: proofDone,
      arc_xp_awarded: newAward,
      perfect_day: perfectDay,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await supabase
      .from("arc_daily_scores")
      .upsert(upsertPayload, { onConflict: "block_id,date" });

    if (upsertErr) {
      console.warn("[Forged] arc_daily_scores upsert:", upsertErr.message);
      return { ok: false, delta: 0 };
    }

    const ledgerForPercent = [
      ...arcLedgerRows.filter(r => r.date !== today),
      { date: today, proof_total: proofTotal, proof_done: proofDone },
    ];
    const percent = calculateArcProofPercent({
      ledgerRows: ledgerForPercent,
      habits: habitsList,
      goals: goalsList,
      blockId,
      today,
    });
    const priorLedgerDays = arcLedgerRows.filter(r => r.date !== today).length;
    const rankLabel = getArcRankDisplay(
      percent,
      arcLedgerRows.length > 0 || proofTotal > 0,
      { proofDoneToday: proofDone, priorLedgerDays },
    ).label;

    const { data: allScores, error: sumErr } = await supabase
      .from("arc_daily_scores")
      .select("arc_xp_awarded")
      .eq("block_id", blockId);

    if (sumErr) {
      console.warn("[Forged] arc_daily_scores sum:", sumErr.message);
      return { ok: false, delta: 0 };
    }
    const totalArcXp = (allScores || []).reduce((s, r) => s + (r.arc_xp_awarded ?? 0), 0);

    const blockPatch = {
      arc_xp: totalArcXp,
      completion_score: percent,
      arc_rank: rankLabel,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedBlock, error: blockErr } = await supabase
      .from("forge_blocks")
      .update(blockPatch)
      .eq("id", blockId)
      .eq("user_id", uid)
      .select("*")
      .single();

    if (blockErr) {
      console.warn("[Forged] forge_blocks arc_xp update:", blockErr?.message);
      return { ok: false, delta: 0 };
    }

    if (updatedBlock) setActiveBlock(rowToForgeBlock(updatedBlock));

    const scoreRow = rowToArcDailyScore({ ...existing, ...upsertPayload, id: existing?.id });
    setTodayArcScore(scoreRow);
    setArcLedgerRows(prev => {
      const rest = prev.filter(r => r.date !== today);
      return [...rest, scoreRow].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    });

    return { ok: true, delta, newAward, proofTotal, proofDone };
  }

  async function reloadForgeBlocks(uid = userIdRef.current) {
    if (!uid) {
      setActiveBlock(null);
      setCompletedArcBlock(null);
      return;
    }
    try {
      const { data: blockRow, error: blockErr } = await supabase
        .from("forge_blocks")
        .select("*")
        .eq("user_id", uid)
        .eq("status", "active")
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (blockErr) {
        console.warn("[Forged] forge_blocks load skipped:", blockErr.message);
        setActiveBlock(null);
        setCompletedArcBlock(null);
        return;
      }
      if (blockRow) {
        const block = rowToForgeBlock(blockRow);
        // Automatically recognise an Arc reaching its end: an "active" block
        // whose end_date has passed gets marked completed, then falls through
        // to the completed-Arc branch (Arc Story + continue/evolve/close).
        if (block.endDate && block.endDate < todayStr()) {
          const { data: closedRow, error: closeErr } = await supabase
            .from("forge_blocks")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", block.id)
            .eq("user_id", uid)
            .select()
            .single();
          if (!closeErr && closedRow) {
            setArcLedgerRows([]);
            setTodayArcScore(null);
            setActiveBlock(null);
            setCompletedArcBlock(rowToForgeBlock(closedRow));
            return;
          }
          // If the close failed (offline etc.), keep treating it as active.
        }
        setActiveBlock(block);
        setCompletedArcBlock(null);
        void loadArcLedgerForBlock(block.id);
        return;
      }
      setArcLedgerRows([]);
      setTodayArcScore(null);
      setActiveBlock(null);
      const { data: doneRow, error: doneErr } = await supabase
        .from("forge_blocks")
        .select("*")
        .eq("user_id", uid)
        .eq("status", "completed")
        .order("end_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (doneErr) {
        console.warn("[Forged] completed forge_blocks load skipped:", doneErr.message);
        setCompletedArcBlock(null);
      } else {
        setCompletedArcBlock(doneRow ? rowToForgeBlock(doneRow) : null);
      }
    } catch (err) {
      console.warn("[Forged] forge_blocks load exception:", err?.message || err);
      setActiveBlock(null);
      setCompletedArcBlock(null);
    }
  }

  async function loadUserDataWithRetries(uid, source = "unknown", options = {}) {
    const skipDedupe = options.skipDedupe === true;
    // Dedupe concurrent loads for the same uid (e.g. INITIAL_SESSION + SIGNED_IN). Manual "Retry" must bypass
    // this or it re-awaits the same stuck promise and appears to do nothing until a full page refresh.
    if (!skipDedupe && retryLoadPromiseRef.current && retryLoadUidRef.current === uid) {
      return retryLoadPromiseRef.current;
    }

    retryLoadUidRef.current = uid;
    const loadPromise = (async () => {
    // First attempt fires immediately. One retry after 2 s for transient hiccups.
    // Keeping this short (2 attempts × 8 s FETCH_MS = 16 s max) so the startup
    // last-resort reload triggers quickly rather than waiting through many retries.
    const backoffs = [0, 2000];
    for (let attempt = 0; attempt < backoffs.length; attempt++) {
      if (backoffs[attempt] > 0) await new Promise(r => setTimeout(r, backoffs[attempt]));
      if (attempt > 0) console.log(`[Forged] loadUserData retry ${attempt}/${backoffs.length - 1} (${source})`);
      if (await loadUserData(uid)) {
        return true;
      }
    }
    console.error("[Forged] loadUserDataWithRetries: all attempts failed for uid", uid?.slice(0, 8), source);
    return false;
    })();
    retryLoadPromiseRef.current = loadPromise;

    try {
      return await loadPromise;
    } finally {
      if (retryLoadPromiseRef.current === loadPromise) {
        retryLoadPromiseRef.current = null;
        retryLoadUidRef.current = null;
      }
    }
  }

  async function retryAccountDataLoad() {
    setAccountLoadError(false);
    autoRetryFiredRef.current = true; // prevent auto-retry from re-triggering
    setLoading(true);
    try {
      loadingUidRef.current = null;
      retryLoadPromiseRef.current = null;
      retryLoadUidRef.current = null;
      const { data: { session: preRefreshSession }, error: preSessionErr } = await supabase.auth.getSession();
      if (preSessionErr) console.warn("retryAccountDataLoad: getSession -", preSessionErr.message);
      const initialUid = preRefreshSession?.user?.id || sessionUserId;
      if (!initialUid) {
        setAuthScreen(true);
        return;
      }
      setSessionUserId(initialUid);
      if (preRefreshSession?.user?.email) setAuthEmail(preRefreshSession.user.email);

      const { error: refErr } = await supabase.auth.refreshSession();
      if (refErr) console.warn("retryAccountDataLoad: refreshSession -", refErr.message);
      const { data: { session: postRefreshSession }, error: postSessionErr } = await supabase.auth.getSession();
      if (postSessionErr) console.warn("retryAccountDataLoad: post-refresh getSession -", postSessionErr.message);
      const retryUid = postRefreshSession?.user?.id || initialUid;
      const ok = await loadUserDataWithRetries(retryUid, "manual-retry", { skipDedupe: true });
      if (ok) {
        setAuthScreen(false);
      } else {
        // In-app retry failed. If we are still within the 45 s startup recovery
        // window, do a clean page reload (fresh Supabase client + token). After
        // the window expires we have been at this > 45 s — show the error screen.
        if (!startupReloadExpired) {
          reloadForStartupRecovery("retryAccountDataLoad-fallback");
          return;
        }
        console.error("[Forged] retryAccountDataLoad: startup window expired, showing error UI");
        setAccountLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }

  // Soft in-app session recovery — used by the loading-screen "try again"
  // button and by an automatic watchdog when INITIAL_SESSION never arrives.
  // Tries hard to recover the session in-place before falling back to a hard
  // page reload. This is the "what a manual refresh actually fixes" path.
  async function attemptSoftSessionRecovery(reason = "manual") {
    if (softRecoveryInFlightRef.current) return;
    softRecoveryInFlightRef.current = true;
    try {
      // 1. Probe storage for an existing session (covers the case where
      //    INITIAL_SESSION fired before our listener was wired up, or fired
      //    with null while storage was still hydrating on mobile browsers).
      let { data: { session } } = await supabase.auth.getSession();

      // 2. If no session yet, try to refresh — Supabase may have a refresh
      //    token in storage even when the access token is expired. This is
      //    exactly the path a hard reload takes implicitly.
      if (!session?.user?.id) {
        try {
          await supabase.auth.refreshSession();
        } catch (e) {
          console.warn("[Forged] soft recovery: refreshSession failed —", e?.message || e);
        }
        const probe = await supabase.auth.getSession();
        session = probe?.data?.session || null;
      }

      if (!session?.user?.id) {
        // No session at all — go to the auth screen instead of an infinite
        // spinner. (A genuine signed-out state.)
        console.warn(`[Forged] soft recovery (${reason}): no session, routing to auth`);
        setLoading(false);
        setAuthScreen(true);
        return;
      }

      // 3. Session exists — kick the loader. skipDedupe so we never await a
      //    promise that's already stuck.
      const uid = session.user.id;
      if (session.user.email) setAuthEmail(session.user.email);
      setSessionUserId(uid);
      lastSignedInUidRef.current = uid;
      initialAuthHandledRef.current = true;
      loadingUidRef.current = null;
      retryLoadPromiseRef.current = null;
      retryLoadUidRef.current = null;
      accountDataLoadedRef.current = false;
      setAccountDataReady(false);
      setAccountLoadError(false);
      userIdRef.current = null;

      const ok = await loadUserDataWithRetries(uid, `soft-recovery:${reason}`, { skipDedupe: true });
      if (ok) {
        setAuthScreen(false);
        setAccountLoadError(false);
      } else {
        // Loader couldn't finish — show the friendlier retry surface rather
        // than the bare loading spinner.
        setAccountLoadError(true);
      }
      setLoading(false);
    } catch (e) {
      console.warn(`[Forged] soft recovery (${reason}) threw —`, e?.message || e);
      // Last resort: a hard reload (matches old behavior for safety).
      try { window.location.reload(); } catch {}
    } finally {
      softRecoveryInFlightRef.current = false;
    }
  }

  // ─── Auth init ────────────────────────────────────────────────────────────
  // INITIAL_SESSION is the correct primary signal. It fires once Supabase has:
  //   1. Read the persisted session from localStorage
  //   2. Refreshed the access token if expired
  //   3. Determined the definitive initial auth state
  // getSession() can return null before that refresh completes — using it as
  // the primary signal is the root cause of "session looks gone on refresh".
  useEffect(() => {
    let mounted = true;

    // If INITIAL_SESSION never fires, fall back to auth (don't guess signed-in without data).
    const bailout = setTimeout(async () => {
      if (!mounted || initialAuthHandledRef.current) return;
      if (lastSignedInUidRef.current) {
        initialAuthHandledRef.current = true;
        const uid = lastSignedInUidRef.current;
        setSessionUserId(uid);
        setAccountLoadError(false);
        accountDataLoadedRef.current = false;
        setAccountDataReady(false);
        userIdRef.current = null;
        const ok = await loadUserDataWithRetries(uid, "BAILOUT_SIGNED_IN_FALLBACK");
        if (!mounted) return;
        if (!ok) setAccountLoadError(true);
        else setAccountLoadError(false);
        setAuthScreen(false);
        setLoading(false);
        return;
      }
      console.warn("Auth: INITIAL_SESSION did not fire within 12s");
      setAuthScreen(true);
      setLoading(false);
    }, 12000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      try {
        // ── Initial session ───────────────────────────────────────────────
        // Do not leave the loading screen until profile/habits load succeeds (or we show retry).
        if (event === "INITIAL_SESSION") {
          clearTimeout(bailout);
          // Safety net: if loadUserDataWithRetries somehow hangs beyond the
          // per-query FETCH_MS timeouts, unblock the UI after 20 s. With
          // FETCH_MS=8s and 2 attempts the loop finishes in ≤ 18 s anyway,
          // so this fires only if something truly unexpected locks up.
          const LOAD_BUDGET_MS = 20000;
          const loadBudgetTimer = setTimeout(() => {
            if (!mounted) return;
            console.warn("Auth: account load exceeded budget — unblocking UI (use Retry if needed)");
            loadingUidRef.current = null;
            setLoading(false);
            setAuthScreen(false);
            if (session?.user?.id) setAccountLoadError(true);
          }, LOAD_BUDGET_MS);

          initialAuthHandledRef.current = true;
          // When set to true inside the try block, the finally skips setLoading(false)
          // so the loading spinner stays visible while waiting for TOKEN_REFRESHED.
          let waitingForTokenRefresh = false;
          try {
            if (session?.user?.id) {
              if (session.user.email) setAuthEmail(session.user.email);
              setSessionUserId(session.user.id);
              setAccountLoadError(false);
              accountDataLoadedRef.current = false;
              setAccountDataReady(false);
              userIdRef.current = null;
              const ok = await loadUserDataWithRetries(session.user.id, "INITIAL_SESSION");
              if (!mounted) return;
              if (ok) setAccountLoadError(false);
              else setAccountLoadError(true);
              setAuthScreen(false);
            } else {
              // Mobile browsers can transiently emit INITIAL_SESSION(null) before storage hydration settles.
              // Probe once synchronously before routing to demo/auth to avoid unnecessary sign-in prompts.
              const { data: { session: lateSession }, error: lateSessionErr } = await supabase.auth.getSession();
              if (lateSessionErr) console.warn("Auth: INITIAL_SESSION null probe getSession —", lateSessionErr.message);
              if (lateSession?.user?.id) {
                if (lateSession.user.email) setAuthEmail(lateSession.user.email);
                setSessionUserId(lateSession.user.id);
                setAccountLoadError(false);
                accountDataLoadedRef.current = false;
                setAccountDataReady(false);
                userIdRef.current = null;
                const ok = await loadUserDataWithRetries(lateSession.user.id, "INITIAL_SESSION_NULL_PROBE");
                if (!mounted) return;
                if (ok) setAccountLoadError(false);
                else setAccountLoadError(true);
                setAuthScreen(false);
                return;
              }
              // iOS/Android home-screen PWAs: Supabase's internal token refresh fires
              // asynchronously, so INITIAL_SESSION(null) can arrive before the refresh
              // completes. Do NOT call refreshSession() explicitly here — it races with
              // Supabase's own internal refresh and can leave the client in a state where
              // PostgREST queries return 401s or time out even with a valid session.
              // Instead, probe getSession() once (instant if refresh already completed)
              // and fall through to hasStoredSupabaseSession() if the token is still
              // being refreshed internally.
              if (isLikelyHomeScreenPwa()) {
                const { data: { session: pwaRecovered }, error: pwaRecErr } = await supabase.auth.getSession();
                if (pwaRecErr) console.warn("Auth: PWA getSession probe:", pwaRecErr.message);
                if (pwaRecovered?.user?.id) {
                  if (pwaRecovered.user.email) setAuthEmail(pwaRecovered.user.email);
                  setSessionUserId(pwaRecovered.user.id);
                  setAccountLoadError(false);
                  accountDataLoadedRef.current = false;
                  setAccountDataReady(false);
                  userIdRef.current = null;
                  const ok = await loadUserDataWithRetries(pwaRecovered.user.id, "INITIAL_SESSION_PWA_PROBE");
                  if (!mounted) return;
                  if (ok) setAccountLoadError(false);
                  else setAccountLoadError(true);
                  setAuthScreen(false);
                  return;
                }
                // Session still null (Supabase refresh still in progress) — fall through
                // to hasStoredSupabaseSession() and wait for TOKEN_REFRESHED.
              }
              // ── Stored-session check ─────────────────────────────────────
              // INITIAL_SESSION fires null when the stored access token is expired
              // and Supabase is mid-refresh. On the live/deployed app this is the
              // normal first-load path for ANY returning user (1h token TTL).
              // If we detect stored session tokens, stay on the loading screen and
              // let TOKEN_REFRESHED deliver the session rather than flashing demo data.
              if (hasStoredSupabaseSession()) {
                waitingForTokenRefresh = true;
                waitingForTokenRefreshRef.current = true; // tells watchdog to stay out
                setSessionUserId(null);
                setAccountLoadError(false);
                accountDataLoadedRef.current = false;
                setAccountDataReady(false);
                userIdRef.current = null;
                setDemoMode(false);
                setAuthScreen(false);
                // Safety net: if TOKEN_REFRESHED never fires within 20 s, reload the page
                // (network hiccup or storage race — a fresh load usually fixes it).
                // After the 45 s startup window expires, fall back to auth instead.
                setTimeout(() => {
                  waitingForTokenRefreshRef.current = false;
                  if (!mounted || accountDataLoadedRef.current || loadingUidRef.current) return;
                  console.warn("Auth: TOKEN_REFRESHED did not arrive within 20s after stored-session detection");
                  if (!startupReloadExpired) {
                    reloadForStartupRecovery("token-refresh-timeout");
                    return;
                  }
                  setLoading(false);
                  setAuthScreen(true);
                }, 20000);
              } else {
                // No stored tokens → genuinely new or fully signed-out user.
                setSessionUserId(null);
                setAccountLoadError(false);
                accountDataLoadedRef.current = false;
                setAccountDataReady(false);
                userIdRef.current = null;
                if (mounted) {
                  setAuthScreen(true);
                }
              }
            }
          } finally {
            clearTimeout(loadBudgetTimer);
            // Keep the loading screen visible when waiting for TOKEN_REFRESHED.
            if (mounted && !waitingForTokenRefresh) setLoading(false);
          }
          return;
        }

        // ── Explicit sign-in ──────────────────────────────────────────────
        // Supabase fires SIGNED_IN immediately after INITIAL_SESSION for existing sessions.
        // We must not interfere with an in-progress INITIAL_SESSION load.
        if (event === "SIGNED_IN" && session?.user?.id) {
          lastSignedInUidRef.current = session.user.id;
          if (!initialAuthHandledRef.current) {
            if (session.user.email && mounted) setAuthEmail(session.user.email);
            setSessionUserId(session.user.id);
            setAuthScreen(false);
            return;
          }
          if (session.user.email && mounted) setAuthEmail(session.user.email);
          setSessionUserId(session.user.id);

          // Case 1: data already fully loaded for this user — just update UI
          if (accountDataLoadedRef.current && userIdRef.current === session.user.id) {
            if (mounted) { setAuthScreen(false); setPendingEmail(null); setPasswordRecovery(false); setDemoMode(false); }
            return;
          }
          // Case 2: INITIAL_SESSION (or a prior SIGNED_IN) is already loading this uid — don't
          // interfere. The in-progress loader will finish and set all state correctly. If we let
          // this handler continue it will hit the mutex on every retry and conclude with an error.
          if (loadingUidRef.current === session.user.id) {
            if (mounted) { setAuthScreen(false); setPendingEmail(null); setPasswordRecovery(false); setDemoMode(false); }
            return;
          }

          setDemoMode(false);
          setHabits([]); // clear demo data before loading real data
          setAccountLoadError(false);
          accountDataLoadedRef.current = false;
          setAccountDataReady(false);
          userIdRef.current = null;
          setLoading(true);
          const signInBudget = setTimeout(() => {
            if (!mounted) return;
            console.warn("Auth: sign-in load exceeded budget — unblocking UI");
            loadingUidRef.current = null;
            setLoading(false);
            setAuthScreen(false);
            setAccountLoadError(true);
          }, 60000);
          try {
            const ok = await loadUserDataWithRetries(session.user.id, "SIGNED_IN");
            if (mounted) {
              setAuthScreen(false);
              setPendingEmail(null);
              setPasswordRecovery(false);
              if (!ok) setAccountLoadError(true);
              else setAccountLoadError(false);
            }
          } finally {
            clearTimeout(signInBudget);
            if (mounted) setLoading(false);
          }
          return;
        }

        // ── Sign-out ──────────────────────────────────────────────────────
        if (event === "SIGNED_OUT") {
          clearTimeout(bailout);
          userIdRef.current     = null;
          loadingUidRef.current = null;
          accountDataLoadedRef.current = false;
          setSessionUserId(null);
          setAccountDataReady(false);
          setAccountLoadError(false);
          setHabits([]);
          setActiveBlock(null);
          setUser({ name: "", avatarUrl: null });
          setXp(0);
          setCoachName("Coach");
          setCoachIcon("");
          setOnboarded(null);
          setIsPro(false);
          setIsAdmin(false);
          setStripeCustomerId(null);
          setRefCode(null);
          setAuthEmail(null);
          localStorage.removeItem('forged_checkout_pending');
          shownDemoRef.current = true; // after sign-out, go to auth not demo
          setDemoMode(false);
          if (mounted) { setAuthScreen(true); setLoading(false); }
          return;
        }

        // ── Token refresh ─────────────────────────────────────────────────
        // After idle, JWT renews but PostgREST may have failed earlier; reload if data never loaded.
        if (event === "TOKEN_REFRESHED" && session?.user?.id) {
          waitingForTokenRefreshRef.current = false; // session delivered — watchdog can stand down
          lastSignedInUidRef.current = session.user.id;
          if (session.user.email && mounted) setAuthEmail(session.user.email);
          setSessionUserId(session.user.id);
          if (loadingUidRef.current === session.user.id) {
            return;
          }
          if (!accountDataLoadedRef.current) {
            setDemoMode(false);
            setHabits([]);
            setLoading(true);
            const tokenBudget = setTimeout(() => {
              if (!mounted) return;
              setLoading(false);
              setAuthScreen(false);
              setAccountLoadError(true);
            }, 20000);
            try {
              const ok = await loadUserDataWithRetries(session.user.id, "TOKEN_REFRESHED");
              if (mounted) {
                setAuthScreen(false);
                if (!ok) setAccountLoadError(true);
                else setAccountLoadError(false);
              }
            } finally {
              clearTimeout(tokenBudget);
              if (mounted) setLoading(false);
            }
          }
          return;
        }

        // ── Password recovery ─────────────────────────────────────────────
        if (event === "PASSWORD_RECOVERY") {
          if (mounted) { setPasswordRecovery(true); setAuthScreen(false); setLoading(false); }
          return;
        }

      } catch (err) {
        console.error("auth event error:", err);
        if (mounted) setLoading(false);
      }
    });

    return () => { mounted = false; clearTimeout(bailout); subscription.unsubscribe(); };
  }, []);

  // ─── Soft self-heal watchdog ─────────────────────────────────────────────
  // When the loading screen sticks (INITIAL_SESSION dropped, slow token
  // refresh, mobile storage hydration race, etc.) the user used to be left
  // staring at a spinner with no recourse but a hard reload. Run one
  // automatic in-app session recovery at 15s — this matches what a manual
  // refresh would fix, but without losing app state.
  //
  // IMPORTANT: must not fire while waitingForTokenRefreshRef is true. Calling
  // refreshSession() during Supabase's own internal token refresh races with
  // that refresh and leaves the client in a confused state.
  useEffect(() => {
    if (!loading) return;
    if (softRecoveryAttemptedRef.current) return;
    const t = setTimeout(() => {
      // Back off if: a real load is in flight, we are waiting for
      // TOKEN_REFRESHED (Supabase is already refreshing internally), or another
      // watchdog already ran.
      if (loadingUidRef.current) return;
      if (waitingForTokenRefreshRef.current) return;
      if (softRecoveryAttemptedRef.current) return;
      softRecoveryAttemptedRef.current = true;
      attemptSoftSessionRecovery("watchdog-8s");
    }, 8000);
    return () => clearTimeout(t);
  }, [loading]);

  // ─── Startup last-resort reload ───────────────────────────────────────────
  // The watchdog above only fires when NO data load is in progress. This effect
  // is the backstop for the more common stuck case: TOKEN_REFRESHED fired and
  // a data load IS running, but the Supabase/PostgREST connection is in a bad
  // state (cold after backgrounding) and queries keep timing out.
  //
  // If loading is still true 15 s from mount and account data has not landed,
  // do a clean page reload. A reload resets the Supabase client and TCP
  // connections — the same effect as force-closing and reopening the PWA tile,
  // which the user reported always fixes the issue.
  //
  // Guards:
  //   - Date.now() - mountTimeRef.current > 3000: only fires for the startup
  //     load (loading became true at mount). Skips mid-session manual retries.
  //   - waitingForTokenRefreshRef.current: skip if Supabase is still doing its
  //     internal token refresh (can take up to 20 s on slow connections).
  //   - startupReloadExpired: stop reloading after 60 s of total attempts.
  useEffect(() => {
    if (!loading || accountDataReady || startupReloadExpired) return;
    // Not a startup load (loading became true mid-session, e.g. manual retry).
    if (Date.now() - mountTimeRef.current > 3000) return;
    const t = setTimeout(() => {
      if (!loading || accountDataReady || accountDataLoadedRef.current) return;
      if (waitingForTokenRefreshRef.current) return; // still mid-token-refresh
      if (startupReloadExpired) return;
      reloadForStartupRecovery("startup-stuck-15s");
    }, 15000);
    return () => clearTimeout(t);
  }, [loading, accountDataReady]);

  // ─── Auto-retry on accountLoadError ─────────────────────────────────────────
  // When the initial load fails (e.g. mobile cold-start PostgREST timeout),
  // recover automatically so the user never has to tap anything.
  //
  // Within the 45 s startup window: reload immediately via reloadForStartupRecovery
  // so the next load gets a clean Supabase client with a fresh token.
  //
  // After 45 s (startupReloadExpired): try one in-app retry and if that also
  // fails, show the error screen with a manual "Try again" button.
  //
  // autoRetryFiredRef prevents this from looping — set before any async work.
  useEffect(() => {
    if (!accountLoadError || !sessionUserId) return;
    if (autoRetryFiredRef.current) return;
    autoRetryFiredRef.current = true;
    if (!startupReloadExpired) {
      // Still within recovery window — reload immediately (no visible error flash).
      reloadForStartupRecovery("accountLoadError-auto");
      return;
    }
    // Startup window expired — try in-app retry once, then give up.
    const t = setTimeout(() => {
      if (!accountLoadError) return;
      retryAccountDataLoad();
    }, 2000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountLoadError, sessionUserId]);

  // ─── Session + data refresh on resume / bfcache ──────────────────────────────
  useEffect(() => {
    function runResumeLoad() {
      // Ignore visibilitychange that Chrome fires on initial page load (<5s since mount)
      const now = Date.now();
      if (now - mountTimeRef.current < 5000) return;
      if (now - lastResumeDataFetchRef.current < 5000) return;
      lastResumeDataFetchRef.current = now;
      (async () => {
        if (isLikelyHomeScreenPwa()) {
          await supabase.auth.refreshSession().catch(() => {});
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) return;
        if (loadingUidRef.current === session.user.id) return;
        await loadUserDataWithRetries(session.user.id, "resume");
      })();
    }
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      runResumeLoad();
    }
    function onPageShow(e) {
      if (e.persisted) runResumeLoad();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Sync XP to profile whenever it changes (after init)
  const xpInitRef = useRef(false);
  useEffect(() => {
    if (loading || !accountDataReady) return;
    if (!xpInitRef.current) { xpInitRef.current = true; return; }
    void syncProfile({ xp }, { quiet: true });
  }, [xp, loading, accountDataReady]);

  // All hooks must be declared before any conditional returns
  const addToast = useCallback(msg => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg }]);
  }, []);

  // Catch-up: nudges received while offline (table + watermark; realtime handles live inserts).
  useEffect(() => {
    if (!sessionUserId || !accountDataReady) return;
    let cancelled = false;
    (async () => {
      try {
        let wm = readNudgeWatermark(sessionUserId);
        if (!wm) {
          const { data: latest, error: latestErr } = await supabase
            .from("nudges")
            .select("sent_at")
            .eq("recipient_id", sessionUserId)
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestErr) {
            writeNudgeWatermarkIfNewer(sessionUserId, new Date().toISOString());
            return;
          }
          const anchor = latest?.sent_at || new Date().toISOString();
          writeNudgeWatermarkIfNewer(sessionUserId, anchor);
          return;
        }
        const { data, error } = await supabase
          .from("nudges")
          .select("sender_name,message,sent_at")
          .eq("recipient_id", sessionUserId)
          .gt("sent_at", wm)
          .order("sent_at", { ascending: true });
        if (cancelled || error || !data?.length) return;
        let newest = wm;
        for (const row of data) {
          if (row.sent_at && row.sent_at > newest) newest = row.sent_at;
          const msg = row.message ? ` "${row.message}"` : "";
          addToast(`💪 ${row.sender_name || "Someone"} nudged you!${msg}`);
        }
        writeNudgeWatermarkIfNewer(sessionUserId, newest);
      } catch (e) {
        console.warn("[Forged] nudge catch-up:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionUserId, accountDataReady, addToast]);

  /** Clear the other editor first so goal vs habit modals never stack (flushSync avoids stale editId + editGoalId in one tick). */
  const openEditGoal = useCallback(rawId => {
    const g = resolveGoalForModal(rawId, goals, habits);
    flushSync(() => { setEditId(null); });
    setEditGoalId(g ? g.id : null);
  }, [goals, habits]);
  const openEditHabit = useCallback(rawId => {
    const goalMatch = goals.find(g => entityIdEq(g.id, rawId));
    if (goalMatch) {
      openEditGoal(goalMatch.id);
      return;
    }
    const habitMatch = habits.find(h => entityIdEq(h.id, rawId));
    if (habitMatch && (isGoalLikeHabitType(habitMatch) || isLegacyProgressType(habitMatch.habitType))) {
      openEditGoal(rawId);
      return;
    }
    flushSync(() => { setEditGoalId(null); });
    setEditId(habitMatch ? habitMatch.id : null);
  }, [goals, habits, openEditGoal]);

  const reflectHabit = habits.find(h => entityIdEq(h.id, reflectId)) || null;
  const editHabit    = habits.find(h => entityIdEq(h.id, editId))    || null;
  const logHabit     = habits.find(h => entityIdEq(h.id, logId))     || null;

  // Capture ?ref= from URL and handle ?checkout=success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && /^[A-Z2-9]{6}$/.test(ref)) {
      localStorage.setItem("forged_pending_ref", ref);
    }
    if (params.get("checkout") === "success") {
      // Clean URL, then poll until webhook fires (up to ~15s)
      window.history.replaceState({}, "", window.location.pathname);
      setCheckingPayment(true);
      let attempts = 0;
      const pollId = setInterval(async () => {
        attempts++;
        const uid = userIdRef.current;
        if (!uid) {
          // Auth not loaded yet — keep waiting up to 15 cycles
          if (attempts > 15) { setCheckingPayment(false); clearInterval(pollId); }
          return;
        }
        const { data } = await supabase
          .from("profiles")
          .select("is_pro, is_admin")
          .eq("id", uid)
          .single();
        if (data?.is_pro || data?.is_admin) {
          setIsPro(true);
          setCheckingPayment(false);
          clearInterval(pollId);
          localStorage.removeItem('forged_checkout_pending');
          setShowWelcome(true);
        } else if (attempts >= 15) {
          // Webhook hasn't fired yet — drop back to paywall; user can reload
          localStorage.removeItem('forged_checkout_pending');
          setCheckingPayment(false);
          clearInterval(pollId);
        }
      }, 1000);
    }
  }, []);

  const coachNudgeShellActive =
    !loading &&
    !authScreen &&
    !passwordRecovery &&
    sessionUserId != null &&
    accountDataReady &&
    !accountLoadError &&
    !demoMode &&
    !previewOnboarding &&
    onboarded !== false &&
    !checkingPayment;

  // ── First-time AI page guide: show once per page on first visit ──────────
  // This runs *before* the short per-nav nudge so we can suppress it when the
  // persistent guide is taking over. Persistence key is user-scoped so two
  // accounts on the same device don't collide.
  useEffect(() => {
    if (!coachNudgeShellActive) {
      setPageGuide(null);
      return;
    }
    if (!PAGE_GUIDE_PAGES.includes(screen)) {
      // Leaving a guided page — drop any active guide and mark the one we
      // were showing as seen so it doesn't come back on the next visit.
      setPageGuide(prev => {
        if (prev) writePageGuideSeen(sessionUserId, prev.page);
        return null;
      });
      return;
    }
    if (readPageGuideSeen(sessionUserId, screen)) {
      setPageGuide(null);
      return;
    }
    const text = buildPageGuideMessage(screen, { name: user?.name, habits, goals });
    if (!text) { setPageGuide(null); return; }
    setPageGuide({ page: screen, text });
  }, [screen, coachNudgeShellActive, sessionUserId, pageGuideReplayTick]);

  useEffect(() => {
    if (!coachNudgeShellActive) {
      setCoachPageNudge(null);
      return;
    }
    if (screen === "profile") {
      setCoachPageNudge(null);
      return;
    }
    // Suppress the short auto-hide nudge whenever the persistent first-time
    // guide is taking over — two bubbles in the same anchor is noise.
    if (pageGuide && pageGuide.page === screen) {
      setCoachPageNudge(null);
      return;
    }
    const text = COACH_PAGE_NUDGES[screen];
    if (!text) {
      setCoachPageNudge(null);
      return;
    }
    const id = ++coachNudgeSeqRef.current;
    setCoachPageNudge({ id, text });
    const t = setTimeout(() => {
      setCoachPageNudge(prev => (prev && prev.id === id ? null : prev));
    }, COACH_NUDGE_DURATION_MS);
    return () => clearTimeout(t);
  }, [screen, coachNudgeShellActive, pageGuide]);

  async function completeOnboarding({ name, habits: newHabits, coachName: newCoachName, emailUpdatesOptIn }) {
    const uid = userIdRef.current;
    const resolvedCoach = newCoachName || "Coach";
    setUser({ name });
    setXp(0);
    setCoachName(resolvedCoach);
    const habitsToSet = (newHabits && newHabits.length > 0) ? newHabits : [];
    setHabits(habitsToSet);
    setOnboarded(true);
    const pendingRef = localStorage.getItem("forged_pending_ref") || null;
    if (uid) {
      await supabase.from("profiles").upsert({
        id: uid, name, xp: 0, onboarded: true, coach_name: resolvedCoach, updated_at: new Date().toISOString(),
        ...(pendingRef ? { referred_by: pendingRef } : {}),
      });
      if (pendingRef) localStorage.removeItem("forged_pending_ref");
      if (habitsToSet.length > 0) {
        await supabase.from("habits").upsert(habitsToSet.map(h => habitToRow(h, uid)));
      }
    }
    // Persist the final-screen "weekly updates by email" preference under the
    // same localStorage key the post-upgrade ProThankYouModal already uses, so
    // we have one source of truth when we wire an actual email sender later.
    if (typeof emailUpdatesOptIn === "boolean") {
      writeForgedBetaEmailOptIn(uid, emailUpdatesOptIn);
    }
  }

  // Show password recovery screen
  if (!loading && passwordRecovery) {
    return (
      <><style>{CSS}</style>
      <SetPasswordScreen onDone={() => { setPasswordRecovery(false); setAuthScreen(false); }} /></>
    );
  }

  // Show auth screens
  if (!loading && authScreen) {
    if (pendingEmail) {
      return (
        <><style>{CSS}</style>
        <CheckEmailScreen email={pendingEmail} onBack={() => setPendingEmail(null)} /></>
      );
    }
    return (
      <><style>{CSS}</style>
      <AuthScreen
        onSent={email => setPendingEmail(email)}
        checkoutPending={localStorage.getItem('forged_checkout_pending') === '1'}
      /></>
    );
  }

  // Show loading screen
  if (loading) {
    return (
      <><style>{CSS}</style>
      <div style={{
        fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20,
        paddingTop: cssPadTopSafe(20), paddingBottom: cssPadBottomSafe(20), ...cssPadXSafe(20),
        boxSizing:"border-box",
      }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ width:22, height:22, border:`2px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
      </div></>
    );
  }

  // Signed in but profile/habits failed after exhausting all automatic recovery
  // attempts (> 45 s). Only shown once startupReloadExpired — before that the
  // auto-retry effect silently reloads the page instead of surfacing this screen.
  if (!loading && !authScreen && sessionUserId && accountLoadError && startupReloadExpired) {
    return (
      <><style>{CSS}</style>
      <div style={{
        fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", gap:16,
        paddingTop: cssPadTopSafe(24), paddingBottom: cssPadBottomSafe(24), ...cssPadXSafe(28),
        boxSizing:"border-box",
      }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ fontSize:15, color:T.muted, lineHeight:1.7 }}>
          Having trouble loading your account. Check your connection and try again.
        </div>
        <button type="button" onClick={() => retryAccountDataLoad()}
          style={{ padding:"14px 24px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer" }}>
          Try again
        </button>
      </div></>
    );
  }

  // Should not happen often: session exists but data gate not satisfied yet
  if (!loading && !authScreen && sessionUserId && !accountDataReady && !accountLoadError) {
    return (
      <><style>{CSS}</style>
      <div style={{
        fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20,
        paddingTop: cssPadTopSafe(20), paddingBottom: cssPadBottomSafe(20), ...cssPadXSafe(20),
        boxSizing:"border-box",
      }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Forged.</div>
        <div style={{ width:22, height:22, border:`2px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        <div style={{ fontSize:12, color:T.hint }}>Loading your account…</div>
      </div></>
    );
  }

  // Demo mode — show app with seed data before sign-up
  if (!loading && demoMode) {
    const demoGetStarted = () => { setDemoMode(false); setHabits([]); shownDemoRef.current = true; setDemoCoachOpen(false); setAuthScreen(true); };
    const DEMO_NAV = [
      { id:"today",    label:"Today",    icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
      { id:"arc",      label:"Arc",      icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 15a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 3.5v2M4.6 5.6l1.4 1.4M15.4 5.6L14 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
      { id:"profile",  label:"You",      icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    ];
    return (
      <>
        <style>{CSS}</style>
        {toasts.map(t => <Toast key={t.id} msg={t.msg} onDone={() => setToasts(ts => ts.filter(x => x.id !== t.id))}/>)}
        {demoCoachOpen && <DemoCoachModal onClose={() => setDemoCoachOpen(false)} onGetStarted={demoGetStarted}/>}
        <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, paddingBottom:172 }}>
          <DemoBanner onGetStarted={demoGetStarted}/>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:16, paddingBottom:8, ...cssPadXSafe(18) }}>
            <div>
              <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
              <div style={{ fontSize:12, color:T.muted, marginTop:1 }}>{fmtDateLong()}</div>
            </div>
            <button onClick={demoGetStarted}
              style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(200,144,42,0.12)", borderRadius:20, padding:"6px 13px", fontSize:13, fontWeight:500, color:T.gold, border:"none", cursor:"pointer" }}>
              ⚡ 420 xp
            </button>
          </div>
          <TodayScreen habits={habits} goals={goals} activeBlock={activeBlock} onTap={handleTap} onUndo={() => {}} onSkip={() => {}} onAddNote={() => demoBounce()} onLogZero={() => demoBounce()} onOpenLog={() => demoBounce()} onOpenGoalLog={() => demoBounce()} onEditGoal={openEditGoal} onCompleteGoal={() => demoBounce()} onDeleteGoal={() => demoBounce()} onShareGoal={() => {}} onEditHabit={openEditHabit} onDeleteHabit={() => demoBounce()} onShareHabit={() => {}} sharingHabitId={null} onAdd={() => demoBounce()} onSaveLogEntry={async () => { demoBounce(); return false; }} onOpenCoachMic={() => setDemoCoachOpen(true)} coachName="Dr. No Excuses" coachIcon="🧘" coachHabitColor={T.accent}/>
          {/* CoachBar — visible, tapping opens demo preview modal (no API calls) */}
          <div style={{ position:"fixed", left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, bottom:60, zIndex:101, padding:"0 10px", boxSizing:"border-box" }}>
            <CoachBar
              coachName="Dr. No Excuses"
              coachIcon="🧘"
              habitColor={T.accent}
              onOpenMic={() => setDemoCoachOpen(true)}
              onOpenText={() => setDemoCoachOpen(true)}
              coachEverOpened={false}
            />
          </div>
          <nav style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:430, maxWidth:"100vw", background:"linear-gradient(180deg, rgba(38,38,34,0.98) 0%, rgba(22,22,19,0.99) 100%)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderTop:`1px solid rgba(200,144,42,0.2)`, boxShadow:"0 -6px 32px rgba(0,0,0,0.5)", display:"flex", zIndex:100, paddingTop:8, paddingBottom:"max(11px, env(safe-area-inset-bottom, 0px))" }}>
            {DEMO_NAV.map(n => (
              <button key={n.id} onClick={() => n.id === "today" ? null : demoBounce()} style={{ flex:1, padding:"9px 4px 6px", border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, fontSize:10, fontWeight:600, color:n.id==="today"?T.accent:T.muted, letterSpacing:"0.02em" }}>
                {n.icon}{n.label}
              </button>
            ))}
          </nav>
        </div>
        {/* Edit modals */}
        {editGoalId    && (() => { const g = resolveGoalForModal(editGoalId, goals, habits); return g ? <EditGoalModal goal={g} onClose={() => setEditGoalId(null)} onSave={handleEditGoalSave}/> : null; })()}
        {editId && !editGoalId && editHabit && !isGoalLikeHabitType(editHabit) && <EditModal habit={editHabit} onClose={() => setEditId(null)} onSave={handleEditSave}/>}
      </>
    );
  }

  // Admin preview of onboarding — safe mode, no DB writes, no Stripe redirect
  if (!loading && !authScreen && previewOnboarding) {
    return (
      <><style>{CSS}</style>
      <div style={{
        position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", zIndex:9999,
        background:"rgba(200,144,42,0.18)", borderBottom:`1px solid ${T.gold}`,
        paddingTop: cssPadTopSafe(6), paddingBottom: 6, ...cssPadXSafe(18),
        fontSize:11, color:T.gold, fontFamily:T.font, width:430, maxWidth:"100vw", textAlign:"center", boxSizing:"border-box",
      }}>
        🔒 Preview mode — no changes will be saved
      </div>
        <OnboardingScreen
          topInset={36}
          onComplete={() => setPreviewOnboarding(false)}
          onSaveProgress={() => Promise.resolve()}
          onCheckout={() => {
            addToast("Preview mode — Stripe skipped");
            setPreviewOnboarding(false);
            return Promise.resolve();
          }}
          onSkip={() => setPreviewOnboarding(false)}
          notifEnabled={notifEnabled}
          notifLoading={notifLoading}
          notifPermission={notifPermission}
          onNotifToggle={handleNotifToggle}
        />
      </>
    );
  }

  // Show onboarding — only after account data loaded and user is genuinely new.
  if (!loading && !authScreen && accountDataReady && onboarded === false) {
    return (
      <><style>{CSS}</style>
      <OnboardingScreen
        onComplete={completeOnboarding}
        onSaveProgress={async ({ name, habits, coachName, emailUpdatesOptIn, arc, firstEvidence }) => {
          const uid = userIdRef.current;
          if (typeof emailUpdatesOptIn === "boolean") {
            writeForgedBetaEmailOptIn(uid, emailUpdatesOptIn);
          }
          if (!uid) return;
          await supabase.from("profiles").upsert({
            id: uid, name, xp: 0, onboarded: true,
            coach_name: coachName, updated_at: new Date().toISOString(),
          });
          const hRows = habits.map(h => habitToRow(h, uid));
          if (hRows.length > 0) await supabase.from("habits").upsert(hRows);

          // First evidence from onboarding — saved as the user's first journal
          // entry so it shows up in Evidence immediately. Non-fatal on error.
          const evidence = (firstEvidence || "").trim();
          if (evidence) {
            try {
              const { data: jRow } = await supabase.from("journal_entries").insert({
                user_id: uid,
                date: todayStr(),
                content: evidence,
                is_ai_generated: false,
              }).select().single();
              if (jRow) setJournalEntries(prev => [jRow, ...prev.filter(e => e.id !== jRow.id)]);
            } catch (err) {
              console.warn("[Forged] first evidence save failed:", err?.message || err);
            }
          }

          // ── Create the user's first Arc (forge_block) if they filled identity ──
          // Skipped entirely when identity is blank, so onboarding remains usable
          // for anyone who bails out of the Arc questions. Failures are logged
          // but non-fatal — we never block the user from entering the app.
          const identity = (arc?.identity || "").trim();
          if (identity) {
            try {
              const startDate = todayStr();
              const durationDays = normalizeArcDuration(arc?.durationDays);
              const _t = new Date();
              const end = new Date(_t.getFullYear(), _t.getMonth(), _t.getDate() + durationDays);
              const endDate = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,"0")}-${String(end.getDate()).padStart(2,"0")}`;
              const insertPayload = {
                user_id: uid,
                title: resolveArcTitle(arc?.title, identity),
                identity,
                why_statement: (arc?.why || "").trim() || null,
                old_pattern:   (arc?.oldPattern || "").trim() || null,
                minimum_proof: (arc?.minimumProof || "").trim() || null,
                start_date: startDate,
                end_date:   endDate,
                status:     "active",
                duration_days: durationDays,
              };
              const { data: blockRow, error: blockErr } = await supabase
                .from("forge_blocks")
                .insert(insertPayload)
                .select()
                .single();
              if (blockErr) {
                console.warn("[Forged] Arc insert failed (continuing without Arc):", blockErr.message);
              } else if (blockRow) {
                // Link every habit this brand-new user just created to the Arc as
                // a proof action. New users have no prior habits, so a flat update
                // by user_id is safe and avoids the client-side temp-id problem.
                const { error: linkErr } = await supabase
                  .from("habits")
                  .update({
                    block_id: blockRow.id,
                    is_proof_action: true,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("user_id", uid);
                if (linkErr) console.warn("[Forged] Arc habit linkage failed:", linkErr.message);
                setActiveBlock(rowToForgeBlock(blockRow));
              }
            } catch (err) {
              console.warn("[Forged] Arc creation exception:", err?.message || err);
            }
          }
        }}
        onCheckout={async () => {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) throw new Error("Not signed in");
          const res = await fetch("/api/create-checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ plan: "monthly" }),
          });
          const json = await res.json();
          if (!res.ok || !json.url) throw new Error(json.error || "Could not start checkout");
          localStorage.setItem('forged_checkout_pending', '1');
          window.location.href = json.url;
        }}
        onSkip={() => {
          setOnboarded(true);
          syncProfile({ onboarded: true, name: user.name || "", xp: 0 });
        }}
        notifEnabled={notifEnabled}
        notifLoading={notifLoading}
        notifPermission={notifPermission}
        onNotifToggle={handleNotifToggle}
      /></>
    );
  }

  // Confirming payment after Stripe redirect — poll until webhook fires
  if (!loading && !authScreen && accountDataReady && onboarded && checkingPayment) {
    return (
      <><style>{CSS}</style>
      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text }}>Forged.</div>
        <div style={{ width:22, height:22, border:`2px solid ${T.border}`, borderTopColor:T.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        <div style={{ fontSize:13, color:T.muted }}>Confirming your payment…</div>
      </div></>
    );
  }

  function spawnParticles(cx, cy, color) {
    const id = Date.now();
    setParticles(p => [...p, ...Array.from({length:10}, (_, i) => ({ id:id+i, x:cx, y:cy, color, angle:(i/10)*360, dist:24+Math.random()*20 }))]);
  }
  function addFlash(x, y, text) {
    const id = Date.now();
    setFlashes(f => [...f, { id, x, y, text }]);
  }

  // Demo mode: intercept any write action and nudge user to sign up
  function demoBounce() {
    if (!demoMode) return false;
    const id = Date.now();
    setToasts(t => [...t, { id, msg: "Create a free account to start tracking for real →" }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
    return true;
  }

  /** Lifetime XP deltas for one coach habit log (read-only; does not mutate state). */
  function coachHabitXpDelta(prev, updated, block, awarded) {
    if (!prev || !updated) return { xp: 0, keys: [] };
    const today = todayStr();
    const habitId = updated.id;
    const isProof = block && isProofHabitForBlock(updated, block.id);
    const lifetimeUnit = lifetimeXpForHabitLog({ hasActiveArc: !!block, isProof: !!isProof });
    const keys = [];
    let xp = 0;

    if (updated.habitType === "project") {
      const targetMins = updated.dailyTargetMinutes ?? 60;
      const prevMins = prev.logs.filter(l => l.date === today).reduce((s, l) => s + (l.value?.minutes || 0), 0);
      const nextMins = updated.logs.filter(l => l.date === today).reduce((s, l) => s + (l.value?.minutes || 0), 0);
      const firstKey = `project-first:${habitId}:${today}`;
      const bonusKey = `project-target:${habitId}:${today}`;
      if (prevMins === 0 && !awarded.has(firstKey)) { xp += lifetimeUnit; keys.push(firstKey); }
      if (prevMins < targetMins && nextMins >= targetMins && !awarded.has(bonusKey)) { xp += lifetimeUnit; keys.push(bonusKey); }
      return { xp, keys };
    }

    if (updated.habitType === "limit") return { xp: 0, keys: [] };

    const wasDone = prev.logs.some(l => l.date === today && l.value === true);
    const isDone = updated.logs.some(l => l.date === today && l.value === true);
    if (!isDone || wasDone) return { xp: 0, keys: [] };

    const awardKey = `${habitId}:${today}`;
    if (awarded.has(awardKey)) return { xp: 0, keys: [] };
    return { xp: lifetimeUnit, keys: [awardKey] };
  }

  /** Apply all coach log_habit results in one state update (avoids stale habits when many tools run). */
  function applyCoachLogsBatch(logged = []) {
    if (!logged.length) return;

    const habitLogs = logged.filter(l => l.habit_type !== "goal");
    const goalLogs = logged.filter(l => l.habit_type === "goal");

    if (habitLogs.length) {
      setHabits(prevHabits => {
        const logMap = new Map(habitLogs.map(l => [String(l.habit_id), l.updatedLogs]));
        const nextHabits = prevHabits.map(h => {
          const logs = logMap.get(String(h.id));
          return logs ? { ...h, logs } : h;
        });
        const block = activeBlock;
        let xpTotal = 0;
        const awardKeys = [];
        const awarded = xpAwardedDates;
        for (const l of habitLogs) {
          const prev = prevHabits.find(h => String(h.id) === String(l.habit_id));
          const updated = nextHabits.find(h => String(h.id) === String(l.habit_id));
          const { xp, keys } = coachHabitXpDelta(prev, updated, block, awarded);
          xpTotal += xp;
          awardKeys.push(...keys);
        }
        queueMicrotask(() => {
          if (xpTotal > 0) setXp(x => x + xpTotal);
          if (awardKeys.length) {
            setXpAwardedDates(prevSet => {
              const next = new Set(prevSet);
              awardKeys.forEach(k => next.add(k));
              return next;
            });
          }
          if (block) void reconcileArcProgress(block, nextHabits);
        });
        return nextHabits;
      });
    }

    if (goalLogs.length) {
      setGoals(prevGoals => {
        const logMap = new Map(goalLogs.map(l => [String(l.habit_id), l.updatedLogs]));
        const nextGoals = prevGoals.map(g => {
          const logs = logMap.get(String(g.id));
          if (!logs) return g;
          const lastLog = [...logs].reverse().find(l => l.date === todayStr() && typeof l.value === "number");
          const nextValue = lastLog ? Number(lastLog.value) : g.currentValue;
          return {
            ...g,
            logs,
            currentValue: Number.isFinite(nextValue) ? nextValue : g.currentValue,
          };
        });
        const today = todayStr();
        let xpTotal = 0;
        const awardKeys = [];
        for (const l of goalLogs) {
          const prev = prevGoals.find(g => String(g.id) === String(l.habit_id));
          const updated = nextGoals.find(g => String(g.id) === String(l.habit_id));
          if (!prev || !updated) continue;
          const awardKey = `goal:${l.habit_id}:${today}`;
          if (xpAwardedDates.has(awardKey)) continue;
          const prevValue = Number(prev.currentValue);
          const nextValue = Number(updated.currentValue);
          if (!Number.isFinite(prevValue) || !Number.isFinite(nextValue) || nextValue === prevValue) continue;
          const target = Number(prev.targetValue);
          const prevDist = Math.abs(target - prevValue);
          const nextDist = Math.abs(target - nextValue);
          xpTotal += nextDist < prevDist ? 15 : 5;
          awardKeys.push(awardKey);
        }
        queueMicrotask(() => {
          if (xpTotal > 0) setXp(x => x + xpTotal);
          if (awardKeys.length) {
            setXpAwardedDates(prevSet => {
              const next = new Set(prevSet);
              awardKeys.forEach(k => next.add(k));
              return next;
            });
          }
        });
        return nextGoals;
      });
    }
  }

  // Tap handler: daily, weekly, limit
  async function handleTap(id, e) {
    if (demoBounce()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const base = habits.find(h => h.id === id);
    if (!base) return;
    if (base.habitType === "log") return;
    let tapped = null;
    if (base.habitType === "limit") {
      const today = todayStr();
      const inc = base.tapIncrement ?? 1;
      const logsWithoutNoneToday = base.logs.filter(l => !(l.date === today && l.value === 0));
      tapped = { ...base, logs:[...logsWithoutNoneToday, { date:today, value:inc, note:"" }] };
    } else {
      const today = todayStr();
      const hasTrue = base.logs.some(l => l.date === today && l.value === true);
      // On untap, only remove the session marker (value:true). Replacing today's
      // row when adding a session avoids duplicate dates if a rest day (skip) exists.
      if (hasTrue) {
        tapped = { ...base, logs: base.logs.filter(l => !(l.date === today && l.value === true)) };
      } else {
        const logsNoToday = base.logs.filter(l => l.date !== today);
        tapped = { ...base, logs: [...logsNoToday, { date: today, value: true, note: "" }] };
      }
    }
    // Optimistic update — show result immediately, revert if save fails
    const nextHabits = habits.map(h => h.id === id ? tapped : h);
    setHabits(nextHabits);
    syncLastActive();
    const saved = await syncHabit(tapped);
    if (!saved) {
      setHabits(prev => prev.map(h => h.id === id ? base : h));
      return;
    }

    const today = todayStr();
    const block = activeBlock;
    if (block) {
      const { ok, delta } = await reconcileArcProgress(block, nextHabits);
      if (!ok) addToast("⚠️ Couldn't sync Arc progress");
      else if (delta > 0) addFlash(cx, cy, `+${delta} arc xp`);
    }

    // Limit taps never award lifetime XP — but proof limits still drive Arc progress.
    if (tapped.habitType === "limit") return;

    const wasLogged = base.logs.some(l => l.date === today && l.value === true);
    const isNowLogged = tapped.logs.some(l => l.date === today && l.value === true);
    if (!isNowLogged) return;

    const awardKey = `${id}:${today}`;
    const alreadyEarnedToday = xpAwardedDates.has(awardKey) || wasLogged;
    if (!alreadyEarnedToday) {
      const isProof = block && isProofHabitForBlock(tapped, block.id);
      const amount = lifetimeXpForHabitLog({ hasActiveArc: !!block, isProof: !!isProof });
      spawnParticles(cx, cy, tapped.color);
      addFlash(cx, cy, `+${amount} xp`);
      setXp(x => x + amount);
      setXpAwardedDates(prev => {
        const next = new Set(prev);
        next.add(awardKey);
        return next;
      });

      // First proof tap of the day → one-shot nudge toward the coach for context
      if (isProof && !wasLogged) {
        try {
          const nudgeKey = `forged_proof_ctx_nudge:${sessionUserId}:${today}`;
          if (!localStorage.getItem(nudgeKey)) {
            localStorage.setItem(nudgeKey, '1');
            const nid = ++coachNudgeSeqRef.current;
            setCoachPageNudge({ id: nid, text: "Got context? Tell me here — I'll turn it into the record." });
            setTimeout(() => setCoachPageNudge(prev => (prev?.id === nid ? null : prev)), COACH_NUDGE_DURATION_MS);
          }
        } catch { /* ignore */ }
      }
    }
  }

  // Log handler: project
  async function handleLog(id, logData) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const already = habit.logs.some(l => l.date === todayStr());
    const isNew = habit.habitType === "project" || !already;
    const updated = isNew
      ? { ...habit, logs:[...habit.logs, { date:todayStr(), ...logData }] }
      : { ...habit, logs: habit.logs.map(l => l.date === todayStr() ? { ...l, ...logData } : l) };
    const saved = await syncHabit(updated);
    if (!saved) return;
    const nextHabits = habits.map(h => h.id === id ? updated : h);
    setHabits(nextHabits);
    const block = activeBlock;
    if (block) {
      const { ok, delta } = await reconcileArcProgress(block, nextHabits);
      if (!ok) addToast("⚠️ Couldn't sync Arc progress");
      else if (delta > 0) addFlash(window.innerWidth / 2, 120, `+${delta} arc xp`);
    }
    const isProof = block && isProofHabitForBlock(updated, block.id);
    const lifetimeUnit = lifetimeXpForHabitLog({ hasActiveArc: !!block, isProof: !!isProof });
    // Linked accountability sync runs inside syncHabit (full projection from personal logs).
    if (habit.habitType === "project") {
      const today = todayStr();
      const firstKey = `project-first:${id}:${today}`;
      const bonusKey = `project-target:${id}:${today}`;
      const targetMins = habit.dailyTargetMinutes ?? 60;
      const prevMins = habit.logs.filter(l => l.date === today).reduce((s, l) => s + (l.value?.minutes || 0), 0);
      const nextMins = updated.logs.filter(l => l.date === today).reduce((s, l) => s + (l.value?.minutes || 0), 0);
      let xpGain = 0;
      let earnedFirst = false;
      let earnedBonus = false;
      if (prevMins === 0 && !xpAwardedDates.has(firstKey)) {
        xpGain += lifetimeUnit;
        earnedFirst = true;
      }
      if (prevMins < targetMins && nextMins >= targetMins && !xpAwardedDates.has(bonusKey)) {
        xpGain += lifetimeUnit;
        earnedBonus = true;
      }
      if (xpGain > 0) {
        addFlash(window.innerWidth / 2, 120, `+${xpGain} xp`);
        setXp(x => x + xpGain);
        setXpAwardedDates(prev => {
          const next = new Set(prev);
          if (earnedFirst) next.add(firstKey);
          if (earnedBonus) next.add(bonusKey);
          return next;
        });
      }
    } else if (isNew) {
      const today = todayStr();
      const awardKey = `log:${id}:${today}`;
      if (!xpAwardedDates.has(awardKey)) {
        addFlash(window.innerWidth / 2, 120, `+${lifetimeUnit} xp`);
        setXp(x => x + lifetimeUnit);
        setXpAwardedDates(prev => {
          const next = new Set(prev);
          next.add(awardKey);
          return next;
        });
      }
    }
  }

  // Undo last limit tap: remove the most recent *numeric* log for today (never quicknotes / skip strings)
  async function handleUndoLimit(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const today = todayStr();
    const numericToday = habit.logs
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.date === today && typeof l.value === "number");
    if (!numericToday.length) return;
    const removeIdx = numericToday[numericToday.length - 1].i;
    const updated = { ...habit, logs: habit.logs.filter((_, i) => i !== removeIdx) };
    const saved = await syncHabit(updated);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    addToast("↩ Last tap removed");
  }

  async function handleSkipDay(id, note = "") {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const today = todayStr();
    const withoutToday = habit.logs.filter(l => l.date !== today);
    const updated = { ...habit, logs:[...withoutToday, { date:today, value:"skip", note: note || "" }] };
    const saved = await syncHabit(updated);
    if (!saved) return;
    const nextHabits = habits.map(h => h.id === id ? updated : h);
    setHabits(nextHabits);
    if (activeBlock?.id) void reconcileArcProgress(activeBlock, nextHabits);
    addToast(habit.habitType === "weekly"
      ? "🛡️ Weekly rest day — ring counts this; session tally unchanged"
      : "🛡️ Rest day — streak protected");
  }

  // Add a quick note as a standalone log entry — each Done tap creates a separate record
  async function handleAddNote(id, text) {
    if (!text.trim()) return false;
    const habit = habits.find(h => h.id === id);
    if (!habit) return false;
    const updated = { ...habit, logs: [...habit.logs, { date: todayStr(), value: "quicknote", note: text.trim() }] };
    const saved = await syncHabit(updated);
    if (!saved) return false;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    return true;
  }

  /** Append a dated journal entry to a Log track (`habit_type: "log"`). */
  async function handleSaveLogEntry(id, text) {
    if (!text.trim()) return false;
    if (demoBounce()) return false;
    const habit = habits.find(h => h.id === id);
    if (!habit || habit.habitType !== "log") return false;
    const updated = { ...habit, logs: [...habit.logs, { date: todayStr(), value: "log", note: text.trim() }] };
    const saved = await syncHabit(updated);
    if (!saved) {
      addToast("⚠️ Couldn't save log — check your connection");
      return false;
    }
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    syncLastActive();
    addToast("✓ Log saved");
    return true;
  }

  // Explicitly log 0 for a limit habit — marks "had none today" as a conscious choice
  async function handleLogZero(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const today = todayStr();
    const todayNumeric = habit.logs.filter(l => l.date === today && typeof l.value === "number");
    if (todayNumeric.some(l => l.value === 0)) return;
    const usageToday = todayNumeric.filter(l => l.value !== 0);
    let nextLogs;
    if (usageToday.length > 0) {
      const used = usageToday.reduce((s, l) => s + l.value, 0);
      const unit = habit.unit?.trim();
      const amountLabel = unit ? `${used} ${unit}` : String(used);
      const ok = window.confirm(`You've already logged ${amountLabel} today. Mark as none instead?`);
      if (!ok) return;
      nextLogs = habit.logs.filter(l => !(l.date === today && typeof l.value === "number"));
      nextLogs = [...nextLogs, { date: today, value: 0, note: "" }];
    } else {
      nextLogs = [...habit.logs, { date: today, value: 0, note: "" }];
    }
    const updated = { ...habit, logs: nextLogs };
    const saved = await syncHabit(updated);
    if (!saved) return;
    const nextHabits = habits.map(h => h.id === id ? updated : h);
    setHabits(nextHabits);
    const block = activeBlock;
    if (block) void reconcileArcProgress(block, nextHabits);
    const noneTodayXpKey = `limit-none:${id}:${today}`;
    if (!xpAwardedDates.has(noneTodayXpKey)) {
      const isProof = block && isProofHabitForBlock(habit, block.id);
      const amount = block && !isProof ? LIFETIME_XP_DURING_ARC_NON_PROOF : LIFETIME_XP_LIMIT_NONE;
      addFlash(window.innerWidth / 2, 120, `+${amount} xp`);
      setXp(x => x + amount);
      setXpAwardedDates(prev => {
        const next = new Set(prev);
        next.add(noneTodayXpKey);
        return next;
      });
    }
    addToast("✓ Logged — none today");
  }

  // Lower a limit habit's daily budget directly (reduce-aim nudge CTA)
  // Also saves a milestone note to today's journal context so the journal can reference it.
  async function handleLowerBudget(id, newBudget, oldBudget) {
    const habit = habits.find(h => h.id === id);
    if (!habit || demoMode) return;
    const uid = userIdRef.current;
    if (!uid) return;
    const updated = { ...habit, dailyBudget: newBudget };
    const saved = await syncHabit(updated);
    if (!saved) return;
    setHabits(prev => prev.map(h => h.id === id ? updated : h));
    const unit = habit.unit && habit.unit !== "logged" ? habit.unit : "";
    addToast(`✓ ${habit.name} — limit lowered to ${newBudget}${unit ? " " + unit : ""}/day`);
    // Save milestone to today's journal context
    const today = todayStr();
    const note = `Reduced ${habit.name} limit from ${oldBudget}${unit ? " " + unit : ""} to ${newBudget}${unit ? " " + unit : ""} today.`;
    try {
      const { data: existing } = await supabase
        .from("journal_entries")
        .select("id, daily_context")
        .eq("user_id", uid)
        .eq("date", today)
        .maybeSingle();
      const prevContext = Array.isArray(existing?.daily_context) ? existing.daily_context : [];
      const updatedContext = [...prevContext, note];
      if (existing) {
        await supabase.from("journal_entries")
          .update({ daily_context: updatedContext, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase.from("journal_entries")
          .insert({ user_id: uid, date: today, content: "", daily_context: updatedContext });
      }
    } catch (err) {
      console.warn("[Forged] handleLowerBudget — milestone note failed:", err.message);
    }
  }

  // Reflection: save to most recent today log, or create standalone entry
  async function handleSaveReflection(id, text) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    const logs = [...habit.logs];
    const idx = logs.map(l => l.date).lastIndexOf(todayStr());
    if (idx >= 0) logs[idx] = { ...logs[idx], reflection:text };
    else logs.push({ date:todayStr(), value:null, note:"", reflection:text });
    const reflected = { ...habit, logs };
    const saved = await syncHabit(reflected);
    if (!saved) {
      addToast("⚠️ Couldn't save reflection — check your connection");
      return;
    }
    setHabits(prev => prev.map(h => h.id === id ? reflected : h));
    addToast("✓ Reflection saved");
  }

  // Edit save
  async function handleEditSave(id, updates) {
    const habit = habits.find(h => entityIdEq(h.id, id));
    if (!habit) return;
    const edited = { ...habit, ...updates };
    if (demoMode) {
      setHabits(prev => prev.map(h => (entityIdEq(h.id, id) ? edited : h)));
      setEditId(null);
      addToast("Preview only — create a free account to save edits.");
      return;
    }
    const saved = await syncHabit(edited);
    if (!saved) {
      addToast("⚠️ Couldn't update habit — check your connection");
      return;
    }
    setHabits(prev => prev.map(h => (entityIdEq(h.id, id) ? edited : h)));
    addToast("✓ Habit updated");
  }

  function openCoachWithMode(mode) {
    try { localStorage.setItem("forged_coach_opened", "1"); } catch { /* ignore */ }
    setCoachEverOpened(true);
    setCoachDraftInput(null);
    setCoachOpenMode(mode);
    setShowCoach(true);
  }

  function openCoachWithDraft(text) {
    try { localStorage.setItem("forged_coach_opened", "1"); } catch { /* ignore */ }
    setCoachEverOpened(true);
    setCoachPendingMsg(null);
    setCoachDraftInput(String(text ?? "").trim());
    setCoachOpenMode("text");
    setShowCoach(true);
  }

  /** Opens coach and auto-sends the first message (AICoach pendingMessage path). */
  function openCoachWithPendingMessage(text, { linkNextHabitAsProof = false } = {}) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) return;
    if (proofCoachLaunchRef.current && showCoach) return;
    proofCoachLaunchRef.current = true;
    proofActionLinkNextRef.current = !!linkNextHabitAsProof;
    try { localStorage.setItem("forged_coach_opened", "1"); } catch { /* ignore */ }
    setCoachEverOpened(true);
    setCoachDraftInput(null);
    setCoachPendingMsg(trimmed);
    setCoachOpenMode("text");
    setShowCoach(true);
  }

  function openCoachForProofAction() {
    openCoachWithPendingMessage(
      "I want to add a new proof action for this Arc.",
      { linkNextHabitAsProof: true },
    );
  }

  // Gate adding habits at 5 for free users
  function handleStartAdd() {
    if (demoBounce()) return;
    // On Today, show choice sheet (habit or goal), then AddModal or AddGoalModal.
    if (screen === "today") {
      setShowAddChoice(true);
    } else if (!isPro && habits.length >= 5) {
      setShowUpgrade(true);
    } else {
      setShowAdd(true);
    }
  }

  // Add a new habit
  async function handleAddHabit(h) {
    const saved = await syncHabit(h);
    if (!saved) {
      addToast("⚠️ Couldn't add habit — check your connection");
      return;
    }
    setHabits(p => [...p, h]);
    setShowAdd(false);
    addToast("✓ Habit added");
  }

  // Delete a habit — optimistic remove, restore from DB on failure
  async function handleDeleteHabit(id) {
    const uid = userIdRef.current;
    if (!uid) return;
    setHabits(p => p.filter(h => h.id !== id));
    const { error } = await supabase.from("habits").delete().eq("id", id).eq("user_id", uid);
    if (error) {
      console.error("Delete failed:", error.message);
      addToast("⚠️ Couldn't delete — tap again to retry");
      // Re-sync from DB so nothing is lost
      const { data: rows } = await supabase.from("habits").select("*").eq("user_id", uid).order("created_at");
      if (rows) {
        const { goals: nextGoals, habits: nextHabits } = splitDbRowsIntoGoalsAndHabits(rows);
        setGoals(nextGoals);
        setHabits(nextHabits);
      }
    }
  }

  // ── Loose Ends (tasks) handlers ───────────────────────────────────────────────

  async function handleAddTask(text) {
    const uid = userIdRef.current;
    if (!uid || !text.trim()) return;
    const today = todayStr();
    const { data: row, error } = await supabase.from("tasks")
      .insert({ user_id: uid, text: text.trim(), date: today, done: false, pinned: false, source: "manual" })
      .select()
      .single();
    if (error || !row) {
      addToast("⚠️ Couldn't save loose end — check your connection");
      return;
    }
    setTasks(prev => [...prev, rowToTask(row)]);
  }

  async function handleCompleteTask(id, done, eventTarget = null) {
    const uid = userIdRef.current;
    if (!uid) return;
    const now = new Date().toISOString();
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done, doneAt: done ? now : null } : t));
    const { error } = await supabase.from("tasks")
      .update({ done, done_at: done ? now : null })
      .eq("id", id).eq("user_id", uid);
    if (error) {
      // Roll back optimistic update
      setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !done, doneAt: done ? null : now } : t));
      addToast("⚠️ Couldn't update loose end");
      return;
    }
    // Award / withdraw +5 XP for task completion
    const awardKey = `task:${id}`;
    if (done && !xpAwardedDates.has(awardKey)) {
      setXp(x => x + 5);
      setXpAwardedDates(prev => { const n = new Set(prev); n.add(awardKey); return n; });
      if (eventTarget) {
        const r = eventTarget.getBoundingClientRect();
        addFlash(r.left + r.width / 2, r.top + r.height / 2, "+5 xp");
      }
    } else if (!done && xpAwardedDates.has(awardKey)) {
      setXp(x => Math.max(0, x - 5));
      setXpAwardedDates(prev => { const n = new Set(prev); n.delete(awardKey); return n; });
    }
  }

  async function handlePinTask(id, pinned) {
    const uid = userIdRef.current;
    if (!uid) return;
    setTasks(prev => prev.map(t => t.id === id ? { ...t, pinned } : t));
    const { error } = await supabase.from("tasks")
      .update({ pinned })
      .eq("id", id).eq("user_id", uid);
    if (error) {
      setTasks(prev => prev.map(t => t.id === id ? { ...t, pinned: !pinned } : t));
      addToast("⚠️ Couldn't update loose end");
    }
  }

  async function handleDeleteTask(id) {
    const uid = userIdRef.current;
    if (!uid) return;
    setTasks(prev => prev.filter(t => t.id !== id));
    const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", uid);
    if (error) {
      addToast("⚠️ Couldn't delete loose end");
      // Reload tasks from DB to restore state
      const today = todayStr();
      supabase.from("tasks").select("*").eq("user_id", uid)
        .or(`date.eq.${today},and(pinned.eq.true,done.eq.false)`)
        .order("created_at")
        .then(({ data: tRows }) => { if (tRows) setTasks(tRows.map(rowToTask)); });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  async function handleAddGoal(goal) {
    const saved = await syncGoal(goal);
    if (!saved) {
      addToast("⚠️ Couldn't add goal — check your connection");
      return;
    }
    setGoals(prev => [...prev, goal]);
    setShowAddGoal(false);
    addToast("✓ Goal added");
  }

  /** Called when user confirms a <goal_plan> card from the AI coach chat. */
  async function handleGoalPlanConfirm(plan) {
    const milestones = (plan.milestones || [])
      .filter(m => m.date && m.label)
      .map((m, i) => ({
        type: "milestone",
        date: m.date,
        label: m.label,
        id: `ms_${Date.now()}_${i}`,
      }));
    const whyEntry = plan.why
      ? [{ type: "goal_why", label: plan.why, id: `why_${Date.now()}` }]
      : [];
    const goal = {
      id: `${Date.now()}.${Math.floor(Math.random() * 1000)}`,
      name: plan.name,
      emoji: plan.emoji || "🎯",
      habitType: "goal",
      unit: plan.unit || "",
      startValue: Number(plan.startValue ?? 0),
      targetValue: Number(plan.targetValue),
      currentValue: Number(plan.startValue ?? 0),
      direction: plan.direction || "increasing",
      targetDate: plan.targetDate || null,
      status: "active",
      logs: [...milestones, ...whyEntry],
      color: plan.color || "#E67E22",
    };
    const saved = await syncGoal(goal);
    if (!saved) throw new Error("Save failed");
    setGoals(prev => [...prev, goal]);
    addToast(`✓ Goal "${plan.name}" created`);
  }

  /** Save a weekly check-in (emoji rating 1-5) for a goal. */
  async function handleGoalCheckin(goalId, rating, note) {
    const goal = resolveGoalForModal(goalId, goals, habits);
    if (!goal) return;
    const weekStart = weekStartFor(todayStr());
    // Replace any existing checkin for this week, keep all other log entries
    const otherLogs = (goal.logs || []).filter(l => !(l.type === "checkin" && l.date === weekStart));
    const newCheckin = { type: "checkin", date: weekStart, rating, note: note || "", id: `ci_${Date.now()}` };
    const updated = { ...goal, logs: [...otherLogs, newCheckin] };
    const saved = await syncGoal(updated);
    if (!saved) { addToast("⚠️ Couldn't save check-in"); return; }
    setGoals(prev => prev.map(g => entityIdEq(g.id, goalId) ? updated : g));
  }

  /** Update the habit IDs linked to a goal (stored as a goal_links log entry). */
  async function handleGoalLinkHabits(goalId, habitIds) {
    const goal = resolveGoalForModal(goalId, goals, habits);
    if (!goal) return;
    const otherLogs = (goal.logs || []).filter(l => l.type !== "goal_links");
    const linksEntry = { type: "goal_links", habitIds: habitIds.map(String), id: `gl_${Date.now()}` };
    const updated = { ...goal, logs: [...otherLogs, linksEntry] };
    const saved = await syncGoal(updated);
    if (!saved) { addToast("⚠️ Couldn't save linked habits"); return; }
    setGoals(prev => prev.map(g => entityIdEq(g.id, goalId) ? updated : g));
    addToast(`✓ Linked habits updated`);
  }

  async function handleLogGoal(id, value, note) {
    const goal = resolveGoalForModal(id, goals, habits);
    if (!goal) return;
    const newLogs = [...goal.logs, { date: todayStr(), value, note: note || "" }];
    const updated = {
      ...goal,
      currentValue: value,
      logs: newLogs,
      lastLogDate: todayStr(),
      status: getGoalProgress({ ...goal, currentValue: value }).isComplete ? "completed" : goal.status,
    };
    const saved = await syncGoal(updated);
    if (!saved) return;
    const nextGoals = (() => {
      const idx = goals.findIndex(g => entityIdEq(g.id, id));
      if (idx === -1) return [...goals, updated];
      return goals.map(g => (entityIdEq(g.id, id) ? updated : g));
    })();
    setGoals(nextGoals);
    setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
    if (activeBlock?.id && updated.blockId === activeBlock.id) {
      void reconcileArcProgress(activeBlock, habits, nextGoals);
    }
    const today = todayStr();
    const awardKey = `goal:${id}:${today}`;
    if (xpAwardedDates.has(awardKey)) return;
    const prevValue = Number(goal.currentValue);
    const nextValue = Number(value);
    if (!Number.isFinite(prevValue) || !Number.isFinite(nextValue)) return;
    if (nextValue === prevValue) return;
    const target = Number(goal.targetValue);
    const prevDist = Math.abs(target - prevValue);
    const nextDist = Math.abs(target - nextValue);
    const xpGain = nextDist < prevDist ? 15 : 5;
    if (xpGain > 0) {
      addFlash(window.innerWidth / 2, 120, `+${xpGain} xp`);
      setXp(x => x + xpGain);
      setXpAwardedDates(prev => {
        const next = new Set(prev);
        next.add(awardKey);
        return next;
      });
    }
  }

  async function handleDeleteGoal(id) {
    const uid = userIdRef.current;
    if (!uid) return;
    setGoals(prev => prev.filter(g => g.id !== id));
    await supabase.from("habits").delete().eq("id", id).eq("user_id", uid);
  }

  async function handleCompleteGoal(id) {
    const goal = resolveGoalForModal(id, goals, habits);
    if (!goal) return;
    const updated = { ...goal, status: "completed" };
    const saved = await syncGoal(updated);
    if (!saved) {
      addToast("⚠️ Couldn't complete goal — check your connection");
      return;
    }
    const nextGoals = (() => {
      const idx = goals.findIndex(g => entityIdEq(g.id, id));
      if (idx === -1) return [...goals, updated];
      return goals.map(g => (entityIdEq(g.id, id) ? updated : g));
    })();
    setGoals(nextGoals);
    setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
    if (activeBlock?.id && updated.blockId === activeBlock.id) {
      void reconcileArcProgress(activeBlock, habits, nextGoals);
    }
    addToast("✓ Goal completed");
  }

  async function handleEditGoalSave(id, updates) {
    const goal = resolveGoalForModal(id, goals, habits);
    if (!goal) return;
    const updated = { ...goal, ...updates };
    if (demoMode) {
      setGoals(prev => {
        const idx = prev.findIndex(g => entityIdEq(g.id, id));
        if (idx === -1) return [...prev, updated];
        return prev.map(g => (entityIdEq(g.id, id) ? updated : g));
      });
      setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
      setEditGoalId(null);
      addToast("Preview only — create a free account to save edits.");
      return;
    }
    const saved = await syncGoal(updated);
    if (!saved) {
      addToast("⚠️ Couldn't update goal — check your connection");
      return;
    }
    setGoals(prev => {
      const idx = prev.findIndex(g => entityIdEq(g.id, id));
      if (idx === -1) return [...prev, updated];
      return prev.map(g => (entityIdEq(g.id, id) ? updated : g));
    });
    setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
    addToast("✓ Goal updated");
  }

  /** Remove one log row from a habit or goal (Journal). XP is unchanged. */
  async function handleDeleteJournalLogEntry(entity, logEntry) {
    const isGoal = entity.habitType === "goal";
    const id = entity.id;
    if (isGoal) {
      const g = resolveGoalForModal(id, goals, habits);
      if (!g) return false;
      const idx = g.logs.indexOf(logEntry);
      if (idx === -1) return false;
      const nextLogs = g.logs.filter((_, i) => i !== idx);
      const updated = goalStateAfterLogRemoval(g, nextLogs);
      const saved = await syncGoal(updated);
      if (!saved) return false;
      setGoals(prev => {
        const idx = prev.findIndex(x => entityIdEq(x.id, id));
        if (idx === -1) return [...prev, updated];
        return prev.map(x => (entityIdEq(x.id, id) ? updated : x));
      });
      setHabits(prev => prev.filter(h => !entityIdEq(h.id, id)));
      addToast("✓ Entry removed");
      return true;
    }
    const h = habits.find(x => x.id === id);
    if (!h) return false;
    const idx = h.logs.indexOf(logEntry);
    if (idx === -1) return false;
    const updated = { ...h, logs: h.logs.filter((_, i) => i !== idx) };
    const saved = await syncHabit(updated);
    if (!saved) return false;
    setHabits(prev => prev.map(x => x.id === id ? updated : x));
    addToast("✓ Entry removed");
    return true;
  }

  async function handleSignOut() {
    // onAuthStateChange will fire SIGNED_OUT and handle all state resets
    await supabase.auth.signOut();
  }

  // Primary navigation is Today · Arc · You. Journal ("Evidence") and Insights
  // ("Reviews") live inside the Arc screen; Social and Hub are reachable from
  // the You screen. navigateTo maps legacy screen ids onto the new structure so
  // older deep links (coach receipts, notifications) keep working.
  function navigateTo(target) {
    // Legacy "evidence"/"journal" routes → Arc timeline (current week), not chronology archive.
    if (target === "journal" || target === "evidence") { setArcTab("arc"); setScreen("arc"); return; }
    if (target === "insights" || target === "reviews") { setArcTab("reviews");  setScreen("arc"); return; }
    if (target === "arc") { setArcTab("arc"); setScreen("arc"); return; }
    setScreen(target);
  }

  const NAV = [
    { id:"today",    label:"Today",    icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id:"arc",      label:"Arc",      icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 15a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 3.5v2M4.6 5.6l1.4 1.4M15.4 5.6L14 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { id:"profile",  label:"You",      icon:<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  ];

  return (
    <>
      <style>{CSS}</style>
      {particles.map(p => <Particle key={p.id} {...p} onDone={() => setParticles(ps => ps.filter(x => x.id !== p.id))}/>)}
      {flashes.map(f   => <XPFlash  key={f.id} {...f} onDone={() => setFlashes(fs  => fs.filter(x  => x.id !== f.id))}/>)}
      {toasts.map(t    => <Toast    key={t.id} msg={t.msg} onDone={() => setToasts(ts => ts.filter(x => x.id !== t.id))}/>)}

      <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, paddingBottom:172 }}>
        {/* Top bar */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop: cssPadTopSafe(22), paddingBottom: 8, ...cssPadXSafe(18) }}>
          <div>
            <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:1, lineHeight:1.35 }}>
              {screen === "today"
                ? fmtDateLong()
                : screen === "profile" ? user.name
                : screen === "arc" ? "Your Arc"
                : screen === "hub" ? "All tracked items"
                : screen.charAt(0).toUpperCase()+screen.slice(1)}
            </div>
          </div>
        </div>

        {/* Notification nudge banner — shown on Today screen when not enabled */}
        {screen === "today" && !notifEnabled && !notifNudgeDismissed && notifPermission !== "denied" && (
          <div style={{ display:"flex", alignItems:"center", gap:10, paddingTop: 9, paddingBottom: 9, ...cssPadXSafe(14), background:"rgba(200,144,42,0.1)", borderBottom:`0.5px solid rgba(200,144,42,0.22)` }}>
            <span style={{ fontSize:16, flexShrink:0 }}>🔔</span>
            <span style={{ flex:1, fontSize:12, color:T.sub, lineHeight:1.5 }}>Get daily reminders to keep your streak.</span>
            <button
              onClick={handleNotifToggle}
              disabled={notifLoading}
              style={{ flexShrink:0, padding:"5px 12px", borderRadius:16, border:"none", background:T.gold, color:"#0F0F0D", fontSize:12, fontWeight:700, cursor:"pointer", opacity:notifLoading?0.7:1 }}
            >
              {notifLoading ? "…" : "Enable"}
            </button>
            <button
              onClick={() => { setNotifNudgeDismissed(true); localStorage.setItem("forged_notif_nudge_dismissed","1"); }}
              style={{ flexShrink:0, width:24, height:24, borderRadius:"50%", border:"none", background:"none", color:T.muted, fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}
              aria-label="Dismiss"
            >×</button>
          </div>
        )}
        {screen === "today"    && <TodayScreen    habits={habits} goals={goals} xp={xp} activeBlock={activeBlock} todayArcScore={todayArcScore} arcLedgerRows={arcLedgerRows} arcProofSyncing={arcProofSyncing} onStartArc={openArcCoachCreate} onViewArc={() => { setScreen("arc"); setArcTab("arc"); }} onLinkProofHabit={linkHabitAsProof} onUnlinkProofItem={unlinkProofItem} onTap={handleTap} onUndo={handleUndoLimit} onSkip={handleSkipDay} onAddNote={handleAddNote} onLogZero={handleLogZero} onOpenLog={id => setLogId(id)} onOpenGoalLog={id => setLogGoalId(id)} onEditGoal={openEditGoal} onCompleteGoal={handleCompleteGoal} onDeleteGoal={handleDeleteGoal} onShareGoal={handleShareGoal} onEditHabit={openEditHabit} onDeleteHabit={handleDeleteHabit} onShareHabit={handleShareHabit} sharingHabitId={sharingHabitId} onAdd={handleStartAdd} onSaveLogEntry={handleSaveLogEntry} onOpenCoachMic={() => openCoachWithMode("mic")} onOpenCoachWithDraft={openCoachWithDraft} onCreateProofViaCoach={openCoachForProofAction} coachName={coachName} coachIcon={coachIcon} coachHabitColor={habits.find(h => h.habitType !== "log")?.color || T.accent} onOpenGoalDetail={id => setOpenGoalId(id)} todayJournalEntry={journalEntries.find(e => e.date === todayStr()) ?? null} onGenerateReceipt={handleGenerateReceipt} generatingReceipt={generatingReceipt} onOpenJournal={() => { setJournalOpenTab("journal"); setJournalAutoGenerate(false); navigateTo("arc"); }} onLowerBudget={handleLowerBudget} tasks={tasks} onAddTask={handleAddTask} onCompleteTask={handleCompleteTask} onPinTask={handlePinTask} onDeleteTask={handleDeleteTask} onOpenHub={() => setScreen("hub")}/>}
        {screen === "hub"      && <HubScreen
          habits={habits} goals={goals} tasks={tasks} activeBlock={activeBlock}
          onBack={() => setScreen("today")}
          onAdd={handleStartAdd}
          onTap={handleTap} onUndo={handleUndoLimit} onSkip={handleSkipDay} onAddNote={handleAddNote}
          onLogZero={handleLogZero} onOpenLog={id => setLogId(id)}
          onSaveLogEntry={handleSaveLogEntry}
          onEditHabit={openEditHabit} onDeleteHabit={handleDeleteHabit} onShareHabit={handleShareHabit}
          sharingHabitId={sharingHabitId}
          onLowerBudget={handleLowerBudget} onOpenCoachWithDraft={openCoachWithDraft}
          onOpenGoalLog={id => setLogGoalId(id)} onEditGoal={openEditGoal}
          onCompleteGoal={handleCompleteGoal} onDeleteGoal={handleDeleteGoal}
          onShareGoal={handleShareGoal} onOpenGoalDetail={id => setOpenGoalId(id)}
          onAddTask={handleAddTask} onCompleteTask={handleCompleteTask}
          onPinTask={handlePinTask} onDeleteTask={handleDeleteTask}
          onLinkProofHabit={linkHabitAsProof}
        />}
        {screen === "arc" && <ArcScreen
          tab={arcTab} onTabChange={setArcTab}
          activeBlock={activeBlock} habits={habits} goals={goals} journalEntries={journalEntries}
          arcLedgerRows={arcLedgerRows}
          isPro={isPro} onUpgrade={() => setShowUpgrade(true)}
          userId={sessionUserId} userName={user.name || ""} coachName={coachName}
          onStartArc={openArcCoachCreate} onEditArc={openArcCoachEdit}
          onRunItBack={handleArcContinue} onEvolve={handleArcEvolve}
          onReflect={setReflectId} onDeleteJournalLog={handleDeleteJournalLogEntry}
          onSaveJournalEntry={handleSaveJournalEntry} onJournalGenerated={handleJournalGenerated}
          journalInitialTab={showJournalCompose ? "compose" : journalOpenTab ?? undefined}
          journalAutoGenerate={journalAutoGenerate}
          onJournalInitialComposeDone={() => { setShowJournalCompose(false); setJournalOpenTab(null); setJournalAutoGenerate(false); }}
          completedArcBlock={completedArcBlock}
        />}
        {screen === "social"   && <SocialScreen
          user={user} xp={xp} habits={habits}
          friends={friends} friendRequests={friendRequests} sentRequests={sentRequests} friendsLoading={friendsLoading}
          onSendRequest={sendFriendRequest} onAccept={acceptFriendRequest}
          onDecline={declineFriendRequest} onRemoveFriend={removeFriend} onCancelSentRequest={cancelFriendRequest}
          sharedGoals={sharedGoals} sharedGoalsLoading={sharedGoalsLoading}
          sharedGoalInvites={sharedGoalInvites}
          onAcceptGoalInvite={acceptSharedGoalInvite}
          onDeclineGoalInvite={declineSharedGoalInvite}
          currentUserId={sessionUserId}
          onDeleteSharedGoal={deleteSharedGoal}
          onNudgeFriend={sendNudge}
          onShareHabit={handleShareHabit}
          sharingHabitId={sharingHabitId}
          onToast={addToast}
          pendingInviteGoalId={pendingInviteGoalId}
          onClearPendingInvite={() => setPendingInviteGoalId(null)}
          betaLeaderboard={betaLeaderboard}
          leaderboardLoading={leaderboardLoading}
          myBetaRank={myBetaRank}
          betaTotalCount={betaTotalCount}
          betaTicker={betaTicker}
          isPro={isPro}
          onUpgrade={() => setShowUpgrade(true)}
        />}
        {screen === "profile"  && <ProfileScreen  user={user} xp={xp} habits={habits} isPro={isPro} stripeCustomerId={stripeCustomerId} refCode={refCode}
          authEmail={authEmail}
          onUpgrade={() => setShowUpgrade(true)}
          onUpdateUser={updates => {
            if (updates._clearData) { setHabits([]); setXp(0); setUser(u => ({...u})); return; }
            setUser(u => {
              const next = { ...u, ...updates };
              const profilePatch = { name: next.name };
              if (updates.avatarUrl !== undefined) profilePatch.avatar_url = updates.avatarUrl;
              if (updates.username !== undefined) {
                const raw = updates.username === "" || updates.username == null
                  ? null
                  : String(updates.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
                const stored = raw && raw.length > 0 ? raw : null;
                profilePatch.username = stored;
                next.username = stored || "";
              }
              if (updates.visibleToFriendsOfFriends !== undefined) {
                profilePatch.visible_to_friends_of_friends = !!next.visibleToFriendsOfFriends;
              }
              const prevFof = !!u.visibleToFriendsOfFriends;
              const prevUsername = u.username || "";
              const revertOnErr = updates.visibleToFriendsOfFriends !== undefined || updates.username !== undefined;
              void (async () => {
                const err = await syncProfile(profilePatch);
                if (err && revertOnErr) {
                  if (updates.visibleToFriendsOfFriends !== undefined) {
                    setUser(ux => ({ ...ux, visibleToFriendsOfFriends: prevFof }));
                  }
                  if (updates.username !== undefined) {
                    setUser(ux => ({ ...ux, username: prevUsername }));
                  }
                }
              })();
              return next;
            });
          }}
          onResetOnboarding={() => setOnboarded(false)}
          onPreviewOnboarding={() => setPreviewOnboarding(true)}
          previewNormalCoachGreeting={previewNormalCoachGreeting}
          onTogglePreviewNormalCoachGreeting={() => {
            const next = !previewNormalCoachGreeting;
            setPreviewNormalCoachGreeting(next);
            try { localStorage.setItem("forged_coach_preview_normal_greeting", next ? "1" : "0"); } catch { /* ignore */ }
          }}
          onReplayPageGuides={() => {
            // Dev-only: wipe the 4 page-guide seen flags so the first-time
            // AI bubble re-triggers on next visit to Today/Journal/Insights/
            // Social. Does not touch any user data. Scoped to the current
            // user id so other accounts on this device are unaffected. The
            // replay tick forces the guide effect to re-run even if we're
            // already on a guided screen.
            clearAllPageGuideSeen(sessionUserId);
            setPageGuide(null);
            setScreen("today");
            setPageGuideReplayTick(t => t + 1);
            addToast("AI page tour reset — visit Today, Arc, Social");
          }}
          onSignOut={handleSignOut}
          onShowTour={() => { setScreen("today"); setTimeout(() => { setTourSteps(GLOBAL_TOUR); setTourIdx(0); }, 120); }}
          coachName={coachName}
          coachIcon={coachIcon}
          voiceRepliesEnabled={voiceRepliesEnabled}
          coachVoiceId={coachVoiceId}
          onSaveVoicePrefs={({ voiceRepliesEnabled: vre, coachVoiceId: cvid }) => {
            setVoiceRepliesEnabled(!!vre);
            setCoachVoiceId(cvid || null);
            syncProfile({ voice_replies_enabled: !!vre, coach_voice_id: cvid || null });
          }}
          onSaveCoach={({ name, icon }) => {
            setCoachName(name);
            setCoachIcon(icon);
            syncProfile({ coach_name: name, coach_icon: icon });
          }}
          notifEnabled={notifEnabled}
          notifLoading={notifLoading}
          notifPermission={notifPermission}
          dailyRemindersEnabled={dailyRemindersEnabled}
          nudgesEnabled={nudgesEnabled}
          invitesEnabled={invitesEnabled}
          onNotifToggle={handleNotifToggle}
          onNotifCategoryChange={handleNotifCategoryChange}
          onOpenSocial={() => setScreen("social")}
          onOpenHub={() => setScreen("hub")}
        />}

        {/* Coach bar above nav (+ page guide / nudge / Today add). Hidden on Profile and while coach sheet open. */}
        {screen !== "profile" && (() => {
          const coachLabelRaw = (coachName ?? "").trim() || "Coach";
          const coachLabelShort = coachLabelRaw.length > 13 ? `${coachLabelRaw.slice(0, 12)}…` : coachLabelRaw;
          // Floating add only when no Arc is running — with an active Arc the
          // Arc-first surfaces own creation (proof actions on Today, Hub for
          // everything else). Avoids the global "Add habit" framing.
          const showTodayAdd =
            screen === "today" &&
            !activeBlock?.id &&
            (habits.length > 0 || goals.some(g => g.status !== "completed"));
          const habitColor = habits.find(h => h.habitType !== "log")?.color || T.accent;
          const showCoachBar =
            !showCoach && ["today", "arc", "social", "hub"].includes(screen);
          const safeBottom = "env(safe-area-inset-bottom, 0px)";
          const aboveNav = `calc(62px + ${safeBottom})`;
          const aboveCoachBar = `calc(132px + ${safeBottom})`;
          return (
            <>
              {!showCoach && (pageGuide?.page === screen || coachPageNudge) ? (
                <div
                  style={{
                    position:"fixed",
                    left:"max(14px, calc(50% - 201px))",
                    bottom:aboveCoachBar,
                    zIndex:102,
                    display:"flex",
                    flexDirection:"row",
                    alignItems:"flex-end",
                    justifyContent:"flex-start",
                    gap:10,
                    maxWidth:"calc(min(430px, 100vw) - 28px)",
                  }}
                >
                  {pageGuide && pageGuide.page === screen ? (
                    <div
                      key={`guide-${pageGuide.page}`}
                      role="dialog"
                      aria-label="Coach tip"
                      style={{
                        position:"relative",
                        maxWidth:260,
                        padding:"11px 30px 12px 14px",
                        borderRadius:"14px 14px 14px 4px",
                        background:"rgba(24,24,22,0.98)",
                        backdropFilter:"blur(12px)",
                        WebkitBackdropFilter:"blur(12px)",
                        border:"0.5px solid rgba(200,144,42,0.45)",
                        boxShadow:"0 6px 26px rgba(0,0,0,0.5)",
                        fontSize:12.5,
                        lineHeight:1.55,
                        color:T.text,
                        textAlign:"left",
                        animation:"coachGuideIn 0.42s cubic-bezier(0.22,1,0.36,1) both",
                        flexShrink:1,
                      }}
                    >
                      <div style={{
                        fontSize:9, fontWeight:700, color:T.gold,
                        textTransform:"uppercase", letterSpacing:"0.1em",
                        marginBottom:4,
                      }}>
                        {coachLabelShort}
                      </div>
                      <div>{pageGuide.text}</div>
                      <button
                        type="button"
                        onClick={() => {
                          writePageGuideSeen(sessionUserId, pageGuide.page);
                          setPageGuide(null);
                        }}
                        aria-label="Dismiss coach tip"
                        style={{
                          position:"absolute",
                          top:4, right:4,
                          width:22, height:22,
                          borderRadius:"50%",
                          border:"none",
                          background:"transparent",
                          color:T.muted,
                          fontSize:15,
                          lineHeight:1,
                          cursor:"pointer",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ) : coachPageNudge ? (
                    <div
                      key={coachPageNudge.id}
                      role="status"
                      aria-live="polite"
                      style={{
                        pointerEvents:"none",
                        maxWidth:200,
                        padding:"9px 12px",
                        borderRadius:12,
                        background:"rgba(24,24,22,0.96)",
                        backdropFilter:"blur(12px)",
                        WebkitBackdropFilter:"blur(12px)",
                        border:"0.5px solid rgba(200,144,42,0.32)",
                        boxShadow:"0 4px 22px rgba(0,0,0,0.38)",
                        fontSize:12,
                        lineHeight:1.45,
                        color:T.sub,
                        textAlign:"left",
                        animation:`coachNudge ${COACH_NUDGE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
                        userSelect:"none",
                        flexShrink:1,
                      }}
                    >
                      {coachPageNudge.text}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {showTodayAdd && (
                <button
                  type="button"
                  onClick={handleStartAdd}
                  aria-label="Add habit or goal"
                  title="Add habit or goal"
                  style={{
                    position:"fixed",
                    right:"max(14px, calc(50% - 201px))",
                    bottom:aboveCoachBar,
                    zIndex:102,
                    height:44,
                    padding:"0 14px 0 12px",
                    borderRadius:22,
                    border:"none",
                    background:T.accent,
                    color:"#fff",
                    fontSize:13,
                    fontWeight:700,
                    lineHeight:1,
                    cursor:"pointer",
                    boxShadow:"0 3px 14px rgba(192,57,43,0.32)",
                    display:"flex",
                    alignItems:"center",
                    justifyContent:"center",
                    gap:6,
                    fontFamily:T.font,
                  }}
                >
                  <span style={{ fontSize:18, fontWeight:700, lineHeight:1, marginTop:1 }} aria-hidden>+</span>
                  <span>Add</span>
                </button>
              )}
              {showCoachBar ? (
                <div
                  style={{
                    position:"fixed",
                    left:"50%",
                    transform:"translateX(-50%)",
                    width:"100%",
                    maxWidth:430,
                    bottom:aboveNav,
                    zIndex:101,
                    padding:"0 10px 0",
                    boxSizing:"border-box",
                  }}
                >
                  <CoachBar
                    coachName={coachName}
                    coachIcon={coachIcon}
                    habitColor={habitColor}
                    onOpenMic={() => openCoachWithMode("mic")}
                    onOpenText={() => openCoachWithMode("text")}
                    coachEverOpened={coachEverOpened}
                  />
                </div>
              ) : null}
            </>
          );
        })()}

        {/* Bottom nav */}
        <nav data-tour="nav" style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:430, maxWidth:"100vw", background:"linear-gradient(180deg, rgba(38,38,34,0.98) 0%, rgba(22,22,19,0.99) 100%)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", borderTop:`1px solid rgba(200,144,42,0.2)`, boxShadow:"0 -6px 32px rgba(0,0,0,0.5)", display:"flex", zIndex:100, paddingTop:8, paddingBottom:"max(11px, env(safe-area-inset-bottom, 0px))" }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setScreen(n.id)} style={{ flex:1, padding:"9px 4px 6px", border:"none", background:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, fontSize:10, fontWeight:600, color:screen===n.id?T.accent:T.muted, letterSpacing:"0.02em", transition:"color 0.15s" }}>
              {n.icon}{n.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Modals */}
      {showArcCoach && (
        <ArcCoachSheet
          key={`arc-coach-${arcCoachMode}-${arcCoachSeed?.type || "none"}-${arcCoachSeed?.block?.id || "new"}`}
          mode={arcCoachMode}
          activeBlock={arcCoachMode === "edit" ? activeBlock : null}
          seedArc={arcCoachSeed}
          onClose={() => {
            setArcProofSyncing(false);
            setArcCoachSeed(null);
            setShowArcCoach(false);
            setArcSetupFromCoach(false);
            setShowArcSetup(false);
          }}
          onUseFormInstead={() => {
            setArcSetupFromCoach(true);
            setShowArcSetup(true);
          }}
          onSyncStart={() => setArcProofSyncing(true)}
          onCreated={(payload) => handleArcCoachCreated(
            payload,
            arcCoachMode === "edit" ? "✓ Arc updated" : "✓ Arc started",
          )}
          userId={sessionUserId}
          existingHabits={habits}
          coachName={coachName}
          coachIcon={coachIcon}
          name={user.name || "there"}
          supabase={supabase}
        />
      )}
      {showArcSetup && (
        <ArcSetupSheet
          openedFromCoach={arcSetupFromCoach}
          onClose={() => {
            setArcProofSyncing(false);
            setShowArcSetup(false);
            setArcSetupFromCoach(false);
          }}
          onCancelToChat={arcSetupFromCoach ? () => {
            setShowArcSetup(false);
            setArcSetupFromCoach(false);
          } : undefined}
          onSyncStart={() => setArcProofSyncing(true)}
          onCreated={async (payload) => {
            const blockRow = payload?.block ?? payload;
            const linkedIds = payload?.linkedIds ?? [];
            if (blockRow) setActiveBlock(rowToForgeBlock(blockRow));
            if (linkedIds.length && blockRow?.id) {
              setHabits(prev => prev.map(h =>
                linkedIds.includes(h.id)
                  ? { ...h, blockId: blockRow.id, isProofAction: true }
                  : h,
              ));
            }
            setArcProofSyncing(false);
            setShowArcSetup(false);
            setArcSetupFromCoach(false);
            setShowArcCoach(false);
            addToast("✓ Arc started");
            void reloadForgeBlocks();
          }}
          userId={sessionUserId}
          existingHabits={habits}
          supabase={supabase}
        />
      )}
      {showAdd       && <AddModal      onClose={() => setShowAdd(false)}     onSave={handleAddHabit} habitCount={habits.length}/>}
      {showAddGoal   && <AddGoalModal  onClose={() => setShowAddGoal(false)} onSave={handleAddGoal}/>}
      {showAddLog    && <AddLogModal   onClose={() => setShowAddLog(false)} onSave={async h => {
        if (demoBounce()) return;
        const saved = await syncHabit(h);
        if (!saved) {
          addToast("⚠️ Couldn't add log — check your connection");
          return;
        }
        setHabits(p => [...p, h]);
        setShowAddLog(false);
        addToast("✓ Log added");
      }}/>}
      {showAddChoice && <AddActionSheet onAddHabit={() => {
        setShowAddChoice(false);
        // Enforce Pro gate: free users capped at 5 habits. Without this,
        // users on the Today screen could bypass the paywall entirely by
        // going through the Add action sheet instead of the Habits tab.
        if (!isPro && habits.length >= 5) setShowUpgrade(true);
        else setShowAdd(true);
      }} onAddGoal={() => { setShowAddChoice(false); setShowAddGoal(true); }} onAddLog={() => { setShowAddChoice(false); setJournalAutoGenerate(false); setShowJournalCompose(true); navigateTo("arc"); }} onClose={() => setShowAddChoice(false)}/>}
      {showCoachTeaser && <CoachComingSoonSheet onClose={() => setShowCoachTeaser(false)} coachName={coachName} context={screen}/>}
      {logGoalId     && (() => { const g = resolveGoalForModal(logGoalId, goals, habits); return g ? <LogGoalModal goal={g} onClose={() => setLogGoalId(null)} onLog={(id, val, note) => { handleLogGoal(id, val, note); setLogGoalId(null); }}/> : null; })()}
      {editGoalId    && (() => { const g = resolveGoalForModal(editGoalId, goals, habits); return g ? <EditGoalModal goal={g} onClose={() => setEditGoalId(null)} onSave={handleEditGoalSave}/> : null; })()}
      {openGoalId    && (() => { const g = resolveGoalForModal(openGoalId, goals, habits); return g ? <GoalDetailSheet goal={g} habits={habits} onClose={() => setOpenGoalId(null)} onLog={id => { setOpenGoalId(null); setLogGoalId(id); }} onEdit={id => { setOpenGoalId(null); openEditGoal(id); }} onComplete={handleCompleteGoal} onDelete={id => { handleDeleteGoal(id); setOpenGoalId(null); }} onCheckin={handleGoalCheckin} onLinkHabits={handleGoalLinkHabits}/> : null; })()}
      {showHistory   && <HistoryModal  habits={habits} isPro={isPro} onUpgrade={() => setShowUpgrade(true)} onClose={() => setShowHistory(false)}/>}
      {reflectId     && <ReflectModal  habit={reflectHabit}                  onClose={() => setReflectId(null)} onSave={handleSaveReflection}/>}
      {editId && !editGoalId && editHabit && !isGoalLikeHabitType(editHabit) && <EditModal habit={editHabit} onClose={() => setEditId(null)} onSave={handleEditSave}/>}
      {logId && logHabit?.habitType === "project"  && <LogProjectModal   habit={logHabit} onClose={() => setLogId(null)} onLog={handleLog}/>}
      {showCoach   && <AICoach key={sessionUserId || "anon"} openInputMode={coachOpenMode}
          pendingMessage={coachPendingMsg}
          draftInput={coachDraftInput}
          habits={habits} goals={goals} user={user} isPro={isPro} activeBlock={activeBlock}
          onOpenEditArc={openArcCoachEdit}
          onClose={() => {
            setShowCoach(false);
            setCoachOpenMode(null);
            setCoachPendingMsg(null);
            setCoachDraftInput(null);
            proofCoachLaunchRef.current = false;
            proofActionLinkNextRef.current = false;
          }}
          onUpgrade={() => setShowUpgrade(true)} coachName={coachName}
          coachIcon={coachIcon}
          coachAccentColor={habits.find(h => h.habitType !== "log")?.color || T.accent}
          currentScreen={screen}
          onNavigateTo={navigateTo}
          onHabitCreated={h => {
            setHabits(p => p.some(x => String(x.id) === String(h.id)) ? p.map(x => String(x.id) === String(h.id) ? h : x) : [...p, h]);
            if (proofActionLinkNextRef.current && activeBlock?.id && h?.id) {
              proofActionLinkNextRef.current = false;
              void linkHabitAsProof(h.id);
            }
          }}
          onGoalCreated={g   => setGoals(p  => p.some(x => String(x.id) === String(g.id)) ? p.map(x => String(x.id) === String(g.id) ? g : x) : [...p, g])}
          previewNormalCoachGreeting={previewNormalCoachGreeting}
          onCoachLogsApplied={applyCoachLogsBatch}
          onHabitRenamed={(id, name) => setHabits(p => p.map(h => String(h.id) === String(id) ? { ...h, name } : h))}
          onGoalPlanConfirm={handleGoalPlanConfirm}
          journalEntries={journalEntries}
          voiceRepliesEnabled={voiceRepliesEnabled}
          coachVoiceId={coachVoiceId}
          coachMemory={coachMemory ? {
            content: coachMemory.content,
            // Free: current-Arc depth (last 3 days). Pro: full 7-day window
            // (plus the recall tool server-side for older context).
            recentSummaries: (coachMemory.recentSummaries || []).slice(isPro ? -7 : -3),
          } : null}
          onJournalLogged={entries => {
            // Re-fetch journal entries after AI writes so the Journal tab reflects it immediately
            const uid = userIdRef.current;
            if (uid) {
              supabase.from("journal_entries").select("id, date, content, daily_context, is_ai_generated, manually_edited, created_at, updated_at")
                .eq("user_id", uid).order("date", { ascending: false })
                .then(({ data: jRows }) => { if (jRows) setJournalEntries(jRows); });
            }
          }}
          onWrapToday={async () => {
            setShowCoach(false);
            setCoachOpenMode(null);
            setCoachPendingMsg(null);
            setCoachDraftInput(null);
            proofCoachLaunchRef.current = false;
            proofActionLinkNextRef.current = false;
            const ok = await handleGenerateReceipt();
            addToast(ok ? "Entry added to today's Arc." : "Couldn't create entry — try again from Today.");
          }}
        />}

      {completedArcBlock?.id && !activeBlock?.id && !hasDecidedArc(completedArcBlock.id) && (
        <ArcCompletedSheet
          block={completedArcBlock}
          userName={user.name || ""}
          onStoryGenerated={(blockRow) => handleArcStoryGenerated(blockRow)}
          onContinue={() => handleArcContinue(completedArcBlock)}
          onEvolve={() => handleArcEvolve(completedArcBlock)}
          onClose={() => handleArcClose(completedArcBlock)}
        />
      )}
      {showUpgrade && <BetaPaywallModal onClose={() => setShowUpgrade(false)}/>}
      {showShare && <ShareCardModal user={user} habits={habits} xp={xp} onClose={() => setShowShare(false)}/>}
      {showWelcome && (
        <WelcomeModal onContinue={() => { setShowWelcome(false); setShowProFollowup(true); }} />
      )}
      {showProFollowup && (
        <ProThankYouModal userId={sessionUserId} onClose={() => setShowProFollowup(false)} />
      )}
      {/* TourOverlay disabled — restore tourSteps state and this block to re-enable */}
    </>
  );
}
