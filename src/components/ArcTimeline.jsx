import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { T } from "../theme.js";
import { supabase } from "../supabase.js";
import { parseLocal, fmtEntryDate, isSatisfiedForTodayRing } from "../utils.js";
import { resolveArcTitle, arcDurationWeeksLabel } from "../arcProofMatch.js";
import { getArcDayNumber, getArcDurationDays, isProofHabitForBlock } from "../arcProgress.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import {
  buildArcTimeline,
  buildWeekDayJourney,
  partitionJournalEntries,
  reviewTextFromBlock,
  ymdAddDays,
  parseReceiptStructured,
  formatWeekStatusLine,
} from "../lib/arcTimeline.js";

const CHECKPOINT_W = 80;
const NODE = 44;
const RAIL_PAD = "calc(50% - 40px)";

const SEG = {
  before: "before",
  start: "start",
  finish: "finish",
  week: (n) => `week-${n}`,
  parseWeek: (seg) => {
    const m = /^week-(\d+)$/.exec(seg || "");
    return m ? Number(m[1]) : null;
  },
};

const ARC_MOTION_CSS = `
@keyframes arcPathReveal {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes arcChapterIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes arcPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(200,144,42,0.3); }
  50% { box-shadow: 0 0 0 5px rgba(200,144,42,0); }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes arcPathReveal { from, to { transform: none; opacity: 1; } }
  @keyframes arcChapterIn { from, to { transform: none; opacity: 1; } }
  @keyframes arcPulse { from, to { box-shadow: none; } }
}
`;

const SECONDARY_BTN = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "10px 2px", background: "none", border: "none",
  color: T.sub, fontSize: 12.5, fontWeight: 500, cursor: "pointer",
  fontFamily: T.font, textAlign: "left", width: "100%",
};

