// ─── HABIT CARDS & RELATED MODALS ────────────────────────────────────────────
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { T, COLORS, HABIT_TYPES, DAYS, MONTHS, XP_LEVELS } from "../theme.js";
import {
  todayStr, daysAgo, parseLocal, weekStartFor,
  isSatisfiedForTodayRing, isLoggedToday, todayLogs, latestTodayLog, hasDailyCompletion,
  getWeeklyCount, getProjectStats, hasRestDay, qualifiesBuildDay, getBuildStreak,
  getStreak, getDailyStreak, getCompletionRate, get12WeekGrid,
  getLevel, nextLevel, formatWithUnit, truncateText,
  getGoalProgress, goalBarFillWidthPct, getGoalPacing, getGoalStatusText,
  goalTodayDeadlineLine, fmtGoalDueHuman, getHabitCardStreakSuffix, fmtEntryDate,
  getLimitDayTotal,
} from "../utils.js";
import { Modal, GBtn, PBtn, FG, lbl, inp, Stat, DoneBanner, Toggle } from "./ui.jsx";
import {
  ARC_DAILY_XP_CAP,
  ARC_RANKS,
  calculateArcProofPercent,
  getArcRankDisplay,
  getArcDayNumber,
  getProofHabitsForBlock,
} from "../arcProgress.js";
import { useSpeechInput, MicBtn, mergeDictationIntoText, polishInterimDisplay } from "../hooks/useSpeechInput.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";

