/**
 * Derive Arc week checkpoints from existing data — no new tables.
 * Arc weeks are anchored to forge_blocks.start_date (week 1 = days 1–7).
 */
import { todayStr, parseLocal, weekStartFor, stripJournalTitleLine } from "../utils.js";
import { getArcDurationDays } from "../arcProgress.js";

export function ymdAddDays(ymd, delta) {
  const d = parseLocal(ymd);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getArcWeekCount(block) {
  return Math.max(1, Math.ceil(getArcDurationDays(block) / 7));
}

/** Inclusive date range for Arc week `weekNum` (1-based). */
export function getArcWeekDateRange(block, weekNum) {
  const start = block?.startDate;
  if (!start) return null;
  const duration = getArcDurationDays(block);
  const totalWeeks = getArcWeekCount(block);
  const w = Math.min(totalWeeks, Math.max(1, weekNum));
  const dayOffsetStart = (w - 1) * 7;
  const dayOffsetEnd = Math.min(w * 7 - 1, duration - 1);
  return {
    weekNum: w,
    startDate: ymdAddDays(start, dayOffsetStart),
    endDate: ymdAddDays(start, dayOffsetEnd),
    dayStart: dayOffsetStart + 1,
    dayEnd: dayOffsetEnd + 1,
  };
}

export function getArcDayNumberForDate(block, dateStr) {
  if (!block?.startDate || !dateStr) return null;
  const duration = getArcDurationDays(block);
  const elapsed = Math.floor((parseLocal(dateStr) - parseLocal(block.startDate)) / 86400000);
  if (elapsed < 0 || elapsed >= duration) return null;
  return elapsed + 1;
}

export function getArcWeekForDate(block, dateStr) {
  const dayNum = getArcDayNumberForDate(block, dateStr);
  if (dayNum == null) return null;
  return Math.min(getArcWeekCount(block), Math.ceil(dayNum / 7));
}

export function getCurrentArcWeek(block, today = todayStr()) {
  const w = getArcWeekForDate(block, today);
  return w ?? 1;
}

/** complete | current | upcoming */
export function getArcWeekStatus(range, today = todayStr()) {
  if (!range) return "upcoming";
  if (today > range.endDate) return "complete";
  if (today < range.startDate) return "upcoming";
  return "current";
}

function datesInRange(startDate, endDate) {
  const out = [];
  let d = startDate;
  while (d <= endDate) {
    out.push(d);
    d = ymdAddDays(d, 1);
  }
  return out;
}

function ledgerMap(arcLedgerRows) {
  const m = new Map();
  for (const row of arcLedgerRows || []) {
    const date = row.date || row.dateStr;
    if (date) m.set(date, row);
  }
  return m;
}

function journalMap(journalEntries) {
  const m = new Map();
  for (const e of journalEntries || []) {
    if (e?.date) m.set(e.date, e);
  }
  return m;
}

/** Calendar Monday brief key that best overlaps this Arc week. */
export function calendarBriefKeyForArcWeek(range) {
  if (!range) return null;
  const mid = ymdAddDays(range.startDate, Math.floor((range.dayEnd - range.dayStart) / 2));
  return weekStartFor(mid);
}

const RECEIPT_KEYWORDS = ["Proof shown:", "Wins:", "Hard parts:", "Missed:", "Extras:", "Why:", "Pattern:", "Tomorrow:"];

/** Parse receipt into title, pattern line, proof snippet. */
export function parseReceiptStructured(content) {
  if (!content?.trim()) return { title: null, pattern: null, narrative: null };
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  if (!RECEIPT_KEYWORDS.some(k => content.includes(k))) {
    const title = stripJournalTitleLine(lines[0] || "");
    return { title: title || null, pattern: null, narrative: lines.slice(1).join(" ") || content };
  }
  const title = stripJournalTitleLine(lines[0] || "");
  let i = 1;
  const narrativeLines = [];
  const sections = {};
  while (i < lines.length && !RECEIPT_KEYWORDS.some(k => lines[i].startsWith(k))) {
    narrativeLines.push(lines[i]);
    i++;
  }
  while (i < lines.length) {
    for (const kw of RECEIPT_KEYWORDS) {
      if (lines[i].startsWith(kw)) {
        sections[kw.slice(0, -1).toLowerCase()] = lines[i].slice(kw.length).trim();
        break;
      }
    }
    i++;
  }
  return {
    title: title || null,
    pattern: sections.pattern || null,
    narrative: narrativeLines.join(" ") || null,
    proof: sections["proof shown"] || null,
    wins: sections.wins || null,
    hardParts: sections["hard parts"] || null,
    missed: sections.missed || null,
    extras: sections.extras || null,
    why: sections.why || null,
    tomorrow: sections.tomorrow || null,
  };
}

/** Localised day label for vertical journey, e.g. "Monday · May 26". */
export function formatDayLabel(dateStr, today = todayStr()) {
  const d = parseLocal(dateStr);
  const dayName = d.toLocaleDateString(undefined, { weekday: "long" });
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (dateStr === today) return `Today · ${datePart}`;
  return `${dayName} · ${datePart}`;
}

/**
 * Day node states for vertical week journey.
 * evidence | partial | empty | today | future
 */
export function buildWeekDayJourney(week, {
  arcLedgerRows = [],
  journalEntries = [],
  today = todayStr(),
} = {}) {
  if (!week?.startDate || !week?.endDate) return [];

  const ledger = ledgerMap(arcLedgerRows);
  const journalByDate = journalMap(journalEntries);
  const days = datesInRange(week.startDate, week.endDate);

  return days.map((dateStr, i) => {
    const journal = journalByDate.get(dateStr);
    const led = ledger.get(dateStr);
    const hasReceipt = !!journal?.content?.trim();
    const proofDone = led?.proof_done ?? led?.proofDone ?? 0;
    const proofTotal = led?.proof_total ?? led?.proofTotal ?? 0;
    const hasProof = proofTotal > 0 || proofDone > 0;
    const isToday = dateStr === today;
    const isFuture = dateStr > today;

    let state;
    if (isFuture) state = "future";
    else if (hasReceipt) state = isToday ? "today" : "evidence";
    else if (hasProof) state = isToday ? "today" : "partial";
    else if (isToday) state = "today";
    else state = "empty";

    const parsed = hasReceipt ? parseReceiptStructured(journal.content) : null;

    return {
      date: dateStr,
      arcDay: week.dayStart + i,
      label: formatDayLabel(dateStr, today),
      state,
      hasReceipt,
      hasProof,
      proofDone,
      proofTotal,
      journal: hasReceipt ? { content: journal.content, date: dateStr } : null,
      parsed,
      isFirst: i === 0,
      isLast: i === days.length - 1,
    };
  });
}

/** Human-readable evidence count for checkpoints. */
export function formatEvidenceLabel(evidenceDays, daysPossible, status) {
  const possible = Math.max(1, daysPossible || 7);
  if (status === "upcoming") return "";
  if (evidenceDays === 0) return status === "complete" ? "No evidence" : "Not yet";
  if (evidenceDays === 1) return "1 day captured";
  if (evidenceDays === possible) return `${evidenceDays} days captured`;
  return `${evidenceDays} of ${possible} days`;
}

/** Short status line for chapter panel. */
export function formatWeekStatusLine(week) {
  const { evidenceDays, daysPossible, proofPercent, status } = week;
  const possible = Math.max(1, daysPossible || 7);
  const parts = [];
  if (evidenceDays > 0) {
    if (evidenceDays === 1) parts.push("Evidence on 1 day");
    else if (evidenceDays < possible) parts.push(`Evidence on ${evidenceDays} of ${possible} days`);
    else parts.push(`Evidence on ${evidenceDays} days`);
  } else if (status === "complete") {
    parts.push("No days recorded");
  } else if (status === "current") {
    parts.push("Week in progress");
  }
  if (proofPercent != null && evidenceDays > 0) {
    parts.push(`${proofPercent}% proof shown`);
  }
  return parts.join(" · ") || (status === "upcoming" ? "Ahead" : "");
}

const CHAPTER_TITLE_MAX = 55;
const CHAPTER_TITLE_WORD_MAX = 7;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Fit text into a concise chapter title (max ~55 chars, ~3–7 words). */
export function truncateChapterTitle(text) {
  if (!text?.trim()) return null;
  let t = text.trim().replace(/^["']|["']$/g, "");
  if (t.includes(" — ") && wordCount(t.split(" — ")[0]) <= CHAPTER_TITLE_WORD_MAX) {
    t = t.split(" — ")[0].trim();
  }
  if (t.length <= CHAPTER_TITLE_MAX && wordCount(t) <= CHAPTER_TITLE_WORD_MAX) return t;
  if (wordCount(t) > CHAPTER_TITLE_WORD_MAX) {
    const shortened = t.split(/\s+/).slice(0, CHAPTER_TITLE_WORD_MAX).join(" ");
    if (shortened.length <= CHAPTER_TITLE_MAX) return shortened;
  }
  if (t.length > CHAPTER_TITLE_MAX) {
    const clipped = t.slice(0, CHAPTER_TITLE_MAX - 1);
    return `${clipped.replace(/\s+\S*$/, "").trim()}…`;
  }
  return t;
}

function condenseBriefToTitle(briefText) {
  const first = (briefText.trim().match(/[^.!?]+[.!?]?/)?.[0] || briefText).trim();
  const cleaned = first.replace(/^this week[,]?\s*/i, "").replace(/^you\s+/i, "");
  return truncateChapterTitle(cleaned);
}

function briefSummaryFromBrief(briefText, usedTitle) {
  if (!briefText?.trim()) return null;
  const trimmed = briefText.trim();
  const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
  const first = sentences[0]?.trim() || "";
  const titleStem = (usedTitle || "").replace(/…$/, "").trim();

  if (titleStem && first.length > titleStem.length + 8) {
    if (first.toLowerCase().startsWith(titleStem.toLowerCase())) {
      const rest = first.slice(titleStem.length).replace(/^[—,.\s]+/, "").trim();
      if (rest.length >= 16) return rest.slice(0, 240);
    }
    if (first.length > CHAPTER_TITLE_MAX) return first.slice(0, 240);
  }
  if (sentences.length >= 2) {
    const pair = sentences.slice(0, 2).join(" ").trim();
    if (pair.length >= 20 && pair !== usedTitle) return pair.slice(0, 240);
  }
  if (first.length > CHAPTER_TITLE_MAX && first !== usedTitle) return first.slice(0, 240);
  return null;
}

const WEAK_TITLE_RE = /^(solid|good|quiet|productive|recovery|reset|steady|building|foundations?|deep work|mixed|partial|light)\b/i;
const COMMA_LIST_RE = /^[^,]+,\s*[^,]+/;

export function isWeakChapterCandidate(title) {
  if (!title?.trim()) return true;
  const t = title.trim();
  if (t.length < 8) return true;
  if (COMMA_LIST_RE.test(t) && t.split(",").length >= 2) return true;
  if (WEAK_TITLE_RE.test(t) && t.split(/\s+/).length <= 4) return true;
  return false;
}

export function scoreChapterCandidate(text) {
  if (!text?.trim()) return -99;
  const t = text.trim();
  let score = 0;
  const words = t.split(/\s+/).length;
  if (words >= 4 && words <= 9) score += 4;
  if (t.length >= 18 && t.length <= 52) score += 3;
  if (/\b(build|forged|ship|launch|exhaust|momentum|system|closecraft|product|weekend|body|paid)\b/i.test(t)) score += 5;
  if (/\b(the|while|without|two|three)\b/i.test(t)) score += 2;
  if (isWeakChapterCandidate(t)) score -= 8;
  if (t.includes(",")) score -= 5;
  return score;
}

function headlineFromBrief(briefText) {
  if (!briefText?.trim()) return null;
  const trimmed = briefText.trim();
  const firstBlock = trimmed.split(/\n\n+/)[0] || trimmed;
  const sentences = firstBlock.match(/[^.!?]+[.!?]?/g) || [firstBlock];
  for (const raw of sentences) {
    const s = raw.replace(/^["']|["']$/g, "").trim();
    if (s.length < 12 || s.length > CHAPTER_TITLE_MAX) continue;
    if (wordCount(s) > CHAPTER_TITLE_WORD_MAX) continue;
    if (/^this week/i.test(s)) continue;
    if (/^you /i.test(s)) continue;
    const scored = scoreChapterCandidate(s);
    if (scored >= 2) return s;
  }
  return null;
}

function chapterFromReceipts(range, journalByDate) {
  const candidates = [];
  for (const d of datesInRange(range.startDate, range.endDate)) {
    const entry = journalByDate.get(d);
    if (!entry?.content) continue;
    const parsed = parseReceiptStructured(entry.content);
    if (parsed.pattern && !isWeakChapterCandidate(parsed.pattern)) {
      candidates.push({ text: parsed.pattern, score: scoreChapterCandidate(parsed.pattern) + 3 });
    }
    if (parsed.title && !isWeakChapterCandidate(parsed.title)) {
      candidates.push({ text: parsed.title, score: scoreChapterCandidate(parsed.title) });
    }
    if (parsed.narrative && parsed.narrative.length >= 24) {
      const snippet = parsed.narrative.split(/[.!?]/)[0]?.trim();
      if (snippet && snippet.length >= 16 && snippet.length <= 58) {
        candidates.push({ text: snippet, score: scoreChapterCandidate(snippet) - 1 });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.text || null;
}

/**
 * Chapter title + optional summary hierarchy:
 * 1. Concise weekly review headline (title) + remainder (summary)
 * 2. Receipt-derived title; brief body becomes summary when available
 * 3. Factual empty states
 */
export function deriveChapterContent({ status, briefText, range, journalByDate, evidenceDays }) {
  if (status === "upcoming") return { chapterTitle: null, chapterSummary: null };
  if (status === "complete" && evidenceDays === 0) {
    return { chapterTitle: "No evidence recorded", chapterSummary: null };
  }
  if (status === "current" && evidenceDays === 0) {
    return { chapterTitle: null, chapterSummary: null };
  }

  const fromReceipts = chapterFromReceipts(range, journalByDate);
  const receiptTitle = fromReceipts ? truncateChapterTitle(fromReceipts) : null;
  const briefHeadline = headlineFromBrief(briefText);

  if (briefHeadline) {
    const title = truncateChapterTitle(briefHeadline);
    const summary = briefSummaryFromBrief(briefText, title);
    return { chapterTitle: title, chapterSummary: summary };
  }

  if (receiptTitle) {
    const summary = briefText?.trim() ? briefSummaryFromBrief(briefText, receiptTitle) : null;
    return { chapterTitle: receiptTitle, chapterSummary: summary };
  }

  if (briefText?.trim()) {
    return {
      chapterTitle: condenseBriefToTitle(briefText),
      chapterSummary: briefSummaryFromBrief(briefText, null),
    };
  }

  if (evidenceDays === 0 && status === "complete") {
    return { chapterTitle: "A quiet week", chapterSummary: null };
  }
  return { chapterTitle: null, chapterSummary: null };
}

/** @deprecated use deriveChapterContent */
export function deriveChapterTitle(opts) {
  return deriveChapterContent(opts).chapterTitle;
}

/**
 * Pick a single representative title for a calendar week's worth of daily
 * chapters — reuses the exact same scoring heuristic Arc week chapters use
 * (specific, declarative, not a generic mood word), just applied to a plain
 * list of { title } days instead of an Arc-bound receipt range. No AI call:
 * every candidate here was already written by the nightly rollover when it
 * created that day's daily_summaries row, so this is a free, local pick —
 * not a new summary.
 */
export function deriveWeekChapterFromDays(days) {
  const candidates = [];
  for (const d of days || []) {
    const title = (d?.title || "").trim();
    if (title && !isWeakChapterCandidate(title)) {
      candidates.push({ text: title, score: scoreChapterCandidate(title) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) return truncateChapterTitle(candidates[0].text);
  const fallback = (days || []).find(d => (d?.title || "").trim());
  return fallback ? truncateChapterTitle(fallback.title.trim()) : null;
}

/**
 * Build week snapshot metrics for one Arc week.
 */
export function buildArcWeekSnapshot(block, weekNum, {
  arcLedgerRows = [],
  journalEntries = [],
  weeklyBriefsByWeekStart = {},
  today = todayStr(),
} = {}) {
  const range = getArcWeekDateRange(block, weekNum);
  if (!range) return null;

  const status = getArcWeekStatus(range, today);
  const ledger = ledgerMap(arcLedgerRows);
  const journalByDate = journalMap(journalEntries);
  const days = datesInRange(range.startDate, range.endDate);
  const daysPossible = days.filter(d => d <= today).length;

  let evidenceDays = 0;
  let proofDoneSum = 0;
  let proofTotalSum = 0;
  const receipts = [];

  for (const d of days) {
    if (d > today) continue;
    const led = ledger.get(d);
    const journal = journalByDate.get(d);
    const hasLedger = led && (led.proof_done > 0 || led.proof_total > 0);
    const hasJournal = !!journal?.content?.trim();
    if (hasLedger || hasJournal) evidenceDays += 1;
    if (led?.proof_total > 0) {
      proofDoneSum += led.proof_done ?? led.proofDone ?? 0;
      proofTotalSum += led.proof_total ?? led.proofTotal ?? 0;
    }
    if (journal) {
      receipts.push({
        date: d,
        content: journal.content,
        isAiGenerated: journal.is_ai_generated,
        manuallyEdited: journal.manually_edited,
      });
    }
  }

  const proofPercent = proofTotalSum > 0
    ? Math.round((proofDoneSum / proofTotalSum) * 100)
    : null;

  const briefKey = calendarBriefKeyForArcWeek(range);
  const briefText = briefKey ? (weeklyBriefsByWeekStart[briefKey]?.text || "") : "";
  const { chapterTitle, chapterSummary } = deriveChapterContent({
    status, briefText, range, journalByDate, evidenceDays,
  });
  const evidenceLabel = formatEvidenceLabel(evidenceDays, daysPossible, status);

  return {
    ...range,
    status,
    daysPossible,
    evidenceDays,
    proofPercent,
    chapterTitle,
    chapterSummary,
    evidenceLabel,
    briefText: briefText.trim() || null,
    briefWeekStart: briefKey,
    receipts,
    isGenuinelyComplete: status === "complete" && (evidenceDays > 0 || !!briefText.trim()),
  };
}

/** Full timeline for one forge_block. */
export function buildArcTimeline(block, data = {}) {
  if (!block?.id || !block?.startDate) return { weeks: [], weekCount: 0, currentWeek: 1 };

  const weekCount = getArcWeekCount(block);
  const currentWeek = getCurrentArcWeek(block, data.today);
  const weeks = [];
  for (let w = 1; w <= weekCount; w++) {
    const snap = buildArcWeekSnapshot(block, w, data);
    if (snap) weeks.push(snap);
  }

  let evidenceDaysTotal = 0;
  for (const w of weeks) {
    if (w.status !== "upcoming") evidenceDaysTotal += w.evidenceDays;
  }

  return {
    weeks,
    weekCount,
    currentWeek,
    evidenceDaysTotal,
    durationDays: getArcDurationDays(block),
  };
}

/** Journal entries outside block date range — do not misassign. */
export function partitionJournalEntries(block, journalEntries, today = todayStr()) {
  const inArc = [];
  const unassigned = [];
  if (!block?.startDate) {
    return { inArc: [], unassigned: journalEntries || [] };
  }
  const duration = getArcDurationDays(block);
  const arcEnd = ymdAddDays(block.startDate, duration - 1);
  for (const e of journalEntries || []) {
    if (!e?.date) continue;
    if (e.date >= block.startDate && e.date <= arcEnd && e.date <= today) {
      inArc.push(e);
    } else {
      unassigned.push(e);
    }
  }
  return { inArc, unassigned };
}

export function reviewTextFromBlock(block) {
  const r = block?.review;
  if (!r) return "";
  if (typeof r === "string") return r.trim();
  return (r.text || "").trim();
}
