// ─── TIMELINE SPLIT ───────────────────────────────────────────────────────────
// A navigation display, not a chart: one origin, one flat default future, and
// a Chosen Future whose curve is reshaped — visibly, dramatically — by exactly
// how much proof was logged today. Zero proof barely lifts off the baseline.
// A strong day bends it hard. That's the whole idea: today rewrites tomorrow.
import { useId, useMemo } from "react";
import { T } from "../theme.js";
import { todayStr } from "../utils.js";

const VB_W = 600;
const VB_H = 240;
const ORIGIN = { x: 50, y: 150 };
const END_X = 568;
// Capped so chosenEnd.y (ORIGIN.y - rise) never gets close enough to the
// viewBox top to push the "Future You" label into the text above the chart.
const MAX_RISE = 108;
const BASE_RISE = 9;
const DEFAULT_DROOP = 22;

function easeOutCubic(x) {
  return 1 - (1 - x) ** 3;
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const x = mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x;
  const y = mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y;
  return { x, y };
}

/** Today's real proof count from arc_daily_scores — the only input this visual reshapes around. */
function todayProof(ledgerRows) {
  const today = todayStr();
  const row = (ledgerRows || []).find(r => r.date === today);
  const total = row?.proofTotal ?? row?.proof_total ?? 0;
  const done = row?.proofDone ?? row?.proof_done ?? 0;
  return { total, done: Math.max(0, Math.min(done, total || done)) };
}

const TIERS = [
  { min: 0, label: "The future is still wide open.", confidence: "Unwritten" },
  { min: 1, label: "You're starting to bend it.", confidence: "Building" },
  { min: 3, label: "The future is curving toward you.", confidence: "Rising" },
  { min: 6, label: "You're reshaping where this goes.", confidence: "Strong" },
  { min: 9, label: "This is a different future now.", confidence: "Dramatic" },
];

function tierFor(done) {
  let t = TIERS[0];
  for (const tier of TIERS) if (done >= tier.min) t = tier;
  return t;
}