// ─── NOTE STRIP ───────────────────────────────────────────────────────────────
export function NoteStrip({ habitId, habit, onAddNote }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const speech = useSpeechInput(text =>
    setVal(p => mergeDictationIntoText(p, text))
  );

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 2200);
    return () => clearTimeout(t);
  }, [savedFlash]);

  async function handleDone() {
    const draft = mergeDictationIntoText(val.trim(), speech.interim?.trim() || "").trim();
    if (!draft) return;
    if (speech.listening) speech.toggle();
    const ok = await onAddNote(habitId, draft);
    if (!ok) return;
    setVal("");
    setSavedFlash(true);
    setOpen(false);
  }

  function handleCancel() {
    if (speech.listening) speech.toggle();
    setVal("");
    setOpen(false);
  }

  const hasDraft = !!(val.trim() || speech.interim?.trim());

  if (!open) {
    return (
      <div style={{ borderTop:`0.5px solid ${T.border}`, padding:"7px 15px 9px", display:"flex", alignItems:"center", gap:8 }}>
        <button type="button" onClick={() => setOpen(true)}
          style={{ fontSize:12, color:T.hint, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:5, padding:0, lineHeight:1 }}>
          <span style={{ fontSize:13, opacity:0.7 }}>✏️</span> Add note
        </button>
        <MicBtn speech={speech} color={habit.color} size={22} onPointerDown={() => setOpen(true)}/>
        {savedFlash && <span style={{ fontSize:12, color:T.green, fontWeight:500, marginLeft:"auto" }}>Note saved ✓</span>}
      </div>
    );
  }

  return (
    <div style={{ borderTop:`0.5px solid ${T.border}`, padding:"10px 15px 12px", display:"flex", flexDirection:"column", gap:7 }}>
      <textarea
        rows={3} maxLength={280}
        autoFocus
        style={{ width:"100%", border:"none", background:"none", fontSize:13, color:T.text, resize:"none", lineHeight:1.55, minHeight:58, outline:"none" }}
        placeholder={speech.listening ? "Listening…" : "Quick note or reflection…"}
        value={val}
        onChange={e => setVal(e.target.value)}
      />
      {speech.interim && (
        <div style={{ fontSize:12, color:T.hint, fontStyle:"italic", lineHeight:1.45, marginTop:-4 }}>
          {speech.interim}…
        </div>
      )}
      {speech.speechError ? (
        <div style={{ fontSize:11, color:T.accent, lineHeight:1.5, whiteSpace:"pre-line" }}>{speech.speechError}</div>
      ) : null}
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <button type="button" onClick={handleCancel}
          style={{ fontSize:12, color:T.hint, background:"none", border:"none", cursor:"pointer", padding:0 }}>Cancel</button>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          <MicBtn speech={speech} color={habit.color} size={26}/>
          <button type="button" onClick={handleDone} disabled={!hasDraft}
            style={{ fontSize:12, color:hasDraft?T.text:T.hint, background:hasDraft?habit.color+"22":"none", border:`0.5px solid ${hasDraft?habit.color+"55":T.border}`, borderRadius:T.rsm, padding:"4px 12px", cursor:hasDraft?"pointer":"not-allowed", fontWeight:500, transition:"all 0.15s", opacity:hasDraft?1:0.65 }}>
            ✓ Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CARD SHELL ───────────────────────────────────────────────────────────────
export function cardStyle(logged, habit) {
  return {
    margin:"0 14px 10px", borderRadius:T.r, overflow:"hidden",
    animation:"fadeUp 0.3s ease-out",
    border:`0.5px solid ${logged ? habit.color+"66" : T.border}`,
    background: logged ? `${habit.color}0D` : T.raised,
  };
}
export function IconBox({ habit, logged }) {
  return (
    <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:logged?habit.color+"33":habit.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
      {habit.emoji}
    </div>
  );
}
export function CheckBtn({ logged, habit, onClick }) {
  return (
    <button className="tap" onClick={onClick} style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${logged?habit.color:habit.color+"55"}`, background:logged?habit.color:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.18s" }}>
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
        <path d="M4 8.5l3.5 3.5 6-7" stroke={logged?"#fff":habit.color+"88"} strokeWidth={logged?2.5:1.5} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}
export function PlusBtn({ habit, logged, onClick }) {
  return (
    <button className="tap" onClick={onClick} style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${logged?habit.color:habit.color+"66"}`, background:logged?habit.color+"22":"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:habit.color, fontWeight:300, transition:"all 0.18s" }}>+</button>
  );
}

// ─── HABIT CARD HOOKS & SHARED CONTROLS ──────────────────────────────────────
export function useTodayHabitLongPeekHandlers(setPeek, enabled) {
  const lpTimer = useRef(null);
  const clearLp = () => {
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
  };
  useEffect(() => () => clearLp(), []);
  return {
    onPointerDownCapture(e) {
      if (!enabled) return;
      if (!e.isPrimary) return;
      if (e.target.closest("button, textarea, input, a")) return;
      clearLp();
      lpTimer.current = window.setTimeout(() => { lpTimer.current = null; setPeek(true); }, 520);
    },
    onPointerUpCapture: clearLp,
    onPointerCancelCapture: clearLp,
  };
}

export function TodayOverflowDotsBtn({ expanded, onToggle }) {
  return (
    <button
      type="button" aria-label="Options" aria-expanded={expanded}
      onPointerDown={e => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{ fontSize:21, fontWeight:700, letterSpacing:"0.06em", color:expanded?T.sub:T.muted, background:expanded?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.03)", border:`0.5px solid ${expanded?T.borderMid:T.border}`, borderRadius:T.rsm, cursor:"pointer", lineHeight:1, padding:"5px 8px", flexShrink:0, minWidth:36, display:"flex", alignItems:"center", justifyContent:"center" }}>
      ···
    </button>
  );
}

export function TodayHabitMenuDropdown({ habit, onEdit, onDelete, onShareHabit, shareSaving, menuOpen, onCloseMenu, onUnlinkProof, onLinkProof }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (!menuOpen) setConfirmDelete(false); }, [menuOpen]);
  if (!menuOpen) return null;
  if (confirmDelete) {
    return (
      <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <div style={{ padding:"10px 15px 6px", borderTop:`0.5px solid ${T.border}`, fontSize:13, fontWeight:500, color:T.text }}>Delete {habit.name}?</div>
        <div style={{ padding:"8px 15px 10px", display:"flex", alignItems:"center", gap:8, justifyContent:"flex-end" }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(habit.id); setConfirmDelete(false); onCloseMenu(); }}
            style={{ fontSize:12, color:"#e74c3c", background:"rgba(231,76,60,0.1)", border:`0.5px solid rgba(231,76,60,0.4)`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer", fontWeight:500 }}>Delete</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
            style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer" }}>Cancel</button>
        </div>
        <div style={{ padding:"0 15px 12px", fontSize:12, color:"rgba(231,76,60,0.8)" }}>
          This will permanently delete <strong>{habit.name}</strong> and all its logs. {"This can't be undone."}
        </div>
      </div>
    );
  }
  return (
    <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} style={{ borderTop:`0.5px solid ${T.border}`, padding:"8px 15px 10px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
      <button type="button" onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onEdit(habit.id); onCloseMenu(); }}
        style={{ fontSize:12, color:habit.color, background:"none", border:`0.5px solid ${habit.color+"44"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Edit</button>
      {onUnlinkProof && (
        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onUnlinkProof(habit.id); onCloseMenu(); }}
          style={{ fontSize:12, color:T.sub, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Move to Hub</button>
      )}
      {onLinkProof && (
        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onLinkProof(habit.id); onCloseMenu(); }}
          style={{ fontSize:12, color:T.accent, background:"rgba(192,57,43,0.08)", border:`0.5px solid rgba(192,57,43,0.35)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Add to Arc</button>
      )}
      {onShareHabit && (
        <button type="button" disabled={!!shareSaving} onPointerDown={e => e.stopPropagation()} onClick={async (e) => { e.stopPropagation(); try { await onShareHabit(habit.id); } finally { onCloseMenu(); } }}
          style={{ fontSize:12, color:T.gold, background:"rgba(200,144,42,0.12)", border:`0.5px solid rgba(200,144,42,0.35)`, borderRadius:T.rsm, padding:"5px 12px", cursor:shareSaving?"wait":"pointer", fontWeight:500, opacity:shareSaving?0.55:1 }}>
          {shareSaving ? "Inviting…" : "Invite friends to this goal"}
        </button>
      )}
      <button type="button" aria-label="Delete habit" onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
        style={{ fontSize:12, color:"#e74c3c", background:"none", border:`0.5px solid rgba(231,76,60,0.3)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Delete</button>
      <button type="button" onClick={(e) => { e.stopPropagation(); onCloseMenu(); }}
        style={{ fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", marginLeft:"auto" }}>Cancel</button>
    </div>
  );
}

function missedDaysBeforeToday(h) {
  let gap = 0;
  for (let d = 1; d <= 365; d++) {
    const dateStr = daysAgo(d);
    if (hasDailyCompletion(h, dateStr) || hasRestDay(h, dateStr)) break;
    gap++;
  }
  return gap;
}

function dailyLogConfirmMessage(h) {
  const today = todayStr();
  const projected = {
    ...h,
    logs: [...h.logs.filter(l => l.date !== today), { date: today, value: true, note: "" }],
  };
  const currentStreak = getDailyStreak(projected);
  if (currentStreak >= 3) return `${currentStreak} in a row.`;
  const gap = missedDaysBeforeToday(h);
  if (gap >= 2) return `Back after ${gap} days — counts.`;
  if (!h.logs.some(l => l.value === true)) return "First one. Nice.";
  return "Logged.";
}

// ─── DAILY CARD ───────────────────────────────────────────────────────────────
export function DailyCard({ habit, onTap, onSkip, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit, proofMode = false, onUnlinkProof = null, onLinkProof = null }) {
  const tLog  = latestTodayLog(habit);
  const logged = isLoggedToday(habit);
  const isSkip = tLog?.value === "skip";
  const [restOpen, setRestOpen] = useState(false);
  const [restWhy, setRestWhy] = useState("");
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState(null);
  const [confirmFading, setConfirmFading] = useState(false);
  const confirmTimersRef = useRef([]);
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  useEffect(() => { if (logged) { setRestOpen(false); setRestWhy(""); } }, [logged]);

  function clearConfirmTimers() {
    confirmTimersRef.current.forEach(clearTimeout);
    confirmTimersRef.current = [];
  }

  function clearConfirmMessage() {
    clearConfirmTimers();
    setConfirmFading(false);
    setConfirmMsg(null);
  }

  function showConfirmMessage(msg) {
    clearConfirmTimers();
    setConfirmFading(false);
    setConfirmMsg(msg);
    confirmTimersRef.current.push(
      setTimeout(() => setConfirmFading(true), 2000),
      setTimeout(() => {
        setConfirmMsg(null);
        setConfirmFading(false);
        confirmTimersRef.current = [];
      }, 2350),
    );
  }

  useEffect(() => () => clearConfirmTimers(), []);

  async function handleCheckTap(e) {
    const today = todayStr();
    const hasTrue = habit.logs.some(l => l.date === today && l.value === true);
    if (hasTrue) {
      clearConfirmMessage();
      await onTap(habit.id, e);
      return;
    }
    const msg = dailyLogConfirmMessage(habit);
    await onTap(habit.id, e);
    showConfirmMessage(msg);
  }

  return (
    <div className="rc" style={cardStyle(logged && !isSkip, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged && !isSkip}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Daily{getHabitCardStreakSuffix(habit)}</div>
        </div>
        {onEditHabit && onDeleteHabit && <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />}
        {isSkip
          ? <button className="tap" onClick={() => onTap(habit.id, { currentTarget:{ getBoundingClientRect:() => ({left:0,top:0,width:0,height:0}) } })}
              style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${T.muted}`, background:T.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, transition:"all 0.18s" }}>🛡️</button>
          : <CheckBtn logged={logged} habit={habit} onClick={handleCheckTap}/>
        }
      </div>
      {!proofMode && confirmMsg && (
        <p style={{ fontSize:12, color:T.gold, margin:0, padding:"0 15px 10px", lineHeight:1.4, opacity:confirmFading?0:1, transition:"opacity 0.35s ease" }}>
          {confirmMsg}
        </p>
      )}
      {onEditHabit && onDeleteHabit && <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} onUnlinkProof={proofMode ? onUnlinkProof : null} onLinkProof={!proofMode ? onLinkProof : null} />}
      {isSkip && (
        <div style={{ margin:"0 15px 12px", background:"rgba(106,104,96,0.15)", borderRadius:T.rsm, padding:"8px 12px", display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🛡️</span>
            <span style={{ fontSize:12, fontWeight:500, color:T.muted }}>Rest day — streak protected</span>
          </div>
          {tLog?.note?.trim() ? <div style={{ fontSize:12, color:T.sub, lineHeight:1.5, paddingLeft:24, fontStyle:"italic" }}>{tLog.note.trim()}</div> : null}
        </div>
      )}
      {!proofMode && logged && !isSkip && <DoneBanner habit={habit}/>}
      {!proofMode && logged && !isSkip && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
      {!logged && (
        <div style={{ padding:"0 15px 12px" }}>
          {restOpen ? (
            <div style={{ borderRadius:T.rsm, border:`0.5px solid ${T.borderMid}`, background:T.surface, padding:"12px 12px 10px" }}>
              <label style={{ display:"block", fontSize:12, fontWeight:500, color:T.text, marginBottom:6 }}>Why a rest day? <span style={{ fontWeight:400, color:T.hint }}>(optional)</span></label>
              <textarea value={restWhy} onChange={e => setRestWhy(e.target.value)} placeholder="Travel, recovery, life got busy…" rows={2} maxLength={200}
                style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font, lineHeight:1.45, marginBottom:10 }}/>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
                <button type="button" onClick={() => { setRestOpen(false); setRestWhy(""); }}
                  style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"8px 14px", cursor:"pointer" }}>Cancel</button>
                <button type="button" onClick={() => { onSkip(habit.id, restWhy.trim()); setRestOpen(false); setRestWhy(""); }}
                  style={{ fontSize:12, fontWeight:600, color:"#1a1208", background:T.amber, border:"none", borderRadius:T.rsm, padding:"8px 16px", cursor:"pointer" }}>Confirm rest day</button>
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button type="button" onClick={() => { setRestOpen(true); setRestWhy(""); }}
                style={{ fontSize:12, color:T.hint, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>🛡️ Rest day</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── WEEKLY CARD ──────────────────────────────────────────────────────────────
export function WeeklyCard({ habit, onTap, onSkip, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit, proofMode = false, onUnlinkProof = null, onLinkProof = null }) {
  const t = todayStr();
  const isSkip = hasRestDay(habit, t);
  const sessionToday = habit.logs.some(l => l.date === t && l.value === true);
  const satisfied = isSatisfiedForTodayRing(habit);
  const wk = getWeeklyCount(habit);
  const pct = Math.min(100, Math.round((wk / habit.weeklyTarget) * 100));
  const targetMet = wk >= (habit.weeklyTarget || 1);
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [restWhy, setRestWhy] = useState("");
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  useEffect(() => { if (sessionToday || isSkip) { setRestOpen(false); setRestWhy(""); } }, [sessionToday, isSkip]);
  const checkLogged = satisfied && !isSkip;
  return (
    <div className="rc" style={cardStyle(satisfied, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={checkLogged}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{wk}/{habit.weeklyTarget} sessions this week{getHabitCardStreakSuffix(habit)}</div>
        </div>
        {onEditHabit && onDeleteHabit && <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />}
        {isSkip
          ? <button className="tap" onClick={() => onTap(habit.id, { currentTarget:{ getBoundingClientRect:() => ({left:0,top:0,width:0,height:0}) } })}
              style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, border:`2px solid ${T.muted}`, background:T.surface, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, transition:"all 0.18s" }}>🛡️</button>
          : <CheckBtn logged={checkLogged} habit={habit} onClick={e => onTap(habit.id, e)}/>}
      </div>
      {onEditHabit && onDeleteHabit && <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} onUnlinkProof={proofMode ? onUnlinkProof : null} onLinkProof={!proofMode ? onLinkProof : null} />}
      <div style={{ padding:"0 15px 14px" }}>
        <div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden", marginBottom:8 }}>
          <div style={{ height:"100%", borderRadius:3, background:pct>=100?T.goldBright:habit.color, width:`${pct}%`, transition:"width 0.5s ease" }}/>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {Array.from({length:habit.weeklyTarget}, (_, i) => (
            <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:i<wk?habit.color:T.surface, transition:"background 0.3s" }}/>
          ))}
          <span style={{ fontSize:11, color:T.muted, marginLeft:"auto" }}>{wk >= habit.weeklyTarget ? "Target hit! 🎉" : `${habit.weeklyTarget - wk} more to go`}</span>
        </div>
        {targetMet && !sessionToday && !isSkip && <div style={{ fontSize:11, color:T.hint, marginTop:8, lineHeight:1.45 }}>Weekly target met — no session needed today for your ring.</div>}
      </div>
      {isSkip && (
        <div style={{ margin:"0 15px 12px", background:"rgba(106,104,96,0.15)", borderRadius:T.rsm, padding:"8px 12px", display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🛡️</span>
            <span style={{ fontSize:12, fontWeight:500, color:T.muted }}>Weekly rest day — ring counts this; sessions this week unchanged</span>
          </div>
          {habit.logs.find(l => l.date === t && l.value === "skip")?.note?.trim() ? (
            <div style={{ fontSize:12, color:T.sub, lineHeight:1.5, paddingLeft:24, fontStyle:"italic" }}>{String(habit.logs.find(l => l.date === t && l.value === "skip").note).trim()}</div>
          ) : null}
        </div>
      )}
      {!proofMode && sessionToday && !isSkip && <DoneBanner habit={habit}/>}
      {!proofMode && sessionToday && !isSkip && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
      {!sessionToday && !isSkip && !targetMet && (
        <div style={{ padding:"0 15px 12px" }}>
          {restOpen ? (
            <div style={{ borderRadius:T.rsm, border:`0.5px solid ${T.borderMid}`, background:T.surface, padding:"12px 12px 10px" }}>
              <label style={{ display:"block", fontSize:12, fontWeight:500, color:T.text, marginBottom:6 }}>Weekly rest day? <span style={{ fontWeight:400, color:T.hint }}>(optional note)</span></label>
              <textarea value={restWhy} onChange={e => setRestWhy(e.target.value)} placeholder="Recovery, travel, light week…" rows={2} maxLength={200}
                style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font, lineHeight:1.45, marginBottom:10 }}/>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
                <button type="button" onClick={() => { setRestOpen(false); setRestWhy(""); }}
                  style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"8px 14px", cursor:"pointer" }}>Cancel</button>
                <button type="button" onClick={() => { onSkip(habit.id, restWhy.trim()); setRestOpen(false); setRestWhy(""); }}
                  style={{ fontSize:12, fontWeight:600, color:"#1a1208", background:T.amber, border:"none", borderRadius:T.rsm, padding:"8px 16px", cursor:"pointer" }}>Confirm weekly rest</button>
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button type="button" onClick={() => { setRestOpen(true); setRestWhy(""); }}
                style={{ fontSize:12, color:T.hint, background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}>🛡️ Weekly rest day</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PROJECT CARD ─────────────────────────────────────────────────────────────
export function ProjectCard({ habit, onOpenLog, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit, proofMode = false, onUnlinkProof = null, onLinkProof = null }) {
  const stats = getProjectStats(habit);
  const tLogs = todayLogs(habit);
  const logged = tLogs.length > 0;
  const todayMins = tLogs.reduce((s, l) => s + (l.value?.minutes || 0), 0);
  const dailyBuildTarget = habit.dailyTargetMinutes ?? 60;
  const streakPhrase = (() => {
    const s = getBuildStreak(habit);
    if (s <= 0) return "";
    if (s > 1) return ` · 🔥 ${s} day streak`;
    const todayOk = qualifiesBuildDay(habit, todayStr());
    const yestOk  = qualifiesBuildDay(habit, daysAgo(1));
    if (todayOk && !yestOk) return " · Started today";
    return " · 🔥 1 day streak";
  })();
  const lastWin = [...habit.logs].filter(l => l.value?.win).pop();
  const sessionsSuffix = tLogs.length > 1 ? ` (${tLogs.length} sessions)` : "";
  const buildMeta = logged
    ? todayMins > dailyBuildTarget
      ? `${todayMins} min today (goal: ${dailyBuildTarget})${sessionsSuffix}${streakPhrase}`
      : `${todayMins}/${dailyBuildTarget} min today${sessionsSuffix}${streakPhrase}`
    : `Tap + to log a session${streakPhrase}`;
  const buildMetaDisplay = truncateText(buildMeta, 68);
  const latestWinDisplay = truncateText(lastWin?.value?.win || "", 96);
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));
  return (
    <div className="rc" style={cardStyle(logged, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={logged}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div title={buildMeta} style={{ fontSize:12, color:T.muted, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{buildMetaDisplay}</div>
        </div>
        {onEditHabit && onDeleteHabit && <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />}
        <PlusBtn habit={habit} logged={logged} onClick={() => onOpenLog(habit.id)}/>
      </div>
      {onEditHabit && onDeleteHabit && <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} onUnlinkProof={proofMode ? onUnlinkProof : null} onLinkProof={!proofMode ? onLinkProof : null} />}
      <div style={{ padding:"0 15px 14px", display:"flex", gap:8 }}>
        <Stat label="hrs this wk" value={stats.weekHours} color={habit.color}/>
        <Stat label="total hrs" value={stats.totalHours}/>
        <Stat label="wins" value={stats.wins} color={T.green}/>
        <Stat label="hard parts" value={stats.hard} color={T.amber}/>
      </div>
      {lastWin && (
        <div style={{ margin:"0 15px 14px", background:T.surface, borderRadius:T.rsm, padding:"10px 12px" }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Latest win</div>
          <div title={lastWin.value.win} style={{ fontSize:12, color:T.sub, lineHeight:1.5 }}>{latestWinDisplay}</div>
        </div>
      )}
      {!proofMode && logged && <DoneBanner habit={habit}/>}
      {!proofMode && logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
    </div>
  );
}

// ─── LIMIT CARD ───────────────────────────────────────────────────────────────
export function LimitCard({ habit, onTap, onUndo, onLogZero, onAddNote, onEditHabit, onDeleteHabit, onShareHabit, sharingThisHabit, onLowerBudget, onOpenCoachWithDraft, proofMode = false, onUnlinkProof = null, onLinkProof = null }) {
  const todayLogsArr = habit.logs.filter(l => l.date === todayStr() && l.value !== "quicknote");
  const used   = todayLogsArr.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0);
  const budget = habit.dailyBudget || 60;
  const pct    = Math.min(120, Math.round((used / budget) * 100));
  const barColor = pct < 60 ? T.green : pct < 90 ? T.amber : T.accent;
  const over     = used > budget;
  const logged   = todayLogsArr.length > 0;
  const inc      = habit.tapIncrement ?? 1;
  const unitSuffix = habit.unit && habit.unit !== "logged" ? ` ${habit.unit}` : "";
  const limitMetaColor = logged ? (over ? T.accent : T.green) : T.hint;
  const [habitMenuOpen, setHabitMenuOpen] = useState(false);
  /** 0 idle, 1 snap green, 2 fade to normal (Option A counter flash) */
  const [countFlashPhase, setCountFlashPhase] = useState(0);
  const countFlashSeqRef = useRef(0);
  const longPeek = useTodayHabitLongPeekHandlers(setHabitMenuOpen, !!(onEditHabit && onDeleteHabit));

  // ── Reduce nudge: show when goalAim=reduce and user is consistently under
  const goalAim = habit.goalAim ?? "maintain";
  let reduceNudge = null;
  if (goalAim === "reduce") {
    let daysLogged = 0, daysUnder = 0, totalUsage = 0;
    for (let d = 0; d < 7; d++) {
      const dayTotal = getLimitDayTotal(habit, daysAgo(d));
      if (dayTotal !== null) {
        daysLogged++;
        totalUsage += dayTotal;
        if (dayTotal <= budget) daysUnder++;
      }
    }
    if (daysLogged >= 4 && daysUnder >= 5) {
      const avgUsage = Math.round((totalUsage / daysLogged) * 10) / 10;
      if (avgUsage < budget * 0.7) {
        const suggested = Math.max(1, Math.min(Math.ceil(avgUsage), budget - 1));
        reduceNudge = { avgUsage, suggested };
      }
    }
  }

  function handleLimitPlusTap(e) {
    const seq = ++countFlashSeqRef.current;
    setCountFlashPhase(1);
    onTap(habit.id, e);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (countFlashSeqRef.current !== seq) return;
        setCountFlashPhase(2);
        window.setTimeout(() => {
          if (countFlashSeqRef.current !== seq) return;
          setCountFlashPhase(0);
        }, 600);
      });
    });
  }

  const countColor = countFlashPhase === 1 ? T.green : limitMetaColor;
  const countTransition = countFlashPhase === 1 ? "none" : "color 0.6s ease";
  return (
    <div className="rc" style={{ ...cardStyle(false, habit), borderColor:over?T.accent+"66":T.border, background:over?`${T.accent}0A`:T.raised }} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={false}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, marginTop:2, lineHeight:1.4 }}>
            {logged ? (
              <span style={{ color:countColor, fontWeight:500, transition:countTransition }}>{used}/{budget} today{unitSuffix}</span>
            ) : (
              <span style={{ color:T.hint }}>Limit <span style={{ color:T.muted, fontWeight:500 }}>{budget}{unitSuffix}</span><span style={{ color:T.hint }}> · not logged yet</span></span>
            )}
            <span style={{ color:T.muted }}>{getHabitCardStreakSuffix(habit)}{inc > 1 ? ` · +${inc} per tap` : ""}</span>
          </div>
        </div>
        {onEditHabit && onDeleteHabit && <TodayOverflowDotsBtn expanded={habitMenuOpen} onToggle={() => setHabitMenuOpen(p => !p)} />}
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          {logged && <button className="tap" onClick={() => onUndo(habit.id)} style={{ width:40, height:40, borderRadius:"50%", border:`1.5px solid ${T.borderMid}`, background:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:T.muted, transition:"all 0.18s" }}>−</button>}
          <button className="tap" onClick={handleLimitPlusTap} style={{ width:44, height:44, borderRadius:"50%", border:`2px solid ${habit.color+"66"}`, background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, color:habit.color, fontWeight:300, transition:"all 0.18s" }}>+</button>
        </div>
      </div>
      {onEditHabit && onDeleteHabit && <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} onShareHabit={onShareHabit} shareSaving={!!sharingThisHabit} menuOpen={habitMenuOpen} onCloseMenu={() => setHabitMenuOpen(false)} onUnlinkProof={proofMode ? onUnlinkProof : null} onLinkProof={!proofMode ? onLinkProof : null} />}
      {logged ? (
        <div style={{ padding:"0 15px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.muted, marginBottom:5 }}>
            <span style={{ color:countColor, transition:countTransition }}>{used}/{budget} {habit.unit || "logged"}</span>
            <span style={{ color:barColor, fontWeight:500 }}>{over ? `${used - budget} over limit` : `${budget - used} remaining`}</span>
          </div>
          <div style={{ height:6, background:T.surface, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:3, background:barColor, width:`${Math.min(100, pct)}%`, transition:"width 0.4s ease" }}/>
          </div>
        </div>
      ) : (
        <div style={{ padding:"0 15px 14px", display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ height:6, flex:1, background:T.surface, borderRadius:3, opacity:0.3 }}/>
          <span style={{ fontSize:11, color:T.hint, flexShrink:0, textAlign:"right", maxWidth:"42%" }}>Under limit once you log · or mark none</span>
          <button onClick={() => onLogZero(habit.id)} title="Mark that you had none today"
            style={{ fontSize:11, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"3px 9px", cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" }}>None today</button>
        </div>
      )}
      {reduceNudge && (
        <div style={{ padding:"8px 15px 10px", borderTop:`0.5px solid ${T.border}`, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:T.muted, flex:1, minWidth:120, lineHeight:1.35 }}>
            Averaging {reduceNudge.avgUsage}{unitSuffix}/day — ready to try {reduceNudge.suggested}?
          </span>
          {onLowerBudget && (
            <button
              onClick={() => onLowerBudget(habit.id, reduceNudge.suggested, budget)}
              style={{ fontSize:11, fontWeight:600, color:T.green, background:"none", border:`0.5px solid ${T.green}55`, borderRadius:T.rsm, padding:"3px 9px", cursor:"pointer", whiteSpace:"nowrap" }}>
              Lower to {reduceNudge.suggested}
            </button>
          )}
          {onOpenCoachWithDraft && (
            <button
              onClick={() => onOpenCoachWithDraft(`My ${habit.name} limit is ${budget}${unitSuffix}/day but I've been averaging ${reduceNudge.avgUsage}${unitSuffix} — what do you think about lowering it?`)}
              style={{ fontSize:11, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"3px 9px", cursor:"pointer", whiteSpace:"nowrap" }}>
              Ask companion
            </button>
          )}
        </div>
      )}
      {!proofMode && logged && <NoteStrip habitId={habit.id} habit={habit} onAddNote={onAddNote}/>}
    </div>
  );
}

// ─── LOG CARD (journal-style habit) ──────────────────────────────────────────
export function LogCard({ habit, onSaveEntry, onEditHabit, onDeleteHabit }) {
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const today = todayStr();
  const todays = habit.logs.filter(l => l.date === today && l.value === "log");
  const longPeek = useTodayHabitLongPeekHandlers(setMenuOpen, !!(onEditHabit && onDeleteHabit));

  async function save() {
    const t = draft.trim();
    if (!t) return;
    const ok = await onSaveEntry(habit.id, t);
    if (ok !== false) setDraft("");
  }

  return (
    <div className="rc" style={cardStyle(false, habit)} {...longPeek}>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px" }}>
        <IconBox habit={habit} logged={false}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Log · {todays.length} today</div>
        </div>
        {onEditHabit && onDeleteHabit && <TodayOverflowDotsBtn expanded={menuOpen} onToggle={() => setMenuOpen(p => !p)} />}
      </div>
      {menuOpen && onEditHabit && onDeleteHabit && (
        <TodayHabitMenuDropdown habit={habit} onEdit={onEditHabit} onDelete={onDeleteHabit} menuOpen={menuOpen} onCloseMenu={() => setMenuOpen(false)} />
      )}
      <div style={{ padding:"0 15px 14px" }}>
        <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write an entry for today…" rows={3}
          style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:T.surface, color:T.text, fontSize:16, padding:10, fontFamily:T.font, lineHeight:1.5 }}/>
        <PBtn color={habit.color} style={{ marginTop:10 }} onClick={() => void save()}>Save entry</PBtn>
      </div>
    </div>
  );
}

// ─── LINK HABITS SHEET ────────────────────────────────────────────────────────
export function LinkHabitsSheet({ goal, habits, onSave, onClose }) {
  useScrollLock(true);
  const existingLinks = (goal.logs || []).find(l => l.type === "goal_links")?.habitIds || [];
  const [selected, setSelected] = useState(new Set(existingLinks));
  const trackable = habits.filter(h => ["daily","weekly","project","limit"].includes(h.habitType));
  function toggle(id) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.72)", zIndex:500, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", maxHeight:"min(70dvh, 70vh)", display:"flex", flexDirection:"column", touchAction:"auto" }}>
        <div style={{ padding:"18px 18px 14px", borderBottom:`0.5px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text }}>Link habits</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:3 }}>Choose habits that support this goal. They'll appear in the goal detail view.</div>
        </div>
        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"12px 16px" }}>
          {trackable.length === 0 ? (
            <div style={{ fontSize:13, color:T.muted, textAlign:"center", padding:"24px 0" }}>No habits to link yet.</div>
          ) : trackable.map(h => {
            const isOn = selected.has(String(h.id));
            return (
              <button key={h.id} type="button" onClick={() => toggle(String(h.id))}
                style={{ display:"flex", alignItems:"center", gap:12, width:"100%", padding:"11px 12px", borderRadius:T.rsm, border:`0.5px solid ${isOn?h.color+"66":T.border}`, background:isOn?h.color+"0D":T.surface, marginBottom:8, cursor:"pointer", textAlign:"left" }}>
                <span style={{ fontSize:18 }}>{h.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, color:T.text, fontWeight:isOn?500:400 }}>{h.name}</div>
                  <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{h.habitType}</div>
                </div>
                <div style={{ width:20, height:20, borderRadius:"50%", border:`1.5px solid ${isOn?h.color:T.borderStrong}`, background:isOn?h.color:"none", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {isOn && <span style={{ fontSize:10, color:"#fff" }}>✓</span>}
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ padding:"12px 16px 32px", borderTop:`0.5px solid ${T.border}`, display:"flex", gap:10, flexShrink:0 }}>
          <button type="button" onClick={() => onSave([...selected])} style={{ flex:1, padding:"11px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Save</button>
          <button type="button" onClick={onClose} style={{ padding:"11px 18px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── GOAL DETAIL SHEET ────────────────────────────────────────────────────────
export function GoalDetailSheet({ goal, habits, onClose, onLog, onEdit, onComplete, onDelete, onCheckin, onLinkHabits }) {
  useScrollLock(true);
  const [tab, setTab] = useState("overview");
  const [showLinkSheet, setShowLinkSheet] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const stats  = getGoalProgress(goal);
  const pacing = getGoalPacing(goal);
  const today  = todayStr();
  const thisWeek = weekStartFor(today);

  const numericLogs  = (goal.logs || []).filter(l => typeof l.value === "number").sort((a, b) => b.date.localeCompare(a.date));
  const milestones   = (goal.logs || []).filter(l => l.type === "milestone").sort((a, b) => a.date.localeCompare(b.date));
  const checkIns     = (goal.logs || []).filter(l => l.type === "checkin").sort((a, b) => b.date.localeCompare(a.date));
  const whyEntry     = (goal.logs || []).find(l => l.type === "goal_why");
  const linksEntry   = (goal.logs || []).find(l => l.type === "goal_links");
  const linkedIds    = new Set(linksEntry?.habitIds?.map(String) || []);
  const linkedHabits = habits.filter(h => linkedIds.has(String(h.id)));
  const thisWeekCheckIn = checkIns.find(c => c.date === thisWeek);

  const CHECK_IN_EMOJIS = ["😰", "😕", "😐", "🙂", "💪"];
  const pacingColors = { ahead:"#27AE60", "on-track":"#27AE60", behind:"#E74C3C", overdue:"#E74C3C", complete:"#27AE60" };
  const pacingLabels = { ahead:"Ahead of pace 🔥", "on-track":"On track ✓", behind:"Behind pace — push it", overdue:"Past deadline", complete:"Completed 🎉" };

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.75)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"22px 22px 0 0", maxHeight:"min(88dvh, 88vh)", display:"flex", flexDirection:"column", touchAction:"auto" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"12px auto 0", flexShrink:0 }}/>
        <div style={{ padding:"14px 18px 0", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
            <div style={{ width:46, height:46, borderRadius:13, background:goal.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{goal.emoji || "🎯"}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, lineHeight:1.25 }}>{goal.name}</div>
              {whyEntry && <div style={{ fontSize:12, color:T.muted, marginTop:3, fontStyle:"italic", lineHeight:1.4 }}>"{whyEntry.label}"</div>}
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 0 0 4px", flexShrink:0, marginTop:-2 }}>×</button>
          </div>
          <div style={{ margin:"14px 0 10px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ fontSize:13, color:T.muted }}>
                <strong style={{ fontSize:16, color:goal.color }}>{goal.currentValue}{goal.unit}</strong>
                <span style={{ color:T.hint }}> / {goal.targetValue}{goal.unit}</span>
              </div>
              <div style={{ fontSize:13, fontWeight:600, color:stats.isComplete?T.green:goal.color }}>{stats.pct}%</div>
            </div>
            <div style={{ height:8, background:T.surface, borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", borderRadius:4, background:stats.isComplete?T.green:goal.color, width:`${Math.max(stats.pct, 4)}%`, transition:"width 0.4s ease" }}/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6, gap:8, flexWrap:"wrap" }}>
              <div style={{ fontSize:11, color:T.muted }}>{!stats.isComplete && stats.toGo > 0 ? `${formatWithUnit(stats.toGo, goal.unit)} to go` : ""}</div>
              {pacing && (
                <div style={{ fontSize:11, fontWeight:600, color:pacingColors[pacing.status]||T.muted, background:(pacingColors[pacing.status]||T.muted)+"15", border:`0.5px solid ${(pacingColors[pacing.status]||T.muted)}33`, borderRadius:10, padding:"2px 8px" }}>
                  {pacingLabels[pacing.status] || ""}{pacing.daysLeft > 0 ? ` · ${pacing.daysLeft}d left` : ""}
                </div>
              )}
            </div>
          </div>
          <div style={{ display:"flex", background:T.surface, borderRadius:T.rsm, padding:3, gap:2 }}>
            {[["overview","Overview"],["history",`History (${numericLogs.length})`],["linked",`Linked (${linkedHabits.length})`]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                style={{ flex:1, padding:"6px 4px", borderRadius:7, border:"none", cursor:"pointer", background:tab===id?T.raised:"none", color:tab===id?T.text:T.muted, fontSize:11, fontWeight:500, transition:"all 0.15s" }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", padding:"14px 18px 24px" }}>
          {tab === "overview" && (
            <>
              {!stats.isComplete && (
                <div style={{ marginBottom:18, padding:"13px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${thisWeekCheckIn?T.border:"rgba(200,144,42,0.3)"}` }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:thisWeekCheckIn?T.hint:T.gold, marginBottom:8 }}>
                    {thisWeekCheckIn ? "This week's check-in" : "How's it going this week?"}
                  </div>
                  <div style={{ display:"flex", gap:6, justifyContent:"space-between" }}>
                    {CHECK_IN_EMOJIS.map((em, i) => {
                      const rating = i + 1;
                      const isSelected = thisWeekCheckIn?.rating === rating;
                      return (
                        <button key={i} type="button" onClick={() => { if (!thisWeekCheckIn) onCheckin(goal.id, rating, ""); }} disabled={!!thisWeekCheckIn}
                          style={{ flex:1, padding:"8px 0", borderRadius:10, border:`1px solid ${isSelected?T.gold:T.border}`, background:isSelected?"rgba(200,144,42,0.15)":"none", fontSize:22, cursor:thisWeekCheckIn?"default":"pointer", transition:"all 0.15s", opacity:thisWeekCheckIn&&!isSelected?0.4:1 }}>
                          {em}
                        </button>
                      );
                    })}
                  </div>
                  {thisWeekCheckIn?.note ? <div style={{ fontSize:12, color:T.muted, marginTop:8, fontStyle:"italic" }}>"{thisWeekCheckIn.note}"</div> : null}
                  {!thisWeekCheckIn && <div style={{ fontSize:10, color:T.hint, marginTop:6, textAlign:"center" }}>Tap to record • saved automatically</div>}
                </div>
              )}
              {milestones.length > 0 && (
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.07em", textTransform:"uppercase", color:T.hint, marginBottom:8 }}>Milestones</div>
                  {milestones.map((m, i) => {
                    const isPast  = m.date < today;
                    const isToday = m.date === today;
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10 }}>
                        <div style={{ flexShrink:0, width:28, height:28, borderRadius:"50%", background:isPast?T.surface:"rgba(200,144,42,0.12)", border:`1px solid ${isPast?T.border:"rgba(200,144,42,0.4)"}`, display:"flex", alignItems:"center", justifyContent:"center", marginTop:1 }}>
                          <span style={{ fontSize:12 }}>{isPast ? "✓" : "◆"}</span>
                        </div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, color:isPast?T.muted:T.text, fontWeight:isPast?400:500, textDecoration:isPast?"line-through":"none" }}>{m.label}</div>
                          <div style={{ fontSize:11, color:isToday?T.gold:T.hint, marginTop:1 }}>
                            {isToday ? "Today" : fmtGoalDueHuman(m.date)}
                            {!isPast && !isToday && (() => { const d = Math.round((parseLocal(m.date) - parseLocal(today)) / 86400000); return d > 0 ? ` · ${d}d away` : ""; })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {goal.targetDate && (
                <div style={{ marginBottom:18, display:"flex", alignItems:"center", gap:8, padding:"10px 12px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
                  <span style={{ fontSize:16 }}>🎯</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:T.text, fontWeight:500 }}>Deadline: {fmtGoalDueHuman(goal.targetDate)}</div>
                    {pacing?.daysLeft > 0 && <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{pacing.daysLeft} days remaining</div>}
                    {pacing?.daysLeft === 0 && <div style={{ fontSize:11, color:T.amber }}>Today is the deadline</div>}
                    {pacing?.daysLeft < 0 && <div style={{ fontSize:11, color:"#E74C3C" }}>Overdue by {Math.abs(pacing.daysLeft)} days</div>}
                  </div>
                </div>
              )}
              {!stats.isComplete && (
                <button type="button" onClick={() => { onClose(); onLog(goal.id); }}
                  style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, width:"100%", padding:"12px", borderRadius:T.rsm, border:`0.5px solid ${goal.color+"55"}`, background:goal.color+"0D", color:goal.color, fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:14 }}>
                  + Log progress
                </button>
              )}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button type="button" onClick={() => { onClose(); onEdit(goal.id); }}
                  style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>Edit goal</button>
                {!stats.isComplete && (
                  <button type="button" onClick={() => { onComplete(goal.id); onClose(); }}
                    style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid rgba(39,174,96,0.35)`, background:"none", color:T.green, fontSize:12, cursor:"pointer" }}>Mark complete</button>
                )}
                {!deleteConfirm ? (
                  <button type="button" onClick={() => setDeleteConfirm(true)}
                    style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid rgba(231,76,60,0.3)`, background:"none", color:"#e74c3c", fontSize:12, cursor:"pointer", marginLeft:"auto" }}>Delete</button>
                ) : (
                  <>
                    <span style={{ fontSize:12, color:T.muted, alignSelf:"center", marginLeft:"auto" }}>Sure?</span>
                    <button type="button" onClick={() => { onDelete(goal.id); onClose(); }} style={{ padding:"7px 14px", borderRadius:T.rsm, border:"none", background:"rgba(231,76,60,0.15)", color:"#e74c3c", fontSize:12, fontWeight:600, cursor:"pointer" }}>Delete</button>
                    <button type="button" onClick={() => setDeleteConfirm(false)} style={{ padding:"7px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>Cancel</button>
                  </>
                )}
              </div>
            </>
          )}
          {tab === "history" && (
            <>
              {numericLogs.length === 0 && checkIns.length === 0 ? (
                <div style={{ textAlign:"center", padding:"32px 0", color:T.muted, fontSize:13 }}>No entries yet — tap "Log progress" to start.</div>
              ) : null}
              {[
                ...numericLogs.map(l => ({ ...l, _kind:"value" })),
                ...checkIns.map(l => ({ ...l, _kind:"checkin" })),
              ].sort((a, b) => b.date.localeCompare(a.date)).map((entry, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:12, alignItems:"flex-start" }}>
                  <div style={{ flexShrink:0, width:7, height:7, borderRadius:"50%", background:entry._kind==="checkin"?T.gold:goal.color, marginTop:5 }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, color:T.hint }}>{fmtEntryDate(entry.date)}</div>
                    {entry._kind === "value" ? (
                      <div style={{ fontSize:14, color:T.text, fontWeight:500, marginTop:1 }}>
                        {entry.value}{goal.unit}
                        {entry.note ? <span style={{ fontSize:12, color:T.muted, fontWeight:400 }}> — {entry.note}</span> : null}
                      </div>
                    ) : (
                      <div style={{ fontSize:20, marginTop:1 }} title={`Rating: ${entry.rating}/5`}>
                        {CHECK_IN_EMOJIS[(entry.rating || 1) - 1]}
                        {entry.note ? <span style={{ fontSize:12, color:T.muted, marginLeft:6 }}>"{entry.note}"</span> : null}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
          {tab === "linked" && (
            <>
              <button type="button" onClick={() => setShowLinkSheet(true)}
                style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%", padding:"11px", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:T.surface, color:T.muted, fontSize:13, cursor:"pointer", marginBottom:14 }}>
                <span style={{ fontSize:16 }}>＋</span> {linkedHabits.length > 0 ? "Edit linked habits" : "Link habits to this goal"}
              </button>
              {linkedHabits.length === 0 ? (
                <div style={{ textAlign:"center", padding:"16px 0 32px", color:T.hint, fontSize:12, lineHeight:1.6 }}>
                  Link habits that support this goal.<br/>They'll appear here so you can see how your daily practice connects to the outcome.
                </div>
              ) : linkedHabits.map(h => {
                const streak = getStreak(h);
                return (
                  <div key={h.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 13px", borderRadius:T.rsm, background:T.surface, border:`0.5px solid ${T.border}`, marginBottom:8 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:h.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{h.emoji}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, color:T.text, fontWeight:500 }}>{h.name}</div>
                      <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{streak > 0 ? `${streak} day streak` : "No streak yet"}{" · "}{h.habitType}</div>
                    </div>
                    {streak > 0 && <div style={{ fontSize:11, color:T.gold, fontWeight:600, background:"rgba(200,144,42,0.12)", borderRadius:8, padding:"3px 8px" }}>🔥 {streak}</div>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
      {showLinkSheet && (
        <LinkHabitsSheet goal={goal} habits={habits} onSave={habitIds => { onLinkHabits(goal.id, habitIds); setShowLinkSheet(false); }} onClose={() => setShowLinkSheet(false)}/>
      )}
    </div>
  );
}

// ─── TODAY GOAL CARD ──────────────────────────────────────────────────────────
export function TodayGoalCard({ goal, onOpenLog, onEdit, onComplete, onDelete, onShareGoal, onOpen, onUnlinkProof = null, onLinkProof = null }) {
  const stats = getGoalProgress(goal);
  const { isComplete } = stats;
  const barFillPct = goalBarFillWidthPct(stats);
  const today = todayStr();
  const loggedToday = goal.logs?.some(l => l.date === today && typeof l.value === "number") || false;
  const statusText = getGoalStatusText(goal, stats);
  const deadlineLine = goalTodayDeadlineLine(goal, stats, isComplete);
  const nextMilestone = !isComplete
    ? (goal.logs || []).filter(l => l.type === "milestone" && l.date && l.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null
    : null;
  const msInDays = nextMilestone ? Math.round((parseLocal(nextMilestone.date) - parseLocal(today)) / 86400000) : null;
  const [showMenu, setShowMenu] = useState(false);
  const [goalDeleteConfirm, setGoalDeleteConfirm] = useState(false);
  useEffect(() => { if (!showMenu) setGoalDeleteConfirm(false); }, [showMenu]);
  return (
    <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} className="rc"
      style={{ margin:"0 14px 10px", background:loggedToday?`${goal.color}0D`:T.raised, borderRadius:T.r, border:`0.5px solid ${loggedToday?goal.color+"66":T.border}`, overflow:"hidden" }}>
      <div role={onOpen?"button":undefined} onClick={onOpen?(e) => { e.stopPropagation(); onOpen(goal.id); }:undefined}
        style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 15px", cursor:onOpen?"pointer":"default" }}>
        <div style={{ width:40, height:40, borderRadius:11, background:goal.color+"20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{goal.emoji}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:500, color:T.text }}>{goal.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:1 }}>
            <strong style={{ color:goal.color }}>{goal.currentValue}{goal.unit}</strong>
            {" → "}<strong style={{ color:T.text }}>{goal.targetValue}{goal.unit}</strong>
            <span style={{ marginLeft:6, color:isComplete?T.green:T.hint }}>{statusText}</span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {!isComplete && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpenLog(goal.id); }}
              style={{ fontSize:12, color:goal.color, background:"none", border:`0.5px solid ${goal.color+"55"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Log</button>
          )}
          <TodayOverflowDotsBtn expanded={showMenu} onToggle={(e) => { e&&e.stopPropagation(); setShowMenu(m => !m); }} />
        </div>
      </div>
      <div style={{ padding:"0 15px 14px" }}>
        <div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:"100%", borderRadius:3, background:isComplete?T.green:goal.color, width:`${barFillPct}%`, transition:"width 0.4s ease" }}/>
        </div>
        {deadlineLine ? <div style={{ fontSize:11, color:T.sub, marginTop:7, lineHeight:1.45 }}>{deadlineLine}</div> : null}
        {nextMilestone && (
          <div style={{ marginTop:7, display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:10, background:"rgba(200,144,42,0.1)", border:"0.5px solid rgba(200,144,42,0.25)" }}>
            <span style={{ fontSize:9, color:T.gold }}>◆</span>
            <span style={{ fontSize:11, color:T.gold, fontWeight:500 }}>
              {nextMilestone.label}
              {msInDays != null && <span style={{ color:T.hint, fontWeight:400 }}>{" — "}{msInDays===0?"today":msInDays===1?"tomorrow":`${msInDays}d away`}</span>}
            </span>
          </div>
        )}
      </div>
      {showMenu && !goalDeleteConfirm && (
        <div role="menu" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
          style={{ borderTop:`0.5px solid ${T.border}`, padding:"8px 15px 10px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button type="button" onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onEdit(goal.id); setShowMenu(false); }}
            style={{ fontSize:12, color:goal.color, background:"none", border:`0.5px solid ${goal.color+"55"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Edit</button>
          {onShareGoal && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); onShareGoal(goal.id); }}
              style={{ fontSize:12, color:"#8B5CF6", background:"none", border:`0.5px solid rgba(139,92,246,0.4)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>
              {goal.sharedGoalId ? "Invite friends" : "Invite friends to this goal"}
            </button>
          )}
          {!isComplete && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onComplete(goal.id); setShowMenu(false); }}
              style={{ fontSize:12, color:T.green, background:"none", border:`0.5px solid ${T.green+"44"}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer" }}>Complete goal</button>
          )}
          {onUnlinkProof && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onUnlinkProof(goal.id); setShowMenu(false); }}
              style={{ fontSize:12, color:T.sub, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Move to Hub</button>
          )}
          {onLinkProof && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onLinkProof(goal.id); setShowMenu(false); }}
              style={{ fontSize:12, color:T.accent, background:"rgba(192,57,43,0.08)", border:`0.5px solid rgba(192,57,43,0.35)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Add to Arc</button>
          )}
          <button type="button" aria-label="Delete goal" onClick={(e) => { e.stopPropagation(); setGoalDeleteConfirm(true); }}
            style={{ fontSize:12, color:"#e74c3c", background:"none", border:`0.5px solid rgba(231,76,60,0.3)`, borderRadius:T.rsm, padding:"5px 12px", cursor:"pointer", fontWeight:500 }}>Delete</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
            style={{ fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", marginLeft:"auto" }}>Cancel</button>
        </div>
      )}
      {showMenu && goalDeleteConfirm && (
        <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
          <div style={{ padding:"10px 15px 6px", borderTop:`0.5px solid ${T.border}`, fontSize:13, fontWeight:500, color:T.text }}>Delete {goal.name}?</div>
          <div style={{ padding:"8px 15px 10px", display:"flex", alignItems:"center", gap:8, justifyContent:"flex-end" }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(goal.id); setShowMenu(false); }}
              style={{ fontSize:12, color:"#e74c3c", background:"rgba(231,76,60,0.1)", border:`0.5px solid rgba(231,76,60,0.4)`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer", fontWeight:500 }}>Delete</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setGoalDeleteConfirm(false); }}
              style={{ fontSize:12, color:T.muted, background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"5px 11px", cursor:"pointer" }}>Cancel</button>
          </div>
          <div style={{ padding:"0 15px 12px", fontSize:12, color:"rgba(231,76,60,0.8)" }}>
            This will permanently delete <strong>{goal.name}</strong> and its progress. {"This can't be undone."}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LOG PROJECT MODAL ────────────────────────────────────────────────────────
export function LogProjectModal({ habit, onClose, onLog }) {
  const [minutes, setMinutes] = useState("");
  const [win,  setWin]  = useState("");
  const [hard, setHard] = useState("");
  const [note, setNote] = useState("");
  const count = todayLogs(habit).length;
  const QUICK_MINS = [15, 30, 45, 60, 90, 120];
  const winSpeech  = useSpeechInput(t => setWin(p  => mergeDictationIntoText(p, t)));
  const hardSpeech = useSpeechInput(t => setHard(p => mergeDictationIntoText(p, t)));
  return (
    <Modal onClose={onClose}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
        <div style={{ width:48, height:48, borderRadius:14, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, flexShrink:0 }}>{habit.emoji}</div>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:20, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{count > 0 ? `Session ${count + 1} today` : "How did it go?"}</div>
        </div>
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Time spent</label>
        <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
          {QUICK_MINS.map(m => (
            <button key={m} onClick={() => setMinutes(String(m))}
              style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${minutes===String(m)?habit.color:T.borderStrong}`, background:minutes===String(m)?habit.color+"22":"none", color:minutes===String(m)?habit.color:T.muted, fontSize:12, fontWeight:minutes===String(m)?500:400, cursor:"pointer", transition:"all 0.15s" }}>
              {m}m
            </button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <input style={{ ...inp, flex:1, fontSize:18, textAlign:"center", padding:"12px" }} type="number" placeholder="or type minutes" value={minutes} onChange={e => setMinutes(e.target.value)} autoFocus/>
          <span style={{ fontSize:13, color:T.muted, flexShrink:0 }}>min</span>
        </div>
      </div>
      <div style={{ marginBottom:12 }}>
        <label style={lbl}>A win <span style={{ color:T.hint, fontWeight:400, textTransform:"none", letterSpacing:0 }}>(optional)</span></label>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ position:"relative", flex:1 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:16 }}>🏆</span>
            <input style={{ ...inp, paddingLeft:38, paddingRight:8 }} placeholder={winSpeech.listening?"Listening…":"Something that clicked or worked"} value={win} onChange={e => setWin(e.target.value)} maxLength={140}/>
          </div>
          <MicBtn speech={winSpeech} color={habit.color} size={30}/>
        </div>
        {winSpeech.interim && <div style={{ fontSize:12, color:T.hint, fontStyle:"italic", marginTop:4, paddingLeft:2 }}>{winSpeech.interim}…</div>}
        {winSpeech.speechError ? <div style={{ fontSize:11, color:T.accent, marginTop:6, lineHeight:1.5, whiteSpace:"pre-line" }}>{winSpeech.speechError}</div> : null}
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>A hard part <span style={{ color:T.hint, fontWeight:400, textTransform:"none", letterSpacing:0 }}>(optional)</span></label>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ position:"relative", flex:1 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:16 }}>🧱</span>
            <input style={{ ...inp, paddingLeft:38, paddingRight:8 }} placeholder={hardSpeech.listening?"Listening…":"Something that blocked you"} value={hard} onChange={e => setHard(e.target.value)} maxLength={140}/>
          </div>
          <MicBtn speech={hardSpeech} color={habit.color} size={30}/>
        </div>
        {hardSpeech.interim && <div style={{ fontSize:12, color:T.hint, fontStyle:"italic", marginTop:4, paddingLeft:2 }}>{hardSpeech.interim}…</div>}
        {hardSpeech.speechError ? <div style={{ fontSize:11, color:T.accent, marginTop:6, lineHeight:1.5, whiteSpace:"pre-line" }}>{hardSpeech.speechError}</div> : null}
      </div>
      <PBtn color={habit.color} onClick={() => { onLog(habit.id, { value:{ minutes:parseInt(minutes)||0, win:win.trim()||null, hardPart:hard.trim()||null }, note }); onClose(); }}>Log session</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── REFLECT MODAL ────────────────────────────────────────────────────────────
export function ReflectModal({ habit, onClose, onSave }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const speech = useSpeechInput(transcript => setText(p => mergeDictationIntoText(p, transcript)));
  if (!habit) return null;
  const past = habit.logs.filter(l => l.reflection).slice(-4).reverse();
  function handleSave() {
    const interimSnap = polishInterimDisplay(speech.interim || "").trim();
    if (speech.listening) speech.toggle();
    const combined = mergeDictationIntoText(text.trim(), interimSnap).trim();
    if (!combined) { onClose(); return; }
    onSave(habit.id, combined);
    setSaved(true);
    setTimeout(onClose, 700);
  }
  return (
    <Modal onClose={onClose}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
        <span style={{ fontSize:24 }}>{habit.emoji}</span>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text }}>{habit.name}</div>
      </div>
      {getStreak(habit) > 0 && <div style={{ fontSize:12, color:T.gold, marginBottom:16 }}>🔥 {getStreak(habit)} streak</div>}
      <div style={{ background:T.surface, borderRadius:T.rsm, padding:"11px 14px", fontSize:13, color:T.sub, fontStyle:"italic", marginBottom:16, borderLeft:`2px solid ${habit.color}` }}>
        {habit.reflectionPrompt || "How did it go? What do you want to remember?"}
      </div>
      {saved ? (
        <div style={{ textAlign:"center", padding:"28px 0", fontSize:16, color:T.green }}>✓ Saved</div>
      ) : (
        <div style={{ position:"relative", marginBottom:speech.interim?6:0 }}>
          <textarea value={text} onChange={e => setText(e.target.value)}
            style={{ width:"100%", border:`0.5px solid ${speech.listening?habit.color+"66":T.borderStrong}`, borderRadius:T.rsm, background:T.surface, padding:12, paddingBottom:40, fontSize:14, color:T.text, resize:"none", minHeight:130, lineHeight:1.6, boxSizing:"border-box", transition:"border-color 0.2s" }}
            placeholder={speech.listening?"Listening…":"Write freely — this is just for you..."}
            rows={5} autoFocus={!speech.listening}/>
          <div style={{ position:"absolute", bottom:10, right:10 }}>
            <MicBtn speech={speech} color={habit.color} size={30}/>
          </div>
        </div>
      )}
      {speech.interim && !saved && <div style={{ fontSize:13, color:T.hint, fontStyle:"italic", lineHeight:1.5, marginBottom:10, paddingLeft:4 }}>{speech.interim}…</div>}
      {speech.speechError && !saved ? <div style={{ fontSize:12, color:T.accent, marginBottom:10, paddingLeft:4, lineHeight:1.5, whiteSpace:"pre-line" }}>{speech.speechError}</div> : null}
      {past.length > 0 && (
        <div style={{ marginTop:22 }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Past reflections</div>
          {past.map((l, i) => (
            <div key={i} style={{ borderTop:`0.5px solid ${T.border}`, padding:"10px 0" }}>
              <div style={{ fontSize:10, color:T.hint, marginBottom:4 }}>{l.date}</div>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{l.reflection}</div>
            </div>
          ))}
        </div>
      )}
      {!saved && <><PBtn onClick={handleSave} color={habit.color}>Save reflection</PBtn><GBtn onClick={onClose}>Close</GBtn></>}
    </Modal>
  );
}

// ─── EDIT MODAL ───────────────────────────────────────────────────────────────
export const TYPE_META = {
  daily:   { bg:"#27AE6018", text:"#27AE60", label:"Daily habit"    },
  weekly:  { bg:"#C0392B18", text:"#C0392B", label:"Weekly target"  },
  project: { bg:"#2980B918", text:"#2980B9", label:"Build"          },
  limit:   { bg:"#8E44AD18", text:"#8E44AD", label:"Limit / reduce" },
  log:     { bg:"rgba(200,144,42,0.12)", text:"#C8902A", label:"Log" },
};

export function EditModal({ habit, onClose, onSave }) {
  const [name,        setName]        = useState(habit.name);
  const [emoji,       setEmoji]       = useState(habit.emoji);
  const [color,       setColor]       = useState(habit.color);
  const [reflection,  setReflection]  = useState(habit.reflection ?? true);
  const [reflPrompt,  setReflPrompt]  = useState(habit.reflectionPrompt || "");
  const [weekTarget,  setWeekTarget]  = useState(String(habit.weeklyTarget || 3));
  const [budget,      setBudget]      = useState(String(habit.dailyBudget || 60));
  const [budgetUnit,  setBudgetUnit]  = useState(habit.unit || "min");
  const [increment,   setIncrement]   = useState(String(habit.tapIncrement ?? 1));
  const [dailyTargetMins, setDailyTargetMins] = useState(String(habit.dailyTargetMinutes ?? 60));
  const meta = TYPE_META[habit.habitType] || TYPE_META.daily;
  const typePillLabel = HABIT_TYPES[habit.habitType]?.label || meta.label;

  function save() {
    const updates = { name:name.trim()||habit.name, emoji:emoji||habit.emoji, color, reflection, reflectionPrompt:reflPrompt.trim()||null };
    if (habit.habitType === "log") { updates.reflection = false; updates.reflectionPrompt = null; }
    if (habit.habitType === "weekly")  updates.weeklyTarget = parseInt(weekTarget) || habit.weeklyTarget;
    if (habit.habitType === "limit")   { updates.dailyBudget = parseInt(budget)||habit.dailyBudget; updates.unit = budgetUnit||habit.unit; updates.tapIncrement = parseInt(increment)||1; }
    if (habit.habitType === "project") updates.dailyTargetMinutes = Math.max(1, parseInt(dailyTargetMins, 10) || (habit.dailyTargetMinutes ?? 60));
    onSave(habit.id, updates);
    onClose();
  }

  const isLog = habit.habitType === "log";
  return (
    <Modal onClose={onClose}>
      <div style={{ display:"inline-flex", alignItems:"center", background:meta.bg, borderRadius:20, padding:"4px 12px", marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:500, color:meta.text }}>{typePillLabel}</span>
      </div>
      <div style={{ fontSize:11, color:T.hint, marginBottom:16, lineHeight:1.45, maxWidth:320 }}>
        Type can&apos;t be changed after creation — delete and recreate if you need a different kind.
      </div>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:20 }}>{isLog ? "Edit log" : "Edit habit"}</div>
      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}><label style={lbl}>Name</label><input style={inp} value={name} onChange={e => setName(e.target.value)} maxLength={40}/></div>
        <div><label style={lbl}>Emoji</label><input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2}/></div>
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>
      {habit.habitType === "daily" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <div style={{ fontSize:13, color:T.muted }}>
            {getDailyStreak(habit) > 0
              ? <>One tap per day. Currently on a <strong style={{ color:T.text }}>{getDailyStreak(habit)}-day streak</strong>.</>
              : "One tap per day. No active streak yet."}
          </div>
        </div>
      )}
      {habit.habitType === "weekly" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <FG label="Sessions per week target" mb={8}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input style={{ ...inp, width:80 }} type="number" min="1" max="7" value={weekTarget} onChange={e => setWeekTarget(e.target.value)}/>
              <span style={{ fontSize:13, color:T.muted }}>sessions / week</span>
            </div>
          </FG>
          <div style={{ fontSize:11, color:T.hint }}>{habit.logs.length} total sessions logged</div>
        </div>
      )}
      {habit.habitType === "project" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <FG label="Daily session target (min)" mb={8}>
            <input style={inp} type="number" min="1" max="1440" value={dailyTargetMins} onChange={e => setDailyTargetMins(e.target.value)}/>
          </FG>
          {(() => { const s = getProjectStats(habit); return <div style={{ fontSize:11, color:T.hint }}>{s.totalHours} hrs across {habit.logs.length} sessions · {s.wins} wins logged</div>; })()}
        </div>
      )}
      {habit.habitType === "limit" && (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20 }}>
          <FG label="Daily budget" mb={8}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <input style={{ ...inp, width:88 }} type="number" value={budget} onChange={e => setBudget(e.target.value)}/>
              <input style={{ ...inp, width:80 }} value={budgetUnit} onChange={e => setBudgetUnit(e.target.value)} placeholder="pouches"/>
              <span style={{ fontSize:13, color:T.muted }}>/ day</span>
            </div>
          </FG>
          <FG label="Per tap" mb={8}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <input style={{ ...inp, width:80 }} type="number" min="1" value={increment} onChange={e => setIncrement(e.target.value)}/>
              <span style={{ fontSize:13, color:T.muted }}>{budgetUnit || "unit"} per tap</span>
            </div>
          </FG>
          <div style={{ fontSize:11, color:T.hint }}>Each + tap logs {parseInt(increment)||1} {budgetUnit} toward the limit</div>
        </div>
      )}
      {isLog ? (
        <div style={{ background:T.surface, borderRadius:T.rsm, padding:14, marginBottom:20, fontSize:13, color:T.muted, lineHeight:1.55 }}>
          Logs are free-form dated entries. They appear in <strong style={{ color:T.text }}>Journal</strong> and don&apos;t affect your Today ring or streaks.
        </div>
      ) : (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:reflection?12:0 }}>
            <div>
              <label style={{ ...lbl, margin:0 }}>Reflection prompt</label>
              {!reflection && <div style={{ fontSize:11, color:T.hint, marginTop:3 }}>Off — no Go Deeper shown</div>}
            </div>
            <Toggle on={reflection} onChange={setReflection}/>
          </div>
          {reflection && <input style={inp} value={reflPrompt} onChange={e => setReflPrompt(e.target.value)} placeholder={habit.reflectionPrompt || "What do you want to remember from today?"}/>}
        </div>
      )}
      <div style={{ fontSize:11, color:T.hint, lineHeight:1.5, marginBottom:18, padding:"12px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
        <span style={{ color:T.sub, fontWeight:600 }}>XP</span>{" — "}Your total lives on your account (⚡ in the header or Profile). XP is awarded when you log; habits don&apos;t store their own XP field to edit here.
      </div>
      <PBtn color={habit.color} onClick={save}>Save changes</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── ADD MODAL ────────────────────────────────────────────────────────────────
export function AddModal({ onClose, onSave, habitCount = 0 }) {
  const [step,        setStep]        = useState("type");
  const [habitType,   setHabitType]   = useState(null);
  const [name,        setName]        = useState("");
  const [emoji,       setEmoji]       = useState("");
  const [color,       setColor]       = useState(COLORS[0]);
  const [reflection,  setReflection]  = useState(true);
  const [reflPrompt,  setReflPrompt]  = useState("");
  const [weekTarget,  setWeekTarget]  = useState("3");
  const [budget,      setBudget]      = useState("60");
  const [budgetUnit,  setBudgetUnit]  = useState("min");
  const [tapIncrement, setTapIncrement] = useState("1");
  const [buildDailyTarget, setBuildDailyTarget] = useState("60");

  if (step === "type") return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:4 }}>New habit</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom: habitCount >= 5 ? 12 : 22 }}>What are you forging?</div>
      {habitCount >= 8 && (
        <div style={{ marginBottom:16, padding:"10px 12px", borderRadius:T.rsm, background:"rgba(200,144,42,0.08)", border:"0.5px solid rgba(200,144,42,0.35)", fontSize:12, color:T.sub, lineHeight:1.5 }}>
          <span style={{ fontWeight:600, color:T.gold }}>You&apos;re tracking a lot.</span>{" "}Adding more risks tracking nothing well. Add this one if it genuinely matters more than something you already have.
        </div>
      )}
      {habitCount >= 5 && habitCount < 8 && (
        <div style={{ marginBottom:16, padding:"10px 12px", borderRadius:T.rsm, background:"rgba(200,144,42,0.06)", border:"0.5px solid rgba(200,144,42,0.25)", fontSize:12, color:T.sub, lineHeight:1.5 }}>
          Three real habits beat nine abandoned ones. Add this one if it matters most right now.
        </div>
      )}
      {Object.entries(HABIT_TYPES).map(([key, { label, desc, icon }]) => (
        <button key={key} onClick={() => { setHabitType(key); setStep("details"); }}
          style={{ display:"flex", alignItems:"flex-start", gap:12, width:"100%", padding:"12px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:8, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22, flexShrink:0, marginTop:1 }}>{icon}</span>
          <div>
            <div style={{ fontSize:14, fontWeight:500, color:T.text }}>{label}</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{desc}</div>
          </div>
        </button>
      ))}
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );

  return (
    <Modal onClose={() => setStep("type")}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:22 }}>
        <button onClick={() => setStep("type")} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:13, padding:"4px 8px 4px 0" }}>← Back</button>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text }}>{HABIT_TYPES[habitType]?.label}</div>
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}><label style={lbl}>Name</label><input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning run" maxLength={40} autoFocus/></div>
        <div><label style={lbl}>Emoji</label><input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="💪" maxLength={2}/></div>
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>
      {habitType === "weekly" && <FG label="Sessions per week"><input style={inp} type="number" min="1" max="7" value={weekTarget} onChange={e => setWeekTarget(e.target.value)}/></FG>}
      {habitType === "limit" && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", gap:10, marginBottom:10 }}>
            <div style={{ flex:1 }}><label style={lbl}>Daily limit</label><input style={inp} type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="7"/></div>
            <div style={{ width:80 }}><label style={lbl}>Unit</label><input style={inp} value={budgetUnit} onChange={e => setBudgetUnit(e.target.value)} placeholder="pouches"/></div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
            <div style={{ width:80 }}><label style={lbl}>Per tap</label><input style={inp} type="number" min="1" value={tapIncrement} onChange={e => setTapIncrement(e.target.value)} placeholder="1"/></div>
            <div style={{ paddingBottom:10, fontSize:13, color:T.muted }}>{budgetUnit || "unit"} per tap</div>
          </div>
        </div>
      )}
      {habitType === "project" && (
        <div style={{ marginBottom:20 }}>
          <div style={{ marginBottom:12, padding:"12px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, fontSize:12, color:T.muted, lineHeight:1.55 }}>
            <strong style={{ color:T.text }}>What you'll track:</strong> minutes <strong style={{ color:T.text }}>today</strong>, total time <strong style={{ color:T.text }}>this week</strong> and <strong style={{ color:T.text }}>all-time</strong>, plus optional <strong style={{ color:T.text }}>wins</strong> and <strong style={{ color:T.text }}>hard parts</strong> when you log a session.
          </div>
          <FG label="Daily session target (min)" mb={0}><input style={inp} type="number" min="1" max="1440" value={buildDailyTarget} onChange={e => setBuildDailyTarget(e.target.value)}/></FG>
        </div>
      )}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:reflection?12:0 }}>
          <label style={{ ...lbl, margin:0 }}>Reflection prompt</label>
          <Toggle on={reflection} onChange={setReflection}/>
        </div>
        {reflection && <input style={inp} value={reflPrompt} onChange={e => setReflPrompt(e.target.value)} placeholder="e.g. What felt hard today? (leave blank for default)"/>}
      </div>
      <PBtn onClick={() => {
        if (!name.trim()) return;
        const base = { id:Date.now()+"", name:name.trim(), emoji:emoji||"⭐", habitType, color, reflection, reflectionPrompt:reflPrompt.trim()||null, streak:0, logs:[] };
        if (habitType === "weekly")  onSave({ ...base, weeklyTarget:parseInt(weekTarget)||3 });
        else if (habitType === "limit") onSave({ ...base, dailyBudget:parseInt(budget)||60, unit:budgetUnit||"min", tapIncrement:parseInt(tapIncrement)||1 });
        else if (habitType === "project") onSave({ ...base, dailyTargetMinutes:Math.max(1, parseInt(buildDailyTarget, 10) || 60) });
        else onSave(base);
      }}>Add habit</PBtn>
      <GBtn onClick={() => setStep("type")}>Back</GBtn>
    </Modal>
  );
}

