/**
 * Populate the "Client Test" spare demo account with ~14 days of realistic data.
 *
 *   node --env-file=.env.local scripts/seed-demo-client-test.mjs
 *     → requires SUPABASE_SERVICE_ROLE_KEY; resolves user by DEMO_EMAIL.
 *
 *   node scripts/seed-demo-client-test.mjs --emit-sql > scripts/demo-client-test-seed.sql
 *     → prints SQL (relative dates) for pasting into Supabase SQL Editor — no API keys.
 *
 * Idempotent: fixed habit UUIDs + journal upsert by (user_id, date).
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFallback() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFallback();

const EMIT_SQL = process.argv.includes("--emit-sql");
const WRITE_SQL = process.argv.includes("--write-sql");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://apdmvbzfjuvxworjepze.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_EMAIL = (process.env.DEMO_EMAIL || "cheesefingersathotmail.co.n@gmail.com").toLowerCase().trim();
const DEMO_NAME = process.env.DEMO_NAME || "Client Test";

const IDS = {
  walk: "b1e00001-0001-4001-8001-000000000001",
  water: "b1e00001-0001-4001-8001-000000000002",
  sleep: "b1e00001-0001-4001-8001-000000000003",
  nic: "b1e00001-0001-4001-8001-000000000004",
  junk: "b1e00001-0001-4001-8001-000000000005",
  study: "b1e00001-0001-4001-8001-000000000006",
  weight: "b1e00001-0001-4001-8001-000000000007",
  moodLog: "b1e00001-0001-4001-8001-000000000008",
};

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** dayStrs[0] = 13 days ago, dayStrs[13] = today (Node process local calendar). */
function last14LocalDays() {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(toYmd(d));
  }
  return out;
}

function baseHabitRow(overrides) {
  const now = new Date().toISOString();
  return {
    streak: 0,
    best_streak: 0,
    reflection: true,
    reflection_prompt: "",
    weekly_target: null,
    start_value: null,
    target_value: null,
    unit: null,
    daily_budget: null,
    tap_increment: 1,
    daily_target_minutes: null,
    shared_goal_id: null,
    goal_status: null,
    target_date: null,
    direction: null,
    updated_at: now,
    ...overrides,
  };
}

