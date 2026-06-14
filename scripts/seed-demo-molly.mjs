/**
 * Seed the Molly demo account with clean marketing-ready data.
 *
 *   node --env-file=.env.local scripts/seed-demo-molly.mjs
 *     → requires SUPABASE_SERVICE_ROLE_KEY
 *
 *   node scripts/seed-demo-molly.mjs --write-sql
 *     → writes scripts/demo-molly-seed.sql (relative dates) for Supabase SQL Editor
 *
 * Safe to re-run: deletes then re-inserts all Molly-specific demo data.
 * Does NOT touch: push_subscriptions, billing/Stripe, shared goals, social tables.
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
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvFallback();

const EMIT_SQL  = process.argv.includes("--emit-sql");
const WRITE_SQL = process.argv.includes("--write-sql");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://apdmvbzfjuvxworjepze.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_EMAIL   = "cheesefingersathotmail.co.n@gmail.com";

// ─── Fixed UUIDs — keep stable across runs ──────────────────────────────────
const IDS = {
  block:      "a0600001-0001-4001-8001-000000000001",
  deepWork:   "a0600001-0001-4001-8001-000000000011",
  move:       "a0600001-0001-4001-8001-000000000012",
  noDoom:     "a0600001-0001-4001-8001-000000000013",
  postUseful: "a0600001-0001-4001-8001-000000000014",
  eveningIn:  "a0600001-0001-4001-8001-000000000015",
};

// ─── Date helpers ────────────────────────────────────────────────────────────
function toYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Returns a date string for today-N days (local calendar). */
function daysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return toYmd(d);
}

/** Returns a date string for today+N days (local calendar). */
function daysFromNow(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

/** Monday of the week containing dateStr. */
function weekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return toYmd(d);
}

// ─── Arc constants ───────────────────────────────────────────────────────────
const ARC_DAYS_AGO  = 20; // arc started 20 days ago (user is on day 21 of 42)
const ARC_DURATION  = 42;
// Proof scores by day offset (0=arc start, 19=yesterday). 5 proof habits.
// ARC_BASE_POOL=30, perProof=6, PERFECT_BONUS=10, CAP=40.
// XP formula: done*6, +10 if 5/5.
const PROOF_DONE = [3, 4, 5, 3, 2, 4, 4, 5, 3, 4, 1, 4, 4, 4, 5, 4, 4, 4, 3, 5];
const PROOF_TOTAL = 5;

function arcXpForDay(done) {
  if (done === 0) return 0;
  const award = done * Math.floor(30 / PROOF_TOTAL);
  return Math.min(done === PROOF_TOTAL ? award + 10 : award, 40);
}

