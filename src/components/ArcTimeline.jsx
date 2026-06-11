import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { T } from "../theme.js";
import { supabase } from "../supabase.js";
import { parseLocal, fmtEntryDate, isSatisfiedForTodayRing } from "../utils.js";
import { resolveArcTitle, arcDurationWeeksLabel } from "../arcProofMatch.js";
import { getArcDayNumber, getArcDurationDays, isProofHabitForBlock } from "../arcProgress.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import {
  buildArcTimeline,
  partitionJournalEntries,
  reviewTextFromBlock,
  ymdAddDays,
  parseReceiptStructured,
  formatWeekStatusLine,
} from "../lib/arcTimeline.js";

const CHECKPOINT_W = 80;
const PATH_H = 56;
const NODE = 44;

const ARC_MOTION_CSS = `
@keyframes arcHeroBeam {
  from { transform: scaleY(0); opacity: 0; }
  to { transform: scaleY(1); opacity: 1; }
}
@keyframes arcPathReveal {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes arcChapterIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes arcPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(200,144,42,0.35); }
  50% { box-shadow: 0 0 0 6px rgba(200,144,42,0); }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes arcHeroBeam { from, to { transform: none; opacity: 1; } }
  @keyframes arcPathReveal { from, to { transform: none; opacity: 1; } }
  @keyframes arcChapterIn { from, to { transform: none; opacity: 1; } }
  @keyframes arcPulse { from, to { box-shadow: none; } }
}
`;

