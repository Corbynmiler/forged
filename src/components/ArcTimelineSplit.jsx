// ─── TIMELINE SPLIT ───────────────────────────────────────────────────────────
// A standalone visualization, separate from the week rail below it. Three
// persistent lines span the whole Arc: Future You (green, fixed, top) and
// Default Path (red, fixed, bottom) never move. You/Actual (gold) is the
// hero — a smooth organic curve through each segment's real proof score
// (completed proof actions / possible proof actions, computed directly
// from arc_daily_scores). Column order always matches the week rail below:
// before → start → week 1..N → finish, left to right. The rail drives the
// marker position (by exact segment key, not by guessing); this component
// never accepts user scroll/drag input.
import { useId, useMemo, useRef, useEffect } from "react";
import { T } from "../theme.js";

const SVG_H = 200;
const GREEN_Y = 30;
const RED_Y = SVG_H - 30;
const NEUTRAL_Y = (GREEN_Y + RED_Y) / 2;
// Matches CHECKPOINT_W in ArcTimeline.jsx so column spacing here lines up
// with the spacing of the week rail directly beneath this card.
const COL_W = 80;

/** completed/possible proof actions for the week's date range, straight from the ledger. */
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
  return { done, total, percent: Math.round((done / total) * 100) };
}

function yForPercent(percent) {
  const clamped = Math.max(4, Math.min(96, percent ?? 50));
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

export function ArcTimelineSplit({ segments = [], weeks = [], ledgerRows = [], selectedSegment, reducedMotion }) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scrollRef = useRef(null);

  const weekByNum = useMemo(() => {
    const map = new Map();
    weeks.forEach(w => map.set(w.weekNum, w));
    return map;
  }, [weeks]);

  // One column per rail segment, in the exact order the rail renders them:
  // before → start → week 1..N → finish. This is the only source of x position,
  // so the curve and marker can never appear out of order or jump.
  const points = useMemo(() => segments.map((seg, i) => {
    const x = (i + 0.5) * COL_W;
    if (seg.weekNum != null) {
      const week = weekByNum.get(seg.weekNum);
      const score = week && week.status !== "upcoming" ? weeklyScore(week, ledgerRows) : null;
      // Future/unstarted weeks stay neutral (mid-line) rather than dropping to
      // the default path — they only move once real proof data exists.
      const y = score ? yForPercent(score.percent) : NEUTRAL_Y;
      return { key: seg.key, x, y, score, hasData: !!score };
    }
    // before / start / finish have no weekly score of their own — neutral anchor
    return { key: seg.key, x, y: NEUTRAL_Y, score: null, hasData: false };
  }), [segments, weekByNum, ledgerRows]);

  if (import.meta.env?.DEV) {
    points.forEach(p => {
      if (p.score) {
        // eslint-disable-next-line no-console
        console.debug(`[TimelineSplit] ${p.key}: ${p.score.done}/${p.score.total} = ${p.score.percent}% → y=${p.y.toFixed(1)}`);
      }
    });
  }

  if (!points.length) return null;

  const width = Math.max(1, points.length * COL_W);
  const goldD = smoothPathD(points.map(p => ({ x: p.x, y: p.y })));
  const goldPathId = `${rawId}-goldpath`;
  const goldGradId = `${rawId}-goldgrad`;

  // Real data is always contiguous from the start of the arc — fade the line
  // softly past the last scored week instead of letting it look broken.
  const dataPoints = points.filter(p => p.hasData);
  const lastDataX = dataPoints.length ? dataPoints[dataPoints.length - 1].x : points[0].x;
  const fadeStart = Math.min(width, lastDataX + COL_W * 0.35);
  const fadeEnd = Math.min(width, lastDataX + COL_W * 1.1);

  // Best week — the highest real score on the curve, called out quietly.
  const bestPoint = dataPoints.length
    ? dataPoints.reduce((best, p) => (p.score.percent > best.score.percent ? p : best), dataPoints[0])
    : null;

  const markerIndex = points.findIndex(p => p.key === selectedSegment);
  const marker = markerIndex >= 0 ? points[markerIndex] : null;
  const showBestBadge = bestPoint && (!marker || marker.key !== bestPoint.key) && dataPoints.length > 1;

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
            top: `${(NEUTRAL_Y / SVG_H) * 100}%`, transform: "translateY(-50%)",
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

        {/* Display only — the week rail below is the only navigation. No manual scroll/drag. */}
        <div
          ref={scrollRef}
          style={{
            flex: 1, minWidth: 0, overflow: "hidden",
            touchAction: "none", userSelect: "none", pointerEvents: "none",
          }}
        >
          <svg viewBox={`0 0 ${width} ${SVG_H}`} style={{ width, height: SVG_H, display: "block" }}>
            <defs>
              <filter id={`${rawId}-glow`} filterUnits="userSpaceOnUse" x={-40} y={-40} width={width + 80} height={SVG_H + 80}>
                <feGaussianBlur stdDeviation="3.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id={`${rawId}-softglow`} filterUnits="userSpaceOnUse" x={-20} y={-20} width={width + 40} height={SVG_H + 40}>
                <feGaussianBlur stdDeviation="1.6" />
              </filter>
              {/* Real data is solid; the tail past the last scored week fades softly rather than cutting off. */}
              <linearGradient id={goldGradId} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={width} y2={0}>
                <stop offset="0" stopColor={T.gold} stopOpacity="1" />
                <stop offset={Math.max(0, fadeStart / width)} stopColor={T.gold} stopOpacity="1" />
                <stop offset={Math.min(1, fadeEnd / width)} stopColor={T.gold} stopOpacity="0.32" />
                <stop offset="1" stopColor={T.gold} stopOpacity="0.32" />
              </linearGradient>
            </defs>

            {/* fixed reference lines — quiet, supporting the gold hero line */}
            <line x1={0} y1={GREEN_Y} x2={width - 14} y2={GREEN_Y} stroke={T.green} strokeWidth={1.3} opacity={0.42} />
            <line x1={0} y1={RED_Y} x2={width - 14} y2={RED_Y} stroke={T.accent} strokeWidth={1.3} opacity={0.38} />
            <text x={width} y={GREEN_Y} textAnchor="end" dominantBaseline="middle" fontSize={12} fill={T.green} opacity={0.85}>✦</text>
            <text x={width} y={RED_Y} textAnchor="end" dominantBaseline="middle" fontSize={12} fill={T.accent} opacity={0.85}>✦</text>

            {/* quiet per-column ticks on the fixed lines */}
            {points.map(p => (
              <g key={`ticks-${p.key}`}>
                <circle cx={p.x} cy={GREEN_Y} r={1.4} fill={T.green} opacity={0.35} />
                <circle cx={p.x} cy={RED_Y} r={1.4} fill={T.accent} opacity={0.32} />
              </g>
            ))}

            {/* You (actual) — the hero line, a smooth curve through real weekly proof scores */}
            {goldD ? (
              <path
                id={goldPathId}
                d={goldD} fill="none" stroke={`url(#${goldGradId})`} strokeWidth={3}
                strokeLinecap="round" strokeLinejoin="round"
                filter={`url(#${rawId}-glow)`}
                style={reducedMotion ? undefined : {
                  strokeDasharray: 2000, strokeDashoffset: 0,
                  animation: "trajSplitDraw 1.2s cubic-bezier(0.22, 1, 0.36, 1) both",
                }}
              />
            ) : null}

            {/* a faint traveling light along the actual path — alive, not distracting */}
            {goldD && !reducedMotion ? (
              <circle r={2.2} fill="#fff" opacity={0.85} filter={`url(#${rawId}-softglow)`}>
                <animateMotion dur="5.5s" repeatCount="indefinite" rotate="auto" calcMode="linear">
                  <mpath href={`#${goldPathId}`} />
                </animateMotion>
                <animate attributeName="opacity" values="0;0.85;0.85;0" dur="5.5s" repeatCount="indefinite" />
              </circle>
            ) : null}

            {points.filter(p => p.hasData).map(p => (
              <circle key={`node-${p.key}`} cx={p.x} cy={p.y} r={3.6} fill={T.gold} opacity={0.9} />
            ))}

            {/* columns with no proof data yet — faint, sitting neutral, not yet written */}
            {points.filter(p => !p.hasData).map(p => (
              <circle key={`ghost-${p.key}`} cx={p.x} cy={p.y} r={2.6}
                fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={1.1} strokeDasharray="2 2" opacity={0.4} />
            ))}

            {/* best week — a quiet callout on the highest real score, never on top of the selected marker */}
            {showBestBadge ? (
              <g style={{ transition: "opacity 0.3s" }}>
                <circle cx={bestPoint.x} cy={bestPoint.y} r={9} fill="none" stroke={T.goldBright} strokeWidth={1} opacity={0.4} strokeDasharray="2 3" />
                <text x={bestPoint.x} y={bestPoint.y - 14} textAnchor="middle" fontSize={7.5} fontWeight={700}
                  fill={T.goldBright} opacity={0.65} letterSpacing="0.04em">
                  BEST WEEK
                </text>
              </g>
            ) : null}

            {/* glowing marker — the rail below drives this position by exact segment key */}
            {marker ? (
              <circle
                cx={marker.x} cy={marker.y} r={7} fill={T.goldBright}
                filter={`url(#${rawId}-glow)`}
                style={reducedMotion ? undefined : { transition: "cx 0.55s cubic-bezier(0.22, 1, 0.36, 1), cy 0.55s cubic-bezier(0.22, 1, 0.36, 1)" }}
              />
            ) : null}
            {marker && !reducedMotion ? (
              <circle
                cx={marker.x} cy={marker.y} r={7} fill="none" stroke={T.goldBright} strokeWidth={1.2}
                style={{ transition: "cx 0.55s cubic-bezier(0.22, 1, 0.36, 1), cy 0.55s cubic-bezier(0.22, 1, 0.36, 1)" }}
              >
                <animate attributeName="r" values="7;13;7" dur="2.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.65;0;0.65" dur="2.8s" repeatCount="indefinite" />
              </circle>
            ) : null}
          </svg>

          <div style={{ display: "flex", width, marginTop: 2 }}>
            {segments.map(seg => (
              <div key={seg.key} style={{
                width: COL_W, flexShrink: 0, textAlign: "center", fontSize: 9, fontWeight: 700,
                color: seg.key === selectedSegment ? T.gold : T.hint,
                opacity: 0.85,
              }}>
                {seg.weekNum != null ? `W${seg.weekNum}` : seg.key.toUpperCase()}
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
