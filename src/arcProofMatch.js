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

const TITLE_CRINGE_RE = /\b(warrior|alpha|elite|beast|grindset|king|queen)\b/i;

/** Clean a user/AI-provided Arc title (1–3 words). Returns "" if unusable. */
export function sanitizeArcTitle(title) {
  let t = String(title || "").trim().replace(/\s+/g, " ");
  if (!t || /^someone who\b/i.test(t) || TITLE_CRINGE_RE.test(t)) return "";
  const words = t.split(" ").filter(Boolean).slice(0, 3);
  t = words.join(" ");
  if (!t || t.length > 36) return "";
  return t;
}

/**
 * Derive a short Arc title from identity when the draft omits one.
 * Never returns a full sentence or "Someone who…".
 */
export function fallbackArcTitleFromIdentity(identity) {
  const raw = String(identity || "").trim();
  if (!raw) return "Foundation Arc";

  const lower = raw.toLowerCase();
  if (/pouch|nicotine|vape|smok|cigarette/.test(lower)) return "Clean Fuel Arc";
  if (/weight|kg\b|pound|gain\s+\d|bulk/.test(lower)) return "Fuel Arc";
  if (/build|ship|code|founder|startup/.test(lower)) return "Builder Arc";
  if (/reset|restart|fresh start/.test(lower)) return "Reset Arc";
  if (/momentum|streak|consisten/.test(lower)) return "Momentum Arc";
  if (/queenstown|travel|trip/.test(lower)) return "Queenstown Arc";

  let core = raw
    .replace(/^someone who\s+/i, "")
    .replace(/^a\s+/i, "")
    .replace(/^an\s+/i, "")
    .replace(/^i\s+want\s+to\s+be\s+/i, "")
    .replace(/^i'?m\s+becoming\s+/i, "")
    .replace(/[.!?].*$/, "")
    .trim();

  const segment = core.split(/[,—–-]/)[0].trim();
  const skip = new Set(["gain", "lose", "become", "being", "without", "with", "more", "less", "who", "that", "this"]);
  const words = segment
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9']/g, ""))
    .filter(w => w.length > 2 && !skip.has(w.toLowerCase()));

  if (words.length > 0) {
    const picked = words.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    const base = picked.join(" ");
    if (base && !/^Someone/i.test(base)) {
      return /\barc\b/i.test(base) ? base : `${base} Arc`;
    }
  }

  return "Foundation Arc";
}

/** Prefer draft title; otherwise generate from identity. */
export function resolveArcTitle(title, identity) {
  const clean = sanitizeArcTitle(title);
  if (clean) return clean;
  return fallbackArcTitleFromIdentity(identity);
}

/** Truncate at a word boundary so subtitles don't end mid-word ("for a shor…"). */
export function truncateAtWordBoundary(text, maxLen = 110) {
  const s = String(text || "").trim();
  if (!s || s.length <= maxLen) return s;
  const slice = s.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLen * 0.55)) {
    return `${slice.slice(0, lastSpace).trimEnd()}…`;
  }
  return `${slice.trimEnd()}…`;
}

const ARC_DURATION_OPTIONS = [14, 28, 56, 84];

/** Normalize coach/user duration to 2 / 4 / 8 / 12 weeks (days). Default 56. */
export function normalizeArcDuration(days) {
  const n = parseInt(days, 10);
  if (ARC_DURATION_OPTIONS.includes(n)) return n;
  if (Number.isFinite(n)) {
    if (n <= 21) return 14;
    if (n <= 42) return 28;
    if (n <= 70) return 56;
    if (n <= 98) return 84;
  }
  return 56;
}

export function arcDurationWeeksLabel(durationDays) {
  const d = normalizeArcDuration(durationDays);
  if (d === 14) return "2 weeks";
  if (d === 28) return "4 weeks";
  if (d === 84) return "12 weeks";
  return "8 weeks";
}

/** Obvious Arc edit intent in normal coach chat — route to ArcCoachSheet. */
export function detectsArcEditIntent(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (/\b(edit|change|update|tweak|rename|adjust)\b/.test(t) && /\barc\b/.test(t)) return true;
  if (/\barc\b/.test(t) && /\b(edit|change|update|rename)\b/.test(t)) return true;
  if (/\b(change|edit|update|tweak)\b/.test(t) && /\b(proof action|proof actions|bad[- ]?day minimum|arc title)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Short subtitle for the Today Arc header (shown with 2-line clamp in UI). */
export function arcHeaderSubtitle(block) {
  if (!block) return "";
  const why = String(block.whyStatement || "").trim();
  if (why) {
    const firstSentence = why.split(/(?<=[.!?])\s+/)[0]?.trim() || why;
    const pick = firstSentence.length >= 18 && firstSentence.length <= 100 ? firstSentence : why;
    return truncateAtWordBoundary(pick, 110);
  }
  let id = String(block.identity || "").trim();
  id = id.replace(/^someone who\s+/i, "").replace(/^i\s+want\s+to\s+be\s+/i, "").trim();
  if (!id) return "";
  return truncateAtWordBoundary(id, 110);
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
