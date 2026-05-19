// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
import { useMemo, useState, useEffect } from "react";
import { T, COACH_ICON_OPTIONS } from "../theme.js";
import { todayStr, daysAgo, isSatisfiedForTodayRing, getLevel, getStreak, analyzeDeepInsights } from "../utils.js";
import { Ring, SLabel } from "../components/ui.jsx";
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
  if (some) return tod === "morning" ? "Good start — clear the rest when ready." : tod === "afternoon" ? "Halfway through — log what's left?" : "Solid progress — finish the set tonight?";
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

// ── TodayScreen ────────────────────────────────────────────────────────────
export function TodayScreen({
  habits, goals = [], xp,
  onTap, onUndo, onSkip, onAddNote, onLogZero, onOpenLog,
  onOpenGoalLog, onEditGoal, onCompleteGoal, onDeleteGoal, onShareGoal,
  onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId,
  onXPInfo, onAdd, onSaveLogEntry, hideFloatingAdd,
  coachEverOpened = true, onOpenCoachMic, onOpenCoachWithDraft,
  coachName, coachIcon, coachHabitColor, onOpenGoalDetail,
  onOpenBrief = null,
  onOpenInsights = null,
  todayJournalEntry = null,
  onGenerateReceipt = null,
  generatingReceipt = false,
  onOpenJournal = null,
  yesterdayJournalEntry = null,
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
  const loggedCount    = trackHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const totalTrackables = trackHabits.length;
  const pct = totalTrackables ? Math.round((loggedCount / totalTrackables) * 100) : 0;
  const hr  = new Date().getHours();
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
      {onOpenCoachMic && <CoachGreeting coachName={coachName} coachIcon={coachIcon} habits={habits} goals={goals} habitAccent={coachHabitColor} onOpenMic={onOpenCoachMic} habitCompletionPercentage={pct} habitsLoggedTodayCount={loggedCount} totalTrackables={totalTrackables}/>}
      <YesterdayReceiptCard entry={yesterdayJournalEntry} />
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
      <div data-tour="today-summary" style={{ margin:"6px 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"18px 20px", display:"flex", alignItems:"center", gap:18 }}>
        <Ring pct={pct}/>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:4 }}>{pct === 100 && totalTrackables > 0 ? "Forged for today" : greeting}</div>
          <div style={{ fontSize:13, color:T.muted }}>{ringSummary || " "}</div>
          <button onClick={onXPInfo} style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:12, background:"rgba(200,144,42,0.15)", color:T.gold, border:"none", cursor:"pointer" }}>
            {xp === 0 ? "⚡ Log a habit to earn XP" : `⚡ ${xp} xp · ${level.label}`}
          </button>
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
        const sections = [
          activeGoals.length > 0
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
            ),
          daily.length   > 0 && <><SLabel>Daily</SLabel>          {daily.map(h   => <DailyCard  key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}</>,
          limit.length   > 0 && <><SLabel>Limits</SLabel>         {limit.map(h   => <LimitCard  key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}</>,
          weekly.length  > 0 && <><SLabel>Weekly targets</SLabel> {weekly.map(h  => <WeeklyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}</>,
          project.length > 0 && <><SLabel>Build</SLabel>          {project.map(h => <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id}/>)}</>,
          logHabits.length > 0 && onSaveLogEntry && <><SLabel>Logs</SLabel>{logHabits.map(h => <LogCard key={h.id} habit={h} onSaveEntry={onSaveLogEntry} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit}/>)}</>,
        ].filter(Boolean);
        return sections.map((sec, i) =>
          i === 0 ? <div key={i} data-tour="today-first-section">{sec}</div> : <div key={i}>{sec}</div>
        );
      })()}
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
