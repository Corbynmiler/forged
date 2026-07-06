// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────
import { useState, useRef, useEffect } from "react";
import { T, COACH_ICON_OPTIONS } from "../theme.js";
import { todayStr, daysAgo, parseLocal, isSatisfiedForTodayRing, getStreak, stripJournalTitleLine, fmtEntryDate, weekStartFor } from "../utils.js";
import { Ring, SLabel, Modal, GBtn } from "../components/ui.jsx";
import {
  DailyCard, WeeklyCard, ProjectCard, LimitCard, LogCard,
  TodayGoalCard,
} from "../components/habitCards.jsx";
import { resolveArcTitle } from "../arcProofMatch.js";
import { parseReceiptStructured, ymdAddDays, deriveWeekChapterFromDays } from "../lib/arcTimeline.js";
import { ReceiptExpandedBody } from "../components/ArcTimeline.jsx";
import { getArcDayStatus, ARC_STATUS_META } from "../arcProgress.js";

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

/**
 * A single day's entry in the archive — tappable, collapsed to a scannable
 * teaser (date, title, one line of narrative). Opening one is handled by the
 * parent (DailyChapters), which owns which chapter is currently open so only
 * one detail sheet exists at a time.
 */
function DailyChapterCard({ entry, onOpen }) {
  const narrative = (entry?.structured?.narrative || entry?.summary || "").trim();
  const title = (entry?.title || "").trim();
  if (!narrative && !title) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      style={{
        display: "block", width: "100%", textAlign: "left", fontFamily: T.font,
        padding: "14px 16px", background: T.raised, borderRadius: T.r, border: `0.5px solid ${T.border}`,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.gold, letterSpacing: "0.04em" }}>{fmtEntryDate(entry.date)}</span>
        <span style={{ fontSize: 11, color: T.hint, flexShrink: 0 }}>Read →</span>
      </div>
      {title && <div style={{ fontFamily: T.serif, fontSize: 15, color: T.text, marginTop: 4, marginBottom: 4, lineHeight: 1.3 }}>{title}</div>}
      {narrative && (
        <div style={{
          fontSize: 13, color: T.sub, lineHeight: 1.55,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {narrative}
        </div>
      )}
    </button>
  );
}

/**
 * The full chapter — opened as a bottom sheet, meant to read like a real
 * journal entry rather than a data row. Sourced primarily from
 * daily_summaries (title, narrative, emotional_context, commitments,
 * xp_awarded/xp_reason — all written automatically by the nightly rollover,
 * no extra fetch). When that day also has a real evidence/receipt entry in
 * journal_entries, its full structured content (proof shown, wins, hard
 * parts, pattern, etc.) is folded in as a bonus "Evidence entry" section via
 * ReceiptExpandedBody — the same rich component the old Arc timeline used
 * for this exact purpose, reused rather than rebuilt.
 *
 * Deliberately does not fetch raw conversation_messages for this day — real,
 * clearly-scoped next step, not done here (would need a new per-day query;
 * see PREVIEW_BRANCH_HANDOFF.md).
 */
function ChapterDetailSheet({ entry, journalEntry, onClose }) {
  const narrative = (entry?.structured?.narrative || entry?.summary || "").trim();
  const title = (entry?.title || "").trim();
  const emotionalContext = typeof entry?.emotional_context === "string" ? entry.emotional_context.trim() : "";
  const commitments = Array.isArray(entry?.commitments) ? entry.commitments.filter(c => typeof c === "string" && c.trim()) : [];
  const xpReason = typeof entry?.xp_reason === "string" ? entry.xp_reason.trim() : "";
  const xp = Number.isFinite(entry?.xp_awarded) ? entry.xp_awarded : null;
  const parsedReceipt = journalEntry ? parseReceiptStructured(journalEntry.content) : null;
  const hasReceiptBody = parsedReceipt && (parsedReceipt.title || parsedReceipt.narrative || parsedReceipt.proof || parsedReceipt.wins || parsedReceipt.hardParts);

  return (
    <Modal onClose={onClose}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.gold, letterSpacing: "0.06em", marginBottom: 8 }}>
        {fmtEntryDate(entry.date)}
      </div>
      {title && <div style={{ fontFamily: T.serif, fontSize: 22, color: T.text, marginBottom: 12, lineHeight: 1.25 }}>{title}</div>}
      {narrative && <div style={{ fontSize: 14, color: T.text, lineHeight: 1.65, marginBottom: 18 }}>{narrative}</div>}

      {emotionalContext && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 5 }}>How it felt</div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.55 }}>{emotionalContext}</div>
        </div>
      )}

      {commitments.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 6 }}>What you said you&apos;d do</div>
          {commitments.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 7, fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 3 }}>
              <span style={{ color: T.hint, flexShrink: 0 }}>•</span><span>{c}</span>
            </div>
          ))}
        </div>
      )}

      {(xpReason || xp != null) && (
        <div style={{ marginBottom: hasReceiptBody ? 16 : 6, paddingTop: 14, borderTop: `0.5px solid ${T.border}` }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 5 }}>
            Companion&apos;s read{xp != null ? ` — ${xp} xp` : ""}
          </div>
          {xpReason && <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.55 }}>{xpReason}</div>}
        </div>
      )}

      {hasReceiptBody && (
        <div style={{ paddingTop: 14, borderTop: `0.5px solid ${T.border}` }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 8 }}>
            Evidence entry
          </div>
          <ReceiptExpandedBody parsed={parsedReceipt} content={journalEntry.content} />
        </div>
      )}

      <GBtn onClick={onClose}>Close</GBtn>
    </Modal>
  );
}

