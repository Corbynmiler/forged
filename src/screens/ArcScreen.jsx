// ─── ARC SCREEN ───────────────────────────────────────────────────────────────
// Arc journey home: integrated hero + connected week path + chapter detail.
import { useState, useEffect } from "react";
import { T } from "../theme.js";
import { supabase, rowToForgeBlock } from "../supabase.js";
import { getCurrentArcWeek } from "../lib/arcTimeline.js";
import { ArcTimeline, ArcArchiveCard } from "../components/ArcTimeline.jsx";
import { JournalScreen } from "./JournalScreen.jsx";

function AllEvidencePanel({
  habits, goals, journalEntries, userId, isPro, onUpgrade, userName, coachName,
  activeBlock, onReflect, onDeleteJournalLog, onSaveJournalEntry, onJournalGenerated,
  journalInitialTab, journalAutoGenerate, onJournalInitialComposeDone, onClose,
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: T.bg, display: "flex", flexDirection: "column",
      paddingTop: "env(safe-area-inset-top, 0px)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 14px", borderBottom: `0.5px solid ${T.border}`, flexShrink: 0,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>All activity & receipts</div>
        <button type="button" onClick={onClose}
          style={{ padding: "6px 12px", borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.raised, color: T.text, fontSize: 13, cursor: "pointer", fontFamily: T.font }}>
          Done
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minWidth: 0 }}>
        <JournalScreen
          habits={habits}
          goals={goals}
          onReflect={onReflect}
          onDeleteJournalLog={onDeleteJournalLog}
          journalUserId={userId}
          isPro={isPro}
          onUpgrade={onUpgrade}
          journalEntries={journalEntries}
          onSaveJournalEntry={onSaveJournalEntry}
          onJournalGenerated={onJournalGenerated}
          initialTab={journalInitialTab}
          autoGenerateOnMount={journalAutoGenerate}
          onInitialComposeDone={onJournalInitialComposeDone}
          userName={userName}
          coachName={coachName}
          activeBlock={activeBlock}
        />
      </div>
    </div>
  );
}

function PastArcsSection({
  userId, isPro, onUpgrade, habits, goals, journalEntries, arcLedgerRows,
  userName, onRunItBack, onEvolve,
}) {
  const [pastArcs, setPastArcs] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("forge_blocks")
      .select("id, title, identity, status, start_date, end_date, duration_days, arc_rank, completion_score, review, why_statement, old_pattern, minimum_proof")
      .eq("user_id", userId)
      .neq("status", "active")
      .order("start_date", { ascending: false })
      .limit(12)
      .then(({ data }) => { if (!cancelled && data) setPastArcs(data.map(rowToForgeBlock)); });
    return () => { cancelled = true; };
  }, [userId]);

  if (!pastArcs?.length) return null;

  if (!isPro) {
    return (
      <div style={{ marginTop: 36, paddingTop: 24, borderTop: `0.5px solid rgba(255,255,255,0.05)` }}>
        <button type="button" onClick={onUpgrade}
          style={{ width: "100%", padding: "10px 2px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.font }}>
          <div style={{ fontSize: 12, color: T.muted }}>{pastArcs.length} past Arc{pastArcs.length === 1 ? "" : "s"} · <span style={{ color: T.gold }}>Pro</span> to expand →</div>
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 36, paddingTop: 24, borderTop: `0.5px solid rgba(255,255,255,0.05)` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.hint, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, padding: "0 2px" }}>
        Arc history
      </div>
      {pastArcs.map(block => {
        const expanded = expandedId === block.id;
        return (
          <ArcArchiveCard
            key={block.id}
            block={block}
            journalEntries={journalEntries}
            expanded={expanded}
            onToggle={() => setExpandedId(expanded ? null : block.id)}
          >
            <ArcTimeline
              block={block}
              habits={habits}
              goals={goals}
              journalEntries={journalEntries}
              arcLedgerRows={arcLedgerRows.filter(r => r.blockId === block.id || r.block_id === block.id)}
              userId={userId}
              userName={userName}
              isPro={isPro}
              isActive={false}
              embedded
              onRunItBack={onRunItBack}
              onEvolve={onEvolve}
            />
          </ArcArchiveCard>
        );
      })}
    </div>
  );
}

export function ArcScreen({
  tab = "arc", onTabChange,
  activeBlock, habits, goals, journalEntries, arcLedgerRows = [],
  isPro, onUpgrade, userId, userName, coachName,
  onStartArc, onEditArc, onRunItBack, onEvolve,
  onReflect, onDeleteJournalLog, onSaveJournalEntry, onJournalGenerated,
  journalInitialTab, journalAutoGenerate, onJournalInitialComposeDone,
}) {
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [initialWeek, setInitialWeek] = useState(null);

  useEffect(() => {
    if (tab === "evidence") {
      setShowAllEvidence(true);
      onTabChange?.("arc");
    } else if (tab === "reviews") {
      setInitialWeek(getCurrentArcWeek(activeBlock));
      onTabChange?.("arc");
    } else {
      setInitialWeek(null);
    }
  }, [tab, activeBlock?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeBlock?.id) {
    return (
      <div style={{ padding: "32px 24px 24px", textAlign: "center", minWidth: 0 }}>
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
        <PastArcsSection
          userId={userId} isPro={isPro} onUpgrade={onUpgrade}
          habits={habits} goals={goals} journalEntries={journalEntries}
          arcLedgerRows={arcLedgerRows} userName={userName}
          onRunItBack={onRunItBack} onEvolve={onEvolve}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: "4px 10px 32px", minWidth: 0, overflowX: "hidden", boxSizing: "border-box" }}>
      <ArcTimeline
        block={activeBlock}
        habits={habits}
        goals={goals}
        journalEntries={journalEntries}
        arcLedgerRows={arcLedgerRows}
        userId={userId}
        userName={userName}
        isPro={isPro}
        isActive
        onEditArc={onEditArc}
        initialWeek={initialWeek}
        onShowAllEvidence={() => setShowAllEvidence(true)}
      />

      <PastArcsSection
        userId={userId} isPro={isPro} onUpgrade={onUpgrade}
        habits={habits} goals={goals} journalEntries={journalEntries}
        arcLedgerRows={arcLedgerRows} userName={userName}
        onRunItBack={onRunItBack} onEvolve={onEvolve}
      />

      {showAllEvidence ? (
        <AllEvidencePanel
          habits={habits}
          goals={goals}
          journalEntries={journalEntries}
          userId={userId}
          isPro={isPro}
          onUpgrade={onUpgrade}
          userName={userName}
          coachName={coachName}
          activeBlock={activeBlock}
          onReflect={onReflect}
          onDeleteJournalLog={onDeleteJournalLog}
          onSaveJournalEntry={onSaveJournalEntry}
          onJournalGenerated={onJournalGenerated}
          journalInitialTab={journalInitialTab}
          journalAutoGenerate={journalAutoGenerate}
          onJournalInitialComposeDone={onJournalInitialComposeDone}
          onClose={() => setShowAllEvidence(false)}
        />
      ) : null}
    </div>
  );
}
