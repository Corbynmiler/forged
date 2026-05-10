import { useState, useEffect, useMemo } from "react";
import { T, MONTHS } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, daysAgo, weekStartFor, getStreak, getBestStreak,
  getCompletionRate, get7DayActivity, getBestDayOfWeek,
  isSatisfiedForTodayRing, getGoalProgress, analyzeDeepInsights,
  mergedLast7,
  fmtWeekRange, fmtEntryDate, getWrittenCorpus, hashCorpusSignature,
  readDeepInsightsCache, writeDeepInsightsCache, get12WeekGrid, getProjectStats,
  goalBarFillWidthPct, getGoalStatusText, truncateText, formatWithUnit,
  getISOWeek, fmtNextMondayShort,
} from "../utils.js";
import { GBtn, PBtn, ActivityDots, CompletionBar, Stat } from "../components/ui.jsx";
import { HabitGrid } from "../components/habitCards.jsx";

/** Same TTL as App.jsx / utils deep-insights cache (utils keeps this const private). */
const DEEP_INSIGHTS_TTL_MS = 24 * 60 * 60 * 1000;

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
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [patternsMoreExpanded, setPatternsMoreExpanded] = useState(false);

  const thisWeekStart = weekStartFor(todayStr());
  const thisISOWeek   = getISOWeek(todayStr());

  // A brief is stale if it was generated in a previous ISO calendar week.
  // With the brief keyed by week_start in the DB this should rarely fire, but
  // it's our defensive boundary for week rollovers and clock skew.
  const briefIsStale = !!(weeklySummary && briefGeneratedAt && getISOWeek(briefGeneratedAt) !== thisISOWeek);
  const hasFreshBrief = !!weeklySummary && !briefIsStale;

  // Single fetch on mount: pulls existing brief + quota in one round trip.
  useEffect(() => {
    if (!userId) return;
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
        } else {
          setWeeklySummary(null);
          setBriefGeneratedAt(null);
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
      const { text, generated_at, used, limit, week_start, free_trial } = payload;
      setWeeklySummary(text);
      setBriefGeneratedAt(generated_at || new Date().toISOString());
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

  /** Progressive disclosure — full-width tap target, premium feel */
  function InsightExpandable({ label, sublabel, open, onToggle, children }) {
    return (
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
            gap:12, padding:"16px 18px", background:"none", border:"none", cursor:"pointer",
            fontFamily:T.font, textAlign:"left",
          }}
        >
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:sublabel ? 6 : 0 }}>{label}</div>
            {sublabel && <div style={{ fontSize:12, color:T.muted, lineHeight:1.55, fontWeight:450 }}>{sublabel}</div>}
          </div>
          <span style={{ fontSize:11, color:T.gold, fontWeight:700, flexShrink:0, letterSpacing:"0.06em" }}>{open ? "HIDE" : "SHOW"}</span>
        </button>
        {open && (
          <div style={{ padding:"4px 14px 16px", borderTop:`0.5px solid ${T.border}` }}>
            {children}
          </div>
        )}
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
  // Deeper insights — computed from user-written text only (reflections, notes,
  // project wins, hard parts, goal notes). Cached under a per-user key with a
  // content-hash + 24h TTL so the analysis doesn't re-run on every render or
  // tab open, and so it stays stable until the user actually adds new writing.
  const deep = useMemo(() => {
    const corpus = getWrittenCorpus(habits, goals);
    const sig = hashCorpusSignature(corpus);
    const cached = readDeepInsightsCache(userId);
    const cacheShapeOk =
      !cached?.data ||
      cached.data.needsMoreData === true ||
      Array.isArray(cached.data.crossHabitLinks);
    if (
      cached &&
      cacheShapeOk &&
      cached.sig === sig &&
      typeof cached.ts === "number" &&
      Date.now() - cached.ts < DEEP_INSIGHTS_TTL_MS
    ) {
      return cached.data;
    }
    const data = analyzeDeepInsights(habits, goals);
    writeDeepInsightsCache(userId, { sig, ts: Date.now(), data });
    return data;
  }, [habits, goals, userId]);

  const hasPatternMore = !deep.needsMoreData && (
    (deep.momentumShift?.up?.length > 0 || deep.momentumShift?.down?.length > 0) ||
    (deep.consistencyGaps?.length > 0) ||
    (deep.recentHardPartQuotes?.length > 0) ||
    !!deep.mostReflectedHabit ||
    !!(deep.revisitEntry && deep.revisitEntry.text && deep.revisitEntry.text.length >= 60)
  );

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

  return (
    <div>
      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:6 }}>Insights</div>
          <div style={{ fontFamily:T.serif, fontSize:30, color:T.text, letterSpacing:"-0.03em", lineHeight:1.05 }}>Forge report</div>
          {firstLogLabel && (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, lineHeight:1.45 }}>Tracking since <span style={{ color:T.sub, fontWeight:600 }}>{firstLogLabel}</span></div>
          )}
        </div>
        <button onClick={onShare} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:T.rsm, background:"rgba(200,144,42,0.12)", border:"none", color:T.gold, fontSize:12, fontWeight:600, cursor:"pointer", marginBottom:4 }}>
          📤 Share
        </button>
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

        {/* Header row: label + (Pro-only) subtle refresh icon when a fresh brief is on screen */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, gap:10 }}>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em" }}>YOUR WEEKLY BRIEF</div>
          {isPro && hasFreshBrief && !isGenerating && (
            <button
              type="button"
              aria-label="Refresh weekly brief"
              title={briefQuota && !briefQuota.can_generate ? "Limit reached — refreshes next Monday" : "Generate a new brief"}
              onClick={handleRefreshClick}
              style={{
                width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center",
                borderRadius:"50%", border:`0.5px solid ${T.border}`,
                background:"rgba(255,255,255,0.04)", cursor:"pointer", color:T.gold,
                fontSize:14, padding:0, fontFamily:T.font, lineHeight:1,
              }}
            >
              ↻
            </button>
          )}
        </div>
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

        {/* Body — separate isFetching (DB load) from isGenerating (AI call). */}
        {isFetching ? null
          : isGenerating ? (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"28px 0", color:T.gold, fontSize:13, fontWeight:600, letterSpacing:"0.02em" }}>
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
            // Free trial used + no brief — keep upgrade prompt
            <>
              {onUpgrade && (
                <button type="button" onClick={onUpgrade} style={{ padding:"11px 18px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.5)`, background:"rgba(200,144,42,0.18)", color:T.gold, fontSize:13, fontWeight:700, cursor:"pointer", letterSpacing:"0.02em" }}>
                  Unlock with Pro →
                </button>
              )}
            </>
          ) : (
            // No brief for this week — single centered Generate button, no other content.
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:"6px 0 4px" }}>
              {summaryError && (
                <div style={{ fontSize:12, color:T.amber, textAlign:"center", lineHeight:1.5 }}>{summaryError}</div>
              )}
              <button
                type="button"
                onClick={generateWeeklySummary}
                style={{
                  padding:"12px 22px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.55)`,
                  background: T.gold, color:"#0F0F0D",
                  fontSize:13, fontWeight:800, cursor:"pointer", letterSpacing:"0.02em",
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
      </div>

      {/* Summary stats row */}
      <div data-tour="insights-stats" style={{ margin:"0 14px 8px", display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
        <Stat label="tracked" value={totalTracked}/>
        <Stat label="days logged" value={totalDaysLogged} color={T.text}/>
        <Stat label="best streak" value={longestBestStreak > 0 ? `🔥${longestBestStreak}` : "—"} color={T.gold}/>
        <Stat label="total logs" value={totalLogsEver}/>
      </div>
      <div style={{ margin:"0 18px 18px", fontSize:11, color:T.muted, lineHeight:1.55, maxWidth:400 }}>
        <span style={{ color:T.hint, fontWeight:700, fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", marginRight:8 }}>At a glance</span>
        What you track, how many different days you&apos;ve logged, your best streak, and total logging days.
      </div>

      {/* ══ Activity ══════════════════════════════════════════════════════════ */}
      <SectionTitle
        label="Activity"
        hint="By the numbers"
        explainer="Streaks, completion bars, and heatmaps live below. This section is support — your weekly brief and patterns carry the story."
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

      {/* ══ Deeper insights — from what you've actually written ═══════════════
          Pulls from reflections, notes, project wins, hard parts, and goal
          notes. Cached per-user with a content-hash + 24h TTL (see useMemo
          above) so token cost is zero and analysis only re-runs when there's
          new writing or the cache expires. */}
      <SectionTitle
        label="Patterns in your words"
        hint={deep.needsMoreData
          ? "Needs a bit more writing"
          : "What keeps linking together"}
        explainer={deep.needsMoreData
          ? "Add a line when you log (win, hard part, or note). We read that text — not checkmarks — to spot ideas that bridge habits and how the mood of your words shifts week to week."
          : "We look for ideas that show up across more than one habit or goal, and compare the last week you wrote something to the week before. Not clinical — just a structured skim of your own language."}
      />

      {deep.needsMoreData ? (
        // Single intentional low-data state rather than 4 empty cards.
        <IC title="Keep logging — then this lights up">
          <EmptyHint icon="📝">
            A single sentence when you check in is enough. After a few days with notes, we’ll surface threads that tie different habits together and flag whether your wording has leaned lighter or heavier lately.
          </EmptyHint>
        </IC>
      ) : (
        <>
          {deep.crossHabitLinks && deep.crossHabitLinks.length > 0 && (
            <IC
              title="Threads across what you track"
              subtitle="Ideas that appear in more than one habit or goal — not random word counts."
            >
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {deep.crossHabitLinks.map((link, i) => (
                  <div key={`${link.term}-${i}`} style={{ paddingBottom: i < deep.crossHabitLinks.length - 1 ? 14 : 0, borderBottom: i < deep.crossHabitLinks.length - 1 ? `0.5px solid ${T.border}` : "none" }}>
                    <div style={{ display:"flex", flexWrap:"wrap", alignItems:"baseline", gap:8, marginBottom:8 }}>
                      <span style={{ fontFamily:T.serif, fontSize:17, color:T.gold, fontWeight:400, letterSpacing:"-0.02em" }}>{link.term}</span>
                      <span style={{ fontSize:10, color:T.hint, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase" }}>
                        {link.habitLabels.join(" · ")}
                      </span>
                    </div>
                    <div style={{ fontSize:13, color:T.text, lineHeight:1.6, fontWeight:500, marginBottom:link.sample ? 10 : 0 }}>
                      {link.connection}
                    </div>
                    {link.sample?.text && (
                      <div style={{ borderLeft:`2px solid rgba(200,144,42,0.45)`, paddingLeft:11 }}>
                        <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>
                          From {fmtEntryDate(link.sample.date)}
                        </div>
                        <div style={{ fontSize:12.5, color:T.muted, lineHeight:1.55, fontStyle:"italic" }}>
                          “{truncateText(link.sample.text, 200)}”
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </IC>
          )}

          {deep.moodTrend && (
            <IC
              title="Light vs. heavy wording"
              subtitle="We scan for simple upbeat vs. heavy words in everything you wrote — then compare the last 7 days you journaled to the 7 days before. Rough signal, not therapy."
            >
              {(() => {
                const total = deep.toneMix.pos + deep.toneMix.neg + deep.toneMix.neu || 1;
                const posPct = Math.round((deep.toneMix.pos / total) * 100);
                const negPct = Math.round((deep.toneMix.neg / total) * 100);
                const neuPct = Math.max(0, 100 - posPct - negPct);
                const label =
                  deep.moodTrend === "rising"    ? { text: "Leaning lighter than the week before", color: T.green, tail: "Your word choices tilted a bit more toward the positive list vs. the prior week." } :
                  deep.moodTrend === "declining" ? { text: "Leaning heavier than the week before",  color: T.amber, tail: "More of the heavy-word list showed up vs. the week prior — worth noticing, not diagnosing." } :
                                                    { text: "About the same tone as last week",       color: T.sub, tail: "No big swing between the two windows we compare." };
                return (
                  <>
                    <div style={{ fontSize:15, color:label.color, fontWeight:700, lineHeight:1.45, marginBottom:8, letterSpacing:"-0.02em" }}>
                      {label.text}
                    </div>
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.6, marginBottom:12, fontWeight:450 }}>
                      {label.tail}
                    </div>
                    <div style={{ display:"flex", height:8, borderRadius:4, overflow:"hidden", background:T.surface, marginBottom:8 }}>
                      <div style={{ width:`${posPct}%`, background:T.green, transition:"width 0.6s ease" }}/>
                      <div style={{ width:`${neuPct}%`, background:T.border }}/>
                      <div style={{ width:`${negPct}%`, background:T.amber, transition:"width 0.6s ease" }}/>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.hint, fontWeight:600 }}>
                      <span><span style={{ color:T.green }}>●</span> lighter {deep.toneMix.pos}</span>
                      <span>mixed {deep.toneMix.neu}</span>
                      <span><span style={{ color:T.amber }}>●</span> heavier {deep.toneMix.neg}</span>
                    </div>
                    <div style={{ fontSize:10, color:T.hint, lineHeight:1.55, marginTop:10, fontStyle:"normal" }}>
                      Score delta (last window vs. prior): {(deep.recentAvg - deep.priorAvg) >= 0 ? "+" : ""}{(deep.recentAvg - deep.priorAvg).toFixed(1)} on our tiny keyword scale.
                    </div>
                  </>
                );
              })()}
            </IC>
          )}

          {hasPatternMore && (
            <InsightExpandable
              label="Deeper detail"
              sublabel="Momentum vs. last week, habits that went quiet, hard lines you saved, where you write the most, and one past note worth rereading."
              open={patternsMoreExpanded}
              onToggle={() => setPatternsMoreExpanded(o => !o)}
            >
              {/* Momentum shift — which habits gained or lost consistency this week vs last */}
              {(deep.momentumShift?.up?.length > 0 || deep.momentumShift?.down?.length > 0) && (
                <IC flush title="This week vs. last week" subtitle="Which habits you hit more or less often than the week before.">
                  {deep.momentumShift.up.map(m => (
                    <div key={m.habitId} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}` }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{m.habitEmoji}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.habitName}</div>
                        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{m.lastWeek} → {m.thisWeek} days this week</div>
                      </div>
                      <div style={{ fontSize:12, fontWeight:700, color:T.green, flexShrink:0 }}>↑ picking up</div>
                    </div>
                  ))}
                  {deep.momentumShift.down.map(m => (
                    <div key={m.habitId} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}` }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{m.habitEmoji}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.habitName}</div>
                        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{m.lastWeek} → {m.thisWeek} days this week</div>
                      </div>
                      <div style={{ fontSize:12, fontWeight:700, color:T.amber, flexShrink:0 }}>↓ dropping off</div>
                    </div>
                  ))}
                </IC>
              )}

              {/* Consistency gaps — habits that were active but have gone quiet this week */}
              {deep.consistencyGaps?.length > 0 && (
                <IC flush title="Gone quiet" subtitle="These were active before but have not shown up this week — a nudge to check in, not a judgement.">
                  {deep.consistencyGaps.slice(0, 3).map(g => (
                    <div key={g.habitId} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 0", borderTop:`0.5px solid ${T.border}` }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{g.habitEmoji}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{g.habitName}</div>
                        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>Last logged {fmtEntryDate(g.lastLogDate)} · {g.daysSilent} {g.daysSilent === 1 ? "day" : "days"} ago</div>
                      </div>
                      <div style={{ fontSize:18, flexShrink:0 }}>🔇</div>
                    </div>
                  ))}
                </IC>
              )}

              {/* Hard-part quotes — what you actually wrote when things got hard */}
              {deep.recentHardPartQuotes?.length > 0 && (
                <IC flush title="What's been hard" subtitle="Lines you saved on tough days — useful to see the pattern in your own words.">
                  {deep.recentHardPartQuotes.map((q, i) => (
                    <div key={i} style={{ padding:"10px 0", borderTop: i > 0 ? `0.5px solid ${T.border}` : "none" }}>
                      <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>
                        {fmtEntryDate(q.date)}{q.habitName ? ` · ${q.habitName}` : ""}
                      </div>
                      <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, fontStyle:"italic" }}>
                        "{truncateText(q.text, 180)}"
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize:11, color:T.hint, lineHeight:1.6, marginTop:10, paddingTop:10, borderTop:`0.5px solid ${T.border}` }}>
                    Naming the pattern is half the fix.
                  </div>
                </IC>
              )}

              {deep.mostReflectedHabit && (
                <IC flush title="What you write about most" subtitle="The habit that shows up most in your notes — often where you're doing the emotional work.">
                  <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>
                    <strong style={{ color:T.text }}>{deep.mostReflectedHabit.name}</strong> shows up in your writing more than anything else — <strong style={{ color:T.text }}>{deep.mostReflectedHabit.days}</strong> {deep.mostReflectedHabit.days === 1 ? "day" : "days"} of notes so far. That's usually where the real work is happening.
                  </div>
                </IC>
              )}

              {deep.revisitEntry && deep.revisitEntry.text && deep.revisitEntry.text.length >= 60 && (
                <IC flush title="Worth revisiting" subtitle="Something you wrote recently that might still ring true.">
                  <div style={{ borderLeft:`2px solid ${T.accent}`, paddingLeft:12 }}>
                    <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>
                      {fmtEntryDate(deep.revisitEntry.date)}
                      {deep.revisitEntry.habitName ? ` · ${deep.revisitEntry.habitName}` : ""}
                      {deep.revisitEntry.goalName  ? ` · ${deep.revisitEntry.goalName}`  : ""}
                      {deep.revisitEntry.kind === "win"  ? " · win"      : ""}
                      {deep.revisitEntry.kind === "hard" ? " · hard part": ""}
                    </div>
                    <div style={{ fontSize:13, color:T.text, lineHeight:1.65, fontStyle:"italic" }}>
                      “{truncateText(deep.revisitEntry.text, 260)}”
                    </div>
                  </div>
                </IC>
              )}
            </InsightExpandable>
          )}
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
