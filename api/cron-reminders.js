import webpush from "web-push";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Calendar dates in the user's IANA timezone (must match client `todayStr()` semantics) ──

function ymdNowInTimeZone(timeZone) {
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

/**
 * Current hour + minute (0..23 / 0..59) in the user's IANA timezone. Used by
 * the windowed sender so each user gets their daily reminder during the
 * 5-minute window they chose.
 */
function hourMinuteNowInTimeZone(timeZone) {
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find(p => p.type === "hour")?.value, 10);
    const m = parseInt(parts.find(p => p.type === "minute")?.value, 10);
    return {
      hour: Number.isFinite(h) ? h % 24 : 0,
      minute: Number.isFinite(m) ? m : 0,
    };
  } catch {
    const now = new Date();
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

/** Parse "HH:MM" → { hour 0..23, minute 0..59 }, falling back to 18:00. */
function parseReminderTime(reminderTime) {
  if (typeof reminderTime !== "string") return { hour: 18, minute: 0 };
  const [hStr, mStr] = reminderTime.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  return {
    hour:   Number.isFinite(h) && h >= 0 && h <= 23 ? h : 18,
    minute: Number.isFinite(m) && m >= 0 && m <= 59 ? m : 0,
  };
}

/** Floor a minute (0..59) into a 5-minute bucket: 0,5,10,…,55. */
const BUCKET_MIN = 5;
function bucketMinute(m) { return Math.floor(m / BUCKET_MIN) * BUCKET_MIN; }

function addCalendarDays(ymd, deltaDays) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  const u = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(u);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function daysAgoFrom(ymd, n) {
  return addCalendarDays(ymd, -n);
}

/** Monday-start week containing ymd (matches client `weekStartFor`). */
function weekStartMondayFromYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0
  const back = day === 0 ? 6 : day - 1;
  return addCalendarDays(ymd, -back);
}

function daysBetween(fromStr, toStr) {
  return Math.round((new Date(toStr) - new Date(fromStr)) / 86400000);
}

function forgeBlockDayNumber(block, todayYmd) {
  if (!block?.start_date || !DATE_RE.test(block.start_date)) return 1;
  const elapsed = daysBetween(block.start_date, todayYmd);
  return Math.max(1, elapsed + 1);
}

const ARC_PAUSE_SUFFIX = "_arc_pause";

// ── Row shape (snake_case from Supabase) ───────────────────────────────────────

function getLimitDayTotal(h, dateStr) {
  const dayLogs = (h.logs || []).filter(l => l.date === dateStr && typeof l.value === "number");
  if (!dayLogs.length) return null;
  return dayLogs.reduce((s, l) => s + l.value, 0);
}

function getBuildDayMinutes(h, dateStr) {
  return (h.logs || [])
    .filter(l => l.date === dateStr)
    .reduce((s, l) => s + (l.value?.minutes || 0), 0);
}

function qualifiesBuildDay(h, dateStr) {
  const targetMins = h.daily_target_minutes ?? 60;
  return getBuildDayMinutes(h, dateStr) >= targetMins;
}

function hasDailyCompletion(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr && l.value === true);
}

function hasRestDay(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr && l.value === "skip");
}

function hasAnyLogOnDate(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr);
}

/** Matches client `isSatisfiedForTodayRing` for non-log habits (Today ring %). */
function forgedRingSatisfiedTodayRow(h, todayYmd) {
  if (h.habit_type === "log") return false;
  const logs = h.logs || [];
  if (h.habit_type === "weekly") {
    const target = Math.max(1, Number(h.weekly_target) || 1);
    if (hasRestDay(h, todayYmd)) return true;
    const ws = weekStartMondayFromYmd(todayYmd);
    const weekEnd = addCalendarDays(ws, 6);
    const count = logs.filter(l => l.date >= ws && l.date <= weekEnd && l.value === true).length;
    if (count >= target) return true;
    return logs.some(l => l.date === todayYmd && l.value === true);
  }
  if (h.habit_type === "daily") {
    return hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd);
  }
  return hasAnyLogOnDate(h, todayYmd);
}

/**
 * Stricter "real progress today" for AI copy — aligns with the Today forged ring
 * (weekly: session, rest day, or weekly target already met).
 */
function strictLoggedProgressToday(h, todayYmd) {
  if (h.habit_type === "log") return false;
  const logs = h.logs || [];

  if (h.habit_type === "daily") {
    return hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd);
  }
  if (h.habit_type === "weekly") {
    return forgedRingSatisfiedTodayRow(h, todayYmd);
  }
  if (h.habit_type === "project") {
    return qualifiesBuildDay(h, todayYmd);
  }
  if (h.habit_type === "limit") {
    const total = getLimitDayTotal(h, todayYmd);
    if (total == null) return false;
    return total <= (h.daily_budget ?? Infinity);
  }
  return false;
}