export function ArcTimelineSplit({ ledgerRows, reducedMotion }) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");

  const { done } = useMemo(() => todayProof(ledgerRows), [ledgerRows]);
  const steepness = easeOutCubic(Math.min(1, done / 9));
  const rise = BASE_RISE + MAX_RISE * steepness;
  const tier = tierFor(done);
  const isLit = done > 0;

  const chosenEnd = { x: END_X, y: ORIGIN.y - rise };
  // Control points launch progressively earlier/harder as steepness increases —
  // not just a higher endpoint, but a more dramatic sweep off the origin.
  const chosenCtrl1 = { x: ORIGIN.x + 90 + 60 * (1 - steepness), y: ORIGIN.y - rise * 0.55 };
  const chosenCtrl2 = { x: chosenEnd.x - 170, y: chosenEnd.y + (1 - steepness) * 30 };
  const chosenD = `M ${ORIGIN.x} ${ORIGIN.y} C ${chosenCtrl1.x} ${chosenCtrl1.y}, ${chosenCtrl2.x} ${chosenCtrl2.y}, ${chosenEnd.x} ${chosenEnd.y}`;

  const defaultEnd = { x: END_X, y: ORIGIN.y + DEFAULT_DROOP };
  const defaultCtrl1 = { x: ORIGIN.x + 180, y: ORIGIN.y + 6 };
  const defaultCtrl2 = { x: defaultEnd.x - 180, y: defaultEnd.y - 4 };
  const defaultD = `M ${ORIGIN.x} ${ORIGIN.y} C ${defaultCtrl1.x} ${defaultCtrl1.y}, ${defaultCtrl2.x} ${defaultCtrl2.y}, ${defaultEnd.x} ${defaultEnd.y}`;

  const particleTs = [0, 0.33, 0.66];

  return (
    <div style={{
      marginTop: 18,
      marginBottom: 4,
      borderRadius: T.r,
      position: "relative",
      overflow: "hidden",
      background: "radial-gradient(140% 160% at 6% 60%, rgba(245,200,66,0.11) 0%, rgba(15,15,13,0) 55%), radial-gradient(120% 140% at 96% 95%, rgba(255,255,255,0.04) 0%, rgba(15,15,13,0) 50%), linear-gradient(165deg, #14140F 0%, #0A0A09 100%)",
      border: `0.5px solid ${T.borderMid}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.45)",
      padding: "18px 16px 16px",
    }}>
      <style>{`
        @keyframes splitDraw { from { stroke-dashoffset: 900; } to { stroke-dashoffset: 0; } }
        @keyframes splitNodePulse { 0%, 100% { opacity: 0.55; r: 4.5; } 50% { opacity: 1; r: 6.5; } }
        @media (prefers-reduced-motion: reduce) {
          .split-draw { animation: none !important; stroke-dashoffset: 0 !important; }
        }
      `}</style>

      <div style={{ fontSize: 9.5, fontWeight: 800, color: T.hint, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>
        Timeline Split
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 19, color: T.text, lineHeight: 1.25, marginBottom: 6, transition: "opacity 0.3s ease" }}>
        {tier.label}
      </div>
      <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.5, marginBottom: 14 }}>
        Every proof action pulls your future off the default path.
      </div>

      <div style={{ position: "relative", width: "100%", height: 210 }}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" style={{ width: "100%", height: 210, display: "block" }}>
          <defs>
            <filter id={`${gradId}-glow`} filterUnits="userSpaceOnUse" x={-80} y={-80} width={VB_W + 160} height={VB_H + 160}>
              <feGaussianBlur stdDeviation={4 + steepness * 3} result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id={`${gradId}-chosen`} gradientUnits="userSpaceOnUse" x1={ORIGIN.x} y1="0" x2={chosenEnd.x} y2="0">
              <stop offset="0%" stopColor={T.gold} />
              <stop offset="100%" stopColor={T.green} />
            </linearGradient>
          </defs>

          {/* default future — flat-to-declining, the path of nothing changing */}
          <path d={defaultD} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.6}
            strokeDasharray="2 6" strokeLinecap="round" opacity={0.7} />

          {/* chosen future — reshaped live by today's proof count */}
          <path
            className={reducedMotion ? "" : "split-draw"}
            d={chosenD} fill="none" stroke={`url(#${gradId}-chosen)`}
            strokeWidth={2.6 + steepness * 2.6} strokeLinecap="round"
            filter={`url(#${gradId}-glow)`}
            opacity={0.55 + steepness * 0.45}
            style={reducedMotion ? undefined : {
              strokeDasharray: 900, strokeDashoffset: 0,
              animation: "splitDraw 1.1s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          />

          {/* particles flowing along the chosen path — only once there's something to flow toward */}
          {!reducedMotion && isLit ? particleTs.map((t, i) => (
            <circle key={i} r={2.4} fill={T.goldBright} opacity={0}>
              <animateMotion dur="3.2s" begin={`${i * 1.05}s`} repeatCount="indefinite" path={chosenD} />
              <animate attributeName="opacity" values="0;0.9;0" dur="3.2s" begin={`${i * 1.05}s`} repeatCount="indefinite" />
            </circle>
          )) : null}

          {/* origin: Current You */}
          <circle cx={ORIGIN.x} cy={ORIGIN.y} r={6.5} fill={T.text} filter={`url(#${gradId}-glow)`} />
          {!reducedMotion ? (
            <circle cx={ORIGIN.x} cy={ORIGIN.y} r={6.5} fill="none" stroke={T.goldBright} strokeWidth={1.4}>
              <animate attributeName="r" values="6.5;17;6.5" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite" />
            </circle>
          ) : null}

          {/* future node — brightens and grows with steepness */}
          <circle
            cx={chosenEnd.x} cy={chosenEnd.y} r={4.5 + steepness * 2.5}
            fill={steepness > 0.5 ? T.green : T.goldBright}
            filter={`url(#${gradId}-glow)`}
            opacity={0.6 + steepness * 0.4}
            style={!reducedMotion && isLit ? { animation: "splitNodePulse 2.2s ease-in-out infinite" } : undefined}
          />
          <circle cx={defaultEnd.x} cy={defaultEnd.y} r={3} fill="rgba(255,255,255,0.35)" />
        </svg>

        {/* labels locked to the same viewBox ratios as the path endpoints */}
        <div style={{
          position: "absolute", right: 4,
          top: `${(chosenEnd.y / VB_H) * 100}%`, transform: "translateY(-160%)",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
          color: T.goldBright, whiteSpace: "nowrap", transition: "top 0.4s ease",
        }}>
          Future You
        </div>
        <div style={{
          position: "absolute", right: 4,
          top: `${(defaultEnd.y / VB_H) * 100}%`, transform: "translateY(20%)",
          fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          color: T.hint, whiteSpace: "nowrap", opacity: 0.7,
        }}>
          Default — if nothing changes
        </div>
        <div style={{
          position: "absolute", left: `${(ORIGIN.x / VB_W) * 100}%`,
          top: `${(ORIGIN.y / VB_H) * 100}%`, transform: "translate(-50%, -190%)",
          fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: T.muted,
          textTransform: "uppercase", whiteSpace: "nowrap",
        }}>
          Current You
        </div>
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginTop: 18, paddingTop: 14, borderTop: `0.5px solid ${T.border}`,
      }}>
        <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5, maxWidth: 380 }}>
          {done === 0
            ? "Nothing logged yet today — the default path is still in control."
            : `${done} proof action${done === 1 ? "" : "s"} logged today. The future just moved.`}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.goldBright, letterSpacing: "0.04em", whiteSpace: "nowrap", marginLeft: 12 }}>
          {tier.confidence}
        </div>
      </div>
    </div>
  );
}
