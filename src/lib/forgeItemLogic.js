// Pure functions that derive Forge Companion data from existing Arc + proof records.
// No DB reads. No schema changes. All state comes from props passed down from App.jsx.

const ITEM_POOLS = {
  short: [
    { name: "Iron Dagger",   type: "dagger",  desc: "A swift blade for swift change." },
    { name: "Steel Charm",   type: "charm",   desc: "Small commitment, cast in metal." },
    { name: "Bronze Ring",   type: "ring",    desc: "A mark of real intent." },
  ],
  medium: [
    { name: "The Blade",     type: "sword",   desc: "A weapon worthy of your effort." },
    { name: "Iron Shield",   type: "shield",  desc: "Resilience forged in discipline." },
    { name: "War Helm",      type: "helmet",  desc: "A crown earned, not given." },
  ],
  long: [
    { name: "Full Plate",    type: "armour",  desc: "A complete suit forged in sustained fire." },
    { name: "The Aegis",     type: "aegis",   desc: "A legendary shield. Long effort, made solid." },
    { name: "War Banner",    type: "banner",  desc: "A standard carried by very few." },
  ],
};

export const FORGE_STAGES = [
  { index: 0, label: "Raw Ore",    sub: "Materials gathered", threshold: 0  },
  { index: 1, label: "Rough Form", sub: "Shape emerging",     threshold: 15 },
  { index: 2, label: "Hammered",   sub: "Structure set",      threshold: 35 },
  { index: 3, label: "Tempered",   sub: "Details refined",    threshold: 60 },
  { index: 4, label: "Forged",     sub: "Complete",           threshold: 85 },
];

export function getForgeItem(arc) {
  const days = arc?.duration_days ?? 56;
  const poolKey = days <= 21 ? "short" : days <= 63 ? "medium" : "long";
  const pool = ITEM_POOLS[poolKey];
  const seed = arc?.id ? [...arc.id].reduce((s, c) => s + c.charCodeAt(0), 0) : 0;
  return pool[seed % pool.length];
}

export function getForgeProgress(arc, arcLedgerRows) {
  const totalDays = arc?.duration_days ?? 56;
  const arcId = arc?.id;
  const rows = (arcLedgerRows ?? []).filter(
    r => !arcId || r.blockId === arcId || r.block_id === arcId
  );

  const daysForged = rows.filter(
    r => r.proof_total > 0 && r.proof_done / r.proof_total >= 0.5
  ).length;

  const pct = Math.min(100, Math.round((daysForged / totalDays) * 100));

  let stage = 0;
  for (let i = FORGE_STAGES.length - 1; i >= 0; i--) {
    if (pct >= FORGE_STAGES[i].threshold) { stage = i; break; }
  }

  return {
    pct,
    stage,
    stageData: FORGE_STAGES[stage],
    daysForged,
    totalDays,
    isComplete: arc?.status === "completed",
  };
}
