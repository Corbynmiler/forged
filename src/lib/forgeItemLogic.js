// Pure functions — derive Forge Companion data from existing props.
// No DB reads. No schema changes. No side effects.
//
// FIELD NAME NOTE: arcLedgerRows come from App.jsx via rowToArcDailyScore which
// converts snake_case DB fields to camelCase: proof_total→proofTotal, proof_done→proofDone.
// The original implementation used snake_case here, producing 0 forge days even on
// active Arcs with real evidence. Fixed to use camelCase, with a snake_case fallback.

const ITEM_POOLS = {
  short: [
    { id: "dagger",  name: "Iron Dagger", type: "dagger",  desc: "A swift blade for swift change." },
    { id: "pick",    name: "Forge Pick",  type: "pick",    desc: "The tool that breaks what needs breaking." },
    { id: "charm",   name: "Steel Charm", type: "charm",   desc: "Small commitment, made permanent." },
  ],
  medium: [
    { id: "sword",   name: "The Blade",   type: "sword",   desc: "A weapon worthy of your effort." },
    { id: "shield",  name: "Iron Shield", type: "shield",  desc: "Resilience forged in discipline." },
    { id: "helmet",  name: "War Helm",    type: "helmet",  desc: "A crown earned through effort." },
    { id: "axe",     name: "Forge Axe",   type: "axe",     desc: "Power born of sustained commitment." },
  ],
  long: [
    { id: "armour",  name: "Full Plate",  type: "armour",  desc: "A complete suit forged in sustained fire." },
    { id: "aegis",   name: "The Aegis",   type: "aegis",   desc: "A legendary shield. Long effort, made solid." },
    { id: "banner",  name: "War Banner",  type: "banner",  desc: "A standard carried by few." },
  ],
};

export const ALL_ITEMS = [...ITEM_POOLS.short, ...ITEM_POOLS.medium, ...ITEM_POOLS.long];

export function getItemPool(arc) {
  const days = arc?.duration_days ?? arc?.durationDays ?? 56;
  if (days <= 21) return ITEM_POOLS.short;
  if (days <= 63) return ITEM_POOLS.medium;
  return ITEM_POOLS.long;
}

export function getDefaultForgeItem(arc) {
  const pool = getItemPool(arc);
  const seed = arc?.id ? [...arc.id].reduce((s, c) => s + c.charCodeAt(0), 0) : 0;
  return pool[seed % pool.length];
}

export const FORGE_STAGES = [
  { index: 0, label: "Raw Ore",    sub: "Materials gathered", threshold: 0,  build: "ore selected" },
  { index: 1, label: "Rough Form", sub: "Shape emerging",     threshold: 15, build: "billet hammered" },
  { index: 2, label: "Hammered",   sub: "Structure set",      threshold: 35, build: "blade formed" },
  { index: 3, label: "Tempered",   sub: "Details refined",    threshold: 60, build: "guard attached" },
  { index: 4, label: "Forged",     sub: "Complete",           threshold: 85, build: "item complete" },
];

export function getForgeProgress(arc, arcLedgerRows) {
  const totalDays = arc?.duration_days ?? arc?.durationDays ?? 56;
  const arcId = arc?.id;
  const rows = (arcLedgerRows ?? []).filter(r => {
    if (arcId) {
      const rowBlockId = r.blockId ?? r.block_id;
      if (rowBlockId && rowBlockId !== arcId) return false;
    }
    return true;
  });

  // Count days where the user hit ≥50% of proof habits.
  // Handles both camelCase (from rowToArcDailyScore) and snake_case (raw DB).
  const daysForged = rows.filter(r => {
    const total = r.proofTotal ?? r.proof_total ?? 0;
    const done  = r.proofDone  ?? r.proof_done  ?? 0;
    return total > 0 && done / total >= 0.5;
  }).length;

  const pct = Math.min(100, Math.round((daysForged / Math.max(1, totalDays)) * 100));

  // Calendar context: how many days since the arc started (capped at totalDays).
  // arc.startDate comes from rowToForgeBlock (camelCase); arc.start_date is the raw DB field.
  const startDate = arc?.startDate ?? arc?.start_date ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const elapsedDays = startDate
    ? Math.min(totalDays, Math.max(1, Math.floor((Date.parse(today) - Date.parse(startDate)) / 86400000) + 1))
    : 0;

  // Consistency: what % of elapsed days had proof. More meaningful for motivation than pct.
  const consistency = elapsedDays > 0 ? Math.round((daysForged / elapsedDays) * 100) : 0;

  let stage = 0;
  for (let i = FORGE_STAGES.length - 1; i >= 0; i--) {
    if (pct >= FORGE_STAGES[i].threshold) { stage = i; break; }
  }

  const nextStage = FORGE_STAGES[stage + 1] ?? null;
  const daysToNext = nextStage
    ? Math.max(0, Math.ceil(nextStage.threshold * totalDays / 100) - daysForged)
    : 0;

  return {
    pct,
    stage,
    stageData: FORGE_STAGES[stage],
    daysForged,
    totalDays,
    elapsedDays,
    consistency,
    isComplete: arc?.status === "completed",
    nextStage,
    daysToNext,
  };
}

export function getRecentForgeHistory(arcLedgerRows, arc) {
  const arcId = arc?.id;
  const rows = (arcLedgerRows ?? [])
    .filter(r => {
      if (arcId) {
        const rowBlockId = r.blockId ?? r.block_id;
        if (rowBlockId && rowBlockId !== arcId) return false;
      }
      const total = r.proofTotal ?? r.proof_total ?? 0;
      const done  = r.proofDone  ?? r.proof_done  ?? 0;
      return total > 0 && done / total >= 0.5;
    })
    .sort((a, b) => (b.date > a.date ? 1 : -1))
    .slice(0, 5);

  return rows.map(r => ({ date: r.date, done: r.proofDone ?? r.proof_done ?? 0, total: r.proofTotal ?? r.proof_total ?? 0 }));
}