// ─── ADD LOG MODAL ────────────────────────────────────────────────────────────
export function AddLogModal({ onClose, onSave }) {
  const [name,  setName]  = useState("");
  const [emoji, setEmoji] = useState("📝");
  const [color, setColor] = useState(COLORS[2]);
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:8 }}>New log</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:20, lineHeight:1.55 }}>{HABIT_TYPES.log.desc}</div>
      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}><label style={lbl}>Name</label><input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Training notes" maxLength={40} autoFocus/></div>
        <div><label style={lbl}>Emoji</label><input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2}/></div>
      </div>
      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>
      <PBtn color={color} onClick={() => {
        if (!name.trim()) return;
        onSave({ id:`${Date.now()}`, name:name.trim(), emoji:emoji||"📝", habitType:"log", color, reflection:false, reflectionPrompt:null, streak:0, logs:[] });
      }}>Create log</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── XP MODAL ─────────────────────────────────────────────────────────────────
export function XPModal({ xp, activeBlock = null, todayArcScore = null, arcLedgerRows = [], habits = [], onClose }) {
  const level = getLevel(xp);
  const next  = nextLevel(xp);
  const span  = next ? Math.max(1, next.min - level.min) : 1;
  const pct   = next ? Math.round(((xp - level.min) / span) * 100) : 100;
  const gap   = next ? next.min - xp : 0;
  const arcActive = !!activeBlock?.id;
  const proofHabits = arcActive ? getProofHabitsForBlock(habits, activeBlock.id) : [];
  const proofDoneToday = proofHabits.filter(h => isSatisfiedForTodayRing(h)).length;
  const proofTotal = proofHabits.length;
  const arcPercent = arcActive
    ? calculateArcProofPercent({ ledgerRows: arcLedgerRows, habits, blockId: activeBlock.id })
    : null;
  const arcRank = arcActive
    ? getArcRankDisplay(arcPercent ?? activeBlock.completionScore, arcLedgerRows.length > 0 || proofTotal > 0, {
        proofDoneToday: proofDoneToday,
        priorLedgerDays: arcLedgerRows.filter(r => r.date !== todayStr()).length,
      })
    : null;
  const arcXpToday = todayArcScore?.arcXpAwarded ?? 0;
  const arcDay = arcActive ? getArcDayNumber(activeBlock) : 1;

  return (
    <Modal onClose={onClose}>
      <div style={{ marginTop:-4, paddingBottom:4 }}>
        <p style={{ fontSize:12, color:T.goldBright, letterSpacing:"0.04em", fontWeight:500, margin:"0 0 18px", textAlign:"center", lineHeight:1.55 }}>
          Arc progress is earned from proof actions. Other habits still count as lifetime activity, but they don&apos;t define this Arc.
        </p>

        {arcActive && (
          <>
            <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600, marginBottom:8, paddingLeft:2 }}>Current Arc</div>
            <div style={{ background:`linear-gradient(165deg, rgba(18,18,16,0.98) 0%, ${T.bg} 55%, rgba(12,12,10,1) 100%)`, border:`1px solid ${T.borderMid}`, borderRadius:T.r, padding:"20px 18px 18px", marginBottom:16, boxShadow:"inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 40px rgba(0,0,0,0.35)" }}>
              <div style={{ fontFamily:T.serif, fontSize:28, fontWeight:700, color:arcRank.color, lineHeight:1.1 }}>{arcRank.label}</div>
              <div style={{ fontSize:13, color:T.sub, marginTop:8, lineHeight:1.5 }}>{arcRank.meaning}</div>
              <div style={{ marginTop:16, fontSize:13, color:T.text, lineHeight:1.55 }}>
                <div>Day {arcDay} · {proofDoneToday}/{proofTotal || "—"} proof today</div>
                <div style={{ marginTop:6, fontVariantNumeric:"tabular-nums" }}>
                  <span style={{ color:T.gold }}>{activeBlock.arcXp ?? 0} arc xp</span>
                  <span style={{ color:T.hint }}> total · </span>
                  <span style={{ color:T.sub }}>{arcXpToday} / {ARC_DAILY_XP_CAP} today</span>
                </div>
                {arcPercent != null && (
                  <div style={{ marginTop:4, fontSize:12, color:T.muted }}>{arcPercent}% proof consistency</div>
                )}
              </div>
            </div>
            <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600, marginBottom:8, paddingLeft:2 }}>Arc ranks (proof %)</div>
            <div style={{ border:`1px solid ${T.borderMid}`, borderRadius:T.r, overflow:"hidden", background:T.bg, marginBottom:18 }}>
              {arcRank.label === "Forming" && (
                <div style={{ display:"flex", gap:12, padding:"12px 14px", background:`${arcRank.color}12`, borderLeft:`3px solid ${arcRank.color}` }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:arcRank.color, flexShrink:0, marginTop:4 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:600, color:T.text }}>
                      Forming<span style={{ marginLeft:6, fontSize:10, color:arcRank.color, textTransform:"uppercase" }}>Now</span>
                    </div>
                    <div style={{ fontSize:11, color:T.sub, marginTop:4, lineHeight:1.4 }}>Early in your Arc — rank updates as proof adds up.</div>
                  </div>
                </div>
              )}
              {ARC_RANKS.map((r, i) => {
                const isCurrent = arcRank.label !== "Forming" && r.label === arcRank.label;
                const isFuture = arcPercent != null && arcPercent < r.minPercent;
                return (
                  <div key={r.label} style={{ display:"flex", gap:12, padding:"12px 14px", borderTop:i>0?`1px solid ${T.border}`:"none", opacity:isFuture?0.45:1, background:isCurrent?`${r.color}12`:"transparent", borderLeft:isCurrent?`3px solid ${r.color}`:"3px solid transparent" }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:r.color, flexShrink:0, marginTop:4 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:isCurrent?600:500, color:isFuture?T.hint:T.text }}>
                        {r.label}{isCurrent ? <span style={{ marginLeft:6, fontSize:10, color:r.color, textTransform:"uppercase" }}>Now</span> : null}
                        <span style={{ float:"right", fontSize:11, color:T.hint, fontWeight:500 }}>{r.minPercent}%+</span>
                      </div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:4, lineHeight:1.4 }}>{r.meaning}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600, marginBottom:8, paddingLeft:2 }}>Lifetime XP</div>
        <div style={{ background:T.raised, border:`1px solid ${T.borderMid}`, borderRadius:T.r, padding:"18px 18px 16px", marginBottom:16 }}>
          <div style={{ fontFamily:T.serif, fontSize:22, fontWeight:700, color:level.color, lineHeight:1.1 }}>{level.label}</div>
          <div style={{ fontSize:12, color:T.sub, marginTop:6, lineHeight:1.45 }}>{level.meaning}</div>
          <div style={{ marginTop:14, fontSize:13, color:T.text, fontWeight:500, lineHeight:1.5 }}>
            {next ? (
              <><span style={{ color:level.color, fontVariantNumeric:"tabular-nums" }}>{xp} xp</span><span style={{ color:T.hint }}> — </span><span style={{ color:T.sub }}>{gap} to </span><span style={{ color:next.color, fontWeight:600 }}>{next.label}</span></>
            ) : (
              <><span style={{ color:level.color, fontVariantNumeric:"tabular-nums" }}>{xp} xp</span><span style={{ color:T.hint }}> — </span><span style={{ color:T.goldBright, fontWeight:600 }}>Peak rank</span></>
            )}
          </div>
          <div style={{ height:10, background:T.bg, borderRadius:6, overflow:"hidden", marginTop:12, border:`1px solid ${T.border}` }}>
            <div style={{ height:"100%", borderRadius:5, background:next?`linear-gradient(90deg, ${level.color}, ${next.color})`:`linear-gradient(90deg, ${level.color}, ${T.goldBright})`, width:`${pct}%`, maxWidth:"100%", transition:"width 0.65s ease" }}/>
          </div>
        </div>
        <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600, marginBottom:10, paddingLeft:2 }}>Lifetime ranks</div>
        <div style={{ border:`1px solid ${T.borderMid}`, borderRadius:T.r, overflow:"hidden", background:T.bg, marginBottom:18, boxShadow:"inset 0 1px 0 rgba(255,255,255,0.03)" }}>
          {XP_LEVELS.map((l, i) => {
            const isCurrent = l.min === level.min;
            const isFuture  = xp < l.min;
            return (
              <div key={l.min} style={{ display:"flex", gap:14, padding:"14px 14px 14px 11px", borderTop:i>0?`1px solid ${T.border}`:"none", opacity:isFuture?0.4:1, background:isCurrent?`${l.color}12`:"transparent", borderLeft:isCurrent?`3px solid ${l.color}`:"3px solid transparent", boxShadow:isCurrent?`inset 0 0 36px ${l.color}0D`:"none" }}>
                <div style={{ width:12, height:12, borderRadius:"50%", background:l.color, flexShrink:0, marginTop:4, boxShadow:isFuture?"none":`0 0 10px ${l.color}55`, opacity:isFuture?0.55:1 }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
                    <span style={{ fontSize:15, fontWeight:isCurrent?600:500, color:isFuture?T.hint:T.text, letterSpacing:"-0.01em" }}>
                      {l.label}{isCurrent?<span style={{ marginLeft:8, fontSize:10, fontWeight:600, color:l.color, letterSpacing:"0.08em", textTransform:"uppercase" }}>Now</span>:null}
                    </span>
                    <span style={{ fontSize:11, color:T.hint, fontVariantNumeric:"tabular-nums", flexShrink:0 }}>{l.min.toLocaleString()} xp</span>
                  </div>
                  <div style={{ fontSize:12, color:isFuture?T.hint:T.sub, marginTop:5, lineHeight:1.45 }}>{l.meaning}</div>
                </div>
              </div>
            );
          })}
        </div>
        <GBtn onClick={onClose}>Close</GBtn>
      </div>
    </Modal>
  );
}

