import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { T } from "../theme.js";
import { supabase } from "../supabase.js";
import { parseLocal, fmtEntryDate, stripJournalTitleLine } from "../utils.js";
import { resolveArcTitle, arcDurationWeeksLabel } from "../arcProofMatch.js";
import { getArcDayNumber, getArcDurationDays } from "../arcProgress.js";
import {
  buildArcTimeline,
  partitionJournalEntries,
  reviewTextFromBlock,
  ymdAddDays,
} from "../lib/arcTimeline.js";

const RECEIPT_KEYWORDS = ["Proof shown:", "Wins:", "Missed:", "Extras:", "Why:", "Pattern:", "Tomorrow:"];

function parseReceiptPreview(content) {
  if (!content?.trim()) return null;
  if (!RECEIPT_KEYWORDS.some(k => content.includes(k))) {
    return { title: stripJournalTitleLine(content.split("\n")[0] || ""), narrative: content.slice(0, 200) };
  }
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  const title = stripJournalTitleLine(lines[0] || "");
  let i = 1;
  const narrativeLines = [];
  while (i < lines.length && !RECEIPT_KEYWORDS.some(k => lines[i].startsWith(k))) {
    narrativeLines.push(lines[i]);
    i++;
  }
  return { title, narrative: narrativeLines.join(" ") };
}

function WeekProgressRing({ percent, size = 36, active }) {
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (p / 100) * c;
  const color = active ? T.gold : p >= 70 ? T.green : T.muted;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.surface} strokeWidth="3" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function WeekRailCard({ week, selected, onSelect }) {
  const isCurrent = week.status === "current";
  const isComplete = week.status === "complete";
  const muted = week.status === "upcoming";
  return (
    <button
      type="button"
      data-week={week.weekNum}
      onClick={() => onSelect(week.weekNum)}
      style={{
        flex: "0 0 auto",
        width: 108,
        scrollSnapAlign: "center",
        padding: "10px 8px",
        borderRadius: 12,
        border: `0.5px solid ${selected ? "rgba(200,144,42,0.55)" : isCurrent ? "rgba(200,144,42,0.35)" : T.border}`,
        background: selected ? "rgba(200,144,42,0.14)" : isCurrent ? "rgba(200,144,42,0.06)" : T.surface,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: T.font,
        opacity: muted ? 0.55 : 1,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: isCurrent ? T.gold : T.hint, letterSpacing: "0.08em" }}>
          WEEK {week.weekNum}
        </span>
        {isComplete && week.isGenuinelyComplete ? (
          <span style={{ fontSize: 11, color: T.green, fontWeight: 700 }}>✓</span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <WeekProgressRing percent={week.proofPercent} size={32} active={isCurrent || selected} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, color: T.text, fontWeight: 600, lineHeight: 1.25 }}>
            {week.evidenceDays}/{week.daysPossible || 7}
          </div>
          <div style={{ fontSize: 9, color: T.muted, lineHeight: 1.2 }}>evid. days</div>
        </div>
      </div>
      {week.verdict ? (
        <div style={{
          fontSize: 9.5, color: T.sub, marginTop: 6, lineHeight: 1.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {week.verdict}
        </div>
      ) : null}
    </button>
  );
}

function ReceiptRow({ receipt }) {
  const parsed = parseReceiptPreview(receipt.content);
  if (!parsed) return null;
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 10,
      border: `0.5px solid ${T.border}`, background: T.raised, marginBottom: 6,
    }}>
      <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>{fmtEntryDate(receipt.date)}</div>
      {parsed.title ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4, lineHeight: 1.35 }}>
          {parsed.title}
        </div>
      ) : null}
      {parsed.narrative ? (
        <div style={{
          fontSize: 12, color: T.sub, lineHeight: 1.55,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {parsed.narrative}
        </div>
      ) : null}
    </div>
  );
}

