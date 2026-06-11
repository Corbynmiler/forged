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

function parseReceiptTitle(content) {
  if (!content?.trim()) return null;
  const KEYWORDS = ["Proof shown:", "Wins:", "Missed:", "Extras:", "Why:", "Pattern:", "Tomorrow:"];
  if (!KEYWORDS.some(k => content.includes(k))) {
    const line = content.split("\n").map(l => l.trim()).filter(Boolean)[0];
    return line ? stripJournalTitleLine(line).slice(0, 72) : null;
  }
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  return stripJournalTitleLine(lines[0]).slice(0, 72) || null;
}

function summarizeWeekVerdict(range, journalByDate, briefText) {
  if (briefText?.trim()) {
    const first = briefText.trim().split(/\n\n+/)[0]?.split(/[.!?]/)[0]?.trim();
    if (first && first.length <= 80) return first;
    if (first) return `${first.slice(0, 77)}…`;
  }
  const titles = [];
  for (const d of datesInRange(range.startDate, range.endDate)) {
    const entry = journalByDate.get(d);
    const t = entry?.content ? parseReceiptTitle(entry.content) : null;
    if (t) titles.push(t);
  }
  if (!titles.length) return null;
  const counts = {};
  for (const t of titles) counts[t] = (counts[t] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return best || null;
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
  const verdict = summarizeWeekVerdict(range, journalByDate, briefText);

  const isComplete = status === "complete" && (
    evidenceDays > 0 || proofPercent != null || !!briefText.trim()
  );

  return {
    ...range,
    status,
    daysPossible,
    evidenceDays,
    proofPercent,
    verdict,
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
