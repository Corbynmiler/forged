// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
import { useMemo, useState, useEffect, useRef } from "react";
import { T, COACH_ICON_OPTIONS } from "../theme.js";
import { todayStr, daysAgo, parseLocal, isSatisfiedForTodayRing, getLevel, getStreak, analyzeDeepInsights } from "../utils.js";
import { Ring, SLabel, Modal, GBtn } from "../components/ui.jsx";
import {
  DailyCard, WeeklyCard, ProjectCard, LimitCard, LogCard,
  TodayGoalCard,
} from "../components/habitCards.jsx";

// ── Coach greeting helpers (deterministic, no AI) ──────────────────────────
function coachGreetingDaysLeft(targetYmd) {
  const t = todayStr();
  if (!targetYmd || targetYmd < t) return null;
  return Math.round((new Date(targetYmd + "T12:00:00") - new Date(t + "T12:00:00")) / 86400000);
}

function toYmd(d) {
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

// Returns a coach line if a daily habit has a clear skip-day pattern in the last 28 days.
function findSkippedDayPattern(habits) {
  const today = todayStr();
  const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  for (const h of habits) {
    if (h.habitType !== "daily") continue;
    const logs = (h.logs || []).filter(l => l.value !== "skip" && l.value !== "quicknote");
    if (logs.length < 5) continue;
    const oldestLog = logs.map(l => l.date).sort()[0];
    const daysSince = Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(oldestLog + "T12:00:00Z")) / 86400000);
    if (daysSince < 7) continue;
    const loggedSet = new Set(logs.map(l => l.date));
    const dayCounts = [0,0,0,0,0,0,0];
    let totalMissed = 0;
    for (let i = 1; i <= 28; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      if (!loggedSet.has(toYmd(d))) { dayCounts[d.getDay()]++; totalMissed++; }
    }
    if (totalMissed < 4) continue;
    const maxMissed = Math.max(...dayCounts);
    if (maxMissed / totalMissed >= 0.55 && maxMissed >= 3) {
      const dayName = DAY_NAMES[dayCounts.indexOf(maxMissed)];
      return `${String(h.name || "").slice(0, 18)} — you often skip ${dayName}s. Want to talk about it?`;
    }
  }
  return null;
}

const COACH_FIRST_HABIT_DRAFT = "Help me pick my first habit to track";

function buildCoachGreetingLine({ habits, goals }) {
  const hr  = new Date().getHours();
  const tod = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
  const trackHabits = (habits || []).filter(h => h.habitType !== "log");
  const activeGoals = (goals || []).filter(g => g.status !== "completed");
  const total = trackHabits.length;
  const loggedCount = total ? trackHabits.filter(h => isSatisfiedForTodayRing(h)).length : 0;
  const all  = total > 0 && loggedCount === total;
  const some = total > 0 && loggedCount > 0 && !all;
  const none = total > 0 && loggedCount === 0;

  let urgent = null, bestLeft = 8;
  for (const g of activeGoals) {
    if (!g.targetDate) continue;
    const left = coachGreetingDaysLeft(g.targetDate);
    if (left != null && left >= 0 && left < 7 && left < bestLeft) { bestLeft = left; urgent = { g, left }; }
  }
  if (urgent) {
    const nm = String(urgent.g.name || "Goal").slice(0, 22);
    if (urgent.left === 0) return `"${nm}" is due today — check in?`;
    if (urgent.left === 1) return `"${nm}" due tomorrow — on track?`;
    return `"${nm}" in ${urgent.left} days — one step today?`;
  }

  let topH = null, topS = 0;
  for (const h of trackHabits) {
    const s = getStreak(h);
    if (s >= 3 && s > topS) { topS = s; topH = h; }
  }
  if (topH) return `${String(topH.name || "Habit").slice(0, 18)} — ${topS}-day streak. Keep it?`;

  const skipPattern = findSkippedDayPattern(trackHabits);
  if (skipPattern) return skipPattern;

  if (none && hr >= 14) {
    const yesterday = daysAgo(1);
    const loggedYesterday = trackHabits.some(h =>
      (h.logs || []).some(l => l.date === yesterday && l.value !== "skip" && l.value !== "quicknote")
    );
    if (loggedYesterday) {
      const pending = trackHabits.filter(h => !isSatisfiedForTodayRing(h));
      if (pending.length === 1) return `${String(pending[0].name || "").slice(0, 18)} — you logged yesterday but not today yet.`;
      if (pending.length > 1) return `${pending.length} habits left — you were on it yesterday.`;
    }
  }

  if (all)  return tod === "morning" ? "All habits in — you're ahead today." : tod === "afternoon" ? "Full sweep already — nice." : "Everything logged — how was the day?";
  if (some) {
    const rem = total - loggedCount;
    if (rem === 1) return "One left — finish it off.";
    return tod === "morning" ? `Good start — ${rem} more to go.`
      : tod === "afternoon" ? `Almost there — ${rem} left.`
      : `Solid progress — ${rem} left tonight.`;
  }
  if (none) return tod === "morning" ? "Morning — tap a habit when you're ready." : tod === "afternoon" ? "Still time to log something today." : "Evening — log what you got done?";
  return tod === "morning" ? "How's the morning going?" : tod === "evening" ? "How did today go?" : "How's the day going?";
}

