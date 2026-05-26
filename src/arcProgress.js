/**
 * Arc proof progression — separate from lifetime XP (profiles.xp).
 */

import { todayStr, parseLocal, isSatisfiedForTodayRing } from "./utils.js";

export const ARC_DAILY_XP_CAP = 40;
export const ARC_BASE_POOL = 30;
export const ARC_PERFECT_BONUS = 10;

export const LIFETIME_XP_DEFAULT = 10;
export const LIFETIME_XP_DURING_ARC_NON_PROOF = 2;
export const LIFETIME_XP_LIMIT_NONE = 15;

/** Arc ranks from proof completion % (not lifetime XP). */
export const ARC_RANKS = [
  { minPercent: 0,  label: "Spark",    color: "#B8B6AC", meaning: "Early in this Arc — proof is still forming" },
  { minPercent: 40, label: "Kindling", color: "#C8902A", meaning: "Proof is starting to stick" },
  { minPercent: 60, label: "Tempered", color: "#E67E22", meaning: "Steady proof across the Arc" },
  { minPercent: 75, label: "Hardened", color: "#C0392B", meaning: "Strong proof consistency" },
  { minPercent: 90, label: "Forged",   color: "#F5C842", meaning: "This Arc is landing" },
];

export function isProofHabitForBlock(habit, blockId) {
  if (!habit || !blockId) return false;
  return habit.isProofAction === true && habit.blockId === blockId;
}

export function getProofHabitsForBlock(habits, blockId) {
  return (habits || []).filter(
    h => h && h.habitType !== "log" && isProofHabitForBlock(h, blockId),
  );
}

export function getArcDurationDays(activeBlock) {
  return Math.max(1, activeBlock?.durationDays || 56);
}

export function getArcDayNumber(activeBlock) {
  if (!activeBlock?.startDate) return 1;
  const duration = getArcDurationDays(activeBlock);
  const today = todayStr();
  const daysElapsed = Math.floor(
    (parseLocal(today) - parseLocal(activeBlock.startDate)) / 86400000,
  );
  return Math.min(duration, Math.max(1, daysElapsed + 1));
}

/**
 * Daily Arc XP from proof state (idempotent for a given proofDone/proofTotal).
 */
export function computeTodayArcXpAward({ proofTotal, proofDone }) {
  const total = Math.max(0, Number(proofTotal) || 0);
  const done = Math.max(0, Math.min(Number(proofDone) || 0, total));
  if (total === 0 || done === 0) return 0;

  const perProof = Math.floor(ARC_BASE_POOL / total);
  let award = done * perProof;
  if (done === total) award += ARC_PERFECT_BONUS;
  return Math.min(award, ARC_DAILY_XP_CAP);
}

export function getArcRankFromPercent(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  let rank = ARC_RANKS[0];
  for (const r of ARC_RANKS) {
    if (p >= r.minPercent) rank = r;
  }
  return rank;
}

/**
 * Aggregate proof % from ledger rows, replacing today with live habit state.
 */
export function calculateArcProofPercent({ ledgerRows, habits, blockId, today = todayStr() }) {
  const proofHabits = getProofHabitsForBlock(habits, blockId);
  const todayTotal = proofHabits.length;
  const todayDone = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;

  let sumDone = 0;
  let sumTotal = 0;
  let hasHistory = false;

  for (const row of ledgerRows || []) {
    const d = row.date || row.dateStr;
    if (d === today) continue;
    const pt = row.proof_total ?? row.proofTotal ?? 0;
    const pd = row.proof_done ?? row.proofDone ?? 0;
    if (pt > 0) {
      hasHistory = true;
      sumDone += pd;
      sumTotal += pt;
    }
  }

  if (todayTotal > 0) {
    hasHistory = true;
    sumDone += todayDone;
    sumTotal += todayTotal;
  }

  if (!hasHistory || sumTotal === 0) {
    if (todayTotal > 0) {
      return Math.round((todayDone / todayTotal) * 100);
    }
    return null;
  }

  return Math.round((sumDone / sumTotal) * 100);
}

/**
 * @param {number|null} percent
 * @param {boolean} hasLedgerData
 * @param {{ proofDoneToday?: number, priorLedgerDays?: number }} [opts]
 */
export function getArcRankDisplay(percent, hasLedgerData, opts = {}) {
  const proofDoneToday = opts.proofDoneToday ?? 0;
  const priorLedgerDays = opts.priorLedgerDays ?? 0;

  // Day-one / pre-proof: neutral placeholder — not Spark-at-0%.
  if (proofDoneToday === 0 && priorLedgerDays === 0) {
    return {
      label: "Forming",
      color: "#B8B6AC",
      meaning: "Your Arc rank builds as you show proof — start with one action today.",
    };
  }
  if (percent == null && !hasLedgerData) {
    return {
      label: "Forming",
      color: "#B8B6AC",
      meaning: "Add proof actions to this Arc to start tracking rank.",
    };
  }
  if (percent == null) {
    return getArcRankFromPercent(0);
  }
  return getArcRankFromPercent(percent);
}

export function lifetimeXpForHabitLog({ hasActiveArc, isProof }) {
  if (!hasActiveArc) return LIFETIME_XP_DEFAULT;
  if (isProof) return LIFETIME_XP_DEFAULT;
  return LIFETIME_XP_DURING_ARC_NON_PROOF;
}
