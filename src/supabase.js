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

// Convert a DB row → an in-app habit object
export function rowToHabit(row) {
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
    startValue:       row.start_value    ?? undefined,
    targetValue:      row.target_value   ?? undefined,
    unit:             row.unit           ?? undefined,
    dailyBudget:      row.daily_budget   ?? undefined,
    tapIncrement:     row.tap_increment  ?? 1,
    bestStreak:       row.best_streak    ?? 0,
    logs:             row.logs ?? [],
  };
}
