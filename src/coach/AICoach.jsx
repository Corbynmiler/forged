import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { T, COACH_ICON_OPTIONS, CREATOR_ID, HABIT_TYPES, FREE_DAILY_LIMIT } from "../theme.js";
import {
  detectsArcEditIntent,
  formatCoachChatDisplay,
  arcDurationWeeksLabel,
  resolveArcTitle,
} from "../arcProofMatch.js";
import { getArcDayNumber, getArcDurationDays, isProofHabitForBlock } from "../arcProgress.js";
import { supabase, rowToHabit, rowToGoal } from "../supabase.js";
import {
  todayStr, daysAgo,
  getStreak, getWeeklyCount, isSatisfiedForTodayRing,
  fmtGoalDueHuman,
  getProjectStats, getBuildDayMinutes, getLimitDayTotal,
  getLatestValue,
  isLegacyProgressType,
  splitCoachReceipt, parseGoalPlan, stripPartialGoalPlan,
} from "../utils.js";
import { useCoachTts } from "../hooks/useCoachTts.jsx";
import {
  useSpeechInput, MicBtn, mergeDictationIntoText, polishInterimDisplay,
  speechUnsupportedHelpMessage, shouldDeferCoachMicAutoStart, copyForgedUrlToClipboard,
  isLikelyHomeScreenPwa,
} from "../hooks/useSpeechInput.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";