/** Daily streak ending at yesterday if today not yet completed (matches client `getDailyStreak`). */
function getDailyStreak(h, todayYmd) {
  const logs = h.logs || [];
  const startDay = hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd) ? 0 : 1;
  let streak = 0;
  for (let d = startDay; d <= 365; d++) {
    const dateStr = daysAgoFrom(todayYmd, d);
    if (hasDailyCompletion(h, dateStr) || hasRestDay(h, dateStr)) streak++;
    else break;
  }
  return streak;
}

// ── Normal-user fixed send hours ───────────────────────────────────────────────

function isWeekend(todayYmd) {
  const day = new Date(todayYmd + "T12:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}


// ── Normal-user fixed send hours ───────────────────────────────────────────────
// Every regular user gets a notification at these three local-time hours per day
// (instead of their configured reminder_time). The cron's 5-minute windowed check
// filters to :00 buckets at these hours only.
const NORMAL_FIRE_HOURS = [7, 12, 19];

/** Map a local hour → the slot label used for dedup keys and pool selection. */
function normalUserSlot(hour) {
  if (hour < 11) return "morning";
  if (hour < 16) return "noon";
  return "evening";
}

// ── Normal-user message pools ─────────────────────────────────────────────────
// Tone: coach-voiced, direct, warm — not a generic app notification.
// Use {coach} where the coach name should appear — replaced at send time.
// Evening pool splits on whether the user has logged anything today.
const NORMAL_POOLS = {
  morning: {
    weekday: [
      "Morning. What's the one thing worth protecting today? — {coach}",
      "New day. Don't over-plan it — pick the thing that matters and go. — {coach}",
      "Morning. Before the noise starts — how are you feeling? — {coach}",
      "Up and at it. Make today count for the things that actually matter. — {coach}",
      "Morning. Yesterday's behind you — what are you building today? — {coach}",
      "Good morning. One clear focus beats ten half-measures. — {coach}",
      "Morning. Small move now beats a perfect plan later. — {coach}",
      "Hey — hope you slept well. What's the priority today? — {coach}",
      "Morning. You know what needs doing. Trust that and get started. — {coach}",
      "New day ahead. Set the tone early — it carries through everything after. — {coach}",
      "Morning. Even one good decision at the start shapes the whole day. — {coach}",
      "Up. What matters most today? Lead with that. — {coach}",
      "Morning. The day's yours to shape — start with intent. — {coach}",
      "Hey — new day, clean slate. Make it yours. — {coach}",
      "Morning. Quiet start beats a frantic one. What's the one thing? — {coach}",
    ],
    weekend: [
      "Morning. Free day — still worth making it count. — {coach}",
      "Weekend morning. Slower pace is fine. Same standard. — {coach}",
      "Morning. Rest if you need it, move if you want to — either's a good call. — {coach}",
      "Hey — hope the weekend's off to a good start. What's the plan? — {coach}",
      "Morning. One good thing today is enough. Go find it. — {coach}",
      "Weekend morning. No alarm, no pressure — just make it a good one. — {coach}",
      "Morning. Whatever the weekend holds — make it intentional. — {coach}",
      "Hope the weekend's starting well. What are you doing with the day? — {coach}",
      "Free day ahead. Do something worth remembering. — {coach}",
      "Morning. Weekends are for recharging — do it properly. — {coach}",
    ],
  },
  noon: {
    weekday: [
      "Quick check-in. How's the day actually going? — {coach}",
      "Halfway point. Anything worth logging before the afternoon takes over? — {coach}",
      "Still on track, or has the day gone sideways? — {coach}",
      "Midday. How's the energy holding up? — {coach}",
      "Quick one — is the day going the way you planned? — {coach}",
      "Lunchtime. A quick log now means you won't be scrambling tonight. — {coach}",
      "Midday check-in. What's been the best part of the morning? — {coach}",
      "Noon. Halfway through — how's it looking? — {coach}",
      "Quick midday check. If the morning was rough, the afternoon can turn it around. — {coach}",
      "Lunchtime. Take a breath, log what you've done, finish strong. — {coach}",
      "Hey — how's the day shaping up? — {coach}",
      "Midday. Log what's done, then get back to it. — {coach}",
      "Quick check-in. Morning behind you, afternoon ahead. How are you doing? — {coach}",
    ],
    weekend: [
      "Midday check-in. How's the weekend going so far? — {coach}",
      "Lunchtime. What have you been up to this morning? — {coach}",
      "Hope the weekend's treating you well. Quick log whenever it suits. — {coach}",
      "Noon on a free day. How's the energy? — {coach}",
      "Lunchtime. Log what you've got and enjoy the rest of the afternoon. — {coach}",
      "Midday. Whatever you got up to this morning — worth logging. — {coach}",
      "Quick midday check. Weekend's half gone — making it count? — {coach}",
      "Hey — hope the morning was a good one. How's the day going? — {coach}",
    ],
  },
  evening: {
    // Used when the user has already logged something today — affirming, no push.
    logged: {
      weekday: [
        "You showed up today. Rest well. — {coach}",
        "Good work today. Whatever happened — you kept going. — {coach}",
        "Day done. You logged it — that matters more than it feels like. — {coach}",
        "You made it through another one. Get some rest. — {coach}",
        "Solid day. Take the evening and let it settle. — {coach}",
        "You put in the work. Now switch off properly. — {coach}",
        "Day's behind you. You showed up — that's the whole thing. — {coach}",
        "Good day of progress. Rest, recharge, go again. — {coach}",
        "Everything logged. Rest well tonight. — {coach}",
        "You stayed with it today. That's what it takes. — {coach}",
      ],
      weekend: [
        "Good weekend day. Rest properly tonight. — {coach}",
        "Weekend done well. Get some rest. — {coach}",
        "You showed up even on a free day. That's the standard. — {coach}",
        "Good work this weekend. Recharge properly — week starts again soon. — {coach}",
        "Logged and done. Good weekend. — {coach}",
        "Free day well spent. Rest up. — {coach}",
        "You kept the thread going this weekend. Well done. — {coach}",
        "Good one today. Rest well — you've earned it. — {coach}",
      ],
    },
    // Used when the user hasn't logged anything today — warm nudge to capture the day.
    unlogged: {
      weekday: [
        "Before the day disappears — drop it here. One minute is enough. — {coach}",
        "Quick voice dump before bed? The day only happens once. — {coach}",
        "You don't need a perfect log. Just tell me what happened and I'll sort it. — {coach}",
        "Don't let today slip through unrecorded. Even a rough day is worth logging. — {coach}",
        "Whatever happened today — write it down. Future you will want to know. — {coach}",
        "Day's almost gone. Capture it before it fades. — {coach}",
        "End of the day — how did it actually go? Log it before you switch off. — {coach}",
        "Before you wind down — a quick dump of the day. It only takes a minute. — {coach}",
        "One minute before bed. What happened today? Log it and let it go. — {coach}",
        "The day only happens once. Capture it while it's fresh. — {coach}",
        "Still time to log the day. Even a rough one is worth recording. — {coach}",
        "Evening check-in. How did today actually go? — {coach}",
      ],
      weekend: [
        "Before the weekend fades — drop what happened here. One minute is enough. — {coach}",
        "Weekend evening. Log the day before the memory fades. — {coach}",
        "How was it? Log it before you drift off — takes about a minute. — {coach}",
        "Whatever the day held — rest day, adventure, or just life — log it. — {coach}",
        "End of a free day. Capture it before it slips away. — {coach}",
        "Quick log before bed? The weekend only happens once too. — {coach}",
        "Log the weekend day before you wind down. You'll be glad you did. — {coach}",
        "Evening. Whatever today was — log it and rest well. — {coach}",
      ],
    },
  },
};

// Shown when every habit is already logged for the day — short, affirming, no fanfare.
const NORMAL_ALL_LOGGED = [
  "Everything in today. Rest well. — {coach}",
  "All logged. You did the work — now switch off properly. — {coach}",
  "Clean day. That's how it's done. — {coach}",
  "All habits in. Get some rest. — {coach}",
  "Locked in today. Rest up. — {coach}",
  "Everything logged. Good day. — {coach}",
];

/**
 * Resolve the {coach} placeholder in a message body.
 * Falls back to "Forged" if no coach name is set.
 */
function applyCoachName(body, coachName) {
  return body.replace(/\{coach\}/g, coachName || "Forged");
}

/** Trim an Arc identity sentence down to something that fits inline in a push body. */
function identityShortPhrase(identity) {
  const idt = String(identity || "").trim();
  if (!idt) return "";
  return idt.length > 56 ? idt.slice(0, 53) + "…" : idt;
}

/**
 * Message picker for normal users — time-slot aware, weekday/weekend aware,
 * coach-name personalised. Evening slot branches on whether the user has
 * logged anything today. Urgent goal deadlines surface as contextual copy.
 */
function pickNormalMessage(habits, goals, todayYmd, localHour, coachName, arcBlock = null) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );

  const resolve = body => applyCoachName(body, coachName);
  const weekend = isWeekend(todayYmd);
  const slot = normalUserSlot(localHour ?? 7);
  const poolKey = weekend ? "weekend" : "weekday";
  const dateSeed = parseInt(todayYmd.replace(/-/g, ""), 10);
  const seed = dateSeed * 11 + (localHour ?? 0) * 7;

  // ── Arc-aware path ─────────────────────────────────────────────────────────
  // When an active Arc exists, prefer Arc-framed copy over the legacy
  // goal-deadline templates (e.g. "Gain Weight is due in 5 days"). The
  // legacy goal block only fires when no Arc is active so existing users
  // without an Arc keep their previous experience.
  const arcActive = !!arcBlock?.identity;
  const arcDayX = arcActive ? forgeBlockDayNumber(arcBlock, todayYmd) : 0;
  const arcDur = arcActive ? (arcBlock.duration_days || 56) : 56;
  const proofRows = arcActive
    ? trackableHabits.filter(h => h.is_proof_action === true && h.block_id === arcBlock.id)
    : [];
  const proofTotal = proofRows.length;
  const proofDone = proofRows.filter(h => forgedRingSatisfiedTodayRow(h, todayYmd)).length;
  const proofPending = Math.max(0, proofTotal - proofDone);
  const minimum = arcActive ? (arcBlock.minimum_proof || "").trim() : "";

  // All proof actions done — short, affirming.
  if (arcActive && proofTotal > 0 && proofDone === proofTotal) {
    const lines = [
      `Day ${arcDayX} — all proof shown. Clean day. — {coach}`,
      `Day ${arcDayX}/${arcDur}. Proof's in. — {coach}`,
      `Day ${arcDayX}. Banked it. — {coach}`,
    ];
    return { title: "Forged", body: resolve(lines[Math.abs(seed) % lines.length]) };
  }

  // Evening + no proof yet + minimum on file — the genuine peak-risk moment.
  // Worth a sharper, identity-confronting line here specifically — this is
  // the one slot per day where someone is actually about to lose the day.
  if (arcActive && slot === "evening" && proofDone === 0 && minimum) {
    const trimmed = minimum.length > 60 ? minimum.slice(0, 57) + "…" : minimum;
    const idtShort = identityShortPhrase(arcBlock.identity);
    const lines = idtShort
      ? [
          `Day ${arcDayX}. This is the day you said you'd become ${idtShort}. It's slipping — ${trimmed} saves it. — {coach}`,
          `Day ${arcDayX}. How bad do you want to become ${idtShort}? Prove it now — ${trimmed}. — {coach}`,
          `Day ${arcDayX}. Nothing yet. ${idtShort} isn't built on the easy days — ${trimmed}, right now. — {coach}`,
        ]
      : [
          `Day ${arcDayX}. Bad day version: ${trimmed} — {coach}`,
          `Day ${arcDayX}. How bad do you want this? Bare minimum: ${trimmed}. — {coach}`,
        ];
    return { title: "Forged", body: resolve(lines[Math.abs(seed) % lines.length]) };
  }

  // Morning during an Arc — anchor the day with a small ask. If yesterday had
  // proof actions and none landed, lead with that instead of the generic line.
  if (arcActive && slot === "morning") {
    const yesterdayYmd = daysAgoFrom(todayYmd, 1);
    const yesterdayMissed = arcDayX > 1
      && yesterdayYmd >= arcBlock.start_date
      && proofTotal > 0
      && proofRows.filter(h => forgedRingSatisfiedTodayRow(h, yesterdayYmd)).length === 0;

    if (yesterdayMissed) {
      const idtShort = identityShortPhrase(arcBlock.identity);
      const lines = [
        `Yesterday didn't happen. Today still counts — one piece of proof for ${idtShort || "the Arc"}. — {coach}`,
        `One missed day. How bad do you want ${idtShort || "this"}? Show it today. — {coach}`,
        idtShort
          ? `Yesterday's gone. Becoming ${idtShort} doesn't pause for bad days. — {coach}`
          : `Yesterday's gone. The Arc doesn't pause for bad days. — {coach}`,
      ];
      return { title: "Forged", body: resolve(lines[Math.abs(seed) % lines.length]) };
    }

    const lines = [
      `Day ${arcDayX}/${arcDur}. One proof action today. Small counts. — {coach}`,
      `Day ${arcDayX}. Pick the easiest piece of proof first. — {coach}`,
    ];
    return { title: "Forged", body: resolve(lines[Math.abs(seed) % lines.length]) };
  }

  // Partial proof already shown today (noon/evening) — affirm what's banked,
  // not just what's missing. This is the "saved" status made into copy.
  if (arcActive && proofTotal > 0 && proofDone > 0 && proofDone < proofTotal) {
    const idtShort = identityShortPhrase(arcBlock.identity);
    const lines = [
      `Day ${arcDayX}. Slow start, but you showed up — that's ${idtShort || "the identity"} talking. — {coach}`,
      `Day ${arcDayX}. ${proofDone} of ${proofTotal} in. Today's already saved. — {coach}`,
    ];
    return { title: "Forged", body: resolve(lines[Math.abs(seed) % lines.length]) };
  }

  // Midday during an Arc — gentle proof nudge (no proof at all yet today).
  if (arcActive && proofPending > 0) {
    const lines = [
      `Day ${arcDayX}. ${proofPending} proof action${proofPending === 1 ? "" : "s"} left. — {coach}`,
      `Day ${arcDayX}/${arcDur}. One more piece of proof today? — {coach}`,
    ];
    return { title: "Forged", body: resolve(lines[Math.abs(seed) % lines.length]) };
  }

  // ── Legacy (no active Arc) ─────────────────────────────────────────────────

  // All habits logged today — short, affirming.
  if (trackableHabits.length > 0 && trackableHabits.every(h => forgedRingSatisfiedTodayRow(h, todayYmd))) {
    const idx = Math.abs(seed) % NORMAL_ALL_LOGGED.length;
    return { title: "Forged", body: resolve(NORMAL_ALL_LOGGED[idx]) };
  }

  // Goal deadline within 7 days — only when no active Arc. Arc users get
  // identity-framed copy above instead of generic goal countdowns.
  const urgentGoals = !arcActive
    ? (goals || [])
        .filter(g => g.goal_status === "active" && g.target_date)
        .map(g => ({ ...g, daysLeft: daysBetween(todayYmd, g.target_date) }))
        .filter(g => g.daysLeft >= 0 && g.daysLeft <= 7)
        .sort((a, b) => a.daysLeft - b.daysLeft)
    : [];
  if (urgentGoals.length > 0) {
    const g = urgentGoals[0];
    const e = g.emoji || "🎯";
    const when = g.daysLeft === 0 ? "today" : g.daysLeft === 1 ? "tomorrow" : `in ${g.daysLeft} days`;
    return {
      title: "Forged",
      body: resolve(`${e} "${g.name}" is due ${when}. Worth pushing on it today. — {coach}`),
    };
  }

  // Evening: branch on whether the user has logged anything today.
  if (slot === "evening") {
    const anyLoggedToday = trackableHabits.some(h => hasAnyLogOnDate(h, todayYmd));
    const eveningPool = anyLoggedToday
      ? NORMAL_POOLS.evening.logged[poolKey]
      : NORMAL_POOLS.evening.unlogged[poolKey];
    const body = eveningPool[Math.abs(seed) % eveningPool.length];
    return { title: "Forged", body: resolve(body) };
  }

  // Morning and noon — pool-based.
  const pool = (NORMAL_POOLS[slot] || NORMAL_POOLS.morning)[poolKey];
  const body = pool[Math.abs(seed) % pool.length];
  return { title: "Forged", body: resolve(body) };
}

