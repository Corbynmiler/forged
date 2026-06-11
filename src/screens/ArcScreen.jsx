// ─── ARC SCREEN ───────────────────────────────────────────────────────────────
// Arc journey home: hero + week-by-week timeline (evidence + reviews per week).
// Legacy Evidence/Reviews tabs replaced by the timeline; full activity remains
// behind an optional disclosure.
import { useState, useEffect } from "react";
import { T } from "../theme.js";
import { supabase, rowToForgeBlock } from "../supabase.js";
import { isSatisfiedForTodayRing } from "../utils.js";
import { resolveArcTitle, arcDurationWeeksLabel } from "../arcProofMatch.js";
import { getArcDayNumber, getArcDurationDays, isProofHabitForBlock } from "../arcProgress.js";
import { getCurrentArcWeek } from "../lib/arcTimeline.js";
import { ArcTimeline, ArcArchiveCard } from "../components/ArcTimeline.jsx";
import { JournalScreen } from "./JournalScreen.jsx";

function FieldRow({ label, value, accent }) {
  const v = String(value || "").trim();
  if (!v) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: accent || T.hint, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: T.text, lineHeight: 1.55, minWidth: 0, overflowWrap: "break-word", wordBreak: "break-word" }}>{v}</div>
    </div>
  );
}

function ArcHero({ activeBlock, onEditArc }) {
  const duration = getArcDurationDays(activeBlock);
  const dayNum = getArcDayNumber(activeBlock);
  const weeksTotal = Math.max(1, Math.ceil(duration / 7));
  const weekNum = getCurrentArcWeek(activeBlock);
  const progress = Math.min(1, Math.max(0, (dayNum - 1) / Math.max(1, duration)));
  const arcTitle = resolveArcTitle(activeBlock.title, activeBlock.identity);
  const daysLeft = Math.max(0, duration - dayNum);

  return (
    <div style={{
      padding: "16px 16px 14px", borderRadius: T.r,
      border: "0.5px solid rgba(200,144,42,0.4)",
      background: "linear-gradient(135deg, rgba(192,57,43,0.10) 0%, rgba(200,144,42,0.06) 45%, rgba(26,26,22,0.98) 100%)",
      marginBottom: 16,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
        {arcDurationWeeksLabel(duration)} · Week {weekNum} of {weeksTotal}
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 24, color: T.text, lineHeight: 1.15, marginBottom: 6, overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {arcTitle}
      </div>
      {activeBlock.identity ? (
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 10, fontStyle: "italic", overflowWrap: "anywhere" }}>
          {activeBlock.identity}
        </div>
      ) : null}
      <div style={{ height: 4, borderRadius: 2, background: T.surface, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: `linear-gradient(90deg, ${T.accent}, ${T.gold})`, borderRadius: 2 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, color: T.muted, gap: 8, flexWrap: "wrap" }}>
        <span>Day {dayNum} of {duration}</span>
        <span>{daysLeft === 0 ? "Final day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</span>
      </div>
      {onEditArc ? (
        <button
          type="button"
          onClick={onEditArc}
          style={{
            marginTop: 12, padding: "8px 14px", borderRadius: 8,
            border: `0.5px solid ${T.borderStrong}`, background: T.raised,
            color: T.sub, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font,
          }}
        >
          Edit Arc
        </button>
      ) : null}
    </div>
  );
}

function ProofActionsSummary({ activeBlock, habits }) {
  const proofHabits = (habits || []).filter(h => h.habitType !== "log" && isProofHabitForBlock(h, activeBlock.id));
  const proofDone = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  if (!proofHabits.length) return null;
  return (
    <div style={{
      padding: "12px 14px", borderRadius: T.rsm, border: `0.5px solid ${T.border}`,
      background: T.surface, marginBottom: 16, fontSize: 12.5, color: T.muted,
    }}>
      <span style={{ color: T.text, fontWeight: 600 }}>{proofDone}/{proofHabits.length}</span> proof actions logged today
    </div>
  );
}

function IdentityDisclosure({ activeBlock }) {
  const [open, setOpen] = useState(false);
  const hasExtra = activeBlock.whyStatement || activeBlock.oldPattern || activeBlock.minimumProof;
  if (!hasExtra) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 10,
          border: `0.5px solid ${T.border}`, background: T.surface,
          color: T.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font, textAlign: "left",
        }}
      >
        {open ? "▾" : "▸"} Arc details
      </button>
      {open ? (
        <div style={{ padding: "14px 14px 4px", borderRadius: T.r, border: `0.5px solid ${T.border}`, borderTop: "none", marginTop: -4, background: T.raised }}>
          <FieldRow label="Why it matters" value={activeBlock.whyStatement} />
          <FieldRow label="Old pattern" value={activeBlock.oldPattern} accent={T.accent} />
          <FieldRow label="Bad-day minimum" value={activeBlock.minimumProof} accent={T.green} />
        </div>
      ) : null}
    </div>
  );
}

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
      <div style={{ marginTop: 24 }}>
        <button type="button" onClick={onUpgrade}
          style={{ width: "100%", padding: "13px 16px", borderRadius: T.rsm, border: `0.5px dashed ${T.borderStrong}`, background: T.surface, cursor: "pointer", textAlign: "left", fontFamily: T.font }}>
          <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{pastArcs.length} past Arc{pastArcs.length === 1 ? "" : "s"}</div>
          <div style={{ fontSize: 12, color: T.muted }}>Full Arc history is a <span style={{ color: T.gold, fontWeight: 600 }}>Pro</span> feature →</div>
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, padding: "0 4px" }}>
        Arc history
      </div>
      {pastArcs.map(block => {
        const expanded = expandedId === block.id;
        return (
          <ArcArchiveCard
            key={block.id}
            block={block}
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
  completedArcBlock,
}) {
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [initialWeek, setInitialWeek] = useState(null);

  // Legacy deep-links: evidence/reviews tabs → timeline or full evidence panel
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
      <ArcHero activeBlock={activeBlock} onEditArc={onEditArc} />
      <ProofActionsSummary activeBlock={activeBlock} habits={habits} />
      <IdentityDisclosure activeBlock={activeBlock} />

      <div style={{ fontSize: 10, fontWeight: 800, color: T.hint, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10, padding: "0 4px" }}>
        Your path
      </div>

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
