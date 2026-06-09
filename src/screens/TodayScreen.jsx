// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { T, COACH_ICON_OPTIONS } from "../theme.js";
import { todayStr, daysAgo, parseLocal, isSatisfiedForTodayRing, getLevel, getStreak, stripJournalTitleLine } from "../utils.js";
import { Ring, SLabel, Modal, GBtn } from "../components/ui.jsx";
import {
  DailyCard, WeeklyCard, ProjectCard, LimitCard, LogCard,
  TodayGoalCard,
} from "../components/habitCards.jsx";
import { resolveArcTitle, arcHeaderSubtitle, arcDurationWeeksLabel } from "../arcProofMatch.js";
import { getArcRankDisplay, getArcDayNumber, ARC_DAILY_XP_CAP } from "../arcProgress.js";

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
  const title = stripJournalTitleLine(lines[0]);
  let pattern = null, tomorrow = null, missed = null;
  for (const l of lines) {
    if (!pattern  && l.startsWith("Pattern:"))  pattern  = l.slice("Pattern:".length).trim();
    if (!tomorrow && l.startsWith("Tomorrow:")) tomorrow = l.slice("Tomorrow:".length).trim();
    if (!missed   && l.startsWith("Missed:"))   missed   = l.slice("Missed:".length).trim();
  }
  return { title, pattern, tomorrow, missed };
}

// ── First Proof micro-moment ──────────────────────────────────────────────
// Fires once per day when the user logs their first proof action. Identity-bound
// when an Arc is active. Localstorage-flagged so it shows only once per day.
function FirstProofMicroMoment({ arcActive, activeBlock, loggedCount }) {
  const [show, setShow] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!arcActive) return;
    if (firedRef.current) return;
    if (loggedCount < 1) return;
    let alreadySeen = false;
    try {
      const today = todayStr();
      const flag = `forged_first_proof_${today}`;
      alreadySeen = localStorage.getItem(flag) === "1";
      if (!alreadySeen) localStorage.setItem(flag, "1");
    } catch (_) { /* ignore */ }
    firedRef.current = true;
    if (alreadySeen) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 5000);
    return () => clearTimeout(t);
  }, [loggedCount, arcActive]);

  if (!show) return null;

  const identity = String(activeBlock?.identity || "").trim();
  const identityNoun = identity
    ? identity.split(/[.,—!?]/)[0].trim()
    : "";
  const cleanNoun = identityNoun && identityNoun.length <= 50
    ? identityNoun.charAt(0).toUpperCase() + identityNoun.slice(1)
    : "";
  const line = cleanNoun
    ? `First proof in. ${cleanNoun} showed up today.`
    : "First proof in. Today counts.";

  return (
    <div style={{
      margin: "8px 14px 0",
      padding: "10px 14px",
      borderRadius: T.rsm,
      background: "linear-gradient(90deg, rgba(39,174,96,0.18), rgba(200,144,42,0.10))",
      border: "0.5px solid rgba(39,174,96,0.35)",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontFamily: T.font,
    }}>
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1, color: T.green, fontWeight: 700 }}>✓</span>
      <div style={{ fontSize: 13, color: T.text, fontWeight: 500, lineHeight: 1.4, flex: 1 }}>
        {line}
      </div>
    </div>
  );
}