// ─── HISTORY MODAL ────────────────────────────────────────────────────────────
export function HabitGrid({ habit }) {
  const grid = get12WeekGrid(habit);
  const rate = getCompletionRate(habit);
  const weekLabels = grid.map(week => { const d = parseLocal(week[0].date); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; });
  const ringC = 2 * Math.PI * 14;
  return (
    <div style={{ marginBottom:26 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
        <div style={{ width:32, height:32, borderRadius:8, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{habit.emoji}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:500, color:T.text }}>{habit.name}</div>
          <div style={{ fontSize:11, color:T.muted }}>{habit.logs.length} total · {rate}% last 28 days</div>
        </div>
        <svg width="36" height="36" viewBox="0 0 36 36" style={{ transform:"rotate(-90deg)", flexShrink:0 }}>
          <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" stroke={T.surface}/>
          <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" stroke={habit.color} strokeLinecap="round" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - rate/100)}/>
        </svg>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"46px repeat(7,1fr)", gap:3, marginBottom:4 }}>
        <div/>
        {DAYS.map(d => <div key={d} style={{ fontSize:9, color:T.hint, textAlign:"center" }}>{d}</div>)}
      </div>
      {grid.map((week, wi) => (
        <div key={wi} style={{ display:"grid", gridTemplateColumns:"46px repeat(7,1fr)", gap:3, marginBottom:3, alignItems:"center" }}>
          <div style={{ fontSize:9, color:T.hint }}>{weekLabels[wi]}</div>
          {week.map((day, di) => (
            <div key={di} title={day.date} style={{ aspectRatio:"1", borderRadius:3, background:day.logged?habit.color:T.surface, opacity:day.date>todayStr()?0:day.logged?1:0.15 }}/>
          ))}
        </div>
      ))}
    </div>
  );
}