/**
 * Bucket a most-recent-first list of daily chapters into Monday-start
 * calendar weeks — same week boundary `weekStartFor` uses everywhere else in
 * the app (Insights, weekly briefs), so "a week" means one consistent thing
 * across screens. Input order is preserved, so output groups stay newest-first.
 */
function groupChaptersByWeek(chapters) {
  const groups = [];
  let current = null;
  for (const c of chapters) {
    const ws = weekStartFor(c.date);
    if (!current || current.weekStart !== ws) {
      current = { weekStart: ws, weekEnd: ymdAddDays(ws, 6), items: [] };
      groups.push(current);
    }
    current.items.push(c);
  }
  return groups;
}

/** Same accent gold-bar-then-fade rule the old Arc chapter panels opened with. */
function WeekAccent() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 3, height: 14, borderRadius: 2, background: T.gold, flexShrink: 0 }} />
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${T.gold}55, transparent)` }} />
    </div>
  );
}

/** Best single-line headline for a chapter — narrative's opening sentence beats a longer title. */
function chapterHeadline(entry) {
  const narrative = (entry?.structured?.narrative || entry?.summary || "").trim();
  if (narrative) {
    const first = narrative.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (first) return first;
  }
  return (entry?.title || "").trim() || null;
}

const CHAPTER_NODE = 16;

/**
 * One chapter's row in the connected spine — same visual as the old Arc
 * timeline's WeekDayJourney day rows (spine line, small filled node, date +
 * headline), just without the proof-ring/percent machinery that only made
 * sense against habit actions. Every entry rendered here already has real
 * content (DailyChapters filters out empty days), so every node reads as
 * "captured" — no partial/empty/future states to distinguish.
 */
function ChapterSpineRow({ entry, isFirst, isLast, onOpen }) {
  const headline = chapterHeadline(entry);
  const spineColor = "rgba(61,155,95,0.35)";
  return (
    <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
      <div style={{ width: 20, display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        {!isFirst ? <div style={{ width: 2, height: 6, background: spineColor, flexShrink: 0 }} /> : <div style={{ height: 4 }} />}
        <button
          type="button"
          onClick={() => onOpen(entry)}
          aria-label={`Open ${fmtEntryDate(entry.date)} chapter`}
          style={{
            width: CHAPTER_NODE, height: CHAPTER_NODE, borderRadius: "50%",
            border: "2px solid #3d9b5f", background: "rgba(61,155,95,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0, cursor: "pointer", flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 9, color: "#4ade80", fontWeight: 700, lineHeight: 1 }}>✓</span>
        </button>
        {!isLast ? <div style={{ width: 2, flex: 1, minHeight: 8, background: spineColor }} /> : null}
      </div>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        style={{
          flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
          padding: 0, cursor: "pointer", fontFamily: T.font, paddingBottom: isLast ? 4 : 14,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 500, color: T.muted, lineHeight: 1.3 }}>
          {fmtEntryDate(entry.date)}
        </div>
        {headline ? (
          <div style={{
            fontSize: 13, fontWeight: 600, color: T.text, marginTop: 2, lineHeight: 1.3,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {headline}
          </div>
        ) : null}
      </button>
    </div>
  );
}

/**
 * One week's worth of chapters: gold accent, date-range kicker, a locally
 * derived serif caption (see deriveWeekChapterFromDays — no new AI call),
 * then the connected day-spine — the same "weeks containing days" shape the
 * old Arc timeline used, minus the Arc: no fixed start date/duration to
 * number weeks against, so weeks are just calendar weeks and there's no
 * proof-ring/percent readout (nothing here is measuring habit completion).
 */
function WeekChapterGroup({ week, isCurrentWeek, isFirst, onOpen }) {
  const rangeLabel = isCurrentWeek
    ? "This week"
    : `${fmtEntryDate(week.weekStart)} – ${fmtEntryDate(week.weekEnd)}`;
  const caption = deriveWeekChapterFromDays(week.items);
  const n = week.items.length;

  return (
    <div style={{ marginTop: isFirst ? 0 : 26 }}>
      <WeekAccent />
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {rangeLabel}
      </div>
      {caption && (
        <div style={{ fontFamily: T.serif, fontSize: 19, color: T.text, lineHeight: 1.2, marginTop: 8 }}>
          {caption}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: T.sub, marginTop: caption ? 6 : 4 }}>
        {n} chapter{n === 1 ? "" : "s"} captured
      </div>
      <div style={{ marginTop: 14 }}>
        {week.items.map((entry, i) => (
          <ChapterSpineRow
            key={entry.date}
            entry={entry}
            isFirst={i === 0}
            isLast={i === week.items.length - 1}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The real daily-memory archive — replaces a single "yesterday" teaser line
 * with the actual companion-narrated history: every day the nightly
 * rollover has summarized, most recent first, grouped into calendar weeks
 * (see groupChaptersByWeek/WeekChapterGroup) the same way the old Arc
 * timeline grouped days under weeks — just without an Arc's fixed start
 * date/duration to number them against. This is Today/Noticed's real reason
 * to exist beyond habit logging — a place worth scrolling back into.
 *
 * Free accounts see the same recent window as the rest of the app's history
 * gating (last 7 days — matches HistoryModal's `daysAgo(6)` cutoff exactly,
 * so the paywall story is consistent instead of inventing a new rule here).
 * Older chapters are blurred with the same lock-and-unlock pattern already
 * used for habit history, not a separate one-off paywall design.
 */
function DailyChapters({ recentSummaries, isPro, onUpgrade, journalEntries = [] }) {
  const [openDate, setOpenDate] = useState(null);
  const today = todayStr();
  const cutoff = daysAgo(6);
  const chapters = (Array.isArray(recentSummaries) ? recentSummaries : [])
    .filter(s => s?.date && s.date !== today)
    .slice()
    .reverse(); // most recent first (source is oldest-first)
  const openEntry = openDate ? chapters.find(s => s.date === openDate) : null;
  const openJournalEntry = openDate ? journalEntries.find(e => e.date === openDate) ?? null : null;

  // Today isn't a chapter yet — it's still being written, and won't become
  // one until tonight's rollover. Naming that explicitly (rather than just
  // having the archive start at yesterday) makes the metaphor complete: this
  // isn't a report you're behind on, it's a page that fills in as the day
  // happens, no action required.
  const todayGhost = (
    <div style={{ padding: "14px 16px", borderRadius: T.r, border: `0.5px dashed ${T.borderStrong}`, marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: "0.04em", marginBottom: 4 }}>Today</div>
      <div style={{ fontSize: 12.5, color: T.hint, lineHeight: 1.5, fontStyle: "italic" }}>Still being written — talk to your companion, and tonight this becomes a chapter.</div>
    </div>
  );

  if (!chapters.length) {
    return (
      <div style={{ margin: "14px 14px 0" }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 8, padding: "0 2px" }}>
          Your companion noticed
        </div>
        {todayGhost}
      </div>
    );
  }

  const visible = isPro ? chapters : chapters.filter(s => s.date >= cutoff);
  const locked = chapters.slice(visible.length);
  const weekGroups = groupChaptersByWeek(visible);
  const thisWeekStart = weekStartFor(today);

  return (
    <div style={{ margin: "14px 14px 0" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.hint, marginBottom: 8, padding: "0 2px" }}>
        Your companion noticed
      </div>
      {todayGhost}
      {weekGroups.map((week, i) => (
        <WeekChapterGroup
          key={week.weekStart}
          week={week}
          isCurrentWeek={week.weekStart === thisWeekStart}
          isFirst={i === 0}
          onOpen={e => setOpenDate(e.date)}
        />
      ))}
      {locked.length > 0 && (
        <div style={{ position: "relative", marginTop: 8, borderRadius: T.r, overflow: "hidden" }}>
          <div style={{ filter: "blur(3px)", pointerEvents: "none", userSelect: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {locked.slice(0, 2).map(s => <DailyChapterCard key={s.date} entry={s} onOpen={() => {}} />)}
          </div>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(14,14,14,0.72)", padding: "16px" }}>
            <div style={{ fontSize: 12, color: T.text, fontWeight: 600, textAlign: "center" }}>
              {locked.length} more chapter{locked.length === 1 ? "" : "s"} in your archive
            </div>
            {onUpgrade && (
              <button type="button" onClick={onUpgrade} style={{ padding: "8px 18px", borderRadius: T.rsm, border: "none", background: T.gold, color: "#0F0F0D", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                Unlock full archive →
              </button>
            )}
          </div>
        </div>
      )}
      {openEntry && <ChapterDetailSheet entry={openEntry} journalEntry={openJournalEntry} onClose={() => setOpenDate(null)} />}
    </div>
  );
}

export function CoachGreeting({ coachName, coachIcon, habits, goals, habitAccent, onOpenMic, habitCompletionPercentage, habitsLoggedTodayCount, totalTrackables }) {
  const rawCoach = (coachName ?? "").trim();
  const hasNamedCoach = rawCoach.length > 0;
  const displayName = rawCoach || "Companion";
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

// TodayReceiptCard: when an Arc is active and we're past 7pm, this reframes as
// a Night Verdict — identity line at top, bad-day-min row, "Tomorrow's first
// proof" phrasing. Same underlying journal-generate data; no API change.
function TodayReceiptCard({ entry, loggedCount, generating, onGenerate, onOpenJournal, onOpenCoachWithDraft, activeBlock = null, hourNow = 0 }) {
  const [expanded, setExpanded] = useState(false);
  if (loggedCount === 0) return null;
  const arcActive = !!activeBlock?.id;
  const isNight = hourNow >= 19;
  const identity = arcActive ? String(activeBlock.identity || "").trim() : "";
  const minimum = arcActive ? String(activeBlock.minimumProof || "").trim() : "";
  const minHit = arcActive && loggedCount > 0 && !!minimum; // simple heuristic; refined in Phase 2
  const eyebrowLabel = arcActive ? (isNight ? "Tonight's verdict" : "Today's verdict") : "Today's receipt";
  const eyebrowColor = arcActive ? T.gold : T.hint;
  const borderColor = arcActive ? "rgba(200,144,42,0.4)" : T.border;

  if (entry) {
    const parsed = parseReceiptFields(entry.content);
    const structured = parseReceiptStructured(entry.content);
    if (!parsed) return null;
    const previewLine = parsed.pattern || parsed.tomorrow || parsed.missed || null;
    const missedStr = (parsed.missed || "").toLowerCase().trim();
    const hasMissed = missedStr && missedStr !== "none" && !missedStr.startsWith("not tracked");
    const contextDraft = hasMissed
      ? `I want to add some context on today — ${parsed.missed} didn't make it in. Here's why:`
      : null;

    if (!expanded) {
      return (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            display: "block", width: "calc(100% - 28px)", margin: "0 14px 10px", padding: "14px 16px",
            borderRadius: T.r, border: `0.5px solid ${borderColor}`, background: T.raised,
            cursor: "pointer", textAlign: "left", fontFamily: T.font, boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: eyebrowColor, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
            {eyebrowLabel}
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: T.text, fontFamily: T.serif, lineHeight: 1.35, marginBottom: previewLine ? 6 : 0 }}>
            {parsed.title}
          </div>
          {previewLine ? (
            <div style={{
              fontSize: 12, color: T.sub, lineHeight: 1.45,
              overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical",
            }}>
              {previewLine}
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>Tap to view</div>
        </button>
      );
    }

    return (
      <div style={{ margin:"0 14px 10px", borderRadius:T.r, border:`0.5px solid ${borderColor}`, background:T.raised, overflow:"hidden" }}>
        <div style={{ padding:"14px 16px 12px" }}>
          <button type="button" onClick={() => setExpanded(false)}
            style={{ display: "block", width: "100%", padding: 0, margin: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: T.font }}>
            <div style={{ fontSize:10, fontWeight:700, color:eyebrowColor, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>{eyebrowLabel}</div>
          {arcActive && identity ? (
            <div style={{ fontSize:13, color:T.sub, fontStyle:"italic", fontFamily:T.serif, marginBottom:10, lineHeight:1.45, minWidth:0, overflowWrap:"break-word", wordBreak:"break-word" }}>
              {identity}
            </div>
          ) : null}
          <div style={{ fontSize:15, fontWeight:500, color:T.text, fontFamily:T.serif, marginBottom:(parsed.pattern||parsed.tomorrow||hasMissed||minimum)?10:0, lineHeight:1.35 }}>{parsed.title}</div>
          {arcActive && minimum && (
            <div style={{ display:"flex", gap:6, marginBottom:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:11, color: minHit ? T.green : T.amber, fontWeight:700, marginTop:2, flexShrink:0 }}>{minHit ? "✓" : "·"}</span>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>
                <span style={{ color:T.muted, marginRight:4 }}>Bad-day min:</span>{minimum}
              </div>
            </div>
          )}
          <ReceiptExpandedBody parsed={structured} content={entry.content} />
          {hasMissed && onOpenCoachWithDraft && (
            <button type="button" onClick={() => onOpenCoachWithDraft(contextDraft)}
              style={{ display:"block", width:"100%", padding:"7px 10px", marginTop:2, background:"rgba(255,255,255,0.04)", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, cursor:"pointer", textAlign:"left", fontFamily:T.font }}>
              <span style={{ fontSize:12, color:T.muted }}>Gaps with no context — </span>
              <span style={{ fontSize:12, color:T.sub, fontWeight:500 }}>tell your companion why →</span>
            </button>
          )}
          </button>
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
    ? "Your companion reads the day and calls it — what counted, what slipped, what's next."
    : "Your companion writes up the day from your logs and notes";
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
function AddProofActionSheet({ activeBlock, habits, goals = [], onClose, onSelectHabit, onCreateNew }) {
  const linkable = [
    ...(habits || []).filter(h => h.habitType !== "log"),
    ...(goals || []).filter(g => g.status !== "completed"),
  ].filter(item => !(item.isProofAction === true && item.blockId === activeBlock.id));

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily: T.serif, fontSize: 20, color: T.text, marginBottom: 8 }}>Add proof action</div>
      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, marginBottom: 16 }}>
        Pick an existing habit or goal to count toward this Arc, or create a new one.
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
          No other habits or goals to link yet.
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

function ArcStatusPill({ status }) {
  const meta = ARC_STATUS_META[status] || ARC_STATUS_META.alive;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
      padding: "2px 9px 2px 7px", borderRadius: 20,
      background: `${meta.color}1F`, border: `0.5px solid ${meta.color}66`,
      fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
      color: meta.color, fontFamily: T.font, lineHeight: 1.6, whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: 9 }}>{meta.glyph}</span>{meta.label}
    </span>
  );
}

/**
 * Deliberately quiet. This used to be Noticed's hero card: a big gradient
 * background, a 22px serif Arc title, its own status badge — the exact
 * "old Forged" dominance (direction as the mandatory centre, not an
 * optional strip) this whole redesign has been working against. Same data,
 * same tap-through-to-Arc behavior, but sized and colored like a secondary
 * status line now that the companion's memory (DailyChapters, above this in
 * the render order) is what actually leads the screen.
 */
function ArcStrip({ activeBlock, onViewArc, proofTotal = 0, proofDone = 0, hour = new Date().getHours() }) {
  const { dayX, duration } = arcDayInfo(activeBlock);
  const arcTitle = resolveArcTitle(activeBlock.title, activeBlock.identity);
  const status = getArcDayStatus({ proofTotal, proofDone, hour });

  return (
    <button
      type="button"
      onClick={() => { if (onViewArc) onViewArc(); }}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        width: "calc(100% - 28px)",
        margin: "8px 14px 0",
        padding: "10px 14px",
        borderRadius: T.r,
        border: `0.5px solid ${T.border}`,
        background: T.raised,
        cursor: onViewArc ? "pointer" : "default",
        textAlign: "left",
        fontFamily: T.font,
        boxSizing: "border-box",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: T.hint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>
          Direction · Day {dayX} of {duration}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T.text, lineHeight: 1.3, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {arcTitle}
        </div>
      </div>
      {proofTotal > 0 && <ArcStatusPill status={status} />}
    </button>
  );
}

// Plain text-only nudge — no pills, no per-habit action list. The rest-day
// button lives on each proof action's own card (see habitCards.jsx); this
// card just names the option.
function DriftCard({ activeBlock, onClose }) {
  const minimum = (activeBlock?.minimumProof || "").trim();

  return (
    <div style={{
      margin: "0 14px 10px", padding: "13px 14px", borderRadius: T.r,
      border: `0.5px solid ${T.border}`, background: T.surface,
      fontFamily: T.font, boxSizing: "border-box",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: T.text, marginBottom: 4 }}>
            Feeling off today?
          </div>
          <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5 }}>
            {minimum
              ? <>Minimum still counts: <span style={{ color: T.text, fontWeight: 500 }}>{minimum}</span></>
              : "One small piece of proof still saves today — or take the rest day on whichever habit needs it."}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          style={{
            flexShrink: 0, border: "none", background: "none", color: T.muted, fontSize: 15,
            cursor: "pointer", fontFamily: T.font, lineHeight: 1,
            width: 40, height: 40, margin: "-8px -8px 0 0",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ✕
        </button>
      </div>
    </div>
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

function ReorderProofSheet({ habits, onClose, onSave }) {
  const [items, setItems] = useState(habits);
  const dragIdx = useRef(null);

  function onDragStart(i) { dragIdx.current = i; }
  function onDragEnter(i) {
    if (dragIdx.current === null || dragIdx.current === i) return;
    setItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx.current, 1);
      next.splice(i, 0, moved);
      dragIdx.current = i;
      return next;
    });
  }
  function onDragEnd() { dragIdx.current = null; }

  // Touch drag support
  const touchStartY = useRef(0);
  const touchDragIdx = useRef(null);
  function onTouchStart(e, i) {
    touchStartY.current = e.touches[0].clientY;
    touchDragIdx.current = i;
    dragIdx.current = i;
  }
  function onTouchMove(e) {
    e.preventDefault();
    const el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    const idx = el?.closest("[data-drag-idx]")?.dataset?.dragIdx;
    if (idx != null) onDragEnter(Number(idx));
  }
  function onTouchEnd() { dragIdx.current = null; touchDragIdx.current = null; }

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1200, display:"flex", flexDirection:"column", justifyContent:"flex-end" }} onClick={onClose}>
      <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(4px)" }}/>
      <div
        onClick={e => e.stopPropagation()}
        style={{ position:"relative", background:T.bg, borderRadius:"20px 20px 0 0", padding:"0 0 max(24px,env(safe-area-inset-bottom,0px))", fontFamily:T.font, maxHeight:"80vh", overflowY:"auto" }}
      >
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 18px 12px" }}>
          <span style={{ fontSize:16, fontWeight:700, color:T.text }}>Edit order</span>
          <button type="button" onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <p style={{ margin:"0 18px 14px", fontSize:12, color:T.muted, lineHeight:1.5 }}>Drag to rearrange your proof actions.</p>
        <div style={{ padding:"0 14px" }}>
          {items.map((h, i) => (
            <div
              key={h.id}
              data-drag-idx={i}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragEnter={() => onDragEnter(i)}
              onDragEnd={onDragEnd}
              onDragOver={e => e.preventDefault()}
              onTouchStart={e => onTouchStart(e, i)}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              style={{
                display:"flex", alignItems:"center", gap:12,
                padding:"12px 14px", marginBottom:8,
                background:T.surface, borderRadius:T.rsm,
                border:`0.5px solid ${T.border}`,
                cursor:"grab", userSelect:"none", touchAction:"none",
              }}
            >
              <span style={{ color:T.muted, fontSize:18, lineHeight:1 }}>☰</span>
              <span style={{ flex:1, fontSize:14, fontWeight:500, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{h.name}</span>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, padding:"14px 14px 0" }}>
          <button type="button" onClick={onClose}
            style={{ flex:1, padding:"13px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontFamily:T.font, fontSize:14, fontWeight:600, cursor:"pointer" }}>
            Cancel
          </button>
          <button type="button" onClick={() => onSave(items)}
            style={{ flex:2, padding:"13px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontFamily:T.font, fontSize:14, fontWeight:700, cursor:"pointer" }}>
            Save order
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TodayScreen ────────────────────────────────────────────────────────────
export function TodayScreen({
  habits, goals = [],
  onTap, onUndo, onSkip, onAddNote, onLogZero, onOpenLog,
  onOpenGoalLog, onEditGoal, onCompleteGoal, onDeleteGoal, onShareGoal,
  onEditHabit, onDeleteHabit, onShareHabit, sharingHabitId,
  onAdd, onSaveLogEntry,
  onOpenCoachMic, onOpenCoachWithDraft,
  coachName, coachIcon, coachHabitColor, onOpenGoalDetail,
  onLowerBudget = null,
  todayJournalEntry = null,
  onGenerateReceipt = null,
  generatingReceipt = false,
  onOpenJournal = null,
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
  onViewArc = null,
  onLinkProofHabit = null,
  onUnlinkProofItem = null,
  onOpenHub = null,
  recentSummaries = [],
  isPro = false,
  onUpgrade = null,
  journalEntries = [],
}) {
  const [showProofPicker, setShowProofPicker] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const [proofOrder, setProofOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem("forged_proof_order") || "null") || null; } catch { return null; }
  });
  const [justCompleted, setJustCompleted] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);
  const [driftDismissedDate, setDriftDismissedDate] = useState(() => {
    try { return localStorage.getItem("forged_drift_dismissed_date") || null; } catch { return null; }
  });
  const prevProofDoneRef = useRef(null);

  const activeGoals    = goals.filter(g => g.status !== "completed");
  const trackHabits    = habits.filter(h => h.habitType !== "log");
  const logHabits      = habits.filter(h => h.habitType === "log");
  const arcActive      = !!activeBlock?.id;
  const { dayX: arcDayX } = arcActive ? arcDayInfo(activeBlock) : { dayX: 1 };
  const proofHabits    = arcActive
    ? trackHabits.filter(h => isProofForArc(h, activeBlock.id))
    : [];
  const proofGoals     = arcActive
    ? activeGoals.filter(g => isProofForArc(g, activeBlock.id))
    : [];
  const proofItems     = [...proofHabits, ...proofGoals];
  const otherTrackHabits = arcActive
    ? trackHabits.filter(h => !isProofForArc(h, activeBlock.id))
    : trackHabits;
  const proofItemsSorted = proofOrder
    ? [...proofItems].sort((a, b) => {
        const ai = proofOrder.indexOf(a.id);
        const bi = proofOrder.indexOf(b.id);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
    : proofItems;
  const proofHabitsSorted = proofItemsSorted.filter(h => h.habitType !== "goal");
  const proofDone      = proofItems.filter(h => isSatisfiedForTodayRing(h)).length;
  const proofTotal     = proofItems.length;
  const arcDayComplete = arcActive && proofTotal > 0 && proofDone === proofTotal;

  useEffect(() => {
    if (!arcActive || proofTotal <= 0) {
      prevProofDoneRef.current = proofDone;
      return;
    }
    const prev = prevProofDoneRef.current;
    if (prev != null && prev < proofTotal && proofDone === proofTotal) {
      setJustCompleted(true);
      const t = setTimeout(() => setJustCompleted(false), 1400);
      prevProofDoneRef.current = proofDone;
      return () => clearTimeout(t);
    }
    prevProofDoneRef.current = proofDone;
  }, [arcActive, proofDone, proofTotal]);
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
  // Replaces the old separate CoachGreeting mini-header (icon + name + its
  // own status line) sitting right above this same ring — two components
  // independently describing "how's today going" was the exact redundancy
  // this redesign is trying to remove. buildCoachGreetingLine carries real,
  // specific signal (goal deadlines, streaks, skip-day patterns) the ring's
  // own plain `ringSummary` doesn't compute, so it becomes the ring's
  // subtitle instead of a second header, rather than being dropped.
  const smartGreetingLine = !arcActive ? buildCoachGreetingLine({ habits, goals }) : null;
  const habitsForSections = arcActive ? otherTrackHabits : habits;
  const daily   = habitsForSections.filter(h => h.habitType === "daily");
  const limit   = habitsForSections.filter(h => h.habitType === "limit");
  const weekly  = habitsForSections.filter(h => h.habitType === "weekly");
  const project = habitsForSections.filter(h => h.habitType === "project");
  const proofDaily   = proofHabitsSorted.filter(h => h.habitType === "daily");
  const proofLimit   = proofHabitsSorted.filter(h => h.habitType === "limit");
  const proofWeekly  = proofHabitsSorted.filter(h => h.habitType === "weekly");
  const proofProject = proofHabitsSorted.filter(h => h.habitType === "project");
  const ringSummary = arcActive
    ? (proofTotal ? `${proofDone} of ${proofTotal} proof actions` : "")
    : totalTrackables
      ? `${loggedCount} of ${totalTrackables} logged`
      : logHabits.length
        ? "Logs below — ring is for habits & goals"
        : "";
  const today = todayStr();
  const arcStatus = arcActive && proofTotal > 0 ? getArcDayStatus({ proofTotal, proofDone, hour: hr }) : null;
  const proofIncomplete = arcActive && proofTotal > 0 && proofDone < proofTotal;
  const driftDismissedToday = driftDismissedDate === today;
  const showDriftCard = proofIncomplete && !driftDismissedToday && (arcStatus === "at_risk" || driftOpen);
  function dismissDrift() {
    setDriftOpen(false);
    setDriftDismissedDate(today);
    try { localStorage.setItem("forged_drift_dismissed_date", today); } catch { /* ignore */ }
  }
  function reopenDrift() {
    setDriftOpen(true);
    setDriftDismissedDate(null);
    try { localStorage.removeItem("forged_drift_dismissed_date"); } catch { /* ignore */ }
  }
  const ringCenterMain = arcActive && proofTotal > 0 ? `${proofDone}/${proofTotal}` : undefined;
  const ringCenterSub = arcActive && proofTotal > 0 ? "proof" : undefined;
  const doneTasksCount = tasks.filter(t => t.done).length;
  const totalTasksCount = tasks.length;

  if (habits.length === 0 && activeGoals.length === 0) return (
    <div>
      <DailyChapters recentSummaries={recentSummaries} isPro={isPro} onUpgrade={onUpgrade} journalEntries={journalEntries} />
      {onOpenCoachMic && !arcActive && <CoachGreeting coachName={coachName} coachIcon={coachIcon} habits={habits} goals={goals} habitAccent={coachHabitColor} onOpenMic={onOpenCoachMic} habitCompletionPercentage={pct} habitsLoggedTodayCount={loggedCount} totalTrackables={totalTrackables}/>}
      <div style={{ padding:"40px 28px 32px", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚒️</div>
        <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:10 }}>Tell your companion what's going on</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:28 }}>
          Talk about what's actually happening in your life. If there's a real change worth committing to, your companion can shape it into a bounded Arc with proof actions — but that's one outcome, not the only way in.
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
          <button onClick={onOpenCoachMic || onAdd} style={{ padding:"13px 24px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Talk to your companion</button>
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
              Not sure what to track? Ask your companion
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <style>{`@keyframes todayCompleteIn { from { opacity: 0.55; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }`}</style>
      <DailyChapters recentSummaries={recentSummaries} isPro={isPro} onUpgrade={onUpgrade} journalEntries={journalEntries} />
      {!activeBlock && typeof onStartArc === "function" && (
        <button
          type="button"
          onClick={onStartArc}
          style={{
            display: "block",
            width: "calc(100% - 28px)",
            margin: "8px 14px 0",
            padding: "14px 16px",
            borderRadius: T.r,
            border: `0.5px solid ${T.border}`,
            background: T.raised,
            cursor: "pointer",
            textAlign: "left",
            fontFamily: T.font,
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Optional — long-term direction
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.serif, fontSize: 18, color: T.text, lineHeight: 1.2, marginBottom: 6 }}>
                Want to set a season?
              </div>
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
                An Arc is a bounded stretch of change with proof actions — pick one if there's a real outcome you're working toward. Not required to use Forged day to day.
              </div>
            </div>
            <div style={{ flexShrink: 0, alignSelf: "center", fontSize: 12, fontWeight: 700, color: T.gold }}>
              Set a direction →
            </div>
          </div>
        </button>
      )}
      {arcActive && <ArcStrip activeBlock={activeBlock} onViewArc={onViewArc} proofTotal={proofTotal} proofDone={proofDone} hour={hr} />}
      {showProofPicker && activeBlock && (
        <AddProofActionSheet
          activeBlock={activeBlock}
          habits={habits}
          goals={goals}
          onClose={() => setShowProofPicker(false)}
          onSelectHabit={async (id) => {
            setShowProofPicker(false);
            if (onLinkProofHabit) await onLinkProofHabit(id);
          }}
          onCreateNew={() => { setShowProofPicker(false); onAdd?.(); }}
        />
      )}
      {showReorder && proofItems.length > 0 && (
        <ReorderProofSheet
          habits={proofItemsSorted}
          onClose={() => setShowReorder(false)}
          onSave={(ordered) => {
            const ids = ordered.map(h => h.id);
            setProofOrder(ids);
            try { localStorage.setItem("forged_proof_order", JSON.stringify(ids)); } catch { /* ignore */ }
            setShowReorder(false);
          }}
        />
      )}
      {showDriftCard && (
        <DriftCard
          activeBlock={activeBlock}
          onClose={dismissDrift}
        />
      )}
      {proofIncomplete && !showDriftCard && (
        <button
          type="button"
          onClick={reopenDrift}
          style={{
            display: "block", margin: "0 14px 0", padding: "10px 0",
            border: "none", background: "none", cursor: "pointer",
            fontFamily: T.font, fontSize: 12, fontWeight: 600, color: T.muted,
            textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: "rgba(168,164,156,0.4)",
            minHeight: 40, textAlign: "left",
          }}
        >
          Feeling off today? →
        </button>
      )}
      <div data-tour="today-summary" style={{
        margin:"6px 14px 12px", background:T.raised, borderRadius:T.r,
        border:`0.5px solid ${arcDayComplete ? "rgba(200,144,42,0.35)" : T.border}`,
        padding:"18px 20px", display:"flex", alignItems:"center", gap:18,
      }}>
        <Ring pct={pct} centerMain={ringCenterMain} centerSub={ringCenterSub}/>
        <div style={{ flex:1, minWidth:0 }}>
          {arcDayComplete ? (
            <>
              <div style={{
                fontFamily:T.serif, fontSize:20, color:T.gold, marginBottom:4, lineHeight:1.3,
                animation: justCompleted ? "todayCompleteIn 0.55s ease-out" : undefined,
              }}>
                Today is complete.
              </div>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.45 }}>
                {proofTotal} {proofTotal === 1 ? "piece" : "pieces"} of proof. Day {arcDayX} is on the record.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontFamily:T.serif, fontSize:arcActive && activeBlock?.identity ? 18 : 20, color:T.text, marginBottom:4, lineHeight:1.35, minWidth:0, overflowWrap:"break-word", wordBreak:"break-word" }}>
                {arcActive && activeBlock?.identity
                  ? String(activeBlock.identity).trim()
                  : (!arcActive && pct === 100 && totalTrackables > 0 ? "Forged for today" : greeting)}
              </div>
              <div style={{ fontSize:13, color:T.muted }}>
                {arcActive ? `Day ${arcDayX} · ${ringSummary || "show proof"}` : (smartGreetingLine || ringSummary || " ")}
              </div>
            </>
          )}
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
                  <div style={{ fontSize:14, fontWeight:500, color:T.text, marginBottom:2 }}>Set a goal with your companion</div>
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
              <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>Pick three to five habits or goals that prove who you&apos;re becoming.</div>
            </div>
            <div style={{ fontSize:16, color:T.accent, flexShrink:0 }}>→</div>
          </button>
        );

        const proofSection = arcActive && (
          proofTotal === 0
            ? <div key="proof-empty">{proofSyncCard || proofEmptyCard}</div>
            : <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 14px", marginBottom:6 }}>
                  <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.08em", color:T.sub, textTransform:"uppercase" }}>Proof actions</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {onOpenHub && (
                      <button
                        type="button"
                        onClick={onOpenHub}
                        aria-label="Open Hub — all habits, goals, and loose ends"
                        style={{ fontSize:11, fontWeight:600, color:T.gold, background:"rgba(200,144,42,0.1)", border:"0.5px solid rgba(200,144,42,0.3)", borderRadius:20, padding:"3px 10px", cursor:"pointer", letterSpacing:"0.04em", fontFamily:T.font }}
                      >Hub →</button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowReorder(true)}
                      style={{ fontSize:11, fontWeight:600, color:T.muted, background:"rgba(255,255,255,0.06)", border:"0.5px solid rgba(255,255,255,0.1)", borderRadius:20, padding:"3px 10px", cursor:"pointer", letterSpacing:"0.04em", fontFamily:T.font }}
                    >Edit order</button>
                  </div>
                </div>
                {proofItemsSorted.map(h => {
                  if (h.habitType === "daily")   return <DailyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id} proofMode={true} onUnlinkProof={onUnlinkProofItem}/>;
                  if (h.habitType === "limit")   return <LimitCard key={h.id} habit={h} onTap={onTap} onUndo={onUndo} onLogZero={onLogZero} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id} onLowerBudget={onLowerBudget} onOpenCoachWithDraft={onOpenCoachWithDraft} proofMode={true} onUnlinkProof={onUnlinkProofItem}/>;
                  if (h.habitType === "weekly")  return <WeeklyCard key={h.id} habit={h} onTap={onTap} onSkip={onSkip} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id} proofMode={true} onUnlinkProof={onUnlinkProofItem}/>;
                  if (h.habitType === "project") return <ProjectCard key={h.id} habit={h} onOpenLog={onOpenLog} onAddNote={onAddNote} onEditHabit={onEditHabit} onDeleteHabit={onDeleteHabit} onShareHabit={onShareHabit} sharingThisHabit={sharingHabitId===h.id} proofMode={true} onUnlinkProof={onUnlinkProofItem}/>;
                  if (h.habitType === "goal")    return <TodayGoalCard key={h.id} goal={h} onOpenLog={onOpenGoalLog} onEdit={onEditGoal} onComplete={onCompleteGoal} onDelete={onDeleteGoal} onShareGoal={onShareGoal} onOpen={onOpenGoalDetail} onUnlinkProof={onUnlinkProofItem}/>;
                  return null;
                })}
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
        // Without an active Arc, the habit/goal grid used to render fully
        // open, always — the single biggest remaining "habit tracker"
        // signal on this screen. Wrapping it in one collapsed-by-default
        // section (reusing the same SectionCollapsible pattern already used
        // for Goals/Other-habits when an Arc IS active) turns it into
        // something you open on purpose to log, not the page's default
        // dominant content — the ring above already gives the at-a-glance
        // status without needing the full grid visible.
        const trackedInner = [goalsSection, ...legacyHabitSections, logsSection].filter(Boolean);
        const trackedSection = trackedInner.length > 0
          ? <SectionCollapsible key="tracked" label={`Today's log${ringSummary ? ` — ${ringSummary}` : ""}`} defaultOpen={false}>{trackedInner}</SectionCollapsible>
          : null;

        const sections = arcActive
          ? [proofSection, logsSection].filter(Boolean)
          : [trackedSection].filter(Boolean);

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
          their other habits, goals, and loose ends. Surfaces a count so it's
          obvious there's more than just the proof list. */}
      {arcActive && onOpenHub && (() => {
        const hiddenHabits = otherTrackHabits.length;
        const hiddenGoals = Math.max(0, activeGoals.length - proofGoals.length);
        const hiddenTasks = tasks.length;
        const arcParts = [];
        if (hiddenHabits > 0) arcParts.push(`${hiddenHabits} habit${hiddenHabits === 1 ? "" : "s"}`);
        if (hiddenGoals > 0) arcParts.push(`${hiddenGoals} goal${hiddenGoals === 1 ? "" : "s"}`);
        const tasksLabel = hiddenTasks > 0 ? `${hiddenTasks} quick task${hiddenTasks === 1 ? "" : "s"}` : "";
        const hubLabel = arcParts.length > 0
          ? `${arcParts.join(" & ")} not in this Arc${tasksLabel ? `, ${tasksLabel}` : ""}`
          : (tasksLabel || "Everything outside this Arc");
        return (
          <button
            type="button"
            onClick={onOpenHub}
            style={{
              display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between",
              width: "calc(100% - 28px)", margin: "10px 14px 0",
              padding: "13px 16px", borderRadius: T.r,
              background: "rgba(200,144,42,0.07)", border: `0.5px solid rgba(200,144,42,0.3)`,
              cursor: "pointer", fontFamily: T.font, textAlign: "left", boxSizing: "border-box",
            }}
            aria-label="Open Hub — all habits, goals, and loose ends"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>🗂️</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Hub</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
                  {hubLabel}
                </div>
              </div>
            </div>
            <span style={{ fontSize: 14, color: T.gold, fontWeight: 700, flexShrink: 0 }}>→</span>
          </button>
        );
      })()}
      <div style={{ height:16 }}/>
    </div>
  );
}
