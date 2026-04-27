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
const DEV_POOL_VERSION = "v3-2026-04-25";

// Distinct titles ONLY used by the dev-owner branch so notifications are
// visually distinguishable from the generic pool. If a notification ever
// arrives titled "Forged 🔥" / "Forged ✅" / "Forged 🎯", that means the
// generic branch fired (something's wrong). Captain titles = dev branch.
const DEV_TITLE_DEFAULT     = "Forged ⚡ Captain";
const DEV_TITLE_ALL_LOGGED  = "Forged 🔨 Captain";

// Set true to send every hour (for testing whether hourly reminders motivate or annoy).
// When false, reverts to single daily send at DEV_OWNER_SINGLE_HOUR.
const DEV_OWNER_HOURLY_MODE = true;
const DEV_OWNER_SINGLE_HOUR = 5;   // only used when DEV_OWNER_HOURLY_MODE = false

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
      "Oi captain, get the fuck up. You've got shit to do.",
      "5am. The world's still asleep. Move while no fucker can stop you.",
      "Up before the boss. Up before the bullshit. That's the whole game.",
      "Eyes open. Phone down. Build something before the world's noise kicks in.",
      "Pre-dawn hour. Nobody's emailing yet. Ship some shit quietly.",
      "If you want out, you don't get to sleep through the only quiet fucking hour.",
      "Wake up properly. Stretch. Log it. Then go fucking earn it.",
      "5am isn't punishment. It's the head start nobody else takes.",
      "You set the alarm. Honour the version of you that wanted this.",
      "Most of the world is unconscious. You're early — act like it fucking matters.",
      "Before the inbox. Before the meetings. Before the bullshit. This is your hour.",
      "Don't piss away the only time of day that's actually quiet.",
      "Up at 5? Good. Now don't fuck it off on TikTok. Build.",
      "Coffee, log, build. In that order. No phone for ten.",
      "Fun fact: cortisol peaks 30 mins after waking. Use the spike before it bails on you.",
      "Fun fact: nearly every founder you've heard of woke up early. Mostly because they actually wanted it.",
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
      "Morning. The day's about to ask shit of you. Get yours in fucking first.",
      "Quick log before the boss owns your inbox. Two minutes, do the damn thing.",
      "Morning window's closing. Don't roll into work having logged jack shit.",
      "Phone down. Habits in. Then go pretend to give a fuck about meetings.",
      "If even you don't open this app first thing, who the fuck will?",
      "Morning routines aren't soft shit. They're the only thing keeping you sane.",
      "Log it before you scroll. That's the whole damn rule.",
      "You can't outwork chaos at 5pm. So set the day up now, you absolute donkey.",
      "Two minutes. That's all this needs. Don't be a wet fucking rag about it.",
      "Coffee, habits, plan. Then the day can come at you with whatever shit it has.",
      "The version of you at 7am makes the version at 7pm. Choose well.",
      "Get the easy wins in early so you can fight bigger battles later.",
      "Don't start the day on someone else's terms. Log first.",
      "Up. Move. Log. Then you can hate Monday like everyone else.",
      "Fun fact: how you spend the first hour decides the next twelve. Spend it well.",
      "Fun fact: a logged habit triggers dopamine. Basically free drugs. Take it.",
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
      "At work. Fine. Don't forget this isn't the whole fucking story.",
      "Punched in for them. Your real fucking job starts after 5.",
      "The 9-to-5 pays the rent. The side work buys the exit. Remember that shit.",
      "Look productive. Stay quiet. Save the real fight for tonight.",
      "Survive the morning. Save your good ideas for when you're not paid to give them away.",
      "If you won't use your own app at work, who the fuck is going to?",
      "Office shit. Boring. Fine. The mission's still alive — log it.",
      "Two minutes between meetings is a free habit log. Use the damn thing.",
      "Don't let the morning grind kill the evening's plan.",
      "You're trading hours for money right now. Make the hours after fucking worth it.",
      "Stay sharp. They don't pay you enough to give them all your fucking brain.",
      "Mid-shift. The escape plan doesn't pause because you're at work. Log it.",
      "Boring meeting? Log a habit under the damn table. Pure rebellion.",
      "Slipping into the workday autopilot? Snap the fuck out. Log something.",
      "The cubicle isn't permanent. Unless you treat it like it is.",
      "Fun fact: most of your boss's bosses also have side projects. You're not weird, you're early.",
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
      "Lunch. Don't fucking scroll. Log it. Eat. Reset.",
      "Half the workday gone. Tonight still belongs to you. Don't fucking forget.",
      "Midday slump incoming. Log first, then nap on the damn thing.",
      "Twelve hours of life left today. Make the back half count.",
      "Eat properly. Log it. Then go survive the afternoon.",
      "Lunch break is for you, not your phone. Two minutes, log, then breathe.",
      "Halfway through someone else's day. Yours starts in five hours. Be fucking ready.",
      "Don't waste lunch reading shit you'll forget in an hour.",
      "Quick log before the food coma. Future you will thank you.",
      "Midday window. Reset. The afternoon can be a slog or a setup. Your fucking call.",
      "Eat. Log. Walk. Don't scroll. That's the play.",
      "Lunch is the cheapest reset of the day. Don't waste it hunched over a damn screen.",
      "If you scroll through lunch, you'll scroll through tonight too. Break the chain.",
      "One log. Ten minutes outside. Game on, you donkey.",
      "Half the workday survived. The mission's still alive. Stay sharp.",
      "Fun fact: a 10-minute walk after eating crushes the slump. You're welcome.",
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
      "Stop fucking drifting. The afternoon's where weak weeks die.",
      "Home stretch. Don't lose the fucking plot now. The evening's coming.",
      "One more shift. Then you build your own shit. Hold the damn line.",
      "Afternoon at someone else's desk. Soon enough it'll be your own.",
      "Don't crash into 5pm exhausted. Save fuel for the evening.",
      "Boredom is the cost of the day job. Don't let it eat your fucking night.",
      "Almost out. Plan one thing you'll ship tonight. Just one.",
      "Coffee, focus, finish. Then go work on the thing that actually matters.",
      "If the afternoon kills your spark, the evening's already lost. Hold.",
      "Halfway through the worst part of the day. Push the fuck through.",
      "Don't fall asleep at the wheel. Both literally and metaphorically, you donkey.",
      "End-of-shift drift incoming. Snap out. Log a habit. Reset.",
      "The afternoon you waste is the evening you can't have. Move.",
      "Survive. Just survive. The good hours are after this.",
      "Three more hours of pretending to give a shit. Then you get the real thing.",
      "Fun fact: post-lunch energy crashes are universal. So is the option to push through them.",
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
      "Shift's done. Open the fucking laptop. The real day starts now.",
      "Home time. The escape plan doesn't build itself, you donkey.",
      "Clock out from them. Clock in for you. That's the fucking deal.",
      "No boss tonight. Good. Now stop fucking drifting.",
      "You survived work. The night belongs to you. Don't piss it on Netflix.",
      "If you won't use your own app right now, who the fuck will?",
      "This is the hour you complained about not having all day. You have it. Use the shit out of it.",
      "Evening's yours. Build the thing. Or admit you don't actually want out.",
      "You said you wanted out. Cool. Build like it.",
      "Came home. Sat down. The easy choice is nothing. Make the hard one.",
      "Two hours of actual work tonight beats a week of good fucking intentions.",
      "Open the laptop before you open the fridge. That's the order.",
      "Six hours till bedtime. That's a lot of time to build. Or waste. Pick.",
      "After-work autopilot is the killer. Snap the fuck out. Open the thing.",
      "Tonight you either move forward or stay in this exact same spot. Choose.",
      "The evening's a window, not a fucking couch. Use it.",
      "Forged works because somebody built the damn thing. Build the next one.",
      "Fun fact: this exact hour is when most failed founders give up. Don't be one.",
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
      "Evening's ticking. One real fucking push. Then you can switch off.",
      "Stop fucking drifting. Either build or rest. Don't mid-zone.",
      "Don't waste the night. One thing. Just one, you donkey.",
      "You've still got time. Own it or own the fact you didn't.",
      "It's not too late to log it. Two minutes. Do the damn thing.",
      "One real hour tonight beats a week of good fucking intentions.",
      "Last real window. Use it or admit you didn't want to.",
      "If you start now, you can ship one thing before bed. Just fucking start.",
      "Either go hard or shut down properly. Don't half-arse this hour.",
      "Brain's tired. Cool. Hands still work. Type some shit.",
      "Tonight you choose: progress or scroll. There's no third fucking option.",
      "End of day. Either log it now or lose the data point. Two minutes, move.",
      "You're going to remember either tonight's progress or tonight's scroll. Pick now.",
      "Last call. Make this hour count or close the damn laptop properly.",
      "One small win before bed. That's all. Then sleep wins.",
      "Fun fact: the last hour before bed often produces the cleanest work. Try it.",
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
      "Late. Log it or sleep. Both beat fucking drifting.",
      "Still up? Either ship or sleep. Don't mid-zone, you donkey.",
      "Night mode. Quick log. Then close the fucking laptop.",
      "Late but not wasted if you log it right now.",
      "It's late. You have work tomorrow. Log and shut the shit down.",
      "Up late on a school night? Honour it — log, then sleep hard.",
      "Don't be the dickhead who's fucking exhausted tomorrow because they scrolled tonight.",
      "Last call. Log or lose the data point. Then sleep.",
      "Night. The honest hour. Did you build today? Yes or no? Then sleep on the damn answer.",
      "Two minutes to log. Then sleep — properly, not while scrolling shit.",
      "Late night. Quick log. Lights out. Repeat tomorrow.",
      "Fun fact: missing sleep is one of the few things you can't outwork. Sleep.",
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
    "Full house on a workday. Now stop celebrating and ship the fucking thing.",
    "All habits in. The minimum bar. Now go raise it, you donkey.",
    "Logged. Logged. Logged. Cool — now kick the fucking door down.",
    "Mid-week full sweep. Discipline confirmed. Now spend it on something real.",
    "All habits done. So what the fuck are you actually building tonight?",
    "Clean slate, all logged. Now go produce something the world hasn't seen.",
    "Habits — handled. The actual fucking work is still waiting. Get to it.",
    "Full set on a workday. You're operating above the lazy fuckers. Don't drift.",
    "All in. Tight ship. Now ship the goddamn product.",
    "You logged everything. The boring shit's out the way. BUILD.",
    "Habits cleared. The mission isn't. Move, captain.",
    "Done with the warm-up. Now do the real fucking work.",
    "All logged. Most people will brag about this for a week. You'll do it again tomorrow.",
    "Full sweep. Now answer the only question that matters: what shipped?",
    "Habits — done. Forged isn't going to fucking build itself. You up?",
    "Mid-week full house. The week's yours if you don't sit on it.",
  ],
  weekend: [
    "Full sweep on a free day. Now go ship something nobody fucking asked for.",
    "All habits logged on a weekend. The leverage hour starts now. Use the shit out of it.",
    "Habits handled. The real fucking work is waiting. Open the laptop.",
    "Done with the easy wins. The hard ones build the exit. Get to them.",
    "Logged. Now build the thing the habits exist to support, captain.",
    "Weekend sweep complete. While the world brunches, you ship. Carry on.",
    "All habits in on a free day. Anything less than building now is a fucking waste.",
    "Discipline confirmed. Now produce the goddamn thing.",
    "Floor reached. Now find the ceiling, you donkey.",
    "Full house on a weekend. Most people coast from here. Don't be most people.",
    "Habits cleared on a free day. Now build the thing that pays for never having to do this again.",
    "Weekend full sweep. The real fucking work is the next hour. Move.",
    "All logged on a Saturday/Sunday. Half the battle. Now do the other half.",
    "Done with the boring shit. Now do the work that scares you a bit. That's the right one.",
    "Full set on a weekend. The captain's awake. Now sail the damn ship.",
    "All habits in. Forged was built on weekends like this. Build the next thing.",
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

  const prompt = `You are a habit coach sending ${name} a short push notification for their Forged app.

Their habits for local calendar date ${todayYmd}:
${summaries || "No habits yet"}
${goalLine}

Write ONE push notification body (max 90 chars). Be direct, specific to their actual data, motivating but not cheesy. No hashtags, no quotes around it, just the text.

Hard rules:
- NEVER claim they completed a workout, session, or habit TODAY unless that habit's line explicitly shows logged today: true.
- NEVER invent numbers, streaks, or events not present in the data above.
- If every line shows logged today: false, do not congratulate them for finishing today — nudge them to log instead.
- "log" / journal-only lines are omitted; do not mention them.`;

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
        hourly_mode: DEV_OWNER_HOURLY_MODE,
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
    // Dev owner hourly mode: fire at the top of every hour (minute bucket 0).
    // Dev owner single mode: fire at DEV_OWNER_SINGLE_HOUR:00 only.
    // Everyone else: fire at their configured reminder_time bucket.
    if (isWindowed) {
      if (isDevOwner && DEV_OWNER_HOURLY_MODE) {
        // Only the :00 bucket each hour — prevents firing every 5 minutes
        if (bucketMinute(now.minute) !== 0) {
          if (isDevOwner) console.log("[dev-owner] skip reason=window_not_top_of_hour", { minute: now.minute });
          if (debug) trace.push({ user_id: sub.user_id, skipped: "window_not_top_of_hour", minute: now.minute });
          skippedWindow++; continue;
        }
      } else {
        const target = isDevOwner
          ? { hour: DEV_OWNER_SINGLE_HOUR, minute: 0 }
          : parseReminderTime(sub.reminder_time);
        if (now.hour !== target.hour || bucketMinute(now.minute) !== bucketMinute(target.minute)) {
          if (isDevOwner) console.log("[dev-owner] skip reason=window_miss", { now, target });
          if (debug) trace.push({
            user_id: sub.user_id, skipped: "window_miss",
            tz, now_local: now, target,
          });
          skippedWindow++;
          continue;
        }
      }
    }

    // ── Dedupe ──────────────────────────────────────────────────────────
    // Dev owner hourly: key = "YYYY-MM-DDH{hour}" — one send per local hour.
    // Everyone else: key = "YYYY-MM-DD" — one send per local day.
    // The hour key never equals a plain date string so regular users are unaffected.
    const dedupKey = (isDevOwner && DEV_OWNER_HOURLY_MODE)
      ? `${todayYmd}H${now.hour}`
      : todayYmd;

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
      ({ title, body } = aiMsg || pickMessage(habits, goals, todayYmd));
    } else {
      ({ title, body } = pickMessage(habits, goals, todayYmd));
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