function buildDemoPayload(userId, dayStrs) {
  const d = (i) => dayStrs[i];

  const walkLogs = [];
  const walkPattern = [
    { v: true, note: "like 12 min. legs felt heavy lol" },
    null,
    { v: true, note: "" },
    { v: "skip", note: "rain + lazy combo" },
    { v: true, note: "", reflection: "noticed when i walk first i dont demolish the pantry after" },
    null,
    { v: true, note: "20 min around the block" },
    { v: true, note: "" },
    { v: true, note: "park loop" },
    null,
    { v: true, note: "" },
    { v: true, note: "before work. actually helped" },
    { v: true, note: "" },
    { v: true, note: "short one but i showed up" },
  ];
  for (let i = 0; i < 14; i++) {
    const p = walkPattern[i];
    if (!p) continue;
    const { v, note = "", reflection } = p;
    walkLogs.push({
      date: d(i),
      value: v,
      note: note || "",
      ...(reflection ? { reflection } : {}),
    });
  }

  const waterLogs = [];
  const waterPattern = [{ v: true }, null, { v: true }, { v: true }, null, { v: true }, { v: true }, { v: true }, { v: true }, { v: true }, { v: true }, null, { v: true }, { v: true }];
  for (let i = 0; i < 14; i++) {
    if (!waterPattern[i]) continue;
    waterLogs.push({ date: d(i), value: true, note: "" });
  }

  const sleepLogs = [];
  const sleepPattern = [
    null,
    { v: true, note: "" },
    null,
    null,
    { v: true, note: "", reflection: "took melatonin at 10, slept deeper than usual" },
    null,
    { v: true },
    { v: true },
    { v: true },
    null,
    { v: true },
    { v: true },
    { v: true },
    { v: true },
  ];
  for (let i = 0; i < 14; i++) {
    const p = sleepPattern[i];
    if (!p) continue;
    sleepLogs.push({
      date: d(i),
      value: p.v,
      note: p.note || "",
      ...(p.reflection ? { reflection: p.reflection } : {}),
    });
  }

  const nicLogs = [];
  const nicTotals = [22, 18, 20, 14, 19, 17, 12, 11, 15, 10, 9, 13, 8, 7];
  for (let i = 0; i < 14; i++) {
    nicLogs.push({
      date: d(i),
      value: nicTotals[i],
      note: i === 0 ? "stress day at work" : i === 9 ? "wanted one after dinner, stopped at 10" : "",
    });
  }

  const junkLogs = [];
  const junkTotals = [3, 2, 4, 1, 2, 2, 1, 1, 0, 1, 1, 2, 1, 1];
  for (let i = 0; i < 14; i++) {
    junkLogs.push({
      date: d(i),
      value: junkTotals[i],
      note: i === 2 ? "friend ordered fries, i had a few" : i === 8 ? "logged 0 — proud" : "",
    });
  }

  const studyLogs = [];
  const studyPattern = [
    { minutes: 25, win: "finished one messy practice quiz", hardPart: "ADHD brain wanted to tab out every 4 min" },
    null,
    { minutes: 35 },
    null,
    { minutes: 20 },
    { minutes: 40, win: "finally understood the vpc section a little" },
    null,
    { minutes: 30 },
    { minutes: 55, hardPart: "started late bc i was scrolling" },
    { minutes: 25 },
    null,
    { minutes: 45 },
    { minutes: 35, win: "2 pomodoros for real" },
    { minutes: 30 },
  ];
  for (let i = 0; i < 14; i++) {
    const p = studyPattern[i];
    if (!p) continue;
    studyLogs.push({
      date: d(i),
      value: { minutes: p.minutes, ...(p.win ? { win: p.win } : {}), ...(p.hardPart ? { hardPart: p.hardPart } : {}) },
      note: "",
    });
  }

  const weightLogs = [
    { date: d(0), value: 218.4, note: "morning, after coffee" },
    { date: d(3), value: 217.9, note: "" },
    { date: d(5), value: 217.5, note: "" },
    { date: d(7), value: 217.0, note: "walked more this week, who knows" },
    { date: d(9), value: 216.6, note: "" },
    { date: d(11), value: 216.1, note: "" },
    { date: d(13), value: 215.7, note: "scale bounced 216 yesterday, whatever" },
  ];

  const moodLogs = [
    { date: d(1), value: "log", note: "kinda down but trying not to spiral" },
    { date: d(4), value: "log", note: "better mood after the walk. not magic but better" },
    { date: d(8), value: "log", note: "irritable until i drank water lol" },
    { date: d(12), value: "log", note: "small win: didnt order delivery tonight" },
  ];

  const end = new Date();
  end.setHours(12, 0, 0, 0);
  end.setDate(end.getDate() + 52);
  const weightTargetDate = toYmd(end);

  const habitRows = [
    baseHabitRow({
      id: IDS.walk,
      user_id: userId,
      name: "Walk / move",
      emoji: "🚶",
      habit_type: "daily",
      color: "#27AE60",
      logs: walkLogs,
      streak: 4,
      best_streak: 4,
      reflection: true,
    }),
    baseHabitRow({
      id: IDS.water,
      user_id: userId,
      name: "Water (2L-ish)",
      emoji: "💧",
      habit_type: "daily",
      color: "#3498DB",
      logs: waterLogs,
      streak: 2,
      best_streak: 7,
      reflection: false,
    }),
    baseHabitRow({
      id: IDS.sleep,
      user_id: userId,
      name: "In bed by 11:30",
      emoji: "🌙",
      habit_type: "daily",
      color: "#9B59B6",
      logs: sleepLogs,
      streak: 3,
      best_streak: 3,
      reflection: true,
    }),
    baseHabitRow({
      id: IDS.nic,
      user_id: userId,
      name: "Vape hits",
      emoji: "🚭",
      habit_type: "limit",
      color: "#E67E22",
      daily_budget: 16,
      unit: "hits",
      logs: nicLogs,
      streak: 2,
      best_streak: 2,
      reflection: false,
    }),
    baseHabitRow({
      id: IDS.junk,
      user_id: userId,
      name: "Junk / drive-thru",
      emoji: "🍟",
      habit_type: "limit",
      color: "#C0392B",
      daily_budget: 2,
      unit: "servings",
      logs: junkLogs,
      streak: 5,
      best_streak: 5,
      reflection: false,
    }),
    baseHabitRow({
      id: IDS.study,
      user_id: userId,
      name: "Cert study (AWS)",
      emoji: "📚",
      habit_type: "project",
      color: "#C8902A",
      daily_target_minutes: 45,
      logs: studyLogs,
      streak: 2,
      best_streak: 2,
      reflection: true,
    }),
    baseHabitRow({
      id: IDS.weight,
      user_id: userId,
      name: "Weight",
      emoji: "⚖️",
      habit_type: "goal",
      color: "#E67E22",
      start_value: 218.4,
      target_value: 210,
      unit: "lbs",
      target_date: weightTargetDate,
      goal_status: "active",
      direction: "decreasing",
      logs: weightLogs,
      streak: 0,
      best_streak: 0,
      reflection: false,
    }),
    baseHabitRow({
      id: IDS.moodLog,
      user_id: userId,
      name: "Quick mood",
      emoji: "📝",
      habit_type: "log",
      color: "#95A5A6",
      logs: moodLogs,
      streak: 0,
      best_streak: 0,
      reflection: false,
    }),
  ];

  const journalRows = [
    {
      date: d(2),
      content:
        "Rough Tuesday. Didn't sleep enough and everything felt harder — snapped at my roommate over dishes like a loser. I still logged stuff though. That's new for me.",
    },
    {
      date: d(6),
      content:
        "Weirdly good day? Walked, studied, and I wasn't as hungry for garbage food. I think the sleep thing is the real boss fight. When I'm tired I reach for everything.",
    },
    {
      date: d(9),
      content:
        "Slipped a little on nic but not catastrophically. I hate that it's tied to boredom. Gonna try leaving my phone in the kitchen at night again.",
    },
    {
      date: d(11),
      content:
        "Two weeks of this app and I'm not 'fixed' — but I'm paying attention more. The weight number moved a tiny bit. I'll take it.",
    },
    {
      date: d(13),
      content:
        "Recording this before bed. Not perfect this week, but more walks than last week and fewer 1am doom-scrolls. Progress isn't linear blah blah but it's actually true.",
    },
  ];

  return { habitRows, journalRows, dayStrs };
}