export function HistoryModal({ habits, onClose, isPro, onUpgrade }) {
  const [selected, setSelected] = useState(habits[0]?.id || null);
  const habit = habits.find(h => h.id === selected);
  const cutoff = daysAgo(6);
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:16 }}>Full history</div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
        {habits.map(h => (
          <button key={h.id} onClick={() => setSelected(h.id)}
            style={{ padding:"5px 12px", borderRadius:20, border:`1px solid ${selected===h.id?h.color:T.borderStrong}`, background:selected===h.id?h.color+"22":"none", color:selected===h.id?h.color:T.muted, fontSize:12, fontWeight:selected===h.id?500:400, cursor:"pointer", whiteSpace:"nowrap" }}>
            {h.emoji} {h.name}
          </button>
        ))}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18 }}>
        <div style={{ width:10, height:10, borderRadius:2, background:habit?.color||T.accent }}/><span style={{ fontSize:11, color:T.muted }}>Logged</span>
        <div style={{ width:10, height:10, borderRadius:2, background:T.surface, opacity:0.4, marginLeft:8 }}/><span style={{ fontSize:11, color:T.muted }}>Missed</span>
      </div>
      {habit && <HabitGrid habit={habit}/>}
      {!isPro && habit && habit.logs.some(l => l.date < cutoff) && (
        <div style={{ position:"relative", margin:"16px 0", borderRadius:T.rsm, overflow:"hidden" }}>
          <div style={{ filter:"blur(4px)", pointerEvents:"none", userSelect:"none", padding:"10px 0" }}>
            {habit.logs.filter(l => l.date < cutoff).slice(-4).map((l, i) => (
              <div key={i} style={{ padding:"8px 12px", borderBottom:`0.5px solid ${T.border}`, display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ width:8, height:8, borderRadius:2, background:habit.color, flexShrink:0 }}/>
                <div style={{ fontSize:13, color:T.muted }}>████████</div>
                <div style={{ fontSize:12, color:T.hint, marginLeft:"auto" }}>████</div>
              </div>
            ))}
          </div>
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, background:"rgba(14,14,14,0.75)", backdropFilter:"blur(2px)", borderRadius:T.rsm, padding:"0 20px" }}>
            <div style={{ fontSize:20 }}>🔒</div>
            <div style={{ fontSize:13, color:T.text, fontWeight:500, textAlign:"center" }}>Arc history is part of Forged Pro</div>
            <div style={{ fontSize:12, color:T.muted, textAlign:"center", lineHeight:1.5, marginTop:4 }}>Full Arc and habit history included in Pro.</div>
            <div style={{ fontSize:12, color:T.muted, textAlign:"center" }}>You have {habit.logs.filter(l => l.date < cutoff).length} older logs waiting</div>
            <button onClick={onUpgrade} style={{ marginTop:6, padding:"9px 20px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#0F0F0D", fontSize:13, fontWeight:700, cursor:"pointer" }}>Unlock Forged Pro →</button>
          </div>
        </div>
      )}
      <GBtn onClick={onClose}>Close</GBtn>
    </Modal>
  );
}

