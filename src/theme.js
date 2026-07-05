// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
export const T = {
  bg:"#0F0F0D", surface:"#1A1A16", raised:"#222220",
  border:"rgba(255,255,255,0.07)", borderMid:"rgba(255,255,255,0.12)", borderStrong:"rgba(255,255,255,0.16)",
  text:"#F0EDE6", sub:"#A8A49C", muted:"#82807A", hint:"#4E4E4A",
  accent:"#C0392B", gold:"#C8902A", goldBright:"#F5C842", green:"#27AE60", amber:"#E67E22",
  r:16, rsm:10,
  font:"'DM Sans',system-ui,sans-serif",
  serif:"'DM Serif Display',Georgia,serif",
};

export const COLORS = ["#C0392B","#E67E22","#27AE60","#8E44AD","#2980B9","#C8902A","#16A085","#D4537E"];

/** Profile / floating coach button — preset icons only (must match CoachSettingsSheet). */
export const COACH_ICON_OPTIONS = [
  "✦", "⚡", "🔥", "🛡️", "⚔️", "👻",
  "🌟", "✨", "💎", "🎯", "🦁", "🦉",
  "🐺", "☀️", "🌙", "⭐", "🤖", "💫",
  "🌿", "🔮", "🏔️", "🧠", "🎭", "❤️",
  "🦅", "🌊", "☄️", "🎵", "📿", "🕯️",
  "🐻", "🦊", "🐉", "🦄", "🦋", "🍀",
  "🌴", "⛰️", "🧘", "🥊", "🏹", "🎸",
  "🦾", "🧝", "🧙", "🕊️", "⚓", "🜂",
];

/** Display name (Profile + onboarding) — keep in sync with CoachSettingsSheet / ProfileScreen. */
export const PROFILE_DISPLAY_NAME_MAX = 24;
/** AI coach name — keep headers and coach bar readable on mobile. */
export const PROFILE_COACH_NAME_MAX = 32;

export function clampProfileDisplayName(s) {
  return String(s ?? "").trim().slice(0, PROFILE_DISPLAY_NAME_MAX);
}

export function clampProfileCoachName(s) {
  const t = String(s ?? "").trim().slice(0, PROFILE_COACH_NAME_MAX);
  return t || "Companion";
}

export const HABIT_TYPES = {
  daily:    { label:"Daily habit",    desc:"One tap per day (e.g. meditate, read, cold shower).",      icon:"✓"  },
  weekly:   { label:"Weekly target",  desc:"Hit a session count each week (e.g. gym 4x, run 3x).",     icon:"📅" },
  project:  { label:"Build",          desc:"Log time spent and progress (e.g. side project, learning a skill).", icon:"⚒️" },
  limit:    { label:"Limit / reduce", desc:"Stay under a daily cap (drinks, snacks, screen time). For “reach X kg” or savings targets, use Set a goal — that's an outcome, not a daily cap.",   icon:"🎯" },
  log:      { label:"Log",            desc:"Simple dated notes — journal-style, no streaks or targets.", icon:"📝" },
};

export const XP_LEVELS = [
  { min:0,    label:"Unforged",  color:"#B8B6AC", meaning:"Just getting started" },
  { min:500,  label:"Kindling",  color:"#C8902A", meaning:"The habit is catching" },
  { min:1500, label:"Tempered",  color:"#E67E22", meaning:"Consistency is building" },
  { min:3000, label:"Hardened",  color:"#C0392B", meaning:"This is becoming who you are" },
  { min:6000, label:"Forged",    color:"#F5C842", meaning:"Identity-level commitment" },
];

// ─── DATE UTILS ───────────────────────────────────────────────────────────────
export const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Safe-area padding for iOS notch / Dynamic Island / home indicator.
 * Requires `viewport-fit=cover` (see index.html).
 */
export function cssPadTopSafe(basePx) {
  return `calc(${basePx}px + env(safe-area-inset-top, 0px))`;
}
export function cssPadXSafe(basePx) {
  return {
    paddingLeft: `max(${basePx}px, env(safe-area-inset-left, 0px))`,
    paddingRight: `max(${basePx}px, env(safe-area-inset-right, 0px))`,
  };
}
export function cssPadBottomSafe(basePx) {
  return `max(${basePx}px, env(safe-area-inset-bottom, 0px))`;
}

// ── Deep-insights cache TTL ───────────────────────────────────────────────────
export const WEEKLY_SUMMARY_TTL_MS  = 24 * 60 * 60 * 1000; // generated summary cached 24h

// ─── AI COACH ─────────────────────────────────────────────────────────────────
export const CREATOR_ID = "5e9b4ba7-bf15-4e94-ab05-fe3306496973";
export const FREE_DAILY_LIMIT = 5;

/**
 * ElevenLabs premade voices — Pro spoken replies only. Companion-style
 * names (not generic mood words, not human first names) so the picker
 * reads as "pick a character," not "pick a mood" or "pick a person."
 *
 * All four are male, per direct request. The previous roster had two
 * generic-labeled entries ("Calm", "Grounded") that were actually
 * ElevenLabs' "Sarah" and "Rachel" — both female voices, mislabeled in a
 * way that hid that. Swapped out for two more ElevenLabs default male
 * voices instead.
 *
 * Atlas (George) and Vale (Daniel) are both already live in this app and
 * confirmed working. Orion (Antoni) and Echo (Josh) are NEW this round —
 * their voice IDs are recalled from training knowledge of ElevenLabs'
 * long-standing premade voice library (these are commonly-referenced,
 * globally-available premade IDs, not account-specific), but have NOT been
 * verified against a live ElevenLabs call in this sandbox. Test both by
 * ear before trusting them; if either is wrong, ElevenLabs' Voice Library
 * (elevenlabs.io → Voices) lists the correct ID for any premade voice by
 * name, or generates a 4xx from api/tts.js immediately if the ID is bad.
 *
 * NOTE: ElevenLabs' default-voice library (all 4 of these IDs) is
 * documented as retiring end of 2026 — worth revisiting voice IDs well
 * before then rather than discovering it's broken on the day.
 */