export function CoachGreeting({ coachName, coachIcon, habits, goals, habitAccent, onOpenMic, habitCompletionPercentage, habitsLoggedTodayCount, totalTrackables }) {
  const rawCoach = (coachName ?? "").trim();
  const hasNamedCoach = rawCoach.length > 0;
  const displayName = rawCoach || "Coach";
  const ringComplete =
    typeof habitCompletionPercentage === "number"
    && typeof totalTrackables === "number"
    && totalTrackables > 0
    && habitCompletionPercentage === 100;
  const body = ringComplete ? "" : buildCoachGreetingLine({ habits, goals });
  const n = typeof habitsLoggedTodayCount === "number" ? habitsLoggedTodayCount : 0;
  const habitPhrase = `${n} habit${n === 1 ? "" : "s"} logged`;
  const line = ringComplete
    ? (hasNamedCoach ? `${habitPhrase}. ${rawCoach}: Clean day.` : `${habitPhrase}. Clean day.`)
    : `${displayName}: ${body}`;
  const initial = displayName.charAt(0).toUpperCase();
  const accent  = habitAccent || T.accent;
  return (
    <button type="button" onClick={onOpenMic} aria-label={`Open ${displayName} — voice`}
      style={{ display:"flex", alignItems:"center", gap:12, width:"calc(100% - 28px)", margin:"8px 14px 0", padding:"12px 14px", background:T.surface, border:`0.5px solid ${T.border}`, borderLeft:`3px solid ${accent}`, borderRadius:T.rsm, cursor:"pointer", textAlign:"left", fontFamily:T.font, boxSizing:"border-box" }}>
      <div style={{ width:36, height:36, borderRadius:"50%", flexShrink:0, background:`${accent}22`, border:`1px solid ${accent}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, lineHeight:1 }} aria-hidden>
        {coachIcon && COACH_ICON_OPTIONS.includes(coachIcon) ? coachIcon : initial}
      </div>
      <span style={{ flex:1, minWidth:0, fontSize:13.5, fontWeight:500, color:T.text, lineHeight:1.45, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>
        {line}
      </span>
    </button>
  );
}

// ── Yesterday callback card ────────────────────────────────────────────────
function YesterdayReceiptCard({ entry }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("forged_yesterday_dismissed") === todayStr(); }
    catch { return false; }
  });

  if (dismissed || !entry) return null;

  const parsed = parseReceiptFields(entry.content);
  // Only render when there's something genuinely useful to carry forward
  if (!parsed || (!parsed.pattern && !parsed.tomorrow)) return null;

  function dismiss() {
    try { localStorage.setItem("forged_yesterday_dismissed", todayStr()); } catch (_) {}
    setDismissed(true);
  }

  return (
    <div style={{ position:"relative", margin:"8px 14px 0", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:T.surface, padding:"11px 40px 11px 14px" }}>
      <button type="button" onClick={dismiss} aria-label="Dismiss yesterday card"
        style={{ position:"absolute", top:8, right:10, background:"none", border:"none", cursor:"pointer", padding:4, color:T.hint, fontSize:13, lineHeight:1, fontFamily:T.font }}>
        ✕
      </button>
      <div style={{ fontSize:10, fontWeight:700, color:T.hint, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:6 }}>Yesterday</div>
      <div style={{ fontSize:13, fontWeight:500, color:T.sub, lineHeight:1.4, marginBottom:parsed.pattern||parsed.tomorrow?7:0 }}>{parsed.title}</div>
      {parsed.pattern && (
        <div style={{ display:"flex", gap:6, marginBottom:parsed.tomorrow?4:0, alignItems:"flex-start" }}>
          <span style={{ fontSize:10, color:T.accent, fontWeight:700, marginTop:2, flexShrink:0 }}>◎</span>
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>{parsed.pattern}</div>
        </div>
      )}
      {parsed.tomorrow && (
        <div style={{ display:"flex", gap:6, alignItems:"flex-start" }}>
          <span style={{ fontSize:10, color:T.green, fontWeight:700, marginTop:2, flexShrink:0 }}>↑</span>
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>
            <span style={{ color:T.hint, marginRight:3 }}>Today's win:</span>{parsed.tomorrow}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Daily Receipt ──────────────────────────────────────────────────────────
function parseReceiptFields(content) {
  if (!content) return null;
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const title = lines[0];
  let pattern = null, tomorrow = null, missed = null;
  for (const l of lines) {
    if (!pattern  && l.startsWith("Pattern:"))  pattern  = l.slice("Pattern:".length).trim();
    if (!tomorrow && l.startsWith("Tomorrow:")) tomorrow = l.slice("Tomorrow:".length).trim();
    if (!missed   && l.startsWith("Missed:"))   missed   = l.slice("Missed:".length).trim();
  }
  return { title, pattern, tomorrow, missed };
}

function TodayReceiptCard({ entry, loggedCount, generating, onGenerate, onOpenJournal, onOpenCoachWithDraft }) {
  if (loggedCount === 0) return null;
  if (entry) {
    const parsed = parseReceiptFields(entry.content);
    if (!parsed) return null;
    // Show "add context" nudge when there are real missed habits (not "none", not "not tracked")
    const missedStr = (parsed.missed || "").toLowerCase().trim();
    const hasMissed = missedStr && missedStr !== "none" && !missedStr.startsWith("not tracked");
    const contextDraft = hasMissed
      ? `I want to add some context on today — ${parsed.missed} didn't make it in. Here's why:`
      : null;
    return (
      <div style={{ margin:"0 14px 10px", borderRadius:T.r, border:`0.5px solid ${T.border}`, background:T.raised, overflow:"hidden" }}>
        <div style={{ padding:"14px 16px 12px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:T.hint, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>Today's receipt</div>
          <div style={{ fontSize:15, fontWeight:500, color:T.text, fontFamily:T.serif, marginBottom:parsed.pattern||parsed.tomorrow||hasMissed?10:0, lineHeight:1.35 }}>{parsed.title}</div>
          {parsed.pattern && (
            <div style={{ display:"flex", gap:6, marginBottom:6, alignItems:"flex-start" }}>
              <span style={{ fontSize:11, color:T.accent, fontWeight:700, marginTop:2, flexShrink:0 }}>◎</span>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>
                <span style={{ color:T.muted, marginRight:4 }}>Pattern:</span>{parsed.pattern}
              </div>
            </div>
          )}
          {parsed.tomorrow && (
            <div style={{ display:"flex", gap:6, marginBottom:hasMissed?8:0, alignItems:"flex-start" }}>
              <span style={{ fontSize:11, color:T.green, fontWeight:700, marginTop:2, flexShrink:0 }}>↑</span>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>
                <span style={{ color:T.muted, marginRight:4 }}>Tomorrow:</span>{parsed.tomorrow}
              </div>
            </div>
          )}
          {hasMissed && onOpenCoachWithDraft && (
            <button type="button" onClick={() => onOpenCoachWithDraft(contextDraft)}
              style={{ display:"block", width:"100%", padding:"7px 10px", marginTop:2, background:"rgba(255,255,255,0.04)", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, cursor:"pointer", textAlign:"left", fontFamily:T.font }}>
              <span style={{ fontSize:12, color:T.muted }}>Gaps with no context — </span>
              <span style={{ fontSize:12, color:T.sub, fontWeight:500 }}>tell the coach why →</span>
            </button>
          )}
        </div>
        <div style={{ display:"flex", borderTop:`0.5px solid ${T.border}` }}>
          <button type="button" onClick={onOpenJournal}
            style={{ flex:1, padding:"10px 0", background:"none", border:"none", fontSize:12, color:T.accent, fontWeight:500, cursor:"pointer", borderRight:`0.5px solid ${T.border}`, fontFamily:T.font }}>
            Full entry →
          </button>
          <button type="button" onClick={onGenerate} disabled={generating}
            style={{ flex:1, padding:"10px 0", background:"none", border:"none", fontSize:12, color:generating?T.hint:T.muted, cursor:generating?"not-allowed":"pointer", fontFamily:T.font }}>
            {generating ? "Writing…" : "↺ Regenerate"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ margin:"0 14px 10px" }}>
      <button type="button" onClick={onGenerate} disabled={generating}
        style={{ width:"100%", padding:"12px 16px", borderRadius:T.r, border:`0.5px dashed ${T.borderStrong}`, background:"none", cursor:generating?"not-allowed":"pointer", fontFamily:T.font, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, boxSizing:"border-box" }}>
        <div style={{ textAlign:"left" }}>
          <div style={{ fontSize:13, fontWeight:500, color:generating?T.hint:T.text }}>
            {generating ? "Writing today's receipt…" : "Wrap today"}
          </div>
          <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>Your coach writes up the day from your logs and notes</div>
        </div>
        {!generating && <span style={{ fontSize:14, color:T.muted, flexShrink:0 }}>→</span>}
      </button>
    </div>
  );
}

// ── LooseEndsSection ─────────────────────────────────────────────────────────
function LooseEndsSection({ tasks = [], today, onAdd, onComplete, onPin, onDelete }) {
  const [inputText, setInputText]   = useState("");
  const [inputOpen, setInputOpen]   = useState(false);
  const inputRef = useRef(null);

  // Split: pending (today or pinned carry-overs), done
  const pending = tasks.filter(t => !t.done);
  const done    = tasks.filter(t => t.done);
  const all     = [...pending, ...done];

  if (!onAdd) return null; // read-only contexts (demo)

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
    <button
      type="button"
      onClick={() => onPin(task.id, !task.pinned)}
      title={task.pinned ? "Unpin (won't carry forward)" : "Pin to carry forward if not done"}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: "4px 6px",
        color: task.pinned ? T.gold : T.hint, fontSize: 13, lineHeight: 1, flexShrink: 0,
      }}
      aria-label={task.pinned ? "Unpin task" : "Pin task to carry forward"}
    >
      📌
    </button>
  );

  const delBtn = (task) => (
    <button
      type="button"
      onClick={() => onDelete(task.id)}
      title="Delete loose end"
      style={{
        background: "none", border: "none", cursor: "pointer", padding: "4px 6px",
        color: T.hint, fontSize: 14, lineHeight: 1, flexShrink: 0,
      }}
      aria-label="Delete loose end"
    >
      ✕
    </button>
  );

  const isCarryOver = (task) => task.date !== today;

  return (
    <div style={{ margin: "0 14px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, marginTop: 2 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Loose Ends
        </div>
        {done.length > 0 && (
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 500 }}>
            {done.length} cleared
          </div>
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
          <button
            type="button"
            onClick={e => onComplete(task.id, true, e.currentTarget)}
            style={{
              width: 22, height: 22, borderRadius: "50%", border: `1.5px solid ${T.borderStrong}`,
              background: "none", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="Mark done"
          />
          <span style={{ flex: 1, fontSize: 14, color: T.text, lineHeight: 1.4 }}>
            {isCarryOver(task) && <span style={{ fontSize: 10, color: T.gold, fontWeight: 600, marginRight: 5 }}>↩</span>}
            {task.text}
          </span>
          {pinBtn(task)}
          {delBtn(task)}
        </div>
      ))}

      {done.map(task => (
        <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `0.5px solid ${T.border}`, opacity: 0.5 }}>
          <button
            type="button"
            onClick={e => onComplete(task.id, false, e.currentTarget)}
            style={{
              width: 22, height: 22, borderRadius: "50%", border: `1.5px solid ${T.borderStrong}`,
              background: T.accent, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 12, fontWeight: 700,
            }}
            aria-label="Mark undone"
          >
            ✓
          </button>
          <span style={{ flex: 1, fontSize: 14, color: T.muted, lineHeight: 1.4, textDecoration: "line-through" }}>
            {task.text}
          </span>
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
          <input
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitAdd(); } if (e.key === "Escape") { setInputOpen(false); setInputText(""); } }}
            placeholder="What needs clearing?"
            maxLength={120}
            style={{ flex: 1, padding: "9px 12px", borderRadius: T.rsm, border: `0.5px solid ${T.borderStrong}`, background: T.surface, color: T.text, fontSize: 14, fontFamily: T.font, outline: "none", boxSizing: "border-box" }}
          />
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

const ARC_DURATION_DAYS = 56;
const MS_PER_DAY = 86400000;

function arcDayInfo(activeBlock) {
  const today = todayStr();
  const daysElapsed = Math.floor((parseLocal(today) - parseLocal(activeBlock.startDate)) / MS_PER_DAY);
  const dayX = Math.min(ARC_DURATION_DAYS, Math.max(1, daysElapsed + 1));
  const week = Math.min(8, Math.ceil((daysElapsed + 1) / 7));
  const progress = Math.min(1, Math.max(0, daysElapsed / ARC_DURATION_DAYS));
  return { dayX, week, daysElapsed, progress };
}

function isProofForArc(habit, blockId) {
  return habit.isProofAction === true && habit.blockId === blockId;
}

// ── Arc strip + detail modal ───────────────────────────────────────────────
function ArcStrip({ activeBlock }) {
  const [open, setOpen] = useState(false);
  const { dayX, week, progress } = arcDayInfo(activeBlock);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display:"block", width:"calc(100% - 28px)", margin:"8px 14px 0",
          padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.border}`,
          background:T.raised, cursor:"pointer", textAlign:"left", fontFamily:T.font, boxSizing:"border-box",
        }}
      >
        <div style={{ fontSize:10, fontWeight:700, color:T.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>
          Day {dayX} of {ARC_DURATION_DAYS} · Week {week}/8
        </div>
        <div style={{ fontSize:9, fontWeight:700, color:T.hint, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:4 }}>
          You're becoming
        </div>
        <div style={{
          fontFamily:T.serif, fontSize:19, color:T.text, lineHeight:1.35, marginBottom:12,
          display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden",
        }}>
          {activeBlock.identity}
        </div>
        <div style={{ height:3, borderRadius:2, background:T.surface, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${Math.round(progress * 100)}%`, background:T.accent, borderRadius:2, transition:"width 0.4s ease" }}/>
        </div>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div style={{ fontSize:10, fontWeight:700, color:T.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6 }}>
            Day {dayX} of {ARC_DURATION_DAYS} · Week {week}/8
          </div>
          <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, lineHeight:1.3, marginBottom:20 }}>{activeBlock.identity}</div>
          {activeBlock.whyStatement ? (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.hint, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>Why</div>
              <div style={{ fontSize:14, color:T.sub, lineHeight:1.6 }}>{activeBlock.whyStatement}</div>
            </div>
          ) : null}
          {activeBlock.oldPattern ? (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.hint, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>Old pattern</div>
              <div style={{ fontSize:14, color:T.sub, lineHeight:1.6 }}>{activeBlock.oldPattern}</div>
            </div>
          ) : null}
          {activeBlock.minimumProof ? (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.hint, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:6 }}>On bad days…</div>
              <div style={{ fontSize:14, color:T.sub, lineHeight:1.6 }}>{activeBlock.minimumProof}</div>
            </div>
          ) : null}
          <div style={{ fontSize:12, color:T.hint, marginBottom:8 }}>Tap to edit (soon)</div>
          <GBtn onClick={() => setOpen(false)}>Close</GBtn>
        </Modal>
      )}
    </>
  );
}

function OtherHabitsCollapsible({ children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          width:"calc(100% - 28px)", margin:"4px 14px 8px", padding:"8px 4px",
          background:"none", border:"none", cursor:"pointer", fontFamily:T.font,
        }}
      >
        <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em", color:T.sub, textTransform:"uppercase" }}>Other habits</span>
        <span style={{ fontSize:12, color:T.muted }} aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

// ── TodayScreen ────────────────────────────────────────────────────────────
export function TodayScreen({
  habits, goals = [], xp,
  onTap, onUndo, onSkip, onAddNote, onLogZero, onOpenLog,
  onOpenGoalLog, onEditGoal, onCompleteGoal, onDeleteGoal, onShareGoal,
  onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId,
  onXPInfo, onAdd, onSaveLogEntry, hideFloatingAdd,
  coachEverOpened = true, onOpenCoachMic, onOpenCoachWithDraft,
  coachName, coachIcon, coachHabitColor, onOpenGoalDetail,
  onLowerBudget = null,
  onOpenBrief = null,
  onOpenInsights = null,
  todayJournalEntry = null,
  onGenerateReceipt = null,
  generatingReceipt = false,
  onOpenJournal = null,
  yesterdayJournalEntry = null,
  // Loose Ends
  tasks = [],
  onAddTask = null,
  onCompleteTask = null,
  onPinTask = null,
  onDeleteTask = null,
  activeBlock = null,
}) {
  const [briefPreview, setBriefPreview] = useState(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("forged_brief_preview");
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p?.text || !p?.week_start) return;
      const todayISO = new Date().toISOString().slice(0, 10);
      const weekEnd = new Date(new Date(p.week_start).getTime() + 6 * 864e5).toISOString().slice(0, 10);
      if (todayISO >= p.week_start && todayISO <= weekEnd) setBriefPreview(p);
    } catch (_) {}
  }, []);

  const activeGoals    = goals.filter(g => g.status !== "completed");
  const trackHabits    = habits.filter(h => h.habitType !== "log");
  const logHabits      = habits.filter(h => h.habitType === "log");
  const arcActive      = !!activeBlock?.id;
  const { dayX: arcDayX } = arcActive ? arcDayInfo(activeBlock) : { dayX: 1 };
  const proofHabits    = arcActive
    ? trackHabits.filter(h => isProofForArc(h, activeBlock.id))
    : [];
  const otherTrackHabits = arcActive
    ? trackHabits.filter(h => !isProofForArc(h, activeBlock.id))
    : trackHabits;
  const proofDone      = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const proofTotal     = proofHabits.length;
  const loggedCount    = arcActive
    ? proofDone
    : trackHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const totalTrackables = arcActive ? proofTotal : trackHabits.length;
  const pct = totalTrackables ? Math.round((loggedCount / totalTrackables) * 100) : 0;
  const hr  = new Date().getHours();
  const timeGreeting = hr < 12 ? "Rise and forge." : hr < 17 ? "Keep the heat up." : "Finish strong.";
  const arcGreeting = proofTotal === 0
    ? `Day ${arcDayX} — show one piece of proof.`
    : pct === 100
      ? `Day ${arcDayX} — proof shown.`
      : `Day ${arcDayX} — show one piece of proof.`;
  const greeting = arcActive
    ? arcGreeting
    : pct === 0 ? timeGreeting
    : pct < 50  ? "Building momentum."
    : pct < 100 ? "More than halfway."
    : timeGreeting;
  const level = getLevel(xp);
  const habitsForSections = arcActive ? otherTrackHabits : habits;
  const daily   = habitsForSections.filter(h => h.habitType === "daily");
  const limit   = habitsForSections.filter(h => h.habitType === "limit");
  const weekly  = habitsForSections.filter(h => h.habitType === "weekly");
  const project = habitsForSections.filter(h => h.habitType === "project");
  const proofDaily   = proofHabits.filter(h => h.habitType === "daily");
  const proofLimit   = proofHabits.filter(h => h.habitType === "limit");
  const proofWeekly  = proofHabits.filter(h => h.habitType === "weekly");
  const proofProject = proofHabits.filter(h => h.habitType === "project");
  const ringSummary = arcActive
    ? (proofTotal ? `${proofDone} of ${proofTotal} proof actions` : "")
    : totalTrackables
      ? `${loggedCount} of ${totalTrackables} logged`
      : logHabits.length
        ? "Logs below — ring is for habits & goals"
        : "";
  const showMinimumHint = arcActive && hr >= 19 && proofDone === 0 && !!(activeBlock.minimumProof || "").trim();
  const ringCenterMain = arcActive && proofTotal > 0 ? `${proofDone}/${proofTotal}` : undefined;
  const ringCenterSub = arcActive && proofTotal > 0 ? "proof" : undefined;
  const today = todayStr();
  const doneTasksCount = tasks.filter(t => t.done).length;
  const totalTasksCount = tasks.length;

  if (habits.length === 0 && activeGoals.length === 0) return (
    <div>
      {onOpenCoachMic && <CoachGreeting coachName={coachName} coachIcon={coachIcon} habits={habits} goals={goals} habitAccent={coachHabitColor} onOpenMic={onOpenCoachMic} habitCompletionPercentage={pct} habitsLoggedTodayCount={loggedCount} totalTrackables={totalTrackables}/>}
      <div style={{ padding:"40px 28px 32px", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚒️</div>
        <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:10 }}>Nothing forged yet</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:28 }}>
          Add a habit to track daily, or tell the coach what outcome you're working toward — it will help you build a plan.
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
          <button onClick={onAdd} style={{ padding:"13px 24px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Add your first habit</button>
          {onOpenCoachWithDraft && (
            <button
              type="button"
              onClick={() => onOpenCoachWithDraft(COACH_FIRST_HABIT_DRAFT)}
              style={{
                marginTop:14,
                padding:0,
                border:"none",
                background:"none",
                cursor:"pointer",
                fontFamily:T.font,
                fontSize:12,
                fontWeight:500,
                color:T.muted,
                textDecoration:"underline",
                textUnderlineOffset:3,
                textDecorationColor:"rgba(168,164,156,0.4)",
              }}
            >
              Not sure what to track? Ask your coach
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Pattern insight — first cross-habit theme from written logs, shown once enough data exists
  const patternInsight = useMemo(() => {
    if (habits.length === 0) return null;
    const deep = analyzeDeepInsights(habits, goals);
    if (deep.needsMoreData || !deep.crossHabitLinks?.length) return null;
    return deep.crossHabitLinks[0];
  }, [habits, goals]);

  // Show a brief-prompt card once the user has 7+ logged days and hasn't used their free brief
  const uniqueLoggedDays = (() => {
    const days = new Set();
    habits.forEach(h => h.logs.forEach(l => {
      if (l.value !== "quicknote" && l.value !== "skip") days.add(l.date);
    }));
    return days.size;
  })();
  const showBriefHook = !!onOpenBrief && uniqueLoggedDays >= 7;

  const showCoachNudge = habits.length > 0 && !coachEverOpened;
  return (
    <div>
      {showCoachNudge && (
        <button type="button" onClick={onOpenCoachMic}
          style={{ display:"flex", alignItems:"center", gap:8, width:"calc(100% - 28px)", margin:"6px 14px 0", padding:"9px 12px", background:"linear-gradient(90deg, rgba(200,144,42,0.14), rgba(200,144,42,0.04))", border:"0.5px solid rgba(200,144,42,0.35)", borderRadius:T.rsm, color:T.gold, fontSize:12, fontWeight:600, cursor:"pointer", textAlign:"left", fontFamily:T.font }}>
          <span aria-hidden style={{ fontSize:14, lineHeight:1 }}>✨</span>
          <span style={{ color:T.sub, fontWeight:500, flex:1, lineHeight:1.35 }}>
            Your coach reads your logs and notes — <span style={{ color:T.gold, fontWeight:700 }}>tap to ask</span> what it's already noticed.
          </span>
        </button>
      )}
      {arcActive && <ArcStrip activeBlock={activeBlock} />}
      {onOpenCoachMic && <CoachGreeting coachName={coachName} coachIcon={coachIcon} habits={habits} goals={goals} habitAccent={coachHabitColor} onOpenMic={onOpenCoachMic} habitCompletionPercentage={pct} habitsLoggedTodayCount={loggedCount} totalTrackables={totalTrackables}/>}
      {loggedCount === 0 && !arcActive && <YesterdayReceiptCard entry={yesterdayJournalEntry} />}
      {showBriefHook && (
        <button type="button" onClick={onOpenBrief}
          style={{ display:"flex", alignItems:"center", gap:12, width:"calc(100% - 28px)", margin:"8px 14px 0", padding:"12px 14px", background:"linear-gradient(90deg, rgba(200,144,42,0.12), rgba(200,144,42,0.04))", border:"0.5px solid rgba(200,144,42,0.4)", borderRadius:T.rsm, cursor:"pointer", textAlign:"left", fontFamily:T.font, boxSizing:"border-box" }}>
          <div style={{ fontSize:20, flexShrink:0, lineHeight:1 }}>✨</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:600, color:T.gold, marginBottom:2 }}>Your coach noticed something</div>
            <div style={{ fontSize:12, color:T.sub, lineHeight:1.4 }}>You have {uniqueLoggedDays} days of data — get your first weekly brief free.</div>
          </div>
          <div style={{ fontSize:14, color:T.gold, flexShrink:0 }}>→</div>
        </button>
      )}
      {patternInsight && !!onOpenBrief && (
        <button type="button" onClick={onOpenBrief}
          style={{ display:"flex", alignItems:"center", gap:12, width:"calc(100% - 28px)", margin:"8px 14px 0", padding:"12px 14px", background:"linear-gradient(90deg, rgba(200,144,42,0.08), rgba(200,144,42,0.02))", border:"0.5px solid rgba(200,144,42,0.3)", borderRadius:T.rsm, cursor:"pointer", textAlign:"left", fontFamily:T.font, boxSizing:"border-box" }}>
          <div style={{ fontSize:18, flexShrink:0, lineHeight:1 }}>🔗</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:600, color:T.gold, marginBottom:2 }}>Pattern spotted in your writing</div>
            <div style={{ fontSize:12, color:T.sub, lineHeight:1.4 }}>
              "{patternInsight.term}" keeps showing up across {patternInsight.habitLabels.slice(0,2).join(" and ")} — see what it means.
            </div>
          </div>
          <div style={{ fontSize:14, color:T.gold, flexShrink:0 }}>→</div>
        </button>
      )}
      {briefPreview && onOpenInsights && (
        <button
          type="button"
          onClick={onOpenInsights}
          style={{
            display:"block", width:"calc(100% - 28px)", margin:"8px 14px 0", padding:"12px 14px",
            background:"rgba(200,144,42,0.08)", border:"0.5px solid rgba(200,144,42,0.45)",
            borderRadius:T.r, cursor:"pointer", textAlign:"left", fontFamily:T.font, boxSizing:"border-box",
          }}
        >
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.12em", marginBottom:6 }}>
            YOUR WEEKLY BRIEF IS READY
          </div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, fontWeight:450 }}>
            {briefPreview.signal || briefPreview.text.split(/\n/)[0].slice(0, 120)}
            {!briefPreview.signal && briefPreview.text.length > 120 ? "…" : ""}
          </div>
          <div style={{ fontSize:11, color:T.gold, fontWeight:700, marginTop:8 }}>
            Read full brief →
          </div>
        </button>
      )}
      {showMinimumHint && (
        <div style={{ margin:"0 14px 8px", padding:"11px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:T.surface }}>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>
            Bad day? Minimum is: <span style={{ color:T.text, fontWeight:500 }}>{activeBlock.minimumProof.trim()}</span>
          </div>
        </div>
      )}
      <div data-tour="today-summary" style={{ margin:"6px 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"18px 20px", display:"flex", alignItems:"center", gap:18 }}>
        <Ring pct={pct} centerMain={ringCenterMain} centerSub={ringCenterSub}/>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:4 }}>
            {!arcActive && pct === 100 && totalTrackables > 0 ? "Forged for today" : greeting}
          </div>
          <div style={{ fontSize:13, color:T.muted }}>{ringSummary || " "}</div>
          <button onClick={onXPInfo} style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:12, background:"rgba(200,144,42,0.15)", color:T.gold, border:"none", cursor:"pointer" }}>
            {xp === 0 ? "⚡ Log a habit to earn XP" : `⚡ ${xp} xp · ${level.label}`}
          </button>
          {doneTasksCount > 0 && (
            <div style={{ marginTop:6, fontSize:11, color:T.muted, fontWeight:500 }}>
              ✓ {doneTasksCount}{totalTasksCount > doneTasksCount ? ` of ${totalTasksCount}` : ""} loose end{doneTasksCount === 1 ? "" : "s"} cleared
            </div>
          )}
        </div>
      </div>
      {onGenerateReceipt && (
        <TodayReceiptCard
          entry={todayJournalEntry}
          loggedCount={loggedCount}
          generating={generatingReceipt}
          onGenerate={onGenerateReceipt}
          onOpenJournal={onOpenJournal}
          onOpenCoachWithDraft={onOpenCoachWithDraft}
        />
      )}
      {(() => {
        const cardProps = {
          onTap, onSkip, onAddNote, onUndo, onLogZero, onOpenLog,
          onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId,
          onLowerBudget, onOpenCoachWithDraft,
        };
        const habitTypeSections = (list, keyPrefix = "") => [
          list.filter(h => h.habitType === "daily").length > 0 && (
            <><SLabel key={`${keyPrefix}daily`}>Daily</SLabel>
              {list.filter(h => h.habitType === "daily").map(h => (
                <DailyCard key={h.id} habit={h} onTap={cardProps.onTap} onSkip={cardProps.onSkip} onAddNote={cardProps.onAddNote}
                  onEditHabit={cardProps.onEditHabit} onDeleteHabit={cardProps.onDeleteHabit} onShareHabit={cardProps.onShareHabit}
                  sharingThisHabit={cardProps.sharingHabitId === h.id}/>
              ))}</>
          ),
          list.filter(h => h.habitType === "limit").length > 0 && (
            <><SLabel key={`${keyPrefix}limit`}>Limits</SLabel>
              {list.filter(h => h.habitType === "limit").map(h => (
                <LimitCard key={h.id} habit={h} onTap={cardProps.onTap} onUndo={cardProps.onUndo} onLogZero={cardProps.onLogZero}
                  onAddNote={cardProps.onAddNote} onEditHabit={cardProps.onEditHabit} onDeleteHabit={cardProps.onDeleteHabit}
                  onShareHabit={cardProps.onShareHabit} sharingThisHabit={cardProps.sharingHabitId === h.id}
                  onLowerBudget={cardProps.onLowerBudget} onOpenCoachWithDraft={cardProps.onOpenCoachWithDraft}/>
              ))}</>
          ),
          list.filter(h => h.habitType === "weekly").length > 0 && (
            <><SLabel key={`${keyPrefix}weekly`}>Weekly targets</SLabel>
              {list.filter(h => h.habitType === "weekly").map(h => (
                <WeeklyCard key={h.id} habit={h} onTap={cardProps.onTap} onSkip={cardProps.onSkip} onAddNote={cardProps.onAddNote}
                  onEditHabit={cardProps.onEditHabit} onDeleteHabit={cardProps.onDeleteHabit} onShareHabit={cardProps.onShareHabit}
                  sharingThisHabit={cardProps.sharingHabitId === h.id}/>
              ))}</>
          ),
          list.filter(h => h.habitType === "project").length > 0 && (
            <><SLabel key={`${keyPrefix}project`}>Build</SLabel>
              {list.filter(h => h.habitType === "project").map(h => (
                <ProjectCard key={h.id} habit={h} onOpenLog={cardProps.onOpenLog} onAddNote={cardProps.onAddNote}
                  onEditHabit={cardProps.onEditHabit} onDeleteHabit={cardProps.onDeleteHabit} onShareHabit={cardProps.onShareHabit}
                  sharingThisHabit={cardProps.sharingHabitId === h.id}/>
              ))}</>
          ),
        ].filter(Boolean);

        const goalsSection = activeGoals.length > 0
          ? <><SLabel>Goals</SLabel>{activeGoals.map(g => <TodayGoalCard key={g.id} goal={g} onOpenLog={onOpenGoalLog} onEdit={onEditGoal} onComplete={onCompleteGoal} onDelete={onDeleteGoal} onShareGoal={onShareGoal} onOpen={onOpenGoalDetail}/>)}</>
          : habits.length > 0 && onOpenCoachMic && (
            <div key="goal-cta">
              <SLabel>Goals</SLabel>
              <button type="button" onClick={onOpenCoachMic}
                style={{ display:"flex", alignItems:"center", gap:14, margin:"0 14px 10px", width:"calc(100% - 28px)", padding:"14px 16px", borderRadius:T.r, border:"0.5px dashed rgba(200,144,42,0.4)", background:"rgba(200,144,42,0.04)", cursor:"pointer", textAlign:"left" }}>
                <div style={{ width:38, height:38, borderRadius:11, background:"rgba(200,144,42,0.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎯</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:2 }}>Set a goal with your coach</div>
                  <div style={{ fontSize:12, color:T.muted, lineHeight:1.45 }}>Tell the AI what outcome you're working toward — it'll help you plan milestones and track progress.</div>
                </div>
                <div style={{ fontSize:16, color:T.gold, flexShrink:0 }}>→</div>
              </button>
            </div>
          );

        const logsSection = logHabits.length > 0 && onSaveLogEntry && (
          <><SLabel>Logs</SLabel>{logHabits.map(h => <LogCard key={h.id} habit={h} onSaveEntry={onSaveLogEntry} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit}/>)}</>
        );

        const proofEmptyCard = arcActive && proofTotal === 0 && (
          <button type="button" onClick={onAdd}
            style={{ display:"flex", alignItems:"center", gap:14, margin:"0 14px 10px", width:"calc(100% - 28px)", padding:"14px 16px", borderRadius:T.r, border:`0.5px dashed ${T.borderStrong}`, background:T.surface, cursor:"pointer", textAlign:"left", fontFamily:T.font }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:500, color:T.text }}>No proof actions yet — add one</div>
            </div>
            <div style={{ fontSize:16, color:T.accent, flexShrink:0 }}>→</div>
          </button>
        );

        const proofSection = arcActive && (
          proofTotal === 0
            ? <div key="proof-empty">{proofEmptyCard}</div>
            : <>
                <SLabel>Proof actions</SLabel>
                {proofDaily.map(h => <DailyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}
                {proofLimit.map(h => <LimitCard key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id} onLowerBudget={onLowerBudget} onOpenCoachWithDraft={onOpenCoachWithDraft}/>)}
                {proofWeekly.map(h => <WeeklyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}
                {proofProject.map(h => <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}
              </>
        );

        const otherHabitSections = habitTypeSections(otherTrackHabits, "other-");
        const otherWrapped = otherHabitSections.length > 0
          ? <OtherHabitsCollapsible key="other-habits">{otherHabitSections}</OtherHabitsCollapsible>
          : null;

        const legacyHabitSections = !arcActive ? [
          daily.length   > 0 && <><SLabel>Daily</SLabel>{daily.map(h => <DailyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}</>,
          limit.length   > 0 && <><SLabel>Limits</SLabel>{limit.map(h => <LimitCard key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id} onLowerBudget={onLowerBudget} onOpenCoachWithDraft={onOpenCoachWithDraft}/>)}</>,
          weekly.length  > 0 && <><SLabel>Weekly targets</SLabel>{weekly.map(h => <WeeklyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}</>,
          project.length > 0 && <><SLabel>Build</SLabel>{project.map(h => <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}</>,
        ].filter(Boolean) : [];

        const sections = arcActive
          ? [proofSection, otherWrapped, goalsSection, logsSection].filter(Boolean)
          : [goalsSection, ...legacyHabitSections, logsSection].filter(Boolean);

        return sections.map((sec, i) =>
          i === 0 ? <div key={i} data-tour="today-first-section">{sec}</div> : <div key={i}>{sec}</div>
        );
      })()}
      {onAddTask && (
        <LooseEndsSection
          tasks={tasks}
          today={today}
          onAdd={onAddTask}
          onComplete={onCompleteTask}
          onPin={onPinTask}
          onDelete={onDeleteTask}
        />
      )}
      <div style={{ height:16 }}/>
      {!hideFloatingAdd && (trackHabits.length > 0 || activeGoals.length > 0 || logHabits.length > 0) && onAdd && (
        <button type="button" onClick={onAdd} aria-label="Add habit or goal" title="Add habit or goal"
          style={{ position:"fixed", bottom:276, right:18, height:52, padding:"0 18px 0 16px", borderRadius:26, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:700, lineHeight:1, cursor:"pointer", zIndex:99, boxShadow:"0 4px 16px rgba(192,57,43,0.35)", display:"flex", alignItems:"center", justifyContent:"center", gap:7, fontFamily:T.font }}>
          <span style={{ fontSize:22, fontWeight:700, lineHeight:1, marginTop:1 }} aria-hidden>+</span>
          <span>Add habit</span>
        </button>
      )}
    </div>
  );
}