function WeekDetailPanel({
  week, block, isPro, onGenerateBrief, generatingBrief,
}) {
  if (!week) return null;
  const rangeLabel = `${fmtEntryDate(week.startDate)} – ${fmtEntryDate(week.endDate)}`;

  return (
    <div style={{
      padding: "14px 14px 16px",
      borderRadius: T.r,
      border: `0.5px solid ${week.status === "current" ? "rgba(200,144,42,0.4)" : T.border}`,
      background: week.status === "current" ? "rgba(200,144,42,0.05)" : T.surface,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Week {week.weekNum} · Days {week.dayStart}–{week.dayEnd}
          </div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 3 }}>{rangeLabel}</div>
        </div>
        {week.proofPercent != null ? (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{week.proofPercent}%</div>
            <div style={{ fontSize: 9, color: T.muted }}>proof</div>
          </div>
        ) : null}
      </div>

      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12, lineHeight: 1.5 }}>
        {week.evidenceDays} of {week.daysPossible} days evidenced
        {week.status === "current" ? " · in progress" : ""}
      </div>

      {week.briefText ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Weekly review
          </div>
          <div style={{ fontSize: 13, color: T.text, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
            {week.briefText}
          </div>
        </div>
      ) : week.status !== "upcoming" ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
            {week.status === "current" ? "No weekly review for this week yet." : "No review was generated for this week."}
          </div>
          {week.status === "current" && onGenerateBrief ? (
            <button
              type="button"
              disabled={generatingBrief}
              onClick={() => onGenerateBrief(week)}
              style={{
                padding: "8px 12px", borderRadius: 8, border: `0.5px solid ${T.borderStrong}`,
                background: T.raised, color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: T.font, opacity: generatingBrief ? 0.6 : 1,
              }}
            >
              {generatingBrief ? "Generating…" : "Generate weekly review"}
            </button>
          ) : null}
        </div>
      ) : null}

      {week.receipts?.length > 0 ? (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Daily evidence ({week.receipts.length})
          </div>
          {week.receipts.map(r => (
            <ReceiptRow key={r.date} receipt={r} />
          ))}
        </div>
      ) : week.status !== "upcoming" ? (
        <div style={{ fontSize: 12, color: T.muted, fontStyle: "italic" }}>No receipts this week yet.</div>
      ) : (
        <div style={{ fontSize: 12, color: T.muted }}>This week hasn&apos;t started.</div>
      )}
    </div>
  );
}

