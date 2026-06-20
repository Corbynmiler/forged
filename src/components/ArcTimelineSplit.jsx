// ─── TIMELINE SPLIT ───────────────────────────────────────────────────────────
// One flagship visual, not a third rail: a single fork from "You are here."
// Top branch = Chosen Timeline (bright, alive). Bottom branch = Current
// Timeline (dim, drifting). Today's real proof state decides which one glows.
import { useId, useMemo } from "react";
import { T } from "../theme.js";
import { todayStr } from "../utils.js";

const VB_W = 600;
const VB_H = 200;
const ORIGIN = { x: 56, y: 100 };
const CHOSEN_END = { x: 560, y: 38 };
const CURRENT_END = { x: 560, y: 162 };

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const x = mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x;
  const y = mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y;
  return { x, y };
}

/** Today's real proof state from arc_daily_scores — the only signal this visual uses. */
function todayProofState(ledgerRows) {
  const today = todayStr();
  const row = (ledgerRows || []).find(r => r.date === today);
  const total = row?.proofTotal ?? row?.proof_total ?? 0;
  const done = row?.proofDone ?? row?.proof_done ?? 0;
  if (total === 0) return "unlogged";
  if (done >= total) return "aligned";
  if (done > 0) return "partial";
  return "unlogged";
}

const STATE_COPY = {
  aligned: { line: "Today's proof pulled you toward the life you chose.", color: "green", winner: "chosen" },
  partial: { line: "Today can pull you closer.", color: "gold", winner: "chosen" },
  unlogged: { line: "No proof logged yet. The default path is winning today.", color: "accent", winner: "current" },
};