function useRailCenterSelection(railRef, onSegment, reducedMotion) {
  const timerRef = useRef(null);
  const skipRef = useRef(false);

  const detectCenter = useCallback(() => {
    if (skipRef.current) return;
    const rail = railRef.current;
    if (!rail) return;
    const railRect = rail.getBoundingClientRect();
    const viewportCenter = railRect.left + railRect.width / 2;
    const nodes = rail.querySelectorAll("[data-segment]");
    let best = null;
    let bestDist = Infinity;
    nodes.forEach((el) => {
      const r = el.getBoundingClientRect();
      const center = r.left + r.width / 2;
      const dist = Math.abs(center - viewportCenter);
      if (dist < bestDist) {
        bestDist = dist;
        best = el.getAttribute("data-segment");
      }
    });
    if (best) onSegment(best);
  }, [railRef, onSegment]);

  const scrollToSegment = useCallback((segment) => {
    const rail = railRef.current;
    const el = rail?.querySelector(`[data-segment="${segment}"]`);
    if (!el) return;
    skipRef.current = true;
    el.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
    const delay = reducedMotion ? 60 : 380;
    window.setTimeout(() => {
      skipRef.current = false;
      onSegment(segment);
    }, delay);
  }, [railRef, onSegment, reducedMotion]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const onScroll = () => {
      if (skipRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(detectCenter, 90);
    };
    const onScrollEnd = () => {
      if (!skipRef.current) detectCenter();
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    rail.addEventListener("scrollend", onScrollEnd);
    return () => {
      rail.removeEventListener("scroll", onScroll);
      rail.removeEventListener("scrollend", onScrollEnd);
      clearTimeout(timerRef.current);
    };
  }, [railRef, detectCenter]);

  return { scrollToSegment, detectCenter };
}

function ProofRing({ percent, size = 40, active, complete }) {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (p / 100) * c;
  const stroke = active ? T.gold : complete ? "#3d9b5f" : "rgba(255,255,255,0.12)";
  return (
    <svg width={size} height={size} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
      {(p > 0 || active) ? (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={stroke} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </svg>
  );
}

function RailCheckpoint({
  segment, label, sublabel, selected, adjacent, onSelect, reducedMotion, index,
  children, quiet = false, scrollSnap = "center",
}) {
  const scale = selected ? 1.16 : adjacent ? 0.94 : 0.88;
  const opacity = selected ? 1 : quiet ? 0.38 : adjacent ? 0.58 : 0.72;
  const transition = reducedMotion ? "none" : "transform 0.24s ease, opacity 0.24s ease";

  return (
    <button
      type="button"
      data-segment={segment}
      onClick={() => onSelect(segment)}
      aria-pressed={selected}
      style={{
        flex: `0 0 ${CHECKPOINT_W}px`,
        width: CHECKPOINT_W,
        scrollSnapAlign: scrollSnap,
        background: "none",
        border: "none",
        padding: "0 0 4px",
        cursor: "pointer",
        fontFamily: T.font,
        opacity,
        transform: `scale(${scale})`,
        transition,
        transformOrigin: "center top",
        animation: reducedMotion ? undefined : `arcPathReveal 0.4s ease ${index * 0.03}s both`,
      }}
    >
      {label}
      {children}
      {sublabel ? (
        <div style={{
          marginTop: 5, padding: "0 2px", textAlign: "center", fontSize: 8.5,
          color: selected ? T.sub : T.muted, lineHeight: 1.2,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {sublabel}
        </div>
      ) : null}
    </button>
  );
}

function BeforeArcNode({ count, selected, adjacent, onSelect, reducedMotion, index }) {
  return (
    <RailCheckpoint
      segment={SEG.before}
      selected={selected}
      adjacent={adjacent}
      onSelect={onSelect}
      reducedMotion={reducedMotion}
      index={index}
      quiet={!selected}
      label={(
        <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: "0.08em", color: selected ? T.sub : T.hint, textAlign: "center", marginBottom: 4, lineHeight: 1.2 }}>
          BEFORE
        </div>
      )}
      sublabel={`${count} earlier`}
    >
      <div style={{
        width: 32, height: 32, borderRadius: "50%", margin: "0 auto",
        border: `2px solid ${selected ? T.gold : "rgba(255,255,255,0.1)"}`,
        background: T.bg,
        boxShadow: selected ? `0 0 10px ${T.gold}33` : "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, color: selected ? T.sub : T.muted,
        position: "relative", zIndex: 2,
      }}>
        ◂
      </div>
    </RailCheckpoint>
  );
}

function StartNode({ startDate, selected, adjacent, onSelect, reducedMotion, index }) {
  return (
    <RailCheckpoint
      segment={SEG.start}
      selected={selected}
      adjacent={adjacent}
      onSelect={onSelect}
      reducedMotion={reducedMotion}
      index={index}
      label={(
        <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: "0.1em", color: selected ? T.gold : T.hint, textAlign: "center", marginBottom: 4 }}>
          START
        </div>
      )}
      sublabel={startDate ? fmtEntryDate(startDate) : null}
    >
      <div style={{
        width: 34, height: 34, borderRadius: "50%", margin: "0 auto",
        border: `2px solid ${selected ? T.gold : "rgba(200,144,42,0.45)"}`,
        background: T.bg,
        boxShadow: selected ? `0 0 14px ${T.gold}33` : "none",
        position: "relative", zIndex: 2,
      }} />
    </RailCheckpoint>
  );
}

function WeekNode({ week, selected, adjacent, onSelect, reducedMotion, index }) {
  const isCurrent = week.status === "current";
  const isComplete = week.status === "complete";
  const isUpcoming = week.status === "upcoming";
  const segment = SEG.week(week.weekNum);

  const nodeBg = selected
    ? "rgba(200,144,42,0.22)"
    : isComplete ? "rgba(61,155,95,0.10)" : "rgba(255,255,255,0.03)";
  const borderColor = selected
    ? T.gold
    : isComplete ? "rgba(61,155,95,0.5)" : isCurrent ? "rgba(200,144,42,0.55)" : "rgba(255,255,255,0.1)";

  return (
    <RailCheckpoint
      segment={segment}
      selected={selected}
      adjacent={adjacent}
      onSelect={onSelect}
      reducedMotion={reducedMotion}
      index={index}
      quiet={isUpcoming && !selected}
      label={(
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", color: selected ? T.gold : isCurrent ? T.gold : T.hint, textAlign: "center", marginBottom: 4 }}>
          W{week.weekNum}
        </div>
      )}
      sublabel={week.evidenceLabel || (week.chapterTitle && !isUpcoming ? week.chapterTitle : null)}
    >
      <div style={{ position: "relative", width: NODE, height: NODE, margin: "0 auto" }}>
        <ProofRing percent={week.proofPercent} size={NODE} active={selected || isCurrent} complete={isComplete && !selected} />
        <div style={{
          position: "absolute", inset: 5, borderRadius: "50%",
          background: nodeBg, border: `2px solid ${borderColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: selected ? `0 0 12px ${T.gold}44` : "none",
          animation: isCurrent && selected && !reducedMotion ? "arcPulse 2.8s ease-in-out infinite" : undefined,
          zIndex: 2,
        }}>
          {isComplete && week.isGenuinelyComplete ? (
            <span style={{ fontSize: 13, color: "#4ade80", fontWeight: 700 }}>✓</span>
          ) : isCurrent ? (
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: T.gold }} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: T.muted }}>{week.weekNum}</span>
          )}
        </div>
      </div>
    </RailCheckpoint>
  );
}

function FinishNode({ block, daysLeft, weeksLeft, isComplete, selected, adjacent, onSelect, reducedMotion, index }) {
  const endLabel = block.endDate
    ? parseLocal(block.endDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : "";

  return (
    <RailCheckpoint
      segment={SEG.finish}
      selected={selected}
      adjacent={adjacent}
      onSelect={onSelect}
      reducedMotion={reducedMotion}
      index={index}
      scrollSnap="center"
      label={(
        <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: "0.1em", color: selected ? T.gold : T.hint, textAlign: "center", marginBottom: 4, lineHeight: 1.15 }}>
          {isComplete ? "DONE" : "FINISH"}
        </div>
      )}
      sublabel={!isComplete && daysLeft >= 0 ? `${daysLeft}d left` : endLabel || null}
    >
      <div style={{
        width: 34, height: 34, borderRadius: "50%", margin: "0 auto",
        border: `2px dashed ${selected ? T.gold : isComplete ? T.gold : "rgba(255,255,255,0.15)"}`,
        background: selected ? "rgba(200,144,42,0.12)" : isComplete ? "rgba(200,144,42,0.08)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13,
      }}>
        {isComplete ? "◆" : "◎"}
      </div>
    </RailCheckpoint>
  );
}

function ReceiptRow({ receipt, expanded, onToggle, compact }) {
  const parsed = parseReceiptStructured(receipt.content);
  if (!parsed?.title && !parsed?.narrative) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%", textAlign: "left",
        padding: compact ? "6px 0" : "8px 0",
        background: "none", border: "none",
        borderBottom: `0.5px solid ${T.border}`,
        cursor: "pointer", fontFamily: T.font,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{fmtEntryDate(receipt.date)}</span>
        <span style={{ fontSize: 10, color: T.sub }}>{expanded ? "▾" : "▸"}</span>
      </div>
      {parsed.title ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginTop: 2, lineHeight: 1.35, overflowWrap: "anywhere" }}>
          {parsed.title}
        </div>
      ) : null}
      {expanded ? (
        <ReceiptExpandedBody parsed={parsed} content={receipt.content} />
      ) : parsed.narrative ? (
        <div style={{
          fontSize: 12, color: T.muted, marginTop: 2, lineHeight: 1.4,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
        }}>
          {parsed.narrative}
        </div>
      ) : null}
    </button>
  );
}

const RECEIPT_LABEL_ACCENT = {
  "Proof shown": T.gold,
  "Wins": T.green,
  "Hard parts": "#9B7BAA",
  "Missed": T.amber,
  "Pattern": T.muted,
  "Why": T.hint,
  "Tomorrow": "#7BA3C9",
};

export function ReceiptExpandedBody({ parsed, content }) {
  const sections = [
    parsed?.proof ? { label: "Proof shown", text: parsed.proof } : null,
    parsed?.wins ? { label: "Wins", text: parsed.wins } : null,
    parsed?.hardParts ? { label: "Hard parts", text: parsed.hardParts } : null,
    parsed?.missed ? { label: "Missed", text: parsed.missed } : null,
    parsed?.pattern ? { label: "Pattern", text: parsed.pattern } : null,
    parsed?.why ? { label: "Why", text: parsed.why } : null,
    parsed?.tomorrow ? { label: "Tomorrow", text: parsed.tomorrow } : null,
  ].filter(Boolean);

  if (sections.length > 0) {
    return (
      <div style={{ marginTop: 6 }}>
        {parsed?.narrative ? (
          <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.55, marginBottom: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {parsed.narrative}
          </div>
        ) : null}
        {sections.map((s, i) => {
          const accent = RECEIPT_LABEL_ACCENT[s.label] || T.hint;
          return (
            <div
              key={s.label}
              style={{
                marginBottom: i < sections.length - 1 ? 12 : 0,
                paddingTop: i > 0 || parsed?.narrative ? 10 : 0,
                borderTop: i > 0 || (i === 0 && parsed?.narrative) ? `0.5px solid ${T.border}` : "none",
              }}
            >
              <div style={{
                fontSize: 9, fontWeight: 700, color: accent, letterSpacing: "0.1em",
                textTransform: "uppercase", marginBottom: 5, opacity: 0.92,
              }}>
                {s.label}
              </div>
              <div style={{
                fontSize: 12.5, color: T.sub, lineHeight: 1.55,
                whiteSpace: "pre-wrap", overflowWrap: "anywhere",
              }}>
                {s.text}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ fontSize: 12.5, color: T.sub, marginTop: 5, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {content}
    </div>
  );
}

const DAY_NODE = 16;

function DaySpineNode({ day, state, focused, onClick, reducedMotion }) {
  const hasReceipt = day?.hasReceipt;
  const hasProof = day?.hasProof;
  const isToday = state === "today";
  const isFuture = state === "future";
  const isEmpty = state === "empty";
  const isPartial = state === "partial";
  const isEvidence = state === "evidence" || (isToday && hasReceipt);

  let bg = "transparent";
  let border = "rgba(255,255,255,0.12)";
  let inner = null;

  if (isEvidence) {
    bg = "rgba(61,155,95,0.18)";
    border = isToday ? T.gold : "#3d9b5f";
    inner = <span style={{ fontSize: 9, color: "#4ade80", fontWeight: 700, lineHeight: 1 }}>✓</span>;
  } else if (isPartial || (isToday && hasProof)) {
    bg = "rgba(200,144,42,0.12)";
    border = isToday ? T.gold : "rgba(200,144,42,0.55)";
    inner = <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.gold, display: "block" }} />;
  } else if (isToday) {
    bg = "rgba(200,144,42,0.08)";
    border = T.gold;
    inner = <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.gold, display: "block" }} />;
  } else if (isFuture) {
    border = "rgba(255,255,255,0.06)";
    inner = null;
  } else if (isEmpty) {
    border = "rgba(255,255,255,0.08)";
    inner = null;
  }

  const ring = (focused || isToday) && !reducedMotion ? `0 0 0 2px ${T.gold}33` : "none";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Day ${state}`}
      style={{
        width: DAY_NODE, height: DAY_NODE, borderRadius: "50%",
        border: `2px solid ${border}`, background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 0, cursor: "pointer", flexShrink: 0,
        boxShadow: ring,
        transition: reducedMotion ? "none" : "box-shadow 0.22s ease, border-color 0.22s ease",
        opacity: isFuture ? 0.35 : 1,
      }}
    >
      {inner}
    </button>
  );
}

function useViewportDayFocus(dayRefs, reducedMotion) {
  const [focusedDate, setFocusedDate] = useState(null);
  const timerRef = useRef(null);
  const lastRef = useRef(null);

  const detect = useCallback(() => {
    const targetY = window.innerHeight * 0.38;
    let best = null;
    let bestDist = Infinity;
    for (const [date, el] of dayRefs.current.entries()) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const center = r.top + r.height * 0.35;
      const dist = Math.abs(center - targetY);
      if (dist < bestDist) {
        bestDist = dist;
        best = date;
      }
    }
    if (best && best !== lastRef.current) {
      lastRef.current = best;
      setFocusedDate(best);
    }
  }, [dayRefs]);

  useEffect(() => {
    const onScroll = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(detect, 140);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    detect();
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timerRef.current);
    };
  }, [detect]);

  const scrollToDay = useCallback((date) => {
    const el = dayRefs.current.get(date);
    if (!el) return;
    el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    lastRef.current = date;
    setFocusedDate(date);
  }, [dayRefs, reducedMotion]);

  return { focusedDate, scrollToDay };
}

