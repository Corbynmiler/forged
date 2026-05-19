import { useState, useEffect, useMemo } from "react";
import { T, MONTHS } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, weekStartFor, getStreak, getBestStreak,
  getCompletionRate, get7DayActivity, getBestDayOfWeek,
  getGoalProgress,
  fmtWeekRange, fmtEntryDate, parseLocal, get12WeekGrid, getProjectStats,
  goalBarFillWidthPct, getGoalStatusText, truncateText, formatWithUnit,
  getISOWeek, fmtNextMondayShort,
} from "../utils.js";
import { Stat } from "../components/ui.jsx";

/** YYYY-MM-DD strings Mon–Sun for the week containing `anchorDay` (Monday-aligned). */
function calendarWeekDates(anchorDayYmd) {
  const start = parseLocal(weekStartFor(anchorDayYmd));
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

/**
 * @returns {"hit"|"skip"|"miss"|"future"}
 */
function weekSquareState(habit, dateStr, today) {
  if (dateStr > today) return "future";
  const log = (habit.logs || []).find(l => l.date === dateStr);
  if (!log) return dateStr < today ? "miss" : "future";
  const v = log.value;
  if (v === "skip") return "skip";
  if (v === false || v == null) return "miss";
  if (v === true) return "hit";
  if (typeof v === "number" && Number.isFinite(v)) return "hit";
  if (v === "quicknote") return "miss";
  if (v === "log") return "hit";
  if (typeof v === "object" && v !== null) {
    const mins = v.minutes;
    if (typeof mins === "number" && mins > 0) return "hit";
    return "miss";
  }
  return "miss";
}

// ─── INSIGHTS SCREEN ──────────────────────────────────────────────────────────
// Hierarchy: weekly brief (hero) → stats (only with a saved brief) → this-week grid →
// momentum (brief + signals) → Activity → Builds → Goals. No week logs → single empty line.
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

export function InsightsScreen({ habits, goals = [], journalEntries = [], onShowHistory, onShare, isPro = false, onUpgrade, userId = null, userName = "" }) {
  // ── Weekly brief state ─────────────────────────────────────────────────────
  // The brief is now persisted in `weekly_brief_generation_usage` (brief_text +
  // brief_generated_at) and fetched once on mount via GET /api/weekly-summary.
  // We separate `isFetching` (loading existing brief from DB) from
  // `isGenerating` (calling the AI to write a new one) — only the generation
  // path shows a spinner.
  const [weeklySummary,    setWeeklySummary]    = useState(null);
  const [briefGeneratedAt, setBriefGeneratedAt] = useState(null);
  const [isFetching,       setIsFetching]       = useState(true);
  const [isGenerating,     setIsGenerating]     = useState(false);
  const [summaryError,     setSummaryError]     = useState(null);
  const [briefQuota,       setBriefQuota]       = useState(null);
  // null = still checking, true = free trial available, false = already used
  const [freeBrief,        setFreeBrief]        = useState(null);
  // When the user clicks Refresh while at the weekly cap, we surface a small
  // inline note ("Next refresh available [next Monday]") instead of an error.
  const [showQuotaNote,    setShowQuotaNote]    = useState(false);
  const [momentumSignals,  setMomentumSignals]  = useState([]);
  const [activityExpanded, setActivityExpanded] = useState(false);
  /** Collapsible "This week's numbers" — false = collapsed (default). */
  const [statsNumbersOpen, setStatsNumbersOpen] = useState(false);

  const thisWeekStart = weekStartFor(todayStr());
  const thisISOWeek   = getISOWeek(todayStr());

  // A brief is stale if it was generated in a previous ISO calendar week.
  // With the brief keyed by week_start in the DB this should rarely fire, but
  // it's our defensive boundary for week rollovers and clock skew.
  const briefIsStale = !!(weeklySummary && briefGeneratedAt && getISOWeek(briefGeneratedAt) !== thisISOWeek);
  const hasFreshBrief = !!weeklySummary && !briefIsStale;

  // Single fetch on mount: pulls existing brief + quota in one round trip.
  useEffect(() => {
    if (!userId) {
      setIsFetching(false);
      return;
    }
    let cancelled = false;
    setIsFetching(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/weekly-summary?client_date=${encodeURIComponent(todayStr())}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;

        // Only adopt a stored brief if its generated_at falls in this ISO week.
        if (j.text && j.generated_at && getISOWeek(j.generated_at) === thisISOWeek) {
          setWeeklySummary(j.text);
          setBriefGeneratedAt(j.generated_at);
          setMomentumSignals(Array.isArray(j.momentum_signals) ? j.momentum_signals : []);
          try {
            localStorage.setItem("forged_brief_preview", JSON.stringify({
              text: j.text,
              week_start: j.week_start,
              signal: Array.isArray(j.momentum_signals) && j.momentum_signals.length > 0 ? j.momentum_signals[0].signal : null,
            }));
          } catch (_) {}
        } else {
          setWeeklySummary(null);
          setBriefGeneratedAt(null);
          setMomentumSignals([]);
        }

        if (j.free_trial) {
          setFreeBrief(!j.free_trial_used);
        } else {
          setBriefQuota({
            used: j.used,
            limit: j.limit,
            week_start: j.week_start,
            can_generate: j.can_generate,
          });
        }
      } catch { /* ignore — empty state is fine */ }
      finally {
        if (!cancelled) setIsFetching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, isPro, thisISOWeek]);

  const weekDates = useMemo(() => calendarWeekDates(todayStr()), [thisWeekStart]);
  const todayYmd = todayStr();

  const anyHabitLoggedThisWeek = useMemo(
    () => habits.some((h) => weekDates.some((d) => {
      const st = weekSquareState(h, d, todayYmd);
      return st === "hit" || st === "skip";
    })),
    [habits, weekDates, todayYmd],
  );

  const [viewportW, setViewportW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 375));
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const habitGridSquarePx = useMemo(() => {
    const w = Math.min(viewportW, 480);
    const colGap = 5;
    const reserved = 28 + 24 + 7 * colGap + 92;
    return Math.max(22, Math.min(32, Math.floor((w - reserved) / 7)));
  }, [viewportW]);

  const [habitGridExpanded, setHabitGridExpanded] = useState(false);
  useEffect(() => {
    if (habits.length <= 6) setHabitGridExpanded(false);
  }, [habits.length]);

  async function generateWeeklySummary() {
    setIsGenerating(true);
    setSummaryError(null);
    setShowQuotaNote(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/weekly-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          habits,
          goals,
          journalEntries,
          name: (userName || "").trim() || "there",
          client_date: todayStr(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429 && payload?.limit != null) {
          setBriefQuota({
            used: payload.used,
            limit: payload.limit,
            week_start: payload.week_start,
            can_generate: false,
          });
          setShowQuotaNote(true);
          return;
        }
        if (res.status === 403 && payload?.free_trial_used) {
          setFreeBrief(false);
        }
        throw new Error(payload.error || `Error ${res.status}`);
      }
      const { text, generated_at, used, limit, week_start, free_trial, momentum_signals } = payload;
      setWeeklySummary(text);
      setBriefGeneratedAt(generated_at || new Date().toISOString());
      setMomentumSignals(Array.isArray(momentum_signals) ? momentum_signals : []);
      try {
        localStorage.setItem("forged_brief_preview", JSON.stringify({
          text,
          week_start: week_start || thisWeekStart,
          signal: Array.isArray(momentum_signals) && momentum_signals.length > 0 ? momentum_signals[0].signal : null,
        }));
      } catch (_) {}
      if (free_trial) {
        setFreeBrief(false);
      } else if (typeof used === "number" && typeof limit === "number") {
        setBriefQuota({
          used,
          limit,
          week_start: week_start || thisWeekStart,
          can_generate: used < limit,
        });
      }
    } catch (err) {
      setSummaryError(err.message || "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  // Refresh button click handler — if we're already at the weekly cap, surface
  // the inline "next refresh available" note instead of calling the API.
  function handleRefreshClick() {
    if (isGenerating) return;
    if (briefQuota && !briefQuota.can_generate) {
      setShowQuotaNote(true);
      return;
    }
    generateWeeklySummary();
  }
  function IC({ title, children, action, dataTour, subtitle, flush }) {
    return (
      <div data-tour={dataTour} style={{ margin: flush ? "0 0 12px" : "0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:18 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: subtitle ? 6 : 14 }}>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, textTransform:"uppercase", letterSpacing:"0.1em" }}>{title}</div>
          {action}
        </div>
        {subtitle && (
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.55, marginBottom:14, fontWeight:450 }}>{subtitle}</div>
        )}
        {children}
      </div>
    );
  }

  // Section header — structural divider between groups of cards.
  function SectionTitle({ label, hint, explainer }) {
    return (
      <div style={{ margin:"26px 18px 12px" }}>
        <div style={{ fontFamily:T.serif, fontSize:21, fontWeight:400, color:T.text, letterSpacing:"-0.02em", lineHeight:1.2 }}>{label}</div>
        {hint && (
          <div style={{ fontSize:10, fontWeight:700, color:T.hint, marginTop:6, letterSpacing:"0.12em", textTransform:"uppercase" }}>{hint}</div>
        )}
        {explainer && <div style={{ fontSize:12, color:T.muted, marginTop:10, lineHeight:1.65, maxWidth:420 }}>{explainer}</div>}
      </div>
    );
  }

  // Soft placeholder used inside cards when data isn't there yet.
  function EmptyHint({ icon = "✨", children }) {
    return (
      <div style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"4px 2px" }}>
        <span style={{ fontSize:16, lineHeight:1.2, opacity:0.8, flexShrink:0 }}>{icon}</span>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.65 }}>{children}</div>
      </div>
    );
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  const habitRealLogs = habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip"));
  const goalRealLogs = goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number"));
  const allRealLogs = [...habitRealLogs, ...goalRealLogs];
  const totalDaysLogged = new Set(allRealLogs.map(l => l.date)).size;
  const allLogDates = habits.flatMap(h => h.logs.map(l => l.date)).filter(Boolean).sort();
  const firstLogDate = allLogDates[0] || null;
  const firstLogLabel = firstLogDate
    ? `${MONTHS[parseInt(firstLogDate.split("-")[1])-1]} ${firstLogDate.split("-")[0]}`
    : null;
  const longestBestStreak = habits.reduce((best, h) => Math.max(best, getBestStreak(h)), 0);
  const totalLogsEver = new Set(allRealLogs.map(l => l.date)).size; // unique days tracked, consistent with profile/share
  const totalTracked = habits.length + goals.length;

  // Most consistent habit (highest 28-day completion rate).
  const mostConsistent = habits.length
    ? habits.reduce((best, h) => getCompletionRate(h) > getCompletionRate(best) ? h : best, habits[0])
    : null;
  const mostConsistentRate = mostConsistent ? getCompletionRate(mostConsistent) : 0;

  // Day-of-week pattern across real logs.
  const dow = getBestDayOfWeek(allRealLogs);
  // Totals across habit grids — used to decide if 12-week/28-day cards have
  // enough real data to render meaningfully vs. the empty hint.
  const anyHabitLogs = habits.some(h => h.logs.some(l => l.value !== "quicknote" && l.value !== "skip"));
  const anyCompletionAboveZero = habits.some(h => getCompletionRate(h) > 0);

  const activitySummaryBits = [];
  if (anyHabitLogs && longestBestStreak > 0) activitySummaryBits.push(`Best streak on any habit: ${longestBestStreak} days`);
  if (dow.best && !dow.needsMoreData) activitySummaryBits.push(`You tend to log most on ${dow.best.label}s`);
  if (mostConsistent && mostConsistentRate > 0) activitySummaryBits.push(`${mostConsistent.name} is your steadiest lately (${mostConsistentRate}% over 28 days)`);

  if (habits.length === 0) return (
    <div style={{ padding:"60px 28px", textAlign:"center" }}>
      <div style={{ fontSize:36, marginBottom:14 }}>📈</div>
      <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>
        Log a habit on Today and your patterns will start appearing here.
      </div>
    </div>
  );

  const projectHabits = habits.filter(h => h.habitType === "project");
  const activeGoals = goals.filter(g => g.status !== "completed");

  const noWeekLogs = !anyHabitLoggedThisWeek;
  const weekRangeLabel = fmtWeekRange(thisWeekStart);
  const showStatsCollapse = hasFreshBrief && anyHabitLoggedThisWeek;
  const showMomentumBlock = hasFreshBrief && momentumSignals.length > 0;
  const showHabitGrid = anyHabitLoggedThisWeek;
  const gridHabits = habitGridExpanded || habits.length <= 6 ? habits : habits.slice(0, 6);
  const hiddenHabitGridCount = habits.length > 6 && !habitGridExpanded ? habits.length - 6 : 0;
  const canTapRefresh = hasFreshBrief && !isGenerating && !isFetching && !!briefQuota?.can_generate;

  if (noWeekLogs) {
    return (
      <div style={{ overflowX:"hidden", maxWidth:"100%", minWidth:0, boxSizing:"border-box" }}>
        <div style={{ padding:"16px 18px 10px", display:"flex", flexWrap:"wrap", alignItems:"flex-end", justifyContent:"space-between", gap:12, maxWidth:"100%" }}>
          <div style={{ minWidth:0, flex:"1 1 200px" }}>
            <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:6 }}>Insights</div>
            <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.03em", lineHeight:1.05 }}>Forge report</div>
            {firstLogLabel && (
              <div style={{ fontSize:11, color:T.muted, marginTop:8, lineHeight:1.45 }}>Tracking since <span style={{ color:T.sub, fontWeight:600 }}>{firstLogLabel}</span></div>
            )}
          </div>
          {onShare && (
            <button type="button" onClick={onShare} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:T.rsm, background:"rgba(200,144,42,0.12)", border:"none", color:T.gold, fontSize:12, fontWeight:600, cursor:"pointer", marginBottom:4 }}>
              📤 Share
            </button>
          )}
        </div>
        <div style={{ padding:"48px 20px 56px", textAlign:"center", maxWidth:360, margin:"0 auto" }}>
          <div style={{ fontSize:15, color:T.muted, lineHeight:1.7 }}>
            Log some habits this week and come back for your brief.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ overflowX:"hidden", maxWidth:"100%", minWidth:0, boxSizing:"border-box" }}>
      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", flexWrap:"wrap", alignItems:"flex-end", justifyContent:"space-between", gap:12, maxWidth:"100%" }}>
        <div style={{ minWidth:0, flex:"1 1 200px" }}>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:6 }}>Insights</div>
          <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.03em", lineHeight:1.05 }}>Forge report</div>
          {firstLogLabel && (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, lineHeight:1.45 }}>Tracking since <span style={{ color:T.sub, fontWeight:600 }}>{firstLogLabel}</span></div>
          )}
        </div>
        {onShare && (
          <button type="button" onClick={onShare} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:T.rsm, background:"rgba(200,144,42,0.12)", border:"none", color:T.gold, fontSize:12, fontWeight:600, cursor:"pointer", marginBottom:4 }}>
            📤 Share
          </button>
        )}
      </div>

      {/* ══ Weekly brief — headline feature, top of page above stats ════════ */}
      <div style={{
        margin:"0 14px 18px",
        background:`linear-gradient(165deg, rgba(200,144,42,0.18) 0%, rgba(26,26,22,0.94) 38%, ${T.raised} 100%)`,
        borderRadius:T.r,
        border:`1px solid rgba(200,144,42,0.42)`,
        padding:"22px 18px 20px",
        position:"relative",
        overflow:"hidden",
        boxShadow:"0 2px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(200,144,42,0.14)",
      }}>
        {!isPro && freeBrief !== true && !hasFreshBrief && (
          <div style={{ position:"absolute", top:14, right:14 }}>
            <span style={{ fontSize:9, fontWeight:800, color:"#0F0F0D", background:T.gold, padding:"2px 7px", borderRadius:5, letterSpacing:"0.08em" }}>PRO</span>
          </div>
        )}

        <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", marginBottom:10 }}>YOUR WEEKLY BRIEF</div>
        <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, letterSpacing:"-0.03em", lineHeight:1.15, marginBottom:10, maxWidth:320 }}>
          What actually moved this week
        </div>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.6, marginBottom:14, maxWidth:360, fontWeight:450 }}>
          Plain-language read on what held, what slipped, and what deserves attention. <strong style={{ color:T.sub, fontWeight:600 }}>Uses AI</strong> — capped so it stays sustainable.
        </div>
        {isPro && briefQuota && hasFreshBrief && (
          <div style={{
            fontSize:11, color: briefQuota.can_generate ? T.sub : T.amber, marginBottom:14,
            padding:"8px 11px", borderRadius:8, background:"rgba(0,0,0,0.22)", border:`0.5px solid ${T.border}`,
            lineHeight:1.5,
          }}>
            <span style={{ fontWeight:700, color:T.text }}>{Math.max(0, briefQuota.limit - briefQuota.used)}</span> of {briefQuota.limit} fresh briefs left for the week of {fmtWeekRange(briefQuota.week_start || thisWeekStart)}.
            {!briefQuota.can_generate && " Resets next Monday."}
          </div>
        )}

        {/* Body — week label grounds the brief; ↻ only when quota allows refresh. */}
        {isFetching ? (
          <>
            <div style={{ fontSize:13, color:T.sub, fontWeight:600, letterSpacing:"0.02em", marginBottom:14 }}>
              {weekRangeLabel}
            </div>
            {[92, 78, 88, 55].map((w, i) => (
              <div key={i} style={{
                height: 13, borderRadius: 4, marginBottom: 10,
                background: "rgba(255,255,255,0.07)",
                width: `${w}%`,
              }}/>
            ))}
          </>
        ) : (
          <>
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:12, minWidth:0,
            }}>
              <div style={{
                fontSize:13, color:T.sub, fontWeight:600, letterSpacing:"0.02em", minWidth:0, flex:1,
              }}>
                {weekRangeLabel}
              </div>
              {canTapRefresh && (
                <button
                  type="button"
                  aria-label="Refresh weekly brief"
                  title="Generate a new brief"
                  onClick={handleRefreshClick}
                  disabled={isGenerating}
                  style={{
                    flexShrink:0, width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center",
                    borderRadius:"50%", border:`0.5px solid ${T.border}`,
                    background:"rgba(255,255,255,0.04)", cursor:isGenerating ? "default" : "pointer", color:T.gold,
                    fontSize:15, padding:0, fontFamily:T.font, lineHeight:1, opacity:isGenerating ? 0.45 : 1,
                  }}
                >
                  ↻
                </button>
              )}
            </div>
            {isGenerating ? (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"20px 0 8px", color:T.gold, fontSize:13, fontWeight:600, letterSpacing:"0.02em" }}>
                Writing your brief…
              </div>
            ) : hasFreshBrief ? (
              <>
                <div style={{ marginBottom: (!isPro && onUpgrade) || showQuotaNote ? 16 : 0 }}>
                  {(() => {
                    const blocks = weeklyBriefBlocks(weeklySummary);
                    return blocks.map((block, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize:14, color:T.text, lineHeight:1.72, fontWeight:450,
                          marginBottom: i < blocks.length - 1 ? 14 : 0,
                          paddingBottom: i < blocks.length - 1 ? 14 : 0,
                          borderBottom: i < blocks.length - 1 ? `0.5px solid rgba(255,255,255,0.06)` : "none",
                        }}
                      >
                        {block}
                      </div>
                    ));
                  })()}
                </div>
                {!isPro && onUpgrade && (
                  <button type="button" onClick={onUpgrade} style={{ padding:"11px 18px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.5)`, background:"rgba(200,144,42,0.18)", color:T.gold, fontSize:13, fontWeight:700, cursor:"pointer", letterSpacing:"0.02em" }}>
                    Get Pro for weekly briefs →
                  </button>
                )}
                {showQuotaNote && (
                  <div style={{ marginTop: !isPro && onUpgrade ? 12 : 0, fontSize:11, color:T.muted, lineHeight:1.55 }}>
                    Next refresh available <span style={{ color:T.sub, fontWeight:600 }}>{fmtNextMondayShort(todayStr())}</span>.
                  </div>
                )}
              </>
            ) : !isPro && freeBrief === false ? (
              <>
                {onUpgrade && (
                  <button type="button" onClick={onUpgrade} style={{ padding:"11px 18px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.5)`, background:"rgba(200,144,42,0.18)", color:T.gold, fontSize:13, fontWeight:700, cursor:"pointer", letterSpacing:"0.02em" }}>
                    Unlock with Pro →
                  </button>
                )}
              </>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:"6px 0 4px" }}>
                {summaryError && (
                  <div style={{ fontSize:12, color:T.amber, textAlign:"center", lineHeight:1.5 }}>{summaryError}</div>
                )}
                <button
                  type="button"
                  onClick={generateWeeklySummary}
                  disabled={isGenerating}
                  style={{
                    padding:"12px 22px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.55)`,
                    background: T.gold, color:"#0F0F0D",
                    fontSize:13, fontWeight:800, cursor:isGenerating ? "default" : "pointer", letterSpacing:"0.02em",
                    opacity:isGenerating ? 0.55 : 1,
                  }}
                >
                  {!isPro && freeBrief === true ? "Generate your first brief — free ✨" : "Generate this week’s brief"}
                </button>
                {!isPro && freeBrief === true && (
                  <div style={{ fontSize:11, color:T.hint, textAlign:"center", lineHeight:1.5, maxWidth:280 }}>
                    One on us. Upgrade to Pro for a fresh brief every week.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showMomentumBlock && (
        <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"14px 14px 12px" }}>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:12 }}>This week&apos;s habits</div>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {momentumSignals.map((row, i) => {
              const habit = habits.find((h) => h.name === row.habit_name);
              const emoji = habit?.emoji || "•";
              return (
                <div
                  key={`${row.habit_name}-${i}`}
                  style={{
                    display:"flex", flexWrap:"wrap", alignItems:"baseline", columnGap:8, rowGap:3,
                    paddingBottom: i < momentumSignals.length - 1 ? 12 : 0,
                    borderBottom: i < momentumSignals.length - 1 ? `0.5px solid ${T.border}` : "none",
                  }}
                >
                  <span style={{ fontSize:14, lineHeight:1 }}>{emoji}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:T.text }}>{row.habit_name}</span>
                  <span style={{ fontSize:12, color:T.muted, lineHeight:1.55, flex:"1 1 180px", minWidth:0 }}>
                    {row.signal}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary stats — only after a brief exists for this week */}
      {showStatsCollapse && (
      <div style={{ margin:"0 14px 10px" }}>
        <button
          type="button"
          data-tour="insights-stats-toggle"
          onClick={() => setStatsNumbersOpen(o => !o)}
          style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
            gap:10, padding:"12px 14px", borderRadius:T.r, border:`0.5px solid ${T.border}`,
            background:T.raised, color:T.text, fontFamily:T.font, fontSize:13, fontWeight:600,
            cursor:"pointer", textAlign:"left",
          }}
        >
          <span>This week&apos;s numbers {statsNumbersOpen ? "▴" : "▾"}</span>
        </button>
        {statsNumbersOpen && (
          <>
            <div data-tour="insights-stats" style={{ marginTop:10, display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
              <Stat label="tracked" value={totalTracked}/>
              <Stat label="days logged" value={totalDaysLogged} color={T.text}/>
              <Stat label="best streak" value={longestBestStreak > 0 ? `🔥${longestBestStreak}` : "—"} color={T.gold}/>
              <Stat label="total logs" value={totalLogsEver}/>
            </div>
            <div style={{ margin:"10px 4px 0", fontSize:11, color:T.muted, lineHeight:1.55, maxWidth:400 }}>
              <span style={{ color:T.hint, fontWeight:700, fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", marginRight:8 }}>At a glance</span>
              What you track, how many different days you&apos;ve logged, your best streak, and total logging days.
            </div>
          </>
        )}
      </div>
      )}

      {/* This week — Mon–Sun habit grid (client-side from logs) */}
      {showHabitGrid && (
      <div style={{
        margin:"0 14px 18px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`,
        padding:"12px 12px 14px", maxWidth:"100%", boxSizing:"border-box", minWidth:0,
      }}>
        <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>This week</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8, minWidth:0 }}>
          <div style={{
            display:"grid",
            gridTemplateColumns:`minmax(0,1fr) repeat(7, ${habitGridSquarePx}px)`,
            columnGap: habitGridSquarePx <= 24 ? 4 : 6,
            alignItems:"center",
            minWidth:0,
          }}>
            <div />
            {["M","T","W","T","F","S","S"].map((lab, i) => (
              <div
                key={i}
                style={{
                  width:habitGridSquarePx, justifySelf:"center", textAlign:"center", fontSize:9, fontWeight:700,
                  color:T.hint, letterSpacing:"0.04em",
                }}
              >
                {lab}
              </div>
            ))}
          </div>
          {gridHabits.map(h => (
            <div key={h.id} style={{
              display:"grid",
              gridTemplateColumns:`minmax(0,1fr) repeat(7, ${habitGridSquarePx}px)`,
              columnGap: habitGridSquarePx <= 24 ? 4 : 6,
              alignItems:"center",
              minWidth:0,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
                <span style={{ fontSize:15, lineHeight:1, flexShrink:0 }}>{h.emoji}</span>
                <span style={{
                  fontSize:11, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis",
                  whiteSpace:"nowrap",
                }}>{h.name}</span>
              </div>
              {weekDates.map(dateStr => {
                const st = weekSquareState(h, dateStr, todayYmd);
                const fill = st === "hit"
                  ? (h.color || T.green)
                  : st === "future"
                    ? "rgba(255,255,255,0.03)"
                    : "rgba(255,255,255,0.07)";
                // skip = dashed border (intentional rest, not completion); miss = solid dim border
                const border = st === "skip"
                  ? "1px dashed rgba(255,255,255,0.22)"
                  : `0.5px solid ${T.border}`;
                const tip = st === "hit" ? `${fmtEntryDate(dateStr)} · logged`
                  : st === "skip" ? `${fmtEntryDate(dateStr)} · skipped`
                    : st === "miss" ? `${fmtEntryDate(dateStr)} · missed`
                      : fmtEntryDate(dateStr);
                return (
                  <div
                    key={dateStr}
                    title={tip}
                    style={{
                      width:habitGridSquarePx, height:habitGridSquarePx, borderRadius:6, justifySelf:"center", boxSizing:"border-box",
                      background: fill, border,
                    }}
                  />
                );
              })}
            </div>
          ))}
          {hiddenHabitGridCount > 0 && (
            <button
              type="button"
              onClick={() => setHabitGridExpanded(e => !e)}
              style={{
                marginTop:4, alignSelf:"flex-start", padding:"8px 12px", borderRadius:T.rsm,
                border:`0.5px solid ${T.border}`, background:"rgba(255,255,255,0.04)",
                color:T.sub, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:T.font,
              }}
            >
              {habitGridExpanded ? "Show fewer habits" : `Show ${hiddenHabitGridCount} more habit${hiddenHabitGridCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
      )}

      {/* ══ Activity ══════════════════════════════════════════════════════════ */}
      <SectionTitle
        label="Activity"
        hint="By the numbers"
        explainer="Streaks, completion bars, and heatmaps live below — support for your weekly brief."
      />

      <div data-tour="insights-streaks" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:14 }}>
        <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>Highlights</div>
        <div style={{ fontSize:13, color:T.sub, lineHeight:1.65, marginBottom:12, fontWeight:450 }}>
          {activitySummaryBits.length > 0
            ? activitySummaryBits.map((line, i) => (
                <div key={i} style={{ marginBottom: i < activitySummaryBits.length - 1 ? 8 : 0, paddingLeft:11, borderLeft:`3px solid rgba(200,144,42,0.55)` }}>{line}</div>
              ))
            : "Log a few more days and we’ll drop your streak leader, steadiest habit, and strongest weekday here."}
        </div>
        <button
          type="button"
          onClick={() => setActivityExpanded(e => !e)}
          style={{
            width:"100%", padding:"10px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`,
            background:"rgba(255,255,255,0.04)", color:T.text, fontSize:11, fontWeight:700,
            cursor:"pointer", fontFamily:T.font,
          }}
        >
          {activityExpanded ? "Hide charts & streaks" : "Show streaks, rates & 12-week grids"}
        </button>
      </div>

      {activityExpanded && (
      <>
      {/* Streaks */}
      <IC
        title="Streaks"
        action={<button onClick={onShowHistory} style={{ fontSize:12, color:T.accent, background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Full history →</button>}
      >
        {anyHabitLogs ? (
          [...habits].sort((a, b) => getStreak(b) - getStreak(a)).map(h => {
            const cur  = getStreak(h);
            const best = getBestStreak(h);
            const act  = get7DayActivity(h);
            const hasAnyLogs = h.logs.some(l => l.value !== "quicknote");
            return (
              <div key={h.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                <span style={{ fontSize:20, width:24, flexShrink:0 }}>{h.emoji}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:5 }}>{h.name}</div>
                  <div style={{ display:"flex", gap:3 }}>
                    {act.map((on, i) => (
                      <div key={i} style={{ width:16, height:6, borderRadius:2, background:on ? h.color : T.surface, opacity:on?1:0.2 }}/>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontSize:16, fontWeight:600, color:hasAnyLogs ? (cur > 0 ? h.color : T.muted) : T.hint }}>
                    {hasAnyLogs ? (cur > 0 ? `🔥 ${cur}` : "0") : "—"}
                  </div>
                  {best > cur && best > 1 && (
                    <div style={{ fontSize:10, color:T.hint, marginTop:1 }}>best {best}</div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <EmptyHint icon="🔥">
            Log a few days and your current + best streak for each habit will appear here.
          </EmptyHint>
        )}
      </IC>

      {/* 28-day completion rate */}
      <IC
        title="28-day completion rate"
        subtitle="How often you hit your target. Daily = out of 28 days. Weekly = 4 weeks at target."
      >
        {anyCompletionAboveZero ? (
          [...habits].sort((a, b) => getCompletionRate(b) - getCompletionRate(a)).map(h => {
            const rate = getCompletionRate(h);
            return (
              <div key={h.id} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <span style={{ fontSize:15, width:22, flexShrink:0 }}>{h.emoji}</span>
                <span style={{ fontSize:12, color:T.text, width:90, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.name}</span>
                <div style={{ flex:1, height:7, background:T.surface, borderRadius:4, overflow:"hidden" }}>
                  <div style={{ height:"100%", borderRadius:4, background:rate>=80?T.green:rate>=50?h.color:T.amber, width:`${rate}%`, transition:"width 0.7s ease" }}/>
                </div>
                <span style={{ fontSize:12, color:rate>=80?T.green:rate>=50?h.color:T.muted, width:34, textAlign:"right", flexShrink:0, fontWeight:rate>=50?500:400 }}>{rate}%</span>
              </div>
            );
          })
        ) : (
          <EmptyHint icon="📊">
            Completion rates stabilise after about a week of logging — keep going and bars will start filling in.
          </EmptyHint>
        )}
      </IC>

      {/* 12-week heatmap */}
      <IC title="12-week activity">
        {anyHabitLogs ? (
          <>
            {habits.map(h => {
              const grid = get12WeekGrid(h);
              const sessionCount = h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip").length;
              return (
                <div key={h.id} style={{ marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:12, color:T.sub }}>
                      {h.emoji} <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.name}</span>
                    </span>
                    <span style={{ fontSize:10, color:T.hint }}>{sessionCount} sessions</span>
                  </div>
                  <div style={{ display:"flex", gap:3 }}>
                    {grid.map((week, wi) => (
                      <div key={wi} style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        {week.map((day, di) => (
                          <div key={di} style={{
                            width:11, height:11, borderRadius:3,
                            background: day.logged ? h.color : T.surface,
                            opacity: day.logged ? 1 : 0.18,
                          }}/>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.hint, marginTop:2 }}>
              <span>← 12 weeks ago</span><span>today →</span>
            </div>
          </>
        ) : (
          <EmptyHint icon="🗓️">
            Each square is a day. Your 12-week heatmap lights up as you log — come back after a few days to see the shape of your week.
          </EmptyHint>
        )}
      </IC>

      {/* Most consistent habit — kept in Activity (it's a stat, not a pattern) */}
      <IC title="Most consistent">
        {mostConsistent && mostConsistentRate > 0 ? (
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"4px 2px" }}>
            <div style={{
              width:44, height:44, borderRadius:"50%", flexShrink:0,
              background: `${mostConsistent.color}1a`, border:`1px solid ${mostConsistent.color}55`,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:22,
            }}>{mostConsistent.emoji || "🏆"}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, color:T.text, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {mostConsistent.name}
              </div>
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.55, marginTop:2 }}>
                Showing up <strong style={{ color:mostConsistent.color }}>{mostConsistentRate}%</strong> of days over the last 28.
              </div>
            </div>
          </div>
        ) : (
          <EmptyHint icon="🏆">
            As you log consistently, your strongest habit will stand out here.
          </EmptyHint>
        )}
      </IC>

      {/* Best day of week — also a stat, belongs in Activity */}
      <IC title="Best day of the week">
        {dow.best && !dow.needsMoreData ? (
          <div>
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, marginBottom:12 }}>
              You log the most on <strong style={{ color:T.gold }}>{dow.best.label}s</strong> — {dow.best.count} logs so far.
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {dow.counts.map((n, i) => {
                const maxN = Math.max(...dow.counts, 1);
                const pct = Math.round((n / maxN) * 100);
                const isBest = i === dow.best.idx;
                return (
                  <div key={i} style={{ textAlign:"center" }}>
                    <div style={{ height:34, display:"flex", alignItems:"flex-end", justifyContent:"center", marginBottom:4 }}>
                      <div style={{
                        width:"70%",
                        height:`${Math.max(pct, n > 0 ? 8 : 2)}%`,
                        background: isBest ? T.gold : T.surface,
                        border: isBest ? `1px solid rgba(200,144,42,0.45)` : `0.5px solid ${T.border}`,
                        borderRadius:3,
                        transition:"height 0.5s ease",
                      }}/>
                    </div>
                    <div style={{ fontSize:9, color: isBest ? T.gold : T.hint, fontWeight: isBest ? 700 : 500, letterSpacing:"0.04em" }}>
                      {["M","T","W","T","F","S","S"][i]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <EmptyHint icon="📅">
            After about a week of logs, we'll show which day of the week you tend to show up the most.
          </EmptyHint>
        )}
      </IC>
      </>
      )}

      {/* ══ Builds (project habits) ══════════════════════════════════════════ */}
      {projectHabits.length > 0 && (
        <>
          <SectionTitle
            label="Builds"
            hint="Deep work and side projects you track with time."
            explainer="For “build” habits you log minutes, wins, and rough patches. This section totals your hours, what went well lately, and where you said it was hard — so you see the arc of the project, not just today’s checkbox."
          />
          {projectHabits.map(h => {
            const s = getProjectStats(h);
            return (
              <IC key={h.id} title={`${h.emoji} ${h.name} — all time`}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:s.wins>0?16:0 }}>
                  <Stat label="total hrs" value={s.totalHours} color={h.color}/>
                  <Stat label="hrs this wk" value={s.weekHours}/>
                  <Stat label="wins" value={s.wins} color={T.green}/>
                  <Stat label="hard parts" value={s.hard} color={T.amber}/>
                </div>
                {s.wins > 0 ? (
                  <>
                    <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Wins log</div>
                    {[...h.logs].filter(l => l.value?.win).reverse().slice(0, 5).map((l, i) => (
                      <div key={i} style={{ display:"flex", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}`, alignItems:"flex-start" }}>
                        <span style={{ fontSize:10, color:h.color+"99", flexShrink:0, width:80, marginTop:2, fontWeight:500 }}>{fmtEntryDate(l.date)}</span>
                        <span title={l.value.win} style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>{truncateText(l.value.win, 120)}</span>
                      </div>
                    ))}
                  </>
                ) : s.totalHours === 0 ? (
                  <EmptyHint icon="🛠️">
                    Log some build time on Today and your hours, wins, and hard parts will start filling in.
                  </EmptyHint>
                ) : null}
              </IC>
            );
          })}
        </>
      )}

      {/* ══ Goals ════════════════════════════════════════════════════════════ */}
      {activeGoals.length > 0 && (
        <>
          <SectionTitle
            label="Goals"
            hint="Numeric targets you're working toward."
            explainer="Each goal shows where you are now vs your target, a simple progress bar, and recent measurements. It matters because you can spot drift early — before the deadline sneaks up."
          />
          {activeGoals.map(g => {
            const stats = getGoalProgress(g);
            const { isComplete } = stats;
            const barFillPct = goalBarFillWidthPct(stats);
            const logs = [...g.logs].filter(l => typeof l.value === "number").sort((a, b) => a.date.localeCompare(b.date));
            const logsByDay = Array.from(new Map(logs.map(l => [l.date, l])).values());
            const recentMeasurements = logsByDay.slice(-6).reverse();
            const statusText = getGoalStatusText(g, stats);
            return (
              <IC key={g.id} title={`${g.emoji} ${g.name} — goal`}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontSize:13, color:T.muted }}>Current: <strong style={{ color:g.color }}>{formatWithUnit(g.currentValue, g.unit)}</strong></span>
                  <span style={{ fontSize:13, color:T.muted }}>Target: <strong style={{ color:T.text }}>{formatWithUnit(g.targetValue, g.unit)}</strong></span>
                </div>
                <div style={{ height:8, background:T.surface, borderRadius:4, overflow:"hidden", marginBottom:6 }}>
                  <div style={{ height:"100%", borderRadius:4, background:isComplete ? T.goldBright : g.color, width:`${barFillPct}%`, transition:"width 0.5s ease" }}/>
                </div>
                <div style={{ fontSize:11, color:isComplete ? T.gold : T.muted, marginBottom:16, textAlign:"center" }}>{statusText}</div>
                {logs.length > 0 ? (
                  <>
                    <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Recent measurements</div>
                    {recentMeasurements.map((l, i) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderTop:`0.5px solid ${T.border}` }}>
                        <span style={{ fontSize:11, color:g.color+"99", fontWeight:500 }}>{fmtEntryDate(l.date)}</span>
                        <div style={{ display:"flex", alignItems:"baseline", gap:4 }}>
                          <span style={{ fontSize:15, color:T.text, fontWeight:500 }}>{l.value}</span>
                          <span style={{ fontSize:11, color:T.muted }}>{g.unit}</span>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <EmptyHint icon="📈">
                    Log a measurement on Today and this chart will start showing your trajectory toward the target.
                  </EmptyHint>
                )}
              </IC>
            );
          })}
        </>
      )}

      <div style={{ height:20 }}/>
    </div>
  );
}
