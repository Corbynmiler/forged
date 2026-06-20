// ─── TRAJECTORY FORK ──────────────────────────────────────────────────────────
// Premium parallel-timeline visual: Current Path (what you actually logged)
// vs. Chosen Path (the identity you said you'd become). Lives on the Arc page,
// directly beneath the hero. Every proof action is a vote for which path wins.
import { useMemo, useId } from "react";
import { T } from "../theme.js";
import { buildDualPathSeries, computeArcTrajectory, currentPathTone } from "../lib/arcTrajectory.js";

const VB_W = 1000;
const VB_H = 260;
const TOP_PAD = 34;
const BOTTOM_PAD = 30;
const PLOT_H = VB_H - TOP_PAD - BOTTOM_PAD;
const CHOSEN_Y = TOP_PAD;

const TONE_COLOR = {
  aligned: T.green,
  drifting: T.gold,
  "off-path": T.accent,
  neutral: T.hint,
};

function xFor(day, duration) {
  if (duration <= 1) return 0;
  return ((day - 1) / (duration - 1)) * VB_W;
}
function yFor(percent) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return TOP_PAD + (1 - p / 100) * PLOT_H;
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

export function ArcTrajectoryFork({ block, ledgerRows, dayNum, duration, daysLeft, reducedMotion }) {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "");

  const days = useMemo(
    () => buildDualPathSeries({ block, ledgerRows, duration, dayNum }),
    [block, ledgerRows, duration, dayNum],
  );

  const loggedDays = days.filter(d => d.hasData && !d.isFuture);

  // Derived from the same ledger series the chart draws — not the
  // denormalized forge_blocks.completion_score, which can lag the ledger.
  const currentPercent = loggedDays.length
    ? loggedDays.reduce((s, d) => s + d.percent, 0) / loggedDays.length
    : null;

  const trajectory = useMemo(
    () => computeArcTrajectory({ ledgerRows, currentPercent, daysLeft }),
    [ledgerRows, currentPercent, daysLeft],
  );

  if (currentPercent == null) return null;

  const tone = currentPathTone(currentPercent);
  const toneColor = TONE_COLOR[tone];

  const currentPoints = loggedDays.map(d => ({ x: xFor(d.day, duration), y: yFor(d.percent), d }));
  const currentPathD = smoothPathD(currentPoints);

  const todayPoint = currentPoints[currentPoints.length - 1] || { x: 0, y: yFor(currentPercent) };
  const projectedPercent = trajectory?.projectedPercent ?? currentPercent;
  const projectionPathD = `M ${todayPoint.x} ${todayPoint.y} Q ${(todayPoint.x + VB_W) / 2} ${yFor(projectedPercent)} ${VB_W} ${yFor(projectedPercent)}`;

  const chosenPathD = `M 0 ${CHOSEN_Y} L ${VB_W} ${CHOSEN_Y}`;

  const gapPercent = Math.max(0, Math.round(100 - currentPercent));
  const onChosenPace = gapPercent <= 10;

  const sentence = onChosenPace
    ? "You're close to the path you chose. Keep showing proof."
    : `Right now you're ${gapPercent} points off the path you chose. Today's proof decides which one strengthens.`;

  return (
    <div style={{
      marginTop: 18,
      marginBottom: 4,
      borderRadius: T.r,
      overflow: "hidden",
      position: "relative",
      background: "radial-gradient(120% 140% at 15% 0%, rgba(200,144,42,0.10) 0%, rgba(15,15,13,0) 45%), radial-gradient(120% 140% at 85% 100%, rgba(192,57,43,0.08) 0%, rgba(15,15,13,0) 50%), linear-gradient(165deg, #14140F 0%, #0C0C0A 100%)",
      border: `0.5px solid ${T.borderMid}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.45)",
    }}>
      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, color: T.hint, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>
          Trajectory Fork
        </div>
        <div style={{ fontFamily: T.serif, fontSize: 19, color: T.text, lineHeight: 1.2, marginBottom: 8 }}>
          Current Path <span style={{ color: T.hint, fontFamily: T.font, fontSize: 14, fontWeight: 500 }}>vs</span> Chosen Path
        </div>
        <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5, marginBottom: 4, maxWidth: 520 }}>
          {sentence}
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", marginTop: 6 }}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 200, display: "block" }}
        >
          <defs>
            {/* userSpaceOnUse + absolute bounds: bbox-relative units collapse to a
                zero-height filter region for perfectly horizontal/vertical paths
                (e.g. the flat Chosen Path), which silently clips the stroke to nothing. */}
            <filter id={`${gradId}-glow`} filterUnits="userSpaceOnUse" x={-40} y={-40} width={VB_W + 80} height={VB_H + 80}>
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* userSpaceOnUse: the default objectBoundingBox units degenerate to
                invisible when the stroked path has a zero-height bbox (a flat line). */}
            <linearGradient id={`${gradId}-chosen`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={VB_W} y2="0">
              <stop offset="0%" stopColor={T.goldBright} stopOpacity="0.95" />
              <stop offset="100%" stopColor={T.green} stopOpacity="0.85" />
            </linearGradient>
          </defs>

          {/* faint constellation field */}
          {days.map(d => (
            <circle
              key={`field-${d.day}`}
              cx={xFor(d.day, duration)}
              cy={CHOSEN_Y}
              r={0.8}
              fill={T.borderMid}
              opacity={0.5}
            />
          ))}

          {/* Current Path — what actually happened */}
          <path d={currentPathD} fill="none" stroke={toneColor} strokeWidth={3}
            strokeLinecap="round" strokeLinejoin="round" filter={`url(#${gradId}-glow)`} />

          {/* Projection — dashed forecast from today to Arc end if pace holds */}
          {daysLeft > 0 ? (
            <path d={projectionPathD} fill="none" stroke={toneColor} strokeWidth={1.6}
              strokeDasharray="3 7" strokeLinecap="round" opacity={0.55} />
          ) : null}

          {/* Chosen Path — the ceiling, painted last so it always reads through.
              No feGaussianBlur filter here: a perfectly flat line has a zero-height
              bounding box, and some renderers rasterize the filter source at zero
              height regardless of filter region, silently clipping the stroke to
              nothing. Glow is faked with layered low-opacity strokes instead. */}
          <path d={chosenPathD} fill="none" stroke={`url(#${gradId}-chosen)`} strokeWidth={10}
            strokeLinecap="round" opacity={0.18} />
          <path d={chosenPathD} fill="none" stroke={`url(#${gradId}-chosen)`} strokeWidth={5}
            strokeLinecap="round" opacity={0.35} />
          <path d={chosenPathD} fill="none" stroke={`url(#${gradId}-chosen)`} strokeWidth={2.5}
            strokeLinecap="round" opacity={0.95} />

          {/* vertical gap connector at today */}
          <line x1={todayPoint.x} y1={todayPoint.y} x2={todayPoint.x} y2={CHOSEN_Y}
            stroke={T.hint} strokeWidth={1} strokeDasharray="2 4" opacity={0.5} />

          {/* day nodes: lit = proof done, dim/red = missed */}
          {loggedDays.map(d => {
            const lit = d.percent > 0;
            const r = d.isToday ? 6 : lit ? 3.4 : 2.6;
            const fill = d.isToday ? toneColor : lit ? toneColor : T.accent;
            return (
              <circle
                key={`node-${d.day}`}
                cx={xFor(d.day, duration)}
                cy={yFor(d.percent)}
                r={r}
                fill={fill}
                opacity={d.isToday ? 1 : lit ? 0.9 : 0.55}
                filter={d.isToday ? `url(#${gradId}-glow)` : undefined}
                style={reducedMotion ? undefined : { transition: "cy 0.5s ease" }}
              />
            );
          })}

          {/* "you are here" pulse ring */}
          {!reducedMotion ? (
            <circle cx={todayPoint.x} cy={todayPoint.y} r={6} fill="none" stroke={toneColor} strokeWidth={1.5}>
              <animate attributeName="r" values="6;14;6" dur="2.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0;0.7" dur="2.6s" repeatCount="indefinite" />
            </circle>
          ) : null}
        </svg>

        {/* HTML label overlays, positioned by percentage so they scale with the SVG */}
        <div style={{
          position: "absolute", top: 6, left: 10, fontSize: 9.5, fontWeight: 700,
          color: T.goldBright, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          Chosen — full proof, every day
        </div>
        <div style={{
          position: "absolute",
          left: `${(todayPoint.x / VB_W) * 100}%`,
          top: `${(todayPoint.y / VB_H) * 100}%`,
          transform: "translate(-50%, 14px)",
          fontSize: 9.5, fontWeight: 700, color: toneColor, letterSpacing: "0.06em",
          whiteSpace: "nowrap",
        }}>
          You — day {dayNum}
        </div>
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px 14px", fontSize: 11, color: T.muted,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: toneColor, display: "inline-block" }} />
          Current · {Math.round(currentPercent)}%
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: `linear-gradient(90deg, ${T.goldBright}, ${T.green})`, display: "inline-block" }} />
          Chosen · 100%
        </div>
        <div style={{ color: gapPercent > 25 ? T.accent : T.hint, fontWeight: 600 }}>
          {gapPercent}pt gap
        </div>
      </div>
    </div>
  );
}
