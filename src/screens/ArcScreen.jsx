// ─── ARC SCREEN ───────────────────────────────────────────────────────────────
// Continuous Arc journey: neutral evidence chapters, completed Arcs, active Arc.
import { useState, useEffect, useMemo } from "react";
import { T } from "../theme.js";
import { supabase, rowToForgeBlock } from "../supabase.js";
import { buildLifeChronology, getCurrentArcWeek, partitionJournalEntries } from "../lib/arcTimeline.js";
import { ArcTimeline, LifeArcHistory } from "../components/ArcTimeline.jsx";

const BLOCK_SELECT = "id, title, identity, status, start_date, end_date, duration_days, arc_rank, completion_score, review, why_statement, old_pattern, minimum_proof";

export function ArcScreen({
  tab = "arc", onTabChange,
  activeBlock, habits, goals, journalEntries, arcLedgerRows = [],
  isPro, onUpgrade, userId, userName,
  onStartArc, onEditArc, onRunItBack, onEvolve,
}) {
  const [initialWeek, setInitialWeek] = useState(null);
  const [openChronology, setOpenChronology] = useState(false);
  const [allBlocks, setAllBlocks] = useState(null);

  useEffect(() => {
    if (!userId) { setAllBlocks([]); return; }
    let cancelled = false;
    supabase
      .from("forge_blocks")
      .select(BLOCK_SELECT)
      .eq("user_id", userId)
      .order("start_date", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setAllBlocks((data || []).map(rowToForgeBlock));
      });
    return () => { cancelled = true; };
  }, [userId, activeBlock?.id, activeBlock?.status]);

  useEffect(() => {
    if (tab === "evidence") {
      setOpenChronology(true);
      onTabChange?.("arc");
    } else if (tab === "reviews") {
      setInitialWeek(getCurrentArcWeek(activeBlock));
      onTabChange?.("arc");
    } else if (tab !== "arc") {
      setInitialWeek(null);
      setOpenChronology(false);
    }
  }, [tab, activeBlock?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocksForLife = useMemo(() => {
    if (!allBlocks) {
      return activeBlock?.id ? [activeBlock] : [];
    }
    if (activeBlock?.id && !allBlocks.some(b => b.id === activeBlock.id)) {
      return [...allBlocks, activeBlock].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
    }
    return allBlocks;
  }, [allBlocks, activeBlock]);

  const life = useMemo(
    () => buildLifeChronology({ blocks: blocksForLife, journalEntries }),
    [blocksForLife, journalEntries],
  );

  const historySegments = useMemo(
    () => life.segments.filter(s => s.type !== "active-arc"),
    [life.segments],
  );

  const currentBlock = life.activeBlock || activeBlock;
  const journalInArc = useMemo(() => {
    if (!currentBlock?.id) return [];
    return partitionJournalEntries(currentBlock, journalEntries).inArc;
  }, [currentBlock, journalEntries]);

  const historyProps = {
    segments: historySegments,
    habits,
    goals,
    journalEntries,
    arcLedgerRows,
    userId,
    userName,
    isPro,
    onUpgrade,
    onRunItBack,
    onEvolve,
  };

  if (!currentBlock?.id) {
    return (
      <div style={{ padding: "32px 24px 24px", textAlign: "center", minWidth: 0, overflowX: "hidden" }}>
        {historySegments.length > 0 ? (
          <div style={{ textAlign: "left", marginBottom: 28, padding: "0 2px" }}>
            <LifeArcHistory {...historyProps} />
          </div>
        ) : null}
        <div style={{ fontSize: 40, marginBottom: 14 }}>⚒️</div>
        <div style={{ fontFamily: T.serif, fontSize: 26, color: T.text, marginBottom: 8, lineHeight: 1.2 }}>
          What season are you in?
        </div>
        <div style={{ fontSize: 15, color: T.gold, fontWeight: 600, marginBottom: 14 }}>Define your Arc</div>
        <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.7, marginBottom: 24, textAlign: "left", maxWidth: 320, margin: "0 auto 24px" }}>
          Choose a real outcome or deadline. Commit for a bounded period. Collect proof as you go — your coach will help shape it in a short conversation.
        </div>
        {onStartArc ? (
          <button type="button" onClick={onStartArc}
            style={{ padding: "14px 28px", borderRadius: T.rsm, border: "none", background: T.gold, color: "#0F0F0D", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
            Define your Arc →
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ padding: "4px 10px 32px", minWidth: 0, overflowX: "hidden", boxSizing: "border-box" }}>
      {historySegments.length > 0 ? <LifeArcHistory {...historyProps} /> : null}

      <ArcTimeline
        block={currentBlock}
        habits={habits}
        goals={goals}
        journalEntries={journalInArc}
        chronologyJournalEntries={journalEntries}
        arcLedgerRows={arcLedgerRows}
        userId={userId}
        userName={userName}
        isPro={isPro}
        isActive
        onEditArc={onEditArc}
        initialWeek={initialWeek}
        openChronologyOnMount={openChronology}
      />
    </div>
  );
}