export function ArcTimelineSplit({ ledgerRows }) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");

  const state = useMemo(() => todayProofState(ledgerRows), [ledgerRows]);
  const copy = STATE_COPY[state];
  const winningChosen = copy.winner === "chosen";

  const chosenCtrl1 = { x: ORIGIN.x + 160, y: ORIGIN.y - 4 };
  const chosenCtrl2 = { x: CHOSEN_END.x - 160, y: CHOSEN_END.y };
  const chosenD = `M ${ORIGIN.x} ${ORIGIN.y} C ${chosenCtrl1.x} ${chosenCtrl1.y}, ${chosenCtrl2.x} ${chosenCtrl2.y}, ${CHOSEN_END.x} ${CHOSEN_END.y}`;

  const currentCtrl1 = { x: ORIGIN.x + 150, y: ORIGIN.y + 10 };
  const currentCtrl2 = { x: CURRENT_END.x - 170, y: CURRENT_END.y };
  const currentD = `M ${ORIGIN.x} ${ORIGIN.y} C ${currentCtrl1.x} ${currentCtrl1.y}, ${currentCtrl2.x} ${currentCtrl2.y}, ${CURRENT_END.x} ${CURRENT_END.y}`;

  const chosenNodeTs = [0.32, 0.62, 0.92];
  const currentNodeTs = [0.32, 0.62, 0.92];
  const chosenNodes = chosenNodeTs.map(t => cubicPoint(ORIGIN, chosenCtrl1, chosenCtrl2, CHOSEN_END, t));
  const currentNodes = currentNodeTs.map(t => cubicPoint(ORIGIN, currentCtrl1, currentCtrl2, CURRENT_END, t));

  const lineColor = copy.color === "green" ? T.green : copy.color === "gold" ? T.gold : T.accent;

  return (
    <div style={{
      marginTop: 18,
      marginBottom: 4,
      borderRadius: T.r,
      position: "relative",
      overflow: "hidden",
      background: "radial-gradient(130% 150% at 8% 50%, rgba(245,200,66,0.10) 0%, rgba(15,15,13,0) 50%), radial-gradient(130% 150% at 95% 85%, rgba(192,57,43,0.08) 0%, rgba(15,15,13,0) 55%), linear-gradient(165deg, #14140F 0%, #0A0A09 100%)",
      border: `0.5px solid ${T.borderMid}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.45)",
      padding: "18px 16px 16px",
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: T.hint, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>
        Timeline Split
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 19, color: T.text, lineHeight: 1.2, marginBottom: 14 }}>
        Every proof action chooses which version gets stronger.
      </div>

      <div style={{ position: "relative", width: "100%", height: 190 }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" style={{ width: "100%", height: 190, display: "block" }}>
        <defs>
          <filter id={`${gradId}-glow`} filterUnits="userSpaceOnUse" x={-60} y={-60} width={VB_W + 120} height={VB_H + 120}>
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`${gradId}-chosen`} gradientUnits="userSpaceOnUse" x1={ORIGIN.x} y1="0" x2={CHOSEN_END.x} y2="0">
            <stop offset="0%" stopColor={T.gold} />
            <stop offset="100%" stopColor={T.green} />
          </linearGradient>
        </defs>

        {/* Current Timeline — dim, drawn first so the chosen path reads on top at the origin */}
        <path d={currentD} fill="none" stroke={winningChosen ? "rgba(192,57,43,0.35)" : T.accent} strokeWidth={winningChosen ? 2.4 : 3.4}
          strokeDasharray={winningChosen ? "1 5" : "5 4"} strokeLinecap="round"
          filter={winningChosen ? undefined : `url(#${gradId}-glow)`}
          opacity={winningChosen ? 0.55 : 0.9} />

        {/* Chosen Timeline — bright, alive */}
        <path d={chosenD} fill="none" stroke={`url(#${gradId}-chosen)`} strokeWidth={winningChosen ? 4 : 2.6}
          strokeLinecap="round" filter={winningChosen ? `url(#${gradId}-glow)` : undefined}
          opacity={winningChosen ? 1 : 0.45} />

        {/* proof nodes along each branch */}
        {currentNodes.map((p, i) => (
          <circle key={`cur-${i}`} cx={p.x} cy={p.y} r={winningChosen ? 2.6 : 4} fill={T.accent}
            opacity={winningChosen ? 0.4 : 0.85} />
        ))}
        {chosenNodes.map((p, i) => (
          <circle key={`ch-${i}`} cx={p.x} cy={p.y} r={winningChosen ? 4.4 : 2.8} fill={lineColor}
            opacity={winningChosen ? 1 : 0.45} filter={winningChosen ? `url(#${gradId}-glow)` : undefined} />
        ))}

        {/* origin: You are here */}
        <circle cx={ORIGIN.x} cy={ORIGIN.y} r={7} fill={T.text} filter={`url(#${gradId}-glow)`} />
        <circle cx={ORIGIN.x} cy={ORIGIN.y} r={7} fill="none" stroke={lineColor} strokeWidth={1.5}>
          <animate attributeName="r" values="7;18;7" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0;0.8" dur="2.6s" repeatCount="indefinite" />
        </circle>

        {/* end-of-path arrows */}
        <circle cx={CHOSEN_END.x} cy={CHOSEN_END.y} r={winningChosen ? 5 : 3} fill={T.green} opacity={winningChosen ? 1 : 0.45} />
        <circle cx={CURRENT_END.x} cy={CURRENT_END.y} r={winningChosen ? 3 : 5} fill={T.accent} opacity={winningChosen ? 0.4 : 0.9} />
      </svg>

      {/* labels positioned by the same viewBox ratios as the path endpoints, so they
          stay locked to the curve ends regardless of the card's rendered width */}
      <div style={{
        position: "absolute", right: 4,
        top: `${(CHOSEN_END.y / VB_H) * 100}%`, transform: "translateY(-130%)",
        fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
        color: winningChosen ? T.goldBright : `${T.goldBright}77`, whiteSpace: "nowrap",
      }}>
        Chosen Timeline
      </div>
      <div style={{
        position: "absolute", right: 4,
        top: `${(CURRENT_END.y / VB_H) * 100}%`, transform: "translateY(30%)",
        fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
        color: winningChosen ? `${T.accent}77` : T.accent, whiteSpace: "nowrap",
      }}>
        Current Timeline
      </div>
      <div style={{
        position: "absolute", left: `${(ORIGIN.x / VB_W) * 100}%`,
        top: `${(ORIGIN.y / VB_H) * 100}%`, transform: "translate(-50%, -180%)",
        fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: T.muted,
        textTransform: "uppercase", whiteSpace: "nowrap",
      }}>
        You are here
      </div>
      </div>

      <div style={{
        marginTop: 28, paddingTop: 14, borderTop: `0.5px solid ${T.border}`,
        fontSize: 13.5, lineHeight: 1.5,
        color: lineColor,
      }}>
        {copy.line}
      </div>
    </div>
  );
}
