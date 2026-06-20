// ─── TIMELINE SPLIT ───────────────────────────────────────────────────────────
// Two parallel rails through the same Arc, built from the same node/connector
// language as the existing week rail — not a chart. Top rail is the Builder
// You (the ideal: full proof, every day). Bottom rail is Current You (what
// was actually logged). A beam joins them per week/day: tight and bright when
// proof closed the gap, broken and dim when it didn't.
import { useMemo } from "react";
import { T } from "../theme.js";
import { buildWeekDayJourney } from "../lib/arcTimeline.js";

const WEEK_NODE = 26;
const DAY_NODE = 16;

function tone(percent) {
  if (percent == null) return "unknown";
  if (percent >= 80) return "aligned";
  if (percent >= 40) return "drifting";
  return "off-path";
}

const TONE_COLOR = {
  aligned: T.green,
  drifting: T.gold,
  "off-path": T.accent,
  unknown: T.hint,
};

/** Vertical beam between the chosen node and the current node — shorter & brighter = closer. */
function Beam({ percent, status }) {
  const t = tone(percent);
  const color = TONE_COLOR[t];
  const known = status !== "upcoming" && percent != null;
  const gap = !known ? 26 : t === "aligned" ? 10 : t === "drifting" ? 18 : 26;

  return (
    <div style={{
      width: 2, height: gap, margin: "1px auto",
      background: known
        ? (t === "aligned" ? color : `repeating-linear-gradient(180deg, ${color} 0 3px, transparent 3px 7px)`)
        : "repeating-linear-gradient(180deg, rgba(255,255,255,0.12) 0 2px, transparent 2px 5px)",
      opacity: known ? (t === "aligned" ? 0.9 : 0.65) : 0.4,
      boxShadow: known && t === "aligned" ? `0 0 6px ${color}99` : "none",
      transition: "height 0.4s ease",
    }} />
  );
}

function ChosenWeekNode({ weekNum, isPast }) {
  return (
    <div style={{
      width: WEEK_NODE, height: WEEK_NODE, borderRadius: "50%",
      border: `2px solid ${T.goldBright}`,
      background: "rgba(245,200,66,0.14)",
      boxShadow: `0 0 8px ${T.goldBright}55`,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, color: T.goldBright, fontWeight: 700 }}>✓</span>
    </div>
  );
}

function CurrentWeekNode({ week }) {
  const isComplete = week.status === "complete";
  const isCurrent = week.status === "current";
  const t = tone(week.proofPercent);
  const color = TONE_COLOR[t];

  if (week.status === "upcoming") {
    return (
      <div style={{
        width: WEEK_NODE, height: WEEK_NODE, borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.12)", background: "transparent",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: T.hint, fontWeight: 700 }}>{week.weekNum}</span>
      </div>
    );
  }

  return (
    <div style={{
      width: WEEK_NODE, height: WEEK_NODE, borderRadius: "50%",
      border: `2px solid ${color}`,
      background: `${color}1F`,
      boxShadow: isCurrent ? `0 0 8px ${color}66` : "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
      animation: isCurrent ? "arcPulse 2.8s ease-in-out infinite" : undefined,
    }}>
      {isComplete && week.isGenuinelyComplete && t === "aligned" ? (
        <span style={{ fontSize: 11, color, fontWeight: 700 }}>✓</span>
      ) : (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "block" }} />
      )}
    </div>
  );
}

function WeekColumn({ week, isLast }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40, flexShrink: 0 }}>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", color: T.hint, marginBottom: 4 }}>
          W{week.weekNum}
        </div>
        <ChosenWeekNode weekNum={week.weekNum} />
        <Beam percent={week.proofPercent} status={week.status} />
        <CurrentWeekNode week={week} />
      </div>
      {!isLast ? (
        <div style={{ flex: 1, minWidth: 10, display: "flex", flexDirection: "column", gap: WEEK_NODE + 26 + 16 }}>
          <div style={{ height: 1, background: "rgba(245,200,66,0.25)" }} />
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>
      ) : null}
    </div>
  );
}

function DayTick({ day, percent, status }) {
  const t = tone(percent);
  const color = TONE_COLOR[t];
  const known = status !== "upcoming" && percent != null;
  return (
    <div style={{
      width: 2, height: 10, margin: "1px auto",
      background: known && t !== "unknown"
        ? color
        : "repeating-linear-gradient(180deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 4px)",
      opacity: known ? 0.85 : 0.4,
    }} />
  );
}