function sqlLiteral(text) {
  return "'" + String(text).replace(/'/g, "''") + "'";
}

function sqlJsonb(obj) {
  return sqlLiteral(JSON.stringify(obj)) + "::jsonb";
}

function emitPostgresSql({ habitRows, journalRows, dayStrs }) {
  const emailLit = sqlLiteral(DEMO_EMAIL);
  const lines = [];
  lines.push("-- Demo seed: Client Test account");
  lines.push("-- Resolves user_id from auth.users by email; safe to re-run.");
  lines.push("begin;");
  lines.push("");
  lines.push(`with demo_user as (
  select id as user_id from auth.users where lower(email) = lower(${emailLit}) limit 1
)
update public.profiles p
set
  name = ${sqlLiteral(DEMO_NAME)},
  onboarded = true,
  xp = 380,
  updated_at = now()
from demo_user u
where p.id = u.user_id;`);
  lines.push("");

  const habitCols = [
    "id",
    "user_id",
    "name",
    "emoji",
    "habit_type",
    "color",
    "logs",
    "streak",
    "best_streak",
    "reflection",
    "reflection_prompt",
    "weekly_target",
    "start_value",
    "target_value",
    "unit",
    "daily_budget",
    "tap_increment",
    "daily_target_minutes",
    "shared_goal_id",
    "goal_status",
    "target_date",
    "direction",
    "updated_at",
  ];

  for (const row of habitRows) {
    const vals = [
      sqlLiteral(row.id) + "::uuid",
      "(select user_id from demo_user)",
      sqlLiteral(row.name),
      sqlLiteral(row.emoji),
      sqlLiteral(row.habit_type),
      sqlLiteral(row.color),
      sqlJsonb(row.logs),
      String(row.streak),
      String(row.best_streak),
      row.reflection ? "true" : "false",
      sqlLiteral(row.reflection_prompt || ""),
      row.weekly_target == null ? "null" : String(row.weekly_target),
      row.start_value == null ? "null" : String(row.start_value),
      row.target_value == null ? "null" : String(row.target_value),
      row.unit == null ? "null" : sqlLiteral(row.unit),
      row.daily_budget == null ? "null" : String(row.daily_budget),
      String(row.tap_increment ?? 1),
      row.daily_target_minutes == null ? "null" : String(row.daily_target_minutes),
      "null",
      row.goal_status == null ? "null" : sqlLiteral(row.goal_status),
      row.target_date == null ? "null" : sqlLiteral(row.target_date),
      row.direction == null ? "null" : sqlLiteral(row.direction),
      "now()",
    ];
    lines.push(`with demo_user as (
  select id as user_id from auth.users where lower(email) = lower(${emailLit}) limit 1
)
insert into public.habits (${habitCols.join(", ")})
select ${vals.join(", ")}
on conflict (id) do update set
  user_id = excluded.user_id,
  name = excluded.name,
  emoji = excluded.emoji,
  habit_type = excluded.habit_type,
  color = excluded.color,
  logs = excluded.logs,
  streak = excluded.streak,
  best_streak = excluded.best_streak,
  reflection = excluded.reflection,
  reflection_prompt = excluded.reflection_prompt,
  weekly_target = excluded.weekly_target,
  start_value = excluded.start_value,
  target_value = excluded.target_value,
  unit = excluded.unit,
  daily_budget = excluded.daily_budget,
  tap_increment = excluded.tap_increment,
  daily_target_minutes = excluded.daily_target_minutes,
  shared_goal_id = excluded.shared_goal_id,
  goal_status = excluded.goal_status,
  target_date = excluded.target_date,
  direction = excluded.direction,
  updated_at = excluded.updated_at;`);
    lines.push("");
  }

  for (const jr of journalRows) {
    lines.push(`with demo_user as (
  select id as user_id from auth.users where lower(email) = lower(${emailLit}) limit 1
)
insert into public.journal_entries (user_id, date, content, updated_at)
select (select user_id from demo_user), ${sqlLiteral(jr.date)}::date, ${sqlLiteral(jr.content)}, now()
on conflict (user_id, date) do update set
  content = excluded.content,
  updated_at = excluded.updated_at;`);
    lines.push("");
  }

  lines.push(`-- Calendar window used (runner's local TZ when SQL was generated): ${dayStrs[0]} .. ${dayStrs[13]}`);
  lines.push("commit;");
  return lines.join("\n");
}

async function findUserIdByEmail(admin) {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find((u) => (u.email || "").toLowerCase() === DEMO_EMAIL);
    if (hit) return hit.id;
    if (users.length < perPage) break;
    page++;
  }
  return null;
}