function CompletionNode({ block, onRunItBack, onEvolve, daysLeft, weeksLeft }) {
  const story = reviewTextFromBlock(block);
  const endLabel = block.endDate
    ? parseLocal(block.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <div style={{
      padding: "16px 14px",
      borderRadius: T.r,
      border: `0.5px solid rgba(200,144,42,0.35)`,
      background: "linear-gradient(180deg, rgba(200,144,42,0.08) 0%, rgba(26,26,22,0.98) 100%)",
      marginTop: 8,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
        Arc complete
      </div>
      {block.status === "active" ? (
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.55, marginBottom: 10 }}>
          {daysLeft > 0
            ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} · ${weeksLeft} week${weeksLeft === 1 ? "" : "s"} remaining`
            : "Final day of this Arc"}
          {endLabel ? ` · ends ${endLabel}` : ""}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 10 }}>
          {endLabel ? `Finished ${endLabel}` : "Arc finished"}
          {block.completionScore != null ? ` · ${Math.round(block.completionScore)}% proof` : ""}
        </div>
      )}
      {story ? (
        <div style={{ fontSize: 13, color: T.text, lineHeight: 1.65, whiteSpace: "pre-wrap", marginBottom: 12 }}>
          {story.slice(0, 400)}{story.length > 400 ? "…" : ""}
        </div>
      ) : block.status !== "active" ? (
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>Arc Story not written yet.</div>
      ) : null}
      {(onRunItBack || onEvolve) && block.status === "completed" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onRunItBack ? (
            <button type="button" onClick={onRunItBack}
              style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: T.gold, color: "#0F0F0D", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
              Run it back
            </button>
          ) : null}
          {onEvolve ? (
            <button type="button" onClick={onEvolve}
              style={{ padding: "9px 14px", borderRadius: 8, border: `0.5px solid ${T.borderStrong}`, background: T.raised, color: T.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
              Evolve
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ArcArchiveCard({ block, expanded, onToggle, timeline, children }) {
  const title = resolveArcTitle(block.title, block.identity);
  const start = block.startDate ? parseLocal(block.startDate).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
  const end = block.endDate ? parseLocal(block.endDate).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
  const weeks = Math.ceil((block.durationDays || 56) / 7);
  const story = reviewTextFromBlock(block);

  return (
    <div style={{ borderRadius: T.r, border: `0.5px solid ${T.border}`, background: T.surface, marginBottom: 10, overflow: "hidden" }}>
      <button type="button" onClick={onToggle}
        style={{
          width: "100%", padding: "14px 14px", background: "none", border: "none", cursor: "pointer",
          textAlign: "left", fontFamily: T.font, boxSizing: "border-box",
        }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          {block.status === "completed" ? "Completed Arc" : block.status}
        </div>
        <div style={{ fontFamily: T.serif, fontSize: 18, color: T.text, lineHeight: 1.2, marginBottom: 4, overflowWrap: "anywhere" }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: T.muted }}>
          {start} – {end} · {weeks} weeks
          {timeline?.evidenceDaysTotal != null ? ` · ${timeline.evidenceDaysTotal} evidence days` : ""}
          {block.completionScore != null ? ` · ${Math.round(block.completionScore)}%` : ""}
        </div>
        {story && !expanded ? (
          <div style={{ fontSize: 12, color: T.sub, marginTop: 6, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {story.split("\n")[0]}
          </div>
        ) : null}
      </button>
      {expanded ? <div style={{ padding: "0 10px 14px" }}>{children}</div> : null}
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
  showAllEvidence = false,
  onShowAllEvidence,
}) {
  const railRef = useRef(null);
  const [weeklyBriefs, setWeeklyBriefs] = useState({});
  const [briefsLoading, setBriefsLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [expandedArchiveId, setExpandedArchiveId] = useState(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState(null);
  const [showUnassigned, setShowUnassigned] = useState(false);

  const [ledgerRows, setLedgerRows] = useState(arcLedgerRows);

  useEffect(() => {
    setLedgerRows(arcLedgerRows);
  }, [arcLedgerRows]);

  const { inArc: journalInArc, unassigned } = useMemo(
    () => partitionJournalEntries(block, journalEntries),
    [block, journalEntries],
  );

  // Past Arcs: ledger may not be in parent state — fetch for this block.
  useEffect(() => {
    if (isActive || !block?.id || arcLedgerRows.length > 0) return;
    let cancelled = false;
    supabase
      .from("arc_daily_scores")
      .select("*")
      .eq("block_id", block.id)
      .order("date")
      .then(({ data }) => {
        if (cancelled || !data) return;
        setLedgerRows(data.map(r => ({
          date: r.date,
          proofTotal: r.proof_total,
          proofDone: r.proof_done,
          blockId: r.block_id,
        })));
      });
    return () => { cancelled = true; };
  }, [isActive, block?.id, arcLedgerRows.length]);

  useEffect(() => {
    if (!userId || !block?.startDate) {
      setBriefsLoading(false);
      return;
    }
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
          if (row.week_start && row.brief_text) {
            map[row.week_start] = { text: row.brief_text, generatedAt: row.brief_generated_at };
          }
        }
        setWeeklyBriefs(map);
      } catch { /* non-fatal */ }
      finally {
        if (!cancelled) setBriefsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, block?.id, block?.startDate, block?.durationDays]);

  const timeline = useMemo(() => buildArcTimeline(block, {
    arcLedgerRows: ledgerRows,
    journalEntries: journalInArc,
    weeklyBriefsByWeekStart: weeklyBriefs,
  }), [block, ledgerRows, journalInArc, weeklyBriefs]);

  const currentWeek = timeline.currentWeek;

  useEffect(() => {
    const w = initialWeek ?? currentWeek;
    setSelectedWeek(w);
  }, [block?.id, initialWeek, currentWeek]);

  const scrollWeekIntoView = useCallback((weekNum) => {
    const el = railRef.current?.querySelector(`[data-week="${weekNum}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, []);

  useEffect(() => {
    if (!selectedWeek || briefsLoading) return;
    const t = setTimeout(() => scrollWeekIntoView(selectedWeek), 80);
    return () => clearTimeout(t);
  }, [selectedWeek, briefsLoading, scrollWeekIntoView, block?.id]);

  const selected = timeline.weeks.find(w => w.weekNum === selectedWeek) || timeline.weeks[currentWeek - 1];

  const duration = getArcDurationDays(block);
  const dayNum = getArcDayNumber(block);
  const daysLeft = Math.max(0, duration - dayNum);
  const weeksLeft = Math.max(0, timeline.weekCount - currentWeek);

  async function handleGenerateBrief(week) {
    if (!userId || generatingBrief) return;
    setGeneratingBrief(true);
    setBriefError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const clientDate = week.endDate;
      const res = await fetch("/api/weekly-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          habits,
          goals,
          journalEntries,
          name: (userName || "").trim() || "there",
          client_date: clientDate,
          ...(isActive && block?.id ? { activeBlock: block } : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not generate review");
      if (payload.text && week.briefWeekStart) {
        setWeeklyBriefs(prev => ({
          ...prev,
          [week.briefWeekStart]: { text: payload.text, generatedAt: new Date().toISOString() },
        }));
      }
    } catch (err) {
      setBriefError(err.message || "Generation failed");
    } finally {
      setGeneratingBrief(false);
    }
  }

  if (!block?.id) return null;

  return (
    <div style={{ minWidth: 0, overflow: "hidden" }}>
      {/* Start node */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "0 4px 12px", minWidth: 0 }}>
        <div style={{ width: 10, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.gold, marginTop: 4 }} />
          <div style={{ flex: 1, width: 1, minHeight: 12, background: T.border, marginTop: 4 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.1em", textTransform: "uppercase" }}>Start</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {block.startDate ? fmtEntryDate(block.startDate) : ""}
            {block.identity ? ` · ${block.identity}` : ""}
          </div>
        </div>
      </div>

      {/* Horizontal week rail — isolated scroll */}
      <div
        ref={railRef}
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          scrollSnapType: "x mandatory",
          padding: "4px 4px 14px",
          marginBottom: 4,
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        {timeline.weeks.map(week => (
          <WeekRailCard
            key={week.weekNum}
            week={week}
            selected={selectedWeek === week.weekNum}
            onSelect={setSelectedWeek}
          />
        ))}
      </div>

      {/* Vertical path + selected week detail */}
      <div style={{ display: "flex", gap: 10, minWidth: 0, padding: "0 4px" }}>
        <div style={{ width: 10, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 1, flex: 1, minHeight: 24, background: `linear-gradient(180deg, ${T.gold}55, ${T.border})` }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <WeekDetailPanel
            week={selected}
            block={block}
            isPro={isPro}
            onGenerateBrief={isActive ? handleGenerateBrief : null}
            generatingBrief={generatingBrief}
          />
          {briefError ? (
            <div style={{ fontSize: 11, color: T.accent, marginTop: 8 }}>{briefError}</div>
          ) : null}
        </div>
      </div>

      {/* Completion destination */}
      <div style={{ padding: "0 4px", minWidth: 0 }}>
        <CompletionNode
          block={block}
          daysLeft={daysLeft}
          weeksLeft={weeksLeft}
          onRunItBack={onRunItBack}
          onEvolve={onEvolve}
        />
      </div>

      {unassigned.length > 0 ? (
        <div style={{ marginTop: 16, padding: "0 4px" }}>
          <button
            type="button"
            onClick={() => setShowUnassigned(v => !v)}
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 10,
              border: `0.5px dashed ${T.borderStrong}`, background: "transparent",
              color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: T.font, textAlign: "left",
            }}
          >
            {showUnassigned ? "▾" : "▸"} Earlier / unassigned evidence ({unassigned.length})
          </button>
          {showUnassigned ? (
            <div style={{ marginTop: 8 }}>
              {unassigned.slice(0, 20).map(e => (
                <ReceiptRow key={e.date} receipt={{ date: e.date, content: e.content }} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {onShowAllEvidence ? (
        <button
          type="button"
          onClick={onShowAllEvidence}
          style={{
            marginTop: 14, width: "100%", padding: "11px 14px", borderRadius: T.rsm,
            border: `0.5px solid ${T.border}`, background: T.surface,
            color: T.muted, fontSize: 12.5, fontWeight: 500, cursor: "pointer", fontFamily: T.font,
          }}
        >
          All activity & receipts →
        </button>
      ) : null}
    </div>
  );
}

export { ArcArchiveCard };
