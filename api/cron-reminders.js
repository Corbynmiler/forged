import webpush from "web-push";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { withSentry } from "./_lib/sentry.js";

const SUPABASE_URL = "https://apdmvbzfjuvxworjepze.supabase.co";

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

/** Matches client `isLoggedToday`: any saved log row for that calendar day (Today ring %). */
function hasAnyLogOnDate(h, dateStr) {
  return (h.logs || []).some(l => l.date === dateStr);
}

/**
 * Stricter "real progress today" for AI copy — avoids congratulating a workout that did not happen.
 * Weekly: counts a session only when value === true that day (not a blank row / quicknote alone).
 */
function strictLoggedProgressToday(h, todayYmd) {
  if (h.habit_type === "log") return false;
  const logs = h.logs || [];

  if (h.habit_type === "daily") {
    return hasDailyCompletion(h, todayYmd) || hasRestDay(h, todayYmd);
  }
  if (h.habit_type === "weekly") {
    return logs.some(l => l.date === todayYmd && l.value === true);
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

// ── Dev-owner custom notifications ────────────────────────────────────────────
// Scoped exclusively to this one user UUID. Never applied to anyone else.
// Tone: short, punchy, escape-the-9-to-5 builder framing.
// Swear words intentional — this is a personal dev customisation.
const DEV_OWNER_ID = "5e9b4ba7-bf15-4e94-ab05-fe3306496973";

// Bumped whenever the dev pool content changes. Surfaces in cron logs so
// you can confirm production is running the latest pool, not a stale build.
const DEV_POOL_VERSION = "v5-2026-04-28";

// Distinct titles ONLY used by the dev-owner branch so notifications are
// visually distinguishable from the generic pool. If a notification ever
// arrives titled "Forged 🔥" / "Forged ✅" / "Forged 🎯", that means the
// generic branch fired (something's wrong). Captain titles = dev branch.
const DEV_TITLE_DEFAULT     = "Forged ⚡ Captain";
const DEV_TITLE_ALL_LOGGED  = "Forged 🔨 Captain";

// Send every N hours at the top of the hour (:00 bucket).
// 2 = fire at 0,2,4,6,8,10,12,14,16,18,20,22 local time.
const DEV_OWNER_SEND_INTERVAL_HOURS = 2;

// Day names for in-message references
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isWeekend(todayYmd) {
  const day = new Date(todayYmd + "T12:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

function getDayName(todayYmd) {
  return DAY_NAMES[new Date(todayYmd + "T12:00:00Z").getUTCDay()];
}

// Time-of-day slot — drives which pool is picked
function getTimeSlot(hour) {
  if (hour >= 5  && hour < 7)  return "early_morning"; // 5–7am
  if (hour >= 7  && hour < 9)  return "morning";        // 7–9am
  if (hour >= 9  && hour < 12) return "work_am";        // 9am–noon
  if (hour >= 12 && hour < 14) return "lunch";          // noon–2pm
  if (hour >= 14 && hour < 17) return "work_pm";        // 2–5pm
  if (hour >= 17 && hour < 20) return "after_work";     // 5–8pm
  if (hour >= 20 && hour < 23) return "evening";        // 8–11pm
  return "night";                                         // 11pm–5am
}

// Deterministic hourly pick — same message within a given hour, different each hour/day.
// `dateSeed * 17` rotates the whole pool day-over-day so consecutive days don't
// cluster on the same indices, and `hour * 37` spreads picks within a single day.
// With pool sizes of 10–18 this gives a different message virtually every hour
// across a week without ever repeating during a single day.
function devPick(pool, todayYmd, hour) {
  const dateSeed = parseInt(todayYmd.replace(/-/g, ""), 10);
  const seed = dateSeed * 17 + hour * 37;
  return pool[Math.abs(seed) % pool.length];
}

// ── Message pools ──────────────────────────────────────────────────────────────
// Keys: getTimeSlot() values. Each has `weekday` and `weekend` arrays.
//
// Pool design notes (creator account only):
//   - Pools sit at 10–18 entries each so the deterministic picker virtually
//     never repeats within a single day, and rotates fully across a week.
//   - ~30–40% of weekday lines carry ≥ 2 swears; weekend tends slightly
//     softer but still has bite.
//   - Each block has one or two "fun fact" / curveball lines so the user
//     occasionally gets something they didn't expect.
//   - Tone: chaotic-good mate, builder/captain energy, dark humour, direct
//     callouts. Useful, not random for the sake of it.
//   - Time-block intent:
//       early_morning : wake the fuck up
//       morning       : pre-work, set the day on your terms
//       work_am/pm    : survive, keep the bigger mission alive
//       lunch         : quick reset, don't drift
//       after_work    : come home and BUILD, don't waste the night
//       evening       : one more push or consciously switch off
//       night         : log + sleep, no mid-zone
//       weekend       : freedom / make it count
const DEV_POOLS = {
  early_morning: {
    weekday: [
      "Up before the shift. Log before you lace the boots.",
      "Pre-work window — quick log, then go earn the exit.",
      "Twenty minutes before you leave. Enough to log everything.",
      "Every shift you do funds the build. Don't forget why you're up.",
      "The day job calls soon. Two minutes to log before you walk out.",
      "Up early for someone else's work. Don't skip the work that's actually yours.",
      "Log it before you pick up the thermos. Faster than you think.",
      "You're awake. You have time. Log before the site swallows the morning.",
      "Early start. The kind that earns the future. Log and go.",
      "Before the high-vis goes on — log the damn habits.",
      "Kettle, log, boots. That's the order. Don't skip the middle one.",
      "This job is temporary. The habits aren't. Log before you head out.",
      "Pre-work rush. Two minutes for the app, then it's theirs for eight hours.",
      "Quick log before the commute. That's the whole ask.",
      "Fun fact: the guys who get out don't skip the morning routine even on work days.",
      "Up before the shift and still logging — that's the person who actually leaves eventually.",
    ],
    weekend: [
      "5am on a free day. Mate, that's a fucking flex. Don't waste the shit.",
      "Weekend. Pre-dawn. Zero excuses, zero distractions. Open the laptop.",
      "No one's awake. No one's expecting any shit from you. Best window of the week.",
      "Weekend morning while the lazy world sleeps. That's your fucking edge.",
      "5am on a Saturday is rare. Spend it on the thing that matters.",
      "Up early on a free day — most people only dream about this. Don't waste it dreaming.",
      "No alarm. No boss. Just you and the work. Get to it.",
      "Weekend dawn. The kind of hour where careers get fucking made.",
      "Free hours start now. Spend them on the future you actually want.",
      "Up before the world on a weekend. That's character. Now act like it.",
      "Pre-dawn weekend window. Don't fuck it off for sleep.",
      "Fun fact: you'll forget 90% of weekends. Make this one a 10-percenter.",
    ],
  },
  morning: {
    weekday: [
      "On site now. Hands are busy — log when you get a minute between tasks.",
      "Physical work started. The mission's still alive even when your hands are full.",
      "You're passing through this shift. The build waits on the other side.",
      "On the tools. Every hour of this pays for the next chapter. Remember that when it's shit.",
      "First hours on site. You're doing the hard part. Log at break if not now.",
      "The morning's not yours right now. That's fine. Get through it.",
      "Physical job, physical reality. Log when there's a gap — lunch if nothing else.",
      "Working with your hands. Different kind of discipline. The app will be there at break.",
      "Job site hours. Keep the head down — the evening's yours eventually.",
      "On the tools mid-morning. Log at the next gap you get.",
      "Can't always log mid-shift on a physical job. That's real. Lunch window's coming.",
      "Every hour you're working is funding the thing you actually want to build. Don't forget that.",
    ],
    weekend: [
      "Free morning. No meetings. No commute. Stop fucking scrolling.",
      "Weekend morning. The most expensive hours you ever sleep through.",
      "Coffee, habits, build. In that fucking order.",
      "No one needs your shit for two hours. Use that like it's gold. Because it is.",
      "Saturday morning is a cheat code. Open the damn laptop.",
      "Weekend dawn slipped past. Catch the next window. Move.",
      "Quiet morning. Empty calendar. This is when real shit gets done.",
      "If your weekend starts on the couch, that's how it ends. Get the fuck up.",
      "Morning hours on a free day are the most leveraged. Don't blow them.",
      "You don't need anyone's permission to build. Open the damn thing.",
      "Free morning. Trade the time for actual progress, not vibes and bullshit.",
      "Fun fact: most weekend builders ship more than 9-to-5 employees do all week.",
    ],
  },
  work_am: {
    weekday: [
      "Mid-morning on the job. The exit plan doesn't pause while you're earning it.",
      "Every hour you work now is a brick in the wall out of this. Keep going.",
      "You're earning the time to build by putting in the time to work. That's the deal.",
      "Physical work mid-morning. Log at lunch — that's the plan.",
      "On the tools. The mission's bigger than this shift. Log when you can.",
      "Mid-shift. Tired already? Normal for physical work. Log at noon.",
      "Passing through the hard part of the morning. Every shift one closer to not having to.",
      "Physical morning underway. Head down, do the work, log at the break.",
      "The body earns the exit so the mind can build the escape. Keep moving.",
      "Work mode. Lunch window's next. That's your log slot.",
      "They've got the morning. You've got everything after. Hold that thought.",
      "Mid-shift on the tools. The app's waiting — it'll keep. Lunch first.",
    ],
    weekend: [
      "Mid-morning, free day. What are you actually fucking building?",
      "No one's emailing. No one's tracking your time. So fucking move.",
      "Weekend mid-morning. Don't blow the best hours pretending to relax.",
      "Free hours. Open the project that scares you a bit. That's the right one.",
      "You've already wasted half a Saturday morning. Don't fuck the other half.",
      "Quiet weekend hours. Build. Log. Repeat. That's the whole damn formula.",
      "No boss watching. No alarm. Just you and what you said you'd build.",
      "Mid-morning weekend. Either build, or be honest you're not going to.",
      "Free time is sacred. Don't waste it on someone else's content.",
      "Saturday morning hours are pure gold. Mine the shit out of them.",
      "The weekend version of you should be the most ruthless. Act like it.",
      "Fun fact: most progress happens in unscheduled, uncool hours. Like this one.",
    ],
  },
  lunch: {
    weekday: [
      "Lunch break — best mobile window of the work day. Log before you eat.",
      "Thirty minutes that are actually yours. Use two of them to log.",
      "Midday on a physical job. Log, eat, rest. That's the whole play.",
      "Half the shift done. Log your habits before the afternoon kicks in.",
      "Best shot at logging on a work day — you've got a break right now.",
      "Quick log while the food's hot. Then eat and rest before the afternoon.",
      "Prime window — you're not on the tools right now. Use it.",
      "Lunch. Two minutes to log, then eat and forget the app until tonight.",
      "Mid-shift reset. Log, eat, breathe. Then back to earning the exit.",
      "The lunch break exists. The log takes two minutes. Do both.",
      "Half a shift survived. Log the morning, eat, prep for the afternoon grind.",
      "Physical job lunch window. Log now so you're not scrambling tonight.",
      "Don't spend the whole break scrolling. Two minutes to log, then you're free.",
      "Fun fact: most people forget to log by dinner. You're at the best window right now.",
    ],
    weekend: [
      "Lunchtime on a free day. What have you actually fucking built so far?",
      "Half the day's gone. Don't fuck the other half.",
      "No one's stopping you from working all weekend if you want to. Most won't. Be one who does.",
      "Quick lunch. Then back to it. The weekend isn't fucking infinite.",
      "Free time is finite. Spend it like a millionaire spends money — carefully.",
      "Midday weekend slump. Log it. Build through the shit. Done.",
      "Saturday lunch. The afternoon's still virgin territory. Use it.",
      "Eat. Log. Move. Build. Any order. Just do them all.",
      "If you nap through Saturday afternoon, that's the whole damn weekend gone.",
      "Lunchtime weekend. Two more good hours and the day's been worth it.",
      "Free day, free hands. Don't fucking sit on them.",
      "Fun fact: the average person watches four hours of TV on weekends. You're not the average.",
    ],
  },
  work_pm: {
    weekday: [
      "Afternoon on the job. Body's getting tired. That's normal for physical work.",
      "Home stretch of the shift. Keep the head down — the evening's yours soon.",
      "Last stretch. Head down, finish the shift, get home safe.",
      "Afternoon grind. Physical job drains you properly. Don't expect magic tonight — just log.",
      "The body's tired by now. That's not weakness — that's physical labour. Log it tonight.",
      "Almost out. Don't spend it planning the build if the body's running on empty.",
      "One more stretch. Then it's yours. Hold the line.",
      "Work pm. Pace yourself — the evening's worth protecting.",
      "Afternoon on site. The escape plan doesn't need you right now. Just finish the shift.",
      "Home soon. Save what's left for the evening — don't burn it on resentment.",
      "The shift ends and the real day starts. Almost there.",
      "Physical afternoon. Survive it. Log tonight. That's all that's required.",
    ],
    weekend: [
      "Weekend afternoon — still time. Don't fucking drift now.",
      "Free afternoon hours are the most underused asset of your week. Use them.",
      "Stop fucking drifting on a Saturday. Build something real.",
      "If you waste a weekend afternoon, that's a Tuesday morning of regret.",
      "Two good hours this afternoon beats four wasted. You know which is which.",
      "Weekend 3pm. The day's not over. The work isn't done. Get back to the damn thing.",
      "Free afternoon. No fucking excuses. Build.",
      "Saturday afternoon slump. Hard pass. Get up and log.",
      "If you nap through this, you nap through the weekend. Move.",
      "Free hours bleeding away. Plug the leak. Log something.",
      "This is the time you wished you had on a Wednesday. You have it now. Use the shit out of it.",
      "Fun fact: you'll remember what you built this weekend. Not what you watched.",
    ],
  },
  after_work: {
    weekday: [
      "Home from the shift. Rest if the body needs it — that's not quitting, that's recovery.",
      "Off the tools. On your own time now. Rest or build — both are valid after physical work.",
      "Shift done. Body tired. Log the day and decide honestly if you've got build in you tonight.",
      "Home from site. The mission's alive whether you build tonight or just rest. But log it.",
      "After a physical shift, rest isn't laziness. Log and listen to what the body needs.",
      "You earned the evening by doing the day. Rest without guilt, or build without excuses.",
      "Even 20 minutes on the build tonight adds up. But so does proper recovery.",
      "Off site. Log it. Then decide — short build session or full rest. Either's honest.",
      "Physical job's done. Log first. Eat. Then see what's left in the tank.",
      "The exit gets built in evenings like this, or on weekends. Both count. Log either way.",
      "Home. Log it. Then do what your body actually needs — not what guilt says.",
      "Day job survived. That takes real energy when it's physical. Log and be fair to yourself.",
      "Even resting tonight is part of the plan — you can't build burnt out. Log and recover.",
      "Fun fact: rest after physical work is productive. So is building. Guilt is neither.",
      "Shift over. What matters is you log it and show up again tomorrow. Everything else is bonus.",
    ],
    weekend: [
      "Weekend evening. Still hours left. Don't fucking drift.",
      "Free evening on a free day. The luxury you said you wanted. Use the shit out of it.",
      "Saturday night. The world wants you to spend money on shit. Don't. Build instead.",
      "Evening on a weekend — rarer than it feels. Don't waste it.",
      "After-hours on a weekend. You should be unstoppable right now. Are you?",
      "Free evening. No fucking excuses. Open the project.",
      "Most people are at the pub. Most people aren't building shit either. Connect those fucking dots.",
      "Weekend night. Build first. Reward later. Always that fucking order.",
      "Free hours are the most expensive hours, because you don't notice them passing. Move.",
      "Saturday evening. Worth fighting for. Get to work.",
      "Sunday evening. Last big window before the week. Don't fumble the damn thing.",
      "Fun fact: you'll never get this exact evening back. Spend it accordingly.",
    ],
  },
  evening: {
    weekday: [
      "Late evening after a physical day. Log it and rest well — you've earned it.",
      "If you've got build left in you tonight, go. If not, log and sleep properly.",
      "Log your habits before the phone goes dark. Two minutes, then you're done.",
      "Physical work takes it out of you. That's real. Log and rest without guilt.",
      "End of a long physical day. Log it all, even if the evening was just resting.",
      "Evening wind-down. Log, reflect quick, and sleep — tomorrow's another shift.",
      "If you built tonight after a physical day, that's genuinely impressive. Log it.",
      "If the evening was just recovery, that's fine too. Log it and sleep.",
      "End of the day. Log and be done. You've done enough.",
      "Whatever tonight was — build, rest, or both — log it and close the laptop.",
      "Late evening. Quick log. Then bed. The streak holds either way.",
      "Don't forget to log just because you're tired. Two minutes before you crash.",
    ],
    weekend: [
      "Weekend's almost done. Make the last hours fucking count.",
      "Sunday evening is both a gift and a threat. Use it.",
      "Last stretch of the weekend. Either go hard or wind down. Not in between.",
      "Still building? Good. Don't fucking stop now.",
      "Night closing on the weekend. What did you actually ship today?",
      "Weekend evening. The fork in the road. Pick build or pick rest. Both fine. Drifting isn't.",
      "If the weekend ends on the couch, the week starts there too. Connect the damn dots.",
      "Last good hour of a free day. Use it like it costs money. Because it kind of does.",
      "Sunday night = setup for the next week. Don't half-arse the damn thing.",
      "Free hours running out. One last fucking push before sleep.",
      "Weekend over soon. Whatever you didn't do — that's on you. Move.",
      "Fun fact: how you end the weekend predicts how you start the week. Now you know.",
    ],
  },
  night: {
    weekday: [
      "Late. Physical job tomorrow — you need sleep more than another hour of screen.",
      "Night mode. Log and sleep. Your body needs the recovery.",
      "Up late on a physical work week. Log and get to bed — tomorrow's a real day.",
      "Two minutes to log. Then actually sleep. No scrolling.",
      "Physical work burns energy. Sleep restores it. Log and shut it down.",
      "Still up? Log what you did today, then sleep properly. Physical job waits for no one.",
      "This is the hour that makes tomorrow harder if you ignore it. Log and go.",
      "Late night on a work week. Log it, leave it, sleep. Build tomorrow.",
      "You're not building your best stuff at midnight after a shift. Log and sleep.",
      "Night. Quick log. Lights out. The streak holds and so does the body.",
      "Fun fact: missing sleep after physical work compounds badly. Log and go.",
      "Sleep is part of the build. Log and get some.",
    ],
    weekend: [
      "Late on a free day. Log the shit and crash. Tomorrow's another window.",
      "Night. Log it before you forget. Then sleep.",
      "Late night weekend. Either keep building or wind down properly.",
      "If you're still up on a weekend, make the awake hours fucking worth it. Or sleep.",
      "Late hour. Last log of the day. Then bed.",
      "Sunday late night. Big choice — finish strong or rest hard. Either's fine.",
      "Night. Either you've done the work or you haven't. Log either way, you donkey.",
      "End of weekend. Quick log. Big sleep. Monday wants the best version of you.",
      "Late. Free day done. Log. Sleep. Restart. That's the loop.",
      "Fun fact: late-night ideas are usually shit. But late-night logs aren't. Log it.",
    ],
  },
};

// All-habits-logged congratulations — time-aware. Earned, not soft.
// Every line here MUST read as obviously dev-pool: captain energy, swearing,
// builder/founder framing, direct callouts. No "well done, keep it up" filler.
const DEV_ALL_LOGGED_POOLS = {
  weekday: [
    "All logged on a physical work day. That's harder than it looks. What's tonight?",
    "Full sweep on a shift day. Habits done, job done. Rest or build — your call.",
    "Every habit in. After physical work. That's the person who actually gets out.",
    "All logged on a day that drained the body. Respect. Now decide what the evening's for.",
    "Habits handled. Physical shift survived. What's left in the tank?",
    "Complete sweep on a work day. That's discipline on hard mode.",
    "All in. Even after the physical grind. Now build if you've got it, rest if you don't.",
    "Full house. Hard day's work and still logged. The exit doesn't build itself, but tonight's allowed to be rest.",
    "Logged everything on a real physical workday. The app sees the effort. Don't stop.",
    "All habits in. Now the only question: build or recover? Both move the mission forward.",
    "Full sweep. Physical job, full log. You're already doing more than most manage on a desk day.",
    "Done. You worked the body and still showed up for the habits. That's the standard.",
    "All logged on a shift day. Clean. Now either build or sleep well — no half-measures.",
    "Habits cleared. Physical shift cleared. What's the one thing tonight, if anything?",
    "Full set. You're building the exit from inside the job. That takes actual guts.",
    "All in on a work day. Forged exists because you kept logging on days like this.",
  ],
  weekend: [
    "Full sweep on a free day. No physical job today — all that energy is yours. Use it.",
    "All habits in on a weekend. This is what the work week is for. Now build.",
    "Habits handled. The real work is waiting. Open the laptop.",
    "Done with the easy wins. The hard ones build the exit. Get to them.",
    "Logged. Now build the thing the habits exist to support.",
    "Weekend sweep. No shift waiting for you tomorrow morning. Go hard.",
    "All habits in on a free day. These are the hours the physical job can't touch. Use them.",
    "Discipline confirmed. Now produce the thing.",
    "Full house on a weekend. No physical grind today — the build's all you've got. Good.",
    "Habits cleared on a free day. Build the thing that means you don't need the day job.",
    "Weekend full sweep. The next hour belongs entirely to you. Move.",
    "All logged on a free day. Half the battle. Now do the other half.",
    "Done with the boring shit. Now do the work that actually scares you. That's the right one.",
    "Full set on a weekend. This is why you survive the week. Don't waste it.",
    "All habits in. Forged was built on weekends like this. Build the next thing.",
    "Weekend full house. Physical job is off the clock. The build is on. Go.",
  ],
};

function pickDevOwnerMessage(habits, goals, todayYmd, localHour) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );
  const allLogged =
    trackableHabits.length > 0 &&
    trackableHabits.every(h => hasAnyLogOnDate(h, todayYmd));

  const weekend = isWeekend(todayYmd);
  const slot = getTimeSlot(localHour ?? 8);
  const poolKey = weekend ? "weekend" : "weekday";

  if (allLogged) {
    const pool = DEV_ALL_LOGGED_POOLS[poolKey];
    const body = devPick(pool, todayYmd, localHour ?? 0);
    return {
      title: DEV_TITLE_ALL_LOGGED,
      body,
      meta: {
        branch: "all_logged",
        slot,
        weekend,
        poolKey,
        poolName: `DEV_ALL_LOGGED_POOLS.${poolKey}`,
        poolSize: pool.length,
        trackableCount: trackableHabits.length,
        allLogged: true,
      },
    };
  }

  const pool = (DEV_POOLS[slot] || DEV_POOLS.morning)[poolKey];
  const body = devPick(pool, todayYmd, localHour ?? 0);
  return {
    title: DEV_TITLE_DEFAULT,
    body,
    meta: {
      branch: "default",
      slot,
      weekend,
      poolKey,
      poolName: `DEV_POOLS.${slot}.${poolKey}`,
      poolSize: pool.length,
      trackableCount: trackableHabits.length,
      allLogged: false,
    },
  };
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
// Tone: friendly, chatty, human — like a coach who actually cares.
// Every message ends with "Love, Forged." — no exceptions.
// Pools are weekday / weekend × morning / noon / evening.
const NORMAL_POOLS = {
  morning: {
    weekday: [
      "Morning mate, hope today's a good one. Give it hell. Love, Forged.",
      "Good morning! Quick check-in before the day gets away from you — don't forget to log later. Love, Forged.",
      "Morning! New day, fresh start — go make it count. Love, Forged.",
      "Hey, hope you slept well. Today's yours — log your habits and give it everything. Love, Forged.",
      "Rise and shine! Don't let the day run away before you've logged. You've got this. Love, Forged.",
      "Morning — your habits are waiting. Log early and set the tone for the day. Love, Forged.",
      "Morning, just a nudge to kick the day off right. Log when you get a sec. Love, Forged.",
      "Hey, good morning. Make today the one you actually show up for. Love, Forged.",
    ],
    weekend: [
      "Happy weekend! Hope you've got good plans — don't forget to log your habits along the way. Love, Forged.",
      "Weekend morning — the best kind. No rush, just don't let the day slip by without logging. Love, Forged.",
      "Morning! Free day, no agenda — just make it a good one. Love, Forged.",
      "Hey, happy weekend. Rest up, move your body, and log when you're ready. Love, Forged.",
      "Good morning! Even on the weekend, your habits matter. Quick log when you can. Love, Forged.",
      "Weekend! Your time, your rules — just don't forget to check in. Love, Forged.",
      "Morning! Whatever today looks like, keep the streak going. Love, Forged.",
      "Happy weekend. Enjoy every bit of it — and log your habits while you're at it. Love, Forged.",
    ],
  },
  noon: {
    weekday: [
      "Halfway through the day already — keep going, and log your shit later. Love, Forged.",
      "Lunchtime check-in! Hope the morning treated you well. Don't forget to log. Love, Forged.",
      "Midday nudge — you're doing great. Log your progress when you get a sec. Love, Forged.",
      "Half the day done, legend. Take a breath and keep at it. Love, Forged.",
      "Hey, just checking in. Hope the morning went well — finish strong this afternoon. Love, Forged.",
      "Noon already! Don't let the afternoon sneak past without logging. Love, Forged.",
      "Lunchtime! Your habits are waiting. Log and keep the streak alive. Love, Forged.",
      "Midday check-in. The second half of the day is yours — make it count. Love, Forged.",
    ],
    weekend: [
      "Lunchtime on a free day — hope it's been a good one so far. Don't forget to log. Love, Forged.",
      "Midday! Hope the weekend's treating you well. Log when you can. Love, Forged.",
      "Hey, halfway through — how's the weekend going? Quick log when you get a moment. Love, Forged.",
      "Weekend midday check-in. Hope the morning was good — enjoy the rest of the day. Love, Forged.",
      "Lunchtime! Even on weekends, your habits keep you sharp. Quick log? Love, Forged.",
      "Hey! Hope you're having a great day. Log your habits and carry on. Love, Forged.",
      "Midday on a free day — eat, log, relax, in whatever order works. Love, Forged.",
      "Weekend noon check-in, mate. How's it going? Don't forget to log later. Love, Forged.",
    ],
  },
  evening: {
    weekday: [
      "Evening check-in, legend. Don't forget to log how the day went. Love, Forged.",
      "Hey, day's winding down — great time to log your habits before you switch off. Love, Forged.",
      "Evening! Whatever happened today, log it and let it go. Tomorrow's another shot. Love, Forged.",
      "End of the day — nice work getting through it. Log your habits and rest up. Love, Forged.",
      "Evening nudge — don't let the day end without logging. Keeps the momentum going. Love, Forged.",
      "Hey, hope the day treated you well. Log your progress before you call it a night. Love, Forged.",
      "Evening! Quick log before you wind down. You've earned the rest. Love, Forged.",
      "Day's done. Log it, reflect a bit, and get some rest. Love, Forged.",
    ],
    weekend: [
      "Sunday, baby. Rest up or make moves — either way, make it count. Love, Forged.",
      "Evening! Hope the weekend's been a good one. Log before you call it. Love, Forged.",
      "Weekend evening check-in. Don't let the day end without logging. Love, Forged.",
      "Hey, end of a free day — how'd it go? Log it and wind down. Love, Forged.",
      "Evening! Whatever you got up to this weekend, don't forget to log it. Love, Forged.",
      "Weekend's almost done — log before the week sneaks back in. Love, Forged.",
      "Evening check-in, legend. Great weekend? Log it and keep the streak alive. Love, Forged.",
      "Sunday evening. Log, reflect, and get ready to go again tomorrow. Love, Forged.",
    ],
  },
};

/**
 * Message picker for normal users — time-slot aware, weekday/weekend aware,
 * always signed "Love, Forged." Data-driven shoutouts fire first (all-logged,
 * streak, urgent goal); pool message is the fallback.
 */
function pickNormalMessage(habits, goals, todayYmd, localHour) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );

  // All habits logged today — congratulate them.
  if (trackableHabits.length > 0 && trackableHabits.every(h => hasAnyLogOnDate(h, todayYmd))) {
    const CONGRATS = [
      "Every habit logged today — that's how it's done. Keep it up! Love, Forged.",
      "All habits in. You showed up and got it done. Love, Forged.",
      "Full house today — you're on fire. Love, Forged.",
      "All done for the day. Keep this up and nothing stops you. Love, Forged.",
      "Locked in. Every habit logged. That's the stuff. Love, Forged.",
    ];
    const idx = parseInt(todayYmd.replace(/-/g, ""), 10) % CONGRATS.length;
    return { title: "Forged ✅", body: CONGRATS[idx] };
  }

  // Streak shoutout — only for daily habits with a meaningful run.
  let bestStreak = 0;
  let bestStreakHabit = null;
  for (const h of habits || []) {
    if (h.habit_type !== "daily") continue;
    const s = getDailyStreak(h, todayYmd);
    if (s > bestStreak) { bestStreak = s; bestStreakHabit = h; }
  }
  if (bestStreakHabit && bestStreak >= 3) {
    const e = bestStreakHabit.emoji || "🔥";
    return {
      title: "Forged 🔥",
      body: `${e} ${bestStreak} days of ${bestStreakHabit.name} — don't break the streak now. Love, Forged.`,
    };
  }

  // Urgent goal deadline within 7 days.
  const urgentGoals = (goals || [])
    .filter(g => g.goal_status === "active" && g.target_date)
    .map(g => ({ ...g, daysLeft: daysBetween(todayYmd, g.target_date) }))
    .filter(g => g.daysLeft >= 0 && g.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  if (urgentGoals.length > 0) {
    const g = urgentGoals[0];
    const e = g.emoji || "🎯";
    const when = g.daysLeft === 0 ? "today" : g.daysLeft === 1 ? "tomorrow" : `in ${g.daysLeft} days`;
    return {
      title: "Forged 🎯",
      body: `${e} "${g.name}" is due ${when}. Log your progress and give it a push. Love, Forged.`,
    };
  }

  // Pool-based fallback — deterministic so same slot picks same message within a day.
  const weekend = isWeekend(todayYmd);
  const slot = normalUserSlot(localHour ?? 7);
  const poolKey = weekend ? "weekend" : "weekday";
  const pool = (NORMAL_POOLS[slot] || NORMAL_POOLS.morning)[poolKey];
  const dateSeed = parseInt(todayYmd.replace(/-/g, ""), 10);
  const seed = dateSeed * 11 + (localHour ?? 0) * 7;
  const body = pool[Math.abs(seed) % pool.length];
  return { title: "Forged", body };
}

// ── Message picker ─────────────────────────────────────────────────────────────

function pickMessage(habits, goals, todayYmd) {
  const TRACKABLE = ["daily", "weekly", "project", "limit"];
  const trackableHabits = (habits || []).filter(
    h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log"
  );

  if (trackableHabits.length > 0 && trackableHabits.every(h => hasAnyLogOnDate(h, todayYmd))) {
    const CONGRATS = [
      "Every habit logged. That's how it's built. ⚒️",
      "100% today. You showed up and got it done. 🔥",
      "All done for today. You're an absolute weapon. 💪",
      "Full house. Keep this up and nothing stops you. 🏆",
      "Locked in today. Log your progress and keep pushing. ✅",
    ];
    const msg = CONGRATS[new Date().getDate() % CONGRATS.length];
    return { title: "Forged ✅", body: msg };
  }

  let bestStreak = 0;
  let bestStreakHabit = null;
  for (const h of habits || []) {
    if (h.habit_type !== "daily") continue;
    const s = getDailyStreak(h, todayYmd);
    if (s > bestStreak) {
      bestStreak = s;
      bestStreakHabit = h;
    }
  }
  if (bestStreakHabit && bestStreak >= 3) {
    const e = bestStreakHabit.emoji || "🔥";
    return {
      title: "Forged 🔥",
      body: `${e} ${bestStreak}-day ${bestStreakHabit.name} streak. Don't break it today.`,
    };
  }

  const urgentGoals = (goals || [])
    .filter(g => g.goal_status === "active" && g.target_date)
    .map(g => ({ ...g, daysLeft: daysBetween(todayYmd, g.target_date) }))
    .filter(g => g.daysLeft >= 0 && g.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (urgentGoals.length > 0) {
    const g = urgentGoals[0];
    const e = g.emoji || "🎯";
    const when = g.daysLeft === 0 ? "today" : g.daysLeft === 1 ? "tomorrow" : `in ${g.daysLeft} days`;
    return {
      title: "Forged 🎯",
      body: `${e} "${g.name}" is due ${when}. Log your progress.`,
    };
  }

  let worstGap = 0;
  let gapHabit = null;
  for (const h of habits || []) {
    if (!TRACKABLE.includes(h.habit_type) || h.habit_type === "log") continue;
    const recentLogs = (h.logs || [])
      .filter(l => l.value !== null && l.value !== undefined && l.value !== false && l.value !== "skip")
      .sort((a, b) => b.date.localeCompare(a.date));
    if (recentLogs.length === 0) continue;
    const gap = daysBetween(recentLogs[0].date, todayYmd);
    if (gap >= 2 && gap > worstGap) {
      worstGap = gap;
      gapHabit = h;
    }
  }
  if (gapHabit) {
    const e = gapHabit.emoji || "💪";
    return {
      title: "Forged",
      body: `${e} ${gapHabit.name} — ${worstGap} days since your last log. Today's the day.`,
    };
  }

  const totalCount = trackableHabits.length;
  if (totalCount > 0) {
    return {
      title: "Forged",
      body: `${totalCount} habit${totalCount === 1 ? "" : "s"} to log today. Let's build. 🔨`,
    };
  }

  return { title: "Forged", body: "Time to log your habits 🔥" };
}

async function aiPickMessage(name, habits, goals, todayYmd) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const TRACKABLE = ["daily", "weekly", "project", "limit"];

  const summaries = (habits || [])
    .filter(h => TRACKABLE.includes(h.habit_type) && h.habit_type !== "log")
    .map(h => {
      const streak = h.habit_type === "daily" ? getDailyStreak(h, todayYmd) : 0;
      const doneToday = strictLoggedProgressToday(h, todayYmd);
      const recentLogs = (h.logs || [])
        .filter(l => l.date >= daysAgoFrom(todayYmd, 7))
        .sort((a, b) => b.date.localeCompare(a.date));
      const reflections = recentLogs.filter(l => l.reflection).slice(0, 2).map(l => l.reflection);
      let line = `- ${h.emoji || ""} ${h.name} (streak: ${streak}d, logged today: ${doneToday})`;
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

  const prompt = `You are a friendly habit coach sending ${name} a short push notification for their Forged app.

Their habits for local calendar date ${todayYmd}:
${summaries || "No habits yet"}
${goalLine}

Write ONE push notification body (max 110 chars). Be direct, warm, and specific to their actual data. No hashtags, no quotes around it, just the text. Always end with "Love, Forged." — no exceptions.

Hard rules:
- NEVER claim they completed a workout, session, or habit TODAY unless that habit's line explicitly shows logged today: true.
- NEVER invent numbers, streaks, or events not present in the data above.
- If every line shows logged today: false, do not congratulate them for finishing today — nudge them to log instead.
- "log" / journal-only lines are omitted; do not mention them.
- Always end the message with exactly: Love, Forged.`;

  try {
    const client = new Anthropic({ apiKey: apiKey.trim() });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 80,
      messages: [{ role: "user", content: prompt }],
    });
    const text = resp.content?.[0]?.text?.trim();
    if (text) return { title: "Forged 🔥", body: text };
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

  // Startup line — surfaces in Vercel logs every cron fire. Lets you confirm
  // the env vars and dev-pool version that are actually live in production.
  console.log("[Forged cron] start", {
    mode: cronMode,
    isWindowed,
    dev_pool_version: DEV_POOL_VERSION,
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
      "user_id, name, emoji, habit_type, logs, target_date, goal_status, weekly_target, daily_budget, daily_target_minutes"
    )
    .in("user_id", userIds);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, is_pro")
    .in("id", userIds);

  const profileByUser = {};
  for (const p of profiles || []) profileByUser[p.id] = p;

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
  const staleIds = [];
  // Per-user trace populated when DEBUG_CRON=1; surfaced in the response so
  // you can hit the cron manually with curl + Bearer CRON_SECRET to see who
  // got picked and why.
  const trace = [];

  console.log(`[Forged cron] subscribers loaded count=${subs.length}`);

  for (const sub of subs) {
    const tz = tzByUser[sub.user_id] || "UTC";
    const todayYmd = ymdNowInTimeZone(tz);
    const now = hourMinuteNowInTimeZone(tz); // needed for both windowed check + message slot
    const isDevOwner = sub.user_id === DEV_OWNER_ID;

    // Verbose dev-owner trace — every decision printed so we can prove
    // exactly which branch fired for any given notification.
    if (isDevOwner) {
      console.log("[dev-owner] match", {
        user_id: sub.user_id,
        version: DEV_POOL_VERSION,
        tz,
        todayYmd,
        local_hour: now.hour,
        local_minute: now.minute,
        cron_mode: cronMode,
        send_interval_hours: DEV_OWNER_SEND_INTERVAL_HOURS,
        daily_reminders_enabled: sub.daily_reminders_enabled,
      });
    }

    // ── Per-category gate: skip users who turned off daily reminders ────
    if (sub.daily_reminders_enabled === false) {
      if (isDevOwner) console.log("[dev-owner] skip reason=category_disabled");
      if (debug) trace.push({ user_id: sub.user_id, skipped: "category_disabled" });
      skippedCategory++;
      continue;
    }

    // ── Windowed mode ───────────────────────────────────────────────────
    // Dev owner: fire at the :00 bucket of every even hour (0,2,4,...,22).
    // Normal users: fire at 7am, 12pm, 7pm local time (:00 bucket only).
    // This replaces the old per-user reminder_time approach — everyone gets
    // the same three fixed daily touchpoints, and dev owner gets 12 per day.
    if (isWindowed) {
      if (isDevOwner) {
        // Only even hours at the :00 bucket (every DEV_OWNER_SEND_INTERVAL_HOURS hours)
        const isEvenHour = now.hour % DEV_OWNER_SEND_INTERVAL_HOURS === 0;
        if (!isEvenHour || bucketMinute(now.minute) !== 0) {
          console.log("[dev-owner] skip reason=window_not_interval_hour", {
            hour: now.hour, minute: now.minute, interval: DEV_OWNER_SEND_INTERVAL_HOURS,
          });
          if (debug) trace.push({ user_id: sub.user_id, skipped: "window_not_interval_hour", hour: now.hour });
          skippedWindow++; continue;
        }
      } else {
        // Normal users: only fire at 7, 12, 19 local time, :00 bucket
        if (!NORMAL_FIRE_HOURS.includes(now.hour) || bucketMinute(now.minute) !== 0) {
          if (debug) trace.push({
            user_id: sub.user_id, skipped: "window_miss",
            tz, now_local: now, fire_hours: NORMAL_FIRE_HOURS,
          });
          skippedWindow++;
          continue;
        }
      }
    }

    // ── Dedupe ──────────────────────────────────────────────────────────
    // Dev owner: key = "YYYY-MM-DDH{hour}" — one send per local hour (only even
    //   hours fire, so effectively one per 2-hour window).
    // Normal users: key = "YYYY-MM-DD_{slot}" where slot = morning|noon|evening —
    //   allows up to 3 sends per day, one per slot, no duplicates within a slot.
    const dedupKey = isDevOwner
      ? `${todayYmd}H${now.hour}`
      : `${todayYmd}_${normalUserSlot(now.hour)}`;

    if (sub.last_reminder_sent_date && sub.last_reminder_sent_date === dedupKey) {
      if (isDevOwner) console.log("[dev-owner] skip reason=dedup", { dedupKey, last: sub.last_reminder_sent_date });
      if (debug) trace.push({ user_id: sub.user_id, skipped: "dedup", dedup_key: dedupKey, last: sub.last_reminder_sent_date });
      skippedDedup++;
      continue;
    }

    const habits = habitsByUser[sub.user_id] || [];
    const goals = goalsByUser[sub.user_id] || [];
    const profile = profileByUser[sub.user_id] || {};

    let title;
    let body;
    let pickMeta = null;
    if (isDevOwner) {
      // Personal dev-owner notifications — time-of-day aware, escape-the-9-to-5 framing.
      // Scoped exclusively to DEV_OWNER_ID; never reaches any other user.
      const picked = pickDevOwnerMessage(habits, goals, todayYmd, now.hour);
      title = picked.title;
      body = picked.body;
      pickMeta = picked.meta;
      console.log("[dev-owner] picked", {
        version: DEV_POOL_VERSION,
        title,
        body,
        ...pickMeta,
        habits_count: habits.length,
        dedup_key: dedupKey,
      });
    } else if (profile.is_pro && process.env.ANTHROPIC_API_KEY) {
      const aiMsg = await aiPickMessage(profile.name || "there", habits, goals, todayYmd);
      ({ title, body } = aiMsg || pickNormalMessage(habits, goals, todayYmd, now.hour));
    } else {
      ({ title, body } = pickNormalMessage(habits, goals, todayYmd, now.hour));
    }

    // Hard guard: dev owner must NEVER receive the generic title. If this
    // ever logs, the dev branch silently failed — investigate immediately.
    if (isDevOwner && title !== DEV_TITLE_DEFAULT && title !== DEV_TITLE_ALL_LOGGED) {
      console.error("[dev-owner] FALLBACK FIRED — generic branch leaked through", { title, body });
    }

    const payload = JSON.stringify({ title, body, url: "/", tag: "forged-reminder" });

    try {
      await webpush.sendNotification(sub.subscription, payload);
      sent++;
      if (isDevOwner) console.log("[dev-owner] sent", { dedup_key: dedupKey });
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
    `[Forged cron] done mode=${cronMode} dev_pool=${DEV_POOL_VERSION} sent=${sent} failed=${failed} skipped_dedup=${skippedDedup} skipped_window=${skippedWindow} skipped_category=${skippedCategory} stale_removed=${staleIds.length}`
  );
  return res.status(200).json({
    mode: cronMode,
    dev_pool_version: DEV_POOL_VERSION,
    subs_total: subs.length,
    sent,
    failed,
    skippedDedup,
    skippedWindow,
    skippedCategory,
    staleRemoved: staleIds.length,
    // Only present when DEBUG_CRON=1 — full per-user reasoning.
    ...(debug ? { trace } : {}),
  });
}

export default withSentry(handler, "cron-reminders");
