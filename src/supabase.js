import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://apdmvbzfjuvxworjepze.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwZG12YnpmanV2eHdvcmplcHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzU4MzAsImV4cCI6MjA5MDIxMTgzMH0.s3O-0m7eN9dLTmCagjezHP4Wwn8fdtlCyXITkI82bPU",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

// ─── Shape converters ──────────────────────────────────────────────────────────
// Convert an in-app habit object → a DB row
export function habitToRow(habit, userId) {
  return {
    id:                habit.id,
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
    logs:              habit.logs ?? [],
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
  const lastLogDate = logs.length > 0
    ? [...logs].sort((a, b) => b.date.localeCompare(a.date))[0].date
    : null;
  return {
    id:          row.id,
    name:        row.name,
    emoji:       row.emoji ?? "",
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
  };
}

// Convert an in-app goal object → a DB row
export function goalToRow(goal, userId) {
  return {
    id:                goal.id,
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
    updated_at:        new Date().toISOString(),
  };
}

// Convert a DB row → an in-app habit object
export function rowToHabit(row) {
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
    dailyBudget:      row.daily_budget   ?? undefined,
    tapIncrement:     row.tap_increment  ?? 1,
    bestStreak:       row.best_streak    ?? 0,
    logs:             row.logs ?? [],
  };
}