// Pick the shortest meaningful headline for a day receipt.
// Avoids the raw "Proof shown: ..." first line — uses pattern or narrative opener instead.
function dayDisplayTitle(parsed) {
  if (!parsed) return null;
  if (parsed.pattern?.trim()) return parsed.pattern.trim();
  if (parsed.narrative?.trim()) {
    const first = parsed.narrative.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (first) return first;
  }
  // Strip the "Proof shown: ..." prefix as a last resort — take text after the first sentence
  if (parsed.title) {
    const clean = parsed.title.replace(/^Proof shown:\s*/i, "").trim();
    return clean.split(/(?<=[.!?])\s+/)[0]?.trim() || clean;
  }
  return null;
}

function WeekDayJourney({ week, arcLedgerRows, journalEntries, reducedMotion }) {
  const days = useMemo(
    () => buildWeekDayJourney(week, { arcLedgerRows, journalEntries }),
    [week, arcLedgerRows, journalEntries],
  );
  const [expandedDate, setExpandedDate] = useState(null);
  const dayRefs = useRef(new Map());
  const { focusedDate, scrollToDay } = useViewportDayFocus(dayRefs, reducedMotion);

  if (!days.length || week.status === "upcoming") return null;

  return (
    <div style={{ marginTop: 14, position: "relative" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
        Daily evidence
      </div>
      <div style={{ position: "relative" }}>
        {days.map((day) => {
          const focused = focusedDate === day.date;
          const spineColor = day.hasReceipt || day.state === "evidence"
            ? "rgba(61,155,95,0.35)"
            : day.hasProof || day.state === "partial"
              ? "rgba(200,144,42,0.25)"
              : "rgba(255,255,255,0.07)";

          return (
            <div
              key={day.date}
              ref={(el) => {
                if (el) dayRefs.current.set(day.date, el);
                else dayRefs.current.delete(day.date);
              }}
              data-day={day.date}
              style={{
                display: "flex",
                gap: 10,
                minWidth: 0,
                opacity: day.state === "future" ? 0.45 : focused ? 1 : 0.82,
                transition: reducedMotion ? "none" : "opacity 0.22s ease",
              }}
            >
              <div style={{ width: 20, display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                {!day.isFirst ? (
                  <div style={{ width: 2, height: 6, background: spineColor, flexShrink: 0 }} />
                ) : <div style={{ height: 4 }} />}
                <DaySpineNode
                  day={day}
                  state={day.state}
                  focused={focused}
                  reducedMotion={reducedMotion}
                  onClick={() => scrollToDay(day.date)}
                />
                {!day.isLast ? (
                  <div style={{ width: 2, flex: 1, minHeight: 8, background: spineColor }} />
                ) : null}
              </div>

              <div style={{ flex: 1, minWidth: 0, paddingBottom: day.isLast ? 4 : 14 }}>
                <button
                  type="button"
                  onClick={() => {
                    scrollToDay(day.date);
                    if (day.hasReceipt) setExpandedDate(expandedDate === day.date ? null : day.date);
                  }}
                  style={{
                    width: "100%", textAlign: "left", background: "none", border: "none",
                    padding: 0, cursor: "pointer", fontFamily: T.font,
                  }}
                >
                  {/* Ring + text side by side */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {/* Mini proof ring — 36px, same visual as Today screen */}
                    {day.state !== "future" && day.proofTotal > 0 ? (
                      <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
                        <ProofRing
                          size={36}
                          percent={Math.round((day.proofDone / day.proofTotal) * 100)}
                          active={day.state === "today"}
                          complete={day.proofDone === day.proofTotal}
                        />
                        <div style={{
                          position: "absolute", inset: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <span style={{
                            fontSize: 8.5, fontWeight: 700, lineHeight: 1,
                            color: day.proofDone === day.proofTotal ? T.gold : T.sub,
                          }}>
                            {day.proofDone}/{day.proofTotal}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        width: 36, height: 36, flexShrink: 0, borderRadius: "50%",
                        border: "2px solid rgba(255,255,255,0.06)",
                      }} />
                    )}

                    {/* Date + catchy title (single line) */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 10, fontWeight: 500,
                        color: focused ? T.text : T.muted, lineHeight: 1.3,
                      }}>
                        {day.label}
                      </div>
                      {day.hasReceipt ? (() => {
                        const headline = dayDisplayTitle(day.parsed);
                        return headline ? (
                          <div style={{
                            fontSize: 13, fontWeight: 600, color: T.text,
                            marginTop: 2, lineHeight: 1.3,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {headline}
                          </div>
                        ) : null;
                      })() : day.state === "partial" ? (
                        <div style={{ fontSize: 11, color: T.hint, marginTop: 1 }}>Proof logged · no receipt</div>
                      ) : day.state === "today" && !day.hasProof ? (
                        <div style={{ fontSize: 11, color: T.hint, marginTop: 1 }}>No evidence yet</div>
                      ) : day.state === "future" ? (
                        <div style={{ fontSize: 10, color: T.hint, marginTop: 1, fontStyle: "italic" }}>Ahead</div>
                      ) : day.state === "empty" ? (
                        <div style={{ fontSize: 11, color: T.hint, marginTop: 1, opacity: 0.4 }}>—</div>
                      ) : null}
                    </div>
                  </div>

                  {/* Expanded receipt on tap */}
                  {expandedDate === day.date && day.hasReceipt ? (
                    <div onClick={e => e.stopPropagation()} style={{ marginTop: 10, paddingLeft: 46 }}>
                      <ReceiptExpandedBody parsed={day.parsed} content={day.journal.content} />
                      <button type="button" onClick={() => setExpandedDate(null)}
                        style={{ marginTop: 6, padding: 0, background: "none", border: "none", color: T.sub, fontSize: 11, cursor: "pointer", fontFamily: T.font }}>
                        Collapse ▴
                      </button>
                    </div>
                  ) : null}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BeforeArcChronology({ entries, reducedMotion }) {
  const [expanded, setExpanded] = useState(null);
  const [visibleCount, setVisibleCount] = useState(6);
  const dayRefs = useRef(new Map());
  const { focusedDate, scrollToDay } = useViewportDayFocus(dayRefs, reducedMotion);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [entries],
  );
  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  return (
    <div style={{ marginTop: 12 }}>
      {visible.map((e, i) => {
        const parsed = parseReceiptStructured(e.content);
        const focused = focusedDate === e.date;
        const isLast = i === visible.length - 1 && !hasMore;

        return (
          <div
            key={e.date}
            ref={(el) => {
              if (el) dayRefs.current.set(e.date, el);
              else dayRefs.current.delete(e.date);
            }}
            style={{
              display: "flex", gap: 10, minWidth: 0,
              opacity: focused ? 1 : 0.85,
              transition: reducedMotion ? "none" : "opacity 0.22s ease",
            }}
          >
            <div style={{ width: 20, display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              {i > 0 ? <div style={{ width: 2, height: 6, background: "rgba(255,255,255,0.07)" }} /> : <div style={{ height: 4 }} />}
              <DaySpineNode
                state="evidence"
                focused={focused}
                reducedMotion={reducedMotion}
                onClick={() => scrollToDay(e.date)}
              />
              {!isLast ? <div style={{ width: 2, flex: 1, minHeight: 8, background: "rgba(255,255,255,0.07)" }} /> : null}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 4 : 8 }}>
              <button
                type="button"
                onClick={() => {
                  scrollToDay(e.date);
                  setExpanded(expanded === e.date ? null : e.date);
                }}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: T.font }}
              >
                <div style={{ fontSize: 11, fontWeight: focused ? 600 : 500, color: focused ? T.text : T.muted }}>
                  {fmtEntryDate(e.date)}
                </div>
                {parsed?.title ? (
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginTop: 2, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                    {parsed.title}
                  </div>
                ) : null}
                {expanded === e.date ? (
                  <div onClick={ev => ev.stopPropagation()} style={{ marginTop: 4 }}>
                    <ReceiptExpandedBody parsed={parsed} content={e.content} />
                  </div>
                ) : parsed?.narrative ? (
                  <div style={{
                    fontSize: 12, color: T.sub, marginTop: 2, lineHeight: 1.45,
                    overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                  }}>
                    {parsed.narrative}
                  </div>
                ) : null}
              </button>
            </div>
          </div>
        );
      })}
      {hasMore ? (
        <button
          type="button"
          onClick={() => setVisibleCount(c => Math.min(c + 7, sorted.length))}
          style={{
            marginTop: 10, padding: "8px 0", background: "none", border: "none",
            color: T.sub, fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: T.font,
          }}
        >
          Show earlier entries · {sorted.length - visibleCount} more ▸
        </button>
      ) : null}
    </div>
  );
}

function RailConnector({ active, width = 14 }) {
  return (
    <div
      aria-hidden
      style={{
        flex: `0 0 ${width}px`,
        width,
        height: 2,
        marginTop: 36,
        alignSelf: "flex-start",
        background: active ? `linear-gradient(90deg, ${T.gold}66, rgba(255,255,255,0.08))` : "rgba(255,255,255,0.08)",
        zIndex: 0,
        flexShrink: 0,
      }}
    />
  );
}

function DetailAccent() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 3, height: 14, borderRadius: 2, background: T.gold, flexShrink: 0 }} />
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${T.gold}55, transparent)` }} />
    </div>
  );
}

function WeekDetail({
  week, arcLedgerRows, journalEntries, generatingBrief, onGenerateBrief, briefError, reducedMotion, panelKey,
}) {
  if (!week) return null;

  const statusLine = formatWeekStatusLine(week);
  const rangeLabel = `${fmtEntryDate(week.startDate)} – ${fmtEntryDate(week.endDate)}`;

  return (
    <div key={panelKey} style={{ animation: reducedMotion ? undefined : "arcChapterIn 0.28s ease both", paddingBottom: 24 }}>
      <DetailAccent />
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Week {week.weekNum} · Days {week.dayStart}–{week.dayEnd}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>{rangeLabel}</div>

      {week.chapterTitle ? (
        <div style={{
          fontFamily: T.serif, fontSize: 20, color: T.text, lineHeight: 1.2,
          marginTop: 10, overflowWrap: "anywhere", wordBreak: "break-word",
        }}>
          {week.chapterTitle}
        </div>
      ) : week.status === "upcoming" ? (
        <div style={{ fontSize: 13, color: T.muted, marginTop: 10, fontStyle: "italic" }}>Not started yet</div>
      ) : null}

      {statusLine ? (
        <div style={{ fontSize: 12, color: T.sub, marginTop: 8, lineHeight: 1.4 }}>{statusLine}</div>
      ) : null}

      <WeekDayJourney
        week={week}
        arcLedgerRows={arcLedgerRows}
        journalEntries={journalEntries}
        reducedMotion={reducedMotion}
      />
    </div>
  );
}

function BeforeArcDetail({ entries, reducedMotion, panelKey }) {
  return (
    <div key={panelKey} style={{ animation: reducedMotion ? undefined : "arcChapterIn 0.28s ease both", paddingBottom: 24 }}>
      <DetailAccent />
      <div style={{ fontSize: 10, fontWeight: 800, color: T.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Before this Arc
      </div>
      <div style={{ fontSize: 12, color: T.sub, marginTop: 6, lineHeight: 1.45 }}>
        These entries do not count toward Arc progress.
      </div>
      <BeforeArcChronology entries={entries} reducedMotion={reducedMotion} />
    </div>
  );
}

function StartDetail({ block, reducedMotion, panelKey }) {
  const title = resolveArcTitle(block.title, block.identity);
  return (
    <div key={panelKey} style={{ animation: reducedMotion ? undefined : "arcChapterIn 0.28s ease both" }}>
      <DetailAccent />
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Arc begins
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>
        {block.startDate ? fmtEntryDate(block.startDate) : ""}
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 18, color: T.text, marginTop: 10, lineHeight: 1.2, overflowWrap: "anywhere" }}>
        {title}
      </div>
      {block.identity ? (
        <div style={{ fontSize: 13, color: T.sub, marginTop: 6, fontStyle: "italic", lineHeight: 1.5, overflowWrap: "anywhere" }}>
          {block.identity}
        </div>
      ) : null}
    </div>
  );
}

function FinishDetail({ block, daysLeft, weeksLeft, isComplete, reducedMotion, panelKey }) {
  const endLabel = block.endDate
    ? parseLocal(block.endDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";
  const story = reviewTextFromBlock(block);

  return (
    <div key={panelKey} style={{ animation: reducedMotion ? undefined : "arcChapterIn 0.28s ease both" }}>
      <DetailAccent />
      <div style={{ fontSize: 10, fontWeight: 800, color: isComplete ? T.gold : T.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {isComplete ? "Arc complete" : "Arc ends"}
      </div>
      {endLabel ? <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>{endLabel}</div> : null}
      {!isComplete ? (
        <div style={{ fontSize: 13, color: T.text, marginTop: 10, lineHeight: 1.5 }}>
          {daysLeft} day{daysLeft === 1 ? "" : "s"} remaining
          {weeksLeft > 0 ? ` · ${weeksLeft} week${weeksLeft === 1 ? "" : "s"} left` : ""}
        </div>
      ) : null}
      {story ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
            Arc story
          </div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.65, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {story}
          </div>
        </div>
      ) : !isComplete ? (
        <div style={{ fontSize: 12.5, color: T.sub, marginTop: 10, lineHeight: 1.5 }}>
          Your Arc story will appear here when you complete this season.
        </div>
      ) : null}
    </div>
  );
}

function EvidenceChronologySheet({ journalEntries, block, onClose, reducedMotion }) {
  const [expanded, setExpanded] = useState(null);
  const duration = getArcDurationDays(block);
  const arcEnd = block?.startDate ? ymdAddDays(block.startDate, duration - 1) : null;

  const sorted = useMemo(
    () => [...(journalEntries || [])].filter(e => e?.date).sort((a, b) => b.date.localeCompare(a.date)),
    [journalEntries],
  );

  let lastZone = null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, background: T.bg,
      display: "flex", flexDirection: "column",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      animation: reducedMotion ? undefined : "arcChapterIn 0.25s ease both",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 14px", borderBottom: `0.5px solid ${T.border}`, flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Evidence chronology</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>All captured days, newest first</div>
        </div>
        <button type="button" onClick={onClose}
          style={{ padding: "6px 12px", borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.raised, color: T.text, fontSize: 13, cursor: "pointer", fontFamily: T.font }}>
          Done
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 14px 24px", minWidth: 0 }}>
        {sorted.length === 0 ? (
          <div style={{ fontSize: 13, color: T.muted, padding: "24px 0", textAlign: "center" }}>No evidence recorded yet.</div>
        ) : sorted.map(e => {
          const inArc = block?.startDate && arcEnd && e.date >= block.startDate && e.date <= arcEnd;
          const zone = inArc ? "arc" : "outside";
          const showLabel = zone !== lastZone;
          lastZone = zone;
          return (
            <div key={e.date}>
              {showLabel ? (
                <div style={{
                  fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: "0.1em",
                  textTransform: "uppercase", padding: "12px 0 6px",
                }}>
                  {inArc ? "This Arc" : "Outside this Arc"}
                </div>
              ) : null}
              <ReceiptRow
                receipt={e}
                expanded={expanded === e.date}
                onToggle={() => setExpanded(expanded === e.date ? null : e.date)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArcJourneyHero({
  block, dayNum, duration, weekNum, weeksTotal, daysLeft, progress,
  proofDone, proofTotal, onEditArc, onToggleDetails, detailsOpen, reducedMotion, children,
}) {
  const arcTitle = resolveArcTitle(block.title, block.identity);

  return (
    <div style={{ position: "relative", marginBottom: 10, padding: "14px 2px 0" }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
        {arcDurationWeeksLabel(duration)} · Week {weekNum} of {weeksTotal}
      </div>
      <div style={{
        fontFamily: T.serif, fontSize: 26, color: T.text, lineHeight: 1.12,
        marginBottom: 8, overflowWrap: "anywhere", wordBreak: "break-word",
      }}>
        {arcTitle}
      </div>
      {block.identity ? (
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 12, fontStyle: "italic", overflowWrap: "anywhere" }}>
          {block.identity}
        </div>
      ) : null}

      <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${Math.round(progress * 100)}%`,
          background: `linear-gradient(90deg, ${T.accent}, ${T.gold})`,
          borderRadius: 3,
          transition: reducedMotion ? undefined : "width 0.5s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: T.muted }}>
        <span>Day {dayNum} of {duration}</span>
        <span>{proofTotal > 0 ? `${proofDone}/${proofTotal} proof today` : (daysLeft === 0 ? "Final day" : `${daysLeft} days left`)}</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {onEditArc ? (
          <button type="button" onClick={onEditArc}
            style={{ padding: "7px 12px", borderRadius: 8, border: `0.5px solid ${T.border}`, background: "transparent", color: T.sub, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
            Edit Arc
          </button>
        ) : null}
        {onToggleDetails ? (
          <button type="button" onClick={onToggleDetails}
            style={{ padding: "7px 12px", borderRadius: 8, border: `0.5px solid ${T.border}`, background: "transparent", color: T.muted, fontSize: 11.5, fontWeight: 500, cursor: "pointer", fontFamily: T.font }}>
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        ) : null}
      </div>

      {detailsOpen && children ? (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${T.border}` }}>
          {children}
        </div>
      ) : null}

      <div style={{
        width: 2, height: 16, margin: "10px auto 0",
        background: `linear-gradient(180deg, ${T.gold}88, transparent)`,
        borderRadius: 1,
      }} />
    </div>
  );
}

export function ArcTimeline({
  block,
  habits = [],
  goals = [],
  journalEntries = [],
  arcLedgerRows = [],
  userId,
  userName = "",
  isPro = false,
  isActive = true,
  onEditArc,
  onRunItBack,
  onEvolve,
  initialWeek = null,
  openChronologyOnMount = false,
  embedded = false,
}) {
  const railRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const [weeklyBriefs, setWeeklyBriefs] = useState({});
  const [briefsLoading, setBriefsLoading] = useState(true);
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showChronology, setShowChronology] = useState(openChronologyOnMount);
  const [ledgerRows, setLedgerRows] = useState(arcLedgerRows);
  const initialScrollDone = useRef(false);

  useEffect(() => { setLedgerRows(arcLedgerRows); }, [arcLedgerRows]);
  useEffect(() => { if (openChronologyOnMount) setShowChronology(true); }, [openChronologyOnMount]);

  const { inArc: journalInArc, unassigned } = useMemo(
    () => partitionJournalEntries(block, journalEntries),
    [block, journalEntries],
  );

  useEffect(() => {
    if (isActive || !block?.id || arcLedgerRows.length > 0) return;
    let cancelled = false;
    supabase.from("arc_daily_scores").select("*").eq("block_id", block.id).order("date")
      .then(({ data }) => {
        if (cancelled || !data) return;
        setLedgerRows(data.map(r => ({
          date: r.date, proofTotal: r.proof_total, proofDone: r.proof_done, blockId: r.block_id,
        })));
      });
    return () => { cancelled = true; };
  }, [isActive, block?.id, arcLedgerRows.length]);

  useEffect(() => {
    if (!userId || !block?.startDate) { setBriefsLoading(false); return; }
    let cancelled = false;
    const arcEnd = ymdAddDays(block.startDate, getArcDurationDays(block) - 1);
    const fetchStart = ymdAddDays(block.startDate, -7);
    (async () => {
      try {
        const { data } = await supabase
          .from("weekly_brief_generation_usage")
          .select("week_start, brief_text, brief_generated_at")
          .eq("user_id", userId)
          .gte("week_start", fetchStart)
          .lte("week_start", arcEnd)
          .not("brief_text", "is", null);
        if (cancelled) return;
        const map = {};
        for (const row of data || []) {
          if (row.week_start && row.brief_text) map[row.week_start] = { text: row.brief_text };
        }
        setWeeklyBriefs(map);
      } catch { /* non-fatal */ }
      finally { if (!cancelled) setBriefsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, block?.id, block?.startDate, block?.durationDays]);

  const timeline = useMemo(() => buildArcTimeline(block, {
    arcLedgerRows: ledgerRows,
    journalEntries: journalInArc,
    weeklyBriefsByWeekStart: weeklyBriefs,
  }), [block, ledgerRows, journalInArc, weeklyBriefs]);

  const currentWeek = timeline.currentWeek;
  const duration = getArcDurationDays(block);
  const dayNum = getArcDayNumber(block);
  const daysLeft = Math.max(0, duration - dayNum);
  const weeksLeft = Math.max(0, timeline.weekCount - currentWeek);
  const weeksTotal = timeline.weekCount;
  const progress = Math.min(1, Math.max(0, (dayNum - 1) / Math.max(1, duration)));

  const proofHabits = (habits || []).filter(h => h.habitType !== "log" && isProofHabitForBlock(h, block?.id));
  const proofDone = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const proofTotal = proofHabits.length;

  const defaultSegment = initialWeek != null ? SEG.week(initialWeek) : SEG.week(currentWeek);

  useEffect(() => {
    setSelectedSegment(defaultSegment);
    initialScrollDone.current = false;
  }, [block?.id, defaultSegment]);

  const handleSegmentChange = useCallback((seg) => {
    setSelectedSegment(seg);
    setBriefError(null);
  }, []);

  const { scrollToSegment } = useRailCenterSelection(railRef, handleSegmentChange, reducedMotion);

  const handleSelectSegment = useCallback((seg) => {
    scrollToSegment(seg);
  }, [scrollToSegment]);

  useEffect(() => {
    if (briefsLoading || initialScrollDone.current || !selectedSegment) return;
    const t = setTimeout(() => {
      scrollToSegment(selectedSegment);
      initialScrollDone.current = true;
    }, 80);
    return () => clearTimeout(t);
  }, [briefsLoading, selectedSegment, scrollToSegment, block?.id]);

  const segmentList = useMemo(() => {
    const list = [];
    if (unassigned.length > 0) list.push(SEG.before);
    list.push(SEG.start);
    timeline.weeks.forEach(w => list.push(SEG.week(w.weekNum)));
    list.push(SEG.finish);
    return list;
  }, [unassigned.length, timeline.weeks]);

  const selectedIndex = segmentList.indexOf(selectedSegment);
  const isAdjacent = (seg) => {
    const i = segmentList.indexOf(seg);
    return selectedIndex >= 0 && Math.abs(i - selectedIndex) === 1;
  };

  const selectedWeekNum = SEG.parseWeek(selectedSegment);
  const selectedWeek = timeline.weeks.find(w => w.weekNum === selectedWeekNum);
  const isArcComplete = block.status !== "active";

  async function handleGenerateBrief(week) {
    if (!userId || generatingBrief) return;
    setGeneratingBrief(true);
    setBriefError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/weekly-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          habits, goals, journalEntries,
          name: (userName || "").trim() || "there",
          client_date: week.endDate,
          ...(isActive && block?.id ? { activeBlock: block } : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not generate review");
      if (payload.text && week.briefWeekStart) {
        setWeeklyBriefs(prev => ({ ...prev, [week.briefWeekStart]: { text: payload.text } }));
      }
    } catch (err) {
      setBriefError(err.message || "Generation failed");
    } finally {
      setGeneratingBrief(false);
    }
  }

  if (!block?.id) return null;

  const detailsFields = (
    <>
      {block.whyStatement ? <p style={{ fontSize: 13, color: T.sub, margin: "0 0 10px", lineHeight: 1.55 }}><span style={{ color: T.hint }}>Why · </span>{block.whyStatement}</p> : null}
      {block.oldPattern ? <p style={{ fontSize: 13, color: T.sub, margin: "0 0 10px", lineHeight: 1.55 }}><span style={{ color: T.accent }}>Old pattern · </span>{block.oldPattern}</p> : null}
      {block.minimumProof ? <p style={{ fontSize: 13, color: T.sub, margin: 0, lineHeight: 1.55 }}><span style={{ color: T.green }}>Bad-day minimum · </span>{block.minimumProof}</p> : null}
    </>
  );

  let detailPanel = null;
  if (selectedSegment === SEG.before) {
    detailPanel = <BeforeArcDetail entries={unassigned} reducedMotion={reducedMotion} panelKey="before" />;
  } else if (selectedSegment === SEG.start) {
    detailPanel = <StartDetail block={block} reducedMotion={reducedMotion} panelKey="start" />;
  } else if (selectedSegment === SEG.finish) {
    detailPanel = (
      <FinishDetail
        block={block}
        daysLeft={daysLeft}
        weeksLeft={weeksLeft}
        isComplete={isArcComplete}
        reducedMotion={reducedMotion}
        panelKey="finish"
      />
    );
  } else if (selectedWeek) {
    detailPanel = (
      <WeekDetail
        week={selectedWeek}
        panelKey={selectedSegment}
        arcLedgerRows={ledgerRows}
        journalEntries={journalInArc}
        generatingBrief={generatingBrief}
        onGenerateBrief={isActive ? handleGenerateBrief : null}
        briefError={briefError}
        reducedMotion={reducedMotion}
      />
    );
  }

  let nodeIndex = 0;

  return (
    <div style={{ minWidth: 0, overflow: "hidden", maxWidth: "100%" }}>
      <style>{ARC_MOTION_CSS}</style>

      {isActive && !embedded ? (
        <ArcJourneyHero
          block={block}
          dayNum={dayNum}
          duration={duration}
          weekNum={currentWeek}
          weeksTotal={weeksTotal}
          daysLeft={daysLeft}
          progress={progress}
          proofDone={proofDone}
          proofTotal={proofTotal}
          onEditArc={onEditArc}
          onToggleDetails={(block.whyStatement || block.oldPattern || block.minimumProof) ? () => setDetailsOpen(v => !v) : null}
          detailsOpen={detailsOpen}
          reducedMotion={reducedMotion}
        >
          {detailsFields}
        </ArcJourneyHero>
      ) : null}

      <div
        ref={railRef}
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          scrollSnapType: "x mandatory",
          minWidth: 0,
          maxWidth: "100%",
          marginBottom: 4,
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          position: "relative",
          paddingLeft: RAIL_PAD,
          paddingRight: RAIL_PAD,
          minHeight: 108,
        }}>
          {(() => {
            const nodes = [];
            const pushConnector = (active) => {
              if (nodes.length > 0) nodes.push(<RailConnector key={`c-${nodes.length}`} active={active} />);
            };
            const weekSegIndex = (n) => {
              const idx = segmentList.indexOf(SEG.week(n));
              const cur = segmentList.indexOf(SEG.week(currentWeek));
              return idx >= 0 && cur >= 0 && idx <= cur;
            };

            if (unassigned.length > 0) {
              nodes.push(
                <BeforeArcNode
                  key="before"
                  count={unassigned.length}
                  selected={selectedSegment === SEG.before}
                  adjacent={isAdjacent(SEG.before)}
                  onSelect={handleSelectSegment}
                  reducedMotion={reducedMotion}
                  index={nodeIndex++}
                />,
              );
            }

            pushConnector(false);
            nodes.push(
              <StartNode
                key="start"
                startDate={block.startDate}
                selected={selectedSegment === SEG.start}
                adjacent={isAdjacent(SEG.start)}
                onSelect={handleSelectSegment}
                reducedMotion={reducedMotion}
                index={nodeIndex++}
              />,
            );

            timeline.weeks.forEach((week) => {
              const seg = SEG.week(week.weekNum);
              pushConnector(weekSegIndex(week.weekNum));
              nodes.push(
                <WeekNode
                  key={week.weekNum}
                  week={week}
                  selected={selectedSegment === seg}
                  adjacent={isAdjacent(seg)}
                  onSelect={handleSelectSegment}
                  reducedMotion={reducedMotion}
                  index={nodeIndex++}
                />,
              );
            });

            pushConnector(currentWeek >= timeline.weekCount);
            nodes.push(
              <FinishNode
                key="finish"
                block={block}
                daysLeft={daysLeft}
                weeksLeft={weeksLeft}
                isComplete={isArcComplete}
                selected={selectedSegment === SEG.finish}
                adjacent={isAdjacent(SEG.finish)}
                onSelect={handleSelectSegment}
                reducedMotion={reducedMotion}
                index={nodeIndex++}
              />,
            );

            return nodes;
          })()}
        </div>
      </div>

      {/* Detail — content height only */}
      <div style={{ minWidth: 0, padding: "4px 6px 16px" }}>
        {detailPanel}
      </div>

      {isArcComplete && (onRunItBack || onEvolve) ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 6px 16px" }}>
          {onRunItBack ? (
            <button type="button" onClick={() => onRunItBack(block)}
              style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: T.gold, color: "#0F0F0D", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
              Run it back
            </button>
          ) : null}
          {onEvolve ? (
            <button type="button" onClick={() => onEvolve(block)}
              style={{ padding: "10px 16px", borderRadius: 8, border: `0.5px solid ${T.border}`, background: "transparent", color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
              Evolve Arc
            </button>
          ) : null}
        </div>
      ) : null}

      {showChronology ? (
        <EvidenceChronologySheet
          journalEntries={journalEntries}
          block={block}
          onClose={() => setShowChronology(false)}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </div>
  );
}

export function ArcArchiveCard({ block, journalEntries = [], expanded, onToggle, children }) {
  const title = resolveArcTitle(block.title, block.identity);
  const start = block.startDate ? parseLocal(block.startDate).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
  const end = block.endDate ? parseLocal(block.endDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  const weeks = Math.ceil((block.durationDays || 56) / 7);
  const story = reviewTextFromBlock(block);
  const reducedMotion = useReducedMotion();
  const timeline = useMemo(() => {
    const { inArc } = partitionJournalEntries(block, journalEntries);
    return buildArcTimeline(block, { journalEntries: inArc });
  }, [block, journalEntries]);

  return (
    <div style={{
      marginBottom: 12,
      borderBottom: `0.5px solid ${T.border}`,
      paddingBottom: expanded ? 12 : 8,
      animation: expanded && !reducedMotion ? "arcChapterIn 0.35s ease both" : undefined,
    }}>
      <button type="button" onClick={onToggle}
        style={{
          width: "100%", padding: "12px 2px", background: "none", border: "none", cursor: "pointer",
          textAlign: "left", fontFamily: T.font,
        }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: T.hint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
          {block.status === "completed" ? "Completed Arc" : block.status}
        </div>
        <div style={{ fontFamily: T.serif, fontSize: 17, color: T.text, lineHeight: 1.2, marginBottom: 4, overflowWrap: "anywhere" }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: T.muted }}>
          {start} – {end} · {weeks} weeks
          {timeline?.evidenceDaysTotal != null ? ` · ${timeline.evidenceDaysTotal} days captured` : ""}
          {block.completionScore != null ? ` · ${Math.round(block.completionScore)}% proof` : ""}
        </div>
        {story && !expanded ? (
          <div style={{
            fontSize: 11.5, color: T.sub, marginTop: 6, lineHeight: 1.45,
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {story}
          </div>
        ) : null}
      </button>
      {expanded ? <div style={{ paddingTop: 8 }}>{children}</div> : null}
    </div>
  );
}
