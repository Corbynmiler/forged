// ─── HUB SCREEN ───────────────────────────────────────────────────────────────
// When an Arc is active, Today is reserved for the Arc loop (identity, proof,
// verdict). The Hub is where Other Habits, Goals, and Loose Ends still live —
// nothing was deleted, just moved off the main surface. When no Arc is active,
// this screen still renders normally as a catch-all reference.
//
// All callbacks are the same ones Today uses, threaded through App.jsx.

import { useState, useRef } from "react";
import { T } from "../theme.js";
import { todayStr, getStreak, isSatisfiedForTodayRing } from "../utils.js";
import { SLabel } from "../components/ui.jsx";
import {
  DailyCard, WeeklyCard, ProjectCard, LimitCard, LogCard,
  TodayGoalCard,
} from "../components/habitCards.jsx";

function HubLooseEnds({ tasks = [], today, onAdd, onComplete, onPin, onDelete }) {
  const [inputText, setInputText] = useState("");
  const [inputOpen, setInputOpen] = useState(false);
  const inputRef = useRef(null);

  if (!onAdd) return null;

  const pending = tasks.filter(t => !t.done);
  const done    = tasks.filter(t => t.done);
  const all     = [...pending, ...done];
  const isCarryOver = (task) => task.date !== today;

  function submitAdd() {
    const text = inputText.trim();
    if (!text) { setInputOpen(false); return; }
    onAdd(text);
    setInputText("");
    setInputOpen(false);
  }
  function openInput() {
    setInputOpen(true);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  const pinBtn = (task) => (
    <button type="button" onClick={() => onPin(task.id, !task.pinned)}
      title={task.pinned ? "Unpin" : "Pin to carry forward"}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px",
        color: task.pinned ? T.gold : T.hint, fontSize: 13, lineHeight: 1, flexShrink: 0 }}
      aria-label={task.pinned ? "Unpin task" : "Pin task to carry forward"}>📌</button>
  );
  const delBtn = (task) => (
    <button type="button" onClick={() => onDelete(task.id)} title="Delete"
      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px",
        color: T.hint, fontSize: 14, lineHeight: 1, flexShrink: 0 }}
      aria-label="Delete loose end">✕</button>
  );

  return (
    <div style={{ margin: "0 14px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Loose Ends</div>
        {done.length > 0 && (
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 500 }}>{done.length} cleared</div>
        )}
      </div>
      {all.length === 0 && !inputOpen && (
        <button type="button" onClick={openInput}
          style={{ width: "100%", padding: "11px 14px", borderRadius: T.rsm, border: `0.5px dashed ${T.border}`, background: "none", color: T.hint, fontSize: 13, cursor: "pointer", textAlign: "left", fontFamily: T.font }}>
          + Add a loose end
        </button>
      )}
      {pending.map(task => (
        <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `0.5px solid ${T.border}` }}>
          <button type="button" onClick={e => onComplete(task.id, true, e.currentTarget)}
            style={{ width: 22, height: 22, borderRadius: "50%", border: `1.5px solid ${T.borderStrong}`, background: "none", cursor: "pointer", flexShrink: 0 }}
            aria-label="Mark done"/>
          <span style={{ flex: 1, fontSize: 14, color: T.text, lineHeight: 1.4 }}>
            {isCarryOver(task) && <span style={{ fontSize: 10, color: T.gold, fontWeight: 600, marginRight: 5 }}>↩</span>}
            {task.text}
          </span>
          {pinBtn(task)}{delBtn(task)}
        </div>
      ))}
      {done.map(task => (
        <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `0.5px solid ${T.border}`, opacity: 0.5 }}>
          <button type="button" onClick={e => onComplete(task.id, false, e.currentTarget)}
            style={{ width: 22, height: 22, borderRadius: "50%", border: `1.5px solid ${T.borderStrong}`, background: T.accent, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}
            aria-label="Mark undone">✓</button>
          <span style={{ flex: 1, fontSize: 14, color: T.muted, lineHeight: 1.4, textDecoration: "line-through" }}>{task.text}</span>
          {delBtn(task)}
        </div>
      ))}
      {all.length > 0 && !inputOpen && (
        <button type="button" onClick={openInput}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 0 2px", background: "none", border: "none", cursor: "pointer", color: T.hint, fontSize: 12, fontFamily: T.font }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add a loose end
        </button>
      )}
      {inputOpen && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input ref={inputRef} type="text" value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitAdd(); } if (e.key === "Escape") { setInputOpen(false); setInputText(""); } }}
            placeholder="What needs clearing?" maxLength={120}
            style={{ flex: 1, padding: "9px 12px", borderRadius: T.rsm, border: `0.5px solid ${T.borderStrong}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, outline: "none", boxSizing: "border-box" }}/>
          <button type="button" onClick={submitAdd}
            style={{ padding: "9px 14px", borderRadius: T.rsm, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, flexShrink: 0 }}>
            Add
          </button>
          <button type="button" onClick={() => { setInputOpen(false); setInputText(""); }}
            style={{ padding: "9px 10px", borderRadius: T.rsm, border: "none", background: T.surface, color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: T.font, flexShrink: 0 }}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export function HubScreen({
  habits = [],
  goals = [],
  tasks = [],
  activeBlock = null,
  onBack = null,
  onAdd = null,
  // Habit callbacks (mirror Today's interface)
  onTap, onUndo, onSkip, onAddNote, onLogZero, onOpenLog,
  onSaveLogEntry,
  onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId,
  onLowerBudget = null, onOpenCoachWithDraft = null,
  // Goal callbacks
  onOpenGoalLog, onEditGoal, onCompleteGoal, onDeleteGoal, onShareGoal, onOpenGoalDetail,
  // Task callbacks
  onAddTask, onCompleteTask, onPinTask, onDeleteTask,
}) {
  const today = todayStr();
  const arcActive = !!activeBlock?.id;
  const activeGoals = goals.filter(g => g.status !== "completed");
  const trackHabits = habits.filter(h => h.habitType !== "log");
  const logHabits = habits.filter(h => h.habitType === "log");

  // When Arc is active: "Other Habits" = non-proof habits for current Arc.
  // When no Arc: this is just everything (Hub still works as a backup home).
  const isProofForArc = (h) => arcActive && h.isProofAction === true && h.blockId === activeBlock.id;
  const otherHabits = arcActive ? trackHabits.filter(h => !isProofForArc(h)) : trackHabits;

  const daily   = otherHabits.filter(h => h.habitType === "daily");
  const limit   = otherHabits.filter(h => h.habitType === "limit");
  const weekly  = otherHabits.filter(h => h.habitType === "weekly");
  const project = otherHabits.filter(h => h.habitType === "project");

  const totalCount = otherHabits.length + activeGoals.length + logHabits.length + tasks.length;

  return (
    <div style={{ overflowX: "hidden", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}>
      {/* Header */}
      <div style={{ padding: "16px 18px 10px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: T.muted, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
            Hub
          </div>
          <div style={{ fontFamily: T.serif, fontSize: 28, color: T.text, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
            All habits & goals
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.45, maxWidth: 380 }}>
            {arcActive
              ? "Today's screen is focused on Arc proof. Everything else still lives here — habits, goals, and loose ends."
              : "Everything you track. Add a new habit, goal, or quick task."}
          </div>
        </div>
        {onBack && (
          <button type="button" onClick={onBack}
            style={{ flexShrink: 0, padding: "8px 14px", borderRadius: T.rsm, background: T.surface, border: `0.5px solid ${T.border}`, color: T.sub, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
            ← Today
          </button>
        )}
      </div>

      {totalCount === 0 && (
        <div style={{ padding: "32px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚒️</div>
          <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.65 }}>
            Nothing in the Hub yet. Your proof actions stay on Today; non-proof habits, goals, and loose ends will show up here.
          </div>
          {onAdd && (
            <button type="button" onClick={onAdd}
              style={{ marginTop: 18, padding: "11px 22px", borderRadius: T.rsm, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Add a habit or goal
            </button>
          )}
        </div>
      )}

      {/* Other Habits */}
      {daily.length > 0 && (
        <>
          <SLabel>Daily</SLabel>
          {daily.map(h => (
            <DailyCard key={h.id} habit={h}
              onTap={onTap} onSkip={onSkip} onAddNote={onAddNote}
              onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit}
              sharingThisHabit={sharingHabitId === h.id}/>
          ))}
        </>
      )}
      {limit.length > 0 && (
        <>
          <SLabel>Limits</SLabel>
          {limit.map(h => (
            <LimitCard key={h.id} habit={h}
              onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote}
              onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit}
              sharingThisHabit={sharingHabitId === h.id}
              onLowerBudget={onLowerBudget} onOpenCoachWithDraft={onOpenCoachWithDraft}/>
          ))}
        </>
      )}
      {weekly.length > 0 && (
        <>
          <SLabel>Weekly targets</SLabel>
          {weekly.map(h => (
            <WeeklyCard key={h.id} habit={h}
              onTap={onTap} onSkip={onSkip} onAddNote={onAddNote}
              onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit}
              sharingThisHabit={sharingHabitId === h.id}/>
          ))}
        </>
      )}
      {project.length > 0 && (
        <>
          <SLabel>Build</SLabel>
          {project.map(h => (
            <ProjectCard key={h.id} habit={h}
              onOpenLog={onOpenLog} onAddNote={onAddNote}
              onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit}
              sharingThisHabit={sharingHabitId === h.id}/>
          ))}
        </>
      )}

      {/* Goals */}
      {activeGoals.length > 0 && (
        <>
          <SLabel>Goals</SLabel>
          {activeGoals.map(g => (
            <TodayGoalCard key={g.id} goal={g}
              onOpenLog={onOpenGoalLog} onEdit={onEditGoal} onComplete={onCompleteGoal}
              onDelete={onDeleteGoal} onShareGoal={onShareGoal} onOpen={onOpenGoalDetail}/>
          ))}
        </>
      )}

      {/* Logs */}
      {logHabits.length > 0 && onSaveLogEntry && (
        <>
          <SLabel>Logs</SLabel>
          {logHabits.map(h => (
            <LogCard key={h.id} habit={h} onSaveEntry={onSaveLogEntry}
              onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit}/>
          ))}
        </>
      )}

      {/* Loose Ends */}
      {onAddTask && (
        <HubLooseEnds
          tasks={tasks} today={today}
          onAdd={onAddTask} onComplete={onCompleteTask}
          onPin={onPinTask} onDelete={onDeleteTask}/>
      )}

      <div style={{ height: 24 }}/>
    </div>
  );
}
