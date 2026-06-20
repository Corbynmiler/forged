/**
 * Trajectory Layer — momentum + forward projection derived from the existing
 * arc_daily_scores ledger. No new schema, no charts: just a directional read
 * on "where is this Arc heading if the last week keeps going."
 */
import { ARC_RANKS, getArcRankFromPercent } from "../arcProgress.js";

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