async function aiPickMessage(name, coachName, habits, goals, todayYmd, localHour, arcBlock = null) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const TRACKABLE = ["daily", "weekly", "project", "limit"];

  const summaries = (habits || [])
    .filter(h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log")
    .map(h => {
      const doneToday = strictLoggedProgressToday(h, todayYmd);
      const recentLogs = (h.logs || [])
        .filter(l => l.date >= daysAgoFrom(todayYmd, 7))
        .sort((a, b) => b.date.localeCompare(a.date));
      const reflections = recentLogs.filter(l => l.reflection).slice(0, 2).map(l => l.reflection);
      let line = `- ${h.emoji || ""} ${h.name} (logged today: ${doneToday})`;
      if (reflections.length) line += `, recent notes: "${reflections.join("; ")}"`;
      return line;
    })
    .join("\n");

  const urgentGoals = (goals || [])
    .filter(g => g.goal_status === "active" && g.target_date)
    .map(g => ({ ...g, daysLeft: daysBetween(todayYmd, g.target_date) }))
    .filter(g => g.daysLeft >= 0 && g.daysLeft <= 7);

  const goalLine = urgentGoals.length
    ? `Upcoming deadlines: ${urgentGoals.map(g => `${g.name} in ${g.daysLeft}d`).join(", ")}`
    : "";

  const hour = localHour ?? 12;
  const timeLabel = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  const TRACKABLE_AI = ["daily", "weekly", "project", "limit"];
  const anyLoggedToday = (habits || []).some(
    h => TRACKABLE_AI.includes(h.habit_type) && h.habit_type !== "log" && hasAnyLogOnDate(h, todayYmd)
  );

  // Peak-risk detection — mirrors the template-pool logic in pickNormalMessage.
  // Only this specific moment (evening, zero proof shown, Arc active) earns
  // permission for a sharper, identity-confronting register below.
  const arcActiveForTone = !!arcBlock?.identity;
  let proofAtRisk = false;
  if (arcActiveForTone) {
    const proofRows = (habits || []).filter(
      h => TRACKABLE_AI.includes(h.habit_type) && h.habit_type !== "log"
        && h.is_proof_action === true && h.block_id === arcBlock.id
    );
    proofAtRisk = proofRows.length > 0 && proofRows.every(h => !strictLoggedProgressToday(h, todayYmd));
  }
  const arcAtRisk = arcActiveForTone && hour >= 19 && proofAtRisk;

  const toneHint = arcAtRisk
    ? "It's evening, Arc active, and zero proof shown today with the bare minimum still on the table — this is the one moment that earns a sharper, identity-confronting line (e.g. challenging whether they actually want what they said they wanted). Direct, not mean. No guilt-tripping, no name-calling."
    : hour >= 19 && !anyLoggedToday
    ? "It's evening and they haven't logged yet — warmly encourage them to capture the day before it slips away. Human and gentle, not pushy or guilt-trippy."
    : hour >= 19
    ? "It's evening and they've already logged — be warm and reflective. Acknowledge the day. No push to do more, just encouragement."
    : hour < 10
    ? "It's morning — be brief and upbeat. Help set a positive tone. No pressure to log."
    : "It's midday — be friendly and human. A light check-in, not a logging reminder.";

  const signOff = `— ${coachName || "Forged"}`;

  let arcContext = "";
  let arcGuidance = "";
  if (arcBlock?.identity) {
    const dayX = forgeBlockDayNumber(arcBlock, todayYmd);
    const dur = arcBlock.duration_days || 56;
    const minimum = (arcBlock.minimum_proof || "").trim() || "—";
    arcContext = `
Day ${dayX} of ${dur} of their current Arc.
They said they're becoming: ${arcBlock.identity}
The bare minimum on a bad day is: ${minimum}
`;
    arcGuidance = `
ARC FRAMING (use it):
- Anchor the message in the Arc when natural — e.g. open with "Day ${dayX}." (no other day-counters).
- Reference the identity OR the minimum OR a single proof action — pick one, never all three.
- If they haven't logged, lean toward the bad-day minimum ("Bad day version: ${minimum}").
- Do NOT mention goal deadlines like "Gain Weight is due in 5 days" — Arc framing replaces that copy.
Good examples (use the shape, not the words):
  Day 3. Breakfast is the first proof. Don't let nicotine win the morning. — ${coachName || "Coach"}
  Day 14. One proof action today. Small counts. — ${coachName || "Coach"}
  Day 22. Bad day version: ${minimum}. — ${coachName || "Coach"}${arcAtRisk ? `
  Day 22. How bad do you want to become ${arcBlock.identity}? Prove it: ${minimum}. — ${coachName || "Coach"}` : ""}
NEVER use: warrior, elite, alpha, journey, future you, stay strong king/queen.`;
  }

  const prompt = `You are ${coachName || "a habit coach"}, writing a push notification for ${name}'s Forged app.

Time of day: ${timeLabel} (local hour: ${hour})
Date: ${todayYmd}

Their habits:
${summaries || "No habits yet"}
${goalLine}
${arcContext}${arcGuidance}
Write ONE short push notification body. ${toneHint}

Rules:
- Max 110 characters total
- No hashtags. No quotes around the message.
- Do NOT open with commands like "Log now" or "Check in" — be warmer and more natural
- Do NOT mention streaks or habit counts
- NEVER claim they completed something unless the data shows logged today: true
- NEVER invent facts not in the data above
- End with exactly: ${signOff}`;

  try {
    const client = new Anthropic({ apiKey: apiKey.trim() });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content?.[0]?.text?.trim();
    if (text) return { title: "Forged", body: text };
  } catch (err) {
    console.error("[Forged cron] AI message failed:", err.message);
  }
  return null;
}

