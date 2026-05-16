import { useState, useEffect, useRef, useCallback } from "react";
import { T, cssPadTopSafe, cssPadXSafe } from "../theme.js";
import { supabase } from "../supabase.js";
import { fmtDateLong, isLegacyProgressType } from "../utils.js";
import { ActivityDots, CompletionBar } from "../components/ui.jsx";

/** Contextual coach hint when landing on a main tab (Profile omits FAB — no nudge). One shot per navigation; no interval. */
const COACH_PAGE_NUDGES = {
  today: "Need help logging today quickly?",
  journal: "Want help making sense of your recent entries?",
  insights: "Want a deeper read on your progress?",
  social: "Want to invite someone to hold you accountable on a specific habit?",
};
const COACH_NUDGE_DURATION_MS = 2800;

// ─── FIRST-TIME AI PAGE GUIDE ─────────────────────────────────────────────────
// The four pages that get a one-time guided bubble from the AI. Each is shown
// exactly once per user/device the first time they land on that screen, and
// stays visible until the user dismisses it or navigates away.
const PAGE_GUIDE_PAGES = ["today", "journal", "insights", "social"];

function pageGuideSeenKey(userId, page) {
  const u = userId || "anon";
  return `forged_ai_page_guide_seen:${u}:${page}`;
}
function readPageGuideSeen(userId, page) {
  try { return localStorage.getItem(pageGuideSeenKey(userId, page)) === "1"; }
  catch { return false; }
}
function writePageGuideSeen(userId, page) {
  try { localStorage.setItem(pageGuideSeenKey(userId, page), "1"); }
  catch { /* quota / private mode — fail silently */ }
}
function clearAllPageGuideSeen(userId) {
  try {
    for (const p of PAGE_GUIDE_PAGES) {
      localStorage.removeItem(pageGuideSeenKey(userId, p));
    }
  } catch { /* ignore */ }
}

/**
 * Build a short, warm, first-time guide message for a given page. Returns null
 * for unknown pages. Lightly personalized from the user's habits + goals so it
 * feels like a coach, not a read-me. Kept intentionally short (1–3 lines) and
 * purpose-forward: why the page matters, not just what's on it.
 */
function buildPageGuideMessage(page, { name, habits = [], goals = [] } = {}) {
  const who = name && String(name).trim() ? String(name).trim().split(/\s+/)[0] : "";
  const hi = who ? `Hey ${who} — ` : "";

  // Real logs only (ignore skips + quick notes) — keeps "logged today" honest.
  const realLogs = habits.flatMap(h =>
    (h.logs || []).filter(l => l && l.date && l.value !== "quicknote" && l.value !== "skip"),
  );
  const activeGoals = (goals || []).filter(g => !g.completedAt && !g.archivedAt);

  // Light personalization tags — checked in priority order. Non-exhaustive,
  // safe if habits is empty.
  const lowerNames = habits.map(h => String(h?.name || "").toLowerCase());
  const hasWeightGoal = activeGoals.some(g => {
    const t = String(g?.title || g?.name || "").toLowerCase();
    return t.includes("weight") || t.includes("kg") || t.includes("lb");
  }) || habits.some(h => h.habitType === "progress" || isLegacyProgressType(h.habitType));
  const hasGymOrStrength =
    lowerNames.some(n => /gym|lift|strength|workout|train|squat|bench|deadlift/.test(n)) ||
    activeGoals.some(g => /gym|lift|strength|workout|train/.test(String(g?.title || g?.name || "").toLowerCase()));
  const hasRun =
    lowerNames.some(n => /run|jog|5k|10k|marathon|cardio/.test(n)) ||
    activeGoals.some(g => /run|jog|5k|10k|marathon/.test(String(g?.title || g?.name || "").toLowerCase()));
  const hasReading =
    lowerNames.some(n => /read|book|pages/.test(n));
  const hasLimit = habits.some(h => h.habitType === "limit");
  const hasProject = habits.some(h => h.habitType === "project");
  const hasAnyHabits = habits.length > 0;
  const hasRichHistory = realLogs.length >= 7;

  // Pick a light personalization phrase (single clause, optional).
  let personalBit = "";
  if (hasWeightGoal)       personalBit = "your weight goal";
  else if (hasGymOrStrength) personalBit = "your training";
  else if (hasRun)           personalBit = "your running";
  else if (hasProject)       personalBit = "what you're building";
  else if (hasLimit)         personalBit = "the limits you set";
  else if (hasReading)       personalBit = "your reading";
  else if (activeGoals.length > 0) personalBit = "your goals";
  else if (hasAnyHabits)     personalBit = "the habits you picked";

  switch (page) {
    case "today": {
      if (!hasAnyHabits) {
        return `${hi}this is your Today page — where momentum actually happens. Add a habit or goal and tap the row to log it. One log today beats a perfect plan.`;
      }
      const tail = personalBit ? ` Small, daily reps on ${personalBit} are what compound.` : "";
      return `${hi}this is your Today page. Tap a row to log, hold to note, and keep the streak alive.${tail}`;
    }

    case "journal": {
      if (!hasRichHistory) {
        return `${hi}this is your Journal. Activity fills in as you log — that's your trail for the day. When you're ready, open the Journal tab and turn it into a written daily entry.`;
      }
      const tail = personalBit ? ` Great place to check how ${personalBit} has been going lately.` : "";
      return `${hi}Activity shows what you logged; the Journal tab is your daily story. Use filters and the day/week/month switch to scan the trail.${tail}`;
    }

    case "insights": {
      if (!hasRichHistory) {
        return `${hi}Insights is where patterns show up. Right now it'll feel quiet — keep logging for a week or two and streaks, heatmaps, and your best day of the week start to mean something.`;
      }
      const tail = personalBit ? ` Worth checking which days you actually show up for ${personalBit}.` : "";
      return `${hi}this is Insights. Streaks, 28-day rates, and deeper patterns live here.${tail} More signal the more you log.`;
    }

    case "social": {
      return `${hi}this is Social. Add a friend, share a goal, and you've got quiet accountability — you see their streaks, they see yours. Nudges keep each other honest on the days it's easy to ghost.`;
    }

    default:
      return null;
  }
}

// ─── COACH DASHBOARD ──────────────────────────────────────────────────────────
// Collapse per-habit last7 arrays into one combined "any logged" row
function mergedLast7(habits) {
  if (!habits || habits.length === 0)
    return Array(7).fill({ date:"", logged:false, skip:false });
  const base = habits[0].last7 || [];
  return base.map((day, i) => ({
    date:   day.date,
    logged: habits.some(h => h.last7[i]?.logged),
    skip:   !habits.some(h => h.last7[i]?.logged) && habits.some(h => h.last7[i]?.skip),
  }));
}

// ── Local-timezone date helpers for the coach workspace ───────────────────────
// The coach-data API computes "today" in UTC (Vercel runs in UTC). Coaches in
// AEST/AEDT (UTC+10/11) are already on the next calendar day when UTC midnight
// hits. All "today / yesterday / X days ago" labels are therefore computed
// client-side from lastActiveDate so they always match the coach's local clock.

function localTodayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

/** Days since a YYYY-MM-DD string, using the browser's local timezone. */
function localDaysSince(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target     = new Date(y, m - 1, d).getTime();
  const n          = new Date();
  const todayMs    = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const diff       = todayMs - target;
  return diff < 0 ? 0 : Math.round(diff / 86400000);
}

function localIsToday(dateStr) { return localDaysSince(dateStr) === 0; }

// Per-row meta: accent colour + pill label. Always pass a LOCALLY-computed dsa.
function clientRowMeta(dsa) {
  if (dsa === null) return { accent: T.hint,    lastLabel: "Never logged" };
  if (dsa === 0)    return { accent: "#27AE60", lastLabel: "Active today" };
  if (dsa === 1)    return { accent: T.sub,     lastLabel: "Yesterday" };
  if (dsa === 2)    return { accent: T.gold,    lastLabel: "2 days ago" };
  if (dsa <= 5)     return { accent: T.amber,   lastLabel: `${dsa} days ago` };
  return              { accent: "#E74C3C", lastLabel: `${dsa} days quiet` };
}

