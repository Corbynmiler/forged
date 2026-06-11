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

const RECEIPT_KEYWORDS = ["Proof shown:", "Wins:", "Missed:", "Extras:", "Why:", "Pattern:", "Tomorrow:"];

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
    proof: sections["proof shown"] || sections.wins || null,
  };
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
  const parts = [];
  if (evidenceDays > 0) {
    parts.push(evidenceDays === 1 ? "Evidence on 1 day" : `Evidence on ${evidenceDays} days`);
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

const WEAK_TITLE_RE = /^(solid|good|quiet|productive|recovery|reset|steady|building|foundations?|deep work|mixed|partial|light)\b/i;
const COMMA_LIST_RE = /^[^,]+,\s*[^,]+/;

function isWeakChapterCandidate(title) {
  if (!title?.trim()) return true;
  const t = title.trim();
  if (t.length < 8) return true;
  if (COMMA_LIST_RE.test(t) && t.split(",").length >= 2) return true;
  if (WEAK_TITLE_RE.test(t) && t.split(/\s+/).length <= 4) return true;
  return false;
}

function scoreChapterCandidate(text) {
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
    if (s.length < 12 || s.length > 58) continue;
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
 * Chapter title hierarchy:
 * 1. Weekly review headline
 * 2. Best receipt pattern / title in week
 * 3. Factual empty states
 */
export function deriveChapterTitle({ status, briefText, range, journalByDate, evidenceDays }) {
  if (status === "upcoming") return null;
  if (status === "complete" && evidenceDays === 0) return "No evidence recorded";
  if (status === "current" && evidenceDays === 0) return null;

  const fromBrief = headlineFromBrief(briefText);
  if (fromBrief) return fromBrief;

  const fromReceipts = chapterFromReceipts(range, journalByDate);
  if (fromReceipts) return fromReceipts;

  if (evidenceDays === 0 && status === "complete") return "A quiet week";
  return null;
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
  const chapterTitle = deriveChapterTitle({
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
