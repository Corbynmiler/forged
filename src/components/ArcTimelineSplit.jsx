// ─── TIMELINE SPLIT ───────────────────────────────────────────────────────────
// A standalone visualization, separate from the week rail below it. Three
// persistent lines span the whole Arc: Future You (green, fixed, top) and
// Default Path (red, fixed, bottom) never move. You/Actual (gold) is the
// hero — a smooth organic curve through each completed week's real proof
// score (completedProofActions / possibleProofActions, computed directly
// from arc_daily_scores). A glowing marker tracks whichever week is selected
// in the rail beneath this card; the rail drives the marker, not the other
// way around.
import { useId, useMemo, useRef, useEffect } from "react";
import { T } from "../theme.js";

const SVG_H = 200;
const GREEN_Y = 30;
const RED_Y = SVG_H - 30;
// Matches CHECKPOINT_W in ArcTimeline.jsx so week spacing here lines up
// with the spacing of the week rail directly beneath this card.
const COL_W = 80;

/** completedProofActions / possibleProofActions for the week's date range, straight from the ledger. */
function weeklyScore(week, ledgerRows) {
  if (!week?.startDate || !week?.endDate) return null;
  let done = 0;
  let total = 0;
  for (const row of ledgerRows || []) {
    const date = row.date || row.dateStr;
    if (!date || date < week.startDate || date > week.endDate) continue;
    total += row.proofTotal ?? row.proof_total ?? 0;
    done += row.proofDone ?? row.proof_done ?? 0;
  }
  if (total === 0) return null;
  return Math.round((done / total) * 100);
}

function yForPercent(percent) {
  const clamped = Math.max(4, Math.min(96, percent ?? 0));
  return GREEN_Y + (1 - clamped / 100) * (RED_Y - GREEN_Y);
}