// Single short observation about the client, using LOCAL date so timezone drift
// doesn't produce "logged everything today" for yesterday's logs.
function clientInsightLine(client) {
  const habits  = client.habits || [];
  const localDsa = localDaysSince(client.lastActiveDate);

  const streakHero = habits
    .filter(h => h && typeof h.streak === "number" && h.streak > 7)
    .sort((a, b) => b.streak - a.streak)[0];
  if (streakHero) return `🔥 ${streakHero.name} — ${streakHero.streak}-day streak`;

  if (localDsa === 0 && client.totalHabits > 0 && client.loggedTodayCount === client.totalHabits)
    return "✓ All habits logged today";
  if (localDsa === 0 && client.loggedTodayCount > 0)
    return `✓ ${client.loggedTodayCount}/${client.totalHabits} habits logged today`;
  if (localDsa !== null && localDsa > 1)
    return "No activity logged recently";
  if (client.bestStreak > 0) return `Best streak: ${client.bestStreak} days`;
  if (client.totalHabits > 0) return `${client.totalHabits} habit${client.totalHabits === 1 ? "" : "s"} tracked`;
  return "No habits set up yet";
}

// Card for one client in the coach list. The whole row is a button; tap opens
// the detail panel. `accent` (passed in by parent) overrides the auto-derived
// colour so the urgency group can colour-coordinate even when a client could
// fit multiple buckets (e.g. a brand-new but inactive client).
function CoachClientRow({ client, onClick, accent: accentOverride, animationDelayMs = 0, badge }) {
  // Use local-timezone dsa so the pill always reflects the coach's local date.
  const localDsa = localDaysSince(client.lastActiveDate);
  const meta = clientRowMeta(localDsa !== null ? localDsa : client.daysSinceActive);
  const accent = accentOverride || meta.accent;
  const insight = clientInsightLine(client);
  return (
    <button
      onClick={onClick}
      style={{
        width:"100%", textAlign:"left", cursor:"pointer", fontFamily:T.font, display:"block",
        background:T.surface, borderRadius:12, padding:"13px 14px 12px", marginBottom:8,
        borderTop:`1px solid rgba(255,255,255,0.06)`,
        borderRight:`1px solid rgba(255,255,255,0.06)`,
        borderBottom:`1px solid rgba(255,255,255,0.06)`,
        borderLeft:`3px solid ${accent}`,
        boxShadow:"0 1px 0 rgba(0,0,0,0.18)",
        animation: `coachRowIn 0.42s ${animationDelayMs}ms cubic-bezier(0.22,1,0.36,1) both`,
        transition: "transform 0.15s ease",
      }}
    >
      {/* Name row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:7, minWidth:0, flex:1 }}>
          <span style={{ fontSize:17, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {client.name}
          </span>
          {badge && (
            <span style={{
              fontSize:9, fontWeight:700, color:"#1a1a16",
              background:T.gold, padding:"2px 7px", borderRadius:6,
              letterSpacing:"0.06em", flexShrink:0,
            }}>
              {badge}
            </span>
          )}
          {client.isPro && (
            <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.15)", padding:"2px 6px", borderRadius:6, flexShrink:0 }}>PRO</span>
          )}
        </div>
        <span style={{
          flexShrink:0,
          fontSize:11, fontWeight:600,
          color: meta.accent,
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${meta.accent}33`,
          padding: "3px 9px",
          borderRadius: 999,
          letterSpacing: "0.01em",
        }}>
          {meta.lastLabel}
        </span>
      </div>

      {/* Insight + chevron row */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
        <span style={{
          fontSize:12, color:T.sub, fontStyle:"italic", lineHeight:1.5,
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          minWidth:0, flex:1,
        }}>
          {insight}
        </span>
        <span style={{ fontSize:16, color:T.hint, lineHeight:1, flexShrink:0 }}>→</span>
      </div>
    </button>
  );
}


// ─── COACH WORKSPACE ──────────────────────────────────────────────────────────
// Separate shell — replaces the consumer nav for is_coach accounts.
// Admin can preview via dev tools but never loses their own consumer app.

function buildSessionBrief(client) {
  const items = [];
  const { habits = [], loggedTodayCount, totalHabits, lastActiveDate } = client;

  // Use locally-computed dsa so timezone drift doesn't mislabel yesterday as today.
  const localDsa    = localDaysSince(lastActiveDate);
  const isToday     = localDsa === 0;
  const isYesterday = localDsa === 1;

  if (totalHabits > 0) {
    if (isToday && loggedTodayCount === totalHabits)
      items.push({ icon:"✅", text:`All ${totalHabits} habits logged today` });
    else if (isToday && loggedTodayCount > 0)
      items.push({ icon:"📋", text:`${loggedTodayCount}/${totalHabits} habits logged so far today` });
    else if (isToday)
      items.push({ icon:"⏰", text:"Not yet logged today — session is a good prompt" });
    else if (isYesterday)
      items.push({ icon:"📅", text:"Last logged yesterday — not yet active today" });
    else if (localDsa !== null && localDsa > 1)
      items.push({ icon:"⏰", text:`${localDsa} days since last activity — worth checking in on` });
    else
      items.push({ icon:"🔵", text:"No activity logged yet" });
  }

  const streakHabit = [...habits].sort((a, b) => b.streak - a.streak)[0];
  if (streakHabit && streakHabit.streak >= 3) {
    items.push({ icon:"🔥", text:`${streakHabit.emoji || ""} ${streakHabit.name} · ${streakHabit.streak}-day streak — ask about momentum` });
  }

  // Habits not logged recently (use local date for gap calc).
  const gapHabits = habits.filter(h => {
    if (isToday && h.loggedToday) return false;
    if (!h.lastLogDate) return true;
    return (localDaysSince(h.lastLogDate) ?? 0) >= 3;
  });
  for (const h of gapHabits.slice(0, 2)) {
    const days = h.lastLogDate ? localDaysSince(h.lastLogDate) : null;
    items.push({ icon:"⚠️", text:`${h.emoji || ""} ${h.name} — ${days ? `${days}d since last log` : "never logged"} — worth checking in on` });
  }

  const noteHabit = habits.find(h => h.recentNote);
  if (noteHabit) {
    const note = noteHabit.recentNote.length > 70 ? noteHabit.recentNote.slice(0,70)+"…" : noteHabit.recentNote;
    items.push({ icon:"💬", text:`Latest note: "${note}"` });
  }

  return items;
}

/** Valid UUID for coach-summary API — demo/preview clients use non-UUID ids. */
const COACH_SUMMARY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convincing sample AI brief for preview/demo clients (no API).
 * Mirrors the tone of coach-summary — session-focused, specific, coach-native.
 */
function previewAiBriefFromClient(client) {
  const first = String(client.name || "They").split(/\s+/)[0];
  const out = [];
  const localDsa = localDaysSince(client.lastActiveDate);
  const habits = client.habits || [];

  if (localDsa === 0) {
    if (client.totalHabits > 0 && client.loggedTodayCount === client.totalHabits)
      out.push(`${first} is fully logged today — lead with recognition, then ask what felt hardest (wins often hide friction).`);
    else if (client.loggedTodayCount > 0)
      out.push(`Partial day (${client.loggedTodayCount}/${client.totalHabits} habits). Ask what shifted their routine before you troubleshoot.`);
    else
      out.push(`${first} hasn't logged yet today. Keep the opener light — energy, schedule, or avoidance — stay curious, not corrective.`);
  } else if (localDsa === 1) {
    out.push(`Last seen yesterday — check how today landed before you dive into the dashboard.`);
  } else if (localDsa !== null && localDsa >= 3) {
    out.push(`${localDsa} days quiet — assume life load first. "What's been taking bandwidth?" beats a habit lecture.`);
  } else {
    out.push(`Sparse history — use the session to align on what a strong week looks like for them.`);
  }

  const topStreak = [...habits].filter(h => (h.streak || 0) >= 3).sort((a, b) => (b.streak || 0) - (a.streak || 0))[0];
  if (topStreak) {
    out.push(`Strongest thread: ${topStreak.name} (${topStreak.streak}d) — ask what made sticking with it easier than they expected.`);
  }

  const gap = habits.filter(h => {
    if (localDsa === 0 && h.loggedToday) return false;
    const hd = h.lastLogDate ? localDaysSince(h.lastLogDate) : null;
    return hd === null || hd >= 3;
  }).slice(0, 2);
  for (const h of gap) {
    const hd = h.lastLogDate ? localDaysSince(h.lastLogDate) : null;
    out.push(`${h.name} has gone quiet${hd != null ? ` (${hd}d)` : ""} — worth a light check-in before you problem-solve.`);
  }

  const withNote = habits.find(h => h.recentNote && String(h.recentNote).trim());
  if (withNote) {
    const raw = String(withNote.recentNote);
    const snip = raw.length > 100 ? `${raw.slice(0, 100)}…` : raw;
    out.push(`They left this on ${withNote.name}: "${snip}" — bring it up early.`);
  }

  if (out.length < 4) {
    out.push(`Session closer idea: "What would make next week feel a little lighter?"`);
  }
  return out.slice(0, 5);
}

function CoachClientDetail({ client, onBack, useLocalAiBrief = false }) {
  const [detailTab, setDetailTab] = useState("brief"); // "brief" | "habits"
  const brief = buildSessionBrief(client);
  const localDsa = localDaysSince(client.lastActiveDate);
  const lastSeenLabel = localDsa === null ? "never active"
    : localDsa === 0 ? "active today"
    : localDsa === 1 ? "last seen yesterday"
    : `last seen ${localDsa}d ago`;

  // ── AI session-prep brief ──────────────────────────────────────────────
  // Fetched on mount and on the refresh button. Renders below the
  // client-side `brief` so the coach gets both the deterministic facts and
  // the model's short take. We don't auto-retry on error — the coach can
  // hit the refresh button. Aborts in-flight if the component unmounts.
  const [aiBullets, setAiBullets]   = useState(null);  // string[] | null
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiErr, setAiErr]           = useState(null);

  const refreshAiBrief = useCallback(async () => {
    if (useLocalAiBrief) {
      setAiLoading(false);
      setAiErr(null);
      setAiBullets(previewAiBriefFromClient(client));
      return;
    }
    setAiLoading(true);
    setAiErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch(`/api/coach-summary?clientId=${encodeURIComponent(client.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load summary");
      setAiBullets(Array.isArray(json.summary) ? json.summary : []);
    } catch (e) {
      if (e.name === "AbortError") return;
      setAiErr(e.message);
    } finally {
      setAiLoading(false);
    }
  }, [client, useLocalAiBrief]);

  useEffect(() => {
    if (useLocalAiBrief) {
      setAiLoading(false);
      setAiErr(null);
      setAiBullets(previewAiBriefFromClient(client));
      return;
    }
    const ctrl = new AbortController();
    setAiBullets(null);
    setAiLoading(true);
    setAiErr(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");
        const res = await fetch(`/api/coach-summary?clientId=${encodeURIComponent(client.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not load summary");
        if (!ctrl.signal.aborted) setAiBullets(Array.isArray(json.summary) ? json.summary : []);
      } catch (e) {
        if (e.name === "AbortError") return;
        if (!ctrl.signal.aborted) setAiErr(e.message);
      } finally {
        if (!ctrl.signal.aborted) setAiLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [client, useLocalAiBrief]);

  const tabBtn = (id, label) => (
    <button
      key={id}
      onClick={() => setDetailTab(id)}
      style={{
        flex:1, padding:"9px 0", background:"none", border:"none",
        borderBottom: detailTab === id ? `2px solid ${T.gold}` : "2px solid transparent",
        color: detailTab === id ? T.text : T.muted,
        fontSize:13, fontWeight: detailTab === id ? 600 : 400,
        cursor:"pointer", fontFamily:T.font, letterSpacing:"0.01em",
        transition:"color 0.15s, border-color 0.15s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ paddingBottom:40 }}>
      {/* Back nav */}
      <button onClick={onBack} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:"14px 16px 10px", fontFamily:T.font }}>
        ← All clients
      </button>

      {/* Client identity strip */}
      <div style={{ padding:"0 16px 16px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:3 }}>
          <span style={{ fontSize:22, fontWeight:700, color:T.text }}>{client.name}</span>
          {client.isPro && <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.15)", padding:"2px 7px", borderRadius:8 }}>PRO</span>}
        </div>
        {client.email && <div style={{ fontSize:12, color:T.muted, marginBottom:3 }}>{client.email}</div>}
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{
            fontSize:11, fontWeight:600, padding:"2px 9px", borderRadius:99,
            background: localDsa === 0 ? "rgba(39,174,96,0.12)" : localDsa === 1 ? "rgba(255,255,255,0.05)" : "rgba(231,76,60,0.1)",
            color: localDsa === 0 ? "#27AE60" : localDsa === 1 ? T.sub : "#E74C3C",
            border: `1px solid ${localDsa === 0 ? "rgba(39,174,96,0.3)" : localDsa === 1 ? T.border : "rgba(231,76,60,0.25)"}`,
          }}>
            {lastSeenLabel}
          </span>
          <span style={{ fontSize:11, color:T.hint }}>
            {client.xp} xp · joined {client.joinedAt ? new Date(client.joinedAt).toLocaleDateString("en-AU", { month:"short", year:"numeric" }) : "—"}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", borderBottom:`0.5px solid ${T.border}`, padding:"0 16px" }}>
        {tabBtn("brief", "Session brief")}
        {tabBtn("habits", `Habits (${client.habits.length})`)}
      </div>

      {/* ── SESSION BRIEF TAB ─────────────────────────────────────────────── */}
      {detailTab === "brief" && (
        <div style={{ padding:"16px 16px 0" }}>

          {/* Situation snapshot */}
          <div style={{ background:T.surface, borderRadius:14, padding:"14px 16px", marginBottom:12, border:`1px solid rgba(255,255,255,0.06)` }}>
            <div style={{ fontSize:10, fontWeight:700, color:T.gold, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:11 }}>
              Situation snapshot
            </div>
            {brief.length === 0
              ? <div style={{ fontSize:12, color:T.muted, fontStyle:"italic" }}>No data yet — ask them to log their first habit in this session.</div>
              : brief.map((item, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom: i < brief.length-1 ? 9 : 0 }}>
                  <span style={{ fontSize:13, flexShrink:0, lineHeight:1.5 }}>{item.icon}</span>
                  <span style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{item.text}</span>
                </div>
              ))
            }
          </div>

          {/* AI pre-session brief */}
          <div style={{
            background:"linear-gradient(145deg, rgba(200,144,42,0.07) 0%, rgba(200,144,42,0.02) 100%)",
            border:`1px solid rgba(200,144,42,0.22)`,
            borderRadius:14, padding:"14px 16px", marginBottom:12,
          }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                <span style={{ fontSize:10, fontWeight:700, color:T.gold, textTransform:"uppercase", letterSpacing:"0.07em" }}>AI pre-session brief</span>
                <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.15)", padding:"1px 6px", borderRadius:6 }}>BETA</span>
                {useLocalAiBrief && (
                  <span style={{ fontSize:9, fontWeight:700, color:"#1a1a16", background:T.sub, padding:"1px 6px", borderRadius:6 }}>PREVIEW</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { if (!aiLoading) void refreshAiBrief(); }}
                disabled={aiLoading}
                style={{
                  display:"flex", alignItems:"center", gap:4,
                  background:"rgba(255,255,255,0.05)", border:`1px solid rgba(255,255,255,0.07)`,
                  borderRadius:8, padding:"4px 10px",
                  fontSize:10, fontWeight:600, color: aiLoading ? T.muted : T.sub,
                  cursor: aiLoading ? "default" : "pointer", fontFamily:T.font,
                }}
              >
                <span style={{ fontSize:11, display:"inline-block", animation: aiLoading ? "coachRefreshSpin 1.1s linear infinite" : "none" }}>↻</span>
                {aiLoading ? "Generating…" : "Refresh"}
              </button>
            </div>

            {/* Loading shimmer */}
            {aiLoading && aiBullets === null && (
              <div style={{ fontSize:12, color:T.muted, fontStyle:"italic", lineHeight:1.6 }}>
                Reading {client.name}&apos;s last 14 days of data…
              </div>
            )}

            {/* Graceful error — no red, no technical message */}
            {aiErr && !aiLoading && (
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>
                Brief unavailable right now — tap Refresh to try again.
              </div>
            )}

            {/* Empty result */}
            {!aiErr && aiBullets && aiBullets.length === 0 && (
              <div style={{ fontSize:12, color:T.muted, fontStyle:"italic", lineHeight:1.6 }}>
                Not enough logging data yet for a useful brief. Check back after a few sessions.
              </div>
            )}

            {/* Bullets */}
            {!aiErr && aiBullets && aiBullets.length > 0 && aiBullets.map((b, i) => (
              <div key={i} style={{ display:"flex", gap:10, marginBottom: i < aiBullets.length-1 ? 9 : 0 }}>
                <span style={{ fontSize:14, color:T.gold, flexShrink:0, lineHeight:1.4 }}>›</span>
                <span style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{b}</span>
              </div>
            ))}
          </div>

          {/* 7-day activity grid */}
          {client.habits.length > 0 && (() => {
            const merged = client.habits[0]?.last7 ? client.habits[0].last7.map((day, i) => ({
              date: day.date,
              logged: client.habits.some(h => h.last7?.[i]?.logged),
              skip:   !client.habits.some(h => h.last7?.[i]?.logged) && client.habits.some(h => h.last7?.[i]?.skip),
            })) : [];
            return merged.length > 0 ? (
              <div style={{ background:T.surface, borderRadius:14, padding:"12px 16px", marginBottom:12, border:`1px solid rgba(255,255,255,0.06)` }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>
                  Last 7 days
                </div>
                <div style={{ display:"flex", gap:6, justifyContent:"space-between" }}>
                  {merged.map((day, i) => {
                    const isT = localIsToday(day.date);
                    const bg  = day.logged ? "#27AE60" : day.skip ? T.amber : "rgba(255,255,255,0.07)";
                    const dow = day.date ? new Date(day.date+"T00:00:00").toLocaleDateString("en-AU",{weekday:"short"}).slice(0,1) : "";
                    return (
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                        <div style={{ fontSize:9, color: isT ? T.gold : T.hint, fontWeight: isT ? 700 : 400 }}>{dow}</div>
                        <div style={{ width:"100%", aspectRatio:"1", borderRadius:5, background:bg, border: isT ? `1.5px solid ${T.gold}` : "none" }}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* ── HABITS TAB ────────────────────────────────────────────────────── */}
      {detailTab === "habits" && (
        <div style={{ padding:"16px 16px 0" }}>
          {client.habits.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.muted, fontSize:13 }}>
              <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
              No habits set up yet.
            </div>
          ) : (
            <div style={{ background:T.surface, borderRadius:14, overflow:"hidden", border:`1px solid rgba(255,255,255,0.06)` }}>
              {client.habits.map((h, i) => {
                const hDsa = localDaysSince(h.lastLogDate);
                const isLoggedToday = localIsToday(h.lastLogDate);
                return (
                  <div key={i} style={{ padding:"13px 16px", borderBottom: i < client.habits.length-1 ? `1px solid rgba(255,255,255,0.05)` : "none" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                      <span style={{ fontSize:13, color: isLoggedToday ? T.text : T.sub, fontWeight: isLoggedToday ? 600 : 400, display:"flex", alignItems:"center", gap:5 }}>
                        {h.emoji} {h.name}
                        {isLoggedToday && <span style={{ color:"#27AE60", fontSize:11 }}>✓</span>}
                      </span>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {h.streak > 0 && <span style={{ fontSize:11, color:T.gold }}>🔥 {h.streak}d</span>}
                        {hDsa !== null && hDsa > 1 && (
                          <span style={{ fontSize:10, color: hDsa > 3 ? "#E74C3C" : T.muted }}>{hDsa}d ago</span>
                        )}
                      </div>
                    </div>
                    <ActivityDots last7={h.last7} size={10} />
                    {h.recentNote && (
                      <div style={{ fontSize:11, color:T.muted, fontStyle:"italic", marginTop:7, lineHeight:1.5, paddingLeft:2 }}>
                        &ldquo;{h.recentNote.length > 100 ? h.recentNote.slice(0,100)+"…" : h.recentNote}&rdquo;
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Subscribe screen shown inside CoachApp when the user is flagged is_coach
// but has no active coach subscription (coach_tier IS NULL). Admins bypass.
// One plan only: "coach" at $49/month, up to 15 active clients.
function CoachPaywall() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function startCheckout() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setErr("Not signed in"); setBusy(false); return; }
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: "coach" }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        setErr(json.error || "Could not start checkout");
        setBusy(false);
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      setErr(e.message || "Checkout failed");
      setBusy(false);
    }
  }

  return (
    <div style={{ padding:"32px 16px 48px" }}>
      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div style={{ fontSize:11, fontWeight:700, color:T.gold, letterSpacing:"0.08em", marginBottom:10 }}>
          FORGED COACH
        </div>
        <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, lineHeight:1.2, marginBottom:10 }}>
          Your clients' habits,<br/>before every session.
        </div>
        <div style={{ fontSize:13, color:T.muted, lineHeight:1.6, maxWidth:320, margin:"0 auto" }}>
          See who's building momentum, who's going quiet, and what's worth asking — without chasing anyone for an update.
        </div>
        <div style={{ fontSize:12, color:T.sub, lineHeight:1.65, maxWidth:340, margin:"16px auto 0", padding:"12px 14px", background:"rgba(255,255,255,0.04)", borderRadius:12, border:`0.5px solid ${T.border}` }}>
          <strong style={{ color:T.text }}>Why you&apos;re seeing this:</strong> your account is already tagged as a coach in Forged. After you subscribe, Stripe keeps your coach access active. If checkout fails, contact support — we don&apos;t sell this plan without the coach flag on your profile.
        </div>
      </div>

      {/* Plan card */}
      <div style={{
        background:"linear-gradient(180deg, rgba(200,144,42,0.1), rgba(200,144,42,0.03))",
        border:`1px solid rgba(200,144,42,0.3)`,
        borderRadius:18, padding:"22px 20px 20px", marginBottom:12,
      }}>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:6 }}>
          <div style={{ fontSize:16, fontWeight:700, color:T.text }}>Forged Coach</div>
          <div>
            <span style={{ fontSize:24, fontWeight:700, color:T.text }}>$49</span>
            <span style={{ fontSize:12, color:T.muted, marginLeft:3 }}>/month</span>
          </div>
        </div>
        <div style={{ fontSize:12, color:T.muted, marginBottom:16 }}>Up to 15 active clients · cancel any time</div>
        <ul style={{ listStyle:"none", padding:0, margin:"0 0 18px 0" }}>
          {[
            "Client list with live habit data",
            "7-day activity grids per client",
            "Pre-session brief — who's on track, who's not, what to ask",
            "Invite clients via a shareable link",
            "Streak and gap detection across every habit",
          ].map((f, i) => (
            <li key={i} style={{ display:"flex", gap:10, marginBottom:8 }}>
              <span style={{ color:T.gold, fontSize:12, flexShrink:0, marginTop:1 }}>✓</span>
              <span style={{ fontSize:12, color:T.sub, lineHeight:1.5 }}>{f}</span>
            </li>
          ))}
        </ul>

        {err && (
          <div style={{ background:"rgba(231,76,60,0.12)", color:"#E74C3C", padding:"9px 12px", borderRadius:8, fontSize:12, marginBottom:12, textAlign:"center" }}>
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={startCheckout}
          disabled={busy}
          style={{
            width:"100%", padding:"13px 14px", borderRadius:12, border:"none",
            background: busy ? "rgba(200,144,42,0.4)" : T.gold,
            color:"#1a1a16", fontSize:14, fontWeight:700,
            cursor: busy ? "default" : "pointer", fontFamily:T.font,
            transition:"background 0.15s",
          }}
        >
          {busy ? "Opening Stripe…" : "Subscribe — $49/month"}
        </button>
      </div>

      <div style={{ fontSize:11, color:T.muted, textAlign:"center", lineHeight:1.6 }}>
        Secure checkout via Stripe · cancel any time from your account
      </div>
    </div>
  );
}

// Time-of-day greeting used in the coach header. Boundaries are deliberately
// blunt (12 / 17) — anything fancier (sunrise, weekday-vs-weekend) buys
// nothing for an internal dashboard greeting.
function coachGreetingForNow(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

// Section label used between urgency groups in the coach client list. Renders
// as: "NEEDS ATTENTION  (3) ──────────────────────────────"
function CoachSectionLabel({ label, count, anchorRef }) {
  return (
    <div ref={anchorRef} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, marginTop:4 }}>
      <span style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.1em", flexShrink:0 }}>
        {label}
      </span>
      <span style={{
        fontSize:10, fontWeight:700, color:T.hint,
        background:T.surface, border:`1px solid ${T.border}`,
        borderRadius:999, padding:"1px 8px", flexShrink:0,
      }}>
        {count}
      </span>
      <span style={{ flex:1, height:1, background:T.border, borderRadius:1 }} />
    </div>
  );
}

// ── Demo clients for preview mode (admin/dev account only) ─────────────────
// Shown when isPreview=true and there are no real clients yet.
// Covers all three urgency buckets so the dashboard looks alive.
function _demoLast7(pattern) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return { date: d.toISOString().slice(0, 10), logged: pattern[i], skip: false };
  });
}

const DEMO_CLIENTS = [
  {
    id: "demo-sarah",
    name: "Sarah K.",
    email: "sarah@example.com",
    xp: 1840,
    isPro: true,
    joinedAt: new Date(Date.now() - 21 * 86400000).toISOString(),
    lastActiveDate: new Date().toISOString().slice(0, 10),
    daysSinceActive: 0,
    totalHabits: 4,
    loggedTodayCount: 3,
    habits: [
      { name: "Morning run", emoji: "🏃", streak: 11, lastLogDate: new Date().toISOString().slice(0, 10), loggedToday: true,
        recentNote: "Felt slow but pushed through. 4.2km done.", last7: _demoLast7([true,true,false,true,true,true,true]) },
      { name: "No alcohol", emoji: "🚫", streak: 18, lastLogDate: new Date().toISOString().slice(0, 10), loggedToday: true,
        recentNote: null, last7: _demoLast7([true,true,true,true,true,true,true]) },
      { name: "Journalling", emoji: "📓", streak: 4, lastLogDate: new Date().toISOString().slice(0, 10), loggedToday: true,
        recentNote: "Wrote about feeling stuck at work. Helpful.", last7: _demoLast7([false,true,true,false,true,true,true]) },
      { name: "Cold shower", emoji: "🚿", streak: 2, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,true,false,false,true,false]) },
    ],
  },
  {
    id: "demo-marcus",
    name: "Marcus T.",
    email: "marcus@example.com",
    xp: 920,
    isPro: true,
    joinedAt: new Date(Date.now() - 42 * 86400000).toISOString(),
    lastActiveDate: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
    daysSinceActive: 5,
    totalHabits: 3,
    loggedTodayCount: 0,
    habits: [
      { name: "Gym", emoji: "🏋️", streak: 0, lastLogDate: new Date(Date.now()-5*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: "Work's been mad this week, couldn't make it in.", last7: _demoLast7([true,true,true,false,false,false,false]) },
      { name: "Meal prep", emoji: "🥗", streak: 0, lastLogDate: new Date(Date.now()-5*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([true,false,true,false,false,false,false]) },
      { name: "8hrs sleep", emoji: "😴", streak: 0, lastLogDate: new Date(Date.now()-6*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([false,true,false,false,false,false,false]) },
    ],
  },
  {
    id: "demo-jamie",
    name: "Jamie R.",
    email: "jamie@example.com",
    xp: 240,
    isPro: true,
    joinedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    lastActiveDate: new Date().toISOString().slice(0, 10),
    daysSinceActive: 0,
    totalHabits: 2,
    loggedTodayCount: 2,
    habits: [
      { name: "Walk 10k steps", emoji: "🚶", streak: 2, lastLogDate: new Date().toISOString().slice(0,10), loggedToday: true,
        recentNote: "Just getting started!", last7: _demoLast7([false,false,false,false,false,true,true]) },
      { name: "No phone before 9am", emoji: "📵", streak: 2, lastLogDate: new Date().toISOString().slice(0,10), loggedToday: true,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,true,true]) },
    ],
  },
  {
    id: "demo-alex",
    name: "Alex W.",
    email: "alex@example.com",
    xp: 3200,
    isPro: true,
    joinedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    lastActiveDate: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
    daysSinceActive: 1,
    totalHabits: 5,
    loggedTodayCount: 0,
    habits: [
      { name: "Meditation", emoji: "🧘", streak: 22, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: "20 mins this morning, really focused.", last7: _demoLast7([true,true,true,true,true,true,false]) },
      { name: "Read 30 mins", emoji: "📚", streak: 8, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([false,true,true,false,true,true,false]) },
      { name: "No sugar", emoji: "🍬", streak: 4, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: "Cravings bad on Friday but held it.", last7: _demoLast7([true,false,false,true,true,true,false]) },
      { name: "Gym", emoji: "🏋️", streak: 0, lastLogDate: new Date(Date.now()-3*86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([true,false,false,false,false,false,false]) },
      { name: "Gratitude", emoji: "🙏", streak: 22, lastLogDate: new Date(Date.now()-86400000).toISOString().slice(0,10), loggedToday: false,
        recentNote: null, last7: _demoLast7([true,true,true,true,true,true,false]) },
    ],
  },
  {
    id: "demo-priya",
    name: "Priya S.",
    email: "priya@example.com",
    xp: 60,
    isPro: true,
    joinedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    lastActiveDate: null,
    daysSinceActive: null,
    totalHabits: 3,
    loggedTodayCount: 0,
    habits: [
      { name: "Morning yoga", emoji: "🧘", streak: 0, lastLogDate: null, loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,false,false]) },
      { name: "Water intake", emoji: "💧", streak: 0, lastLogDate: null, loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,false,false]) },
      { name: "Evening walk", emoji: "🌇", streak: 0, lastLogDate: null, loggedToday: false,
        recentNote: null, last7: _demoLast7([false,false,false,false,false,false,false]) },
    ],
  },
];

export function CoachApp({ onExit, isPreview, publicPreview, coachTier, isAdmin, coachOwnName }) {
  const [coachTab,       setCoachTab]       = useState("clients"); // "clients" | "you"
  const [coachScreen,    setCoachScreen]    = useState("list");
  const [selectedClient, setSelectedClient] = useState(null);
  const [data,           setData]           = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [err,            setErr]            = useState(null);
  const [coachUserId,    setCoachUserId]    = useState(null);
  const [inviteCopied,   setInviteCopied]   = useState(false);
  const [loadTimedOut,    setLoadTimedOut]   = useState(false);
  // Dismissed "X just joined" banners — keyed by client id so refetching
  // doesn't reanimate something the coach already acknowledged.
  const [dismissedToasts, setDismissedToasts] = useState(() => new Set());
  const attentionAnchorRef = useRef(null);

  const showPaywall = !isAdmin && !isPreview && !coachTier;

  useEffect(() => {
    let cancelled = false;
    let abortCtl = null;
    let timeoutId = null;

    (async () => {
      setLoadTimedOut(false);
      // Auth-screen public demo: never wait on coach-data (avoids hung fetch + ghost session issues).
      if (publicPreview) {
        setCoachUserId(null);
        setData({ clients: [], asOf: localTodayYmd() });
        setErr(null);
        setLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          setCoachUserId(null);
          if (showPaywall) { if (!cancelled) setLoading(false); return; }
          if (isPreview) {
            if (!cancelled) {
              setData({ clients: [], asOf: localTodayYmd() });
              setErr(null);
              setLoading(false);
            }
            return;
          }
          if (!cancelled) { setErr("Not signed in"); setLoading(false); }
          return;
        }
        if (!cancelled) setCoachUserId(session.user?.id || null);
        if (showPaywall) { if (!cancelled) setLoading(false); return; }

        // Preview (signed-in): bounded fetch — fall back to demo clients on timeout or error.
        if (isPreview) {
          abortCtl = new AbortController();
          timeoutId = setTimeout(() => {
            abortCtl.abort();
            if (!cancelled) setLoadTimedOut(true);
          }, 12000);
          try {
            const res = await fetch("/api/coach-data", {
              headers: { Authorization: `Bearer ${token}` },
              signal: abortCtl.signal,
            });
            clearTimeout(timeoutId);
            timeoutId = null;
            const json = await res.json().catch(() => ({}));
            if (!cancelled) {
              if (res.ok) {
                setData(json);
                setErr(null);
              } else {
                setData({ clients: [], asOf: localTodayYmd() });
                setErr(null);
              }
              setLoading(false);
            }
          } catch (e) {
            clearTimeout(timeoutId);
            timeoutId = null;
            if (!cancelled) {
              setData({ clients: [], asOf: localTodayYmd() });
              setErr(null);
              setLoading(false);
            }
          }
          return;
        }

        const res = await fetch("/api/coach-data", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok) { setErr(json.error || "Failed to load"); setLoading(false); return; }
          setData(json);
        }
      } catch (e) {
        if (!cancelled) {
          if (isPreview) {
            setData({ clients: [], asOf: localTodayYmd() });
            setErr(null);
          } else setErr(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (abortCtl) abortCtl.abort();
    };
  }, [showPaywall, isPreview, publicPreview]);

  const inviteLink = coachUserId
    ? `https://forged-sage.vercel.app/?coach=${btoa(coachUserId)}`
    : null;

  // Short 8-char code derived from coach UUID — for existing users to join via Profile.
  // Formatted as ABCD-1234 for readability. Looked up by prefix in the DB.
  const coachCode = coachUserId
    ? coachUserId.replace(/-/g, "").slice(0, 8).toUpperCase()
    : null;
  const coachCodeFormatted = coachCode ? `${coachCode.slice(0,4)}-${coachCode.slice(4,8)}` : null;

  function copyInviteLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    });
  }

  const realClients = data?.clients ?? [];
  // Public demo or preview with no roster: show packaged demo clients.
  const useDemoClients = publicPreview || (isPreview && realClients.length === 0);
  const clients = useDemoClients ? DEMO_CLIENTS : realClients;

  // ── Bucket clients into urgency groups ─────────────────────────────────
  // A client can fit several buckets — pick once, in priority order, so each
  // client appears in exactly one section and the totals add up.
  const now = Date.now();
  const HOURS_72 = 72 * 60 * 60 * 1000;
  const DAYS_7   = 7  * 24 * 60 * 60 * 1000;
  const DAY_24H  = 24 * 60 * 60 * 1000;

  const needsAttention = [];
  const newClients     = [];
  const activeWeek     = [];

  for (const c of clients) {
    // Use LOCAL dsa so AU coaches don't see "Active today" for yesterday's logs.
    const localDsa      = localDaysSince(c.lastActiveDate);
    const dsa           = localDsa !== null ? localDsa : c.daysSinceActive;
    const joinedTs      = c.joinedAt ? new Date(c.joinedAt).getTime() : null;
    const joinedRecently72h = joinedTs !== null && (now - joinedTs) <= HOURS_72;
    const joinedThisWeek    = joinedTs !== null && (now - joinedTs) <= DAYS_7;
    const isQuiet       = dsa === null ? true : dsa >= 3;
    const hasNeverLogged = dsa === null;

    if (isQuiet || (joinedRecently72h && hasNeverLogged)) {
      needsAttention.push(c);
    } else if (joinedThisWeek) {
      newClients.push(c);
    } else {
      activeWeek.push(c);
    }
  }

  needsAttention.sort((a, b) => {
    const da = localDaysSince(a.lastActiveDate) ?? 999;
    const db = localDaysSince(b.lastActiveDate) ?? 999;
    return db - da;
  });
  newClients.sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0));
  activeWeek.sort((a, b) => {
    const da = localDaysSince(a.lastActiveDate) ?? 0;
    const db = localDaysSince(b.lastActiveDate) ?? 0;
    return da - db;
  });

  // Subtitle — active = logged in last 7 days (local).
  const activeThisWeekCount = clients.filter(c => {
    const d = localDaysSince(c.lastActiveDate);
    return d !== null && d < 7;
  }).length;

  // Toast-style banners for clients who joined in the last 24 hours. Coach
  // sees one welcome ribbon per fresh signup, dismissable via tap or auto-fade.
  const justJoined = clients.filter(c => {
    if (!c.joinedAt) return false;
    const ts = new Date(c.joinedAt).getTime();
    if (Number.isNaN(ts)) return false;
    return (now - ts) <= DAY_24H && !dismissedToasts.has(c.id);
  });

  // Auto-dismiss the first joined-toast after 8s once it appears. We only
  // schedule one timer at a time and dismiss the oldest banner so the queue
  // drains predictably even if the coach doesn't tap.
  const oldestJoinedId = justJoined[0]?.id || null;
  useEffect(() => {
    if (!oldestJoinedId) return;
    const t = setTimeout(() => {
      setDismissedToasts(prev => {
        if (prev.has(oldestJoinedId)) return prev;
        const next = new Set(prev);
        next.add(oldestJoinedId);
        return next;
      });
    }, 8000);
    return () => clearTimeout(t);
  }, [oldestJoinedId]);

  function dismissJoinedToast(id) {
    setDismissedToasts(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function scrollToAttention() {
    if (attentionAnchorRef.current) {
      attentionAnchorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const firstName = coachOwnName ? coachOwnName.split(" ")[0] : "";
  const greeting  = coachGreetingForNow() + (firstName ? ` ${firstName}.` : "");
  const subtitle  = clients.length === 0
    ? null
    : `${clients.length} client${clients.length === 1 ? "" : "s"} · ${activeThisWeekCount} active this week`;
  const coachInitials = (() => {
    const parts = (coachOwnName || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "FC";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();

  // Bottom nav icon helper
  const navItem = (tab, icon, label) => {
    const active = coachTab === tab;
    return (
      <button
        key={tab}
        onClick={() => {
          setCoachScreen("list");
          setSelectedClient(null);
          setCoachTab(tab);
        }}
        style={{
          flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3,
          background:"none", border:"none", cursor:"pointer", fontFamily:T.font,
          padding:"8px 0", color: active ? T.gold : T.hint,
        }}
      >
        <span style={{ fontSize:20, lineHeight:1 }}>{icon}</span>
        <span style={{ fontSize:10, fontWeight: active ? 700 : 400, letterSpacing:"0.03em" }}>{label}</span>
      </button>
    );
  };

  return (
    <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg }}>

      {publicPreview && (
        <div style={{
          background:"linear-gradient(180deg, rgba(200,144,42,0.22), rgba(200,144,42,0.1))",
          borderBottom:`1px solid rgba(200,144,42,0.4)`,
          paddingTop: cssPadTopSafe(10), paddingBottom: 10, ...cssPadXSafe(16),
          display:"flex",
          alignItems:"center",
          justifyContent:"space-between",
          gap:12,
        }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.gold, letterSpacing:"0.02em", lineHeight:1.35 }}>
            Public demo · sample clients only · nothing is saved
          </span>
          {typeof onExit === "function" && (
            <button
              type="button"
              onClick={onExit}
              style={{
                flexShrink:0,
                fontSize:12,
                fontWeight:800,
                color:"#1a1a16",
                background:T.gold,
                padding:"8px 14px",
                borderRadius:10,
                border:"none",
                cursor:"pointer",
                fontFamily:T.font,
              }}
            >
              Exit demo
            </button>
          )}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        paddingTop: publicPreview ? 18 : cssPadTopSafe(18), paddingBottom: 14, ...cssPadXSafe(18),
        borderBottom:`0.5px solid ${T.border}`,
      }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:3, flexWrap:"wrap" }}>
              <span style={{ fontFamily:T.serif, fontSize:24, color:T.text, letterSpacing:"-0.01em", lineHeight:1.15 }}>
                {greeting}
              </span>
              <span style={{
                fontSize:9, fontWeight:700, color:"#1a1a16",
                background:T.gold, padding:"3px 8px", borderRadius:6,
                letterSpacing:"0.07em", flexShrink:0,
              }}>
                COACH{isPreview ? " · PREVIEW" : ""}
              </span>
            </div>
            <div style={{ fontSize:12, color:T.muted }}>{fmtDateLong()}</div>
            {subtitle && (
              <div style={{ fontSize:11, color:T.muted, marginTop:4, letterSpacing:"0.01em" }}>
                {subtitle}
              </div>
            )}
            {!showPaywall && coachTab === "clients" && coachScreen === "list" && (
              <button
                type="button"
                onClick={() => { setCoachScreen("list"); setSelectedClient(null); setCoachTab("you"); }}
                style={{
                  marginTop:10, display:"block", fontSize:12, fontWeight:600, color:T.gold,
                  background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:T.font,
                }}
              >
                Invite clients · share link & code →
              </button>
            )}
          </div>
          {isPreview && typeof onExit === "function" && !publicPreview && (
            <button
              type="button"
              onClick={onExit}
              style={{
                flexShrink:0,
                fontSize:11,
                fontWeight:800,
                color:"#1a1a16",
                background:T.gold,
                padding:"8px 12px",
                borderRadius:10,
                border:"none",
                cursor:"pointer",
                fontFamily:T.font,
                letterSpacing:"0.03em",
              }}
            >
              Exit preview
            </button>
          )}
        </div>
      </div>

      {/* ── Preview / demo data banner ─────────────────────────────────── */}
      {useDemoClients && (
        <div style={{
          background:"rgba(200,144,42,0.12)", borderBottom:`1px solid rgba(200,144,42,0.25)`,
          paddingTop: 9, paddingBottom: 9, ...cssPadXSafe(18), display:"flex", alignItems:"center", gap:8,
        }}>
          <span style={{ fontSize:11, fontWeight:700, color:T.gold, letterSpacing:"0.04em" }}>PREVIEW</span>
          <span style={{ fontSize:11, color:T.sub }}>· Demo data only — not real clients</span>
        </div>
      )}

      {loadTimedOut && !loading && useDemoClients && (
        <div style={{ fontSize:11, color:T.muted, padding:"6px 18px 0", lineHeight:1.45 }}>
          Showing sample clients — connection took too long. You can still explore the demo.
        </div>
      )}

      {/* ── Attention strip (clients tab, list view only) ───────────────── */}
      {!showPaywall && coachTab === "clients" && coachScreen === "list" && needsAttention.length > 0 && (
        <button
          type="button"
          onClick={scrollToAttention}
          style={{
            width:"100%", display:"flex", alignItems:"center", justifyContent:"center",
            background:"rgba(230,126,34,0.10)", border:"none", borderTop:`0.5px solid rgba(230,126,34,0.28)`,
            borderBottom:`0.5px solid rgba(230,126,34,0.18)`,
            color:T.gold, fontSize:12, fontWeight:600, fontFamily:T.font,
            padding:"10px 16px", cursor:"pointer", letterSpacing:"0.01em",
            minHeight:36,
          }}
        >
          {needsAttention.length} client{needsAttention.length === 1 ? "" : "s"} need{needsAttention.length === 1 ? "s" : ""} attention
        </button>
      )}

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div style={{ paddingBottom:80 }}>
        {showPaywall ? (
          <CoachPaywall />

        /* ── YOU (profile + invites + account) ───────────────────────────── */
        ) : coachTab === "you" ? (
          <div style={{ padding:"20px 18px 28px" }}>
            <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:20 }}>
              <div style={{
                width:56, height:56, borderRadius:16, flexShrink:0,
                background:"linear-gradient(145deg, rgba(200,144,42,0.22), rgba(200,144,42,0.06))",
                border:`1px solid rgba(200,144,42,0.35)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:18, fontWeight:700, color:T.gold, letterSpacing:"0.02em", fontFamily:T.font,
              }}>
                {coachInitials}
              </div>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontFamily:T.serif, fontSize:21, color:T.text, lineHeight:1.2 }}>
                  {coachOwnName || "Your workspace"}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:6, marginTop:8 }}>
                  <span style={{ fontSize:9, fontWeight:700, color:"#1a1a16", background:T.gold, padding:"3px 8px", borderRadius:6, letterSpacing:"0.07em" }}>
                    {coachTier ? "COACH · ACTIVE" : "COACH"}
                  </span>
                  {isPreview && (
                    <span style={{ fontSize:9, fontWeight:700, color:T.gold, background:"rgba(200,144,42,0.14)", padding:"3px 8px", borderRadius:6, letterSpacing:"0.06em", border:`1px solid rgba(200,144,42,0.3)` }}>
                      PREVIEW
                    </span>
                  )}
                </div>
                <div style={{ fontSize:12, color:T.muted, marginTop:6, lineHeight:1.45 }}>
                  {clients.length === 0
                    ? "No clients yet — share your link to fill this workspace."
                    : `${clients.length} client${clients.length === 1 ? "" : "s"} · ${activeThisWeekCount} active this week${needsAttention.length ? ` · ${needsAttention.length} need attention` : ""}`}
                </div>
              </div>
            </div>

            <div style={{
              background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"14px 16px", marginBottom:16,
            }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                Workspace pulse
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"10px 12px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:20, fontWeight:700, color:T.text, fontFamily:T.font }}>{activeThisWeekCount}</div>
                  <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>Active (7d)</div>
                </div>
                <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:"10px 12px", border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:20, fontWeight:700, color: needsAttention.length ? T.amber : T.text, fontFamily:T.font }}>{needsAttention.length}</div>
                  <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>Need attention</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setCoachTab("clients"); setCoachScreen("list"); setSelectedClient(null); }}
                style={{
                  width:"100%", marginTop:12, padding:"10px 0", borderRadius:10,
                  background:"rgba(255,255,255,0.04)", border:`1px solid ${T.border}`,
                  color:T.sub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:T.font,
                }}
              >
                Open client list →
              </button>
            </div>

            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, marginBottom:8 }}>Grow your practice</div>
            <div style={{ fontSize:13, color:T.muted, lineHeight:1.65, marginBottom:16 }}>
              Share your link — new signups land in your roster with Pro included. Existing Forged users can link with your coach code.
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
              {["Personal onboarding path for each client", "Forged Pro for every seat (up to 15)", "Habits, streaks, and notes visible as they log"].map(line => (
                <div key={line} style={{ display:"flex", alignItems:"flex-start", gap:9 }}>
                  <span style={{ color:T.gold, fontSize:12, lineHeight:1.6, flexShrink:0, fontWeight:700 }}>✓</span>
                  <span style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{line}</span>
                </div>
              ))}
            </div>
            {inviteLink ? (
              <>
                <button
                  type="button"
                  onClick={copyInviteLink}
                  style={{
                    width:"100%", padding:"14px 0", borderRadius:12, border:"none",
                    background: inviteCopied ? T.green : T.gold, color:"#1a1a16",
                    fontSize:14, fontWeight:700, fontFamily:T.font, cursor:"pointer",
                    marginBottom:12, transition:"background 0.2s",
                    boxShadow:"0 2px 14px rgba(200,144,42,0.18)",
                  }}
                >
                  {inviteCopied ? "✓ Link copied to clipboard" : "Copy invite link →"}
                </button>
                <div style={{
                  background:T.surface, border:`1px solid ${T.border}`, borderRadius:10,
                  padding:"10px 12px", fontSize:11, color:T.sub,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",
                  marginBottom:16,
                }}>
                  {inviteLink}
                </div>
              </>
            ) : (
              <div style={{ fontSize:12, color:T.muted, marginBottom:16, fontStyle:"italic" }}>
                Sign in to generate your invite link.
              </div>
            )}
            {coachCodeFormatted && (
              <div style={{
                background:T.surface, border:`1px solid ${T.border}`,
                borderRadius:12, padding:"14px 16px", marginBottom:16,
              }}>
                <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
                  Coach code · existing users
                </div>
                <div style={{ fontSize:26, fontWeight:700, color:T.text, letterSpacing:"0.14em", fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom:8 }}>
                  {coachCodeFormatted}
                </div>
                <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>
                  Enter in Profile → &ldquo;Join a coach&rdquo; to link instantly.
                </div>
              </div>
            )}
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 16px", marginBottom:24 }}>
              <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Client slots</div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:14, color:T.text }}>{clients.length} of 15 used</span>
                <span style={{ fontSize:12, color: clients.length >= 15 ? T.accent : T.green, fontWeight:600 }}>
                  {clients.length >= 15 ? "At limit" : `${15 - clients.length} remaining`}
                </span>
              </div>
              <div style={{ marginTop:8, height:4, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${Math.min(100, (clients.length/15)*100)}%`, background: clients.length >= 15 ? T.accent : T.gold, borderRadius:2, transition:"width 0.4s" }}/>
              </div>
            </div>

            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, marginBottom:12 }}>Account</div>
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, overflow:"hidden", marginBottom:16 }}>
              <div style={{ padding:"12px 16px", borderBottom:`0.5px solid ${T.border}` }}>
                <div style={{ fontSize:11, color:T.hint, marginBottom:2 }}>Display name</div>
                <div style={{ fontSize:14, color:T.text }}>{coachOwnName || "—"}</div>
              </div>
              <div style={{ padding:"12px 16px" }}>
                <div style={{ fontSize:11, color:T.hint, marginBottom:2 }}>Subscription</div>
                <div style={{ fontSize:14, color: coachTier ? T.green : T.muted }}>
                  {coachTier ? "Forged Coach · Active" : "No active plan"}
                </div>
              </div>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                width:"100%", padding:"13px 0", borderRadius:12,
                background:"rgba(231,76,60,0.08)", border:`1px solid rgba(231,76,60,0.22)`,
                color:"#E74C3C", fontSize:14, fontWeight:600,
                cursor:"pointer", fontFamily:T.font,
              }}
            >
              Sign out
            </button>
            {isPreview && (
              <button
                onClick={onExit}
                style={{
                  width:"100%", marginTop:10, padding:"13px 0", borderRadius:12,
                  background:"rgba(255,255,255,0.05)", border:`1px solid ${T.border}`,
                  color:T.muted, fontSize:14, cursor:"pointer", fontFamily:T.font,
                }}
              >
                ← Exit preview
              </button>
            )}
          </div>

        /* ── CLIENTS TAB ─────────────────────────────────────────────────── */
        ) : coachScreen === "detail" && selectedClient ? (
          <CoachClientDetail
            client={selectedClient}
            onBack={() => { setCoachScreen("list"); setSelectedClient(null); }}
            useLocalAiBrief={!COACH_SUMMARY_UUID_RE.test(String(selectedClient.id ?? ""))}
          />
        ) : (
          <div style={{ padding:"18px 16px 0" }}>
            {loading && (
              <div style={{ textAlign:"center", padding:52, color:T.muted, fontSize:13 }}>Loading clients…</div>
            )}
            {err && (
              <div style={{ textAlign:"center", padding:52, color:"#E74C3C", fontSize:13 }}>{err}</div>
            )}

            {/* Just-joined toasts (top of list) */}
            {!loading && !err && justJoined.length > 0 && justJoined.slice(0, 2).map(c => (
              <button
                key={`toast-${c.id}`}
                type="button"
                onClick={() => dismissJoinedToast(c.id)}
                title="Dismiss"
                style={{
                  width:"100%", textAlign:"left", cursor:"pointer", fontFamily:T.font, display:"block",
                  background:"linear-gradient(180deg, rgba(200,144,42,0.14), rgba(200,144,42,0.05))",
                  border:`1px solid rgba(200,144,42,0.45)`,
                  borderRadius:12, padding:"10px 14px", marginBottom:10,
                  fontSize:12, color:T.text,
                  animation:"coachToastIn 0.45s cubic-bezier(0.22,1,0.36,1) both",
                  boxShadow:"0 1px 0 rgba(200,144,42,0.15)",
                }}
              >
                <span style={{ fontWeight:700, color:T.gold }}>{c.name}</span>
                <span style={{ color:T.sub }}> just joined through your invite link</span>
                <span style={{ marginLeft:4 }}>🎉</span>
              </button>
            ))}

            {/* Empty state */}
            {!loading && !err && clients.length === 0 && (
              <div style={{ padding:"28px 16px 12px" }}>
                {/* Value headline */}
                <div style={{ textAlign:"center", marginBottom:24 }}>
                  <div style={{ fontSize:44, lineHeight:1, marginBottom:14 }}>👥</div>
                  <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, lineHeight:1.25, marginBottom:8 }}>
                    Your coaching workspace
                  </div>
                  <div style={{ fontSize:13, color:T.muted, lineHeight:1.7, maxWidth:290, margin:"0 auto" }}>
                    When clients join through your link or code, you see their habits, streaks, and notes right here — ready before every session.
                  </div>
                </div>

                {/* Value props cards */}
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
                  {[
                    { icon:"📋", title:"Full habit visibility", body:"See every habit they track, their logs, streaks, and personal notes as they write them." },
                    { icon:"✨", title:"AI pre-session brief", body:"Before each session, get an AI-generated summary of what shifted, what stalled, and what to ask." },
                    { icon:"⚡", title:"Pro included", body:"Each client you add gets Forged Pro automatically — up to 15 seats included with your plan." },
                  ].map(({ icon, title, body }) => (
                    <div key={title} style={{
                      background:T.surface, border:`1px solid ${T.border}`,
                      borderRadius:12, padding:"13px 14px",
                      display:"flex", alignItems:"flex-start", gap:12,
                    }}>
                      <span style={{ fontSize:18, flexShrink:0, lineHeight:1.4 }}>{icon}</span>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{title}</div>
                        <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>{body}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Primary CTA */}
                {inviteLink && (
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    style={{
                      width:"100%", padding:"14px 0", borderRadius:12, border:"none",
                      background:T.gold, color:"#1a1a16",
                      fontSize:14, fontWeight:700, fontFamily:T.font,
                      cursor:"pointer", marginBottom:12,
                      boxShadow:"0 2px 14px rgba(200,144,42,0.18)",
                    }}
                  >
                    {inviteCopied ? "Link copied ✓" : "Copy invite link →"}
                  </button>
                )}

                {/* Coach code — secondary path */}
                {coachCodeFormatted && (
                  <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:"13px 16px", textAlign:"center" }}>
                    <div style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
                      Or share your coach code
                    </div>
                    <div style={{ fontSize:22, fontWeight:700, color:T.text, letterSpacing:"0.14em", fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom:6 }}>
                      {coachCodeFormatted}
                    </div>
                    <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>
                      Existing Forged users can enter this in Profile → &ldquo;Join a coach&rdquo;
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Urgency-grouped client list */}
            {!loading && !err && clients.length > 0 && (
              <>
                {needsAttention.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <CoachSectionLabel label="Needs attention" count={needsAttention.length} anchorRef={attentionAnchorRef} />
                    {needsAttention.map((c, i) => (
                      <CoachClientRow
                        key={c.id} client={c}
                        accent="#E74C3C"
                        animationDelayMs={i * 30}
                        onClick={() => { setSelectedClient(c); setCoachScreen("detail"); }}
                      />
                    ))}
                  </div>
                )}

                {newClients.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <CoachSectionLabel label="New" count={newClients.length} />
                    {newClients.map((c, i) => (
                      <CoachClientRow
                        key={c.id} client={c}
                        accent={T.gold}
                        badge="NEW"
                        animationDelayMs={i * 30}
                        onClick={() => { setSelectedClient(c); setCoachScreen("detail"); }}
                      />
                    ))}
                  </div>
                )}

                {activeWeek.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <CoachSectionLabel label="Active this week" count={activeWeek.length} />
                    {activeWeek.map((c, i) => (
                      <CoachClientRow
                        key={c.id} client={c}
                        accent="#27AE60"
                        animationDelayMs={i * 30}
                        onClick={() => { setSelectedClient(c); setCoachScreen("detail"); }}
                      />
                    ))}
                  </div>
                )}

                <div style={{ fontSize:10, color:T.muted, textAlign:"center", marginTop:6, marginBottom:4 }}>
                  As of {data?.asOf ?? localTodayYmd()}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom navigation ───────────────────────────────────────────── */}
      <div style={{
        position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)",
        width:"100%", maxWidth:430,
        background: T.raised,
        borderTop:`0.5px solid ${T.border}`,
        display:"flex", alignItems:"stretch",
        paddingBottom:"env(safe-area-inset-bottom, 0px)",
        zIndex:200,
      }}>
        {navItem("clients", "👥", "Clients")}
        {navItem("you",     "👤", "You")}
      </div>
    </div>
  );
}

// ─── COACH-CLIENT WELCOME ─────────────────────────────────────────────────────
// Shown once after onboarding completes for users who arrived via a coach
// invite link. Caller is responsible for stamping
// `localStorage.forged_coach_welcome_seen = "1"` when onDone fires so this
// never reappears for the same device/account.
export function CoachWelcomeScreen({ onDone }) {
  return (
    <div style={{
      fontFamily: T.font, background: T.bg, minHeight: "100vh",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "0 26px", textAlign: "center",
      animation: "fadeIn 0.6s ease both",
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        background: "rgba(39,174,96,0.15)",
        border: "1px solid rgba(39,174,96,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 22,
      }}>
        <span style={{ fontSize: 28, color: "#27AE60", lineHeight: 1, fontWeight: 700 }}>✓</span>
      </div>

      <div style={{ fontFamily: T.serif, fontSize: 28, color: T.text, lineHeight: 1.2, marginBottom: 12 }}>
        You&rsquo;re connected.
      </div>
      <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.65, maxWidth: 280, marginBottom: 26 }}>
        Your coach can now see your habit logs and notes. They&rsquo;ll be notified you&rsquo;ve joined.
      </div>

      <div style={{ width: "100%", maxWidth: 320, height: 1, background: T.border, marginBottom: 22 }} />

      <div style={{
        width: "100%", maxWidth: 320,
        background: "linear-gradient(180deg, rgba(39,174,96,0.12), rgba(39,174,96,0.04))",
        border: "1px solid rgba(39,174,96,0.32)",
        borderRadius: 14, padding: "14px 16px",
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 24, textAlign: "left",
      }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>⚡</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
            Forged Pro &mdash; Included
          </div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.5 }}>
            Your coach has unlocked full access for you.
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        style={{
          width: "100%", maxWidth: 320,
          padding: "14px 16px", borderRadius: 12, border: "none",
          background: T.gold, color: "#1a1a16",
          fontSize: 15, fontWeight: 700, fontFamily: T.font,
          cursor: "pointer", letterSpacing: "0.01em",
        }}
      >
        Start logging &rarr;
      </button>
    </div>
  );
}