function ProofRing({ percent, size = 40, active, complete }) {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (p / 100) * c;
  const stroke = active ? T.gold : complete ? "#3d9b5f" : "rgba(255,255,255,0.12)";
  return (
    <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
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

function PathCheckpoint({
  week, selected, onSelect, reducedMotion, index,
}) {
  const isCurrent = week.status === "current";
  const isComplete = week.status === "complete";
  const isUpcoming = week.status === "upcoming";
  const isSelected = selected;

  const nodeBg = isSelected
    ? "rgba(200,144,42,0.22)"
    : isCurrent
      ? "rgba(200,144,42,0.12)"
      : isComplete
        ? "rgba(61,155,95,0.10)"
        : "rgba(255,255,255,0.03)";

  const borderColor = isSelected
    ? T.gold
    : isCurrent
      ? "rgba(200,144,42,0.7)"
      : isComplete
        ? "rgba(61,155,95,0.45)"
        : "rgba(255,255,255,0.08)";

  return (
    <button
      type="button"
      data-week={week.weekNum}
      onClick={() => onSelect(week.weekNum)}
      aria-label={`Week ${week.weekNum}${week.chapterTitle ? `, ${week.chapterTitle}` : ""}`}
      style={{
        flex: `0 0 ${CHECKPOINT_W}px`,
        width: CHECKPOINT_W,
        scrollSnapAlign: "center",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontFamily: T.font,
        opacity: isUpcoming ? 0.42 : 1,
        animation: reducedMotion ? undefined : `arcPathReveal 0.45s ease ${index * 0.04}s both`,
      }}
    >
      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.1em", color: isCurrent ? T.gold : T.hint, textAlign: "center", marginBottom: 4 }}>
        W{week.weekNum}
      </div>
      <div style={{ position: "relative", width: NODE, height: NODE, margin: "0 auto" }}>
        <ProofRing percent={week.proofPercent} size={NODE} active={isCurrent || isSelected} complete={isComplete && !isCurrent} />
        <div style={{
          position: "absolute", inset: 5, borderRadius: "50%",
          background: nodeBg,
          border: `2px solid ${borderColor}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: isCurrent && !reducedMotion ? "arcPulse 2.8s ease-in-out infinite" : undefined,
        }}>
          {isComplete && week.isGenuinelyComplete ? (
            <span style={{ fontSize: 14, color: "#4ade80", fontWeight: 700 }}>✓</span>
          ) : isCurrent ? (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.gold }} />
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: T.muted }}>{week.weekNum}</span>
          )}
        </div>
      </div>
      <div style={{
        marginTop: 6, padding: "0 2px", textAlign: "center", minHeight: 28,
      }}>
        {week.evidenceLabel ? (
          <div style={{ fontSize: 9, color: T.sub, lineHeight: 1.25, overflowWrap: "anywhere" }}>
            {week.evidenceLabel}
          </div>
        ) : null}
        {week.chapterTitle && !isUpcoming ? (
          <div style={{
            fontSize: 8.5, color: isSelected ? T.gold : T.muted, lineHeight: 1.2, marginTop: 2,
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {week.chapterTitle}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function ReceiptChip({ receipt, expanded, onToggle }) {
  const parsed = parseReceiptStructured(receipt.content);
  if (!parsed?.title && !parsed?.narrative) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%", textAlign: "left", padding: "10px 0",
        background: "none", border: "none", borderBottom: `0.5px solid ${T.border}`,
        cursor: "pointer", fontFamily: T.font,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{fmtEntryDate(receipt.date)}</span>
        <span style={{ fontSize: 10, color: T.hint }}>{expanded ? "▾" : "▸"}</span>
      </div>
      {parsed.title ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginTop: 4, lineHeight: 1.35, overflowWrap: "anywhere" }}>
          {parsed.title}
        </div>
      ) : null}
      {expanded && parsed.narrative ? (
        <div style={{ fontSize: 12.5, color: T.sub, marginTop: 6, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {parsed.narrative}
        </div>
      ) : !expanded && parsed.narrative ? (
        <div style={{
          fontSize: 12, color: T.muted, marginTop: 4, lineHeight: 1.45,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical",
        }}>
          {parsed.narrative}
        </div>
      ) : null}
    </button>
  );
}

function WeekChapter({
  week, generatingBrief, onGenerateBrief, briefError, reducedMotion, weekKey,
}) {
  const [expandedReceipt, setExpandedReceipt] = useState(null);
  if (!week) return null;

  const statusLine = formatWeekStatusLine(week);
  const rangeLabel = `${fmtEntryDate(week.startDate)} – ${fmtEntryDate(week.endDate)}`;

  return (
    <div
      key={weekKey}
      style={{
        animation: reducedMotion ? undefined : "arcChapterIn 0.38s ease both",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Week {week.weekNum} · Days {week.dayStart}–{week.dayEnd}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4 }}>{rangeLabel}</div>

      {week.chapterTitle ? (
        <div style={{
          fontFamily: T.serif, fontSize: 22, color: T.text, lineHeight: 1.2,
          marginTop: 12, marginBottom: 8, overflowWrap: "anywhere", wordBreak: "break-word",
        }}>
          {week.chapterTitle}
        </div>
      ) : week.status === "upcoming" ? (
        <div style={{ fontSize: 13, color: T.muted, marginTop: 12, fontStyle: "italic" }}>Not started yet</div>
      ) : null}

      {statusLine ? (
        <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 16, lineHeight: 1.5 }}>{statusLine}</div>
      ) : null}

      {week.briefText ? (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.hint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
            Weekly review
          </div>
          <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {week.briefText}
          </div>
        </div>
      ) : week.status === "current" && onGenerateBrief ? (
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 12, color: T.muted, margin: "0 0 10px" }}>No weekly review yet for this chapter.</p>
          <button
            type="button"
            disabled={generatingBrief}
            onClick={() => onGenerateBrief(week)}
            style={{
              padding: "8px 14px", borderRadius: 8, border: `0.5px solid rgba(200,144,42,0.35)`,
              background: "rgba(200,144,42,0.08)", color: T.gold, fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: T.font, opacity: generatingBrief ? 0.6 : 1,
            }}
          >
            {generatingBrief ? "Writing review…" : "Write weekly review"}
          </button>
        </div>
      ) : null}

      {briefError ? <div style={{ fontSize: 11, color: T.accent, marginBottom: 12 }}>{briefError}</div> : null}

      {week.receipts?.length > 0 ? (
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.hint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
            Daily evidence
          </div>
          {week.receipts.map(r => (
            <ReceiptChip
              key={r.date}
              receipt={r}
              expanded={expandedReceipt === r.date}
              onToggle={() => setExpandedReceipt(expandedReceipt === r.date ? null : r.date)}
            />
          ))}
        </div>
      ) : week.status !== "upcoming" ? (
        <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic", paddingTop: 8 }}>No receipts recorded this week.</div>
      ) : null}
    </div>
  );
}

function FinishLineNode({ block, daysLeft, isComplete }) {
  const endLabel = block.endDate
    ? parseLocal(block.endDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";
  const story = reviewTextFromBlock(block);

  return (
    <div
      style={{
        flex: `0 0 ${CHECKPOINT_W + 16}px`,
        width: CHECKPOINT_W + 16,
        scrollSnapAlign: "end",
        paddingTop: 18,
        textAlign: "center",
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: "50%", margin: "0 auto",
        border: `2px dashed ${isComplete ? T.gold : "rgba(255,255,255,0.15)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: isComplete ? "rgba(200,144,42,0.12)" : "transparent",
      }}>
        <span style={{ fontSize: 14 }}>{isComplete ? "◆" : "◎"}</span>
      </div>
      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.12em", color: isComplete ? T.gold : T.hint, marginTop: 8 }}>
        {isComplete ? "ARC COMPLETE" : "THE FINISH LINE"}
      </div>
      {!isComplete && daysLeft >= 0 ? (
        <div style={{ fontSize: 9, color: T.muted, marginTop: 4, lineHeight: 1.35, padding: "0 4px" }}>
          {daysLeft} day{daysLeft === 1 ? "" : "s"} remaining
          {endLabel ? <><br />ends {endLabel}</> : null}
        </div>
      ) : isComplete && endLabel ? (
        <div style={{ fontSize: 9, color: T.sub, marginTop: 4 }}>{endLabel}</div>
      ) : null}
      {isComplete && story ? (
        <div style={{
          fontSize: 8.5, color: T.muted, marginTop: 6, lineHeight: 1.3, padding: "0 2px",
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
        }}>
          {story}
        </div>
      ) : null}
    </div>
  );
}

function ArcJourneyHero({
  block, habits, dayNum, duration, weekNum, weeksTotal, daysLeft, progress,
  proofDone, proofTotal, journeyFocused, onFocusJourney, onEditArc, onToggleDetails,
  detailsOpen, reducedMotion, children,
}) {
  const arcTitle = resolveArcTitle(block.title, block.identity);

  return (
    <div style={{
      position: "relative",
      marginBottom: journeyFocused ? 8 : 20,
      transition: reducedMotion ? undefined : "margin 0.4s ease",
    }}>
      <div style={{
        padding: journeyFocused ? "14px 2px 0" : "18px 2px 0",
        transition: reducedMotion ? undefined : "padding 0.4s ease",
      }}>
        {!journeyFocused ? (
          <>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
              {arcDurationWeeksLabel(duration)} · Week {weekNum} of {weeksTotal}
            </div>
            <div style={{
              fontFamily: T.serif, fontSize: 28, color: T.text, lineHeight: 1.12,
              marginBottom: 8, overflowWrap: "anywhere", wordBreak: "break-word",
            }}>
              {arcTitle}
            </div>
            {block.identity ? (
              <div style={{ fontSize: 13.5, color: T.sub, lineHeight: 1.5, marginBottom: 14, fontStyle: "italic", overflowWrap: "anywhere" }}>
                {block.identity}
              </div>
            ) : null}
          </>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <div style={{ fontFamily: T.serif, fontSize: 18, color: T.text, lineHeight: 1.2, overflowWrap: "anywhere", flex: 1 }}>
              {arcTitle}
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.gold, flexShrink: 0 }}>W{weekNum}/{weeksTotal}</span>
          </div>
        )}

        <button
          type="button"
          onClick={onFocusJourney}
          aria-label="View Arc journey"
          style={{
            width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer",
            textAlign: "left", fontFamily: T.font,
          }}
        >
          <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden", position: "relative" }}>
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
        </button>

        <div style={{
          display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap",
        }}>
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
          {!journeyFocused ? (
            <button type="button" onClick={onFocusJourney}
              style={{ padding: "7px 12px", borderRadius: 8, border: `0.5px solid rgba(200,144,42,0.35)`, background: "rgba(200,144,42,0.08)", color: T.gold, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font, marginLeft: "auto" }}>
              View journey →
            </button>
          ) : null}
        </div>

        {detailsOpen && children ? (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `0.5px solid ${T.border}` }}>
            {children}
          </div>
        ) : null}
      </div>

      {/* Progress beam into path */}
      <div style={{
        width: 2, height: journeyFocused ? 28 : 0, margin: "0 auto",
        background: `linear-gradient(180deg, ${T.gold}, transparent)`,
        transformOrigin: "top",
        animation: journeyFocused && !reducedMotion ? "arcHeroBeam 0.45s ease both" : undefined,
        opacity: journeyFocused ? 1 : 0,
        transition: reducedMotion ? undefined : "height 0.4s ease, opacity 0.3s ease",
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
  onShowAllEvidence,
  embedded = false,
}) {
  const railRef = useRef(null);
  const journeyRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const [weeklyBriefs, setWeeklyBriefs] = useState({});
  const [briefsLoading, setBriefsLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState(null);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [journeyFocused, setJourneyFocused] = useState(embedded ? true : false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedReceipt, setExpandedReceipt] = useState(null);

  const [ledgerRows, setLedgerRows] = useState(arcLedgerRows);

  useEffect(() => { setLedgerRows(arcLedgerRows); }, [arcLedgerRows]);

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
  const weeksTotal = timeline.weekCount;
  const progress = Math.min(1, Math.max(0, (dayNum - 1) / Math.max(1, duration)));

  const proofHabits = (habits || []).filter(h => h.habitType !== "log" && isProofHabitForBlock(h, block?.id));
  const proofDone = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const proofTotal = proofHabits.length;

  useEffect(() => {
    setSelectedWeek(initialWeek ?? currentWeek);
  }, [block?.id, initialWeek, currentWeek]);

  const scrollWeekIntoView = useCallback((weekNum) => {
    const el = railRef.current?.querySelector(`[data-week="${weekNum}"]`);
    el?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", inline: "center", block: "nearest" });
  }, [reducedMotion]);

  useEffect(() => {
    if (!selectedWeek || briefsLoading) return;
    const t = setTimeout(() => scrollWeekIntoView(selectedWeek), 100);
    return () => clearTimeout(t);
  }, [selectedWeek, briefsLoading, scrollWeekIntoView, block?.id, journeyFocused]);

  useEffect(() => {
    if (embedded) setJourneyFocused(true);
  }, [embedded]);

  const focusJourney = useCallback(() => {
    setJourneyFocused(true);
    requestAnimationFrame(() => {
      journeyRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      scrollWeekIntoView(selectedWeek ?? currentWeek);
    });
  }, [reducedMotion, scrollWeekIntoView, selectedWeek, currentWeek]);

  const selected = timeline.weeks.find(w => w.weekNum === selectedWeek) || timeline.weeks[currentWeek - 1];
  const isArcComplete = block.status !== "active";
  const trackWidth = (timeline.weeks.length + 1) * CHECKPOINT_W + 32;

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

  return (
    <div style={{ minWidth: 0, overflow: "hidden", maxWidth: "100%" }}>
      <style>{ARC_MOTION_CSS}</style>

      {isActive && !embedded ? (
        <ArcJourneyHero
          block={block}
          habits={habits}
          dayNum={dayNum}
          duration={duration}
          weekNum={currentWeek}
          weeksTotal={weeksTotal}
          daysLeft={daysLeft}
          progress={progress}
          proofDone={proofDone}
          proofTotal={proofTotal}
          journeyFocused={journeyFocused}
          onFocusJourney={focusJourney}
          onEditArc={onEditArc}
          onToggleDetails={(block.whyStatement || block.oldPattern || block.minimumProof) ? () => setDetailsOpen(v => !v) : null}
          detailsOpen={detailsOpen}
          reducedMotion={reducedMotion}
        >
          {detailsFields}
        </ArcJourneyHero>
      ) : null}

      <div ref={journeyRef} style={{ minWidth: 0, opacity: journeyFocused || embedded ? 1 : 0.55, transition: reducedMotion ? undefined : "opacity 0.4s ease" }}>
        {/* Start marker */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px 10px", minWidth: 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: T.gold, boxShadow: `0 0 12px ${T.gold}55` }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: T.gold }}>ARC BEGINS</div>
            <div style={{ fontSize: 11, color: T.muted }}>{block.startDate ? fmtEntryDate(block.startDate) : ""}</div>
          </div>
        </div>

        {/* Connected path — horizontal scroll only here */}
        <div
          ref={railRef}
          style={{
            overflowX: "auto",
            overflowY: "hidden",
            WebkitOverflowScrolling: "touch",
            scrollSnapType: "x mandatory",
            minWidth: 0,
            maxWidth: "100%",
            marginBottom: 0,
            paddingBottom: 4,
          }}
        >
          <div style={{ position: "relative", width: trackWidth, minHeight: PATH_H + 72, padding: "0 12px" }}>
            {/* Path line */}
            <svg
              style={{ position: "absolute", left: 24, top: 28, pointerEvents: "none" }}
              width={trackWidth - 48}
              height={12}
              aria-hidden
            >
              <line x1="0" y1="6" x2={trackWidth - 48} y2="6" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
              <line
                x1="0" y1="6"
                x2={Math.min(trackWidth - 48, ((currentWeek - 0.5) / timeline.weekCount) * (trackWidth - 48))}
                y2="6"
                stroke={T.gold}
                strokeWidth="2"
                strokeOpacity="0.55"
              />
            </svg>

            <div style={{ display: "flex", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
              {timeline.weeks.map((week, i) => (
                <PathCheckpoint
                  key={week.weekNum}
                  week={week}
                  selected={selectedWeek === week.weekNum}
                  onSelect={(w) => { setSelectedWeek(w); setBriefError(null); }}
                  reducedMotion={reducedMotion}
                  index={i}
                />
              ))}
              <FinishLineNode
                block={block}
                daysLeft={daysLeft}
                isComplete={isArcComplete}
              />
            </div>
          </div>
        </div>

        {/* Chapter stem + content */}
        <div style={{ display: "flex", gap: 0, minWidth: 0, padding: "8px 6px 0" }}>
          <div style={{ width: 20, flexShrink: 0, display: "flex", justifyContent: "center" }}>
            <div style={{
              width: 2, flex: 1, minHeight: 40,
              background: `linear-gradient(180deg, ${T.gold}88, rgba(200,144,42,0.15))`,
              borderRadius: 1,
            }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingBottom: 20 }}>
            <WeekChapter
              week={selected}
              weekKey={selected?.weekNum}
              generatingBrief={generatingBrief}
              onGenerateBrief={isActive ? handleGenerateBrief : null}
              briefError={briefError}
              reducedMotion={reducedMotion}
            />
          </div>
        </div>

        {/* Completed arc actions */}
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
      </div>

      {/* Archive utilities — visually separate */}
      {!embedded && unassigned.length > 0 ? (
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: `0.5px solid rgba(255,255,255,0.05)` }}>
          <button
            type="button"
            onClick={() => setShowUnassigned(v => !v)}
            style={{
              width: "100%", padding: "8px 0", background: "none", border: "none",
              color: T.hint, fontSize: 11.5, cursor: "pointer", fontFamily: T.font, textAlign: "left",
            }}
          >
            Earlier evidence · {unassigned.length} {showUnassigned ? "▾" : "▸"}
          </button>
          {showUnassigned ? (
            <>
              <p style={{ fontSize: 11, color: T.muted, margin: "8px 0 12px", lineHeight: 1.5 }}>
                These entries predate this Arc or fall outside its date range. They are not part of this journey.
              </p>
              {unassigned.slice(0, 15).map(e => (
                <ReceiptChip
                  key={e.date}
                  receipt={{ date: e.date, content: e.content }}
                  expanded={expandedReceipt === e.date}
                  onToggle={() => setExpandedReceipt(expandedReceipt === e.date ? null : e.date)}
                />
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {!embedded && onShowAllEvidence ? (
        <button
          type="button"
          onClick={onShowAllEvidence}
          style={{
            marginTop: 16, padding: "8px 0", background: "none", border: "none",
            color: T.hint, fontSize: 11.5, cursor: "pointer", fontFamily: T.font,
          }}
        >
          All activity & receipts →
        </button>
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