// ─── TOUR CONTENT ─────────────────────────────────────────────────────────────
export const GLOBAL_TOUR = [
  {
    welcome: true, target: null,
    title: "Welcome to Forged.",
    body: "This tour takes about 30 seconds. It'll show you what each screen does and how to get the most out of it.",
  },
  {
    target: "[data-tour='today-summary']",
    title: "Your daily progress",
    body: "This ring fills up as you log habits each day. Tap the XP badge to see your current level and how much further you have to go.",
    pad: 10,
  },
  {
    target: "[data-tour='today-first-section']",
    title: "Logging a habit",
    body: "Tap the circle on any habit to log it for today. Tap it again — or hold — for more options: reflect, skip the day, add a note, or undo.",
    pad: 6,
  },
  {
    target: "[data-tour='nav']",
    title: "Five screens, one app",
    body: "Today logs habits. Journal starts with Activity — what you actually logged — then the Journal tab for your daily story. Insights shows patterns. Social is where Forge Pro crew features will live. Profile tracks your XP and account.",
    pad: 4, radius: 16, callout: "top",
  },
];

export const PAGE_TOURS = {
  today: [
    { target:"[data-tour='today-summary']", title:"Daily progress ring", body:"Fills up as you log habits. Tap the XP badge to see your current level and how close you are to the next one.", pad:10 },
    { target:"[data-tour='today-first-section']", title:"Logging habits", body:"Tap the circle to log. Tap again or hold for options — reflect on the day, skip it, add a quick note, or undo a log.", pad:6 },
  ],
  social: [
    { target:"[data-tour='social-teaser']", title:"Forge together", body:"Add friends, share goals, and see who's still logging. Nudging a friend when they slip is a Pro feature — the rest of the accountability layer is free.", pad:8 },
    { target:"[data-tour='companion-nav']", title:"Your AI companion", body:"Tap Talk anytime — a companion that knows your habits, remembers your conversations, and can set goals or log progress without the busywork.", pad:8 },
  ],
  journal: [
    { target:"[data-tour='journal-viewmode']", title:"Switch your view", body:"Day view lists every entry in order. Week groups them by week. Month shows a calendar grid so you can spot gaps at a glance.", pad:6 },
    { target:"[data-tour='journal-filters']", title:"Filter by habit", body:"Tap a habit name to see only its logs and reflections. Useful when you want to review one habit's history without the noise.", pad:6 },
    { target:"[data-tour='journal-list']", title:"Your activity trail", body:"Everything you logged shows up here — notes, reflections, and goal updates. When you're ready for the written summary, switch to the Journal tab.", pad:6 },
  ],
  insights: [
    { target:"[data-tour='insights-stats']", title:"Your snapshot", body:"Total habits tracked, how many days you've logged at least one habit, your longest streak ever, and your total log count.", pad:8 },
    { target:"[data-tour='insights-streaks']", title:"Activity summary", body:"Quick read on streaks, your steadiest habit, and which day you usually log. Tap \"Show full activity breakdown\" for streak rows, 28-day rates, and the 12-week heatmap.", pad:8 },
  ],
  profile: [
    { target:"[data-tour='profile-account']", title:"Your account", body:"Change your display name or rename your AI companion here. These are the names shown across the whole app.", pad:6 },
    { target:"[data-tour='profile-upgrade']", title:"Early supporter access", body:"Unlocks unlimited habits and companion messages, voice logging, friend nudges, and full history — at a price locked in forever. First 100 users get it at $4.99/mo.", pad:6 },
    { target:"[data-tour='profile-feedback']", title:"Send feedback", body:"You're one of the first people using Forged. A quick note goes directly to the founder — it genuinely shapes what gets built next.", pad:6 },
    { target:"[data-tour='profile-signout']", title:"Sign out", body:"Your data is saved to your account, so you can sign in on any device and pick up exactly where you left off.", pad:6 },
  ],
};