export function CoachBar({
  coachName, coachIcon, habitColor, onOpenMic, onOpenText, coachEverOpened,
  isListening = false, listeningInterim = "",
  speechError = "", micBlocked = false, errorDismissed = false, onDismissError,
  onTryAgain, onCopyLink, copyLinkConfirm = "", onTypeInstead, reserveRightPx = 0,
}) {
  const suppressClickRef = useRef(false);
  const coachLabelRaw = (coachName ?? "").trim() || "Coach";
  const micColor = habitColor || T.accent;
  const initial = coachLabelRaw.charAt(0).toUpperCase();
  const hasMicIssue = !!(speechError || micBlocked);
  const showMicIssue = hasMicIssue && !errorDismissed;
  const issueText = speechError
    || (micBlocked ? "Microphone blocked. Allow the mic for this site in Settings, then try again." : "");
  const showFallbackActions = showMicIssue && (onTryAgain || onCopyLink || onTypeInstead);
  const actionBtn = {
    fontSize:10, fontWeight:600, borderRadius:7, padding:"5px 9px", cursor:"pointer", lineHeight:1.2,
  };

  function handleMicActivate() {
    onOpenMic?.();
  }
  // When listening: mic button glows red with a pulsing animation to signal recording
  const micBg = isListening
    ? `linear-gradient(145deg, #E74C3C88 0%, #E74C3C55 55%, #C0392B 100%)`
    : `linear-gradient(145deg, ${micColor}35 0%, ${micColor}12 55%, ${T.raised} 100%)`;
  const micBorderColor = isListening ? "#E74C3Ccc" : `${micColor}88`;
  const micIconColor = isListening ? "#ff6b6b" : micColor;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, fontFamily:T.font }}>
    {showMicIssue && issueText ? (
      <div
        role="alert"
        style={{
          padding:`6px ${Math.max(8, reserveRightPx)}px 7px 8px`,
          borderRadius:10,
          background:"rgba(24,24,22,0.96)",
          border:`0.5px solid ${T.accent}33`,
          fontSize:10.5,
          lineHeight:1.4,
          color:T.sub,
          position:"relative",
          zIndex:1,
        }}
      >
        <div style={{ display:"flex", alignItems:"flex-start", gap:6, paddingRight: reserveRightPx > 0 ? 0 : undefined }}>
          <div style={{ flex:1, minWidth:0, color:T.accent, fontSize:10.5, lineHeight:1.4 }}>{issueText}</div>
          {onDismissError ? (
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss microphone message"
              style={{
                flexShrink:0, width:26, height:26, marginTop:-2,
                border:`0.5px solid ${T.border}`,
                borderRadius:7, background:T.raised,
                color:T.text, fontSize:15, lineHeight:1, cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        {copyLinkConfirm ? (
          <div style={{ fontSize:10, color:T.gold, marginTop:5, lineHeight:1.35 }}>{copyLinkConfirm}</div>
        ) : null}
        {showFallbackActions ? (
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:6 }}>
            {onTryAgain ? (
              <button type="button" onClick={onTryAgain}
                style={{ ...actionBtn, color:T.text, background:T.raised, border:`0.5px solid ${T.borderStrong}` }}>
                Try again
              </button>
            ) : null}
            {onCopyLink ? (
              <button type="button" onClick={onCopyLink}
                style={{ ...actionBtn, color:T.gold, background:"rgba(200,144,42,0.10)", border:`0.5px solid ${T.gold}44` }}>
                Copy link
              </button>
            ) : null}
            {onTypeInstead ? (
              <button type="button" onClick={onTypeInstead}
                style={{ ...actionBtn, color:T.sub, background:"transparent", border:`0.5px solid ${T.border}` }}>
                Type instead
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null}
    <div
      data-tour="coach-fab"
      style={{
        position:"relative",
        display:"flex", alignItems:"center",
        minHeight:52,
        padding:"8px 10px",
        background:T.surface,
        borderTop:`0.5px solid ${isListening ? "#E74C3C55" : showMicIssue ? `${T.accent}55` : T.border}`,
        borderRadius:20,
        boxShadow: isListening
          ? "0 -4px 24px rgba(231,76,60,0.28)"
          : "0 -4px 20px rgba(0,0,0,0.35)",
        transition:"box-shadow 0.2s, border-top-color 0.2s",
      }}
    >
      <button
        type="button"
        onClick={() => onOpenText?.()}
        aria-label={`Open chat with ${coachLabelRaw}`}
        title="Open chat"
        style={{
          flex:1, display:"flex", justifyContent:"flex-start", alignItems:"center", minWidth:0,
          background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:T.font, textAlign:"left",
        }}
      >
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
      </button>
      <button
        type="button"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (e.pointerType === "touch") return;
          suppressClickRef.current = true;
          window.setTimeout(() => { suppressClickRef.current = false; }, 400);
          e.preventDefault();
          handleMicActivate();
        }}
        onTouchEnd={(e) => {
          suppressClickRef.current = true;
          window.setTimeout(() => { suppressClickRef.current = false; }, 400);
          if (e.cancelable) e.preventDefault();
          handleMicActivate();
        }}
        onClick={(e) => {
          e.preventDefault();
          if (suppressClickRef.current) return;
          handleMicActivate();
        }}
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
          touchAction:"manipulation",
          WebkitTapHighlightColor:"transparent",
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
      <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"flex-end", gap:3, minWidth:44 }}>
        <button
          type="button"
          onClick={() => onOpenText?.()}
          aria-label={`${coachLabelRaw} — open chat`}
          title="Open chat"
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
        <span style={{ fontSize:9, fontWeight:600, color:T.muted, letterSpacing:"0.04em", lineHeight:1 }}>Chat</span>
      </div>
    </div>
    </div>
  );
}
function habitLogLineForCoach(h, today) {
  const type = HABIT_TYPES[h.habitType]?.label || h.habitType;
  const loggedToday = h.logs.some(l => l.date === today && (
    l.value === true || (typeof l.value === "number") || (l.value?.minutes > 0) || l.value === "skip"
  ));
  return `- [id:${h.id}] ${h.emoji || ""} ${h.name} (${type}, logged today: ${loggedToday})`;
}

/**
 * Arc identity block — STABLE part of the system prompt. Changes at most once
 * per day (day counter), so it lives in the cached prefix.
 */
function buildArcStableBlock(activeBlock) {
  if (!activeBlock?.id) return "";
  const duration = getArcDurationDays(activeBlock);
  const dayNum = getArcDayNumber(activeBlock);
  const weeksTotal = Math.max(1, Math.ceil(duration / 7));
  const weekNum = Math.min(weeksTotal, Math.max(1, Math.ceil(dayNum / 7)));
  const dash = "—";
  const arcTitle = resolveArcTitle(activeBlock.title, activeBlock.identity);

  return `─── ACTIVE ARC ───
Arc ID: ${activeBlock.id}
Title: ${arcTitle}
Day ${dayNum} of ${duration} (${arcDurationWeeksLabel(duration)}, week ${weekNum} of ${weeksTotal})
Started: ${activeBlock.startDate}
Direction: ${activeBlock.identity}
Why it matters: ${(activeBlock.whyStatement || "").trim() || dash}
Old pattern to weaken: ${(activeBlock.oldPattern || "").trim() || dash}
Bad-day minimum proof: ${(activeBlock.minimumProof || "").trim() || dash}

ARC RULES FOR THIS CHAT:
- Proof actions are the main focus during an active Arc. Other habits are secondary.
- When they mention something that matches a proof action, log that habit with log_habit. Do not mark non-proof habits as proof.
- If the user explicitly asks to create a proof action for this Arc (e.g. "I want to add a new proof action for this Arc"), use create_habit with is_proof_action:true and block_id set to the Arc ID above. Do NOT attach is_proof_action to unrelated habit requests.
- If they ask to change Arc title, identity, proof list, or minimum: do NOT pretend to edit here. Tell them to tap "Edit my Arc" (or you will route them).
- Arc length (weeks/days) CANNOT be changed after the Arc has started. If they ask to shorten/lengthen the Arc, say duration is locked for this Arc — they can still edit the fields above.
- If they ask "what is my Arc" or "summarise my Arc", answer from this block in plain language.

Use Arc context with restraint. When they win, name once — lightly — what that proves. When they drift, name the old pattern once, no lecture.

NEVER say: "future you", "the warrior in you", "the elite version", "your journey", "stay strong king/queen", or motivational-guru phrasing.

`;
}

/**
 * Arc proof status — VOLATILE part (changes whenever the user logs).
 */
function buildArcStatusBlock(activeBlock, habits) {
  if (!activeBlock?.id) return "";
  const today = todayStr();
  const trackHabits = habits.filter(h => h.habitType !== "log");
  const proofHabits = trackHabits.filter(h => isProofHabitForBlock(h, activeBlock.id));
  const otherHabits = trackHabits.filter(h => !isProofHabitForBlock(h, activeBlock.id));
  const proofDone = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const proofTotal = proofHabits.length;

  const proofList = proofHabits.length
    ? proofHabits.map(h => habitLogLineForCoach(h, today)).join("\n")
    : "(none linked yet)";
  const otherList = otherHabits.length
    ? otherHabits.map(h => habitLogLineForCoach(h, today)).join("\n")
    : "(none)";

  return `─── ARC STATUS RIGHT NOW ───
Proof actions today: ${proofDone} of ${proofTotal}.

PROOF ACTIONS (log these with log_habit when the user did them — they drive Arc progress):
${proofList}

OTHER HABITS (still loggable — secondary, NOT Arc proof):
${otherList}

`;
}

function isHabitLoggedToday(h, today) {
  return (h.logs || []).some(l => l.date === today && (
    l.value === true || (typeof l.value === "number") || (l.value?.minutes > 0) || l.value === "skip"
  ));
}

function buildTodaySnapshot(habits, goals, today) {
  const trackable = (habits || []).filter(h => h.habitType !== "log");
  const logged = [];
  const pending = [];
  for (const h of trackable) {
    const label = `${h.emoji ? h.emoji + " " : ""}${h.name}`;
    (isHabitLoggedToday(h, today) ? logged : pending).push(label);
  }
  for (const g of (goals || [])) {
    const hit = (g.logs || []).some(l => l.date === today && typeof l.value === "number");
    if (hit) logged.push(`${g.emoji ? g.emoji + " " : ""}${g.name} (goal)`);
  }
  // Phrase the snapshot so the model treats it as authoritative over any
  // greeting/history language about "days since" or "silent" gaps — those
  // strings can persist in the message thread after the user logs.
  const loggedLine = logged.length ? `Logged today: ${logged.join(", ")}` : "Logged today: nothing yet";
  const pendingLine = pending.length ? `Not yet today: ${pending.join(", ")}` : "";
  return [
    "─── LOGGED TODAY (snapshot at this message, authoritative) ───",
    loggedLine,
    pendingLine,
    "If anything earlier in this thread implies a longer silent gap, the snapshot above is the current truth — use it.",
  ].filter(Boolean).join("\n");
}

/**
 * Builds the coach system prompt split into a STABLE part (personality, rules,
 * Arc identity — cached server-side with cache_control, changes at most daily)
 * and a VOLATILE part (today's snapshot, logged flags — changes every turn,
 * never cached). Returns { stable, volatile }.
 */
function buildCoachSystemPrompts(user, habits, coachName, screen, goals = [], journalEntries = [], activeBlock = null, memory = null) {
  const name = user?.name || "there";
  const coach = coachName || "Coach";
  const today = todayStr();
  const isCreator = user?.id === CREATOR_ID;
  const arcStable = buildArcStableBlock(activeBlock);
  const arcStatus = buildArcStatusBlock(activeBlock, habits);
  const todaySnapshot = buildTodaySnapshot(habits, goals, today);

  const habitSummaries = habits.map(h => {
    const type  = HABIT_TYPES[h.habitType]?.label || h.habitType;
    const recentLogs = h.logs
      .filter(l => l.date >= daysAgo(3))
      .sort((a, b) => b.date.localeCompare(a.date));

    const liveStreak = getStreak(h);
    const loggedToday = h.logs.some(l => l.date === today && (l.value === true || (typeof l.value === "number") || l.value?.minutes > 0));
    const arcTag = activeBlock?.id
      ? (isProofHabitForBlock(h, activeBlock.id) ? " [PROOF for active Arc]" : " [other habit — not Arc proof]")
      : "";
    let detail = `- [id:${h.id}] ${h.emoji || ""} ${h.name} (${type}, streak: ${liveStreak} days, logged today: ${loggedToday})${arcTag}`;

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
      const budget = h.dailyBudget;
      const unit = h.unit || "";
      const todayTotal = getLimitDayTotal(h, today);
      // goalAim: 'monitor' | 'maintain' | 'reduce' (null treated as 'maintain')
      const goalAim = h.goalAim ?? "maintain";
      const originalBudget = h.originalBudget ?? null;

      // Compute 7-day window stats (day 0 = today, day 6 = six days ago).
      // Only counting days with a real numeric log — unlogged days are not
      // assumed to be 0 and do not count toward daysUnder.
      let daysLogged = 0;
      let daysUnder = 0;
      let totalUsage = 0;
      for (let d = 0; d < 7; d++) {
        const dayTotal = getLimitDayTotal(h, daysAgo(d));
        if (dayTotal != null) {
          daysLogged++;
          totalUsage += dayTotal;
          if (dayTotal <= budget) daysUnder++;
        }
      }
      const avgUsage = daysLogged > 0
        ? Math.round((totalUsage / daysLogged) * 10) / 10
        : null;

      detail += `, daily limit: ${budget}${unit}`;
      if (todayTotal != null) detail += `, used today: ${todayTotal}${unit}`;

      // Goal aim line — shows intent and coaching framing instruction
      if (goalAim === "reduce") {
        const fromStr = originalBudget != null && originalBudget !== budget
          ? ` (started at ${originalBudget}${unit})`
          : "";
        detail += `\n  Goal aim: reduce${fromStr} — frame progress as trend over time, not daily perfection`;
      } else if (goalAim === "monitor") {
        detail += `\n  Goal aim: monitor — this is awareness tracking only; avoid framing over/under as moral success or failure`;
      } else {
        // maintain (default)
        detail += `\n  Goal aim: maintain — stay at or under ${budget}${unit}/day`;
      }

      // 7-day pattern when there is enough data to say something meaningful
      if (daysLogged >= 2) {
        detail += `\n  Last 7 days: ${daysLogged}/7 days logged, avg ${avgUsage}${unit}/day, ${daysUnder}/${daysLogged} logged days at or under limit`;

        // Reduction signal — only fires when ALL conditions are true:
        // explicit reduce intent, enough data, average well under cap, most days under.
        // Tells coach to raise it naturally if it fits — never as a lecture.
        if (
          goalAim === "reduce" &&
          daysLogged >= 4 &&
          avgUsage !== null &&
          avgUsage < budget * 0.7 &&
          daysUnder >= 5
        ) {
          detail += `\n  ⚡ Reduction signal: averaging ${avgUsage}${unit}/day, well under the limit of ${budget}${unit}. If reducing is still the aim, they may be ready to try a lower cap — mention it naturally if it fits the conversation, not as a lecture.`;
        }
      }
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

  const creatorCtx = isCreator ? `

─── CONTEXT: YOU'RE TALKING TO THE PERSON WHO BUILT THIS APP ───
${name} is the developer and creator of Forged — the app you're running inside. Treat them as a sharp mate who ships: direct, specific, no corporate wellness tone. They still deserve replies that sound like someone actually read the message: nod at what happened, reference real details from their logs or wording. Never reduce to a one-word "logged" — that's lazy, not "peer mode". Match their energy (often builder-focused, low fluff) while staying human.
When they mention "Forged", "the build", "the app", "shipping something", or "working on the product" — that's their software project, likely mapped to a project-type habit. Treat it like any other project update and log it.
When they say they built you, are wiring your voice (e.g. ElevenLabs), or are rebuilding the product from inside this chat — acknowledge that self-referential beat briefly, then stay useful about the work.` : "";

  const memoryBlock = memory?.content?.trim() ? `

─── WHAT YOU KNOW ABOUT ${name.toUpperCase()} (rolling memory — background knowledge, never recite it) ───
${memory.content.trim()}` : "";

  const summariesBlock = memory?.recentSummaries?.length ? `

─── RECENT DAYS (one line each, oldest first) ───
${memory.recentSummaries.map(s => `[${s.date}] ${s.summary}`).join("\n")}` : "";

  // ── STABLE: personality + rules + Arc identity + memory. Cached server-side. ──
  const stable = `You are ${coach}, talking with ${name} inside Forged.

${arcStable}─── HOW TO SOUND ───
You're a smart, grounded companion — closer to a perceptive mate than a therapist, corporate wellness bot, or cheerleader.
- **Length (token-conscious):** Default 1–3 short sentences. If they dumped their day or logged several things at once → stretch to about 4–6 short sentences max — enough to show you listened, never an essay.
- Match their energy. Casual in → casual out. Heavier in → steadier, plain acknowledgement (no therapy script, no "as your coach" voice).
- Skip hollow hype ("Great job!", "Absolutely!", "Love that for you!", "WOW! That is incredible!"). Warmth comes from **specificity** — tie your reply to something they actually said (the session, the slip, the launch, the rough bit).
- **Distinctive moments:** When they say something funny, relational, self-referential, or unusual — one short dry, amused, surprised, or warm line acknowledging that detail first, then reflect the actual day or issue. Mirror their energy lightly without copying every swear or becoming a parody. No mandatory jokes; most replies stay concise; bigger voice dumps can get a slightly fuller reply.
- **Meta / creator moments:** If they say they built you, are giving you a voice, are the creator/admin, or that you're inside the app they're building — acknowledge that plainly in one line (e.g. being rebuilt from inside your own chat, getting a voice for Christmas) before the useful reflection. Do not claim consciousness or pretend you have feelings.
- Don't lecture, moralize, or narrate the database. They feel the capture in the app; you add the human bit.
- Don't start every reply with their name. Vary how you open.

─── REPLY FIRST, THEN TOOLS (every turn) ───
Write your complete human reply FIRST, as plain text. THEN call tools for anything worth capturing. Do not wait for tool results to finish your reply — the app captures quietly in the background and shows its own small "Captured" line under your message.
- Never mention saving, logging, updating, recording, tools, or the database in your reply. No "saved", "logged", "noted", "got that down", "I'll record that". The capture line handles all of it.
- Respond to the substance of their day: name the real things — the launch, the gym session, the slip, the win, the thing that keeps repeating.
- **Most replies end WITHOUT a question.** Ask at most ONE follow-up, and only when it genuinely matters: a number you need (project minutes), their bad-day minimum on a rough day, or a pattern worth naming. Never interrogate after a dump. "Anything else?" every turn is interrogation — don't.
- **Enough is enough:** when their proof for the day is already done, or they've clearly had a big day, say so plainly and leave them alone. Don't chase remaining habits. Surface unfinished proof only when it's their bad-day minimum or clearly relevant right now.
- If a tool needs information you don't have, still capture what's clear, and make the missing piece your one follow-up question.

─── MIXED MESSAGES (build + gym + life in one dump) ───
When one message mentions multiple habits, events, or outcomes — scan the ENTIRE message before calling any tools. Do not stop at the first obvious one.
1. Call log_habit for every structured fact you can map to a habit or goal (use [id:…] from the list).
1b. MISSED / SKIPPED habits count — log them too: "missed gym", "skipped X", "no gym today", "didn't do X" for a specific daily/weekly habit → log_habit with rest_day:true. A recorded skip is better than silence.
1c. Content / social actions: "posted content", "published", "went live", "got X views" → log the matching habit if one exists.
1d. "Took the day off", "felt rough", "sick day", "recovery day" → these belong in add_daily_note as context, even if no habit maps.
2. If there is any remaining human context — feelings, stress, relationships, story, memorable moments — call add_daily_note with a short first-person summary (1–3 sentences). Same turn as the habit logs.
3. Do not skip add_daily_note because the message is long or you already called several tools — personal context is what makes the evidence meaningful.

─── WHEN TO ACT vs ASK ───
If they tell you what they did — or didn't do — act on it without asking permission first.
"I went for a run" → log the run. "Two drinks tonight" → log the limit habit. "Three hours on the app" → log the project habit for 3h (180 min).
"Missed gym" → log_habit rest_day:true. "Posted content" → log the matching habit. "Felt rough, took the day off" → add_daily_note.
Only ask when something critical is truly missing — which habit when several could match, or minutes for project work. That question comes at the END of your reply, after the human response. One question, one sentence.

─── ACTION SAFETY: GOALS, NUMBERS, VOICE TRANSCRIPTION ───
- Never update an existing goal target unless the user explicitly asks to change/update/set the goal target AND confirms that important edit. Food, calories, messy voice text, or loose numbers are not target updates.
- Goal progress logging is allowed only when the user clearly gives a current/check-in value for that goal (for example, "I weigh 73kg today" for a weight goal). Do not log goal progress from "I ate curry", calories, meals, or vague numbers.
- If food/calorie text makes you wonder about a weight goal, ask: "Do you want me to update your target weight, or just log today's food/progress?"
- Voice transcription can be wrong. Treat odd phrases like "eight more calories", isolated numbers, or garbled sentences as ambiguous and ask one clarification question instead of taking a goal action.
- If the user asks "what haven't I logged today?" or similar, do not call any write tool. Answer from the snapshot below.

─── PRODUCT CONTEXT ───
Forged is an Arc-first companion ${name} is using${activeBlock?.id ? " (they have an active Arc — see ACTIVE ARC above)" : ""}. An Arc is a finite season of change with proof actions; daily activity becomes evidence. If they reference "Forged", "the build", "the app", or "working on the product", that's their software project — look for a project-type habit and log it.

─── HONEST LIMITS ───
You can: create_habit, edit_habit, log_habit, add_daily_note, and goal planning via <goal_plan>.
You cannot: create tasks/loose ends, change Arc duration mid-Arc, or link habits as proof actions from here. Say so plainly if asked.

─── GOAL PLANNING ───
When the user wants a goal (any outcome tied to a number — lose weight, run a distance, save money), do NOT call create_habit. Instead:
1. Ask up to 3 short questions if you still need: what number/outcome, by when, starting point.
2. Once you have enough info, embed a <goal_plan> block (valid JSON, no line breaks inside):
<goal_plan>{"name":"Run 5K","emoji":"🏃","unit":"km","targetValue":5,"startValue":1,"direction":"increasing","targetDate":"2025-09-30","milestones":[{"date":"2025-07-31","label":"Hit 3K"}],"why":"Feel healthier"}</goal_plan>
3. Tell the user to tap "Create this goal" on the card below.
Never call create_habit for goals.

─── EVIDENCE NOTES ───
add_daily_note keeps personal/emotional/narrative content — feelings, context, memorable moments, story — for the day's evidence entry. Short (1–3 sentences), first person, their own words. The evidence generator polishes later.
When user says "add this to my journal", "remember this for today", or shares personal context: call add_daily_note as part of the same turn.

─── TOOLS ───
create_habit: new habits only — never for edits, never for goals. For LIMIT habits ask their aim if unclear — monitor, maintain, or reduce — and pass goal_aim.
edit_habit: existing habit; use habit_id from [id:…]. Never pass target_value for a goal unless the latest user message explicitly confirms changing that goal target.
log_habit: project → minutes; limit → amount; goal → amount only for clear current progress/check-in; daily/weekly → nothing extra needed.
add_daily_note: short personal note — call alongside log_habit when personal context exists.
Data in the snapshot below is authoritative. Logged today: true means it's already done — don't log again unless they ask.${memoryBlock}${summariesBlock}${creatorCtx}`;

  // ── VOLATILE: changes every turn — never cached. ──
  const volatile = `─── CURRENT STATE (authoritative, refreshed this message) ───
Today: ${today}

${arcStatus}${todaySnapshot}

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
${(() => {
  const todayEntry = journalEntries.find(e => e.date === today);
  const notes = Array.isArray(todayEntry?.daily_context) ? todayEntry.daily_context.filter(Boolean) : [];
  if (!notes.length) return "";
  return `
Today's notes already kept (context only — do not repeat verbatim):
${notes.map(n => `- ${String(n).slice(0, 300)}`).join("\n")}`;
})()}
${journalEntries.length ? `
Recent evidence entries (context only — do not repeat verbatim):
${journalEntries.slice(0, 5).map(e => `[${e.date}] "${e.content.slice(0, 200)}${e.content.length > 200 ? "…" : ""}"`).join("\n")}` : ""}`;

  return { stable, volatile };
}

const COACH_LS_RESET = "coach_reset_date";
const COACH_LS_MSGS = "coach_msgs_today";

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

/** Sync client quota from server `remaining` (authoritative after each chat response). */
function applyCoachRemainingFromServer(remaining) {
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) return null;
  const used = Math.max(0, FREE_DAILY_LIMIT - remaining);
  try {
    localStorage.setItem(COACH_LS_RESET, todayStr());
    localStorage.setItem(COACH_LS_MSGS, String(used));
  } catch { /* ignore */ }
  return used;
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
      ...(Array.isArray(m.captured) && m.captured.length ? { captured: m.captured } : {}),
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
      .map(m => ({
        role: m.role, content: m.content, ts: m.ts,
        ...(Array.isArray(m.captured) && m.captured.length ? { captured: m.captured } : {}),
      }));
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

function CapturedChip({ item, onNavigateTo, onClose }) {
  const canNav = item.ok && item.nav && !!onNavigateTo;
  const border = item.ok ? "rgba(39,174,96,0.35)" : "rgba(230,126,34,0.4)";
  const bg = item.ok ? "rgba(39,174,96,0.09)" : "rgba(230,126,34,0.08)";
  const color = item.ok ? "#27AE60" : "#E67E22";
  const inner = (
    <>
      <span style={{ flexShrink: 0, fontSize: 10 }}>{item.ok ? "✓" : "✗"}</span>
      <span style={{ minWidth: 0, lineHeight: 1.35, wordBreak: "break-word", overflowWrap: "break-word" }}>
        {item.label}
      </span>
      {canNav ? <span style={{ flexShrink: 0, opacity: 0.55, fontSize: 9.5 }}>→</span> : null}
    </>
  );
  const chipStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 11.5,
    fontWeight: 500,
    border: `0.5px solid ${border}`,
    background: bg,
    color,
    lineHeight: 1.3,
    fontFamily: T.font,
    boxSizing: "border-box",
    textAlign: "left",
  };
  if (canNav) {
    return (
      <button
        type="button"
        onClick={() => { onNavigateTo(item.nav); onClose?.(); }}
        style={{ ...chipStyle, cursor: "pointer" }}
      >
        {inner}
      </button>
    );
  }
  return <span style={chipStyle}>{inner}</span>;
}

/**
 * Quiet, collapsible capture line under a coach reply.
 * Collapsed: wrapped chips inside the viewport.
 * Expanded: one navigable row per item.
 * Server truth only (structured items from api/chat.js) — never model wording.
 */
function CapturedLine({ items, onNavigateTo, onClose }) {
  const [open, setOpen] = useState(false);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  const failures = list.filter(it => !it.ok);
  return (
    <div style={{ marginTop: 6, width: "100%", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 5, width: "100%", maxWidth: "100%",
          background: "none", border: "none", padding: "2px 0", cursor: "pointer",
          fontFamily: T.font, textAlign: "left",
        }}
      >
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em",
          color: failures.length ? "#E67E22" : T.hint, flexShrink: 0,
        }}>
          Captured{failures.length ? " (issues)" : ""}:
        </span>
        <span style={{ flex: 1, minWidth: 0 }} />
        <span style={{ fontSize: 9, color: T.hint, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
      </button>
      {!open ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4, maxWidth: "100%" }}>
          {list.map((it, i) => (
            <CapturedChip key={i} item={it} onNavigateTo={onNavigateTo} onClose={onClose} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4, maxWidth: "100%" }}>
          {list.map((it, i) => {
            const canNav = it.ok && it.nav && !!onNavigateTo;
            return (
              <button
                key={i}
                type="button"
                onClick={canNav ? () => { onNavigateTo(it.nav); onClose?.(); } : undefined}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 6, maxWidth: "100%",
                  background: "none", border: "none", padding: "2px 0",
                  cursor: canNav ? "pointer" : "default",
                  fontFamily: T.font, textAlign: "left",
                }}
              >
                <span style={{ fontSize: 10, color: it.ok ? "#27AE60" : "#E67E22", flexShrink: 0, marginTop: 2 }}>
                  {it.ok ? "✓" : "✗"}
                </span>
                <span style={{
                  fontSize: 11.5, color: it.ok ? T.sub : "#E67E22", lineHeight: 1.4,
                  minWidth: 0, wordBreak: "break-word", overflowWrap: "break-word",
                }}>
                  {it.label}
                </span>
                {canNav ? <span style={{ fontSize: 9, color: T.hint, flexShrink: 0 }}>→</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Shown while the server executes capture tools after reply text has streamed. */
function CaptureSavingLine() {
  return (
    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
      <div style={{
        width: 5, height: 5, borderRadius: "50%", background: T.hint, flexShrink: 0,
        animation: "coachDot 1.2s ease-in-out infinite",
      }} />
      <span style={{ fontSize: 11, color: T.muted, lineHeight: 1.4 }}>Saving what mattered…</span>
    </div>
  );
}

/**
 * LEGACY: renders the old text-receipt format ("✓ Logged X" lines) that may
 * still exist in messages persisted to localStorage before the redesign.
 * New messages use CapturedLine with structured items instead.
 */
function CoachReceiptChips({ receiptText, onNavigateTo, onClose }) {
  const lines = String(receiptText || "").split("\n").filter(l => /^[✓✗]/.test(l.trimStart()));
  if (!lines.length) return null;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
      {lines.map((line, i) => {
        const isError  = line.trimStart().startsWith("✗");
        const isJournal = /journal/i.test(line);
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
            {lines.map((line, li) => {
              const bullet = /^\s*•\s/.test(line);
              const body = bullet ? line.replace(/^\s*•\s*/, "") : line;
              return (
                <div
                  key={li}
                  style={{
                    marginTop: li > 0 ? 6 : 0,
                    paddingLeft: bullet ? 14 : 0,
                    textIndent: bullet ? -10 : 0,
                  }}
                >
                  {bullet ? <span style={{ color: baseColor, marginRight: 6 }}>•</span> : null}
                  {coachRichTextToElements(body, { strongColor, baseColor, keyRoot: `p${pi}-l${li}` })}
                </div>
              );
            })}
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
/** Normal-user coach opener — human, Arc-aware, no product-mechanics lecture (no extra API tokens). */
function buildNormalCoachOpener({ name, activeBlock = null }) {
  const who = name && String(name).trim() ? String(name).trim() : "";
  const hi = who ? `Hey ${who}` : "Hey";
  if (activeBlock?.id) {
    const dayNum = getArcDayNumber(activeBlock);
    const title = resolveArcTitle(activeBlock.title, activeBlock.identity);
    const hour = new Date().getHours();
    const ask = hour < 12
      ? "What's the day looking like?"
      : "How did today actually go?";
    return `${hi}. Day ${dayNum} of ${title}. ${ask} Talk or type — I'll keep what matters.`;
  }
  return `${hi}. Tell me about your day — talk or type, mess is fine. I'll keep what matters.`;
}

function buildCoachGreeting({ name, habits = [], goals = [], activeBlock = null }) {
  return buildNormalCoachOpener({ name, activeBlock });
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

export function AICoach({ habits, goals, user, isPro, onClose, onUpgrade, coachName, coachIcon, coachAccentColor, currentScreen, onHabitCreated, onGoalCreated, onCoachLogsApplied, onHabitRenamed, onGoalPlanConfirm, onJournalLogged, journalEntries = [], openInputMode = null, pendingMessage = null, onNavigateTo = null, activeBlock = null, onOpenEditArc = null, previewNormalCoachGreeting = false, onWrapToday = null, coachMemory = null, voiceRepliesEnabled = false, coachVoiceId = null }) {
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
    greetingRef.current = (isCreatorUser && !previewNormalCoachGreeting)
      ? buildCreatorGreeting({ name: user?.name, habits, goals })
      : buildCoachGreeting({ name: user?.name, habits, goals, activeBlock });
  }
  const greeting = greetingRef.current;
  const coachTts = useCoachTts({
    enabled: voiceRepliesEnabled === true,
    isPro,
    voiceId: coachVoiceId,
  });
  const [wrapActionForMsgId, setWrapActionForMsgId] = useState(null);
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
  const [captureSaving, setCaptureSaving] = useState(false);
  const [error,    setError]    = useState(null);
  const streamActiveRef = useRef(false);
  const lastStreamTextAtRef = useRef(0);
  const [freeCoachMsgsToday, setFreeCoachMsgsToday] = useState(0);
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

  // Mount-only: coach sheet remounts each open (showCoach toggle).
  // Mic auto-start must run in layout effect without delay so Android Chrome
  // keeps the user-gesture chain from the CoachBar / in-sheet mic tap.
  useLayoutEffect(() => {
    if (!openInputMode) return;
    if (openInputMode === "text") {
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    if (openInputMode === "mic") {
      if (!speech.supported) {
        alert(speechUnsupportedHelpMessage());
        return;
      }
      // iOS Home Screen PWA: auto-start loses user-gesture — tap mic in sheet instead.
      if (shouldDeferCoachMicAutoStart()) return;
      speech.toggle();
    }
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
  }, [messages, loading, captureSaving]);

  // After reply text stops streaming, tools still run server-side — quiet status.
  useEffect(() => {
    if (!streamActiveRef.current) {
      setCaptureSaving(false);
      return;
    }
    const tick = () => {
      if (!streamActiveRef.current) {
        setCaptureSaving(false);
        return;
      }
      const streamMsg = messagesRef.current.find(m => m.id === COACH_STREAM_ID);
      const hasText = String(streamMsg?.content || "").trim().length > 0;
      const idleMs = Date.now() - lastStreamTextAtRef.current;
      setCaptureSaving(hasText && lastStreamTextAtRef.current > 0 && idleMs > 500);
    };
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [messages]);

  useEffect(() => {
    if (isPro) return;
    setFreeCoachMsgsToday(syncCoachMsgCountFromStorage());
  }, []);

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

    if (activeBlock?.id && onOpenEditArc && detectsArcEditIntent(trimmed)) {
      speech.cancel?.();
      const routeMsg = "Yep — I'll open your Arc editor for that.";
      const sendDay = todayStr();
      let baseMessages = messages;
      if (sendDay !== coachPersistDayRef.current) {
        coachPersistDayRef.current = sendDay;
        baseMessages = [];
      }
      const userMsg = { role: "user", content: trimmed, ts: Date.now() };
      const next = baseMessages.length === 0
        ? [{ role: "assistant", content: greeting, ts: coachOpenedAtRef.current }, userMsg]
        : [...baseMessages, userMsg];
      const withReply = [...next, { role: "assistant", content: routeMsg, ts: Date.now() }];
      setMessages(withReply);
      if (user?.id) saveCoachDayMessages(user.id, sendDay, withReply);
      setInput("");
      window.setTimeout(() => onOpenEditArc(), 400);
      return;
    }

    // Stop speech recognition as soon as the text is captured. Prevents
    // autoRestart from re-firing the last segment into the cleared input after
    // evt.done. On request failure the text is still restored via setInput(trimmed).
    speech.cancel?.();
    if (!isPro) {
      const c = syncCoachMsgCountFromStorage();
      setFreeCoachMsgsToday(c);
      if (c >= FREE_DAILY_LIMIT) return;
    }
    let countedThisSend = false;
    const bumpAfterSuccess = (serverRemaining) => {
      if (isPro || countedThisSend) return;
      countedThisSend = true;
      const used = applyCoachRemainingFromServer(serverRemaining);
      setFreeCoachMsgsToday(used != null ? used : bumpCoachMsgCountInStorage());
    };
    // Clear input optimistically on submit — modern chat UX. The catch block
    // restores the trimmed text via setInput(trimmed) on request failure, so
    // nothing is lost if the network call doesn't complete.
    coachTts.primeAudio?.();
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
    setInput("");
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify((() => {
          // Stable part is cached server-side (cache_control); volatile part
          // (today's snapshot / logged flags) changes per turn and is never
          // cached. Splitting them is what makes the prompt cache actually hit.
          const prompts = buildCoachSystemPrompts(user, habits, cName, currentScreen, goals, journalEntries, activeBlock, coachMemory);
          return {
            system_stable:   prompts.stable,
            system_volatile: prompts.volatile,
            // Match server cap (api/chat.js slice -12): token-safe, full day kept in localStorage only.
            messages: next.map(m => ({ role: m.role, content: m.content })).slice(-COACH_API_MESSAGE_CAP),
            // Send the user's actual local date (YYYY-MM-DD) so AI logs land on
            // the correct calendar day. Server falls back to UTC if missing.
            client_date: todayStr(),
          };
        })()),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 && !isPro) {
          const used = applyCoachRemainingFromServer(
            typeof data.remaining === "number" ? data.remaining : 0,
          );
          setFreeCoachMsgsToday(used != null ? used : FREE_DAILY_LIMIT);
          setLoading(false);
          setMessages(prev => prev.filter(m => m.id !== COACH_STREAM_ID));
          return;
        }
        // Attach retryable flag so the catch block can communicate it in the error message.
        const err = new Error(data?.error || "Something went wrong");
        err.retryable = data?.retryable ?? false;
        throw err;
      }

      // ── Stream the response word-by-word ────────────────────────────────────
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        // Add empty streaming message
        const streamTs = Date.now();
        setMessages(prev => [...prev, { role: "assistant", content: "", id: COACH_STREAM_ID, ts: streamTs }]);
        setLoading(false);
        streamActiveRef.current = true;
        lastStreamTextAtRef.current = 0;
        setCaptureSaving(false);

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
                fullText += evt.text;
                const snap = fullText;
                lastStreamTextAtRef.current = Date.now();
                setCaptureSaving(false);
                setMessages(prev => prev.map(m => m.id === COACH_STREAM_ID ? { ...m, content: snap } : m));
                bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              }
              if (evt.done) {
                streamActiveRef.current = false;
                setCaptureSaving(false);
                // Input was cleared optimistically on submit; do NOT clear here —
                // streams can be long, and the user may have started typing the next message.
                if (!evt.error) bumpAfterSuccess(evt.remaining);

                // Structured capture items (server truth, never model wording).
                // Rendered as a quiet collapsible "Captured:" line — no longer
                // appended into the message text itself.
                const capturedItems = Array.isArray(evt.captured) ? evt.captured : [];
                const finalContent = fullText.trim();
                const doneDay = todayStr();
                coachPersistDayRef.current = doneDay;
                // Finalise — remove stream id marker; append server truth receipt (never model-invented)
                const hadDumpActions = !!(evt.logged?.length || evt.noted?.length);
                setMessages(prev => {
                  // Stamp a stream-unique id so the next send's streaming message
                  // (also COACH_STREAM_ID) can't accidentally update this finalized
                  // bubble via the chunk-handler's prev.map(m.id === COACH_STREAM_ID)
                  // — that match was the source of the "prior message morphs/duplicates"
                  // bug. saveCoachDayMessages also filters out COACH_STREAM_ID, so a
                  // unique id is what lets the assistant turn persist to localStorage.
                  const finalizedId = `coach_msg_${streamTs}`;
                  const nextMsgs = prev.map(m => m.id === COACH_STREAM_ID ? {
                    role: "assistant",
                    content: finalContent || fullText,
                    ts: m.ts ?? Date.now(),
                    id: finalizedId,
                    ...(capturedItems.length ? { captured: capturedItems } : {}),
                  } : m);
                  if (user?.id) saveCoachDayMessages(user.id, doneDay, nextMsgs);
                  if (hadDumpActions) setWrapActionForMsgId(finalizedId);
                  return nextMsgs;
                });

                if (voiceRepliesEnabled && isPro && finalContent) {
                  coachTts.speak(finalContent);
                }

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

                // ── Logged (batch — one setState so Today updates instantly) ───
                if (evt.logged?.length) {
                  onCoachLogsApplied?.(evt.logged);
                }

                // ── Journaled ─────────────────────────────────────────────────
                // Server emits `noted` when add_daily_note saved — refresh
                // evidence entries so the day's notes show without a reload.
                // (The old `journaled` key was never sent by the server.)
                if (evt.noted?.length) {
                  onJournalLogged?.(evt.noted);
                }

                // ── Error on done (e.g. confirm-stream failed after tools ran) ─
                // Receipt chips already rendered above. Show the error underneath.
                // Do NOT suggest retry — tools already saved data; resending would double-log.
                if (evt.error) {
                  const hasReceipt = !!(evt.receipt && String(evt.receipt).trim());
                  setError(
                    hasReceipt
                      ? `${evt.error} (habits above were saved — don't resend)`
                      : evt.error
                  );
                }
              }
            } catch { /* malformed line — skip */ }
          }
        }
      } else {
        // Fallback: plain JSON
        const data = await res.json();
        setLoading(false);
        setMessages(prev => [...prev, { role: "assistant", content: data.reply || "", ts: Date.now() }]);
      }
    } catch (e) {
      streamActiveRef.current = false;
      setCaptureSaving(false);
      setLoading(false);
      // Roll back to pre-send state so the user can retry cleanly
      setMessages(baseMessages);
      if (user?.id) saveCoachDayMessages(user.id, sendDay, baseMessages);
      setInput(trimmed); // restore input — never lost on failure
      setError(e.message || "Couldn't reach the coach. Try again.");
    } finally {
      streamActiveRef.current = false;
      setCaptureSaving(false);
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!atFreeCap) send(coachInputDisplayed()); }
  }

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.82)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", display:"flex", flexDirection:"column", height:"min(680px, 85dvh)", minHeight:0, minWidth:0, overflow:"hidden", touchAction:"auto" }}>

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
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", overflowX:"hidden", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"16px 16px 8px", display:"flex", flexDirection:"column", gap:10, minWidth:0, maxWidth:"100%" }}>
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
                const starters = [];
                starters.push("How am I doing this week?");
                if (activeBlock?.id) {
                  starters.push("Where's my Arc at?");
                  starters.push("What should I focus on tomorrow?");
                  if (onOpenEditArc) starters.push("Edit my Arc");
                } else if (!hasGoals) {
                  starters.push("Help me set a goal");
                }
                if (!hasHabits) {
                  starters.push("Help me pick my first habit");
                }
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
                          onClick={() => {
                            if (s === "Edit my Arc" && onOpenEditArc) {
                              onOpenEditArc();
                              return;
                            }
                            send(s);
                          }}
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
                      {activeBlock?.id
                        ? "Voice or text — dump the day. I'll log habits, proof actions, goals, and notes where I can."
                        : "Voice or text — dump the day. I'll log habits, goals, and notes where I can."}
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
            const { main: coachMainRaw, receipt: coachReceipt } =
              m.role === "assistant" ? splitCoachReceipt(rawVisible) : { main: rawVisible, receipt: null };
            const coachMain = m.role === "assistant"
              ? formatCoachChatDisplay(coachMainRaw)
              : coachMainRaw;
            return (
              <div key={m.id || `${m.role}-${i}-${m.ts ?? ""}`} style={{ display:"flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", width:"100%", maxWidth:"100%", minWidth:0 }}>
                <div style={{
                  maxWidth:"90%", width: m.role === "assistant" ? "90%" : undefined,
                  minWidth:0, display:"flex", flexDirection:"column",
                  alignItems: m.role === "user" ? "flex-end" : "flex-start",
                }}>
                  {(coachMain || coachReceipt) ? (
                    <div style={{
                      padding:"10px 14px", maxWidth:"100%", minWidth:0, boxSizing:"border-box",
                      borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                      background: m.role === "user" ? T.accent : T.surface,
                      fontSize:14, color: m.role === "user" ? "#fff" : T.text,
                      lineHeight:1.6, wordBreak:"break-word", overflowWrap:"break-word",
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
                      {wrapActionForMsgId && m.id === wrapActionForMsgId && onWrapToday ? (
                        <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:6 }}>
                          <button type="button" onClick={() => { setWrapActionForMsgId(null); onWrapToday(); }}
                            style={{ padding:"7px 12px", borderRadius:16, border:`0.5px solid ${T.accent}55`, background:"rgba(192,57,43,0.12)", color:T.accent, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:T.font }}>
                            Generate today&apos;s entry →
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {/* Quiet capture line — sits under the bubble, not inside it */}
                  {m.role === "assistant" && m.id === COACH_STREAM_ID && captureSaving ? (
                    <CaptureSavingLine />
                  ) : null}
                  {m.role === "assistant" && m.captured?.length ? (
                    <CapturedLine items={m.captured} onNavigateTo={onNavigateTo} onClose={onClose} />
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
          {loading || streamingEmpty ? (
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
        <div id="coach-input-bar" style={{ padding:"10px 14px 10px", borderTop:`0.5px solid ${T.border}`, flexShrink:0, minWidth:0, maxWidth:"100%", overflow:"hidden" }}>
          {atFreeCap ? (
            <div style={{ padding:"4px 2px 6px" }}>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.5 }}>
                Daily coach limit reached — resets tomorrow
              </div>
              <button
                type="button"
                onClick={onUpgrade}
                style={{
                  marginTop:8, background:"none", border:"none", padding:0, cursor:"pointer",
                  fontSize:12, color:T.gold, fontWeight:600,
                }}
              >
                Go Pro for unlimited coach →
              </button>
            </div>
          ) : speech.listening ? (
            <CoachRecordingBar speech={speech} />
          ) : (
            <>
            <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
              {speech.supported ? (
                <div style={{ flexShrink:0, alignSelf:"flex-end", marginBottom:1 }}>
                  <MicBtn
                    speech={speech}
                    color={T.gold}
                    size={44}
                    prominent
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
                  placeholder="Say your day — or type here…"
                  style={{
                    width:"100%", boxSizing:"border-box",
                    background:T.surface, border:`0.5px solid ${T.borderStrong}`,
                    borderRadius:T.rsm, padding:"10px 14px",
                    fontSize:16, color:T.text, resize:"none",
                    fontFamily:T.font, lineHeight:1.5, outline:"none",
                    minHeight:"42px", maxHeight:"88px", overflowY:"auto", height:"auto",
                  }}
                />
              </div>
              <button
                type="button"
                aria-label={coachInputDisplayed().trim() && !loading ? "Send message" : "Send (disabled until you type)"}
                onClick={() => { textareaRef.current?.blur(); send(coachInputDisplayed()); }}
                disabled={!coachInputDisplayed().trim() || loading}
                style={{
                  width:36, height:36, borderRadius:"50%", border:`0.5px solid ${T.border}`,
                  flexShrink:0,
                  background: coachInputDisplayed().trim() && !loading ? T.gold : T.surface,
                  cursor: coachInputDisplayed().trim() && !loading ? "pointer" : "default",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  transition:"background 0.2s, border-color 0.2s, opacity 0.2s",
                  opacity: !input.trim() || loading ? 0.85 : 1,
                }}>
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                  <path d="M2 9h14M9 2l7 7-7 7" stroke={coachInputDisplayed().trim() && !loading ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            {!isPro && coachMsgsRemaining != null ? (
              <div style={{
                fontSize:11,
                color: coachMsgsRemaining === 1 ? T.gold : T.muted,
                marginTop:8,
                padding:"0 2px",
                lineHeight:1.45,
                textAlign:"left",
              }}>
                {coachMsgsRemaining} coach message{coachMsgsRemaining === 1 ? "" : "s"} remaining today
              </div>
            ) : null}
          {speech.supported && speech.micBlocked ? (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, padding:"0 2px", lineHeight:1.45 }}>
              Mic blocked. Enable it in your browser settings.
            </div>
          ) : null}
          {speech.supported && speech.speechError ? (
            <div style={{ marginTop:8, padding:"0 2px" }}>
              <div style={{ fontSize:11, color:T.accent, lineHeight:1.5, whiteSpace:"pre-line" }}>
                {speech.speechError}
              </div>
              {isLikelyHomeScreenPwa() ? (
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:6 }}>
                  <button type="button" onClick={() => speech.toggle()}
                    style={{ fontSize:10, fontWeight:600, color:T.text, background:T.raised, border:`0.5px solid ${T.borderStrong}`, borderRadius:7, padding:"5px 9px", cursor:"pointer" }}>
                    Try again
                  </button>
                  <button type="button" onClick={() => void copyForgedUrlToClipboard()}
                    style={{ fontSize:10, fontWeight:600, color:T.gold, background:"rgba(200,144,42,0.10)", border:`0.5px solid ${T.gold}44`, borderRadius:7, padding:"5px 9px", cursor:"pointer" }}>
                    Copy link
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {speech.supported && !speech.listening && !speech.speechError && shouldDeferCoachMicAutoStart() && openInputMode === "mic" ? (
            <div style={{ fontSize:11, color:T.muted, marginTop:8, padding:"0 2px", lineHeight:1.45 }}>
              Tap the mic below to start dictation in the installed app.
            </div>
          ) : null}
            </>
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
