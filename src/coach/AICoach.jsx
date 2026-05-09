import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { T, COACH_ICON_OPTIONS, WEEKLY_SUMMARY_TTL_MS, CREATOR_ID, HABIT_TYPES, XP_LEVELS, COLORS, DAYS, MONTHS } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, daysAgo, parseLocal, fmtDate, fmtEntryDate, fmtWeekRange,
  currentWeekStart, weekStartFor,
  getStreak, getWeeklyCount, isSatisfiedForTodayRing,
  getGoalProgress, goalBarFillWidthPct, getGoalPacing, fmtGoalDueHuman,
  getProgressStats, getProjectStats, getBuildDayMinutes, getLimitDayTotal,
  getLatestValue, formatWithUnit,
  inferProgressDirection, isLegacyProgressType,
  mergedLast7, clientRowMeta, clientInsightLine, buildSessionBrief,
  coachGreetingForNow,
  COACH_NUDGE_DURATION_MS, COACH_SUMMARY_UUID_RE,
  splitCoachReceipt, parseGoalPlan, stripPartialGoalPlan,
  loadJournalMissedMap, saveJournalMissedMap,
  getHabitCardStreakSuffix, truncateText,
} from "../utils.js";
import { Modal, GBtn, PBtn, FG, lbl, inp } from "../components/ui.jsx";
import { useSpeechInput, MicBtn, mergeDictationIntoText, polishInterimDisplay } from "../hooks/useSpeechInput.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";
import { buildDemoHabits } from "../screens/OnboardingScreen.jsx";

