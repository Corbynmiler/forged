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
    const proofName = proofActionDisplayName(raw);
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
  if (/\b(limit|reduce|cut down|cut back|fewer|less|max|cap|avoid|no more|no spend|under the|discretionary)\b/.test(n)) return "limit";
  if (/\b(weekly|per week|times a week|each week|payday|on payday|every week|once a week|side.work|sell|list)\b/.test(n)) return "weekly";
  if (/\b(build|ship|project|session|deep work|code|write|minutes|hour)\b/.test(n)) return "project";
  if (/\b(transfer|save \$|deposit)\b/.test(n)) return "weekly";
  return "daily";
}

const WEAK_PROOF_PATTERNS = [
  /^check\s+(the\s+)?(savings\s+)?balance/i,
  /guilt.?free/i,
  /\b(mindset|visuali[sz]e|manifest|believe|affirm)\b/i,
  /^remember to\b/i,
  /^think about\b/i,
  /^be mindful\b/i,
];

/** Reject vague proof labels the model sometimes emits. */
export function isWeakProofAction(name) {
  const s = String(name || "").trim();
  if (!s || s.length < 4) return true;
  return WEAK_PROOF_PATTERNS.some(re => re.test(s));
}

/** Normalize API / UI proof entry to { name, cadence }. */
export function normalizeProofActionEntry(raw) {
  if (typeof raw === "string") {
    const name = raw.trim().slice(0, 60);
    if (!name || isWeakProofAction(name)) return null;
    return { name, cadence: inferHabitTypeFromProofName(name) };
  }
  if (raw && typeof raw === "object") {
    const name = String(raw.name || raw.label || "").trim().slice(0, 60);
    if (!name || isWeakProofAction(name)) return null;
    const cad = raw.cadence || raw.habitType || raw.habit_type;
    const cadence = ["daily", "weekly", "limit", "project"].includes(cad)
      ? cad
      : inferHabitTypeFromProofName(name);
    return { name, cadence };
  }
  return null;
}

export function proofActionDisplayName(entry) {
  if (typeof entry === "string") return entry.trim();
  return String(entry?.name || "").trim();
}

export function proofActionNamesList(proofActions) {
  return (proofActions || []).map(proofActionDisplayName).filter(Boolean);
}

/** Minimal in-app habit object for a proof action that has no existing match. */
export function buildNewProofHabit(proofName, blockId, habitTypeOverride = null) {
  const habitType = habitTypeOverride || inferHabitTypeFromProofName(proofName);
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

export const ARC_DURATION_MIN_DAYS = 14;
export const ARC_DURATION_MAX_DAYS = 98;
export const ARC_DURATION_PRESETS = [14, 28, 42, 56, 84];

/** Clamp to allowed Arc length (2–14 weeks). Preserves exact days — no snapping to presets. */
export function clampArcDurationDays(days) {
  const n = parseInt(days, 10);
  if (!Number.isFinite(n)) return 28;
  return Math.min(ARC_DURATION_MAX_DAYS, Math.max(ARC_DURATION_MIN_DAYS, n));
}

/** @deprecated alias — use clampArcDurationDays */
export function normalizeArcDuration(days) {
  return clampArcDurationDays(days);
}

/** Human label for any valid duration (e.g. 42 → "6 weeks", 45 → "45 days"). */
export function arcDurationWeeksLabel(durationDays) {
  const d = clampArcDurationDays(durationDays);
  if (d % 7 === 0) {
    const w = d / 7;
    return w === 1 ? "1 week" : `${w} weeks`;
  }
  return `${d} days`;
}

/** Build an editable Arc draft object from a stored forge block + its proof habits. */
export function forgeBlockToArcDraft(block, proofHabits = []) {
  if (!block) return null;
  const identity = String(block.identity || "").trim();
  if (!identity) return null;
  const proofActions = (proofHabits || [])
    .map(h => normalizeProofActionEntry({ name: h.name, cadence: h.habitType }))
    .filter(Boolean);
  return {
    title: resolveArcTitle(block.title, identity),
    identity,
    why: String(block.whyStatement || block.why || "").trim(),
    oldPattern: String(block.oldPattern || "").trim(),
    minimumProof: String(block.minimumProof || "").trim(),
    durationDays: clampArcDurationDays(block.durationDays),
    proofActions,
  };
}

/** End date (local YYYY-MM-DD) from start + duration days. */
export function arcEndDateFromStart(startYmd, durationDays) {
  const [y, m, day] = String(startYmd || "").split("-").map(Number);
  const end = new Date(y, (m || 1) - 1, (day || 1) + clampArcDurationDays(durationDays));
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

/** Duration in days from start to end (inclusive span). */
export function arcDurationDaysFromEndDate(startYmd, endYmd) {
  const start = Date.parse(`${startYmd}T12:00:00`);
  const end = Date.parse(`${endYmd}T12:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 28;
  const days = Math.round((end - start) / 86400000);
  return clampArcDurationDays(Math.max(1, days));
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

/** Short subtitle for the Today Arc strip — full text; UI wraps on narrow screens. */
export function arcHeaderSubtitle(block) {
  if (!block) return "";
  const why = String(block.whyStatement || "").trim();
  if (why) {
    const firstSentence = why.split(/(?<=[.!?])\s+/)[0]?.trim() || why;
    return firstSentence.length >= 18 && firstSentence.length <= 100 ? firstSentence : why;
  }
  let id = String(block.identity || "").trim();
  id = id.replace(/^someone who\s+/i, "").replace(/^i\s+want\s+to\s+be\s+/i, "").trim();
  return id;
}

/**
 * Coerce typed input, pill payloads, or mistaken event objects into a plain string.
 * Never pass React events into message state.
 */
export function normalizeChatInput(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object") {
    if (typeof value.preventDefault === "function" || value.nativeEvent != null) return "";
    if (value.target != null && (value.type === "click" || value.type === "submit")) return "";
    for (const k of ["text", "message", "label", "prompt", "value", "content"]) {
      const v = value[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  const coerced = String(value);
  return coerced === "[object Object]" ? "" : coerced.trim();
}

/**
 * Strip obvious markdown from coach bubbles (**, *, `, ##) for plain display.
 * Splits inline • bullets and section labels onto separate lines (mobile-friendly).
 */
export function formatCoachChatDisplay(text) {
  const raw = normalizeChatInput(text) || (typeof text === "string" ? text.trim() : "");
  if (!raw) return "";

  let s = raw;
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*]\s+/gm, "• ");

  // Inline bullet chains → one bullet per line
  if (s.includes("•")) {
    s = s.replace(/\s*•\s*/g, "\n• ");
    s = s.replace(/^\n+/, "");
  }

  // Section labels (Vision:, Why:, Proof actions:, …) on their own line
  const labelPattern = /(?:^|[.!?]\s+)((?:Vision|Why(?:\s+it\s+matters)?|Old\s+pattern|Minimum\s+proof|Bad[- ]?day\s+minimum|Proof\s+actions|Identity|Title|Direction):)\s*/gi;
  s = s.replace(labelPattern, "\n\n$1\n");

  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Safe string for chat bubble render — never shows [object Object]. */
export function bubbleContentForDisplay(content) {
  const normalized = normalizeChatInput(content);
  if (normalized) return formatCoachChatDisplay(normalized);
  if (typeof content === "string" && content.trim()) return formatCoachChatDisplay(content);
  return "";
}
