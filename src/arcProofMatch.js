/**
 * Fuzzy matching between Arc draft proof-action names and existing habits.
 * Used when confirming an Arc so we reuse "Limit pouches" instead of creating
 * a duplicate when the user already tracks a similar limit habit.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "my", "to", "for", "and", "or", "of", "on", "in", "at",
  "per", "day", "daily", "each", "every",
]);

/** Lowercase, strip punctuation, collapse whitespace — comparable surface form. */
export function normalizeArcName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(token) {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/** Meaningful tokens for overlap checks (limit, pouches, nicotine, …). */
function arcNameTokens(name) {
  const norm = normalizeArcName(name);
  const raw = norm.split(" ").filter(w => w.length > 1 && !STOP_WORDS.has(w));
  const out = new Set();
  for (const w of raw) {
    out.add(w);
    out.add(singularize(w));
  }
  return out;
}

/**
 * Score how well a proof-action label matches an existing habit name.
 * 100 = exact normalized match; 70+ = good enough to reuse the habit.
 */
export function scoreProofMatch(proofName, habitName) {
  const p = normalizeArcName(proofName);
  const h = normalizeArcName(habitName);
  if (!p || !h) return 0;
  if (p === h) return 100;
  if (h.includes(p) || p.includes(h)) return 92;

  const pt = arcNameTokens(proofName);
  const ht = arcNameTokens(habitName);
  if (pt.size === 0) return 0;

  let overlap = 0;
  for (const t of pt) if (ht.has(t)) overlap += 1;
  const ratio = overlap / pt.size;

  if (ratio === 1 && overlap >= 1) return 88;
  if (ratio >= 0.8 && overlap >= 2) return 85;
  if (ratio >= 0.66 && overlap >= 2) return 78;
  if (overlap >= 2 && ratio >= 0.5) return 72;
  return 0;
}

const MATCH_THRESHOLD = 70;

/**
 * Pick the best unused habit for a suggested proof action, or null.
 */
export function findBestHabitMatch(proofName, habits, usedIds = new Set()) {
  let best = null;
  let bestScore = 0;
  for (const h of habits || []) {
    if (!h?.id || usedIds.has(h.id)) continue;
    if (h.habitType === "log") continue;
    const score = scoreProofMatch(proofName, h.name);
    if (score > bestScore && score >= MATCH_THRESHOLD) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

/**
 * Map draft proof names → existing habits (reuse) vs names that need new habits.
 */
export function resolveProofActionHabits(proofNames, existingHabits) {
  const track = (existingHabits || []).filter(h => h && h.habitType !== "log");
  const used = new Set();
  const matched = [];
  const unmatched = [];

  for (const raw of proofNames || []) {
    const proofName = String(raw || "").trim();
    if (!proofName) continue;
    const habit = findBestHabitMatch(proofName, track, used);
    if (habit) {
      used.add(habit.id);
      matched.push({ proofName, habit });
    } else {
      unmatched.push(proofName);
    }
  }
  return { matched, unmatched };
}

/** True when a proof label already maps to an existing habit (fuzzy). */
export function proofNameMatchesExisting(proofName, existingHabits) {
  const track = (existingHabits || []).filter(h => h && h.habitType !== "log");
  return !!findBestHabitMatch(proofName, track, new Set());
}

/** Guess habit_type for a new proof habit from its label. */
export function inferHabitTypeFromProofName(name) {
  const n = normalizeArcName(name);
  if (/\b(limit|reduce|cut down|cut back|fewer|less|max|cap|avoid|no more)\b/.test(n)) return "limit";
  if (/\b(weekly|per week|times a week|each week)\b/.test(n)) return "weekly";
  if (/\b(build|ship|project|session|deep work|code|write)\b/.test(n)) return "project";
  return "daily";
}

/** Minimal in-app habit object for a proof action that has no existing match. */
export function buildNewProofHabit(proofName, blockId) {
  const habitType = inferHabitTypeFromProofName(proofName);
  const base = {
    id: crypto.randomUUID(),
    name: String(proofName).trim().slice(0, 60),
    emoji: "•",
    habitType,
    color: "#C0392B",
    streak: 0,
    bestStreak: 0,
    reflection: true,
    reflectionPrompt: "",
    tapIncrement: 1,
    dailyTargetMinutes: 60,
    logs: [],
    blockId,
    isProofAction: true,
  };
  if (habitType === "limit") {
    base.dailyBudget = 1;
    base.unit = "unit";
    base.goalAim = "reduce";
  }
  if (habitType === "weekly") base.weeklyTarget = 3;
  return base;
}

/**
 * Strip obvious markdown from coach bubbles (**, *, `, ##) for plain display.
 * Raw message text sent to the API is unchanged.
 */
export function formatCoachChatDisplay(text) {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*]\s+/gm, "• ");
  return s.trim();
}