export function CoachBar({ coachName, coachIcon, habitColor, onOpenMic, onOpenText, coachEverOpened, isListening = false, listeningInterim = "" }) {
  const coachLabelRaw = (coachName ?? "").trim() || "Coach";
  const micColor = habitColor || T.accent;
  const initial = coachLabelRaw.charAt(0).toUpperCase();
  // When listening: mic button glows red with a pulsing animation to signal recording
  const micBg = isListening
    ? `linear-gradient(145deg, #E74C3C88 0%, #E74C3C55 55%, #C0392B 100%)`
    : `linear-gradient(145deg, ${micColor}35 0%, ${micColor}12 55%, ${T.raised} 100%)`;
  const micBorderColor = isListening ? "#E74C3Ccc" : `${micColor}88`;
  const micIconColor = isListening ? "#ff6b6b" : micColor;
  return (
    <div
      data-tour="coach-fab"
      style={{
        position:"relative",
        display:"flex", alignItems:"center",
        minHeight:52,
        padding:"8px 10px",
        background:T.surface,
        borderTop:`0.5px solid ${isListening ? "#E74C3C55" : T.border}`,
        borderRadius:20,
        boxShadow: isListening
          ? "0 -4px 24px rgba(231,76,60,0.28)"
          : "0 -4px 20px rgba(0,0,0,0.35)",
        fontFamily:T.font,
        transition:"box-shadow 0.2s, border-top-color 0.2s",
      }}
    >
      <div style={{ flex:1, display:"flex", justifyContent:"flex-start", alignItems:"center", minWidth:0 }}>
        {/* Fixed-width column: icon left-aligned above left-aligned wrapped name. */}
        <div style={{
          display:"flex", flexDirection:"column", alignItems:"flex-start", gap:4,
          width:128, flexShrink:0,
        }}
        >
          <div
            style={{
              width:28, height:28, borderRadius:"50%",
              background:`${micColor}18`,
              border:`1px solid ${micColor}66`,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:14, lineHeight:1, flexShrink:0,
            }}
            aria-hidden
          >
            {coachIcon && COACH_ICON_OPTIONS.includes(coachIcon) ? coachIcon : initial}
          </div>
          <div
            title={!isListening ? coachLabelRaw : undefined}
            style={{
              fontSize:9, fontWeight:600,
              color: isListening ? "#E74C3C" : T.muted,
              textAlign:"left", lineHeight:1.25,
              width:"100%", minWidth:0,
              wordBreak:"break-word", overflowWrap:"anywhere", hyphens:"auto",
              transition:"color 0.2s",
            }}
          >
            {isListening ? "Listening…" : coachLabelRaw}
          </div>
        </div>
        {/* Interim transcript shown while listening */}
        {isListening && listeningInterim && (
          <span style={{
            fontSize:12, color:T.sub, fontStyle:"italic",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            maxWidth:"calc(100% - 72px)", marginLeft:4,
          }}>
            "{listeningInterim}"
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenMic}
        aria-label={isListening ? "Stop listening" : `${coachLabelRaw} — voice`}
        title={isListening ? "Stop" : "Voice"}
        style={{
          position:"absolute", left:"50%", top:"50%", transform:"translate(-50%, -50%)",
          width:52, height:52, borderRadius:"50%",
          border:`1px solid ${micBorderColor}`,
          background:micBg,
          color:micIconColor,
          cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow: isListening
            ? `0 0 0 3px rgba(231,76,60,0.2), 0 2px 12px rgba(0,0,0,0.35)`
            : `0 2px 12px rgba(0,0,0,0.35)`,
          animation: isListening
            ? "coachFabPulse 1s ease-in-out infinite"
            : coachEverOpened ? undefined : "coachFabPulse 2.4s ease-in-out infinite",
          transition:"background 0.2s, border-color 0.2s, box-shadow 0.2s, color 0.2s",
        }}
      >
        {isListening ? (
          /* Stop icon while recording */
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor"/>
          </svg>
        ) : (
          /* Mic icon at rest */
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M8 11v1a4 4 0 0 0 8 0v-1M12 18v2M9 22h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        )}
      </button>
      <div style={{ flex:1, display:"flex", justifyContent:"flex-end", alignItems:"center" }}>
        <button
          type="button"
          onClick={onOpenText}
          aria-label={`${coachLabelRaw} — type`}
          title="Type"
          style={{
            width:32, height:32, borderRadius:10,
            border:`0.5px solid ${T.borderStrong}`,
            background:T.raised,
            color:T.sub,
            cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
function TodayScreen({ habits, goals = [], xp, onTap, onUndo, onSkip, onAddNote, onLogZero, onOpenLog, onOpenGoalLog, onEditGoal, onCompleteGoal, onDeleteGoal, onShareGoal, onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId, onXPInfo, onAdd, onSaveLogEntry, hideFloatingAdd, coachEverOpened = true, onOpenCoachMic, coachName, coachIcon, coachHabitColor, onOpenGoalDetail }) {
  const activeGoals = goals.filter(g => g.status !== "completed");
  const trackHabits = habits.filter(h => h.habitType !== "log");
  const logHabits = habits.filter(h => h.habitType === "log");
  const loggedCount = trackHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const totalTrackables = trackHabits.length;
  const pct = totalTrackables ? Math.round((loggedCount / totalTrackables) * 100) : 0;
  const hr = new Date().getHours();
  const greeting = hr < 12 ? "Rise and forge." : hr < 17 ? "Keep the heat up." : "Finish strong.";
  const level = getLevel(xp);
  const daily   = habits.filter(h => h.habitType === "daily");
  const limit   = habits.filter(h => h.habitType === "limit");
  const weekly  = habits.filter(h => h.habitType === "weekly");
  const project = habits.filter(h => h.habitType === "project");
  const ringSummary = totalTrackables
    ? `${loggedCount} of ${totalTrackables} logged`
    : logHabits.length
      ? "Logs below — ring is for habits & goals"
      : "";
  if (habits.length === 0 && activeGoals.length === 0) return (
    <div>
      {onOpenCoachMic && (
        <CoachGreeting
          coachName={coachName}
          coachIcon={coachIcon}
          habits={habits}
          goals={goals}
          habitAccent={coachHabitColor}
          onOpenMic={onOpenCoachMic}
        />
      )}
      <div style={{ padding:"40px 28px 32px", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚒️</div>
        <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:10 }}>Nothing forged yet.</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:28 }}>
          Add a habit to track daily, or tell the coach what outcome you're working toward — it will help you build a plan.
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <button onClick={onAdd} style={{ padding:"13px 24px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>
            Add a habit
          </button>
          {onOpenCoachMic && (
            <button onClick={onOpenCoachMic}
              style={{ padding:"13px 24px", borderRadius:T.rsm, border:"0.5px solid rgba(200,144,42,0.5)", background:"rgba(200,144,42,0.08)", color:T.gold, fontSize:14, fontWeight:600, cursor:"pointer" }}>
              ✨ Plan a goal with my coach
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const showCoachNudge = habits.length > 0 && !coachEverOpened;

  return (
    <div>
      {showCoachNudge && (
        <button
          type="button"
          onClick={onOpenCoachMic}
          style={{
            display:"flex", alignItems:"center", gap:8,
            width:"calc(100% - 28px)", margin:"6px 14px 0",
            padding:"9px 12px",
            background:"linear-gradient(90deg, rgba(200,144,42,0.14), rgba(200,144,42,0.04))",
            border:"0.5px solid rgba(200,144,42,0.35)",
            borderRadius:T.rsm,
            color:T.gold, fontSize:12, fontWeight:600,
            cursor:"pointer", textAlign:"left",
            fontFamily:T.font,
          }}
        >
          <span aria-hidden style={{ fontSize:14, lineHeight:1 }}>✨</span>
          <span style={{ color:T.sub, fontWeight:500, flex:1, lineHeight:1.35 }}>
            Your coach reads your logs and notes — <span style={{ color:T.gold, fontWeight:700 }}>tap to ask</span> what it's already noticed.
          </span>
        </button>
      )}
      {onOpenCoachMic && (
        <CoachGreeting
          coachName={coachName}
          coachIcon={coachIcon}
          habits={habits}
          goals={goals}
          habitAccent={coachHabitColor}
          onOpenMic={onOpenCoachMic}
        />
      )}
      <div data-tour="today-summary" style={{ margin:"6px 14px 16px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"18px 20px", display:"flex", alignItems:"center", gap:18 }}>
        <Ring pct={pct}/>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:4 }}>{pct === 100 && totalTrackables > 0 ? "Forged for today." : greeting}</div>
          <div style={{ fontSize:13, color:T.muted }}>{ringSummary || " "}</div>
          <button onClick={onXPInfo} style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:12, background:"rgba(200,144,42,0.15)", color:T.gold, border:"none", cursor:"pointer" }}>
            ⚡ {xp} xp · {level.label}
          </button>
        </div>
      </div>
      {/* Tour target: wraps only the first non-empty section so the spotlight ring is tight */}
      {(() => {
        const sections = [
          activeGoals.length > 0
            ? <><SLabel>Goals</SLabel> {activeGoals.map(g => <TodayGoalCard key={g.id} goal={g} onOpenLog={onOpenGoalLog} onEdit={onEditGoal} onComplete={onCompleteGoal} onDelete={onDeleteGoal} onShareGoal={onShareGoal} onOpen={onOpenGoalDetail}/>)}</>
            : habits.length > 0 && onOpenCoachMic && (
              // No goals yet but has habits — invite them to plan toward an outcome
              <div key="goal-cta">
                <SLabel>Goals</SLabel>
                <button
                  type="button"
                  onClick={onOpenCoachMic}
                  style={{
                    display:"flex", alignItems:"center", gap:14,
                    margin:"0 14px 10px", width:"calc(100% - 28px)",
                    padding:"14px 16px", borderRadius:T.r,
                    border:"0.5px dashed rgba(200,144,42,0.4)",
                    background:"rgba(200,144,42,0.04)",
                    cursor:"pointer", textAlign:"left",
                  }}
                >
                  <div style={{ width:38, height:38, borderRadius:11, background:"rgba(200,144,42,0.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎯</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:2 }}>Set a goal with your coach</div>
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.45 }}>
                      Tell the AI what outcome you're working toward — it'll help you plan milestones and track progress.
                    </div>
                  </div>
                  <div style={{ fontSize:16, color:T.gold, flexShrink:0 }}>→</div>
                </button>
              </div>
            ),
          daily.length   > 0 && <><SLabel>Daily</SLabel>          {daily.map(h   => <DailyCard  key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          limit.length   > 0 && <><SLabel>Limits</SLabel>         {limit.map(h   => <LimitCard  key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          weekly.length  > 0 && <><SLabel>Weekly targets</SLabel> {weekly.map(h  => <WeeklyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          project.length > 0 && <><SLabel>Build</SLabel>          {project.map(h => <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId === h.id}/>)}</>,
          logHabits.length > 0 && onSaveLogEntry && <><SLabel>Logs</SLabel> {logHabits.map(h => <LogCard key={h.id} habit={h} onSaveEntry={onSaveLogEntry} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit}/>)}</>,
        ].filter(Boolean);
        return sections.map((sec, i) =>
          i === 0
            ? <div key={i} data-tour="today-first-section">{sec}</div>
            : <div key={i}>{sec}</div>
        );
      })()}
      <div style={{ height:16 }}/>
      {!hideFloatingAdd && (trackHabits.length > 0 || activeGoals.length > 0 || logHabits.length > 0) && onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add habit or goal"
          title="Add habit or goal"
          style={{
            position:"fixed", bottom:276, right:18, height:52, padding:"0 18px 0 16px",
            borderRadius:26, border:"none",
            background:T.accent, color:"#fff", fontSize:14, fontWeight:700, lineHeight:1,
            cursor:"pointer", zIndex:99,
            boxShadow:"0 4px 16px rgba(192,57,43,0.35)",
            display:"flex", alignItems:"center", justifyContent:"center", gap:7,
            fontFamily:T.font,
          }}
        >
          <span style={{ fontSize:22, fontWeight:700, lineHeight:1, marginTop:1 }} aria-hidden>+</span>
          <span>Add habit</span>
        </button>
      )}
    </div>
  );
}

// ─── BETA INTEREST MODAL ─────────────────────────────────────────────────────
function BetaModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit() {
    if (!email.trim()) return;
    // mailto fallback — works immediately, no backend needed
    const subject = encodeURIComponent("Forged early supporter — beta interest");
    const body = encodeURIComponent(
      `Email: ${email.trim()}\n\n${msg.trim() ? `Message: ${msg.trim()}` : "(No message)"}`
    );
    window.open(`mailto:hello@forged.app?subject=${subject}&body=${body}`, "_blank");
    setSent(true);
  }

  if (sent) return (
    <Modal onClose={onClose}>
      <div style={{ textAlign:"center", padding:"10px 0 20px" }}>
        <div style={{ fontSize:36, marginBottom:14 }}>🙌</div>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>You're on the list.</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:24 }}>
          Thanks for being early. You'll hear from me directly as things come together — I genuinely appreciate it.
        </div>
        <GBtn onClick={onClose}>Close</GBtn>
      </div>
    </Modal>
  );

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>Interested in Forged Pro?</div>
      <div style={{ fontSize:13, color:T.muted, lineHeight:1.8, marginBottom:20 }}>
        Forged Pro is <strong style={{ color:T.text }}>$4.99/month</strong> — unlimited AI coaching, full history, friend nudges, and voice logging.
        <br/><br/>
        Leave your email and I'll reach out directly. Early users shape what gets built next.
      </div>
      <FG label="Your email">
        <input style={inp} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus/>
      </FG>
      <FG label="Anything you'd love to see? (optional)" mb={0}>
        <textarea style={{ ...inp, resize:"none", lineHeight:1.6 }} rows={3}
          placeholder="Features, questions, feedback — anything goes"
          value={msg} onChange={e => setMsg(e.target.value)}/>
      </FG>
      <PBtn onClick={handleSubmit} style={{ marginTop:16 }}>I'm interested →</PBtn>
      <GBtn onClick={onClose}>Maybe later</GBtn>
      <div style={{ fontSize:11, color:T.hint, marginTop:10, textAlign:"center", lineHeight:1.6 }}>
        This opens your email app with your details pre-filled. No spam, ever.
      </div>
    </Modal>
  );
}

// ─── JOURNAL DAY SECTION ──────────────────────────────────────────────────────
// One section per date in the list view. Today is expanded by default.
// Past days collapse into a single row showing a snapshot.
function DaySection({ date, dayHabits, onReflect, onDeleteLogEntry, listFullyExpanded, journalCollapseNonce, onAccordionInteraction }) {
  const isToday = date === todayStr();
  const [open, setOpen] = useState(isToday);
  useEffect(() => {
    if (listFullyExpanded && !isToday) setOpen(true);
  }, [listFullyExpanded, isToday]);
  const prevCollapseNonce = useRef(null);
  useEffect(() => {
    if (prevCollapseNonce.current === null) {
      prevCollapseNonce.current = journalCollapseNonce;
      return;
    }
    if (prevCollapseNonce.current === journalCollapseNonce) return;
    prevCollapseNonce.current = journalCollapseNonce;
    if (!isToday) setOpen(false);
  }, [journalCollapseNonce, isToday]);

  const label = isToday ? "Today" : date === daysAgo(1) ? "Yesterday" : fmtEntryDate(date);
  // Snapshot: unique habit emojis for this day + total log count
  const totalLogs = dayHabits.reduce((s, dh) => s + dh.logs.length, 0);
  const emojis = dayHabits.slice(0, 4).map(dh => dh.habit.emoji).join(" ");

  return (
    <div style={{ marginBottom: isToday ? 4 : 2 }}>
      {/* Date header — past days are clickable accordions */}
      {isToday ? (
        <div style={{ padding:"12px 18px 6px" }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text, letterSpacing:"0.01em" }}>Today</div>
        </div>
      ) : (
        <button type="button" onClick={() => { onAccordionInteraction?.(); setOpen(o => !o); }}
          style={{ width:"100%", display:"flex", alignItems:"center", padding:"10px 18px 8px", background:"none", border:"none", cursor:"pointer", gap:10 }}>
          {/* Colour line */}
          <div style={{ width:3, height:28, borderRadius:2, background:open?T.accent:T.borderStrong, flexShrink:0, transition:"background 0.2s ease" }}/>
          <div style={{ flex:1, textAlign:"left" }}>
            <div style={{ fontSize:13, fontWeight:500, color:open?T.text:T.muted, transition:"color 0.2s ease" }}>{label}</div>
            {!open && <div style={{ fontSize:11, color:T.hint, marginTop:1 }}>{emojis} · {totalLogs} {totalLogs === 1 ? "entry" : "entries"}</div>}
          </div>
          <div style={{ fontSize:14, color:T.hint, transition:"transform 0.2s ease", transform:open?"rotate(90deg)":"rotate(0deg)" }}>›</div>
        </button>
      )}

      {/* Expanded content */}
      {open && (
      <div style={{ animation:"journalFadeIn 0.18s ease-out" }}>
      {dayHabits.map(({ habit, logs, entryKey }) => (
        <HabitDayCard key={entryKey || habit.id} habit={habit} logs={logs} onReflect={onReflect} onDeleteLogEntry={onDeleteLogEntry}/>
      ))}
      </div>
      )}
    </div>
  );
}

// Missed day (marked by user, optional note) — list / week views
function MissedDaySection({ date, note, onEdit, onClear, listFullyExpanded, journalCollapseNonce, onAccordionInteraction }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (listFullyExpanded) setOpen(true);
  }, [listFullyExpanded]);
  const prevCollapseNonce = useRef(null);
  useEffect(() => {
    if (prevCollapseNonce.current === null) {
      prevCollapseNonce.current = journalCollapseNonce;
      return;
    }
    if (prevCollapseNonce.current === journalCollapseNonce) return;
    prevCollapseNonce.current = journalCollapseNonce;
    setOpen(false);
  }, [journalCollapseNonce]);
  const label = fmtEntryDate(date);
  const hasNote = !!(note && note.trim());
  return (
    <div style={{ margin:"0 14px 6px", borderRadius:T.r, border:`0.5px solid rgba(230,126,34,0.38)`, overflow:"hidden", background:"rgba(230,126,34,0.04)" }}>
      <button
        type="button"
        onClick={() => { onAccordionInteraction?.(); setOpen(o => !o); }}
        style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", background:"none", border:"none", cursor:"pointer", gap:10 }}>
        <span style={{ fontSize:12, fontWeight:600, color:T.amber }}>{label}</span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:11, color:T.amber, fontWeight:700, background:"rgba(230,126,34,0.15)", borderRadius:10, padding:"2px 8px" }}>
            ✕ Missed{hasNote ? " · noted" : ""}
          </span>
          <span style={{ fontSize:11, color:T.hint }}>{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open && (
        <div style={{ padding:"0 14px 12px", borderTop:`0.5px solid rgba(230,126,34,0.18)`, animation:"journalFadeIn 0.18s ease-out" }}>
          {hasNote ? (
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, marginTop:10, marginBottom:10 }}>{note.trim()}</div>
          ) : (
            <div style={{ fontSize:12, color:T.muted, marginTop:8, marginBottom:8 }}>No note added yet.</div>
          )}
          <div style={{ display:"flex", gap:10 }}>
            <button type="button" onClick={onEdit} style={{ fontSize:11, color:T.amber, background:"rgba(230,126,34,0.12)", border:`0.5px solid rgba(230,126,34,0.35)`, borderRadius:T.rsm, padding:"5px 10px", cursor:"pointer", fontWeight:600 }}>
              {hasNote ? "Edit note" : "Add note"}
            </button>
            <button type="button" onClick={onClear} style={{ fontSize:11, color:T.hint, background:"none", border:"none", cursor:"pointer" }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Project session length for journal rows — 60→"1h", 90→"1h 30m", 45→"45m" */
function formatProjectMinutes(totalMins) {
  const m = Math.max(0, Math.floor(Number(totalMins) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (rest > 0) parts.push(`${rest}m`);
  if (parts.length === 0) return "0m";
  return parts.join(" ");
}

function renderJournalLogContent(habit, log) {
  const note = log.note?.trim();
  const noteSuffix = note ? ` · ${truncateText(note, 48)}` : "";

  if (habit.habitType === "log" && log.value === "log") return <>{note || "Log entry"}</>;

  if (log.value === "skip") return <>{`Skipped${noteSuffix}`}</>;
  if (log.value === "quicknote") return <>{note || "Quick note"}</>;

  if (habit.habitType === "limit" && typeof log.value === "number") {
    return <>{formatWithUnit(log.value, habit.unit)}{noteSuffix}</>;
  }
  if (habit.habitType === "goal" && typeof log.value === "number") {
    return <>{`Updated to ${formatWithUnit(log.value, habit.unit)}`}{noteSuffix}</>;
  }

  if (habit.habitType === "project" && log.value && typeof log.value === "object" && "minutes" in log.value) {
    const v = log.value;
    const topNote = note && (!v.note || v.note.trim() !== note) ? note : null;
    return (
      <>
        <div style={{ color: T.text }}>{formatProjectMinutes(v.minutes)}</div>
        {v.win ? (
          <div style={{ fontSize: 12, color: T.green, opacity: 0.92, marginTop: 4, lineHeight: 1.45 }}>
            Win: {truncateText(v.win, 200)}
          </div>
        ) : null}
        {v.hardPart ? (
          <div style={{ fontSize: 12, color: T.muted, marginTop: v.win ? 3 : 4, lineHeight: 1.45 }}>
            Hard: {truncateText(v.hardPart, 200)}
          </div>
        ) : null}
        {v.note?.trim() ? (
          <div style={{ fontSize: 12, fontStyle: "italic", color: T.sub, marginTop: (v.win || v.hardPart) ? 3 : 4, lineHeight: 1.45 }}>
            {truncateText(v.note.trim(), 400)}
          </div>
        ) : null}
        {topNote ? (
          <div style={{ fontSize: 12, fontStyle: "italic", color: T.sub, marginTop: 4, lineHeight: 1.45 }}>
            {truncateText(topNote, 72)}
          </div>
        ) : null}
      </>
    );
  }

  if (log.value === true) {
    return <>{`Done ✓${noteSuffix}`}</>;
  }
  if (typeof log.value === "number") return <>{`${formatWithUnit(log.value, habit.unit)}${noteSuffix}`}</>;
  if (log.reflection) return <>{`Reflection · ${truncateText(log.reflection, 72)}${noteSuffix}`}</>;
  if (log.value && typeof log.value === "object") {
    if (log.value.win) return <>{`Win · ${truncateText(log.value.win, 56)}`}</>;
    if (log.value.hardPart) return <>{`Hard part · ${truncateText(log.value.hardPart, 56)}`}</>;
  }
  if (log.value == null && note) return <>{note}</>;
  return <>{note || "Entry"}</>;
}

function limitJournalMergedNotes(logs) {
  const seen = new Set();
  const out = [];
  for (const l of logs) {
    if (l.value === "quicknote") {
      const t = (l.note || "").trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    } else if (typeof l.value === "number") {
      const t = (l.note || "").trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }
  return out;
}

// Card showing one habit's full activity for a single day
function HabitDayCard({ habit, logs, onReflect, onDeleteLogEntry }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showLimitTaps, setShowLimitTaps] = useState(false);
  const nonNote = logs.filter(l => l.value !== "quicknote");
  const notes   = logs.filter(l => l.value === "quicknote" || (l.note && l.note.trim()));
  const uniqueNotes = [...new Set(notes.map(l => l.note).filter(Boolean))];
  const isLimit = habit.habitType === "limit";
  const limitTapCount = isLimit ? nonNote.filter(l => typeof l.value === "number").length : 0;
  const limitMergedNotes = isLimit ? limitJournalMergedNotes(logs) : [];

  // Summary line based on habit type
  function summaryLine() {
    if (habit.habitType === "log") {
      const n = nonNote.filter(l => l.value === "log").length;
      return `${n} log entr${n === 1 ? "y" : "ies"}`;
    }
    if (habit.habitType === "goal") {
      const latest = nonNote.slice(-1)[0];
      const value = typeof latest?.value === "number" ? latest.value : (habit.currentValue ?? 0);
      return `${formatWithUnit(value, habit.unit)} logged`;
    }
    if (habit.habitType === "project") {
      const mins = nonNote.reduce((s, l) => s + (l.value?.minutes || 0), 0);
      const sessions = nonNote.length;
      return mins > 0 ? `${mins} min · ${sessions} session${sessions!==1?"s":""}` : `${sessions} session${sessions!==1?"s":""}`;
    }
    if (habit.habitType === "limit") {
      const total = nonNote.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0);
      return `${total} ${habit.unit || "logged"} of ${habit.dailyBudget} limit`;
    }
    if (habit.habitType === "weekly") return `${nonNote.length} session${nonNote.length!==1?"s":""}`;
    if (isLegacyProgressType(habit.habitType)) {
      const latest = nonNote.slice(-1)[0];
      return latest ? `${latest.value}${habit.unit}` : "logged";
    }
    return "logged ✓";
  }

  // Grab wins, hard parts, reflections from any log
  const wins       = nonNote.filter(l => l.value?.win).map(l => l.value.win);
  const hardParts  = nonNote.filter(l => l.value?.hardPart).map(l => l.value.hardPart);
  const reflection = nonNote.map(l => l.reflection).filter(Boolean).join(" ");

  async function confirmDeleteEntry() {
    if (!pendingDelete || !onDeleteLogEntry || deleting) return;
    setDeleting(true);
    try {
      const ok = await onDeleteLogEntry(habit, pendingDelete);
      if (ok) setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
    <div style={{ margin:"0 14px 8px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
      {/* Habit header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px 8px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ width:24, height:24, borderRadius:6, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>{habit.emoji}</div>
        <span style={{ fontSize:13, fontWeight:500, color:habit.color }}>{habit.name}</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.hint }}>{summaryLine()}</span>
      </div>

      {/* Limit habits: one daily summary; expand for per-tap delete */}
      {isLimit && logs.length > 0 && onDeleteLogEntry && !showLimitTaps ? (
        <div style={{ borderBottom:`0.5px solid ${T.border}`, padding:"12px 14px" }}>
          <div style={{ fontSize:12, color:T.sub, lineHeight:1.55 }}>
            <strong style={{ color:T.text }}>Day summary</strong>
            {" — "}
            {limitTapCount === 0
              ? (logs.some(l => l.value === "quicknote") ? "Quick note only — expand taps to view or delete." : "No + taps logged today.")
              : `${limitTapCount} tap${limitTapCount !== 1 ? "s" : ""} · ${nonNote.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0)} / ${habit.dailyBudget ?? "—"} ${habit.unit || ""}`.trim()}
          </div>
          {limitMergedNotes.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Notes</div>
              {limitMergedNotes.map((t, i) => (
                <div key={i} style={{ fontSize:13, color:T.text, lineHeight:1.5, fontStyle:"italic", marginTop:i ? 6 : 0 }}>{t}</div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowLimitTaps(true)}
            style={{ marginTop:12, fontSize:11, color:habit.color, background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}
          >
            Show individual taps (to delete one) →
          </button>
        </div>
      ) : null}

      {/* Per-entry rows (Journal) — delete removes one log; XP is not adjusted */}
      {logs.length > 0 && onDeleteLogEntry && (!isLimit || showLimitTaps) ? (
        <div style={{ borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ padding:"8px 14px 4px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
            <span style={{ fontSize:10, fontWeight:600, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em" }}>{isLimit ? "Each tap" : "Entries"}</span>
            {isLimit && showLimitTaps ? (
              <button type="button" onClick={() => setShowLimitTaps(false)} style={{ fontSize:11, color:T.muted, background:"none", border:"none", cursor:"pointer", padding:0 }}>Hide taps</button>
            ) : null}
          </div>
          {logs.map((log, i) => (
            <div
              key={`${log.date}-${i}-${typeof log.value === "object" ? JSON.stringify(log.value) : String(log.value)}`}
              style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 14px", borderTop:`0.5px solid ${T.border}` }}
            >
              <div style={{ flex:1, fontSize:13, color:T.text, lineHeight:1.5, minWidth:0 }}>{renderJournalLogContent(habit, log)}</div>
              <button
                type="button"
                aria-label="Delete this log entry"
                disabled={deleting}
                onClick={() => setPendingDelete(log)}
                style={{
                  flexShrink:0, width:32, height:32, marginTop:-4, border:"none", borderRadius:8, cursor:deleting ? "default" : "pointer",
                  background:"transparent", color:T.hint, fontSize:18, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center",
                }}
              >×</button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Wins */}
      {wins.map((w, i) => (
        <div key={i} style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Win 🏆</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{w}</div>
        </div>
      ))}

      {/* Hard parts */}
      {hardParts.map((h, i) => (
        <div key={i} style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.amber, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Hard part 🧱</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{h}</div>
        </div>
      ))}

      {/* Reflection */}
      {reflection && (
        <div style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Reflection</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{reflection}</div>
        </div>
      )}

      {/* Quick notes — limit notes live in day summary or per-row when taps expanded */}
      {!isLimit ? [...uniqueNotes].reverse().map((n, i) => (
        <div key={i} style={{ padding:"8px 14px", borderBottom:i<uniqueNotes.length-1?`0.5px solid ${T.border}`:"none", background:`${T.surface}66` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, fontStyle:"italic" }}>{n}</div>
        </div>
      )) : null}

      {/* Add reflection prompt if none yet */}
      {!reflection && habit.habitType !== "goal" && habit.habitType !== "log" && (
        <div style={{ padding:"8px 14px" }}>
          <button onClick={() => onReflect(habit.id)}
            style={{ fontSize:12, color:habit.color+"99", background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}>
            Add reflection →
          </button>
        </div>
      )}
    </div>

    {pendingDelete && onDeleteLogEntry ? (
      <Modal onClose={() => { if (!deleting) setPendingDelete(null); }}>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:8 }}>Delete this entry?</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.55, marginBottom:22 }}>
          This removes the log from your journal and history. Your XP will stay the same.
        </div>
        <PBtn color="#9B2C2C" onClick={confirmDeleteEntry}>{deleting ? "Deleting…" : "Delete"}</PBtn>
        <GBtn onClick={() => { if (!deleting) setPendingDelete(null); }}>Cancel</GBtn>
      </Modal>
    ) : null}
    </>
  );
}

// ─── JOURNAL COMPOSE SHEET ────────────────────────────────────────────────────
/** Bottom sheet for writing or editing a pure journal entry for a given date. */
function JournalComposeSheet({ initialContent = "", date, onSave, onClose }) {
  useScrollLock(true);
  const [draft, setDraft] = useState(initialContent);
  const taRef = useRef(null);
  useEffect(() => { taRef.current?.focus(); }, []);

  const displayDate = (() => {
    const d = parseLocal(date);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  })();

  function handleSave() {
    if (!draft.trim()) return;
    onSave(date, draft.trim());
    onClose();
  }

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.55)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"20px 16px 36px", boxSizing:"border-box", touchAction:"auto" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 16px" }}/>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontFamily:T.serif, fontSize:18, color:T.text }}>📓 {displayDate}</div>
          <button type="button" onClick={onClose} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:22, lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <textarea
          ref={taRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write anything — what happened today, how you're feeling, what's on your mind…"
          rows={8}
          style={{
            width:"100%", boxSizing:"border-box", resize:"vertical",
            borderRadius:T.r, border:`0.5px solid ${T.border}`,
            background:T.surface, color:T.text, fontSize:16, lineHeight:1.65,
            padding:"12px 14px", fontFamily:T.font,
          }}
        />
        <div style={{ display:"flex", gap:10, marginTop:12 }}>
          <button type="button" onClick={handleSave} disabled={!draft.trim()}
            style={{ flex:1, padding:"12px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:draft.trim()?"pointer":"not-allowed", opacity:draft.trim()?1:0.5 }}>
            Save entry
          </button>
          <button type="button" onClick={onClose}
            style={{ padding:"12px 16px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── JOURNAL SCREEN ───────────────────────────────────────────────────────────
function JournalScreen({ habits, goals = [], onReflect, onDeleteJournalLog, journalUserId, isPro, onUpgrade, journalEntries = [], onSaveJournalEntry, initialTab, onInitialComposeDone }) {
  // "activity" = habit/goal log history (existing), "journal" = pure journal entries
  const [mainTab, setMainTab]   = useState(initialTab === "journal" ? "journal" : "activity");
  const [composeDate, setComposeDate] = useState(initialTab === "journal" ? todayStr() : null); // null = closed, "YYYY-MM-DD" = open

  // When navigating here from AddActionSheet "Write in journal", auto-open compose.
  // Once the sheet closes, clear the trigger so subsequent navigations don't re-open.
  useEffect(() => {
    if (initialTab === "journal" && composeDate === null) {
      onInitialComposeDone?.();
    }
  }, [composeDate]);
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("day"); // "day" | "week" | "month"
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [missedMap, setMissedMap] = useState({});
  const [missedEditDate, setMissedEditDate] = useState(null);
  const [missedNoteDraft, setMissedNoteDraft] = useState("");
  const [monthMissedDraft, setMonthMissedDraft] = useState("");
  const [openWeeks, setOpenWeeks] = useState(() => new Set([weekStartFor(todayStr())]));
  const [listFullyExpanded, setListFullyExpanded] = useState(false);
  const [journalCollapseNonce, setJournalCollapseNonce] = useState(0);

  useEffect(() => {
    const local = loadJournalMissedMap(journalUserId);
    setMissedMap(local);
    if (!journalUserId) return;
    // Fetch from Supabase and merge so multi-device notes survive
    supabase.from("profiles").select("journal_missed_days").eq("id", journalUserId).maybeSingle()
      .then(({ data }) => {
        const remote = data?.journal_missed_days;
        if (remote && typeof remote === "object" && !Array.isArray(remote)) {
          const merged = { ...local, ...remote };
          setMissedMap(merged);
          try { localStorage.setItem(`forged_journal_missed_${journalUserId}`, JSON.stringify(merged)); } catch {}
        }
      });
  }, [journalUserId]);

  function toggleWeek(ws) {
    setListFullyExpanded(false);
    setOpenWeeks(prev => {
      const next = new Set(prev);
      if (next.has(ws)) next.delete(ws);
      else next.add(ws);
      return next;
    });
  }

  function persistMissed(next) {
    saveJournalMissedMap(journalUserId, next);
  }
  function setMissed(date, note) {
    setMissedMap(prev => {
      const next = { ...prev, [date]: note };
      persistMissed(next);
      return next;
    });
  }
  function clearMissed(date) {
    setMissedMap(prev => {
      const next = { ...prev };
      delete next[date];
      persistMissed(next);
      return next;
    });
  }

  const allByDate = {};
  habits.forEach(h => {
    const entryKey = `habit:${h.id}`;
    const hLogs = filter === "all" || filter === entryKey ? h.logs : [];
    hLogs.forEach(l => {
      if (!allByDate[l.date]) allByDate[l.date] = {};
      if (!allByDate[l.date][entryKey]) allByDate[l.date][entryKey] = { habit: h, logs: [], entryKey };
      allByDate[l.date][entryKey].logs.push(l);
    });
  });
  goals.forEach(g => {
    const entryKey = `goal:${g.id}`;
    const gLogs = (filter === "all" || filter === entryKey)
      ? (g.logs || []).filter(l => typeof l.value === "number")
      : [];
    const goalAsEntry = { ...g, habitType: "goal", reflection: false };
    gLogs.forEach(l => {
      if (!allByDate[l.date]) allByDate[l.date] = {};
      if (!allByDate[l.date][entryKey]) allByDate[l.date][entryKey] = { habit: goalAsEntry, logs: [], entryKey };
      allByDate[l.date][entryKey].logs.push(l);
    });
  });
  const dates = Object.keys(allByDate).sort((a, b) => b.localeCompare(a));
  const loggedDaysCount = new Set([
    ...habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip").map(l => l.date)),
    ...goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number").map(l => l.date)),
  ]).size;

  const allLogDatesRaw = [
    ...habits.flatMap(h => h.logs.map(l => l.date)),
    ...goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number").map(l => l.date)),
  ].filter(Boolean).sort();
  const firstLogDate  = allLogDatesRaw[0] || null;
  const firstLogYear  = firstLogDate ? parseInt(firstLogDate.split("-")[0], 10) : null;
  const firstLogMonth = firstLogDate ? parseInt(firstLogDate.split("-")[1], 10) - 1 : null;
  const firstLogDay   = firstLogDate ? parseInt(firstLogDate.split("-")[2], 10) : null;

  const now = new Date();
  const viewYear  = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getFullYear();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getMonth();
  const monthLabel = `${MONTHS[viewMonth]} ${viewYear}`;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const startPad = (firstDow + 6) % 7;

  function dayStr(d) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const entryDays = {};
  Object.entries(allByDate).forEach(([dateStr, habitMap]) => {
    const d = parseLocal(dateStr);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      entryDays[day] = Object.values(habitMap).map(({ habit }) => ({ habitColor: habit.color }));
    }
  });

  // tStr must be declared BEFORE goalMarkerDays — the forEach callbacks close over
  // it synchronously, so declaring it after (as it was) caused a TDZ crash whenever
  // any goal had a targetDate or milestone log entry.
  const tStr = todayStr();

  // Goal deadlines and milestones for this month view
  const goalMarkerDays = {}; // { dayNum: [{ type:"deadline"|"milestone", label, color, emoji, isFuture }] }
  (goals || []).filter(g => g.status !== "completed").forEach(g => {
    if (g.targetDate) {
      const d = parseLocal(g.targetDate);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!goalMarkerDays[day]) goalMarkerDays[day] = [];
        goalMarkerDays[day].push({ type:"deadline", label:g.name, color:g.color, emoji:g.emoji, isFuture:g.targetDate >= tStr, goalId:g.id, currentValue:g.currentValue, targetValue:g.targetValue, startValue:g.startValue, unit:g.unit||"" });
      }
    }
    (g.logs || []).filter(l => l.type === "milestone" && l.date).forEach(ms => {
      const d = parseLocal(ms.date);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!goalMarkerDays[day]) goalMarkerDays[day] = [];
        goalMarkerDays[day].push({ type:"milestone", label:ms.label, color:g.color, emoji:g.emoji, isFuture:ms.date >= tStr, goalId:g.id, goalName:g.name });
      }
    });
  });
  const missedDatesList = Object.keys(missedMap).sort((a, b) => b.localeCompare(a));
  const missedMarkedCount = missedDatesList.length;
  const mergedDatesSet = new Set([...dates, ...missedDatesList]);
  const mergedDesc = [...mergedDatesSet].sort((a, b) => b.localeCompare(a));
  const hasJournalRows = mergedDatesSet.size > 0;
  // Today always first; remaining days newest → oldest (ISO date sort)
  const sortedDatesDesc = hasJournalRows ? [tStr, ...mergedDesc.filter(d => d !== tStr)] : [];
  const weekKeysDesc = [...new Set(sortedDatesDesc.map(d => weekStartFor(d)))].sort((a, b) => b.localeCompare(a));
  const weekKeysKey = weekKeysDesc.join("|");

  useEffect(() => {
    if (viewMode !== "week" || !listFullyExpanded) return;
    setOpenWeeks(new Set(weekKeysDesc));
  }, [viewMode, listFullyExpanded, weekKeysKey]);

  useEffect(() => {
    if (selectedDay == null) { setMonthMissedDraft(""); return; }
    const ds = dayStr(selectedDay);
    setMonthMissedDraft(Object.prototype.hasOwnProperty.call(missedMap, ds) ? (missedMap[ds] || "") : "");
  }, [selectedDay, viewYear, viewMonth, missedMap]);

  function renderDayOrMissed(date) {
    const onAccordionInteraction = () => setListFullyExpanded(false);
    if (Object.prototype.hasOwnProperty.call(missedMap, date)) {
      return (
        <MissedDaySection
          key={date}
          date={date}
          note={missedMap[date]}
          onEdit={() => { setMissedEditDate(date); setMissedNoteDraft(missedMap[date] || ""); }}
          onClear={() => clearMissed(date)}
          listFullyExpanded={listFullyExpanded}
          journalCollapseNonce={journalCollapseNonce}
          onAccordionInteraction={onAccordionInteraction}
        />
      );
    }
    const hasLog = allByDate[date] && Object.keys(allByDate[date]).length > 0;
    if (hasLog || date === tStr) {
      return (
        <DaySection
          key={date}
          date={date}
          dayHabits={hasLog ? Object.values(allByDate[date]) : []}
          onReflect={onReflect}
          onDeleteLogEntry={onDeleteJournalLog}
          listFullyExpanded={listFullyExpanded}
          journalCollapseNonce={journalCollapseNonce}
          onAccordionInteraction={onAccordionInteraction}
        />
      );
    }
    return null;
  }

  const listEmpty = sortedDatesDesc.length === 0;

  // Sort journal entries newest first for the journal tab
  const sortedJournalEntries = [...journalEntries].sort((a, b) => b.date.localeCompare(a.date));
  const todayJournalEntry = journalEntries.find(e => e.date === tStr);

  return (
    <div data-tour="journal-list">
      {/* Compose sheet */}
      {composeDate && (
        <JournalComposeSheet
          date={composeDate}
          initialContent={journalEntries.find(e => e.date === composeDate)?.content || ""}
          onSave={(date, content) => onSaveJournalEntry?.(date, content)}
          onClose={() => setComposeDate(null)}
        />
      )}

      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Journal</div>
          <div style={{ fontSize:13, color:T.muted, marginTop:3 }}>
            {mainTab === "activity" ? (
              <>
                {loggedDaysCount} days logged
                {missedMarkedCount > 0 ? <span> · {missedMarkedCount} missed</span> : null}
              </>
            ) : (
              <>{sortedJournalEntries.length} {sortedJournalEntries.length === 1 ? "entry" : "entries"}</>
            )}
          </div>
        </div>
        {mainTab === "activity" ? (
          <div data-tour="journal-viewmode" style={{ display:"flex", background:T.surface, borderRadius:T.rsm, padding:3, gap:2 }}>
            {[["day","Day"],["week","Week"],["month","Month"]].map(([mode, label]) => (
              <button key={mode} type="button" onClick={() => { setViewMode(mode); setSelectedDay(null); if (mode === "month") setListFullyExpanded(false); }}
                style={{ padding:"5px 10px", borderRadius:7, border:"none", cursor:"pointer",
                  background:viewMode === mode ? T.raised : "none",
                  color:viewMode === mode ? T.text : T.muted, fontSize:11, fontWeight:500, transition:"all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setComposeDate(tStr)}
            style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            ✏️ Write
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:0, padding:"0 18px 14px" }}>
        {[["activity","Activity"],["journal","Journal"]].map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setMainTab(tab)}
            style={{ padding:"6px 16px", borderRadius:0, border:"none", cursor:"pointer", fontSize:12, fontWeight:500,
              background: mainTab === tab ? T.accent + "22" : "none",
              color: mainTab === tab ? T.accent : T.muted,
              borderBottom: mainTab === tab ? `2px solid ${T.accent}` : "2px solid transparent",
              transition:"all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── JOURNAL TAB ── */}
      {mainTab === "journal" && (
        <div style={{ padding:"0 16px 32px" }}>
          {/* Today's entry card or prompt */}
          {!todayJournalEntry ? (
            <button type="button" onClick={() => setComposeDate(tStr)}
              style={{ width:"100%", padding:"20px 18px", borderRadius:T.r, border:`1.5px dashed ${T.border}`, background:"none", cursor:"pointer", textAlign:"left", marginBottom:16, display:"flex", alignItems:"center", gap:14 }}>
              <span style={{ fontSize:28 }}>📓</span>
              <div>
                <div style={{ fontSize:14, fontWeight:500, color:T.text }}>Write today's entry</div>
                <div style={{ fontSize:12, color:T.muted, marginTop:3 }}>What happened today? How are you feeling? Anything on your mind.</div>
              </div>
            </button>
          ) : (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Today</div>
              <div style={{ padding:"14px 16px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}`, position:"relative" }}>
                <div style={{ fontSize:14, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{todayJournalEntry.content}</div>
                <button type="button" onClick={() => setComposeDate(tStr)}
                  style={{ marginTop:12, fontSize:12, color:T.accent, background:"none", border:"none", cursor:"pointer", padding:0, fontWeight:500 }}>
                  + Add more →
                </button>
              </div>
            </div>
          )}

          {/* Past entries */}
          {sortedJournalEntries.filter(e => e.date !== tStr).length === 0 && !todayJournalEntry && (
            <div style={{ padding:"32px 0", textAlign:"center", color:T.muted, fontSize:13 }}>
              No entries yet. Write your first one above.
            </div>
          )}
          {sortedJournalEntries.filter(e => e.date !== tStr).map(entry => {
            const d = parseLocal(entry.date);
            const label = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
            return (
              <div key={entry.id || entry.date} style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>{label}</div>
                <div style={{ padding:"14px 16px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
                  <div style={{ fontSize:14, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{entry.content}</div>
                  <button type="button" onClick={() => setComposeDate(entry.date)}
                    style={{ marginTop:10, fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", padding:0 }}>
                    Edit →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ACTIVITY TAB ── */}
      {mainTab === "activity" && (
      <>
      <div data-tour="journal-filters" style={{ display:"flex", gap:6, padding:"0 16px 14px", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        {[{ id:"all", name:"All", emoji:"", color:T.accent }, ...habits.map(h => ({ id:`habit:${h.id}`, name:h.name, emoji:h.emoji, color:h.color })), ...goals.map(g => ({ id:`goal:${g.id}`, name:g.name, emoji:g.emoji, color:g.color }))].map(f => (
          <button key={f.id} type="button" onClick={() => { setFilter(f.id); setSelectedDay(null); }}
            style={{ padding:"5px 12px", borderRadius:20, whiteSpace:"nowrap", flexShrink:0,
              border:`0.5px solid ${filter === f.id ? f.color : T.borderStrong}`,
              background:filter === f.id ? f.color + "22" : "none",
              color:filter === f.id ? f.color : T.muted,
              fontSize:12, fontWeight:filter === f.id ? 500 : 400, cursor:"pointer" }}>
            {f.emoji ? `${f.emoji} ${f.name}` : f.name}
          </button>
        ))}
      </div>

      {(viewMode === "day" || viewMode === "week") && !listEmpty && (
        <div style={{ padding:"0 16px 12px", display:"flex", justifyContent:"flex-end" }}>
          <button
            type="button"
            onClick={() => {
              if (listFullyExpanded) {
                setListFullyExpanded(false);
                setJournalCollapseNonce(n => n + 1);
                if (viewMode === "week") setOpenWeeks(new Set());
              } else {
                setListFullyExpanded(true);
                if (viewMode === "week") setOpenWeeks(new Set(weekKeysDesc));
              }
            }}
            style={{
              padding:"6px 12px",
              borderRadius:T.rsm,
              border:`0.5px solid ${listFullyExpanded ? T.borderMid : T.borderStrong}`,
              background:listFullyExpanded ? T.raised : T.surface,
              color:listFullyExpanded ? T.text : T.muted,
              fontSize:11,
              fontWeight:500,
              cursor:"pointer",
              transition:"background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
            }}>
            {listFullyExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      {viewMode === "month" && !isPro && (
        <div style={{ position:"relative", margin:"0 14px 16px", borderRadius:T.r, overflow:"hidden" }}>
          {/* Blurred skeleton calendar */}
          <div style={{ filter:"blur(5px)", pointerEvents:"none", userSelect:"none", opacity:0.4, padding:"16px 0" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {Array.from({length:35}).map((_, i) => (
                <div key={i} style={{ aspectRatio:"1", borderRadius:8, background:T.surface, border:`1px solid ${T.border}` }}/>
              ))}
            </div>
          </div>
          {/* Lock overlay */}
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding:"0 24px", textAlign:"center", background:"rgba(14,14,14,0.80)", backdropFilter:"blur(2px)", borderRadius:T.r }}>
            <div style={{ fontSize:22 }}>🔒</div>
            <div style={{ fontSize:14, fontWeight:500, color:T.text }}>Full history is part of Forged Pro</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>Core logging is free. Full history and the calendar view are included in Forged Pro.</div>
            <button onClick={onUpgrade}
              style={{ marginTop:6, padding:"10px 22px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#0F0F0D", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Unlock Forged Pro →
            </button>
          </div>
        </div>
      )}

      {viewMode === "month" && isPro && (
        <div style={{ padding:"0 14px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <button type="button" onClick={() => { setMonthOffset(o => o + 1); setSelectedDay(null); }}
              style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:20, padding:"4px 8px" }}>‹</button>
            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text }}>{monthLabel}</div>
            <button type="button" onClick={() => { setMonthOffset(o => Math.max(0, o - 1)); setSelectedDay(null); }}
              disabled={monthOffset === 0}
              style={{ background:"none", border:"none", color:monthOffset === 0 ? T.hint : T.muted, cursor:monthOffset === 0 ? "default" : "pointer", fontSize:20, padding:"4px 8px" }}>›</button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
            {["M","T","W","T","F","S","S"].map((d, i) => (
              <div key={i} style={{ textAlign:"center", fontSize:10, color:T.hint, fontWeight:500 }}>{d}</div>
            ))}
          </div>

          <div style={{ fontSize:10, color:T.hint, marginBottom:8, display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
            <span>● logged</span>
            <span style={{ color:"rgba(230,126,34,0.9)", fontWeight:600 }}>? no log</span>
            <span style={{ color:T.amber, fontWeight:600 }}>✕ missed</span>
            <span style={{ color:T.gold, fontWeight:600 }}>🎯 goal deadline</span>
            <span style={{ color:T.gold }}>◆ milestone</span>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:16 }}>
            {Array.from({ length:startPad }, (_, i) => <div key={`pad-${i}`}/>)}
            {Array.from({ length:daysInMonth }, (_, i) => {
              const day = i + 1;
              const ds = dayStr(day);
              const hasEntries = !!entryDays[day];
              const isToday = ds === tStr;
              const isSelected = selectedDay === day;
              const isJourneyStart = firstLogDate === ds;
              const isMissed = Object.prototype.hasOwnProperty.call(missedMap, ds);
              const canMarkMissed = !!(firstLogDate && ds >= firstLogDate && ds < tStr && !hasEntries);
              const isOpenDay = canMarkMissed && !isMissed;
              const habitColors = hasEntries ? [...new Set(entryDays[day].map(e => e.habitColor))].slice(0, 3) : [];
              const goalMarkers = goalMarkerDays[day] || [];
              const hasDeadline = goalMarkers.some(m => m.type === "deadline");
              const hasMilestone = goalMarkers.some(m => m.type === "milestone");
              const anyGoalMarker = hasDeadline || hasMilestone;
              const goalMarkerTooltip = goalMarkers.map(m => `${m.type === "deadline" ? "🎯 Deadline" : "◆ Milestone"}: ${m.label}`).join(" · ");
              const clickable = hasEntries || isJourneyStart || isMissed || canMarkMissed || anyGoalMarker;
              let border = T.border;
              if (isSelected) border = T.accent;
              else if (isJourneyStart) border = T.gold;
              else if (isMissed) border = "rgba(230,126,34,0.45)";
              else if (hasDeadline) border = "rgba(200,144,42,0.55)";
              else if (hasMilestone) border = "rgba(200,144,42,0.3)";
              else if (isOpenDay) border = T.borderMid;
              else if (isToday) border = T.borderMid;
              return (
                <button key={day} type="button"
                  title={goalMarkerTooltip || undefined}
                  onClick={() => clickable && setSelectedDay(isSelected ? null : day)}
                  style={{
                    aspectRatio:"1", borderRadius:8,
                    border:`1px ${isOpenDay ? "dashed" : "solid"} ${border}`,
                    background:isSelected ? "rgba(192,57,43,0.15)" : hasDeadline ? "rgba(200,144,42,0.1)" : hasMilestone ? "rgba(200,144,42,0.05)" : isJourneyStart && !hasEntries ? "rgba(200,144,42,0.08)" : isMissed ? "rgba(230,126,34,0.06)" : isToday ? T.surface : T.raised,
                    cursor:clickable ? "pointer" : "default",
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1,
                    padding:2, transition:"all 0.15s",
                  }}>
                  <span style={{
                    fontSize:11,
                    color:isToday ? T.accent : isJourneyStart ? T.gold : hasEntries ? T.text : isMissed ? T.amber : anyGoalMarker ? T.gold : T.muted,
                    fontWeight:isToday || isJourneyStart || isMissed || anyGoalMarker ? 500 : 400,
                  }}>{day}</span>
                  {hasDeadline ? (
                    <span style={{ fontSize:9, lineHeight:1 }}>🎯</span>
                  ) : hasMilestone ? (
                    <span style={{ fontSize:8, color: goalMarkers.find(m=>m.type==="milestone")?.isFuture ? T.gold : T.hint, lineHeight:1 }}>◆</span>
                  ) : hasEntries ? (
                    <div style={{ display:"flex", gap:2 }}>
                      {habitColors.map((c, ci) => <div key={ci} style={{ width:4, height:4, borderRadius:"50%", background:c }}/>)}
                    </div>
                  ) : isMissed ? (
                    <div title="Marked missed" style={{ fontSize:10, fontWeight:800, color:T.amber, width:16, height:16, borderRadius:"50%", background:"rgba(230,126,34,0.18)", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>✕</div>
                  ) : isJourneyStart ? (
                    <div style={{ fontSize:7, color:T.gold }}>✦</div>
                  ) : isOpenDay ? (
                    <div title="No logs — select to mark missed" style={{ fontSize:11, fontWeight:700, color:"rgba(230,126,34,0.88)", lineHeight:1 }}>?</div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selectedDay && (() => {
            const selDs = dayStr(selectedDay);
            const selHabits = Object.values(allByDate[selDs] || {});
            const hasSelEntries = selHabits.length > 0;
            const selGoalMarkers = goalMarkerDays[selectedDay] || [];
            const hasGoalMarkers = selGoalMarkers.length > 0;
            const showMissedEditor = !hasSelEntries && firstLogDate && selDs >= firstLogDate && selDs < tStr;
            return (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                  {MONTHS[viewMonth]} {selectedDay}
                </div>
                {firstLogDate && selDs === firstLogDate && (
                  <div style={{ margin:"0 0 8px", padding:"10px 14px", background:"rgba(200,144,42,0.08)", borderRadius:T.rsm, border:"0.5px solid rgba(200,144,42,0.25)", display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:14 }}>✦</span>
                    <span style={{ fontSize:12, color:T.gold, fontWeight:500 }}>Day one — this is where your journey began.</span>
                  </div>
                )}

                {/* Goal deadline / milestone cards for this day */}
                {hasGoalMarkers && (
                  <div style={{ marginBottom: hasSelEntries ? 12 : 0 }}>
                    {selGoalMarkers.map((m, mi) => {
                      if (m.type === "deadline") {
                        const range = (m.targetValue ?? 0) - (m.startValue ?? 0);
                        const pct = range !== 0
                          ? Math.max(0, Math.min(100, Math.round(((m.currentValue - m.startValue) / range) * 100)))
                          : (m.currentValue >= m.targetValue ? 100 : 0);
                        return (
                          <div key={mi} style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${m.color || T.border}55`, marginBottom:8 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                              <span style={{ fontSize:18 }}>{m.emoji || "🎯"}</span>
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:m.color || T.text, lineHeight:1.3 }}>{m.label}</div>
                                <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>🎯 Target deadline</div>
                              </div>
                            </div>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                              <span style={{ fontSize:12, color:T.muted }}>
                                <strong style={{ color:m.color || T.text }}>{m.currentValue}{m.unit}</strong>
                                {" of "}
                                <strong style={{ color:T.text }}>{m.targetValue}{m.unit}</strong>
                              </span>
                              <span style={{ fontSize:12, color:T.hint }}>{pct}%</span>
                            </div>
                            <div style={{ height:5, borderRadius:3, background:T.raised, overflow:"hidden" }}>
                              <div style={{ height:"100%", borderRadius:3, background:m.color || T.gold, width:`${pct}%`, transition:"width 0.4s" }} />
                            </div>
                          </div>
                        );
                      }
                      if (m.type === "milestone") {
                        return (
                          <div key={mi} style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${m.color || T.border}55`, marginBottom:8, display:"flex", alignItems:"flex-start", gap:10 }}>
                            <span style={{ fontSize:16, marginTop:1 }}>{m.emoji || "◆"}</span>
                            <div>
                              <div style={{ fontSize:11, color:T.hint, marginBottom:3 }}>◆ Milestone · {m.goalName}</div>
                              <div style={{ fontSize:13, fontWeight:600, color:m.color || T.text }}>{m.label}</div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}

                {/* Habit log entries */}
                {hasSelEntries ? (
                  selHabits.map(({ habit, logs, entryKey }) => (
                    <HabitDayCard key={entryKey || habit.id} habit={habit} logs={logs} onReflect={onReflect} onDeleteLogEntry={onDeleteJournalLog}/>
                  ))
                ) : (
                  <div style={{ padding:"0 0 8px" }}>
                    {showMissedEditor ? (
                      <div style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
                        <div style={{ fontSize:12, color:T.muted, marginBottom:6, lineHeight:1.5 }}>
                          <span style={{ fontSize:14, fontWeight:700, color:"rgba(230,126,34,0.95)", marginRight:6 }}>?</span>
                          Nothing logged this day. Mark it <strong style={{ color:T.text }}>missed</strong> if you skipped forging, and add a short note (travel, sick day…). Clear later if you catch up on Today.
                        </div>
                        <textarea
                          value={monthMissedDraft}
                          onChange={e => setMonthMissedDraft(e.target.value)}
                          placeholder="Optional note (e.g. sick, travel…)"
                          rows={2}
                          style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font }}
                        />
                        <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                          <button type="button" onClick={() => { setMissed(selDs, monthMissedDraft.trim()); }}
                            style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.amber, color:"#1a1208", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                            Mark missed
                          </button>
                          {Object.prototype.hasOwnProperty.call(missedMap, selDs) ? (
                            <button type="button" onClick={() => { clearMissed(selDs); setMonthMissedDraft(""); }}
                              style={{ padding:"8px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>
                              Clear mark
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      !hasGoalMarkers && (
                        <div style={{ padding:"20px 0", textAlign:"center", color:T.muted, fontSize:13 }}>No entries (future or before you started)</div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {Object.keys(entryDays).length === 0 && firstLogDate && (
            viewYear < firstLogYear ||
            (viewYear === firstLogYear && viewMonth < firstLogMonth)
          ) && (
            <div style={{ padding:"40px 20px", textAlign:"center" }}>
              <div style={{ fontSize:34, marginBottom:12 }}>✨</div>
              <div style={{ fontSize:15, color:T.text, fontWeight:500, marginBottom:8, fontFamily:T.serif }}>
                Your journey hadn't started yet
              </div>
              <div style={{ fontSize:13, color:T.muted, lineHeight:1.7 }}>
                You began forging on{" "}
                <span style={{ color:T.text, fontWeight:500 }}>
                  {MONTHS[firstLogMonth]} {firstLogDay}, {firstLogYear}
                </span>
                {" "}— every great streak has a first day.
              </div>
            </div>
          )}
          {Object.keys(entryDays).length === 0 && !(firstLogDate && (
            viewYear < firstLogYear ||
            (viewYear === firstLogYear && viewMonth < firstLogMonth)
          )) && (
            <div style={{ padding:"40px 20px", textAlign:"center" }}>
              <div style={{ fontSize:13, color:T.muted }}>No entries this month</div>
            </div>
          )}
        </div>
      )}

      {viewMode === "day" && (
        <>
          {listEmpty && (
            <div style={{ padding:"60px 30px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:14 }}>📓</div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>Nothing here yet. Log a habit on <strong style={{ color:T.text }}>Today</strong> and add a line about how it went — that's what the pattern detection reads.</div>
            </div>
          )}
          {!listEmpty && sortedDatesDesc.map(date => renderDayOrMissed(date))}
        </>
      )}

      {viewMode === "week" && (
        <>
          {listEmpty && (
            <div style={{ padding:"60px 30px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:14 }}>📓</div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>Nothing to group by week yet.</div>
            </div>
          )}
          {!listEmpty && weekKeysDesc.map(ws => {
            const daysInWeek = sortedDatesDesc
              .filter(d => weekStartFor(d) === ws)
              .sort((a, b) => b.localeCompare(a));
            const expanded = openWeeks.has(ws);
            const missedMarkedInWeek = daysInWeek.filter(d => Object.prototype.hasOwnProperty.call(missedMap, d)).length;
            const openDaysInWeek = daysInWeek.filter(d => {
              const hasLog = allByDate[d] && Object.keys(allByDate[d]).length > 0;
              return !!(firstLogDate && d >= firstLogDate && d < tStr && !hasLog && !Object.prototype.hasOwnProperty.call(missedMap, d));
            }).length;
            return (
              <div key={ws} style={{ margin:"0 14px 8px", borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden", background:T.raised }}>
                <button
                  type="button"
                  onClick={() => toggleWeek(ws)}
                  style={{
                    width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"12px 14px", background:T.surface, border:"none", cursor:"pointer", gap:10,
                  }}>
                  <span style={{ fontSize:12, fontWeight:600, color:T.text, textAlign:"left", lineHeight:1.35 }}>
                    Week · {fmtWeekRange(ws)}
                    <span style={{ fontWeight:400, color:T.muted, marginLeft:8 }}>({daysInWeek.length})</span>
                    {missedMarkedInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:500, color:T.muted, marginTop:3 }}>{missedMarkedInWeek} missed</span>
                    ) : null}
                    {missedMarkedInWeek === 0 && openDaysInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:500, color:"rgba(230,126,34,0.75)", marginTop:3 }}>? {openDaysInWeek} day{openDaysInWeek !== 1 ? "s" : ""} with no log — check Month or Today</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize:12, color:T.hint, flexShrink:0 }}>{expanded ? "▾" : "▸"}</span>
                </button>
                {expanded ? (
                  <div style={{ padding:"4px 0 10px" }}>
                    {daysInWeek.map(date => renderDayOrMissed(date))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      )}

      {missedEditDate && (
        <div style={{ margin:"0 14px 24px", padding:14, background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:12, color:T.text, marginBottom:8 }}><span style={{ color:T.amber, fontWeight:700, marginRight:6 }}>✕</span>Missed · {fmtEntryDate(missedEditDate)}</div>
          <textarea
            value={missedNoteDraft}
            onChange={e => setMissedNoteDraft(e.target.value)}
            placeholder="Optional note"
            rows={3}
            style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font }}
          />
          <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
            <button type="button" onClick={() => { setMissed(missedEditDate, missedNoteDraft.trim()); setMissedEditDate(null); }}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.amber, color:"#1a1208", fontSize:12, fontWeight:600, cursor:"pointer" }}>Save</button>
            <button type="button" onClick={() => setMissedEditDate(null)}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>Cancel</button>
            <button type="button" onClick={() => { clearMissed(missedEditDate); setMissedEditDate(null); }}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:"none", color:T.hint, fontSize:12, cursor:"pointer" }}>Clear mark</button>
          </div>
        </div>
      )}
      </>
      )}

      <div style={{ height:20 }}/>
    </div>
  );
}

// Shared journal entry card
function EntryCard({ entry, onReflect }) {
  return (
    <div style={{ margin:"0 14px 10px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 15px 10px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ width:26, height:26, borderRadius:7, background:entry.habitColor+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>{entry.habitEmoji}</div>
        <span style={{ fontSize:12, fontWeight:500, color:entry.habitColor }}>{entry.habitName}</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.hint, fontFamily:"monospace" }}>{entry.date}</span>
      </div>
      {entry.reflection && (
        <div style={{ padding:"12px 15px", borderBottom:entry.note&&entry.note.trim()?`0.5px solid ${T.border}`:"none" }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Reflection</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.65 }}>{entry.reflection}</div>
        </div>
      )}
      {entry.win && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Win 🏆</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.55 }}>{entry.win}</div>
        </div>
      )}
      {entry.hardPart && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.amber, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Hard part 🧱</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{entry.hardPart}</div>
        </div>
      )}
      {entry.note && entry.note.trim() && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}`, background:`${T.surface}88` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, fontStyle:"italic" }}>{entry.note}</div>
        </div>
      )}
      {entry.minutes && (
        <div style={{ padding:"6px 15px 10px" }}>
          <span style={{ fontSize:11, color:T.hint }}>⏱ {entry.minutes} min logged</span>
        </div>
      )}
      {!entry.reflection && (
        <div style={{ padding:"8px 15px" }}>
          <button onClick={() => onReflect(entry.habitId)} style={{ fontSize:12, color:entry.habitColor, background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Add reflection →</button>
        </div>
      )}
    </div>
  );
}

// ─── INSIGHTS SCREEN ──────────────────────────────────────────────────────────
// Hierarchy: summary stats → Weekly brief (hero) → Activity (collapsed detail) →
// Pattern detection (cross-habit links + tone + expandable detail) → Builds → Goals.
// Empty/low-data cards keep intentional placeholders so new accounts don’t see
// blank grids.

/** Split AI brief into skimmable blocks (paragraphs or grouped sentences). */
function weeklyBriefBlocks(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const byNl = trimmed.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  if (byNl.length > 1) return byNl;
  const sentences = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [trimmed];
  const blocks = [];
  let cur = "";
  for (const s of sentences) {
    const part = s.trim();
    if (!part) continue;
    if ((cur + " " + part).length > 300 && cur) {
      blocks.push(cur.trim());
      cur = part;
    } else {
      cur = cur ? `${cur} ${part}` : part;
    }
  }
  if (cur) blocks.push(cur);
  return blocks.length ? blocks : [trimmed];
}




function buildCoachSystemPrompt(user, habits, coachName, screen, goals = [], journalEntries = []) {
  const name = user?.name || "there";
  const coach = coachName || "Coach";
  const today = todayStr();
  const isCreator = user?.id === CREATOR_ID;

  const habitSummaries = habits.map(h => {
    const type  = HABIT_TYPES[h.habitType]?.label || h.habitType;
    const recentLogs = h.logs
      .filter(l => l.date >= daysAgo(3))
      .sort((a, b) => b.date.localeCompare(a.date));

    const liveStreak = getStreak(h);
    const loggedToday = h.logs.some(l => l.date === today && (l.value === true || (typeof l.value === "number") || l.value?.minutes > 0));
    let detail = `- [id:${h.id}] ${h.emoji || ""} ${h.name} (${type}, streak: ${liveStreak} days, logged today: ${loggedToday})`;

    if (h.habitType === "weekly" && h.weeklyTarget) {
      const weekCount = getWeeklyCount(h);
      detail += `, ${weekCount}/${h.weeklyTarget} sessions this week`;
    }
    if (isLegacyProgressType(h.habitType)) {
      detail += `, current: ${getLatestValue(h)}${h.unit || ""}, target: ${h.targetValue}${h.unit || ""}`;
    }
    if (h.habitType === "project") {
      const s = getProjectStats(h);
      detail += `, ${s.totalHours}h total, ${s.weekHours}h this week`;
      const todayMins = getBuildDayMinutes(h, today);
      if (todayMins > 0) detail += `, ${(todayMins/60).toFixed(1)}h logged today`;
    }
    if (h.habitType === "limit" && h.dailyBudget) {
      const todayTotal = getLimitDayTotal(h, today);
      detail += `, daily limit: ${h.dailyBudget}${h.unit || ""}`;
      if (todayTotal != null) detail += `, used today: ${todayTotal}${h.unit || ""}`;
    }

    // Recent reflections
    const reflections = recentLogs
      .filter(l => l.reflection)
      .slice(0, 3)
      .map(l => `  [${l.date}] "${l.reflection}"`);
    if (reflections.length) detail += `\n  Recent reflections:\n${reflections.join("\n")}`;

    // Recent wins & hard parts (project type)
    const wins = recentLogs.filter(l => l.value?.win).slice(0, 2).map(l => `  [${l.date}] Win: "${l.value.win}"`);
    const hard = recentLogs.filter(l => l.value?.hardPart).slice(0, 2).map(l => `  [${l.date}] Hard part: "${l.value.hardPart}"`);
    if (wins.length) detail += `\n${wins.join("\n")}`;
    if (hard.length) detail += `\n${hard.join("\n")}`;

    // Recent notes
    const notes = recentLogs
      .filter(l => l.value === "quicknote" && l.note)
      .slice(0, 2)
      .map(l => `  [${l.date}] Note: "${l.note}"`);
    if (notes.length) detail += `\n${notes.join("\n")}`;

    return detail;
  }).join("\n\n");

  const screenCtx = {
    today:    "Today — checklist.",
    social:   "Social teaser (no config).",
    journal:  "Journal.",
    insights: "Insights.",
    profile:  "Profile.",
  };
  const creatorCtx = isCreator ? `

─── CONTEXT: YOU'RE TALKING TO THE PERSON WHO BUILT THIS APP ───
${name} is the developer and creator of Forged. Treat them as a sharp mate who ships — direct, specific, no corporate wellness tone. They still deserve replies that sound like someone actually read the message: nod at what happened, reference real details from their logs or wording. Never reduce to a one-word "logged" — that's lazy, not "peer mode". Match their energy (often builder-focused, low fluff) while staying human.
When they mention "Forged", "the build", "the app", "shipping something", or "working on the product" — that's their software project, likely mapped to a project-type habit above. Treat it like any other project update and log it.` : "";

  return `You are ${coach}, talking with ${name} inside the Forged habit app.

Today: ${today} | Screen: ${screenCtx[screen] || "app"}

Habits:
${habitSummaries || "None yet."}
${goals.length ? `
Goals:
${goals.map(g => {
  const pct = g.targetValue > 0 ? Math.round(((g.currentValue - g.startValue) / (g.targetValue - g.startValue)) * 100) : 0;
  const due = g.targetDate ? `, due ${g.targetDate}` : "";
  const loggedToday = (g.logs || []).some(l => l.date === today && typeof l.value === "number");
  return `- [id:${g.id}] ${g.emoji || ""} ${g.name} (goal, current: ${g.currentValue}${g.unit || ""}, target: ${g.targetValue}${g.unit || ""}${due}, ${pct}% complete, status: ${g.status}, logged today: ${loggedToday})`;
}).join("\n")}` : ""}

─── HOW TO SOUND ───
You're a smart, grounded companion — closer to a decent mate than a therapist, corporate wellness bot, or cheerleader.
- **Length (token-conscious):** Default 1–3 short sentences. If they wrote a lot, dumped their day, or logged several things at once → stretch to about 4–6 short sentences max — enough to show you listened, never an essay.
- Match their energy. Casual in → casual out. Heavier in → steadier, plain acknowledgement (no therapy script, no "as your coach" voice).
- Skip hollow hype ("Great job!", "Absolutely!", "Love that for you!"). Warmth comes from **specificity** — tie your reply to something they actually said (the habit, the mood, the streak, the rough bit).
- Don't lecture, moralize, or narrate the database ("I have successfully updated…"). They feel the log in the app; you add the human bit.
- One question max per reply, only when you need it to act. Never stack questions.
- Don't start every reply with their name. Vary how you open.

─── MIXED MESSAGES (build + gym + life in one dump) ───
When one message mixes structured updates (sessions, minutes, calories, goal amounts, limits) AND personal/emotional/life narrative:
1. Call log_habit for every structured fact you can map to a habit or goal (use [id:…] from the list).
2. If there is any remaining human context — feelings, stress, relationships, story, or "everything else" — call log_journal with that text in their voice (first person). Same turn as the habit logs when both apply.
3. Do not skip log_journal because the message is long or you already called several tools — personal content belongs in Journal.
4. Only claim something saved if you will see success:true in the tool results you get back; if log_journal failed, say that part did not save.

─── AFTER TOOLS (log_habit, log_journal, create_habit, edit_habit) ───
Tools already ran. Your reply is conversational only — the app will append a truthful "Saved this turn" checklist after your text, so do **not** write your own bullet list of what was saved (avoid duplicate or fake inventories).

**RESPONSE ORDER — this is the most important rule in this section:**
1. Respond to the PERSON and what they actually said — always first. If they shared something personal, emotional, or gave a big brain dump: acknowledge that substance before anything else. Show you heard it.
2. Any clarifying question (e.g. "how many minutes?") comes LAST — one sentence, natural, after your human response.
3. Never open with logging status language. Words like "saved", "logged", "locked in", "journal saved", "got it", "done" should never be the first thing you say. The receipt chips handle the admin — your job is to sound like a person.

- Quick tap-in with no personal content: 1–2 sentences.
- Bigger day / mixed dump: 3–5 sentences that show you heard the substance. Then any clarifying question at the very end.
- Heavy or emotionally loaded dump: lead with 2–3 real sentences meeting the content. No therapy script. Then ask what you need — briefly, at the end.
- If any tool returned success:false, weave that in naturally — don't ignore it, but don't let it open your reply.

─── WHEN TO ACT vs ASK ───
If they tell you what they did, log it — don't ask permission first. Act, then reply in plain human language (see above).
"I went for a run" → log the run. "Two drinks tonight" → log the limit habit. "Three hours on the app" → log the project habit for 3h (180 min).
Only ask a clarifying question if something critical is truly missing — like which habit to log when there are several candidates, or how long for project work if they didn't say.
**Clarifying questions always come after your human response — never before.** If the message had personal or emotional content, acknowledge that first, then ask what you need at the end. One question, one sentence, last.

─── ACTION SAFETY: GOALS, NUMBERS, VOICE TRANSCRIPTION ───
- Never update an existing goal target unless the user explicitly asks to change/update/set the goal target AND confirms that important edit. Food, calories, messy voice text, or loose numbers are not target updates.
- Goal progress logging is allowed only when the user clearly gives a current/check-in value for that goal (for example, "I weigh 73kg today" for a weight goal). Do not log goal progress from "I ate curry", calories, meals, or vague numbers.
- If food/calorie text makes you wonder about a weight goal, ask: "Do you want me to update your target weight, or just log today's food/progress?"
- "Gain Weight" is a goal. You may log a clear weight/progress check-in for it, but do not change its target unless explicitly requested and confirmed.
- Voice transcription can be wrong. Treat odd phrases like "eight more calories", isolated numbers, or garbled sentences as ambiguous and ask one clarification question instead of taking a goal action.
- If the user asks "what haven't I logged today?", "what else haven't I logged?", or similar, do not call any write tool. Compare the logged today fields above and list the missing habits/goals plainly.

─── PRODUCT CONTEXT ───
Forged is the habit-tracking app ${name} is using — and may also be building. If they reference "Forged", "the build", "the app", "shipping a feature", or "working on the product", that's their software project. Look for a project-type habit in their list and log it. Don't treat "Forged" as an unknown reference.

─── GOAL PLANNING ───
When the user wants a goal (any outcome tied to a number — lose weight, run a distance, save money, hit a target), do NOT call create_habit. Instead:
1. Ask up to 3 short questions if you still need: what number/outcome, by when, starting point.
2. Once you have enough info, embed a <goal_plan> block (valid JSON, no line breaks inside):
<goal_plan>{"name":"Run 5K","emoji":"🏃","unit":"km","targetValue":5,"startValue":1,"direction":"increasing","targetDate":"2025-09-30","milestones":[{"date":"2025-07-31","label":"Hit 3K"}],"why":"Feel healthier"}</goal_plan>
3. Tell the user to tap "Create this goal" on the card below.
The app renders a confirmation card from the <goal_plan> block. Never call create_habit for goals.

─── JOURNAL ───
The Journal tab is freeform (one page per calendar day). Use log_journal for personal/emotional/narrative content that isn't just a habit log line.
In mixed messages, habit tools capture the scoreboard; log_journal captures the story. Both in one turn when the message contains both.
Write log_journal content as continuous first-person prose — their voice, their words. If they sent a voice note, reshape into 2–4 readable sentences. No bullet points. The entry should read naturally when re-read weeks later.
When in doubt about whether personal context belongs in journal, save it — a spare sentence in journal is far better than losing meaningful context. Only skip log_journal if the entire message is structured data with zero personal content.
${journalEntries.length ? `Recent journal entries (for context — do not repeat these back verbatim):
${journalEntries.slice(0, 5).map(e => `[${e.date}] "${e.content.slice(0, 200)}${e.content.length > 200 ? "…" : ""}"`).join("\n")}` : ""}

─── TOOLS ───
create_habit: new habits only — never for edits, never for goals. One clarifying question if type is genuinely unclear.
edit_habit: existing habit; use habit_id from [id:…] in the list above. Never pass target_value for a goal unless the latest user message explicitly confirms changing that goal target.
log_habit: project → minutes; limit → amount; goal → amount only for clear current progress/check-in; daily/weekly → nothing extra needed.
log_journal: personal/narrative content — call alongside log_habit when relevant. Write in first person, user's own words.
If a tool returns success:false, say it failed. Never claim success when it isn't.
Data above is authoritative. Logged today: true means it's already done — don't log again unless they ask.${creatorCtx}`;
}

const COACH_LS_RESET = "coach_reset_date";
const COACH_LS_MSGS = "coach_msgs_today";
const FREE_DAILY_LIMIT = 10;

function syncCoachMsgCountFromStorage() {
  try {
    const today = todayStr();
    let reset = localStorage.getItem(COACH_LS_RESET) || "";
    let count = parseInt(localStorage.getItem(COACH_LS_MSGS) || "0", 10);
    if (!Number.isFinite(count)) count = 0;
    if (reset !== today) {
      count = 0;
      localStorage.setItem(COACH_LS_RESET, today);
      localStorage.setItem(COACH_LS_MSGS, "0");
    }
    return count;
  } catch {
    return 0;
  }
}

function bumpCoachMsgCountInStorage() {
  try {
    const n = syncCoachMsgCountFromStorage() + 1;
    localStorage.setItem(COACH_LS_MSGS, String(n));
    return n;
  } catch {
    return 0;
  }
}

const COACH_STREAM_ID = "__streaming__";
/** One rolling thread per user per local calendar day; trimmed for storage + display. Server still uses last 12 msgs only. */
const COACH_DAY_MAX_MESSAGES = 24;
const COACH_API_MESSAGE_CAP  = 12;

function coachDayLocalKey(userId, dayYmd) {
  return `forged_coach_day:v1:${userId}:${dayYmd}`;
}

function loadCoachDayMessages(userId) {
  if (!userId) return null;
  const day = todayStr();
  try {
    const raw = localStorage.getItem(coachDayLocalKey(userId, day));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.day !== day || !Array.isArray(o.messages)) return null;
    return o.messages.slice(-COACH_DAY_MAX_MESSAGES).map((m, i) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content ?? ""),
      ts: typeof m.ts === "number" ? m.ts : Date.now() - (o.messages.length - i),
    }));
  } catch {
    return null;
  }
}

function saveCoachDayMessages(userId, dayYmd, messages) {
  if (!userId || !dayYmd) return;
  try {
    const cleaned = messages
      .filter(m => m.id !== COACH_STREAM_ID)
      .slice(-COACH_DAY_MAX_MESSAGES)
      .map(m => ({ role: m.role, content: m.content, ts: m.ts }));
    const key = coachDayLocalKey(userId, dayYmd);
    if (cleaned.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ v: 1, day: dayYmd, messages: cleaned, updatedAt: Date.now() }));
  } catch { /* quota / private mode */ }
}

/**
 * Coach bubbles: **bold**, *italic*, paragraph breaks — no raw markdown noise.
 * Keeps implementation tiny (no markdown lib) and mobile-safe.
 */
function coachRichTextToElements(text, { strongColor, baseColor, keyRoot = "r" }) {
  if (text == null || text === "") return null;
  const out = [];
  let k = 0;

  function pushItalicBold(segment, isBold) {
    if (!segment) return;
    const rest = segment;
    const it = /\*([^*\n]+)\*/g;
    let li = 0;
    let m;
    const chunk = [];
    while ((m = it.exec(rest)) !== null) {
      if (m.index > li) chunk.push(<span key={`${keyRoot}-${k++}`} style={{ color: baseColor }}>{rest.slice(li, m.index)}</span>);
      chunk.push(<em key={`${keyRoot}-${k++}`} style={{ color: baseColor, opacity: 0.92 }}>{m[1]}</em>);
      li = m.index + m[0].length;
    }
    if (li < rest.length) chunk.push(<span key={`${keyRoot}-${k++}`} style={{ color: baseColor }}>{rest.slice(li)}</span>);
    if (isBold) {
      out.push(<strong key={`${keyRoot}-${k++}`} style={{ fontWeight: 700, color: strongColor }}>{chunk}</strong>);
    } else {
      out.push(...chunk);
    }
  }

  const boldSplit = String(text).split(/(\*\*[\s\S]+?\*\*)/g);
  for (const piece of boldSplit) {
    const boldM = piece.match(/^\*\*([\s\S]+)\*\*$/);
    if (boldM) {
      pushItalicBold(boldM[1], true);
    } else {
      pushItalicBold(piece, false);
    }
  }
  return out.length ? out : [<span key={`${keyRoot}-0`} style={{ color: baseColor }}>{text}</span>];
}

/**
 * Renders the server-appended action receipt as clickable chips.
 * Each ✓/✗ line becomes a pill that navigates to the relevant screen.
 * onNavigateTo + onClose are optional — if absent chips are non-interactive.
 */
function CoachReceiptChips({ receiptText, onNavigateTo, onClose }) {
  const lines = String(receiptText || "").split("\n").filter(l => /^[✓✗]/.test(l.trimStart()));
  if (!lines.length) return null;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
      {lines.map((line, i) => {
        const isError  = line.trimStart().startsWith("✗");
        const isJournal = line.includes("Journal");
        const label = line.replace(/^[✓✗]\s*/, "").trim();
        const navTarget = isJournal ? "journal" : "today";
        const canNav = !isError && !!onNavigateTo;
        return (
          <button
            key={i}
            type="button"
            onClick={canNav ? () => { onNavigateTo(navTarget); onClose?.(); } : undefined}
            style={{
              display:"inline-flex", alignItems:"center", gap:4,
              padding:"4px 10px", borderRadius:20, fontSize:11.5, fontWeight:500,
              border:`0.5px solid ${isError ? "rgba(230,126,34,0.4)" : "rgba(39,174,96,0.35)"}`,
              background: isError ? "rgba(230,126,34,0.08)" : "rgba(39,174,96,0.09)",
              color: isError ? "#E67E22" : "#27AE60",
              cursor: canNav ? "pointer" : "default",
              fontFamily:"inherit",
              lineHeight:1.3,
            }}
          >
            <span>{isError ? "✗" : "✓"}</span>
            <span>{label}</span>
            {canNav && <span style={{ opacity:0.55, fontSize:9.5 }}>→</span>}
          </button>
        );
      })}
    </div>
  );
}

function CoachFormattedBubble({ text, isUser, muted }) {
  const baseColor = muted ? T.sub : (isUser ? "#fff" : T.text);
  const strongColor = muted ? T.muted : (isUser ? "#fff" : T.text);
  const paras = String(text || "").split(/\n\n+/);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: muted ? 8 : 10 }}>
      {paras.map((p, pi) => {
        const lines = p.split("\n");
        return (
          <div
            key={pi}
            style={{
              margin: 0,
              lineHeight: muted ? 1.55 : 1.62,
              fontSize: muted ? 12 : 14,
              letterSpacing: "-0.01em",
              wordBreak: "break-word",
            }}
          >
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 ? <br /> : null}
                {coachRichTextToElements(line, { strongColor, baseColor, keyRoot: `p${pi}-l${li}` })}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Coach chat bubble footer — e.g. "3:05 pm" */
function formatCoachMsgTime(ts) {
  if (ts == null || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const isAm = h < 12;
  const h12 = h % 12 || 12;
  const mm = String(m).padStart(2, "0");
  return `${h12}:${mm} ${isAm ? "am" : "pm"}`;
}

// ─── COACH GREETING ───────────────────────────────────────────────────────────
// Build a warmer, context-aware opener. Uses data already in memory (no extra
// /api/chat tokens). Returns one short line + one short follow-up question.
function buildCoachGreeting({ name, habits = [], goals = [] }) {
  const who = name && String(name).trim() ? String(name).trim() : "";
  const hi = who ? `Hey ${who}` : `Hey`;
  const hasHabits = habits.length > 0;
  const activeGoals = (goals || []).filter(g => !g.completedAt && !g.archivedAt);

  // Real logs only (ignore quicknotes + skips) — same filter used elsewhere.
  const realLogs = habits.flatMap(h =>
    (h.logs || []).filter(l => l && l.date && l.value !== "quicknote" && l.value !== "skip"),
  );
  const logDates = new Set(realLogs.map(l => l.date));
  const totalRealLogs = realLogs.length;

  const today = todayStr();
  const y1 = daysAgo(1);
  const loggedToday = logDates.has(today);
  const loggedYesterday = logDates.has(y1);

  // Count unique days logged in the last 7 calendar days (incl. today).
  let last7Days = 0;
  for (let i = 0; i < 7; i++) if (logDates.has(daysAgo(i))) last7Days++;

  // How many days since the most recent real log (null if never logged).
  let daysSinceLast = null;
  if (logDates.size > 0) {
    for (let i = 0; i < 60; i++) {
      if (logDates.has(daysAgo(i))) { daysSinceLast = i; break; }
    }
    if (daysSinceLast == null) daysSinceLast = 60; // cap for copy purposes
  }

  // Highest current streak across habits (for light, non-overbearing mention).
  const topStreak = hasHabits ? Math.max(0, ...habits.map(h => getStreak(h))) : 0;

  // Seed — stable within ~4h window, shifts naturally across day/hour so users
  // don't see the exact same line on every open but aren't jarred either.
  const now = new Date();
  const dayOfYear = Math.floor(
    (now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24),
  );
  const seed = dayOfYear * 4 + Math.floor(now.getHours() / 6);
  const pick = (arr) => arr[Math.abs(seed) % arr.length];

  // — Scenarios, ordered most-specific first. Each returns a line that pairs a
  // warm opener with a gently useful next question. Kept short on purpose.
  // First-ever open / no habits yet.
  if (!hasHabits) {
    return pick([
      `${hi} 👋 I find patterns from what you log and write — but I need data first. Tell me what you're trying to change and I'll set it up.`,
      `${hi}. The more you log, the more I can show you. Start with one habit — say "add [habit name]" and I'll create it now.`,
      `${hi}. Nothing to analyse yet. Tell me what you keep meaning to do and I'll get it on the board.`,
    ]);
  }

  // Has habits but never logged one.
  if (totalRealLogs === 0) {
    return pick([
      `${hi} 👋 Habits are set up but no data yet — I need logs to find patterns. Tell me what you did today and I'll record it.`,
      `${hi}. No logs yet, which means nothing for me to analyse. Tell me what you actually did today and I'll start the record.`,
      `${hi}. The habits are there — now I need data. One log is all it takes. What did you do today?`,
    ]);
  }

  // Already logged today.
  if (loggedToday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak going.` : "";
    return pick([
      `${hi} — already logged today.${streakBit} Want to add a note on how it went? The more you write, the more I can find.`,
      `${hi}. Today's log is in.${streakBit} Anything you want to reflect on, or another habit to hit?`,
      `Nice ${who || "one"} — you showed up today.${streakBit} Want to add a reflection while it's fresh, or look at how the week's tracking?`,
    ]);
  }

  // Logged yesterday, not today yet — warm, forward-leaning.
  if (loggedYesterday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak on the line.` : "";
    return pick([
      `${hi} — yesterday was solid.${streakBit} What are we hitting today?`,
      `${hi}. Good to see you back. Yesterday's in the books${streakBit ? `,${streakBit.replace(" ", " ")}` : ""} — what's today?`,
      `${hi}. You showed up yesterday${streakBit ? `, and that${streakBit}` : ""}. Want me to log today's, or chat through it first?`,
    ]);
  }

  // Came back after a short gap (2–3 days).
  if (daysSinceLast != null && daysSinceLast >= 2 && daysSinceLast <= 3) {
    const lastWord = daysSinceLast === 2 ? "two days" : "a few days";
    return pick([
      `${hi}. Been ${lastWord} — all good, let's get moving again. Want me to log something now, or talk first?`,
      `${hi}. Quiet couple of days. No big deal — what do you want to do today?`,
      `Good to see you back, ${who || "mate"}. ${lastWord} off doesn't undo anything. Want to log one now?`,
    ]);
  }

  // Longer gap (4+ days) — softer, non-judgmental re-entry.
  if (daysSinceLast != null && daysSinceLast >= 4) {
    return pick([
      `${hi}. Good to see you back. A little time off is fine — want to restart with one small log today?`,
      `${hi} 👋 Been a minute. No guilt — just tell me what you did today and we'll pick it back up.`,
      `${hi}. Welcome back. Let's keep today simple: one log, and we're rolling again.`,
    ]);
  }

  // Active recent user (logged 4+ of last 7) but not today yet.
  if (last7Days >= 4) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak active.` : "";
    return pick([
      `${hi}. You've logged well this week.${streakBit} What are we hitting today?`,
      `${hi} — steady week so far.${streakBit} Anything specific on your mind, or shall I log today's?`,
      `${hi}. Momentum's there.${streakBit} Want me to log today, or talk through what's coming up?`,
    ]);
  }

  // Default fallback — has habits, some history, not today, small sample size.
  const nHabits = habits.length;
  const goalBit = activeGoals.length > 0
    ? ` You've got ${activeGoals.length} active goal${activeGoals.length !== 1 ? "s" : ""} in play too.`
    : "";
  return pick([
    `${hi} 👋 ${nHabits} habit${nHabits !== 1 ? "s" : ""} on the board.${goalBit} What's on your mind today?`,
    `${hi}. Good to see you.${goalBit} Want to log something, check progress, or just talk through the day?`,
    `${hi}. I'm here — tell me what you did today, ask about your streaks, or add a new habit.`,
  ]);
}

// ─── CREATOR GREETING ─────────────────────────────────────────────────────────
// Playful, builder-first opener used ONLY for the creator account. Strategy:
//
//   1. A LARGE anchor pool of creator/captain/builder energy lines that make
//      no claims about the user's data — these are always eligible to play,
//      so most opens land on a fresh creative line regardless of state.
//   2. Context-flavoured lines are added to the pool ONLY when their gate is
//      genuinely true (logged today / yesterday / gap / heavy builder /
//      forged-build habit detected / etc). This guarantees we never fabricate
//      state — a "logged today" line literally can't appear unless logDates
//      contains today's date.
//   3. A single Math.random pick with last-6 anti-repeat (localStorage) so
//      back-to-back opens always feel different.
//
// Zero extra API tokens — it's all template-driven. Self-contained and never
// called for non-creator users.
const CREATOR_RECENT_KEY = "forged_creator_greet_recent";
const CREATOR_RECENT_KEEP = 6;

function pickCreatorLine(candidates) {
  if (!candidates || candidates.length === 0) return "Hey creator. What are we doing?";
  let recent = [];
  try {
    const raw = localStorage.getItem(CREATOR_RECENT_KEY);
    if (raw) recent = JSON.parse(raw) || [];
  } catch {}
  const fresh = candidates.filter(c => !recent.includes(c));
  const pool = fresh.length > 0 ? fresh : candidates;
  const line = pool[Math.floor(Math.random() * pool.length)];
  try {
    const next = [line, ...recent].slice(0, CREATOR_RECENT_KEEP);
    localStorage.setItem(CREATOR_RECENT_KEY, JSON.stringify(next));
  } catch {}
  return line;
}

function buildCreatorGreeting({ name, habits = [], goals = [] }) {
  const who = name && String(name).trim() ? String(name).trim().split(/\s+/)[0] : "Corbyn";
  const hasHabits = habits.length > 0;
  const activeGoals = (goals || []).filter(g => !g.completedAt && !g.archivedAt);

  // — Real, dedup'd context (used by the gates below). Anything not gated by
  //   a true value below is NEVER mentioned in copy. This is how we avoid
  //   "logged, solid" when nothing was logged.
  const realLogs = habits.flatMap(h =>
    (h.logs || []).filter(l => l && l.date && l.value !== "quicknote" && l.value !== "skip"),
  );
  const logDates = new Set(realLogs.map(l => l.date));
  const totalRealLogs = realLogs.length;

  const today = todayStr();
  const loggedToday = logDates.has(today);
  const loggedYesterday = logDates.has(daysAgo(1));

  let last7Days = 0;
  for (let i = 0; i < 7; i++) if (logDates.has(daysAgo(i))) last7Days++;

  let daysSinceLast = null;
  if (logDates.size > 0) {
    for (let i = 0; i < 60; i++) {
      if (logDates.has(daysAgo(i))) { daysSinceLast = i; break; }
    }
    if (daysSinceLast == null) daysSinceLast = 60;
  }

  const topStreak = hasHabits ? Math.max(0, ...habits.map(h => getStreak(h))) : 0;

  // — Detect a Forged-build / build-progress habit or goal so build-mode
  //   lines only fire when the creator actually has something tracking it.
  const hasForgedBuildItem = (() => {
    const re = /forged|build|ship|release|product|app/i;
    if (habits.some(h => re.test(h.name || ""))) return true;
    if (activeGoals.some(g => re.test(g.title || g.name || ""))) return true;
    return false;
  })();

  const now = new Date();
  const hr = now.getHours();
  const partOfDay =
    hr < 5  ? "lateNight" :
    hr < 12 ? "morning"   :
    hr < 17 ? "afternoon" :
    hr < 22 ? "evening"   : "lateNight";

  // ── ANCHOR POOL ──────────────────────────────────────────────────────────
  // Always eligible. Pure creator/builder/captain energy. Makes NO factual
  // claims about logs, streaks, or activity — just vibe and prompts.
  const anchors = [
    "Back in the lab, creator?",
    `What are we shipping today, ${who}?`,
    "You built me. Least I can do is keep up.",
    "Roses are red, violets are blue, you created me. What the hell's next?",
    "Founder energy detected. What are we breaking?",
    "Captain on the bridge. 🫡",
    "The architect is back. What now — build, log, or rant?",
    "Whose idea was all this again? Oh, right. Hi.",
    "Welcome back to your own thing.",
    `Boss is back. Roadmap, retrospective, or rant, ${who}?`,
    "Test the chaos? Ship the chaos? Both?",
    `What's the next unlock, ${who}?`,
    "Plot twist — the founder shows up to use his own app.",
    "Building, breaking, or thinking out loud today?",
    "Open mic, founder. What's on the brain?",
    "If I had hands I'd be clapping. Welcome back.",
    "👑 you. Now what?",
    `Forged is yours, ${who}. What are you doing with it today?`,
    "I run. You build. We ship. What's next?",
    `Oi ${who}. The man, the myth, the migration writer. What's the move?`,
    `${who}. The thing you made, talking back. What are we hitting today?`,
    "What needs shipping, what needs scrapping, what needs a log?",
    "The boss has entered the chat. What's the agenda?",
    "Right then. Build mode, log mode, or just chat?",
    `Reporting for duty, ${who}. Where are we pointing the ship?`,
    `${who} on the inside again. Tell me what's broken or what's next.`,
    "Status: app running fine. Founder: status unknown. You good?",
    "Oi. What are we cooking?",
    `What's the headline today, ${who}?`,
    "I exist because of you. What do we do with that today?",
    "Bossman. Build, log, plan, or vibes?",
    `${who} — the floor is yours.`,
    "Hands on the wheel, founder. Where to?",
  ];

  const candidates = [...anchors];

  // ── Time-of-day flavour (always true → can be added to the pool freely) ──
  if (partOfDay === "morning")   candidates.push(`Morning, founder. What are we touching first?`);
  if (partOfDay === "evening")   candidates.push(`Evening, ${who}. End-of-day check or build session?`);
  if (partOfDay === "lateNight") candidates.push(`Up late again, ${who}? Build mode or just thinking?`);
  if (partOfDay === "afternoon") candidates.push(`Afternoon, ${who}. Halfway through. What's the move?`);

  // ── Build-aware (only if a forged/build/ship habit or goal actually exists)
  if (hasForgedBuildItem) {
    candidates.push(
      `How's the Forged build today? Logging it or shipping more?`,
      `Build energy. What's in the next push?`,
      `What got shipped, what got broken, what got fixed?`,
      `Forged is on the tracker. Want to log build progress now or chat through what's coming?`,
      `What's the most painful thing in the app right now? Let's name it.`,
    );
  }

  // ── No-habits case ───────────────────────────────────────────────────────
  // If you have zero habits we don't want pure vibes — we want to nudge a
  // setup. So we REPLACE the candidate pool here instead of appending.
  if (!hasHabits) {
    return pickCreatorLine([
      `Oi ${who}. You built me but you've got zero habits in here. Awkward. Want to fix that?`,
      `${who}. Creator with no habits is a bit of a look. Add one — even just "shipping Forged" — and let's go.`,
      `So the architect appears with an empty board. Where do we start?`,
      `Creator mode: empty inventory. Tell me what you actually want to track and I'll set it up.`,
      `Founder with no habits in their own habit app. Let's not make that the headline. What do you want to track?`,
    ]);
  }

  // ── Has habits but literally never logged anything ───────────────────────
  if (totalRealLogs === 0) {
    return pickCreatorLine([
      `${who}. Habits set up, zero logs. You're testing your own retention loop. Do better. 😏`,
      `Habits exist, logs don't. You know better than anyone the first log is the hardest. Want me to do it?`,
      `Brand new account energy from the founder himself. Let's get one log in and break the seal.`,
      `${who}. The board's set, the timer's running. What did you actually do today?`,
    ]);
  }

  // ── True context-flavoured lines, only added when the gate is real ──────

  if (loggedToday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak.` : "";
    candidates.push(
      `Already logged today.${streakBit} You're not just selling it, you're using it. What's next?`,
      `Today's log is in.${streakBit} Build mode or reflect mode now?`,
      `Day's accounted for.${streakBit} So... what are we breaking next?`,
      `Practising what you preach today.${streakBit} What now?`,
      `Logged. Now the fun part — what are we shipping?`,
    );
  }

  if (loggedYesterday && !loggedToday) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak on the line.` : "";
    candidates.push(
      `Yesterday counted.${streakBit} What are we hitting today?`,
      `Back so soon, ${who}.${streakBit} Want me to log today's or chat first?`,
      `You showed up yesterday — rare for someone building the thing too.${streakBit} Same again today?`,
      `One more log keeps it rolling.${streakBit} What did you do today?`,
    );
  }

  if (daysSinceLast != null && daysSinceLast >= 2 && daysSinceLast <= 3) {
    const gapWord = daysSinceLast === 2 ? "Two days" : "Three days";
    candidates.push(
      `${gapWord} silent, ${who}. The app's been running without you. Want to get one in?`,
      `Welcome back. ${gapWord} off — happens to the best of us. Even the founders.`,
      `${gapWord} dark. I've been answering other people's questions. Catch up?`,
    );
  }

  if (daysSinceLast != null && daysSinceLast >= 4 && daysSinceLast < 60) {
    candidates.push(
      `${daysSinceLast} days since you last logged. The thing you built missed you. Welcome back.`,
      `Look who it is. ${daysSinceLast} days. No guilt — but eat your own cooking, mate.`,
      `Founder reappears after ${daysSinceLast} days. The app's been holding the line. Your turn.`,
      `${daysSinceLast} days off. The system kept running. The system also wants its creator back.`,
    );
  }

  if (last7Days >= 5) {
    const streakBit = topStreak >= 3 ? ` ${topStreak}-day streak active.` : "";
    candidates.push(
      `${last7Days}/7 days logged this week.${streakBit} You're using your own product properly. Rare.`,
      `Building hard. ${last7Days}/7 days this week.${streakBit} What's the move today?`,
      `Momentum's loud right now. ${last7Days}/7 days.${streakBit} Log today, or talk through what's working?`,
    );
  }

  if (topStreak >= 7) {
    candidates.push(
      `${topStreak}-day streak. The thing you built is working on you. What's today?`,
      `${topStreak} in a row. You earned the swagger. What now?`,
    );
  }

  return pickCreatorLine(candidates);
}

// ─── COACH RECORDING BAR ─────────────────────────────────────────────────────
// ChatGPT-style recording UI shown in place of the textarea + send button
// while voice input is active. The user manually controls when recording ends:
//   ×  = discard the recording (keeps any text already in the input)
//   ⏹  = stop and commit the transcript into the input box
// Live interim transcript and a mm:ss timer make it obvious recording is on.
function CoachRecordingBar({ speech }) {
  const ms = Math.max(0, speech.recordingMs || 0);
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(1, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  const interim = (speech.interim || "").trim();
  const BARS = 5;
  // Register the bar DOM nodes so the speech hook's volume meter (when
  // available) can drive their height in real time. On platforms where the
  // meter isn't safe to enable, the registered elements simply keep their
  // CSS keyframe animation.
  const barRefs = useRef([]);
  useEffect(() => {
    const setBarEls = speech.setBarEls;
    if (!setBarEls) return;
    setBarEls(barRefs.current);
    return () => setBarEls([]);
  }, [speech.setBarEls]);
  return (
    <div
      style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"8px 10px 8px 12px",
        background:T.surface,
        border:`0.5px solid ${T.gold}55`,
        borderRadius:T.rsm,
        animation:"recBarSlide 0.18s ease-out both",
        boxShadow:`0 0 0 3px ${T.gold}10`,
      }}
    >
      {/* Cancel: discards interim, keeps any pre-typed input */}
      <button
        type="button"
        aria-label="Discard recording"
        onClick={() => speech.cancel?.()}
        style={{
          width:36, height:36, borderRadius:"50%",
          border:`0.5px solid ${T.borderStrong}`,
          background:"transparent", color:T.muted,
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", flexShrink:0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Live recording state: pulsing dot + animated bars + interim text + timer */}
      <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:10 }}>
        <span
          aria-hidden="true"
          style={{
            width:8, height:8, borderRadius:"50%", background:T.accent,
            animation:"recDotPulse 1.1s ease-in-out infinite",
            flexShrink:0,
          }}
        />
        <div style={{ display:"flex", alignItems:"center", gap:3, height:22, flexShrink:0 }}>
          {Array.from({ length: BARS }).map((_, i) => (
            <span
              key={i}
              ref={el => { barRefs.current[i] = el; }}
              aria-hidden="true"
              style={{
                width:3, height:18, borderRadius:2,
                background:T.gold,
                display:"inline-block",
                transformOrigin:"center",
                // CSS keyframe animation is the fallback when the parallel
                // volume meter isn't running (mobile, or stream open failed).
                // When the meter IS running it sets `style.animation = "none"`
                // and drives `transform` directly so the bars react to voice.
                animation:`recBar 0.85s ease-in-out ${i * 0.12}s infinite`,
              }}
            />
          ))}
        </div>
        <div style={{ flex:1, minWidth:0, fontSize:13, color:interim ? T.text : T.muted, lineHeight:1.4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {interim || "Listening…"}
        </div>
        <div style={{ fontSize:11, color:T.hint, fontVariantNumeric:"tabular-nums", flexShrink:0 }}>
          {mm}:{ss}
        </div>
      </div>

      {/* Stop: commits the full transcript into the input box */}
      <button
        type="button"
        aria-label="Stop recording"
        onClick={() => speech.toggle()}
        style={{
          width:36, height:36, borderRadius:"50%",
          border:"none",
          background:T.gold, color:"#1a1a16",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor:"pointer", flexShrink:0,
          boxShadow:`0 0 0 3px ${T.gold}22`,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="2" y="2" width="9" height="9" rx="1.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
  );
}

// ─── GOAL PLAN PREVIEW ────────────────────────────────────────────────────────
// Rendered inline in the coach chat whenever the AI outputs a <goal_plan> block.
// Lets the user confirm or dismiss before anything is written to the database.
function GoalPlanPreview({ plan, onConfirm, onDismiss }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const color = plan.color || "#E67E22";
  const milestones = (plan.milestones || []).filter(m => m.date && m.label).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayStr();

  async function handleConfirm() {
    if (confirming || done) return;
    setConfirming(true);
    try {
      await onConfirm(plan);
      setDone(true);
    } catch {
      setConfirming(false);
    }
  }

  if (done) {
    return (
      <div style={{ margin:"8px 0 4px", padding:"12px 14px", borderRadius:14, background:"rgba(39,174,96,0.1)", border:"0.5px solid rgba(39,174,96,0.3)", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:20 }}>✅</span>
        <div style={{ fontSize:13, color:T.green, fontWeight:500 }}>
          {plan.emoji || "🎯"} <strong>{plan.name}</strong> added to your goals
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin:"8px 0 4px", borderRadius:14, background:T.surface, border:`0.5px solid rgba(200,144,42,0.35)`, overflow:"hidden" }}>
      {/* Header row */}
      <div style={{ padding:"13px 14px 10px", display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:38, height:38, borderRadius:11, background:color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
          {plan.emoji || "🎯"}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600, color:T.text, lineHeight:1.3 }}>{plan.name}</div>
          {plan.why && (
            <div style={{ fontSize:11, color:T.muted, marginTop:1, fontStyle:"italic", lineHeight:1.4 }}>"{plan.why}"</div>
          )}
        </div>
      </div>

      {/* Progress target */}
      <div style={{ padding:"0 14px 10px", display:"flex", gap:16, flexWrap:"wrap" }}>
        <div style={{ fontSize:12, color:T.muted }}>
          <span style={{ color:T.hint }}>Start: </span>
          <strong style={{ color:T.text }}>{plan.startValue ?? 0}{plan.unit || ""}</strong>
        </div>
        <div style={{ fontSize:12, color:T.muted }}>
          <span style={{ color:T.hint }}>Target: </span>
          <strong style={{ color }}>
            {plan.targetValue}{plan.unit || ""}
            {plan.direction === "decreasing" ? " ↓" : " ↑"}
          </strong>
        </div>
        {plan.targetDate && (
          <div style={{ fontSize:12, color:T.muted }}>
            <span style={{ color:T.hint }}>Deadline: </span>
            <strong style={{ color:T.text }}>🎯 {fmtGoalDueHuman(plan.targetDate)}</strong>
          </div>
        )}
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div style={{ padding:"0 14px 12px" }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:T.hint, marginBottom:6 }}>
            Milestones
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {milestones.map((m, i) => {
              const isFuture = m.date >= today;
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
                  <span style={{ color: isFuture ? T.gold : T.hint, fontSize:9 }}>◆</span>
                  <span style={{ color: isFuture ? T.text : T.muted }}>{m.label}</span>
                  <span style={{ color:T.hint, marginLeft:"auto", whiteSpace:"nowrap" }}>{fmtGoalDueHuman(m.date)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ padding:"10px 14px 13px", borderTop:`0.5px solid ${T.border}`, display:"flex", gap:8 }}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          style={{ flex:1, padding:"9px 14px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontSize:13, fontWeight:700, cursor:confirming ? "default" : "pointer", opacity:confirming ? 0.7 : 1, transition:"opacity 0.15s" }}
        >
          {confirming ? "Creating…" : "Create this goal"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{ padding:"9px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

export function AICoach({ habits, goals, user, isPro, onClose, onUpgrade, coachName, coachIcon, coachAccentColor, currentScreen, onHabitCreated, onGoalCreated, onHabitLogged, onGoalLogged, onHabitRenamed, onGoalPlanConfirm, onJournalLogged, journalEntries = [], openInputMode = null, pendingMessage = null, onNavigateTo = null }) {
  useScrollLock(true);
  const cName = coachName || "Coach";
  const isCreatorUser = user?.id === CREATOR_ID;
  // ── Warmer, context-aware greeting ─────────────────────────────────────────
  // Reads today/yesterday/last-log state client-side (no extra API tokens) and
  // picks one of a handful of phrasings for each scenario. Computed once per
  // coach mount so it doesn't flip scenarios mid-session when the user logs
  // through the coach (habits state updates would otherwise re-evaluate).
  // For the creator account, swap in the larger, playful, per-open-rotating
  // bank from buildCreatorGreeting (also tracks last 3 lines in localStorage
  // so back-to-back opens never repeat).
  const greetingRef = useRef(null);
  if (greetingRef.current === null) {
    greetingRef.current = isCreatorUser
      ? buildCreatorGreeting({ name: user?.name, habits, goals })
      : buildCoachGreeting({ name: user?.name, habits, goals });
  }
  const greeting = greetingRef.current;
  const [messages, setMessages] = useState(() => {
    const uid = user?.id;
    if (!uid) return [];
    const loaded = loadCoachDayMessages(uid);
    return loaded?.length ? loaded : [];
  });
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const coachPersistDayRef = useRef(todayStr());
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [freeCoachMsgsToday, setFreeCoachMsgsToday] = useState(0);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const coachOpenedAtRef = useRef(Date.now());
  const speech    = useSpeechInput(t => setInput(p => mergeDictationIntoText(p, t)), { autoRestart: true, meter: true });

  // Hydrate today's thread from localStorage (one conversation per local calendar day).
  useLayoutEffect(() => {
    if (!user?.id) {
      setMessages([]);
      return;
    }
    const day = todayStr();
    coachPersistDayRef.current = day;
    const loaded = loadCoachDayMessages(user.id);
    setMessages(loaded?.length ? loaded : []);
  }, [user?.id]);

  // New local day while coach is open → fresh thread (storage key is day-scoped).
  useEffect(() => {
    function rollIfMidnight() {
      const d = todayStr();
      if (d !== coachPersistDayRef.current) {
        coachPersistDayRef.current = d;
        setMessages([]);
      }
    }
    const id = setInterval(rollIfMidnight, 45000);
    function onVis() {
      if (document.visibilityState === "visible") rollIfMidnight();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Persist thread (debounced); same-day key only.
  useEffect(() => {
    if (!user?.id) return;
    const day = todayStr();
    if (day !== coachPersistDayRef.current) return;
    const t = setTimeout(() => saveCoachDayMessages(user.id, day, messages), 320);
    return () => clearTimeout(t);
  }, [messages, user?.id]);

  // Flush before tab close / refresh so the debounced save isn't lost.
  useEffect(() => {
    if (!user?.id) return;
    function flush() {
      const day = todayStr();
      if (day !== coachPersistDayRef.current) return;
      saveCoachDayMessages(user.id, day, messagesRef.current);
    }
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [user?.id]);

  useEffect(() => {
    if (!openInputMode) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      if (openInputMode === "text") {
        textareaRef.current?.focus();
        return;
      }
      if (openInputMode === "mic") {
        if (!isPro) {
          onUpgrade?.();
          return;
        }
        if (!speech.supported) return;
        speech.toggle();
      }
    }, 160);
    return () => { cancelled = true; clearTimeout(t); };
  // Mount-only: coach sheet remounts each open (showCoach toggle).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-send a pending message if the coach was opened via page-mic.
  // Captured at mount time via ref so it doesn't re-run if the prop ever changes.
  const pendingMessageRef = useRef(pendingMessage);
  useEffect(() => {
    const msg = pendingMessageRef.current;
    if (!msg?.trim()) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (!cancelled) send(msg);
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function coachInputDisplayed() {
    if (speech.listening && speech.interim?.trim()) {
      const core = input.trim();
      const im = polishInterimDisplay(speech.interim).trim();
      return core ? `${core} ${im}` : im;
    }
    return input;
  }

  const atFreeCap = !isPro && freeCoachMsgsToday >= FREE_DAILY_LIMIT;
  const streamingEmpty = messages.some(m => m.id === COACH_STREAM_ID && !String(m.content || "").trim());
  const showTryHint = messages.length === 0;
  const coachMsgsRemaining = !isPro && !atFreeCap ? FREE_DAILY_LIMIT - freeCoachMsgsToday : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (isPro) return;
    setFreeCoachMsgsToday(syncCoachMsgCountFromStorage());
  }, []);

  useEffect(() => {
    if (!loading) {
      setIsExecutingAction(false);
      return;
    }
    const t = setTimeout(() => setIsExecutingAction(true), 550);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    const onResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const inputBar = document.getElementById("coach-input-bar");
      if (inputBar) {
        inputBar.style.paddingBottom =
          Math.max(10, window.innerHeight - vv.height - vv.offsetTop + 10) + "px";
      }
    };
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    return () => {
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 88) + "px";
    el.scrollTop = el.scrollHeight;
  }, [input, speech.interim]);

  async function send(text) {
    textareaRef.current?.blur();
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    if (!isPro) {
      const c = syncCoachMsgCountFromStorage();
      setFreeCoachMsgsToday(c);
      if (c >= FREE_DAILY_LIMIT) return;
    }
    let countedThisSend = false;
    const bumpAfterSuccess = () => {
      if (isPro || countedThisSend) return;
      countedThisSend = true;
      setFreeCoachMsgsToday(bumpCoachMsgCountInStorage());
    };
    setInput("");
    setError(null);
    const sendDay = todayStr();
    let baseMessages = messages;
    if (sendDay !== coachPersistDayRef.current) {
      coachPersistDayRef.current = sendDay;
      baseMessages = [];
    }
    const userMsg = { role: "user", content: trimmed, ts: Date.now() };
    const next = baseMessages.length === 0
      ? [
          { role: "assistant", content: greeting, ts: coachOpenedAtRef.current },
          userMsg,
        ]
      : [...baseMessages, userMsg];
    setMessages(next);
    if (user?.id) saveCoachDayMessages(user.id, sendDay, next);
    setLoading(true);
    setIsExecutingAction(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          system:   buildCoachSystemPrompt(user, habits, cName, currentScreen, goals, journalEntries),
          // Match server cap (api/chat.js slice -12): token-safe, full day kept in localStorage only.
          messages: next.map(m => ({ role: m.role, content: m.content })).slice(-COACH_API_MESSAGE_CAP),
          // Send the user's actual local date (YYYY-MM-DD) so AI logs land on
          // the correct calendar day. Server falls back to UTC if missing.
          client_date: todayStr(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Something went wrong");
      }

      // ── Stream the response word-by-word ────────────────────────────────────
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        // Add empty streaming message
        const streamTs = Date.now();
        setMessages(prev => [...prev, { role: "assistant", content: "", id: COACH_STREAM_ID, ts: streamTs }]);
        setLoading(false);
        setIsExecutingAction(false);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.text) {
                setIsExecutingAction(false);
                fullText += evt.text;
                const snap = fullText;
                setMessages(prev => prev.map(m => m.id === COACH_STREAM_ID ? { ...m, content: snap } : m));
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              }
              if (evt.done) {
                bumpAfterSuccess();
                const receiptBlock = evt.receipt && String(evt.receipt).trim()
                  ? `\n\n${String(evt.receipt).trim()}`
                  : "";
                const finalContent = (fullText.trim() ? fullText.trim() : "") + receiptBlock;
                const doneDay = todayStr();
                coachPersistDayRef.current = doneDay;
                // Finalise — remove stream id marker; append server truth receipt (never model-invented)
                setMessages(prev => {
                  const nextMsgs = prev.map(m => m.id === COACH_STREAM_ID ? { role: "assistant", content: finalContent || fullText, ts: m.ts ?? Date.now() } : m);
                  if (user?.id) saveCoachDayMessages(user.id, doneDay, nextMsgs);
                  return nextMsgs;
                });

                // ── Created ───────────────────────────────────────────────────
                if (evt.created) {
                  const rows = Array.isArray(evt.created) ? evt.created : [evt.created];
                  rows.forEach((row) => {
                    if (!row) return;
                    if (row.habit_type === "goal") onGoalCreated?.(rowToGoal(row));
                    else onHabitCreated?.(rowToHabit(row));
                  });
                }

                // ── Edited ────────────────────────────────────────────────────
                if (evt.edited?.length) {
                  evt.edited.forEach(edit => {
                    const row = edit.updatedRow;
                    if (!row) return;
                    if (row.habit_type === "goal") {
                      onGoalCreated?.(rowToGoal(row));
                    } else {
                      onHabitCreated?.(rowToHabit(row));
                    }
                  });
                }

                // ── Logged ────────────────────────────────────────────────────
                if (evt.logged?.length) {
                  evt.logged.forEach(l => {
                    if (l.habit_type === "goal") {
                      onGoalLogged?.(l.habit_id, l.updatedLogs);
                    } else {
                      onHabitLogged?.(l.habit_id, l.updatedLogs);
                    }
                  });
                }

                // ── Journaled ─────────────────────────────────────────────────
                if (evt.journaled?.length) {
                  onJournalLogged?.(evt.journaled);
                }

                if (evt.error) setError(evt.error);
              }
            } catch { /* malformed line — skip */ }
          }
        }
      } else {
        // Fallback: plain JSON
        const data = await res.json();
        setLoading(false);
        setIsExecutingAction(false);
        setMessages(prev => [...prev, { role: "assistant", content: data.reply || "", ts: Date.now() }]);
      }
    } catch (e) {
      setLoading(false);
      setIsExecutingAction(false);
      // Remove incomplete stream message if present
      setMessages(prev => prev.filter(m => m.id !== COACH_STREAM_ID));
      setError(e.message || "Couldn't reach the coach. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!atFreeCap) send(coachInputDisplayed()); }
  }

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.82)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", display:"flex", flexDirection:"column", height:"min(680px, 85dvh)", minHeight:0, touchAction:"auto" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"16px 20px 13px", borderBottom:`0.5px solid ${T.border}`, flexShrink:0 }}>
          {/* Avatar — shows the selected coach icon, falls back to initial */}
          <div style={{
            width:40, height:40, borderRadius:"50%", flexShrink:0,
            background:`${coachAccentColor || T.accent}22`,
            border:`1.5px solid ${coachAccentColor || T.accent}55`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize: (coachIcon && COACH_ICON_OPTIONS.includes(coachIcon)) ? 20 : 16,
            fontWeight:600, color: coachAccentColor || T.accent,
            lineHeight:1,
          }}>
            {coachIcon && COACH_ICON_OPTIONS.includes(coachIcon) ? coachIcon : cName.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{
              fontSize:15, fontWeight:600, color:T.text, lineHeight:1.25,
              wordBreak:"break-word", overflowWrap:"anywhere",
            }}
            >
              {cName}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:3 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:T.green, flexShrink:0 }}/>
              <div style={{ fontSize:11, color:T.muted }}>Active — knows your habits & goals</div>
            </div>
          </div>
          {!isPro && !atFreeCap && freeCoachMsgsToday > 0 && coachMsgsRemaining != null && coachMsgsRemaining > 0 ? (
            <div style={{
              flexShrink:0, fontSize:11, fontWeight:500,
              color: coachMsgsRemaining <= 3 ? T.gold : T.muted,
              background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:20,
              padding:"4px 10px", lineHeight:1.2,
            }}>
              {coachMsgsRemaining} left
            </div>
          ) : null}
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px 8px", display:"flex", flexDirection:"column", gap:10 }}>
          {messages.length === 0 ? (
            <>
              <div style={{ display:"flex", justifyContent:"flex-start" }}>
                <div style={{ maxWidth:"85%", display:"flex", flexDirection:"column", alignItems:"flex-start" }}>
                  <div style={{
                    padding:"10px 14px",
                    borderRadius:"14px 14px 14px 3px",
                    background:T.surface,
                    fontSize:14, color:T.text,
                    lineHeight:1.6, wordBreak:"break-word",
                  }}>
                    <CoachFormattedBubble text={greeting} isUser={false} />
                  </div>
                  <div style={{ fontSize:10, color:T.hint, marginTop:3, alignSelf:"flex-end" }}>
                    {formatCoachMsgTime(coachOpenedAtRef.current)}
                  </div>
                </div>
              </div>

              {/* Starter prompt chips — tap to send. Tailored to current state. */}
              {(() => {
                const hasHabits = habits.length > 0;
                const hasGoals  = (goals || []).some(g => g.status !== "completed");
                const firstHabit = habits[0];
                const starters = [];
                // Goal planning first when the user has no goals — most impactful action
                if (!hasGoals) {
                  starters.push("Help me set a goal");
                }
                if (hasHabits && firstHabit) {
                  starters.push(`Log my ${firstHabit.name.toLowerCase()} for today`);
                }
                starters.push("How am I doing this week?");
                if (hasHabits) {
                  starters.push("What habit should I add next?");
                } else {
                  starters.push("Help me pick my first habit");
                }
                if (hasGoals) {
                  starters.push("Am I on track with my goals?");
                }
                starters.push("Give me a pep talk");
                return (
                  <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:6 }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:T.muted, padding:"0 2px" }}>
                      Try asking {cName}
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {starters.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => send(s)}
                          disabled={loading || atFreeCap}
                          style={{
                            padding:"7px 12px",
                            borderRadius:16,
                            border:`0.5px solid rgba(200,144,42,0.35)`,
                            background:"rgba(200,144,42,0.08)",
                            color:T.gold,
                            fontSize:12,
                            fontWeight:600,
                            cursor: loading || atFreeCap ? "default" : "pointer",
                            opacity: loading || atFreeCap ? 0.55 : 1,
                            lineHeight:1.3,
                            textAlign:"left",
                            fontFamily:T.font,
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:11, color:T.muted, lineHeight:1.5, marginTop:2, padding:"0 2px" }}>
                      I can set goals with milestones, log habits, track your progress, and tell you what patterns I'm seeing.
                    </div>
                  </div>
                );
              })()}
            </>
          ) : null}
          {messages.map((m, i) => {
            // For assistant messages, check for an embedded <goal_plan> block.
            const parsed = m.role === "assistant" ? parseGoalPlan(m.content) : null;
            // While the block is still streaming, strip the raw partial XML so
            // the user never sees "<goal_plan>{..." leaking into the bubble.
            const rawVisible = parsed
              ? parsed.textWithout
              : m.role === "assistant"
                ? stripPartialGoalPlan(m.content)
                : m.content;
            const { main: coachMain, receipt: coachReceipt } =
              m.role === "assistant" ? splitCoachReceipt(rawVisible) : { main: rawVisible, receipt: null };
            return (
              <div key={m.id || `${m.role}-${i}-${m.ts ?? ""}`} style={{ display:"flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth:"90%", display:"flex", flexDirection:"column", alignItems: m.role === "user" ? "flex-end" : "flex-start", width: parsed ? "100%" : undefined }}>
                  {(coachMain || coachReceipt) ? (
                    <div style={{
                      padding:"10px 14px",
                      borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                      background: m.role === "user" ? T.accent : T.surface,
                      fontSize:14, color: m.role === "user" ? "#fff" : T.text,
                      lineHeight:1.6, wordBreak:"break-word",
                    }}>
                      {coachMain ? (
                        <CoachFormattedBubble text={coachMain} isUser={m.role === "user"} />
                      ) : null}
                      {coachReceipt ? (
                        <div style={{
                          marginTop: coachMain ? 10 : 0,
                          paddingTop: coachMain ? 10 : 0,
                          borderTop: coachMain ? `0.5px solid ${T.border}` : "none",
                        }}>
                          <CoachReceiptChips
                            receiptText={coachReceipt}
                            onNavigateTo={onNavigateTo}
                            onClose={onClose}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {parsed && (
                    <GoalPlanPreview
                      plan={parsed.plan}
                      onConfirm={async (plan) => {
                        if (onGoalPlanConfirm) await onGoalPlanConfirm(plan);
                      }}
                      onDismiss={() => {
                        // Nudge user to clarify — put a prompt in the input box
                        setInput("Can you adjust the goal — ");
                      }}
                    />
                  )}
                  <div style={{ fontSize:10, color:T.hint, marginTop:3, alignSelf:"flex-end" }}>
                    {formatCoachMsgTime(m.ts)}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing / action indicator (slow fetch ≈ server-side tools before stream) */}
          {loading && isExecutingAction ? (
            <div style={{ display:"flex", justifyContent:"flex-start" }}>
              <div style={{ padding:"10px 16px", borderRadius:"14px 14px 14px 3px", background:T.surface, fontSize:13, color:T.muted, fontStyle:"italic" }}>
                Taking action…
              </div>
            </div>
          ) : (loading && !isExecutingAction) || streamingEmpty ? (
            <div style={{ display:"flex", justifyContent:"flex-start" }}>
              <div style={{ padding:"10px 16px", borderRadius:"14px 14px 14px 3px", background:T.surface, display:"flex", gap:5, alignItems:"center" }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:T.muted,
                    animation:"coachDot 1.2s ease-in-out infinite", animationDelay:`${i*0.2}s` }}/>
                ))}
              </div>
            </div>
          ) : null}

          {/* Error */}
          {error && (
            <div style={{ textAlign:"center", fontSize:12, color:T.accent, padding:"4px 8px" }}>{error}</div>
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Input bar — mic left (voice entry), field, send right (standard chat hierarchy) */}
        <div id="coach-input-bar" style={{ padding:"10px 14px 10px", borderTop:`0.5px solid ${T.border}`, flexShrink:0 }}>
          {!isPro && !atFreeCap && freeCoachMsgsToday >= 3 && freeCoachMsgsToday < FREE_DAILY_LIMIT && (
            <div style={{ fontSize:11, color:T.muted, padding:"2px 2px 8px", lineHeight:1.5 }}>
              {FREE_DAILY_LIMIT - freeCoachMsgsToday} message{FREE_DAILY_LIMIT - freeCoachMsgsToday === 1 ? "" : "s"} left today —{" "}
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  background:"none", border:"none", padding:0, cursor:"pointer",
                  font:"inherit", color:T.gold, fontWeight:700,
                  textDecoration:"underline", textUnderlineOffset:2,
                }}
              >
                Pro
              </button>{" "}
              gets unlimited.
            </div>
          )}
          {speech.listening ? (
            <CoachRecordingBar speech={speech} />
          ) : (
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              {speech.supported ? (
                <div style={{ opacity: atFreeCap ? 0.35 : 1, pointerEvents: atFreeCap ? "none" : "auto", flexShrink:0, alignSelf:"flex-end", marginBottom:1 }}>
                  <MicBtn
                    speech={speech}
                    color={T.gold}
                    size={44}
                    prominent
                    locked={!isPro}
                    onLockedClick={onUpgrade}
                  />
                </div>
              ) : null}
              <div style={{ flex:1, position:"relative", minWidth:0 }}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onInput={e => {
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 88) + "px";
                  }}
                  onKeyDown={handleKey}
                  disabled={atFreeCap}
                  placeholder="Ask anything about your habits…"
                  style={{
                    width:"100%", boxSizing:"border-box",
                    background:T.surface, border:`0.5px solid ${T.borderStrong}`,
                    borderRadius:T.rsm, padding:"10px 14px",
                    fontSize:16, color:T.text, resize:"none",
                    fontFamily:T.font, lineHeight:1.5, outline:"none",
                    minHeight:"42px", maxHeight:"88px", overflowY:"auto", height:"auto",
                    opacity: atFreeCap ? 0.55 : 1,
                  }}
                />
              </div>
              <button
                type="button"
                aria-label={coachInputDisplayed().trim() && !loading && !atFreeCap ? "Send message" : "Send (disabled until you type)"}
                onClick={() => { textareaRef.current?.blur(); send(coachInputDisplayed()); }}
                disabled={!coachInputDisplayed().trim() || loading || atFreeCap}
                style={{
                  width:36, height:36, borderRadius:"50%", border:`0.5px solid ${T.border}`,
                  flexShrink:0,
                  background: coachInputDisplayed().trim() && !loading && !atFreeCap ? T.gold : T.surface,
                  cursor: coachInputDisplayed().trim() && !loading && !atFreeCap ? "pointer" : "default",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"background 0.2s, border-color 0.2s, opacity 0.2s",
                  opacity: !input.trim() || loading || atFreeCap ? 0.85 : 1,
                }}>
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                  <path d="M2 9h14M9 2l7 7-7 7" stroke={coachInputDisplayed().trim() && !loading && !atFreeCap ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
          {/* The old italic "Try: …" hint is now redundant — the empty-state has
              labeled starter chips in the message area. Keeping only mic / rate
              limit prompts below. */}
          {speech.supported && speech.micBlocked ? (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, padding:"0 2px", lineHeight:1.45 }}>
              Mic blocked. Enable it in your browser settings.
            </div>
          ) : null}
          {!isPro && speech.supported && !atFreeCap && !speech.micBlocked && !speech.listening ? (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, padding:"0 2px", lineHeight:1.45 }}>
              🎙️ Voice logging is a{" "}
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  background:"none", border:"none", padding:0, cursor:"pointer",
                  font:"inherit", color:T.gold, fontWeight:700,
                  textDecoration:"underline", textUnderlineOffset:2,
                }}
              >
                Pro
              </button>{" "}
              feature — tap to preview.
            </div>
          ) : null}
          {speech.supported && speech.speechError ? (
            <div style={{ fontSize:11, color:T.accent, marginTop:8, padding:"0 2px", lineHeight:1.5, whiteSpace:"pre-line" }}>
              {speech.speechError}
            </div>
          ) : null}
          {atFreeCap && (
            <div style={{
              marginTop:12, padding:"12px 14px", borderRadius:T.rsm,
              background:T.surface, border:`0.5px solid ${T.borderStrong}`,
              display:"flex", flexDirection:"column", gap:6,
            }}>
              <div style={{ fontSize:13, fontWeight:600, color:T.text }}>
                {`You've used your ${FREE_DAILY_LIMIT} free messages today`}
              </div>
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>
                Forged Pro gives you unlimited coaching, plus full history, friend nudges, and voice logging.
              </div>
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  marginTop:4, padding:"8px 0", borderRadius:T.rsm,
                  border:"none", background:T.gold, color:"#1a1a16",
                  fontSize:13, fontWeight:700, cursor:"pointer", width:"100%",
                }}
              >
                Upgrade to Pro
              </button>
              <div style={{ fontSize:11, color:T.hint, textAlign:"center" }}>
                Resets at midnight
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dot animation keyframes */}
      <style>{`
        @keyframes coachDot {
          0%,80%,100% { transform:scale(0.6); opacity:0.4; }
          40% { transform:scale(1); opacity:1; }
        }
      `}</style>
    </div>
  );
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────
// 3 steps: Welcome → Name + focus → First habit suggestion
// Shown only for brand-new users (onboarded === false — never when onboarded is null or true)
const ONBOARD_STEPS = [
  {
    id:"welcome",
    title:"Forged.",
    sub:"Most habit apps track what you do. Forged helps you understand why you keep stopping.",
    body:"You already know what you want to change. The hard part is figuring out what's actually getting in the way — and why the same patterns keep derailing you. Forged is built to help you see that.",
    cta:"Let's build",
  },
  {
    id:"name",
    title:"First — who are you?",
    sub:"Your name. That's it.",
    body:null,
    cta:"That's me",
  },
  {
    id:"coach",
    title:"Meet your AI coach.",
    sub:"It reads your logs and reflections — then tells you what you can't see yourself.",
    body:null,
    cta:"Continue",
  },
  {
    id:"focus",
    title:"What are you forging?",
    sub:"Pick what matters right now. You can always add more later.",
    body:null,
    cta:"Start forging",
  },
];

const FOCUS_OPTIONS = [
  { label:"Getting stronger",     emoji:"🏋️", habitType:"weekly",   name:"Gym",         weeklyTarget:3, color:"#C0392B", reflectionPrompt:"What felt strong? What needs work?" },
  { label:"Eating better",        emoji:"🥗", habitType:"daily",    name:"Eat better",  color:"#27AE60", reflectionPrompt:"What did you actually eat today?" },
  { label:"Building something",   emoji:"⚒️", habitType:"project",  name:"My project",  color:"#2980B9", reflectionPrompt:"What did you build? Any wins or blockers?" },
  { label:"Daily movement",       emoji:"🏃", habitType:"daily",    name:"Move daily",  color:"#8E44AD", reflectionPrompt:"How did your body feel?" },
  { label:"Hitting a weight goal",emoji:"⚖️", habitType:"progress", name:"Weight goal", startValue:0, targetValue:0, unit:"kg", color:"#E67E22", reflectionPrompt:"How many meals today? Energy levels?" },
  { label:"Reading more",         emoji:"📚", habitType:"daily",    name:"Read",        color:"#C8902A", reflectionPrompt:"What's one idea worth keeping?" },
  { label:"Reducing something",   emoji:"🎯", habitType:"limit",    name:"Limit",       dailyBudget:60, unit:"min", color:"#8E44AD", reflectionPrompt:"What triggered the urge?" },
  { label:"Something else",       emoji:"✨", habitType:"daily",    name:"My habit",    color:"#C0392B", reflectionPrompt:"How did it go today?" },
];

const HABIT_ANNOTATIONS = {
  daily: "Daily habits work best when you attach them to something you already do — morning coffee, after lunch, before bed. The streak counter tracks consecutive completed days (or protected rest days).",
  weekly: "Weekly targets give you flexibility without losing accountability. You have a target number of sessions to hit each week. Log each one after it happens. Missing a day doesn't break anything — missing a week resets the streak.",
  progress: "Progress habits track a number over time — you log where you actually are today, not where you 'should' be. The trend line shows the real picture. Consistency of logging matters more than the direction of the number.",
  project: "Build habits track time spent and what you got from it. Log your minutes, a win, and what was hard. Set a daily minute target (default 60) — streaks count days you hit it, and crossing it can earn bonus XP.",
  limit: "Limit habits track what you're reducing. Each tap logs one unit against your daily budget. Streaks increase only on days you log and stay at or under your limit.",
};

function OnboardingScreen({ onComplete, onSkip, onSaveProgress, onCheckout, notifEnabled, notifLoading, notifPermission, onNotifToggle, isCoachClient = false }) {
  const [step,            setStep]            = useState(0);
  const [name,            setName]            = useState("");
  const [coachNameInput,  setCoachNameInput]  = useState("");
  const [selected,        setSelected]        = useState([]);
  const [weightGoal,      setWeightGoal]      = useState({ start:"", target:"", unit:"kg" });
  const [limitBudget,     setLimitBudget]     = useState({ budget:"60", unit:"min", name:"" });
  const [builtHabits,     setBuiltHabits]     = useState([]);
  const [firstLogDone,    setFirstLogDone]    = useState(false);
  const [firstLogValue,   setFirstLogValue]   = useState("");
  const [showingFinal,    setShowingFinal]    = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError,   setCheckoutError]   = useState(null);
  const [enteringApp,     setEnteringApp]     = useState(false);
  // Final-screen "weekly updates by email" opt-in. Default ON; persisted to
  // profiles.weekly_updates_email_opt_in (+ _at) and localStorage (same key as
  // ProThankYouModal so both surfaces stay aligned).
  const [emailUpdatesOptIn, setEmailUpdatesOptIn] = useState(true);

  const current   = ONBOARD_STEPS[step];
  const isLast    = step === ONBOARD_STEPS.length - 1;
  const FOCUS_STEP = ONBOARD_STEPS.findIndex(s => s.id === "focus");
  const COACH_STEP = ONBOARD_STEPS.findIndex(s => s.id === "coach");
  const INTER_STEP = ONBOARD_STEPS.length;       // virtual step 5 (transition)
  // After the interstitial we now run Home → Notifs → First-log so that the
  // very last action inside onboarding is the user actually logging a habit —
  // a direct handoff into the real app rather than ending on a setup screen.
  const FIRST_STEP = ONBOARD_STEPS.length + 1;   // virtual: log first habit
  const HOME_STEP  = ONBOARD_STEPS.length + 2;   // virtual: add to home screen
  const NOTIF_STEP = ONBOARD_STEPS.length + 3;   // virtual: enable notifications

  const isVirtual = step >= ONBOARD_STEPS.length;

  // Canonical 1-based step number for the progress header. The interstitial
  // shares Focus' number (it's a sub-screen), and the three virtual post-focus
  // steps are reordered visually: Home (6) → Notifs (7) → First log (8).
  const DISPLAY_TOTAL = 5;
  function displayStepNumber(s) {
    if (s === INTER_STEP) return 4;   // Focus' number — interstitial is a transition
    if (s === NOTIF_STEP) return 5;
    if (s === FIRST_STEP) return 5;
    return Math.min(s + 1, 4);        // standard steps 0..3 → 1..4
  }
  const progressNumber = displayStepNumber(step);

  function toggleFocus(label) {
    setSelected(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]);
  }

  // ── One-tap focus picker ─────────────────────────────────────────────────────
  // Tapping a focus tile now:
  //   1. (If we haven't already built a starter habit this session) builds one
  //      synchronously from the tile's own per-tile defaults via
  //      buildHabitFromOption — preserves habitType (weekly/project/limit/etc),
  //      emoji, color, and reflectionPrompt. No DB write here; the habit is
  //      committed atomically with the rest of onboarding via onSaveProgress
  //      at the very end, so a user who bails out of onboarding doesn't leave
  //      orphan rows behind.
  //   2. Marks the tile as selected (drives the existing checkmark UI) and
  //      runs a brief confirm-pulse so the tap feels acknowledged.
  //   3. Advances to INTER_STEP after a short beat.
  // If a starter habit already exists in builtHabits (e.g. user navigated back
  // to FOCUS_STEP somehow), we skip the build and just advance.
  const [tappedFocus, setTappedFocus] = useState(null);
  const [advancing,   setAdvancing]   = useState(false);
  function pickFocusAndAdvance(opt) {
    if (advancing) return; // guard against double-tap
    if (builtHabits.length === 0) {
      const habit = buildHabitFromOption(opt, weightGoal, limitBudget);
      setBuiltHabits([habit]);
    }
    setSelected([opt.label]);
    setTappedFocus(opt.label);
    setAdvancing(true);
    setTimeout(() => setStep(INTER_STEP), 280);
  }

  function buildHabitFromOption(opt, wg, lb) {
    const base = {
      id: Date.now() + Math.random() + "",
      name:opt.name, emoji:opt.emoji, habitType:opt.habitType,
      color:opt.color, reflection:true, reflectionPrompt:opt.reflectionPrompt,
      streak:0, bestStreak:0, logs:[],
    };
    if (opt.habitType === "weekly")   return { ...base, weeklyTarget:opt.weeklyTarget || 3 };
    if (isLegacyProgressType(opt.habitType)) {
      const start = parseFloat(wg.start)||70;
      const target = parseFloat(wg.target)||80;
      return { ...base, startValue:start, targetValue:target, direction:inferProgressDirection(start, target), unit:wg.unit||"kg" };
    }
    if (opt.habitType === "limit")    return { ...base, name:lb.name||opt.name, dailyBudget:parseInt(lb.budget)||60, unit:lb.unit||"min" };
    if (opt.habitType === "project")  return { ...base, dailyTargetMinutes: 60 };
    return base;
  }

  // Pick the most interesting habit to feature first
  function pickFirstHabit(habits) {
    const priority = ["progress","project","weekly","limit","daily"];
    for (const type of priority) {
      const found = habits.find(h => h.habitType === type);
      if (found) return found;
    }
    return habits[0];
  }

  function handleContinue() {
    if (step === 1 && !name.trim()) return;
    if (isLast) {
      // Build habits and move to virtual interstitial step
      const selectedOptions = FOCUS_OPTIONS.filter(o => selected.includes(o.label));
      const habits = selectedOptions.map(opt => buildHabitFromOption(opt, weightGoal, limitBudget));
      setBuiltHabits(habits);
      setStep(INTER_STEP);
      return;
    }
    setStep(s => s + 1);
  }

  function habitsSaved() {
    // Build the log entry if the user filled it in during FIRST_STEP
    if (builtHabits.length === 0) return builtHabits;
    const firstHabit = pickFirstHabit(builtHabits);
    if (!firstLogDone) return builtHabits;
    const logEntry = buildFirstLog(firstHabit, firstLogValue);
    return builtHabits.map(h => h.id === firstHabit.id ? { ...h, logs:[logEntry] } : h);
  }

  async function handleEnterApp() {
    if (enteringApp) return;
    setEnteringApp(true);
    try {
      await Promise.race([
        onSaveProgress({
          name: clampProfileDisplayName(name.trim() || "You"),
          habits: habitsSaved(),
          coachName: clampProfileCoachName(coachNameInput.trim() || "Coach"),
          emailUpdatesOptIn,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
      ]);
      onComplete();
    } catch {
      onComplete();
    }
  }

  async function handleGoPro() {
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      await onSaveProgress({
        name: clampProfileDisplayName(name.trim() || "You"),
        habits: habitsSaved(),
        coachName: clampProfileCoachName(coachNameInput.trim() || "Coach"),
        emailUpdatesOptIn,
      });
      await onCheckout();
    } catch(err) {
      setCheckoutError(err.message || "Something went wrong. Try again.");
      setCheckoutLoading(false);
    }
  }

  function buildFirstLog(habit, rawVal) {
    const today = todayStr();
    if (habit.habitType === "daily" || habit.habitType === "weekly") {
      return { date:today, value:true, note:"" };
    }
    if (isLegacyProgressType(habit.habitType)) {
      return { date:today, value:parseFloat(rawVal) || (habit.startValue || 0), note:"" };
    }
    if (habit.habitType === "project") {
      return { date:today, value:{ minutes:parseInt(rawVal)||30, win:null, hardPart:null }, note:"" };
    }
    if (habit.habitType === "limit") {
      return { date:today, value:parseInt(rawVal)||1, note:"" };
    }
    return { date:today, value:true, note:"" };
  }

  const hasWeight = selected.includes("Hitting a weight goal");
  const hasLimit  = selected.includes("Reducing something");

  const styleInp = {
    width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm,
    background:T.surface, padding:"10px 12px", fontSize:14, color:T.text,
    outline:"none", boxSizing:"border-box",
  };

  const wrap = {
    fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column",
    paddingTop: "env(safe-area-inset-top, 0px)",
  };

  // Shared progress header — slim bar + "Step X of Y" label. Replaces the red
  // dot row that used to feel opaque. `currentNum` is 1-based.
  function ProgressHeader({ currentNum, total = DISPLAY_TOTAL }) {
    const pct = Math.max(0, Math.min(100, Math.round((currentNum / total) * 100)));
    return (
      <div style={{ paddingTop: 24, paddingBottom: 0, ...cssPadXSafe(24) }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
          <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase", letterSpacing:"0.12em" }}>
            Step {currentNum} of {total}
          </div>
          <div style={{ fontSize:10, fontWeight:500, color:T.hint, letterSpacing:"0.04em" }}>
            {pct}%
          </div>
        </div>
        <div style={{ height:3, width:"100%", background:T.surface, borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:T.accent, borderRadius:2, transition:"width 0.35s cubic-bezier(0.22,1,0.36,1)" }}/>
        </div>
      </div>
    );
  }

  // ── Final screen: you're in ──────────────────────────────────────────────────
  if (showingFinal) {
    return (
      <div style={wrap}>
        <style>{`
          @keyframes finalHeroIn { from { opacity:0; transform:translateY(14px) scale(0.96); } to { opacity:1; transform:none; } }
          @keyframes finalItemIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        `}</style>
        <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", padding:"48px 24px 32px", overflowY:"auto" }}>
          <div style={{ width:"100%", maxWidth:360, margin:"0 auto", textAlign:"center" }}>
            {/* Hero */}
            <div style={{ animation:"finalHeroIn 0.6s cubic-bezier(0.22,1,0.36,1) both" }}>
              <div style={{ position:"relative", display:"inline-block", marginBottom:22 }}>
                <div style={{ position:"absolute", inset:-18, background:"radial-gradient(circle, rgba(200,144,42,0.22) 0%, rgba(200,144,42,0) 70%)", borderRadius:"50%", zIndex:0, pointerEvents:"none" }}/>
                <div style={{ position:"relative", fontSize:56, lineHeight:1, zIndex:1 }}>⚒️</div>
              </div>
              <div style={{ fontSize:11, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.14em", marginBottom:12 }}>
                You&apos;re forged in
              </div>
              <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, marginBottom:12, lineHeight:1.15, letterSpacing:"-0.005em" }}>
                Let&apos;s build, {name.trim() || "you"}.
              </div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7, maxWidth:300, margin:"0 auto 28px" }}>
                Your habits are ready. Log consistently, reflect when it matters, and let the patterns show you what&apos;s working.
              </div>
            </div>

            {/* Coach client: skip paywall, show "full access included" card */}
            {isCoachClient ? (
              <div style={{
                position:"relative",
                background:"linear-gradient(145deg, rgba(39,174,96,0.13) 0%, rgba(39,174,96,0.04) 100%)",
                border:"1px solid rgba(39,174,96,0.45)",
                borderRadius:18,
                padding:"18px 18px 16px",
                marginBottom:16,
                textAlign:"left",
                boxShadow:"0 8px 28px rgba(39,174,96,0.08)",
                animation:"finalItemIn 0.55s 0.15s cubic-bezier(0.22,1,0.36,1) both",
              }}>
                <div style={{ position:"absolute", top:-10, left:14, background:"#27AE60", color:"#fff", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", padding:"3px 9px", borderRadius:6 }}>
                  Included with your coach
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, marginTop:4 }}>
                  <div style={{ fontSize:22 }}>⚡</div>
                  <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, lineHeight:1.2 }}>
                    Forged Pro — Free
                  </div>
                  <div style={{ marginLeft:"auto", fontSize:12, color:"#27AE60", fontWeight:600 }}>
                    $0/mo
                  </div>
                </div>
                <div style={{ fontSize:12, color:T.sub, lineHeight:1.65 }}>
                  Your coach has unlocked full access for you — unlimited habits, AI coaching, voice logging, and complete history.
                </div>
              </div>
            ) : (
              /* Pro upsell card — clearly the premium path, not a footnote. */
              <div style={{
                position:"relative",
                background:"linear-gradient(145deg, rgba(200,144,42,0.12) 0%, rgba(200,144,42,0.04) 100%)",
                border:"1px solid rgba(200,144,42,0.45)",
                borderRadius:18,
                padding:"18px 18px 16px",
                marginBottom:16,
                textAlign:"left",
                boxShadow:"0 8px 28px rgba(200,144,42,0.08)",
                animation:"finalItemIn 0.55s 0.15s cubic-bezier(0.22,1,0.36,1) both",
              }}>
                <div style={{ position:"absolute", top:-10, left:14, background:T.gold, color:"#0F0F0D", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", padding:"3px 9px", borderRadius:6 }}>
                  Recommended
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, marginTop:4 }}>
                  <div style={{ fontSize:22 }}>⚡</div>
                  <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, lineHeight:1.2 }}>
                    Forged Pro
                  </div>
                  <div style={{ marginLeft:"auto", fontSize:12, color:T.gold, fontWeight:600 }}>
                    $4.99/mo
                  </div>
                </div>
                <div style={{ fontSize:12, color:T.sub, lineHeight:1.65, marginBottom:12 }}>
                  Unlimited AI coaching, unlimited habits, voice logging, friend nudges, and full history — everything you need to actually understand your patterns.
                </div>
                <button
                  onClick={handleGoPro}
                  disabled={checkoutLoading}
                  style={{
                    width:"100%", padding:"13px 0", borderRadius:12, border:"none",
                    background:T.gold, color:"#0F0F0D",
                    fontSize:14, fontWeight:700, letterSpacing:"0.01em",
                    cursor:checkoutLoading?"not-allowed":"pointer",
                    opacity:checkoutLoading?0.7:1,
                    fontFamily:T.font,
                    transition:"opacity 0.15s",
                  }}
                >
                  {checkoutLoading ? "Opening checkout…" : "Unlock Forged Pro →"}
                </button>
                {checkoutError && <p style={{ fontSize:12, color:"#e05c5c", marginTop:10, lineHeight:1.5 }}>{checkoutError}</p>}
              </div>
            )}

            {/* Primary CTA — enter app */}
            <button
              onClick={handleEnterApp}
              disabled={enteringApp}
              style={{
                width:"100%", padding:"15px 0", borderRadius:12,
                border:`1.5px solid ${isCoachClient ? "#27AE60" : T.accent}`,
                background: enteringApp ? T.raised : isCoachClient ? "rgba(39,174,96,0.12)" : T.raised,
                color: enteringApp ? T.muted : T.text,
                fontSize:15, fontWeight:600,
                cursor: enteringApp ? "not-allowed" : "pointer",
                fontFamily:T.font,
                marginBottom:18,
                opacity: enteringApp ? 0.7 : 1,
                transition:"opacity 0.15s, background 0.15s",
                animation:"finalItemIn 0.55s 0.22s cubic-bezier(0.22,1,0.36,1) both",
              }}
            >
              {enteringApp ? "Setting up…" : "Start using Forged →"}
            </button>

            {/* Email updates opt-in — pre-checked; profiles + forged_beta_email_opt_in */}
            <label style={{
              display:"flex", alignItems:"flex-start", gap:10,
              padding:"11px 13px", borderRadius:12,
              border:`0.5px solid ${T.border}`, background:T.surface,
              cursor:"pointer", textAlign:"left",
              animation:"finalItemIn 0.55s 0.3s cubic-bezier(0.22,1,0.36,1) both",
            }}>
              <input
                type="checkbox"
                checked={emailUpdatesOptIn}
                onChange={e => setEmailUpdatesOptIn(e.target.checked)}
                style={{ marginTop:3, width:15, height:15, accentColor:T.gold, flexShrink:0, cursor:"pointer" }}
              />
              <span style={{ fontSize:12, color:T.sub, lineHeight:1.55 }}>
                <span style={{ color:T.text, fontWeight:500 }}>Get Forged weekly updates by email.</span>
                <br/>
                <span style={{ color:T.muted }}>See new features and how user feedback is shaping the app.</span>
              </span>
            </label>
          </div>
        </div>
      </div>
    );
  }

  // ── Virtual step 8: log your first habit — now the last onboarding action ───
  if (step === FIRST_STEP && builtHabits.length > 0) {
    const firstHabit = pickFirstHabit(builtHabits);
    const annotation = HABIT_ANNOTATIONS[firstHabit.habitType] || HABIT_ANNOTATIONS.daily;
    const needsValue = isLegacyProgressType(firstHabit.habitType) || firstHabit.habitType === "project" || firstHabit.habitType === "limit";

    return (
      <div style={wrap}>
        <ProgressHeader currentNum={progressNumber} />

        <div style={{ flex:1, padding:"28px 24px 16px", overflowY:"auto" }}>
          <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, lineHeight:1.2, marginBottom:6 }}>Your first habit.</div>
          <div style={{ fontSize:13, color:T.muted, marginBottom:24, lineHeight:1.5 }}>Log your first entry to see how it works.</div>

          {/* Habit card */}
          <div style={{ background:T.raised, borderRadius:T.r, padding:"18px 20px", marginBottom:16, border:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:48, height:48, borderRadius:14, background:firstHabit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>
              {firstHabit.emoji}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:16, fontWeight:600, color:T.text, marginBottom:2 }}>{firstHabit.name}</div>
              <div style={{ fontSize:12, color:T.muted }}>{HABIT_TYPES[firstHabit.habitType]?.label}</div>
              {firstHabit.habitType === "weekly" && <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>Target: {firstHabit.weeklyTarget}× per week</div>}
              {isLegacyProgressType(firstHabit.habitType) && <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>{firstHabit.startValue}{firstHabit.unit} → {firstHabit.targetValue}{firstHabit.unit}</div>}
              {firstHabit.habitType === "limit" && <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>Budget: {firstHabit.dailyBudget}{firstHabit.unit}/day</div>}
            </div>
          </div>

          {/* Coach annotation */}
          <div style={{ background:"rgba(200,144,42,0.07)", border:`0.5px solid rgba(200,144,42,0.2)`, borderRadius:T.r, padding:"14px 16px", marginBottom:24 }}>
            <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <div style={{ fontSize:18, flexShrink:0, marginTop:1 }}>🤖</div>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.65 }}>{annotation}</div>
            </div>
          </div>

          {/* Simplified log input */}
          {needsValue && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>
                {isLegacyProgressType(firstHabit.habitType) ? `Today's ${firstHabit.unit || "value"}` :
                 firstHabit.habitType === "project"  ? "Minutes worked" :
                 firstHabit.habitType === "limit"    ? `Units used (budget: ${firstHabit.dailyBudget})` : "Value"}
              </div>
              {firstHabit.habitType === "project" ? (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {[15,30,45,60,90].map(m => (
                    <button key={m} onClick={() => setFirstLogValue(String(m))}
                      style={{ padding:"8px 14px", borderRadius:20, border:`1px solid ${firstLogValue===String(m)?firstHabit.color:T.borderStrong}`, background:firstLogValue===String(m)?firstHabit.color+"22":"none", color:firstLogValue===String(m)?firstHabit.color:T.muted, fontSize:13, cursor:"pointer" }}>
                      {m}m
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  style={{ ...styleInp, fontSize:18, padding:"12px 14px" }}
                  type="number" step="0.1"
                  placeholder={isLegacyProgressType(firstHabit.habitType) ? `e.g. ${firstHabit.startValue || 70}` : "0"}
                  value={firstLogValue}
                  onChange={e => setFirstLogValue(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          )}
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button
            onClick={() => {
              if (needsValue && !firstLogValue) return;
              setFirstLogDone(true);
              setShowingFinal(true);
            }}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:(needsValue&&!firstLogValue)?T.surface:firstHabit.color, color:(needsValue&&!firstLogValue)?T.muted:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}
          >
            Log your first entry →
          </button>
          <button onClick={() => { setShowingFinal(true); }}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer", marginTop:6 }}>
            Skip this step
          </button>
        </div>
      </div>
    );
  }

  // ── Virtual step 5: enable notifications ────────────────────────────────────
  if (step === NOTIF_STEP) {
    const blocked = notifPermission === "denied";
    const already = notifEnabled;

    return (
      <div style={wrap}>
        {/* Progress dots */}
        <ProgressHeader currentNum={progressNumber} />

        <div style={{ flex:1, padding:"40px 24px 16px", overflowY:"auto", display:"flex", flexDirection:"column", justifyContent:"center" }}>
          {/* Hero */}
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:52, marginBottom:14, lineHeight:1 }}>🔔</div>
            <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, lineHeight:1.2, marginBottom:10 }}>
              Stay on track.
            </div>
            <div style={{ fontSize:14, color:T.muted, lineHeight:1.6, maxWidth:300, margin:"0 auto" }}>
              One reminder a day. We send it when it matters most — at the end of the day, when you still have time to log.
            </div>
          </div>

          {/* Benefit rows */}
          <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:28 }}>
            {[
              { icon:"🔥", title:"Streak protection", desc:"Get nudged before your streak breaks." },
              { icon:"🎯", title:"Goal countdowns", desc:"Know when a deadline is approaching." },
              { icon:"✅", title:"Daily check-in", desc:"A quick tap to log and close the day." },
            ].map(({ icon, title, desc }) => (
              <div key={title} style={{ display:"flex", alignItems:"center", gap:14, background:T.raised, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"14px 16px" }}>
                <div style={{ fontSize:22, flexShrink:0 }}>{icon}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:2 }}>{title}</div>
                  <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {blocked && (
            <div style={{ background:"rgba(224,92,92,0.08)", border:"0.5px solid rgba(224,92,92,0.25)", borderRadius:T.rsm, padding:"10px 14px", marginBottom:16 }}>
              <div style={{ fontSize:12, color:"#e05c5c", lineHeight:1.6 }}>
                Notifications are blocked in your browser settings. To enable them, open Settings → Safari/Chrome → Notifications and allow Forged.
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          {already ? (
            <button
              onClick={() => builtHabits.length > 0 ? setStep(FIRST_STEP) : setShowingFinal(true)}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", marginBottom:10 }}
            >
              Reminders on — let's go ✓
            </button>
          ) : (
            <button
              onClick={async () => {
                if (onNotifToggle) await onNotifToggle();
                if (builtHabits.length > 0) setStep(FIRST_STEP); else setShowingFinal(true);
              }}
              disabled={notifLoading || blocked}
              style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:blocked?T.surface:T.gold, color:blocked?T.muted:"#0F0F0D", fontSize:16, fontWeight:600, cursor:blocked?"not-allowed":"pointer", opacity:(notifLoading||blocked)?0.7:1, marginBottom:10, transition:"opacity 0.15s" }}
            >
              {notifLoading ? "Enabling…" : blocked ? "Notifications blocked" : "Enable daily reminders 🔔"}
            </button>
          )}
          <button
            onClick={() => builtHabits.length > 0 ? setStep(FIRST_STEP) : setShowingFinal(true)}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}
          >
            Skip notifications
          </button>
        </div>
      </div>
    );
  }

  // ── Virtual step 5: interstitial ─────────────────────────────────────────────
  if (step === INTER_STEP) {
    const count = builtHabits.length;
    const firstName = name.trim() || "Hey";
    const firstHabit = builtHabits.length > 0 ? pickFirstHabit(builtHabits) : null;

    return (
      <div style={wrap}>
        <ProgressHeader currentNum={progressNumber} />

        <div style={{ flex:1, padding:"48px 24px 16px", display:"flex", flexDirection:"column", justifyContent:"center" }}>
          <div style={{ background:"rgba(200,144,42,0.07)", border:`0.5px solid rgba(200,144,42,0.2)`, borderRadius:T.r, padding:"20px 20px 16px", marginBottom:24 }}>
            <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14 }}>
              <div style={{ width:40, height:40, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🤖</div>
              <div style={{
                fontSize:13, fontWeight:500, color:T.text, flex:1, minWidth:0,
                lineHeight:1.35, wordBreak:"break-word", overflowWrap:"anywhere",
              }}
              >
                {coachNameInput.trim() || "Coach"}
              </div>
            </div>
            <div style={{ background:T.surface, borderRadius:"12px 12px 12px 3px", padding:"12px 16px", fontSize:14, color:T.text, lineHeight:1.7, borderLeft:`2px solid rgba(200,144,42,0.35)` }}>
              {firstName}, I've set up {count} habit{count !== 1 ? "s" : ""} based on what you picked. I'll explain what each one means as you go. Let's look at your first one.
            </div>
          </div>

          {firstHabit && (
            <div style={{ background:T.raised, borderRadius:T.rsm, padding:"14px 16px", border:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", gap:12, opacity:0.7 }}>
              <div style={{ fontSize:24 }}>{firstHabit.emoji}</div>
              <div>
                <div style={{ fontSize:14, fontWeight:500, color:T.text }}>{firstHabit.name}</div>
                <div style={{ fontSize:12, color:T.muted }}>{HABIT_TYPES[firstHabit.habitType]?.label}</div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button onClick={() => setStep(NOTIF_STEP)}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:500, cursor:"pointer" }}>
            Let's go →
          </button>
        </div>
      </div>
    );
  }

  // ── Standard steps 0–4 ───────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      <ProgressHeader currentNum={progressNumber} />

      <div style={{ flex:1, padding:"32px 24px 16px", display:"flex", flexDirection:"column", overflowY:"auto" }}>
        <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, lineHeight:1.2, marginBottom:10 }}>{current.title}</div>
        <div style={{ fontSize:14, color:T.muted, marginBottom:24, lineHeight:1.6 }}>{current.sub}</div>

        {current.body && (
          <div style={{ background:T.raised, borderRadius:T.r, padding:"16px 18px", marginBottom:24, borderLeft:`3px solid ${T.accent}` }}>
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.7 }}>{current.body}</div>
          </div>
        )}

        {step === 1 && (
          <div style={{ marginBottom:8 }}>
            <input
              style={{ ...styleInp, fontSize:18, padding:"14px 16px", marginBottom:6 }}
              placeholder="e.g. Alex"
              value={name}
              maxLength={PROFILE_DISPLAY_NAME_MAX}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleContinue()}
              autoFocus
            />
            <div style={{ fontSize:11, color:T.hint }}>
              {name.trim().length}/{PROFILE_DISPLAY_NAME_MAX} characters
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[
              { icon:"🔒", title:"Your habits are yours", desc:"No ads, no data selling. Ever. Your logs and reflections are private to you." },
              { icon:"🛡️", title:"Stored securely", desc:"All data is encrypted in transit and at rest on Supabase's infrastructure." },
              { icon:"📤", title:"Export anytime", desc:"You can download everything as JSON from your profile at any time." },
            ].map((item, i) => (
              <div key={i} style={{ display:"flex", gap:14, alignItems:"flex-start", background:T.raised, borderRadius:T.rsm, padding:"14px 16px" }}>
                <div style={{ fontSize:22, flexShrink:0, marginTop:1 }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:3 }}>{item.title}</div>
                  <div style={{ fontSize:13, color:T.muted, lineHeight:1.6 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {step === COACH_STEP && (
          <div>
            <div style={{ background:"rgba(200,144,42,0.08)", border:`0.5px solid rgba(200,144,42,0.25)`, borderRadius:T.r, padding:"16px 18px", marginBottom:20 }}>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:12 }}>
                <div style={{ width:44, height:44, borderRadius:"50%", background:"rgba(200,144,42,0.15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🤖</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:500, color:T.text }}>Your coach knows your habits</div>
                  <div style={{ fontSize:11, color:T.gold, marginTop:2 }}>⚡ Real context, not generic tips</div>
                </div>
              </div>
              <div style={{ background:T.surface, borderRadius:"12px 12px 12px 3px", padding:"10px 14px", fontSize:13, color:T.muted, lineHeight:1.6, borderLeft:`2px solid rgba(200,144,42,0.3)` }}>
                "Hey {name || "there"} — once you start logging, I can see exactly what's working and where things fall apart. Ask me anything."
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { icon:"🔍", text:"Finds patterns in your logs — like why you always skip Thursdays" },
                { icon:"💬", text:"Answers in plain language, based on your real data" },
                { icon:"⚡", text:"Can log habits, create new ones, and help you reflect" },
              ].map(({ icon, text }) => (
                <div key={text} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"10px 14px", background:T.raised, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
                  <span style={{ fontSize:16, flexShrink:0, marginTop:1 }}>{icon}</span>
                  <span style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{text}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop:16 }}>
              <label style={{ ...lbl, marginBottom:6, display:"block" }}>Coach name (optional)</label>
              <input
                style={{ ...styleInp, fontSize:16, padding:"12px 14px", marginBottom:6 }}
                placeholder="e.g. Atlas — defaults to Coach"
                value={coachNameInput}
                maxLength={PROFILE_COACH_NAME_MAX}
                onChange={e => setCoachNameInput(e.target.value)}
              />
              <div style={{ fontSize:11, color:T.hint }}>
                {coachNameInput.trim().length}/{PROFILE_COACH_NAME_MAX} characters
              </div>
            </div>
          </div>
        )}

        {step === FOCUS_STEP && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              {FOCUS_OPTIONS.map(opt => {
                const isOn = selected.includes(opt.label);
                const wasTapped = tappedFocus === opt.label;
                return (
                  <button key={opt.label} onClick={() => pickFocusAndAdvance(opt)}
                    disabled={advancing && !wasTapped}
                    style={{
                      padding:"14px 12px", borderRadius:T.rsm,
                      border:`1.5px solid ${isOn?opt.color:T.borderStrong}`,
                      background:isOn?opt.color+"20":T.surface,
                      cursor: advancing ? "default" : "pointer",
                      textAlign:"left",
                      transition:"transform 0.18s ease-out, background 0.15s, border 0.15s, opacity 0.15s",
                      opacity: advancing && !wasTapped ? 0.4 : 1,
                      transform: wasTapped ? "scale(1.02)" : "scale(1)",
                      position:"relative",
                    }}>
                    {isOn && (
                      <div style={{
                        position:"absolute", top:8, right:8,
                        width:18, height:18, borderRadius:"50%",
                        background:opt.color,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        animation: wasTapped ? "focusCheckPop 0.3s ease-out" : "none",
                      }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                    <div style={{ fontSize:22, marginBottom:6 }}>{opt.emoji}</div>
                    <div style={{ fontSize:12, fontWeight:500, color:isOn?opt.color:T.text, lineHeight:1.3 }}>{opt.label}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize:12, color:T.muted, textAlign:"center", marginTop:4 }}>
              Tap one to get started — you can add more inside the app.
            </div>
          </>
        )}
      </div>

      {step !== FOCUS_STEP && (
        <div style={{ padding:"16px 24px 48px", flexShrink:0 }}>
          <button
            onClick={handleContinue}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s" }}>
            {current.cta}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SHARE CARD ───────────────────────────────────────────────────────────────
function ShareCardModal({ user, habits, xp, onClose }) {
  useScrollLock(true);
  const level = getLevel(xp);
  const realLogs = habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip"));
  const totalLogs = new Set(realLogs.map(l => l.date)).size; // unique days tracked
  const bestStreak = Math.max(0, ...habits.map(h => getStreak(h)));
  const loggedToday = habits.filter(h => h.habitType !== "log" && isSatisfiedForTodayRing(h)).length;
  const ws = currentWeekStart();
  const weekLogs = habits.reduce((s, h) => s + h.logs.filter(l => l.date >= ws && l.value !== "quicknote" && l.value !== "skip").length, 0);
  const weekTotal = habits.length * 7;
  const weekPct = weekTotal > 0 ? Math.min(100, Math.round((weekLogs / weekTotal) * 100)) : 0;
  const isEmoji = user.avatarUrl && !user.avatarUrl.startsWith("http");

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", zIndex:400, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:"100%", maxWidth:380, animation:"shareSlide 0.3s ease-out", touchAction:"auto", maxHeight:"min(92dvh, 92vh)", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {/* The card — designed for screenshotting */}
        <div id="share-card" style={{ background:"linear-gradient(145deg, #1A1A16 0%, #0F0F0D 100%)", borderRadius:24, padding:"32px 28px 28px", border:`1px solid ${T.borderMid}`, boxShadow:"0 20px 60px rgba(0,0,0,0.8)" }}>
          {/* Top row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28 }}>
            <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
            <div style={{ fontSize:11, color:T.hint, letterSpacing:"0.06em", textTransform:"uppercase" }}>{fmtDate()}</div>
          </div>
          {/* Avatar + name */}
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
            <div style={{ width:52, height:52, borderRadius:"50%", background:T.accent+"22", border:`2px solid ${T.accent}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {isEmoji
                ? <span style={{ fontSize:26 }}>{user.avatarUrl}</span>
                : user.avatarUrl
                ? <img src={user.avatarUrl} style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover" }}/>
                : <span style={{ fontFamily:T.serif, fontSize:24, color:T.accent }}>{(user.name||"?").charAt(0).toUpperCase()}</span>
              }
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{
                fontSize:18, fontWeight:500, color:T.text,
                lineHeight:1.25, wordBreak:"break-word", overflowWrap:"anywhere",
              }}
              >
                {user.name}
              </div>
              <div style={{ fontSize:12, color:level.color, fontWeight:500, marginTop:2 }}>⚡ {level.label} · {xp} xp</div>
            </div>
          </div>
          {/* Stats grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {[
              { label:"This week",    value:`${weekPct}%`,    sub:"completion",   color:weekPct>=70?T.green:T.amber },
              { label:"Today",        value:`${loggedToday}/${habits.length}`, sub:"habits logged", color:T.accent },
              { label:"Best streak",  value:`${bestStreak}d`, sub:"consecutive",  color:T.gold },
              { label:"Days tracked", value:totalLogs,        sub:"all time",     color:T.text },
            ].map((s, i) => (
              <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:14, padding:"14px 16px", border:`0.5px solid ${T.border}` }}>
                <div style={{ fontSize:22, fontWeight:600, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:11, color:T.hint, marginTop:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>{s.sub}</div>
                <div style={{ fontSize:10, color:T.hint, marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Habits row */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
            {habits.slice(0, 8).map(h => (
              <div key={h.id} style={{ fontSize:11, padding:"4px 10px", borderRadius:12, background:h.color+"22", color:h.color, border:`0.5px solid ${h.color+"44"}` }}>
                {h.emoji} {h.name}
              </div>
            ))}
          </div>
          {/* Footer */}
          <div style={{ borderTop:`0.5px solid ${T.border}`, paddingTop:14, fontSize:11, color:T.hint, letterSpacing:"0.04em" }}>
            forged-sage.vercel.app · track what you're forging
          </div>
        </div>
        {/* Instructions */}
        <div style={{ textAlign:"center", marginTop:18, fontSize:13, color:"rgba(255,255,255,0.5)" }}>
          Screenshot this to share 📸
        </div>
        <button onClick={onClose} style={{ width:"100%", marginTop:14, padding:14, borderRadius:T.rsm, border:"none", background:T.raised, color:T.muted, fontSize:14, cursor:"pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}

// ─── AVATAR PICKER ────────────────────────────────────────────────────────────
