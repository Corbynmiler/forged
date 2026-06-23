import { createClient } from "@supabase/supabase-js";

export const SUPABASE_ANON_KEY =
  "sb_publishable_GdMepnUv2W4VRiOuV23xiA_O4J11RMl";

export const supabase = createClient(
  "https://apdmvbzfjuvxworjepze.supabase.co",
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

function normalizeId(rawId) {
  if (!rawId) return rawId;
  return String(rawId).replace(".", "_");
}

// ─── Shape converters ──────────────────────────────────────────────────────────
// Convert an in-app habit object → a DB row
export function habitToRow(habit, userId) {
  const id = normalizeId(habit?.id);
  return {
    ...(id ? { id } : {}),
    user_id:           userId,
    name:              habit.name,
    emoji:             habit.emoji ?? "",
    habit_type:        habit.habitType,
    color:             habit.color ?? "#C0392B",
    streak:            habit.streak ?? 0,
    reflection:        habit.reflection ?? true,
    reflection_prompt: habit.reflectionPrompt ?? "",
    weekly_target:     habit.weeklyTarget  ?? null,
    start_value:       habit.startValue    ?? null,
    target_value:      habit.targetValue   ?? null,
    unit:              habit.unit          ?? null,
    daily_budget:      habit.dailyBudget   ?? null,
    tap_increment:     habit.tapIncrement  ?? 1,
    best_streak:       habit.bestStreak    ?? 0,
    daily_target_minutes: habit.dailyTargetMinutes ?? 60,
    shared_goal_id:    habit.sharedGoalId ?? null,
    // Limit-habit intent (null = DB default 'maintain'; only written when explicitly set)
    goal_aim:          habit.goalAim       ?? null,
    original_budget:   habit.originalBudget ?? null,
    logs:              habit.logs ?? [],
    // Arc / forge_block linkage. Null block_id means "not part of an Arc."
    block_id:          habit.blockId       ?? null,
    is_proof_action:   !!habit.isProofAction,
    updated_at:        new Date().toISOString(),
  };
}

// ─── Goal converters ───────────────────────────────────────────────────────────
// Convert a DB row (habit_type='goal') → an in-app goal object
export function rowToGoal(row) {
  const logs = row.logs ?? [];
  const numericLogs = logs.filter(l => typeof l.value === "number");
  const startValue = row.start_value ?? 0;
  const targetValue = row.target_value ?? 0;
  const currentValue = numericLogs.length > 0
    ? numericLogs[numericLogs.length - 1].value
    : startValue;
  const direction = (row.direction === "decreasing" || targetValue < startValue)
    ? "decreasing" : "increasing";
  // Only numeric logs contribute to lastLogDate — milestone/why entries are metadata
  // and can have future dates, which would corrupt "last active" display.
  const lastLogDate = numericLogs.length > 0
    ? [...numericLogs].sort((a, b) => b.date.localeCompare(a.date))[0].date
    : null;
  return {
    id:          row.id,
    name:        row.name,
    emoji:       row.emoji ?? "",
    habitType:   "goal",
    unit:        row.unit ?? "",
    startValue,
    targetValue,
    currentValue,
    direction,
    targetDate:  row.target_date ?? null,
    status:      row.goal_status ?? "active",
    logs,
    lastLogDate,
    color:       row.color ?? "#E67E22",
    sharedGoalId: row.shared_goal_id ?? undefined,
    // Arc / forge_block linkage. Surfaced to clients so Today can filter to proof actions.
    blockId:          row.block_id        ?? null,
    isProofAction:    !!row.is_proof_action,
  };
}

// Convert an in-app goal object → a DB row
export function goalToRow(goal, userId) {
  const id = normalizeId(goal?.id);
  return {
    ...(id ? { id } : {}),
    user_id:           userId,
    name:              goal.name,
    emoji:             goal.emoji ?? "",
    habit_type:        "goal",
    color:             goal.color ?? "#E67E22",
    start_value:       goal.startValue,
    target_value:      goal.targetValue,
    unit:              goal.unit ?? null,
    target_date:       goal.targetDate ?? null,
    goal_status:       goal.status ?? "active",
    logs:              goal.logs ?? [],
    // Required columns with defaults (not used for goals)
    streak:            0,
    best_streak:       0,
    reflection:        false,
    reflection_prompt: "",
    weekly_target:     null,
    daily_budget:      null,
    tap_increment:     1,
    daily_target_minutes: null,
    shared_goal_id:    goal.sharedGoalId ?? null,
    // Arc / forge_block linkage. Null block_id means "not part of an Arc."
    block_id:          goal.blockId       ?? null,
    is_proof_action:   !!goal.isProofAction,
    updated_at:        new Date().toISOString(),
  };
}

// ─── Task converters ──────────────────────────────────────────────────────────
// Convert a DB tasks row → in-app task object
export function rowToTask(row) {
  return {
    id:        row.id,
    text:      row.text,
    date:      row.date,           // YYYY-MM-DD string (user's local date)
    done:      row.done ?? false,
    doneAt:    row.done_at ?? null,
    pinned:    row.pinned ?? false,
    source:    row.source ?? "manual",
    createdAt: row.created_at,
  };
}

// Convert an in-app task object → DB row
export function taskToRow(task, userId) {
  return {
    ...(task.id ? { id: task.id } : {}),
    user_id:    userId,
    text:       task.text,
    date:       task.date,
    done:       task.done ?? false,
    done_at:    task.done ? (task.doneAt ?? new Date().toISOString()) : null,
    pinned:     task.pinned ?? false,
    source:     task.source ?? "manual",
  };
}

// Convert a DB row → an in-app habit object
export function rowToHabit(row) {
  // Legacy safety: old "progress" rows are now goals.
  if (row.habit_type === "progress") {
    return rowToGoal({ ...row, habit_type: "goal" });
  }
  const startValue = row.start_value ?? undefined;
  const targetValue = row.target_value ?? undefined;
  const inferredDirection =
    typeof startValue === "number" && typeof targetValue === "number" && targetValue < startValue
      ? "decreasing"
      : "increasing";
  return {
    id:               row.id,
    name:             row.name,
    emoji:            row.emoji,
    habitType:        row.habit_type,
    color:            row.color,
    streak:           row.streak,
    reflection:       row.reflection,
    reflectionPrompt: row.reflection_prompt,
    weeklyTarget:     row.weekly_target  ?? undefined,
    startValue,
    targetValue,
    direction:        row.direction === "decreasing" || row.direction === "increasing" ? row.direction : inferredDirection,
    unit:             row.unit           ?? undefined,
    dailyBudget:      row.daily_budget     ?? undefined,
    tapIncrement:     row.tap_increment    ?? 1,
    bestStreak:       row.best_streak      ?? 0,
    dailyTargetMinutes: row.daily_target_minutes ?? 60,
    sharedGoalId:       row.shared_goal_id ?? undefined,
    // Limit-habit intent fields (null in DB = 'maintain' everywhere in app code)
    goalAim:          row.goal_aim         ?? "maintain",
    originalBudget:   row.original_budget  ?? undefined,
    logs:             row.logs ?? [],
    // Arc / forge_block linkage. Surfaced to clients so Today can filter to proof actions.
    blockId:          row.block_id        ?? null,
    isProofAction:    !!row.is_proof_action,
  };
}

// ─── Forge Block (user-facing "Arc") converters ────────────────────────────────
// Convert a DB row from public.forge_blocks → an in-app block (Arc) object.
// Internal: "forge_block" / `forge_blocks`. User-facing: "Arc".
export function rowToForgeBlock(row) {
  if (!row) return null;
  return {
    id:            row.id,
    userId:        row.user_id,
    identity:      row.identity,
    title:         row.title ?? "",
    whyStatement:  row.why_statement ?? "",
    oldPattern:    row.old_pattern   ?? "",
    minimumProof:  row.minimum_proof ?? "",
    startDate:     row.start_date,
    endDate:       row.end_date,
    status:        row.status         ?? "active",
    durationDays:  row.duration_days  ?? 56,
    arcXp:         row.arc_xp ?? 0,
    completionScore: row.completion_score != null ? Number(row.completion_score) : null,
    arcRank:       row.arc_rank ?? "",
    review:        row.review         ?? null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

export function rowToArcDailyScore(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    blockId: row.block_id,
    date: row.date,
    proofTotal: row.proof_total ?? 0,
    proofDone: row.proof_done ?? 0,
    arcXpAwarded: row.arc_xp_awarded ?? 0,
    perfectDay: !!row.perfect_day,
  };
}