function ChosenDayDot({ isFuture }) {
  return (
    <div style={{
      width: DAY_NODE, height: DAY_NODE, borderRadius: "50%",
      border: `1.6px solid ${T.goldBright}`,
      background: isFuture ? "transparent" : "rgba(245,200,66,0.16)",
      opacity: isFuture ? 0.45 : 1,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      {!isFuture ? <span style={{ fontSize: 8, color: T.goldBright, fontWeight: 700 }}>✓</span> : null}
    </div>
  );
}

function CurrentDayDot({ day }) {
  const isEvidence = day.state === "evidence";
  const isPartial = day.state === "partial" || (day.state === "today" && day.hasProof);
  const isToday = day.state === "today";
  const isFuture = day.state === "future";
  const isEmpty = day.state === "empty";
  const missed = isEmpty && !isToday;

  let border = "rgba(255,255,255,0.14)";
  let bg = "transparent";
  let inner = null;
  if (isEvidence) { border = T.green; bg = `${T.green}26`; inner = <span style={{ fontSize: 8, color: T.green, fontWeight: 700 }}>✓</span>; }
  else if (isPartial) { border = T.gold; bg = `${T.gold}22`; inner = <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.gold }} />; }
  else if (isToday) { border = T.gold; bg = `${T.gold}14`; inner = <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.gold }} />; }
  else if (missed) { border = T.accent; bg = `${T.accent}1A`; inner = <span style={{ width: 4, height: 4, borderRadius: "50%", background: T.accent }} />; }

  return (
    <div style={{
      width: DAY_NODE, height: DAY_NODE, borderRadius: "50%",
      border: `1.6px solid ${border}`, background: bg,
      opacity: isFuture ? 0.35 : 1,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      {inner}
    </div>
  );
}

export function ArcTimelineSplit({ timeline, block, ledgerRows, journalEntries }) {
  const weeks = timeline?.weeks || [];
  const currentWeek = useMemo(
    () => weeks.find(w => w.weekNum === timeline.currentWeek) || weeks[weeks.length - 1],
    [weeks, timeline?.currentWeek],
  );

  const days = useMemo(
    () => (currentWeek ? buildWeekDayJourney(currentWeek, { arcLedgerRows: ledgerRows, journalEntries }) : []),
    [currentWeek, ledgerRows, journalEntries],
  );

  if (!weeks.length || !currentWeek) return null;

  const connectedDays = days.filter(d => d.hasProof || d.hasReceipt).length;
  const possibleDays = days.filter(d => d.state !== "future").length;
  const missingDays = Math.max(0, possibleDays - connectedDays);

  const sentence = missingDays === 0 && possibleDays > 0
    ? "Every day this week matches the life you chose."
    : possibleDays === 0
      ? "This week just opened. Today decides which path it joins."
      : `${missingDays} of ${possibleDays} day${possibleDays === 1 ? "" : "s"} this week ${missingDays === 1 ? "is" : "are"} still missing from the life you chose.`;

  return (
    <div style={{
      marginTop: 18,
      marginBottom: 4,
      borderRadius: T.r,
      position: "relative",
      background: "radial-gradient(120% 140% at 15% 0%, rgba(245,200,66,0.09) 0%, rgba(15,15,13,0) 45%), radial-gradient(120% 140% at 85% 100%, rgba(192,57,43,0.07) 0%, rgba(15,15,13,0) 50%), linear-gradient(165deg, #14140F 0%, #0C0C0A 100%)",
      border: `0.5px solid ${T.borderMid}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.45)",
      padding: "16px 14px 16px",
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: T.hint, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>
        Timeline Split
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 19, color: T.text, lineHeight: 1.2, marginBottom: 6 }}>
        Builder You <span style={{ color: T.hint, fontFamily: T.font, fontSize: 14, fontWeight: 500 }}>vs</span> Current You
      </div>
      <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5, marginBottom: 16, maxWidth: 520 }}>
        Every proof action pulls you closer to the version you chose.
      </div>

      {/* Weekly rail: two parallel rows of nodes joined by a beam per week */}
      <div style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
        {weeks.map((w, i) => (
          <WeekColumn key={w.weekNum} week={w} isLast={i === weeks.length - 1} />
        ))}
      </div>

      {/* This week, day by day — the part that actually moves */}
      <div style={{ paddingTop: 14, borderTop: `0.5px solid ${T.border}` }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: T.hint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
          Week {currentWeek.weekNum} · day by day
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
          {days.map(d => {
            const isFuture = d.state === "future";
            return (
              <div key={d.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 0 }}>
                <ChosenDayDot isFuture={isFuture} />
                <DayTick day={d} percent={d.proofTotal > 0 ? Math.round((d.proofDone / d.proofTotal) * 100) : (d.hasProof ? 100 : (isFuture ? null : 0))} status={d.state} />
                <CurrentDayDot day={d} />
                <div style={{ fontSize: 8.5, color: d.state === "today" ? T.gold : T.hint, marginTop: 4, fontWeight: d.state === "today" ? 700 : 500 }}>
                  {d.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{
        marginTop: 16, paddingTop: 14, borderTop: `0.5px solid ${T.border}`,
        fontSize: 13, color: missingDays > 0 ? T.text : T.green, lineHeight: 1.5,
      }}>
        {sentence}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 10.5, color: T.muted }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", border: `1.6px solid ${T.goldBright}`, display: "inline-block" }} />
          Builder You — the ideal
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", border: `1.6px solid ${T.green}`, background: `${T.green}33`, display: "inline-block" }} />
          Current You — what you logged
        </div>
      </div>
    </div>
  );
}