// ─── Payload builder ─────────────────────────────────────────────────────────
function buildPayload(userId) {
  const now = new Date().toISOString();

  // Arc dates
  const startDate = daysAgo(ARC_DAYS_AGO);
  const endDate   = daysFromNow(ARC_DURATION - ARC_DAYS_AGO - 1); // day 42 = today+21
  const totalArcXp = PROOF_DONE.reduce((s, d) => s + arcXpForDay(d), 0);
  const proofRate  = Math.round(PROOF_DONE.reduce((s, d) => s + d, 0) / (PROOF_DONE.length * PROOF_TOTAL) * 100);

  // ── forge_block ────────────────────────────────────────────────────────────
  const block = {
    id:            IDS.block,
    user_id:       userId,
    title:         "Build the System",
    identity:      "The person who ships proof, not promises",
    why_statement: "Because I've been 'almost ready' for two years. This time I'm building evidence instead of waiting for motivation.",
    old_pattern:   "Planning without shipping. Starting without finishing. Telling myself I need more preparation.",
    minimum_proof: "One focused deep work session. Show up even when it feels mechanical.",
    start_date:    startDate,
    end_date:      endDate,
    status:        "active",
    duration_days: ARC_DURATION,
    arc_xp:        totalArcXp,
    completion_score: proofRate,
    arc_rank:      "Hardened",
    created_at:    now,
    updated_at:    now,
  };

  // ── 5 proof habits ─────────────────────────────────────────────────────────
  // Habit logs: last 7 days of activity (today-7 to today-1)
  // idx offsets relative to arc start; last 7 = arc days 14-20 (offset 13-19)
  // Per-habit done pattern for offsets 13-19:
  //   deepWork:   [1,1,1,1,1,1,1]  all 7
  //   move:       [1,1,0,1,1,1,1]  skipped offset 15
  //   noDoom:     [1,1,1,1,1,1,1]  all 7
  //   postUseful: [0,1,1,0,0,0,1]  done offset 14,15,19
  //   eveningIn:  [1,1,1,1,1,0,1]  skipped offset 18

  function buildLogs(donePattern, notesArr) {
    const logs = [];
    for (let i = 0; i < donePattern.length; i++) {
      if (!donePattern[i]) continue;
      logs.push({
        date:  daysAgo(ARC_DAYS_AGO - (13 + i)), // offset 13+i days from arc start
        value: true,
        note:  notesArr[i] || "",
      });
    }
    return logs;
  }

  const deepWorkLogs = buildLogs(
    [1, 1, 1, 1, 1, 1, 1],
    ["65 min, flow midway through", "85 min — best session this arc", "60 min, meetings cut in but got it done", "55 min, slower day", "80 min, real flow state", "70 min", "75 min, closed a loop I'd been avoiding"],
  );

  const moveLogs = buildLogs(
    [1, 1, 0, 1, 1, 1, 1],
    ["4km run", "6km — furthest this arc", "", "4km", "5km run", "short loop", "4km"],
  );

  const noDoomLogs = buildLogs(
    [1, 1, 1, 1, 1, 1, 1],
    ["", "", "", "", "", "", ""],
  );

  const postUsefulLogs = buildLogs(
    [0, 1, 1, 0, 0, 0, 1],
    ["", "posted a breakdown on product thinking — 3 DMs", "shared rough mental model, got replies", "", "", "", "published something rough, it worked"],
  );

  const eveningLogs = buildLogs(
    [1, 1, 1, 1, 1, 0, 1],
    ["", "", "", "", "", "", ""],
  );

  function baseHabit(overrides) {
    return {
      streak: 0, best_streak: 0,
      reflection: true, reflection_prompt: "",
      weekly_target: null, start_value: null, target_value: null,
      unit: null, daily_budget: null, tap_increment: 1,
      daily_target_minutes: null, shared_goal_id: null,
      goal_status: null, target_date: null,
      updated_at: now,
      ...overrides,
    };
  }

  const habits = [
    baseHabit({
      id: IDS.deepWork, user_id: userId,
      name: "Deep work session", emoji: "🎯",
      habit_type: "daily", color: "#2980B9",
      block_id: IDS.block, is_proof_action: true,
      logs: deepWorkLogs, streak: 7, best_streak: 12,
    }),
    baseHabit({
      id: IDS.move, user_id: userId,
      name: "Move daily", emoji: "🏃",
      habit_type: "daily", color: "#27AE60",
      block_id: IDS.block, is_proof_action: true,
      logs: moveLogs, streak: 4, best_streak: 8,
    }),
    baseHabit({
      id: IDS.noDoom, user_id: userId,
      name: "No doom scroll before 9am", emoji: "📵",
      habit_type: "daily", color: "#E67E22",
      block_id: IDS.block, is_proof_action: true,
      logs: noDoomLogs, streak: 7, best_streak: 7,
    }),
    baseHabit({
      id: IDS.postUseful, user_id: userId,
      name: "Post one useful thing", emoji: "📤",
      habit_type: "daily", color: "#9B59B6",
      block_id: IDS.block, is_proof_action: true,
      logs: postUsefulLogs, streak: 1, best_streak: 3,
    }),
    baseHabit({
      id: IDS.eveningIn, user_id: userId,
      name: "Evening check-in", emoji: "🌙",
      habit_type: "daily", color: "#1ABC9C",
      block_id: IDS.block, is_proof_action: true,
      logs: eveningLogs, streak: 1, best_streak: 6,
    }),
  ];

  // ── arc_daily_scores ───────────────────────────────────────────────────────
  const arcScores = PROOF_DONE.map((done, idx) => ({
    user_id:       userId,
    block_id:      IDS.block,
    date:          daysAgo(ARC_DAYS_AGO - idx),
    proof_total:   PROOF_TOTAL,
    proof_done:    done,
    arc_xp_awarded: arcXpForDay(done),
    perfect_day:   done === PROOF_TOTAL,
    updated_at:    now,
  }));

  // ── journal entries ────────────────────────────────────────────────────────
  // Offsets from arc start (0 = arc day 1). Raw entries early; receipts later.
  const journalEntries = [
    {
      idx: 0, is_ai: false,
      content: "Starting this today. Build the System. 42 days to actually show up for the thing I keep saying I'll do. Committing it here feels real in a way the notes app doesn't. That's probably the point.",
    },
    {
      idx: 1, is_ai: false,
      content: "Deep work session before checking my phone. First time I've done that in months. Did the move thing at lunch. Two days in and I'm already overthinking whether I'm doing it right — but I'm doing it.",
    },
    {
      idx: 3, is_ai: false,
      content: "Deep work was hard today. Kept wanting to check Slack. Actually logged it anyway even though it felt half-hearted. That might be the whole point.",
    },
    {
      idx: 4, is_ai: false,
      content: "Rough one. Family thing, tired, didn't get the morning session in properly. 2 out of 5. Yesterday me would have logged nothing and told myself I'd restart Monday.",
    },
    {
      idx: 6, is_ai: true,
      content: `Proof shown: Deep work (68 min), run 2.4km, no phone before 9:15am, posted a thread on building in public, evening log done.

Wins: The run felt genuinely good after skipping Wednesday. The post got more traction than expected — reminder that shipping creates surface area.

Hard parts: Focus during deep work wasn't clean. Kept gravitating to email. Set a 25-min timer which helped more than expected.

Pattern: The morning deep work sets the tone for the whole day. When I skip it I feel behind all afternoon.

Tomorrow: Start the deep work block before making coffee. Phone stays in another room until 9am.`,
    },
    {
      idx: 7, is_ai: true,
      content: `Proof shown: Deep work (90 min), 5km run, no doom scroll until 9:30am, posted two useful things, evening check-in complete. First 5/5 day.

Wins: Stringing all five together felt different. Not just completing items — actually building something that resembles a system.

Hard parts: Evening check-in nearly missed — had dinner plans and almost called it. Opened the app at 11pm and logged anyway.

Pattern: Perfect days feel possible when I don't negotiate with myself in the morning.

Tomorrow: Keep the morning sequence tight. See if I can repeat.`,
    },
    {
      idx: 8, is_ai: false,
      content: "Tired after a solid week. 3/5 but they were the right 3 — deep work, move, evening. Skipped posting and let myself off the doom scroll thing in the morning. Still counts as showing up.",
    },
    {
      idx: 10, is_ai: false,
      content: "Worst day so far. Work blew up, barely got 1 habit in (just the check-in). Felt like watching the streak die in slow motion. But I didn't delete the app. That's the floor and I'm standing on it.",
    },
    {
      idx: 11, is_ai: true,
      content: `Proof shown: Deep work (45 min), short walk ✓, no doom scroll ✓, evening check-in ✓. Back to 4/5.

Wins: Bounced back. One bad day didn't become two. That's new.

Hard parts: Yesterday still feels present. The work blowup is unresolved. Hard to concentrate with ambient stress.

Pattern: Bad days don't undo the system. The system is specifically for the days when motivation is gone.

Tomorrow: Short morning check-in to surface whatever's blocking before it becomes ambient noise.`,
    },
    {
      idx: 12, is_ai: true,
      content: `Proof shown: Deep work (72 min), run 5km ✓, no doom scroll ✓, posted one useful breakdown on product thinking, evening log done.

Wins: The post landed — 3 DMs asking follow-up questions. That's the proof. Shipping creates surface area.

Hard parts: Almost talked myself out of the post. "Not ready, needs polish." Published it rough and it worked fine.

Pattern: "Not ready" is the old pattern. Posting is the proof action. The post IS the work.

Tomorrow: Follow up on the DMs. They're signal.`,
    },
    {
      idx: 14, is_ai: true,
      content: `Proof shown: Deep work (85 min), 6km run, phone-free until 9am, posted one useful breakdown, evening reflection. 5/5. Third perfect day.

Wins: Ran the furthest I have in months without planning to — just felt like it. That's compounding. The physical system catching up with the mental one.

Hard parts: Had to cancel a dinner to keep the morning clean. Felt bad for an hour. Fine after.

Pattern: I'm protecting the morning like it means something now. Because it does.

Tomorrow: Week 3 starts. Don't let the momentum become pressure. Same actions, different week.`,
    },
    {
      idx: 15, is_ai: true,
      content: `Proof shown: Deep work (60 min), moved ✓, no doom scroll ✓, posted (rough mental model), evening check-in ✓. 4/5.

Wins: Week 2 complete. Looked back at the timeline for the first time. More green than I expected.

Hard parts: Deep work felt mechanical today. Not inspired, just executing. Fine, but noticeable.

Pattern: Not every day needs to be a highlight. Most days are just days. The system runs anyway.

Tomorrow: Find something actually worth posting. Even a rough idea counts.`,
    },
    {
      idx: 17, is_ai: true,
      content: `Proof shown: Deep work (80 min), run 4km ✓, no doom scroll ✓, evening check-in ✓. 4/5. (Missed the post again.)

Wins: Best deep work session in two weeks — 80 minutes felt like 30. Flow state showing up more consistently.

Hard parts: Posting is becoming my weak spot. Need to rethink how I'm generating output worth sharing.

Pattern: Deep work is building well. But deep work without visible output is just spinning. Need to close more loops publicly.

Tomorrow: Whatever comes out of deep work tomorrow goes out that day. Rough draft is fine.`,
    },
    {
      idx: 18, is_ai: false,
      content: "3/5 again. Starting to notice I do deep work, move, and check-in on autopilot now — but consistently miss the post and sometimes doom scroll in the morning. That asymmetry is interesting. Will ask Arlo about it.",
    },
    {
      idx: 19, is_ai: true,
      content: `Proof shown: Deep work (75 min), run 4km ✓, no doom scroll ✓, posted (mental model thread — got replies), evening check-in ✓. 5/5. Fourth perfect day.

Wins: Published the thing I've been sitting on. Three people replied with their own version of the same problem. That's what posting is for.

Hard parts: Still wrestling with the gap between doing the work and showing the work. They're not the same muscle but they need each other.

Pattern: The system is working. But a system without an output valve just accumulates. Shipping is part of the proof, not extra credit.

Tomorrow: Tomorrow is Day 21. That felt very far away on Day 1.`,
    },
  ].map(e => ({
    user_id: userId,
    date: daysAgo(ARC_DAYS_AGO - e.idx),
    content: e.content,
    is_ai_generated: e.is_ai,
    updated_at: now,
  }));

  // ── weekly briefs ──────────────────────────────────────────────────────────
  // Week 1: arc days 1-7 (proof scores 3,4,5,3,2,4,4 = 25/35 = 71%)
  // Week 2: arc days 8-14 (proof scores 5,3,4,1,4,4,3 = 24/35 = 69%)
  const weeklyBriefs = [
    {
      week_start: weekStart(daysAgo(ARC_DAYS_AGO - 6)),  // Monday of week containing arc day 7
      generation_count: 1,
      brief_text: `Week 1 of Build the System is in. Molly held a 71% proof rate across 7 days — including her first perfect day on Saturday. She hit the deep work session on 6 of 7 days and ran more than she has in months. The real signal this week: she showed up on Wednesday with 2/5 instead of abandoning the arc entirely. That floor-holding is new. The morning sequence is forming. The system has a heartbeat.`,
    },
    {
      week_start: weekStart(daysAgo(ARC_DAYS_AGO - 13)), // Monday of week containing arc day 14
      generation_count: 1,
      brief_text: `Week 2 complete. Proof rate: 69% — including a bad day on arc day 11 (1/5, work emergency) and a clean bounce back the next morning. That recovery pattern is the clearest proof in the arc so far. Week 2 also had a second perfect day (arc day 15). Deep work is now Molly's most reliable habit — 6 of 7 days and the sessions are getting longer. Posting publicly is the consistent gap: she's shipping less than her other proof actions. The system is real. The output valve needs work.`,
    },
  ].map(b => ({
    user_id: userId,
    week_start: b.week_start,
    generation_count: b.generation_count,
    brief_text: b.brief_text,
    brief_generated_at: now,
    updated_at: now,
  }));

  // ── coach memory ───────────────────────────────────────────────────────────
  const coachMemory = {
    user_id: userId,
    content: `Molly is 20 days into "Build the System" — a 42-day arc around actually shipping proof instead of staying in preparation mode. She's in the Hardened rank at 75% proof completion with four perfect days. Deep work and daily movement are her strongest habits — both near-automatic in the morning now. No doom scroll before 9am is holding well (7-day streak). Posting one useful thing publicly is her consistent weak spot: she cites "not ready" and delays, which is exactly the old pattern she's trying to break. She flagged this herself on arc day 19 and said she'd bring it up. The bounce-back pattern is genuinely strong — she doesn't spiral after bad days anymore. She's protecting her morning like it matters. 22 days left.`,
    updated_at: now,
  };

  return { block, habits, arcScores, journalEntries, weeklyBriefs, coachMemory, startDate, endDate };
}