export const COACH_VOICE_OPTIONS = [
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "Atlas", desc: "Warm, steady presence" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Vale",  desc: "Measured and deliberate" },
  { id: "ErXwobaYiN019PkySvjV", label: "Orion", desc: "Easygoing, natural tone" }, // Antoni — unverified in this sandbox, test by ear
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Echo",  desc: "Deep, grounded voice" },   // Josh — unverified in this sandbox, test by ear
];

/**
 * Matches the real ElevenLabs free-tier account limit (10,000 chars/mo) —
 * this app currently runs on a single shared free-tier ElevenLabs account,
 * so the app's own per-user cap has to fit inside that real ceiling, not an
 * assumed paid-tier number. Was wrongly set to 50,000 (~$2.50 COGS math
 * that only applies on a paid plan) — corrected after confirming the
 * account is actually still on the free 10k/mo tier. Enforced server-side
 * in api/tts.js; also the fallback default in api/tts-usage.js.
 */
export const TTS_MONTHLY_CHAR_LIMIT = 10000;

/**
 * Live Stripe prices stay on env price IDs ($4.99/mo today).
 * Future pricing is wired but inactive until PRO_PRICING.useFuturePricing = true.
 */
export const PRO_PRICING = {
  monthlyCents: 499,
  annualCents: 3999,
  futureMonthlyCents: 799,
  futureAnnualCents: 5999,
  useFuturePricing: false,
};

// ─── COACH PAGE NUDGES ────────────────────────────────────────────────────────
export const COACH_PAGE_NUDGES = {
  today: "Need help logging today quickly?",
  journal: "Want help making sense of your recent entries?",
  insights: "Want a deeper read on your progress?",
  social: "Want to invite someone to hold you accountable on a specific habit?",
};

// ─── FIRST-TIME AI PAGE GUIDE ─────────────────────────────────────────────────
export const PAGE_GUIDE_PAGES = ["today", "arc", "social"];

// ─── CSS ──────────────────────────────────────────────────────────────────────
export const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: ${T.bg}; -webkit-tap-highlight-color: transparent; }
  ::-webkit-scrollbar { width: 0; }
  textarea, input, button { font-family: ${T.font}; }
  textarea:focus, input:focus { outline: none; }
  @keyframes burst {
    0%   { transform: translate(0,0) scale(1); opacity: 1; }
    100% { transform: translate(var(--dx),var(--dy)) scale(0); opacity: 0; }
  }
  @keyframes xpUp {
    0%   { transform: translateY(0); opacity: 1; }
    100% { transform: translateY(-38px); opacity: 0; }
  }
  @keyframes fadeUp {
    from { transform: translateY(8px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes toastSlide {
    from { transform: translateY(20px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes savedFade {
    0%   { opacity: 0; transform: translateY(2px); }
    20%  { opacity: 1; transform: translateY(0); }
    70%  { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
  @keyframes journalFadeIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }
  @keyframes coachRowIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: none; } }
  @keyframes coachToastIn { from { opacity:0; transform: translateY(-8px); } to { opacity:1; transform: none; } }
  @keyframes coachNudge {
    0%   { opacity: 0; transform: translateY(10px) scale(0.97); }
    9%   { opacity: 1; transform: translateY(0) scale(1); }
    82%  { opacity: 1; transform: translateY(0) scale(1); }
    100% { opacity: 0; transform: translateY(5px) scale(0.99); }
  }
  @keyframes coachGuideIn {
    0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes coachFabPulse {
    0%, 100% { box-shadow: 0 2px 14px rgba(0,0,0,0.4), 0 0 0 0 rgba(200,144,42,0.45); }
    50%      { box-shadow: 0 2px 14px rgba(0,0,0,0.4), 0 0 0 8px rgba(200,144,42,0); }
  }
  @keyframes coachFabSheen {
    0%   { background-position: -120px 0; }
    100% { background-position: 120px 0; }
  }
  .tap:active { transform: scale(0.86) !important; }
  .rc { transition: border-color 0.2s, background 0.2s; }
  .rc:hover { border-color: ${T.borderMid} !important; }
  @keyframes tourSlide {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes shareSlide {
    from { transform: scale(0.95); opacity: 0; }
    to   { transform: scale(1); opacity: 1; }
  }
  @keyframes recBar {
    0%, 100% { transform: scaleY(0.35); }
    50%      { transform: scaleY(1);    }
  }
  @keyframes recDotPulse {
    0%, 100% { transform: scale(1);    opacity: 0.85; }
    50%      { transform: scale(1.35); opacity: 1;    }
  }
  @keyframes recBarSlide {
    from { transform: translateY(6px); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }
  @keyframes focusCheckPop {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1);    opacity: 1; }
  }
  @keyframes coachRefreshSpin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
`;