async function main() {
  const dayStrs = last14LocalDays();
  const placeholderUser = "00000000-0000-4000-8000-000000000000";
  const { habitRows, journalRows } = buildDemoPayload(placeholderUser, dayStrs);
  // Strip placeholder — SQL uses demo_user CTE; API path sets real userId on rows
  const habitRowsForSql = habitRows.map((r) => ({ ...r, user_id: placeholderUser }));

  if (EMIT_SQL || WRITE_SQL) {
    const sql = emitPostgresSql({ habitRows: habitRowsForSql, journalRows, dayStrs });
    if (WRITE_SQL) {
      const outPath = join(root, "scripts", "demo-client-test-seed.sql");
      writeFileSync(outPath, sql, "utf8");
      console.error("Wrote", outPath);
    } else {
      process.stdout.write(sql + "\n");
    }
    return;
  }

  if (!SERVICE_KEY) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local or run with --emit-sql.");
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userId = await findUserIdByEmail(db.auth.admin);
  if (!userId) {
    console.error(`No auth user found with email: ${DEMO_EMAIL}`);
    process.exit(1);
  }
  console.log("Resolved user:", userId, DEMO_EMAIL);

  const built = buildDemoPayload(userId, dayStrs);

  for (const row of built.habitRows) {
    const { error } = await db.from("habits").upsert(row, { onConflict: "id" });
    if (error) {
      console.error("habits upsert error:", error.message, row.name, error);
      process.exit(1);
    }
    console.log("Upserted habit:", row.name);
  }

  for (const jr of built.journalRows) {
    const { error } = await db.from("journal_entries").upsert(
      {
        user_id: userId,
        date: jr.date,
        content: jr.content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );
    if (error) {
      console.error("journal_entries upsert:", error.message, jr.date, error);
      process.exit(1);
    }
    console.log("Upserted journal:", jr.date);
  }

  const { error: pErr } = await db
    .from("profiles")
    .update({
      name: DEMO_NAME,
      onboarded: true,
      xp: 380,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (pErr) {
    console.error("profiles update:", pErr.message);
    process.exit(1);
  }
  console.log("Updated profile name, onboarded, xp.");
  console.log("\nDone. Day range:", built.dayStrs[0], "→", built.dayStrs[13]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
