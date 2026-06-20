/**
 * Trajectory Layer — momentum + forward projection derived from the existing
 * arc_daily_scores ledger. No new schema, no charts: just a directional read
 * on "where is this Arc heading if the last week keeps going."
 */
import { ARC_RANKS, getArcRankFromPercent } from "../arcProgress.js";
import { ymdAddDays } from "./arcTimeline.js";

const MIN_DAYS_FOR_TRAJECTORY = 4;
const RISING_THRESHOLD = 6;
const FADING_THRESHOLD = -6;
const PROJECTION_DAMPING = 0.5;
const MAX_PROJECTION_DAYS = 21;

function dayPercent(row) {
  const total = row.proofTotal ?? row.proof_total ?? 0;
  const done = row.proofDone ?? row.proof_done ?? 0;
  if (!total) return null;
  return (done / total) * 100;
}

function average(nums) {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * @returns {null | {
 *   momentum: 'rising'|'steady'|'fading',
 *   currentPercent: number,
 *   projectedPercent: number,
 *   currentRank: typeof ARC_RANKS[number],
 *   projectedRank: typeof ARC_RANKS[number],
 *   sentence: string,
 * }}
 */
export function computeArcTrajectory({ ledgerRows, currentPercent, daysLeft }) {
  if (currentPercent == null) return null;

  const series = (ledgerRows || [])
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(dayPercent)
    .filter(p => p != null);

  if (series.length < MIN_DAYS_FOR_TRAJECTORY) return null;

  const recentWindow = series.slice(-7);
  const priorWindow = series.slice(-14, -7);

  const recentRate = average(recentWindow);
  const priorRate = priorWindow.length >= 2 ? average(priorWindow) : null;

  const delta = priorRate == null ? 0 : recentRate - priorRate;
  const momentum = delta > RISING_THRESHOLD ? "rising" : delta < FADING_THRESHOLD ? "fading" : "steady";

  const projectionDays = Math.max(0, Math.min(daysLeft ?? 0, MAX_PROJECTION_DAYS));
  const slopePerDay = delta / 7;
  const projectedPercent = Math.max(
    0,
    Math.min(100, currentPercent + slopePerDay * PROJECTION_DAMPING * projectionDays),
  );

  const currentRank = getArcRankFromPercent(currentPercent);
  const projectedRank = getArcRankFromPercent(projectedPercent);

  const sentence = buildSentence({ momentum, currentRank, projectedRank });

  return { momentum, currentPercent, projectedPercent, currentRank, projectedRank, sentence };
}

function buildSentence({ momentum, currentRank, projectedRank }) {
  const ranksDiffer = projectedRank.label !== currentRank.label;
  const projectedIsHigher = ARC_RANKS.indexOf(projectedRank) > ARC_RANKS.indexOf(currentRank);

  if (momentum === "rising") {
    return ranksDiffer && projectedIsHigher
      ? `At this pace, this Arc lands ${projectedRank.label}.`
      : "Momentum is building — proof is compounding.";
  }
  if (momentum === "fading") {
    return ranksDiffer && !projectedIsHigher
      ? `At this pace, this Arc slips to ${projectedRank.label}.`
      : "Pace has cooled — the next few days matter.";
  }
  return `Holding steady at ${currentRank.label} pace.`;
}

export const MOMENTUM_COPY = {
  rising: { glyph: "↗", label: "Momentum rising" },
  steady: { glyph: "→", label: "Momentum holding" },
  fading: { glyph: "↘", label: "Momentum fading" },
};

/**
 * Day-by-day series for the Trajectory Fork visual.
 * "Current Path" = what was actually logged, one point per day with proof data.
 * "Chosen Path" = the flat ceiling — full proof, every day, the identity stated on day 1.
 * Days after today carry no real data; the caller draws those as a dashed
 * projection toward `projectedPercent`, not as fact.
 *
 * @returns {{ day, date, percent: number|null, hasData: boolean, isToday: boolean, isFuture: boolean, missed: boolean }[]}
 */
export function buildDualPathSeries({ block, ledgerRows, duration, dayNum }) {
  const start = block?.startDate;
  const map = new Map();
  for (const r of ledgerRows || []) {
    const total = r.proofTotal ?? r.proof_total ?? 0;
    const done = r.proofDone ?? r.proof_done ?? 0;
    const date = r.date || r.dateStr;
    if (!date) continue;
    map.set(date, total > 0 ? (done / total) * 100 : null);
  }

  const days = [];
  for (let i = 1; i <= duration; i++) {
    const date = start ? ymdAddDays(start, i - 1) : null;
    const hasData = date ? map.has(date) && map.get(date) != null : false;
    const percent = hasData ? map.get(date) : null;
    days.push({
      day: i,
      date,
      percent,
      hasData,
      isToday: i === dayNum,
      isFuture: i > dayNum,
      missed: hasData && percent === 0,
    });
  }
  return days;
}

/** Color read for the Current Path based on where it sits relative to the chosen ceiling. */
export function currentPathTone(percent) {
  if (percent == null) return "neutral";
  if (percent >= 65) return "aligned";
  if (percent >= 35) return "drifting";
  return "off-path";
}