// ─── SQL emission helpers ────────────────────────────────────────────────────
function sqlLiteral(text) {
  return "'" + String(text).replace(/'/g, "''") + "'";
}
function sqlJsonb(obj) {
  return sqlLiteral(JSON.stringify(obj)) + "::jsonb";
}
function sqlBool(v) {
  return v ? "true" : "false";
}
function sqlNullable(v, wrap = sqlLiteral) {
  return v == null ? "null" : wrap(v);
}

function emitSql(payload, emailLit) {
  const { block, habits, arcScores, journalEntries, weeklyBriefs, coachMemory } = payload;
  const lines = [];
  lines.push("-- Demo seed: Molly account — safe to re-run");
  lines.push("begin;");
  lines.push("");
  lines.push(`do $guard$
begin
  if not exists (select 1 from auth.users where lower(email) = lower(${emailLit})) then
    raise exception 'No auth.users row for %', ${emailLit};
  end if;
end $guard$;`);
  lines.push("");

  const cte = `with demo_user as (select id as user_id from auth.users where lower(email) = lower(${emailLit}) limit 1)`;

  // Profile update
  lines.push(`${cte}
update public.profiles p
set name = 'Molly', coach_name = 'Arlo', is_pro = true, onboarded = true, updated_at = now()
from demo_user u where p.id = u.user_id;`);
  lines.push("");

  // Delete old data
  lines.push(`${cte} delete from public.habits where user_id = (select user_id from demo_user);`);
  lines.push(`${cte} delete from public.journal_entries where user_id = (select user_id from demo_user);`);
  lines.push(`${cte} delete from public.forge_blocks where user_id = (select user_id from demo_user);`);
  lines.push(`${cte} delete from public.weekly_brief_generation_usage where user_id = (select user_id from demo_user);`);
  lines.push(`${cte} delete from public.coach_memory where user_id = (select user_id from demo_user);`);
  lines.push("");

  // forge_block
  lines.push(`${cte}
insert into public.forge_blocks
  (id, user_id, title, identity, why_statement, old_pattern, minimum_proof, start_date, end_date, status, duration_days, arc_xp, completion_score, arc_rank, created_at, updated_at)
select
  ${sqlLiteral(block.id)}::uuid,
  (select user_id from demo_user),
  ${sqlLiteral(block.title)},
  ${sqlLiteral(block.identity)},
  ${sqlLiteral(block.why_statement)},
  ${sqlLiteral(block.old_pattern)},
  ${sqlLiteral(block.minimum_proof)},
  ${sqlLiteral(block.start_date)}::date,
  ${sqlLiteral(block.end_date)}::date,
  'active', ${block.duration_days}, ${block.arc_xp}, ${block.completion_score}, ${sqlLiteral(block.arc_rank)},
  now(), now()
on conflict (id) do update set
  title = excluded.title, identity = excluded.identity,
  why_statement = excluded.why_statement, old_pattern = excluded.old_pattern,
  minimum_proof = excluded.minimum_proof, start_date = excluded.start_date,
  end_date = excluded.end_date, status = excluded.status,
  arc_xp = excluded.arc_xp, completion_score = excluded.completion_score,
  arc_rank = excluded.arc_rank, updated_at = excluded.updated_at;`);
  lines.push("");

  // habits
  const habitCols = "id, user_id, name, emoji, habit_type, color, block_id, is_proof_action, logs, streak, best_streak, reflection, reflection_prompt, weekly_target, start_value, target_value, unit, daily_budget, tap_increment, daily_target_minutes, shared_goal_id, goal_status, target_date, updated_at";
  for (const h of habits) {
    lines.push(`${cte}
insert into public.habits (${habitCols})
select
  ${sqlLiteral(h.id)}::uuid, (select user_id from demo_user),
  ${sqlLiteral(h.name)}, ${sqlLiteral(h.emoji)}, ${sqlLiteral(h.habit_type)}, ${sqlLiteral(h.color)},
  ${sqlLiteral(IDS.block)}::uuid, true,
  ${sqlJsonb(h.logs)}, ${h.streak}, ${h.best_streak},
  ${sqlBool(h.reflection)}, '',
  null, null, null, null, null, 1, null, null, null, null, now()
on conflict (id) do update set
  name = excluded.name, emoji = excluded.emoji, color = excluded.color,
  block_id = excluded.block_id, is_proof_action = excluded.is_proof_action,
  logs = excluded.logs, streak = excluded.streak, best_streak = excluded.best_streak,
  updated_at = excluded.updated_at;`);
    lines.push("");
  }

  // arc_daily_scores
  for (const s of arcScores) {
    lines.push(`${cte}
insert into public.arc_daily_scores (user_id, block_id, date, proof_total, proof_done, arc_xp_awarded, perfect_day, updated_at)
select
  (select user_id from demo_user), ${sqlLiteral(IDS.block)}::uuid,
  ${sqlLiteral(s.date)}::date, ${s.proof_total}, ${s.proof_done}, ${s.arc_xp_awarded}, ${sqlBool(s.perfect_day)}, now()
on conflict (block_id, date) do update set
  proof_total = excluded.proof_total, proof_done = excluded.proof_done,
  arc_xp_awarded = excluded.arc_xp_awarded, perfect_day = excluded.perfect_day,
  updated_at = excluded.updated_at;`);
    lines.push("");
  }

  // journal_entries
  for (const j of journalEntries) {
    lines.push(`${cte}
insert into public.journal_entries (user_id, date, content, is_ai_generated, updated_at)
select (select user_id from demo_user), ${sqlLiteral(j.date)}::date, ${sqlLiteral(j.content)}, ${sqlBool(j.is_ai_generated)}, now()
on conflict (user_id, date) do update set
  content = excluded.content, is_ai_generated = excluded.is_ai_generated, updated_at = excluded.updated_at;`);
    lines.push("");
  }

  // weekly_briefs
  for (const b of weeklyBriefs) {
    lines.push(`${cte}
insert into public.weekly_brief_generation_usage (user_id, week_start, generation_count, brief_text, brief_generated_at, updated_at)
select (select user_id from demo_user), ${sqlLiteral(b.week_start)}::date, ${b.generation_count}, ${sqlLiteral(b.brief_text)}, now(), now()
on conflict (user_id, week_start) do update set
  generation_count = excluded.generation_count, brief_text = excluded.brief_text,
  brief_generated_at = excluded.brief_generated_at, updated_at = excluded.updated_at;`);
    lines.push("");
  }

  // coach_memory
  lines.push(`${cte}
insert into public.coach_memory (user_id, content, updated_at)
select (select user_id from demo_user), ${sqlLiteral(coachMemory.content)}, now()
on conflict (user_id) do update set content = excluded.content, updated_at = excluded.updated_at;`);
  lines.push("");

  lines.push("commit;");
  return lines.join("\n");
}

// ─── User lookup ─────────────────────────────────────────────────────────────
async function findUserId(adminClient) {
  const email = DEMO_EMAIL.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await adminClient.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const hit = users.find(u => (u.email || "").toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const emailLit = sqlLiteral(DEMO_EMAIL);

  if (EMIT_SQL || WRITE_SQL) {
    const placeholder = "00000000-0000-4000-8000-000000000000";
    const payload = buildPayload(placeholder);
    const sql = emitSql(payload, emailLit);
    if (WRITE_SQL) {
      const out = join(root, "scripts", "demo-molly-seed.sql");
      writeFileSync(out, sql, "utf8");
      console.error("Wrote", out);
    } else {
      process.stdout.write(sql + "\n");
    }
    return;
  }

  if (!SERVICE_KEY) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY — add to .env.local or run --write-sql.");
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const userId = await findUserId(db.auth.admin);
  if (!userId) {
    console.error("No auth user found:", DEMO_EMAIL);
    process.exit(1);
  }
  console.log("Resolved user:", userId, DEMO_EMAIL);

  const payload = buildPayload(userId);
  const { block, habits, arcScores, journalEntries, weeklyBriefs, coachMemory } = payload;

  // ── Profile update ────────────────────────────────────────────────────────
  {
    const { error } = await db.from("profiles").update({
      name: "Molly", coach_name: "Arlo", is_pro: true, onboarded: true,
      updated_at: new Date().toISOString(),
    }).eq("id", userId);
    if (error) { console.error("profiles update:", error.message); process.exit(1); }
    console.log("✓ Profile updated (Molly / Arlo / is_pro)");
  }

  // ── Delete old data ───────────────────────────────────────────────────────
  for (const [table, col] of [
    ["habits", "user_id"],
    ["journal_entries", "user_id"],
    ["forge_blocks", "user_id"],   // cascades to arc_daily_scores
    ["weekly_brief_generation_usage", "user_id"],
    ["coach_memory", "user_id"],
  ]) {
    const { error } = await db.from(table).delete().eq(col, userId);
    if (error) { console.error(`delete ${table}:`, error.message); process.exit(1); }
    console.log(`✓ Cleared ${table}`);
  }

  // ── forge_block ───────────────────────────────────────────────────────────
  {
    const { error } = await db.from("forge_blocks").upsert(block, { onConflict: "id" });
    if (error) { console.error("forge_blocks upsert:", error.message); process.exit(1); }
    console.log("✓ Arc created:", block.title, block.start_date, "→", block.end_date);
  }

  // ── habits ────────────────────────────────────────────────────────────────
  for (const h of habits) {
    const { error } = await db.from("habits").upsert(h, { onConflict: "id" });
    if (error) { console.error("habits upsert:", h.name, error.message); process.exit(1); }
    console.log("✓ Habit:", h.emoji, h.name, `(streak ${h.streak})`);
  }

  // ── arc_daily_scores ──────────────────────────────────────────────────────
  const { error: scoresErr } = await db.from("arc_daily_scores")
    .upsert(arcScores, { onConflict: "block_id,date" });
  if (scoresErr) { console.error("arc_daily_scores upsert:", scoresErr.message); process.exit(1); }
  console.log(`✓ Arc scores: ${arcScores.length} days seeded`);

  // ── journal entries ───────────────────────────────────────────────────────
  for (const j of journalEntries) {
    const { error } = await db.from("journal_entries").upsert(
      { user_id: userId, date: j.date, content: j.content, is_ai_generated: j.is_ai_generated, updated_at: new Date().toISOString() },
      { onConflict: "user_id,date" },
    );
    if (error) { console.error("journal_entries upsert:", j.date, error.message); process.exit(1); }
    console.log("✓ Journal:", j.date, j.is_ai_generated ? "(receipt)" : "(raw)");
  }

  // ── weekly briefs ─────────────────────────────────────────────────────────
  for (const b of weeklyBriefs) {
    const { error } = await db.from("weekly_brief_generation_usage").upsert(b, { onConflict: "user_id,week_start" });
    if (error) { console.error("weekly_brief upsert:", b.week_start, error.message); process.exit(1); }
    console.log("✓ Weekly brief:", b.week_start);
  }

  // ── coach memory ──────────────────────────────────────────────────────────
  {
    const { error } = await db.from("coach_memory").upsert(coachMemory, { onConflict: "user_id" });
    if (error) { console.error("coach_memory upsert:", error.message); process.exit(1); }
    console.log("✓ Coach memory seeded");
  }

  console.log(`\nDone. Arc: Day ${ARC_DAYS_AGO + 1} of ${ARC_DURATION} | Proof rate: ${Math.round(PROOF_DONE.reduce((s,d)=>s+d,0)/(PROOF_DONE.length*PROOF_TOTAL)*100)}% | XP: ${PROOF_DONE.reduce((s,d)=>s+arcXpForDay(d),0)}`);
  console.log(`Arc: ${block.start_date} → ${block.end_date}`);
  console.log("Weekly briefs:", payload.weeklyBriefs.map(b => b.week_start).join(", "));
}

main().catch(e => { console.error(e); process.exit(1); });