// ── Handler ────────────────────────────────────────────────────────────────────

async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth: reject anyone not holding CRON_SECRET ─────────────────────────────
  // Vercel cron jobs automatically attach `Authorization: Bearer <CRON_SECRET>`
  // when the env var is set on the project. If it isn't set, this endpoint is
  // effectively disabled — we refuse to do AI/push work for unauthenticated
  // callers so nobody can burn our Anthropic budget or spam users.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[Forged cron] CRON_SECRET not set — refusing to run");
    return res.status(503).json({ error: "Cron not configured" });
  }
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: "VAPID keys not configured" });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@forged.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const supabase = createClient(SUPABASE_URL, serviceRoleKey);

  // CRON_MODE controls how we decide *who* to send to on this invocation:
  //   - "windowed" (default): only send to users whose configured local
  //                          HH:MM (5-minute bucket) matches NOW in their
  //                          timezone. Pair with the `*/5 * * * *` Vercel
  //                          cron schedule. This is the only mode that
  //                          actually delivers each user a reminder at
  //                          their chosen local time.
  //   - "hourly"            : alias for "windowed" (back-compat).
  //   - "daily"             : legacy mode — send once per cron invocation
  //                          to every enabled subscriber. Only correct
  //                          when paired with a once-per-day cron schedule
  //                          (e.g. `0 7 * * *`). Leaves it impossible to
  //                          honour per-user reminder times, so we no
  //                          longer default to it.
  // Every mode also dedupes via last_reminder_sent_date so the same user
  // never gets two daily reminders on the same local calendar day.
  const cronMode = (process.env.CRON_MODE || "windowed").toLowerCase().trim();
  const isWindowed = cronMode === "hourly" || cronMode === "windowed";

  const debug = process.env.DEBUG_CRON === "1" || process.env.DEBUG_CRON === "true";

  console.log("[Forged cron] start", {
    mode: cronMode,
    isWindowed,
    cron_secret_present: Boolean(cronSecret),
    vapid_public_present: Boolean(process.env.VAPID_PUBLIC_KEY),
    vapid_private_present: Boolean(process.env.VAPID_PRIVATE_KEY),
    anthropic_present: Boolean(process.env.ANTHROPIC_API_KEY),
    debug,
    now_utc: new Date().toISOString(),
  });

  // SELECT * tolerates the column being absent if the new migration hasn't
  // run yet — we just gracefully skip dedupe in that case.
  const { data: subs, error: subErr } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("notifications_enabled", true);

  if (subErr) return res.status(500).json({ error: subErr.message });
  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0, message: "No active subscribers" });

  const userIds = subs.map(s => s.user_id);

  const { data: allRows } = await supabase
    .from("habits")
    .select(
      "user_id, name, emoji, habit_type, logs, target_date, goal_status, weekly_target, daily_budget, daily_target_minutes, is_proof_action, block_id"
    )
    .in("user_id", userIds);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, is_pro, coach_name")
    .in("id", userIds);

  const { data: activeArcRows } = await supabase
    .from("forge_blocks")
    .select("user_id, identity, minimum_proof, start_date, end_date, duration_days, status, review")
    .eq("status", "active")
    .in("user_id", userIds);

  const profileByUser = {};
  for (const p of profiles || []) profileByUser[p.id] = p;

  const arcBlockByUser = {};
  for (const b of activeArcRows || []) arcBlockByUser[b.user_id] = b;

  const habitsByUser = {};
  const goalsByUser = {};
  for (const row of allRows || []) {
    if (row.habit_type === "goal" || row.habit_type === "progress") {
      if (!goalsByUser[row.user_id]) goalsByUser[row.user_id] = [];
      goalsByUser[row.user_id].push(row);
    } else {
      if (!habitsByUser[row.user_id]) habitsByUser[row.user_id] = [];
      habitsByUser[row.user_id].push(row);
    }
  }

  const tzByUser = {};
  for (const s of subs) {
    tzByUser[s.user_id] = s.timezone || "UTC";
  }

  let sent = 0;
  let failed = 0;
  let skippedDedup = 0;
  let skippedWindow = 0;
  let skippedCategory = 0;
  let skippedArcPause = 0;
  let skippedArcEnded = 0;
  let sentArcEnd = 0;
  const staleIds = [];
  // Per-user trace populated when DEBUG_CRON=1; surfaced in the response so
  // you can hit the cron manually with curl + Bearer CRON_SECRET to see who
  // got picked and why.
  const trace = [];

  console.log(`[Forged cron] subscribers loaded count=${subs.length}`);

  for (const sub of subs) {
    const tz = tzByUser[sub.user_id] || "UTC";
    const todayYmd = ymdNowInTimeZone(tz);
    const now = hourMinuteNowInTimeZone(tz);

    // ── Per-category gate: skip users who turned off daily reminders ────
    if (sub.daily_reminders_enabled === false) {
      if (debug) trace.push({ user_id: sub.user_id, skipped: "category_disabled" });
      skippedCategory++;
      continue;
    }

    // ── Windowed mode: only fire at 7am, 12pm, 7pm local time (:00 bucket) ──
    if (isWindowed) {
      if (!NORMAL_FIRE_HOURS.includes(now.hour) || bucketMinute(now.minute) !== 0) {
        if (debug) trace.push({
          user_id: sub.user_id, skipped: "window_miss",
          tz, now_local: now, fire_hours: NORMAL_FIRE_HOURS,
        });
        skippedWindow++;
        continue;
      }
    }

    // ── Dedupe: one send per slot (morning|noon|evening) per day ────────
    const dedupKey = `${todayYmd}_${normalUserSlot(now.hour)}`;
    if (sub.last_reminder_sent_date && sub.last_reminder_sent_date === dedupKey) {
      if (debug) trace.push({ user_id: sub.user_id, skipped: "dedup", dedup_key: dedupKey, last: sub.last_reminder_sent_date });
      skippedDedup++;
      continue;
    }

    const habits = habitsByUser[sub.user_id] || [];
    const goals = goalsByUser[sub.user_id] || [];
    const profile = profileByUser[sub.user_id] || {};
    const coachName = profile.coach_name || null;
    const arcBlock = arcBlockByUser[sub.user_id] || null;

    // Paused after Arc end until a new Arc is in its early days (day < duration).
    if (sub.last_reminder_sent_date?.endsWith(ARC_PAUSE_SUFFIX)) {
      const dayX = arcBlock ? forgeBlockDayNumber(arcBlock, todayYmd) : null;
      const dur = arcBlock?.duration_days || 56;
      if (!arcBlock || (dayX != null && dayX >= dur)) {
        if (debug) trace.push({ user_id: sub.user_id, skipped: "arc_pause" });
        skippedArcPause++;
        continue;
      }
    }

    const arcDuration = arcBlock?.duration_days || 56;
    const arcDayX = arcBlock ? forgeBlockDayNumber(arcBlock, todayYmd) : 0;
    const isArcEndMorning = isWindowed && now.hour === 7 && bucketMinute(now.minute) === 0;

    if (arcBlock && arcDayX >= arcDuration && isArcEndMorning) {
      const pauseKey = `${todayYmd}${ARC_PAUSE_SUFFIX}`;
      if (sub.last_reminder_sent_date !== pauseKey) {
        const title = "Forged";
        const body = applyCoachName("Your Arc ends today — your review is ready", coachName);
        const payload = JSON.stringify({ title, body, url: "/?screen=insights", tag: "forged-arc-end" });
        try {
          await webpush.sendNotification(sub.subscription, payload);
          sent++;
          sentArcEnd++;
          if (debug) trace.push({ user_id: sub.user_id, sent: true, arc_end: true, dedup_key: pauseKey });
          try {
            await supabase
              .from("push_subscriptions")
              .update({ last_reminder_sent_date: pauseKey })
              .eq("id", sub.id);
          } catch (markErr) {
            if (!String(markErr?.message || "").includes("last_reminder_sent_date")) {
              console.warn(`[Forged cron] arc pause stamp failed for ${sub.user_id}:`, markErr.message);
            }
          }
        } catch (err) {
          failed++;
          if (err.statusCode === 404 || err.statusCode === 410) staleIds.push(sub.id);
          else console.error(`[Forged cron] arc-end push error for ${sub.user_id}:`, err.message);
        }
      }
      continue;
    }

    if (arcBlock && arcDayX >= arcDuration) {
      if (debug) trace.push({ user_id: sub.user_id, skipped: "arc_ended_phase" });
      skippedArcEnded++;
      continue;
    }

    let title;
    let body;
    // AI generation only for Pro users at the evening slot — morning/noon use curated templates.
    if (profile.is_pro && process.env.ANTHROPIC_API_KEY && normalUserSlot(now.hour) === "evening") {
      const aiMsg = await aiPickMessage(profile.name || "there", coachName, habits, goals, todayYmd, now.hour, arcBlock);
      ({ title, body } = aiMsg || pickNormalMessage(habits, goals, todayYmd, now.hour, coachName, arcBlock));
    } else {
      ({ title, body } = pickNormalMessage(habits, goals, todayYmd, now.hour, coachName, arcBlock));
    }

    const payload = JSON.stringify({ title, body, url: "/", tag: "forged-reminder" });

    try {
      await webpush.sendNotification(sub.subscription, payload);
      sent++;
      if (debug) trace.push({ user_id: sub.user_id, sent: true, title, dedup_key: dedupKey });
      // Stamp the dedup key (hourly or daily depending on mode) so the next
      // cron run within the same window skips this user.
      try {
        await supabase
          .from("push_subscriptions")
          .update({ last_reminder_sent_date: dedupKey })
          .eq("id", sub.id);
      } catch (markErr) {
        if (!String(markErr?.message || "").includes("last_reminder_sent_date")) {
          console.warn(`[Forged cron] dedupe stamp failed for ${sub.user_id}:`, markErr.message);
        }
      }
    } catch (err) {
      failed++;
      // FCM/APNS returns 404/410 for a subscription the browser has rotated,
      // unsubscribed, or the user revoked. The DB row is now garbage — purge
      // it so we don't keep hammering an endpoint that will never deliver.
      // The user's app re-subscribes automatically on next open (sw + UI),
      // but if the row stays around the cron will keep failing on it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        staleIds.push(sub.id);
        console.warn(`[Forged cron] stale subscription for ${sub.user_id} status=${err.statusCode} — deleting row, user must re-enable in app`);
        if (debug) trace.push({ user_id: sub.user_id, sent: false, error: "stale_subscription", statusCode: err.statusCode });
      } else {
        console.error(`[Forged cron] push error for ${sub.user_id}:`, err.message, "statusCode=", err.statusCode);
        if (debug) trace.push({ user_id: sub.user_id, sent: false, error: err.message, statusCode: err.statusCode });
      }
    }
  }

  if (staleIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleIds);
  }

  console.log(
    `[Forged cron] done mode=${cronMode} sent=${sent} failed=${failed} skipped_dedup=${skippedDedup} skipped_window=${skippedWindow} skipped_category=${skippedCategory} skipped_arc_pause=${skippedArcPause} skipped_arc_ended=${skippedArcEnded} sent_arc_end=${sentArcEnd} stale_removed=${staleIds.length}`
  );
  return res.status(200).json({
    mode: cronMode,
    subs_total: subs.length,
    sent,
    failed,
    skippedDedup,
    skippedWindow,
    skippedCategory,
    skippedArcPause,
    skippedArcEnded,
    sentArcEnd,
    staleRemoved: staleIds.length,
    ...(debug ? { trace } : {}),
  });
}

export default withSentry(handler, "cron-reminders");