// TodayReceiptCard: when an Arc is active and we're past 7pm, this reframes as
// a Night Verdict — identity line at top, bad-day-min row, "Tomorrow's first
// proof" phrasing. Same underlying journal-generate data; no API change.
function TodayReceiptCard({ entry, loggedCount, generating, onGenerate, onOpenJournal, onOpenCoachWithDraft, activeBlock = null, hourNow = 0 }) {
  if (loggedCount === 0) return null;
  const arcActive = !!activeBlock?.id;
  const isNight = hourNow >= 19;
  const identity = arcActive ? String(activeBlock.identity || "").trim().slice(0, 110) : "";
  const minimum = arcActive ? String(activeBlock.minimumProof || "").trim() : "";
  const minHit = arcActive && loggedCount > 0 && !!minimum; // simple heuristic; refined in Phase 2
  const eyebrowLabel = arcActive ? (isNight ? "Night verdict" : "Today's verdict") : "Today's receipt";
  const eyebrowColor = arcActive ? T.gold : T.hint;
  const borderColor = arcActive ? "rgba(200,144,42,0.4)" : T.border;

  if (entry) {
    const parsed = parseReceiptFields(entry.content);
    if (!parsed) return null;
    const missedStr = (parsed.missed || "").toLowerCase().trim();
    const hasMissed = missedStr && missedStr !== "none" && !missedStr.startsWith("not tracked");
    const contextDraft = hasMissed
      ? `I want to add some context on today — ${parsed.missed} didn't make it in. Here's why:`
      : null;
    return (
      <div style={{ margin:"0 14px 10px", borderRadius:T.r, border:`0.5px solid ${borderColor}`, background:T.raised, overflow:"hidden" }}>
        <div style={{ padding:"14px 16px 12px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:eyebrowColor, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>{eyebrowLabel}</div>
          {arcActive && identity ? (
            <div style={{ fontSize:13, color:T.sub, fontStyle:"italic", fontFamily:T.serif, marginBottom:10, lineHeight:1.4 }}>
              {identity}
            </div>
          ) : null}
          <div style={{ fontSize:15, fontWeight:500, color:T.text, fontFamily:T.serif, marginBottom:(parsed.pattern||parsed.tomorrow||hasMissed||minimum)?10:0, lineHeight:1.35 }}>{parsed.title}</div>
          {arcActive && minimum && (
            <div style={{ display:"flex", gap:6, marginBottom:6, alignItems:"flex-start" }}>
              <span style={{ fontSize:11, color: minHit ? T.green : T.amber, fontWeight:700, marginTop:2, flexShrink:0 }}>{minHit ? "✓" : "·"}</span>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>
                <span style={{ color:T.muted, marginRight:4 }}>Bad-day min:</span>{minimum}
              </div>
            </div>
          )}
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
                <span style={{ color:T.muted, marginRight:4 }}>{arcActive ? "Tomorrow's first proof:" : "Tomorrow:"}</span>{parsed.tomorrow}
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
            {arcActive ? "Full receipt →" : "Full entry →"}
          </button>
          <button type="button" onClick={onGenerate} disabled={generating}
            style={{ flex:1, padding:"10px 0", background:"none", border:"none", fontSize:12, color:generating?T.hint:T.muted, cursor:generating?"not-allowed":"pointer", fontFamily:T.font }}>
            {generating ? "Writing…" : "↺ Regenerate"}
          </button>
        </div>
      </div>
    );
  }
  const ctaTitle = generating
    ? (arcActive ? "Writing tonight's verdict…" : "Writing today's receipt…")
    : (arcActive ? (isNight ? "Get tonight's verdict" : "Wrap today") : "Wrap today");
  const ctaSub = arcActive
    ? "Your coach reads the day and calls it — what counted, what slipped, what's next."
    : "Your coach writes up the day from your logs and notes";
  return (
    <div style={{ margin:"0 14px 10px" }}>
      <button type="button" onClick={onGenerate} disabled={generating}
        style={{ width:"100%", padding:"12px 16px", borderRadius:T.r, border:`0.5px dashed ${arcActive ? "rgba(200,144,42,0.4)" : T.borderStrong}`, background:"none", cursor:generating?"not-allowed":"pointer", fontFamily:T.font, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, boxSizing:"border-box" }}>
        <div style={{ textAlign:"left" }}>
          <div style={{ fontSize:13, fontWeight:500, color:generating?T.hint:T.text }}>{ctaTitle}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{ctaSub}</div>
        </div>
        {!generating && <span style={{ fontSize:14, color:arcActive ? T.gold : T.muted, flexShrink:0 }}>→</span>}
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

const MS_PER_DAY = 86400000;

function arcDayInfo(activeBlock) {
  const duration = Math.max(1, activeBlock.durationDays || 56);
  const totalWeeks = Math.max(1, Math.round(duration / 7));
  const today = todayStr();
  const daysElapsed = Math.floor((parseLocal(today) - parseLocal(activeBlock.startDate)) / MS_PER_DAY);
  const dayX = Math.min(duration, Math.max(1, daysElapsed + 1));
  const week = Math.min(totalWeeks, Math.ceil((daysElapsed + 1) / 7));
  const progress = Math.min(1, Math.max(0, daysElapsed / duration));
  return { dayX, week, daysElapsed, progress, duration, totalWeeks };
}

function isProofForArc(habit, blockId) {
  return habit.isProofAction === true && habit.blockId === blockId;
}

// ── Arc strip + detail modal ───────────────────────────────────────────────
function AddProofActionSheet({ activeBlock, habits, onClose, onSelectHabit, onCreateNew }) {
  const linkable = (habits || []).filter(
    h => h.habitType !== "log" && !(h.isProofAction === true && h.blockId === activeBlock.id),
  );

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily: T.serif, fontSize: 20, color: T.text, marginBottom: 8 }}>Add proof action</div>
      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, marginBottom: 16 }}>
        Pick an existing habit to count toward this Arc, or create a new one.
      </div>
      {linkable.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {linkable.map(h => (
            <button
              key={h.id}
              type="button"
              onClick={() => onSelectHabit(h.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "11px 12px", borderRadius: T.rsm, border: `0.5px solid ${T.border}`,
                background: T.surface, cursor: "pointer", textAlign: "left", fontFamily: T.font,
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{h.emoji || "•"}</span>
              <span style={{ fontSize: 14, color: T.text, fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.name}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.55, marginBottom: 14, padding: "10px 12px", borderRadius: T.rsm, border: `0.5px dashed ${T.border}`, background: T.surface }}>
          No other habits to link yet.
        </div>
      )}
      <button
        type="button"
        onClick={onCreateNew}
        style={{
          width: "100%", padding: 13, borderRadius: T.rsm, border: "none",
          background: T.accent, color: "#fff", fontSize: 14, fontWeight: 600,
          cursor: "pointer", fontFamily: T.font, marginBottom: 8,
        }}
      >
        Create new habit
      </button>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

function ArcStrip({ activeBlock, onEditArc }) {
  const { dayX, week, progress, duration, totalWeeks } = arcDayInfo(activeBlock);
  const arcTitle = resolveArcTitle(activeBlock.title, activeBlock.identity);
  const subtitle = arcHeaderSubtitle(activeBlock);
  const weeksLabel = arcDurationWeeksLabel(duration);

  return (
    <button
      type="button"
      onClick={() => { if (onEditArc) onEditArc(); }}
      style={{
        display: "block",
        width: "calc(100% - 28px)",
        margin: "8px 14px 0",
        padding: "12px 14px",
        borderRadius: T.r,
        border: "0.5px solid rgba(200,144,42,0.4)",
        background: "linear-gradient(135deg, rgba(192,57,43,0.12) 0%, rgba(200,144,42,0.08) 45%, rgba(26,26,22,0.98) 100%)",
        cursor: onEditArc ? "pointer" : "default",
        textAlign: "left",
        fontFamily: T.font,
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        {weeksLabel} · Day {dayX} of {duration} · Week {week}/{totalWeeks}
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 22, color: T.text, lineHeight: 1.15, marginBottom: subtitle ? 6 : 10 }}>
        {arcTitle}
      </div>
      {subtitle ? (
        <div style={{
          fontSize: 13,
          color: T.sub,
          lineHeight: 1.45,
          marginBottom: 10,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {subtitle}
        </div>
      ) : null}
      <div style={{ height: 3, borderRadius: 2, background: T.surface, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: `linear-gradient(90deg, ${T.accent}, ${T.gold})`, borderRadius: 2, transition: "width 0.4s ease" }} />
      </div>
    </button>
  );
}

function SectionCollapsible({ label, children, defaultOpen = false }) {
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
        <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em", color:T.sub, textTransform:"uppercase" }}>{label}</span>
        <span style={{ fontSize:12, color:T.muted }} aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

function OtherHabitsCollapsible({ children, defaultOpen = false }) {
  return <SectionCollapsible label="Other habits" defaultOpen={defaultOpen}>{children}</SectionCollapsible>;
}

function GoalsCollapsible({ children, defaultOpen = false }) {
  return <SectionCollapsible label="Goals" defaultOpen={defaultOpen}>{children}</SectionCollapsible>;
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
  todayArcScore = null,
  arcLedgerRows = [],
  arcProofSyncing = false,
  onStartArc = null,
  onEditArc = null,
  onLinkProofHabit = null,
  onOpenHub = null,
}) {
  const [showProofPicker, setShowProofPicker] = useState(false);

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
  const arcDayNum = arcActive ? getArcDayNumber(activeBlock) : 1;
  const arcRankLabel = arcActive
    ? getArcRankDisplay(
        activeBlock.completionScore,
        arcLedgerRows.length > 0 || proofTotal > 0,
        {
          proofDoneToday: proofDone,
          priorLedgerDays: arcLedgerRows.filter(r => r.date !== todayStr()).length,
        },
      ).label
    : "";
  const arcXpToday = todayArcScore?.arcXpAwarded ?? 0;
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
      {onOpenCoachMic && !arcActive && <CoachGreeting coachName={coachName} coachIcon={coachIcon} habits={habits} goals={goals} habitAccent={coachHabitColor} onOpenMic={onOpenCoachMic} habitCompletionPercentage={pct} habitsLoggedTodayCount={loggedCount} totalTrackables={totalTrackables}/>}
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

  const showCoachNudge = habits.length > 0 && !coachEverOpened;
  // TODO: Arc completion should eventually be based on proof actions across 56 days, not XP tiers alone.
  return (
    <div>
      {!activeBlock && habits.length > 0 && typeof onStartArc === "function" && (
        <button
          type="button"
          onClick={onStartArc}
          style={{
            display: "block",
            width: "calc(100% - 28px)",
            margin: "8px 14px 0",
            padding: "14px 16px",
            borderRadius: T.r,
            border: "0.5px solid rgba(192,57,43,0.35)",
            background: "linear-gradient(90deg, rgba(192,57,43,0.14), rgba(26,26,22,0.96))",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: T.font,
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, color: T.accent, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
            8-WEEK ARC
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.serif, fontSize: 18, color: T.text, lineHeight: 1.2, marginBottom: 6 }}>
                Start your first Arc
              </div>
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
                Picture eight weeks from now — then turn your habits into proof. The coach takes it from there.
              </div>
            </div>
            <div style={{ flexShrink: 0, alignSelf: "center", fontSize: 12, fontWeight: 700, color: T.gold }}>
              Start your first Arc →
            </div>
          </div>
        </button>
      )}
      {showCoachNudge && !arcActive && (
        <button type="button" onClick={onOpenCoachMic}
          style={{ display:"flex", alignItems:"center", gap:8, width:"calc(100% - 28px)", margin:"6px 14px 0", padding:"9px 12px", background:"linear-gradient(90deg, rgba(200,144,42,0.14), rgba(200,144,42,0.04))", border:"0.5px solid rgba(200,144,42,0.35)", borderRadius:T.rsm, color:T.gold, fontSize:12, fontWeight:600, cursor:"pointer", textAlign:"left", fontFamily:T.font }}>
          <span aria-hidden style={{ fontSize:14, lineHeight:1 }}>✨</span>
          <span style={{ color:T.sub, fontWeight:500, flex:1, lineHeight:1.35 }}>
            Your coach reads your logs and notes — <span style={{ color:T.gold, fontWeight:700 }}>tap to ask</span> what it's already noticed.
          </span>
        </button>
      )}
      {arcActive && <ArcStrip activeBlock={activeBlock} onEditArc={onEditArc} />}
      {showProofPicker && activeBlock && (
        <AddProofActionSheet
          activeBlock={activeBlock}
          habits={habits}
          onClose={() => setShowProofPicker(false)}
          onSelectHabit={async (id) => {
            setShowProofPicker(false);
            if (onLinkProofHabit) await onLinkProofHabit(id);
          }}
          onCreateNew={() => { setShowProofPicker(false); onAdd?.(); }}
        />
      )}
      {onOpenCoachMic && !arcActive && <CoachGreeting coachName={coachName} coachIcon={coachIcon} habits={habits} goals={goals} habitAccent={coachHabitColor} onOpenMic={onOpenCoachMic} habitCompletionPercentage={pct} habitsLoggedTodayCount={loggedCount} totalTrackables={totalTrackables}/>}
      {loggedCount === 0 && !arcActive && <YesterdayReceiptCard entry={yesterdayJournalEntry} />}
      {showMinimumHint && (
        <div style={{ margin:"0 14px 8px", padding:"11px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:T.surface }}>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>
            Bad day? Minimum is: <span style={{ color:T.text, fontWeight:500 }}>{activeBlock.minimumProof.trim()}</span>
          </div>
        </div>
      )}
      {arcActive && (
        <FirstProofMicroMoment arcActive={arcActive} activeBlock={activeBlock} loggedCount={loggedCount} />
      )}
      <div data-tour="today-summary" style={{ margin:"6px 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"18px 20px", display:"flex", alignItems:"center", gap:18 }}>
        <Ring pct={pct} centerMain={ringCenterMain} centerSub={ringCenterSub}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:T.serif, fontSize:arcActive && activeBlock?.identity ? 18 : 20, color:T.text, marginBottom:4, lineHeight:1.25 }}>
            {arcActive && activeBlock?.identity
              ? String(activeBlock.identity).trim().slice(0, 90)
              : (!arcActive && pct === 100 && totalTrackables > 0 ? "Forged for today" : greeting)}
          </div>
          <div style={{ fontSize:13, color:T.muted }}>
            {arcActive ? `Day ${arcDayX} · ${ringSummary || "show proof"}` : (ringSummary || " ")}
          </div>
          {arcActive && proofTotal > 0 && (
            <div style={{ fontSize:11, color:T.hint, marginTop:5, fontVariantNumeric:"tabular-nums" }}>
              Arc XP today: {arcXpToday} / {ARC_DAILY_XP_CAP}
            </div>
          )}
          <button onClick={onXPInfo} style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:12, background:"rgba(200,144,42,0.15)", color:T.gold, border:"none", cursor:"pointer" }}>
            {arcActive
              ? (proofTotal > 0
                ? `⚡ ${arcRankLabel} · ${proofDone}/${proofTotal}`
                : `⚡ Day ${arcDayNum} · add proof`)
              : (xp === 0 ? "⚡ Log a habit to earn XP" : `⚡ ${xp} xp · ${level.label}`)}
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
          activeBlock={activeBlock}
          hourNow={hr}
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

        const goalsInner = activeGoals.length > 0
          ? activeGoals.map(g => <TodayGoalCard key={g.id} goal={g} onOpenLog={onOpenGoalLog} onEdit={onEditGoal} onComplete={onCompleteGoal} onDelete={onDeleteGoal} onShareGoal={onShareGoal} onOpen={onOpenGoalDetail}/>)
          : habits.length > 0 && onOpenCoachMic
            ? (
              <button key="goal-cta" type="button" onClick={onOpenCoachMic}
                style={{ display:"flex", alignItems:"center", gap:14, margin:"0 14px 10px", width:"calc(100% - 28px)", padding:"14px 16px", borderRadius:T.r, border:"0.5px dashed rgba(200,144,42,0.4)", background:"rgba(200,144,42,0.04)", cursor:"pointer", textAlign:"left" }}>
                <div style={{ width:38, height:38, borderRadius:11, background:"rgba(200,144,42,0.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🎯</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:2 }}>Set a goal with your coach</div>
                  <div style={{ fontSize:12, color:T.muted, lineHeight:1.45 }}>Tell the AI what outcome you&apos;re working toward — it&apos;ll help you plan milestones and track progress.</div>
                </div>
                <div style={{ fontSize:16, color:T.gold, flexShrink:0 }}>→</div>
              </button>
            )
            : null;

        const goalsSection = goalsInner
          ? (arcActive
            ? <GoalsCollapsible key="goals" defaultOpen={false}>{goalsInner}</GoalsCollapsible>
            : <><SLabel key="goals-label">Goals</SLabel>{goalsInner}</>)
          : null;

        const logsSection = logHabits.length > 0 && onSaveLogEntry && (
          <><SLabel>Logs</SLabel>{logHabits.map(h => <LogCard key={h.id} habit={h} onSaveEntry={onSaveLogEntry} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit}/>)}</>
        );

        const proofSyncCard = arcActive && proofTotal === 0 && arcProofSyncing && (
          <div style={{ margin:"0 14px 10px", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.border}`, background:T.surface, fontFamily:T.font }}>
            <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:4 }}>Setting up your proof actions…</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>Linking habits to your Arc.</div>
          </div>
        );

        const proofEmptyCard = arcActive && proofTotal === 0 && !arcProofSyncing && (
          <button
            type="button"
            onClick={() => (onLinkProofHabit ? setShowProofPicker(true) : onAdd?.())}
            style={{ display:"flex", alignItems:"center", gap:14, margin:"0 14px 10px", width:"calc(100% - 28px)", padding:"14px 16px", borderRadius:T.r, border:`0.5px dashed ${T.borderStrong}`, background:T.surface, cursor:"pointer", textAlign:"left", fontFamily:T.font }}
          >
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:2 }}>Add proof actions to make this Arc active</div>
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>Pick three to five habits that prove who you&apos;re becoming.</div>
            </div>
            <div style={{ fontSize:16, color:T.accent, flexShrink:0 }}>→</div>
          </button>
        );

        const proofSection = arcActive && (
          proofTotal === 0
            ? <div key="proof-empty">{proofSyncCard || proofEmptyCard}</div>
            : <>
                <SLabel>Proof actions</SLabel>
                {proofDaily.map(h => <DailyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}
                {proofLimit.map(h => <LimitCard key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id} onLowerBudget={onLowerBudget} onOpenCoachWithDraft={onOpenCoachWithDraft}/>)}
                {proofWeekly.map(h => <WeeklyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}
                {proofProject.map(h => <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}
                {onLinkProofHabit && (
                  <button
                    type="button"
                    onClick={() => setShowProofPicker(true)}
                    style={{
                      display: "block", width: "calc(100% - 28px)", margin: "0 14px 12px",
                      padding: "10px 14px", borderRadius: T.rsm,
                      border: `0.5px dashed rgba(200,144,42,0.4)`,
                      background: "rgba(200,144,42,0.06)", cursor: "pointer",
                      fontFamily: T.font, textAlign: "left", boxSizing: "border-box",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.gold }}>+ Add proof action</span>
                  </button>
                )}
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

        // Arc Takeover: when an Arc is active, Today shows ONLY proof + logs.
        // Other Habits, Goals, and Loose Ends are hidden from Today and live on
        // the Hub screen (accessed via the link below). Data is intact — only
        // the rendering is gated.
        const sections = arcActive
          ? [proofSection, logsSection].filter(Boolean)
          : [goalsSection, ...legacyHabitSections, logsSection].filter(Boolean);

        return sections.map((sec, i) =>
          i === 0 ? <div key={i} data-tour="today-first-section">{sec}</div> : <div key={i}>{sec}</div>
        );
      })()}
      {/* Loose Ends only when no Arc is active. With an Arc, tasks live on Hub. */}
      {onAddTask && !arcActive && (
        <LooseEndsSection
          tasks={tasks}
          today={today}
          onAdd={onAddTask}
          onComplete={onCompleteTask}
          onPin={onPinTask}
          onDelete={onDeleteTask}
        />
      )}
      {/* Hub link — appears when an Arc is active so the user can still reach
          their other habits, goals, and loose ends. Quiet by design. */}
      {arcActive && onOpenHub && (
        <button
          type="button"
          onClick={onOpenHub}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "calc(100% - 28px)", margin: "8px 14px 0",
            padding: "11px 14px", borderRadius: T.rsm,
            background: "rgba(255,255,255,0.025)", border: `0.5px solid ${T.border}`,
            cursor: "pointer", fontFamily: T.font, textAlign: "left", boxSizing: "border-box",
          }}
          aria-label="Open Hub — all habits, goals, and loose ends"
        >
          <span style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>
            All habits & goals
          </span>
          <span style={{ fontSize: 12, color: T.sub, fontWeight: 600 }}>→</span>
        </button>
      )}
      <div style={{ height:16 }}/>
      {!hideFloatingAdd && (trackHabits.length > 0 || activeGoals.length > 0 || logHabits.length > 0) && onAdd && (
        <button type="button" onClick={onAdd} aria-label="Add habit or goal" title="Add habit or goal"
          style={{ position:"fixed", bottom: arcActive ? 288 : 276, right:18, height:52, padding:"0 18px 0 16px", borderRadius:26, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:700, lineHeight:1, cursor:"pointer", zIndex:99, boxShadow:"0 4px 16px rgba(192,57,43,0.35)", display:"flex", alignItems:"center", justifyContent:"center", gap:7, fontFamily:T.font }}>
          <span style={{ fontSize:22, fontWeight:700, lineHeight:1, marginTop:1 }} aria-hidden>+</span>
          <span>Add habit</span>
        </button>
      )}
    </div>
  );
}