/** Smooth polyline through points using quadratic "T" chaining — organic, not jagged. */
function smoothPathD(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    d += ` Q ${p0.x} ${p0.y} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  d += ` T ${last.x} ${last.y}`;
  return d;
}

export function ArcTimelineSplit({ weeks = [], ledgerRows = [], activeWeekNum, reducedMotion }) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scrollRef = useRef(null);

  const points = useMemo(() => weeks.map((week, i) => {
    const score = week.status === "upcoming" ? null : weeklyScore(week, ledgerRows);
    return { week, x: (i + 0.5) * COL_W, y: yForPercent(score), score };
  }), [weeks, ledgerRows]);

  const liveWeeks = weeks.filter(w => w.status !== "upcoming");
  if (!liveWeeks.length) return null;

  const width = Math.max(1, weeks.length * COL_W);
  const livePoints = points.filter(p => p.week.status !== "upcoming" && p.score != null);
  const goldD = smoothPathD(livePoints.map(p => ({ x: p.x, y: p.y })));

  const activeIndex = points.findIndex(p => p.week.weekNum === activeWeekNum);
  const marker = activeIndex >= 0 ? points[activeIndex] : livePoints[livePoints.length - 1];

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !marker) return;
    const target = marker.x - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(0, target), behavior: reducedMotion ? "auto" : "smooth" });
  }, [marker?.x, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      marginTop: 18,
      marginBottom: 4,
      borderRadius: T.r,
      position: "relative",
      overflow: "hidden",
      background: "radial-gradient(140% 160% at 8% 0%, rgba(61,155,95,0.08) 0%, rgba(15,15,13,0) 50%), radial-gradient(140% 160% at 92% 100%, rgba(192,57,43,0.07) 0%, rgba(15,15,13,0) 50%), linear-gradient(165deg, #14140F 0%, #0A0A09 100%)",
      border: `0.5px solid ${T.borderMid}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.45)",
      padding: "18px 16px 16px",
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: T.hint, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>
        Timeline Split
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 21, color: T.text, lineHeight: 1.2, marginBottom: 6 }}>
        Timeline Split
      </div>
      <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5, marginBottom: 18 }}>
        Every proof action moves you closer to the life you chose.
      </div>

      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ width: 122, flexShrink: 0, position: "relative", height: SVG_H }}>
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: `${(GREEN_Y / SVG_H) * 100}%`, transform: "translateY(-50%)",
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: T.green, letterSpacing: "0.04em" }}>FUTURE YOU</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2, lineHeight: 1.3 }}>Your best timeline</div>
          </div>
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: `${((GREEN_Y + RED_Y) / 2 / SVG_H) * 100}%`, transform: "translateY(-50%)",
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: T.goldBright, letterSpacing: "0.04em" }}>YOU (ACTUAL)</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2, lineHeight: 1.3 }}>Your real path</div>
          </div>
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: `${(RED_Y / SVG_H) * 100}%`, transform: "translateY(-50%)",
          }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: T.accent, letterSpacing: "0.04em" }}>DEFAULT PATH</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2, lineHeight: 1.3 }}>If nothing changes</div>
          </div>
        </div>

        <div ref={scrollRef} style={{ flex: 1, minWidth: 0, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <svg viewBox={`0 0 ${width} ${SVG_H}`} style={{ width, height: SVG_H, display: "block" }}>
            <defs>
              <filter id={`${rawId}-glow`} filterUnits="userSpaceOnUse" x={-40} y={-40} width={width + 80} height={SVG_H + 80}>
                <feGaussianBlur stdDeviation="3.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* fixed reference lines — never move */}
            <line x1={0} y1={GREEN_Y} x2={width - 14} y2={GREEN_Y} stroke={T.green} strokeWidth={1.6} opacity={0.6} />
            <line x1={0} y1={RED_Y} x2={width - 14} y2={RED_Y} stroke={T.accent} strokeWidth={1.6} opacity={0.55} />
            <text x={width} y={GREEN_Y} textAnchor="end" dominantBaseline="middle" fontSize={13} fill={T.green}>✦</text>
            <text x={width} y={RED_Y} textAnchor="end" dominantBaseline="middle" fontSize={13} fill={T.accent}>✦</text>

            {/* quiet per-week ticks on the fixed lines */}
            {points.map(p => (
              <g key={`ticks-${p.week.weekNum}`}>
                <circle cx={p.x} cy={GREEN_Y} r={1.6} fill={T.green} opacity={0.5} />
                <circle cx={p.x} cy={RED_Y} r={1.6} fill={T.accent} opacity={0.45} />
              </g>
            ))}

            {/* You (actual) — the hero line, a smooth curve through real weekly proof scores */}
            {goldD ? (
              <path
                d={goldD} fill="none" stroke={T.gold} strokeWidth={2.8}
                strokeLinecap="round" strokeLinejoin="round"
                filter={`url(#${rawId}-glow)`}
                style={reducedMotion ? undefined : {
                  strokeDasharray: 2000, strokeDashoffset: 0,
                  animation: "trajSplitDraw 1.2s cubic-bezier(0.22, 1, 0.36, 1) both",
                }}
              />
            ) : null}

            {livePoints.map(p => (
              <circle key={`node-${p.week.weekNum}`} cx={p.x} cy={p.y} r={4} fill={T.gold} opacity={0.85} />
            ))}

            {/* weeks with no proof logged yet, or not yet started — faint, not yet written */}
            {points.filter(p => p.score == null).map(p => (
              <circle key={`ghost-${p.week.weekNum}`} cx={p.x} cy={(GREEN_Y + RED_Y) / 2} r={3}
                fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1.2} strokeDasharray="2 2" opacity={0.5} />
            ))}

            {/* glowing marker — the rail below drives this position */}
            {marker ? (
              <circle
                cx={marker.x} cy={marker.y} r={7.5} fill={T.goldBright}
                filter={`url(#${rawId}-glow)`}
                style={reducedMotion ? undefined : { transition: "cx 0.5s cubic-bezier(0.22, 1, 0.36, 1), cy 0.5s cubic-bezier(0.22, 1, 0.36, 1)" }}
              />
            ) : null}
            {marker && !reducedMotion ? (
              <circle
                cx={marker.x} cy={marker.y} r={7.5} fill="none" stroke={T.goldBright} strokeWidth={1.4}
                style={{ transition: "cx 0.5s cubic-bezier(0.22, 1, 0.36, 1), cy 0.5s cubic-bezier(0.22, 1, 0.36, 1)" }}
              >
                <animate attributeName="r" values="7.5;16;7.5" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite" />
              </circle>
            ) : null}
          </svg>

          <div style={{ display: "flex", width, marginTop: 2 }}>
            {weeks.map(week => (
              <div key={week.weekNum} style={{
                width: COL_W, flexShrink: 0, textAlign: "center", fontSize: 9, fontWeight: 700,
                color: week.weekNum === activeWeekNum ? T.gold : T.hint,
                opacity: week.status === "upcoming" ? 0.45 : 0.85,
              }}>
                W{week.weekNum}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes trajSplitDraw { from { stroke-dashoffset: 2000; } to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes trajSplitDraw { from, to { stroke-dashoffset: 0; } }
        }
      `}</style>
    </div>
  );
}
