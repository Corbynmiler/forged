// ─── ARC SCREEN ───────────────────────────────────────────────────────────────
// The Arc's home: full-screen Arc detail + Evidence (daily entries & activity)
// + Reviews (weekly Reviews & the Arc Story). Replaces Journal and Insights in
// primary navigation — both live here now, under one roof and one language.
import { useState, useEffect } from "react";
import { T } from "../theme.js";
import { supabase, rowToForgeBlock } from "../supabase.js";
import { parseLocal, isSatisfiedForTodayRing } from "../utils.js";
import { resolveArcTitle, arcDurationWeeksLabel } from "../arcProofMatch.js";
import { getArcDayNumber, getArcDurationDays, isProofHabitForBlock } from "../arcProgress.js";
import { JournalScreen } from "./JournalScreen.jsx";
import { InsightsScreen } from "./InsightsScreen.jsx";

const TABS = [
  { id: "arc",      label: "Arc" },
  { id: "evidence", label: "Evidence" },
  { id: "reviews",  label: "Reviews" },
];

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

function ArcDetail({ activeBlock, habits, onEditArc, onStartArc, isPro, userId, onUpgrade }) {
  const [pastArcs, setPastArcs] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("forge_blocks")
      .select("id, title, identity, status, start_date, end_date, duration_days, arc_rank, completion_score, review")
      .eq("user_id", userId)
      .neq("status", "active")
      .order("start_date", { ascending: false })
      .limit(12)
      .then(({ data }) => { if (!cancelled && data) setPastArcs(data.map(rowToForgeBlock)); });
    return () => { cancelled = true; };
  }, [userId]);

  const hasPast = (pastArcs || []).length > 0;

  if (!activeBlock?.id) {
    return (
      <div style={{ padding: "32px 24px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 14 }}>⚒️</div>
        <div style={{ fontFamily: T.serif, fontSize: 24, color: T.text, marginBottom: 10 }}>No Arc running</div>
        <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.7, marginBottom: 24 }}>
          An Arc is a finite season of change — a few weeks with a direction, a handful of proof
          actions, and an honest weekly Review.
        </div>
        {onStartArc && (
          <button type="button" onClick={onStartArc}
            style={{ padding: "13px 26px", borderRadius: T.rsm, border: "none", background: T.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
            Start an Arc
          </button>
        )}
        {hasPast && (
          <div style={{ marginTop: 32, textAlign: "left" }}>
            <PastArcsList pastArcs={pastArcs} isPro={isPro} onUpgrade={onUpgrade} />
          </div>
        )}
      </div>
    );
  }

  const duration = getArcDurationDays(activeBlock);
  const dayNum = getArcDayNumber(activeBlock);
  const weeksTotal = Math.max(1, Math.ceil(duration / 7));
  const weekNum = Math.min(weeksTotal, Math.max(1, Math.ceil(dayNum / 7)));
  const progress = Math.min(1, Math.max(0, (dayNum - 1) / Math.max(1, duration)));
  const arcTitle = resolveArcTitle(activeBlock.title, activeBlock.identity);
  const daysLeft = Math.max(0, duration - dayNum);

  const trackHabits = (habits || []).filter(h => h.habitType !== "log");
  const proofHabits = trackHabits.filter(h => isProofHabitForBlock(h, activeBlock.id));
  const proofDone = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;

  return (
    <div style={{ padding: "4px 14px 24px" }}>
      {/* Hero */}
      <div style={{
        padding: "18px 18px 16px", borderRadius: T.r,
        border: "0.5px solid rgba(200,144,42,0.4)",
        background: "linear-gradient(135deg, rgba(192,57,43,0.12) 0%, rgba(200,144,42,0.08) 45%, rgba(26,26,22,0.98) 100%)",
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
          {arcDurationWeeksLabel(duration)} · Week {weekNum} of {weeksTotal}
        </div>
        <div style={{ fontFamily: T.serif, fontSize: 26, color: T.text, lineHeight: 1.15, marginBottom: 10 }}>
          {arcTitle}
        </div>
        <div style={{ height: 4, borderRadius: 2, background: T.surface, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: `linear-gradient(90deg, ${T.accent}, ${T.gold})`, borderRadius: 2 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: T.muted }}>
          <span>Day {dayNum} of {duration}</span>
          <span>{daysLeft === 0 ? "Final day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}</span>
        </div>
      </div>

      {/* Identity fields */}
      <div style={{ padding: "16px 16px 4px", borderRadius: T.r, border: `0.5px solid ${T.border}`, background: T.surface, marginBottom: 14 }}>
        <FieldRow label="Direction" value={activeBlock.identity} accent={T.gold} />
        <FieldRow label="Why it matters" value={activeBlock.whyStatement} />
        <FieldRow label="Old pattern to weaken" value={activeBlock.oldPattern} accent={T.accent} />
        <FieldRow label="Bad-day minimum" value={activeBlock.minimumProof} accent={T.green} />
      </div>

      {/* Proof actions */}
      <div style={{ padding: "14px 16px", borderRadius: T.r, border: `0.5px solid ${T.border}`, background: T.surface, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Proof actions
          </div>
          <div style={{ fontSize: 11.5, color: T.muted }}>{proofDone} of {proofHabits.length} today</div>
        </div>
        {proofHabits.length === 0 ? (
          <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
            None linked yet — edit the Arc to add proof actions.
          </div>
        ) : proofHabits.map(h => {
          const done = isSatisfiedForTodayRing(h);
          return (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `0.5px solid ${T.border}` }}>
              <span style={{ fontSize: 12, color: done ? T.green : T.hint, width: 14, flexShrink: 0 }}>{done ? "✓" : "·"}</span>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{h.emoji || "•"}</span>
              <span style={{ flex: 1, fontSize: 13.5, color: done ? T.sub : T.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.name}
              </span>
            </div>
          );
        })}
      </div>

      {onEditArc && (
        <button type="button" onClick={onEditArc}
          style={{ width: "100%", padding: "12px 16px", borderRadius: T.rsm, border: `0.5px solid ${T.borderStrong}`, background: T.raised, color: T.text, fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: T.font, boxSizing: "border-box" }}>
          Edit my Arc
        </button>
      )}

      {hasPast && (
        <div style={{ marginTop: 22 }}>
          <PastArcsList pastArcs={pastArcs} isPro={isPro} onUpgrade={onUpgrade} />
        </div>
      )}
    </div>
  );
}

function fmtArcDates(block) {
  const f = ymd => {
    if (!ymd) return "";
    const d = parseLocal(ymd);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  return `${f(block.startDate)} – ${f(block.endDate)}`;
}

function PastArcsList({ pastArcs, isPro, onUpgrade }) {
  const [openId, setOpenId] = useState(null);
  if (!pastArcs?.length) return null;
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, padding: "0 2px" }}>
        Past Arcs
      </div>
      {!isPro ? (
        <button type="button" onClick={onUpgrade}
          style={{ width: "100%", padding: "13px 16px", borderRadius: T.rsm, border: `0.5px dashed ${T.borderStrong}`, background: T.surface, cursor: "pointer", textAlign: "left", fontFamily: T.font, boxSizing: "border-box" }}>
          <div style={{ fontSize: 13, color: T.text, fontWeight: 500, marginBottom: 2 }}>
            {pastArcs.length} past Arc{pastArcs.length === 1 ? "" : "s"} in your history
          </div>
          <div style={{ fontSize: 12, color: T.muted }}>Arc history and past Arc Stories are a <span style={{ color: T.gold, fontWeight: 600 }}>Pro</span> feature →</div>
        </button>
      ) : pastArcs.map(b => {
        const title = resolveArcTitle(b.title, b.identity);
        const open = openId === b.id;
        const story = (b.review || "").trim();
        return (
          <div key={b.id} style={{ borderRadius: T.rsm, border: `0.5px solid ${T.border}`, background: T.surface, marginBottom: 8, overflow: "hidden" }}>
            <button type="button" onClick={() => setOpenId(open ? null : b.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.font }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {fmtArcDates(b)} · {b.status === "completed" ? "completed" : b.status}
                  {b.arcRank ? ` · ${b.arcRank}` : ""}
                </div>
              </div>
              <span style={{ fontSize: 11, color: T.hint, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
            </button>
            {open ? (
              <div style={{ padding: "0 14px 13px" }}>
                {story ? (
                  <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{story}</div>
                ) : (
                  <div style={{ fontSize: 12.5, color: T.muted }}>No Arc Story was written for this one.</div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ArcScreen({
  tab = "arc", onTabChange,
  activeBlock, habits, goals, journalEntries,
  isPro, onUpgrade, userId, userName, coachName,
  onStartArc, onEditArc,
  // Evidence (JournalScreen) passthrough
  onReflect, onDeleteJournalLog, onSaveJournalEntry, onJournalGenerated,
  journalInitialTab, journalAutoGenerate, onJournalInitialComposeDone,
  // Reviews (InsightsScreen) passthrough
  completedArcBlock, onArcReviewComplete, onShowHistory, onShare,
}) {
  const [localTab, setLocalTab] = useState(tab);
  useEffect(() => { setLocalTab(tab); }, [tab]);
  const activeTab = localTab;
  function switchTab(id) {
    setLocalTab(id);
    onTabChange?.(id);
  }

  return (
    <div>
      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, padding: "2px 14px 10px" }}>
        {TABS.map(t => {
          const on = activeTab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => switchTab(t.id)}
              style={{
                flex: 1, padding: "8px 0", borderRadius: 18,
                border: `0.5px solid ${on ? "rgba(200,144,42,0.45)" : T.border}`,
                background: on ? "rgba(200,144,42,0.12)" : "none",
                color: on ? T.gold : T.muted, fontSize: 12.5, fontWeight: 600,
                cursor: "pointer", fontFamily: T.font, transition: "all 0.15s",
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "arc" && (
        <ArcDetail
          activeBlock={activeBlock}
          habits={habits}
          onEditArc={onEditArc}
          onStartArc={onStartArc}
          isPro={isPro}
          userId={userId}
          onUpgrade={onUpgrade}
        />
      )}

      {activeTab === "evidence" && (
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
      )}

      {activeTab === "reviews" && (
        <InsightsScreen
          habits={habits}
          goals={goals}
          journalEntries={journalEntries}
          activeBlock={activeBlock}
          completedArcBlock={completedArcBlock}
          onArcReviewComplete={onArcReviewComplete}
          onShowHistory={onShowHistory}
          onShare={onShare}
          isPro={isPro}
          onUpgrade={onUpgrade}
          userId={userId}
          userName={userName}
        />
      )}
    </div>
  );
}
