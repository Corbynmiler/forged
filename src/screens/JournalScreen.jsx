import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { T, MONTHS } from "../theme.js";
import { supabase, SUPABASE_ANON_KEY } from "../supabase.js";
import {
  todayStr, daysAgo, parseLocal, fmtDate, fmtEntryDate,
  weekStartFor, getStreak, isSatisfiedForTodayRing,
  todayLogs, isLoggedToday, getProjectStats, formatWithUnit,
  mergedLast7, fmtWeekRange, truncateText,
  loadJournalMissedMap, saveJournalMissedMap,
} from "../utils.js";
import { Modal, GBtn, PBtn, FG, lbl, inp, Ring } from "../components/ui.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";

// ─── BetaModal ────────────────────────────────────────────────────────────────
export function BetaModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  async function handleSubmit() {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? SUPABASE_ANON_KEY;
      const res = await fetch("/api/beta-interest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: email.trim(), message: msg.trim() }),
      });
      if (!res.ok) {
        let errText = "Something went wrong. Try again.";
        try {
          const j = await res.json();
          if (j?.error && typeof j.error === "string") errText = j.error;
        } catch { /* use default */ }
        setSubmitError(errText);
        return;
      }
      setSent(true);
    } catch {
      setSubmitError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) return (
    <Modal onClose={onClose}>
      <div style={{ textAlign:"center", padding:"10px 0 20px" }}>
        <div style={{ fontSize:36, marginBottom:14 }}>🙌</div>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>You're on the list.</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.75, marginBottom:24 }}>
          Thanks for being early. You'll hear from me directly as things come together — I genuinely appreciate it.
        </div>
        <GBtn onClick={onClose}>Close</GBtn>
      </div>
    </Modal>
  );

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:10 }}>Interested in Forged Pro?</div>
      <div style={{ fontSize:13, color:T.muted, lineHeight:1.8, marginBottom:20 }}>
        Forged Pro is <strong style={{ color:T.text }}>$4.99/month</strong> — unlimited AI coaching, full history, friend nudges, and voice logging.
        <br/><br/>
        Leave your email and I'll reach out directly. Early users shape what gets built next.
      </div>
      <FG label="Your email">
        <input style={inp} type="email" placeholder="you@example.com" value={email} onChange={e => { setEmail(e.target.value); if (submitError) setSubmitError(""); }} autoFocus/>
      </FG>
      <FG label="Anything you'd love to see? (optional)" mb={0}>
        <textarea style={{ ...inp, resize:"none", lineHeight:1.6 }} rows={3}
          placeholder="Features, questions, feedback — anything goes"
          value={msg} onChange={e => { setMsg(e.target.value); if (submitError) setSubmitError(""); }}/>
      </FG>
      {submitError ? (
        <div style={{ fontSize:12, color:"#e05c5c", marginTop:14, lineHeight:1.5 }}>{submitError}</div>
      ) : null}
      <PBtn onClick={() => { if (!submitting) handleSubmit(); }} style={{ marginTop:16 }}>{submitting ? "Sending…" : "I'm interested →"}</PBtn>
      <GBtn onClick={onClose}>Maybe later</GBtn>
      <div style={{ fontSize:11, color:T.hint, marginTop:10, textAlign:"center", lineHeight:1.6 }}>
        Your details are sent securely. No spam, ever.
      </div>
    </Modal>
  );
}

// ─── JOURNAL DAY SECTION ──────────────────────────────────────────────────────
// One section per date in the list view. Today is expanded by default.
// Past days collapse into a single row showing a snapshot.
function DaySection({ date, dayHabits, onReflect, onDeleteLogEntry, listFullyExpanded, journalCollapseNonce, onAccordionInteraction }) {
  const isToday = date === todayStr();
  const [open, setOpen] = useState(isToday);
  useEffect(() => {
    if (listFullyExpanded && !isToday) setOpen(true);
  }, [listFullyExpanded, isToday]);
  const prevCollapseNonce = useRef(null);
  useEffect(() => {
    if (prevCollapseNonce.current === null) {
      prevCollapseNonce.current = journalCollapseNonce;
      return;
    }
    if (prevCollapseNonce.current === journalCollapseNonce) return;
    prevCollapseNonce.current = journalCollapseNonce;
    if (!isToday) setOpen(false);
  }, [journalCollapseNonce, isToday]);

  const label = isToday ? "Today" : date === daysAgo(1) ? "Yesterday" : fmtEntryDate(date);
  // Snapshot: unique habit emojis for this day + total log count
  const totalLogs = dayHabits.reduce((s, dh) => s + dh.logs.length, 0);
  const emojis = dayHabits.slice(0, 4).map(dh => dh.habit.emoji).join(" ");

  return (
    <div style={{ marginBottom: isToday ? 4 : 2 }}>
      {/* Date header — past days are clickable accordions */}
      {isToday ? (
        <div style={{ padding:"12px 18px 6px" }}>
          <div style={{ fontSize:13, fontWeight:600, color:T.text, letterSpacing:"0.01em" }}>Today</div>
        </div>
      ) : (
        <button type="button" onClick={() => { onAccordionInteraction?.(); setOpen(o => !o); }}
          style={{ width:"100%", display:"flex", alignItems:"center", padding:"10px 18px 8px", background:"none", border:"none", cursor:"pointer", gap:10 }}>
          {/* Colour line */}
          <div style={{ width:3, height:28, borderRadius:2, background:open?T.accent:T.borderStrong, flexShrink:0, transition:"background 0.2s ease" }}/>
          <div style={{ flex:1, textAlign:"left" }}>
            <div style={{ fontSize:13, fontWeight:500, color:open?T.text:T.muted, transition:"color 0.2s ease" }}>{label}</div>
            {!open && <div style={{ fontSize:11, color:T.hint, marginTop:1 }}>{emojis} · {totalLogs} {totalLogs === 1 ? "entry" : "entries"}</div>}
          </div>
          <div style={{ fontSize:14, color:T.hint, transition:"transform 0.2s ease", transform:open?"rotate(90deg)":"rotate(0deg)" }}>›</div>
        </button>
      )}

      {/* Expanded content */}
      {open && (
      <div style={{ animation:"journalFadeIn 0.18s ease-out" }}>
      {dayHabits.map(({ habit, logs, entryKey }) => (
        <HabitDayCard key={entryKey || habit.id} habit={habit} logs={logs} onReflect={onReflect} onDeleteLogEntry={onDeleteLogEntry}/>
      ))}
      </div>
      )}
    </div>
  );
}

// Missed day (marked by user, optional note) — list / week views
function MissedDaySection({ date, note, onEdit, onClear, listFullyExpanded, journalCollapseNonce, onAccordionInteraction }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (listFullyExpanded) setOpen(true);
  }, [listFullyExpanded]);
  const prevCollapseNonce = useRef(null);
  useEffect(() => {
    if (prevCollapseNonce.current === null) {
      prevCollapseNonce.current = journalCollapseNonce;
      return;
    }
    if (prevCollapseNonce.current === journalCollapseNonce) return;
    prevCollapseNonce.current = journalCollapseNonce;
    setOpen(false);
  }, [journalCollapseNonce]);
  const label = fmtEntryDate(date);
  const hasNote = !!(note && note.trim());
  return (
    <div style={{ margin:"0 14px 6px", borderRadius:T.r, border:`0.5px solid rgba(230,126,34,0.38)`, overflow:"hidden", background:"rgba(230,126,34,0.04)" }}>
      <button
        type="button"
        onClick={() => { onAccordionInteraction?.(); setOpen(o => !o); }}
        style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", background:"none", border:"none", cursor:"pointer", gap:10 }}>
        <span style={{ fontSize:12, fontWeight:600, color:T.amber }}>{label}</span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:11, color:T.amber, fontWeight:700, background:"rgba(230,126,34,0.15)", borderRadius:10, padding:"2px 8px" }}>
            ✕ Missed{hasNote ? " · noted" : ""}
          </span>
          <span style={{ fontSize:11, color:T.hint }}>{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open && (
        <div style={{ padding:"0 14px 12px", borderTop:`0.5px solid rgba(230,126,34,0.18)`, animation:"journalFadeIn 0.18s ease-out" }}>
          {hasNote ? (
            <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, marginTop:10, marginBottom:10 }}>{note.trim()}</div>
          ) : (
            <div style={{ fontSize:12, color:T.muted, marginTop:8, marginBottom:8 }}>No note added yet.</div>
          )}
          <div style={{ display:"flex", gap:10 }}>
            <button type="button" onClick={onEdit} style={{ fontSize:11, color:T.amber, background:"rgba(230,126,34,0.12)", border:`0.5px solid rgba(230,126,34,0.35)`, borderRadius:T.rsm, padding:"5px 10px", cursor:"pointer", fontWeight:600 }}>
              {hasNote ? "Edit note" : "Add note"}
            </button>
            <button type="button" onClick={onClear} style={{ fontSize:11, color:T.hint, background:"none", border:"none", cursor:"pointer" }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Project session length for journal rows — 60→"1h", 90→"1h 30m", 45→"45m" */
function formatProjectMinutes(totalMins) {
  const m = Math.max(0, Math.floor(Number(totalMins) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (rest > 0) parts.push(`${rest}m`);
  if (parts.length === 0) return "0m";
  return parts.join(" ");
}

function renderJournalLogContent(habit, log) {
  const note = log.note?.trim();
  const noteSuffix = note ? ` · ${truncateText(note, 48)}` : "";

  if (habit.habitType === "log" && log.value === "log") return <>{note || "Log entry"}</>;

  if (log.value === "skip") return <>{`Skipped${noteSuffix}`}</>;
  if (log.value === "quicknote") return <>{note || "Quick note"}</>;

  if (habit.habitType === "limit" && typeof log.value === "number") {
    return <>{formatWithUnit(log.value, habit.unit)}{noteSuffix}</>;
  }
  if (habit.habitType === "goal" && typeof log.value === "number") {
    return <>{`Updated to ${formatWithUnit(log.value, habit.unit)}`}{noteSuffix}</>;
  }

  if (habit.habitType === "project" && log.value && typeof log.value === "object" && "minutes" in log.value) {
    const v = log.value;
    const topNote = note && (!v.note || v.note.trim() !== note) ? note : null;
    return (
      <>
        <div style={{ color: T.text }}>{formatProjectMinutes(v.minutes)}</div>
        {v.win ? (
          <div style={{ fontSize: 12, color: T.green, opacity: 0.92, marginTop: 4, lineHeight: 1.45 }}>
            Win: {truncateText(v.win, 200)}
          </div>
        ) : null}
        {v.hardPart ? (
          <div style={{ fontSize: 12, color: T.muted, marginTop: v.win ? 3 : 4, lineHeight: 1.45 }}>
            Hard: {truncateText(v.hardPart, 200)}
          </div>
        ) : null}
        {v.note?.trim() ? (
          <div style={{ fontSize: 12, fontStyle: "italic", color: T.sub, marginTop: (v.win || v.hardPart) ? 3 : 4, lineHeight: 1.45 }}>
            {truncateText(v.note.trim(), 400)}
          </div>
        ) : null}
        {topNote ? (
          <div style={{ fontSize: 12, fontStyle: "italic", color: T.sub, marginTop: 4, lineHeight: 1.45 }}>
            {truncateText(topNote, 72)}
          </div>
        ) : null}
      </>
    );
  }

  if (log.value === true) {
    // Note shown in the NOTE section below — don't also inline it here
    return <>Done ✓</>;
  }
  if (typeof log.value === "number") return <>{formatWithUnit(log.value, habit.unit)}</>;
  if (log.reflection) return <>{`Reflection · ${truncateText(log.reflection, 72)}${noteSuffix}`}</>;
  if (log.value && typeof log.value === "object") {
    if (log.value.win) return <>{`Win · ${truncateText(log.value.win, 56)}`}</>;
    if (log.value.hardPart) return <>{`Hard part · ${truncateText(log.value.hardPart, 56)}`}</>;
  }
  if (log.value == null && note) return <>{note}</>;
  return <>{note || "Entry"}</>;
}

function limitJournalMergedNotes(logs) {
  const seen = new Set();
  const out = [];
  for (const l of logs) {
    if (l.value === "quicknote") {
      const t = (l.note || "").trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    } else if (typeof l.value === "number") {
      const t = (l.note || "").trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }
  return out;
}

// Card showing one habit's full activity for a single day
function HabitDayCard({ habit, logs, onReflect, onDeleteLogEntry }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showLimitTaps, setShowLimitTaps] = useState(false);
  const nonNote = logs.filter(l => l.value !== "quicknote");
  const quicknoteEntries = logs.filter(l => l.value === "quicknote");
  // Notes for the NOTE section: only from non-quicknote entries.
  // Quicknote texts are already shown as their entry row content — do not repeat them here.
  const noteEntries = logs.filter(l => l.value !== "quicknote" && l.note?.trim());
  const uniqueNotes = [...new Set(noteEntries.map(l => l.note.trim()).filter(Boolean))];
  // A single bare done-entry (no quicknotes, no reflection) → collapse ENTRIES block.
  const singleTrueEntry = nonNote.length === 1 && nonNote[0].value === true && !nonNote[0].reflection && quicknoteEntries.length === 0;
  const isLimit = habit.habitType === "limit";
  const limitTapCount = isLimit ? nonNote.filter(l => typeof l.value === "number").length : 0;
  const limitMergedNotes = isLimit ? limitJournalMergedNotes(logs) : [];

  // Summary line based on habit type
  function summaryLine() {
    if (habit.habitType === "log") {
      const n = nonNote.filter(l => l.value === "log").length;
      return `${n} log entr${n === 1 ? "y" : "ies"}`;
    }
    if (habit.habitType === "goal") {
      const latest = nonNote.slice(-1)[0];
      const value = typeof latest?.value === "number" ? latest.value : (habit.currentValue ?? 0);
      return `${formatWithUnit(value, habit.unit)} logged`;
    }
    if (habit.habitType === "project") {
      const mins = nonNote.reduce((s, l) => s + (l.value?.minutes || 0), 0);
      const sessions = nonNote.length;
      return mins > 0 ? `${mins} min · ${sessions} session${sessions!==1?"s":""}` : `${sessions} session${sessions!==1?"s":""}`;
    }
    if (habit.habitType === "limit") {
      const total = nonNote.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0);
      return `${total} ${habit.unit || "logged"} of ${habit.dailyBudget} limit`;
    }
    if (habit.habitType === "weekly") return `${nonNote.length} session${nonNote.length!==1?"s":""}`;
    if (isLegacyProgressType(habit.habitType)) {
      const latest = nonNote.slice(-1)[0];
      return latest ? `${latest.value}${habit.unit}` : "logged";
    }
    return "logged ✓";
  }

  // Grab wins, hard parts, reflections from any log
  const wins       = nonNote.filter(l => l.value?.win).map(l => l.value.win);
  const hardParts  = nonNote.filter(l => l.value?.hardPart).map(l => l.value.hardPart);
  const reflection = nonNote.map(l => l.reflection).filter(Boolean).join(" ");

  async function confirmDeleteEntry() {
    if (!pendingDelete || !onDeleteLogEntry || deleting) return;
    setDeleting(true);
    try {
      const ok = await onDeleteLogEntry(habit, pendingDelete);
      if (ok) setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
    <div style={{ margin:"0 14px 8px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
      {/* Habit header */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px 8px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ width:24, height:24, borderRadius:6, background:habit.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>{habit.emoji}</div>
        <span style={{ fontSize:13, fontWeight:500, color:habit.color }}>{habit.name}</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.hint }}>{summaryLine()}</span>
        {singleTrueEntry && onDeleteLogEntry ? (
          <button
            type="button"
            aria-label="Remove this log"
            disabled={deleting}
            onClick={() => setPendingDelete(nonNote[0])}
            style={{ flexShrink:0, width:28, height:28, marginRight:-4, border:"none", borderRadius:6, cursor:deleting?"default":"pointer", background:"transparent", color:T.hint, fontSize:18, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center" }}
          >×</button>
        ) : null}
      </div>

      {/* Limit habits: one daily summary; expand for per-tap delete */}
      {isLimit && logs.length > 0 && onDeleteLogEntry && !showLimitTaps ? (
        <div style={{ borderBottom:`0.5px solid ${T.border}`, padding:"12px 14px" }}>
          <div style={{ fontSize:12, color:T.sub, lineHeight:1.55 }}>
            <strong style={{ color:T.text }}>Day summary</strong>
            {" — "}
            {limitTapCount === 0
              ? (logs.some(l => l.value === "quicknote") ? "Quick note only — expand taps to view or delete." : "No + taps logged today.")
              : `${limitTapCount} tap${limitTapCount !== 1 ? "s" : ""} · ${nonNote.reduce((s, l) => s + (typeof l.value === "number" ? l.value : 0), 0)} / ${habit.dailyBudget ?? "—"} ${habit.unit || ""}`.trim()}
          </div>
          {limitMergedNotes.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Notes</div>
              {limitMergedNotes.map((t, i) => (
                <div key={i} style={{ fontSize:13, color:T.text, lineHeight:1.5, fontStyle:"italic", marginTop:i ? 6 : 0 }}>{t}</div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowLimitTaps(true)}
            style={{ marginTop:12, fontSize:11, color:habit.color, background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}
          >
            Show individual taps (to delete one) →
          </button>
        </div>
      ) : null}

      {/* Per-entry rows (Journal) — delete removes one log; XP is not adjusted.
          Hidden for a single bare done-entry (no context) — the header ✕ handles delete. */}
      {logs.length > 0 && onDeleteLogEntry && (!isLimit || showLimitTaps) && !singleTrueEntry ? (
        <div style={{ borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ padding:"8px 14px 4px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
            <span style={{ fontSize:10, fontWeight:600, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em" }}>{isLimit ? "Each tap" : "Entries"}</span>
            {isLimit && showLimitTaps ? (
              <button type="button" onClick={() => setShowLimitTaps(false)} style={{ fontSize:11, color:T.muted, background:"none", border:"none", cursor:"pointer", padding:0 }}>Hide taps</button>
            ) : null}
          </div>
          {logs.map((log, i) => (
            <div
              key={`${log.date}-${i}-${typeof log.value === "object" ? JSON.stringify(log.value) : String(log.value)}`}
              style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 14px", borderTop:`0.5px solid ${T.border}` }}
            >
              <div style={{ flex:1, fontSize:13, color:T.text, lineHeight:1.5, minWidth:0 }}>{renderJournalLogContent(habit, log)}</div>
              <button
                type="button"
                aria-label="Delete this log entry"
                disabled={deleting}
                onClick={() => setPendingDelete(log)}
                style={{
                  flexShrink:0, width:32, height:32, marginTop:-4, border:"none", borderRadius:8, cursor:deleting ? "default" : "pointer",
                  background:"transparent", color:T.hint, fontSize:18, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center",
                }}
              >×</button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Wins */}
      {wins.map((w, i) => (
        <div key={i} style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Win 🏆</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{w}</div>
        </div>
      ))}

      {/* Hard parts */}
      {hardParts.map((h, i) => (
        <div key={i} style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.amber, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Hard part 🧱</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.6 }}>{h}</div>
        </div>
      ))}

      {/* Reflection */}
      {reflection && (
        <div style={{ padding:"9px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Reflection</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.6 }}>{reflection}</div>
        </div>
      )}

      {/* Quick notes — limit notes live in day summary or per-row when taps expanded */}
      {!isLimit ? [...uniqueNotes].reverse().map((n, i) => (
        <div key={i} style={{ padding:"8px 14px", borderBottom:i<uniqueNotes.length-1?`0.5px solid ${T.border}`:"none", background:`${T.surface}66` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, fontStyle:"italic" }}>{n}</div>
        </div>
      )) : null}

      {/* Add reflection prompt if none yet */}
      {!reflection && habit.habitType !== "goal" && habit.habitType !== "log" && (
        <div style={{ padding:"8px 14px" }}>
          <button onClick={() => onReflect(habit.id)}
            style={{ fontSize:12, color:habit.color+"99", background:"none", border:"none", cursor:"pointer", fontWeight:500, padding:0 }}>
            Add reflection →
          </button>
        </div>
      )}
    </div>

    {pendingDelete && onDeleteLogEntry ? (
      <Modal onClose={() => { if (!deleting) setPendingDelete(null); }}>
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:8 }}>Delete this entry?</div>
        <div style={{ fontSize:14, color:T.muted, lineHeight:1.55, marginBottom:22 }}>
          This removes the log from your journal and history. Your XP will stay the same.
        </div>
        <PBtn color="#9B2C2C" onClick={confirmDeleteEntry}>{deleting ? "Deleting…" : "Delete"}</PBtn>
        <GBtn onClick={() => { if (!deleting) setPendingDelete(null); }}>Cancel</GBtn>
      </Modal>
    ) : null}
    </>
  );
}

// ─── JOURNAL COMPOSE SHEET ────────────────────────────────────────────────────
/** Bottom sheet for writing or editing a pure journal entry for a given date. */
function JournalComposeSheet({ initialContent = "", date, onSave, onClose }) {
  useScrollLock(true);
  const [draft, setDraft] = useState(initialContent);
  const taRef = useRef(null);
  useEffect(() => { taRef.current?.focus(); }, []);

  const displayDate = (() => {
    const d = parseLocal(date);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  })();

  function handleSave() {
    if (!draft.trim()) return;
    onSave(date, draft.trim());
    onClose();
  }

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.55)", zIndex:400, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"20px 16px 36px", boxSizing:"border-box", touchAction:"auto" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 16px" }}/>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontFamily:T.serif, fontSize:18, color:T.text }}>📓 {displayDate}</div>
          <button type="button" onClick={onClose} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:22, lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <textarea
          ref={taRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write anything — what happened today, how you're feeling, what's on your mind…"
          rows={8}
          style={{
            width:"100%", boxSizing:"border-box", resize:"vertical",
            borderRadius:T.r, border:`0.5px solid ${T.border}`,
            background:T.surface, color:T.text, fontSize:16, lineHeight:1.65,
            padding:"12px 14px", fontFamily:T.font,
          }}
        />
        <div style={{ display:"flex", gap:10, marginTop:12 }}>
          <button type="button" onClick={handleSave} disabled={!draft.trim()}
            style={{ flex:1, padding:"12px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:draft.trim()?"pointer":"not-allowed", opacity:draft.trim()?1:0.5 }}>
            Save entry
          </button>
          <button type="button" onClick={onClose}
            style={{ padding:"12px 16px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── JOURNAL SCREEN ───────────────────────────────────────────────────────────
export function JournalScreen({ habits, goals = [], onReflect, onDeleteJournalLog, journalUserId, isPro, onUpgrade, journalEntries = [], onSaveJournalEntry, onJournalGenerated, initialTab, onInitialComposeDone, userName = "", coachName = "" }) {
  // "activity" = habit/goal log history (existing), "journal" = pure journal entries
  const [mainTab, setMainTab]   = useState(initialTab === "activity" ? "activity" : "journal");
  const [composeDate, setComposeDate] = useState(initialTab === "journal" ? todayStr() : null); // null = closed, "YYYY-MM-DD" = open

  // When navigating here from AddActionSheet "Write in journal", auto-open compose.
  // Once the sheet closes, clear the trigger so subsequent navigations don't re-open.
  useEffect(() => {
    if (initialTab === "journal" && composeDate === null) {
      onInitialComposeDone?.();
    }
  }, [composeDate]);
  const [filter, setFilter] = useState("all");
  const [viewMode, setViewMode] = useState("day"); // "day" | "week" | "month"
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [missedMap, setMissedMap] = useState({});
  const [missedEditDate, setMissedEditDate] = useState(null);
  const [missedNoteDraft, setMissedNoteDraft] = useState("");
  const [monthMissedDraft, setMonthMissedDraft] = useState("");
  const [openWeeks, setOpenWeeks] = useState(() => new Set([weekStartFor(todayStr())]));
  const [listFullyExpanded, setListFullyExpanded] = useState(false);
  const [journalCollapseNonce, setJournalCollapseNonce] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [confirmRegenDate, setConfirmRegenDate] = useState(null);
  const [expandedJournalDates, setExpandedJournalDates] = useState(() => new Set());
  const [journalSelectedDate, setJournalSelectedDate] = useState(null);
  const autoGeneratedRef = useRef(false);

  useEffect(() => {
    setMissedMap(loadJournalMissedMap(journalUserId));
  }, [journalUserId]);

  // Auto-generate yesterday's journal on first mount if: yesterday has habit logs
  // but no AI-generated entry yet and the user hasn't manually edited one.
  // Runs silently in the background — no loading spinner, no error shown.
  useEffect(() => {
    if (autoGeneratedRef.current) return;
    autoGeneratedRef.current = true;
    const yesterday = daysAgo(1);
    const yesterdayEntry = journalEntries.find(e => e.date === yesterday);
    if (yesterdayEntry?.is_ai_generated) return;
    if (yesterdayEntry?.manually_edited) return;
    const yesterdayHasLogs =
      habits.some(h => (h.logs || []).some(l => l.date === yesterday)) ||
      goals.some(g => (g.logs || []).some(l => l.date === yesterday));
    if (!yesterdayHasLogs) return;
    generateEntry(yesterday, { background: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleWeek(ws) {
    setListFullyExpanded(false);
    setOpenWeeks(prev => {
      const next = new Set(prev);
      if (next.has(ws)) next.delete(ws);
      else next.add(ws);
      return next;
    });
  }

  function persistMissed(next) {
    saveJournalMissedMap(journalUserId, next);
  }
  function setMissed(date, note) {
    setMissedMap(prev => {
      const next = { ...prev, [date]: note };
      persistMissed(next);
      return next;
    });
  }
  function clearMissed(date) {
    setMissedMap(prev => {
      const next = { ...prev };
      delete next[date];
      persistMissed(next);
      return next;
    });
  }

  function stripMarkdown(text) {
    if (!text) return text;
    return text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .trim();
  }

  function tryParseEntry(content) {
    if (!content) return null;
    const KEYWORDS = ["Wins:", "Missed:", "Why:", "Pattern:", "Tomorrow:"];
    if (!KEYWORDS.some(k => content.includes(k))) return null;
    const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) return null;
    const title = stripMarkdown(lines[0]);
    let i = 1;
    const narrativeLines = [];
    while (i < lines.length && !KEYWORDS.some(k => lines[i].startsWith(k))) {
      narrativeLines.push(lines[i]);
      i++;
    }
    const sections = {};
    while (i < lines.length) {
      for (const kw of KEYWORDS) {
        if (lines[i].startsWith(kw)) {
          sections[kw.slice(0, -1).toLowerCase()] = stripMarkdown(lines[i].slice(kw.length).trim());
          break;
        }
      }
      i++;
    }
    if (!narrativeLines.length && !Object.keys(sections).length) return null;
    return { title, narrative: narrativeLines.join(" "), ...sections };
  }

  async function generateEntry(date, { background = false } = {}) {
    const targetDate = date || tStr;
    if (generating && !background) return;
    if (!background) {
      setGenerating(true);
      setGenerateError("");
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const res = await fetch("/api/journal-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date: targetDate, habits, goals, name: userName }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Generation failed.");
      }
      // Re-fetch journal entries so the UI gets the new structured entry
      // (with is_ai_generated: true and manually_edited: false from the API)
      onJournalGenerated?.();
    } catch (err) {
      if (!background) setGenerateError(err.message || "Something went wrong.");
    } finally {
      if (!background) setGenerating(false);
    }
  }

  const allByDate = {};
  habits.forEach(h => {
    const entryKey = `habit:${h.id}`;
    const hLogs = filter === "all" || filter === entryKey ? h.logs : [];
    hLogs.forEach(l => {
      if (!allByDate[l.date]) allByDate[l.date] = {};
      if (!allByDate[l.date][entryKey]) allByDate[l.date][entryKey] = { habit: h, logs: [], entryKey };
      allByDate[l.date][entryKey].logs.push(l);
    });
  });
  goals.forEach(g => {
    const entryKey = `goal:${g.id}`;
    const gLogs = (filter === "all" || filter === entryKey)
      ? (g.logs || []).filter(l => typeof l.value === "number")
      : [];
    const goalAsEntry = { ...g, habitType: "goal", reflection: false };
    gLogs.forEach(l => {
      if (!allByDate[l.date]) allByDate[l.date] = {};
      if (!allByDate[l.date][entryKey]) allByDate[l.date][entryKey] = { habit: goalAsEntry, logs: [], entryKey };
      allByDate[l.date][entryKey].logs.push(l);
    });
  });
  const dates = Object.keys(allByDate).sort((a, b) => b.localeCompare(a));
  const loggedDaysCount = new Set([
    ...habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip").map(l => l.date)),
    ...goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number").map(l => l.date)),
  ]).size;

  const allLogDatesRaw = [
    ...habits.flatMap(h => h.logs.map(l => l.date)),
    ...goals.flatMap(g => (g.logs || []).filter(l => typeof l.value === "number").map(l => l.date)),
  ].filter(Boolean).sort();
  const firstLogDate  = allLogDatesRaw[0] || null;
  const firstLogYear  = firstLogDate ? parseInt(firstLogDate.split("-")[0], 10) : null;
  const firstLogMonth = firstLogDate ? parseInt(firstLogDate.split("-")[1], 10) - 1 : null;
  const firstLogDay   = firstLogDate ? parseInt(firstLogDate.split("-")[2], 10) : null;

  const now = new Date();
  const viewYear  = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getFullYear();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1).getMonth();
  const monthLabel = `${MONTHS[viewMonth]} ${viewYear}`;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const startPad = (firstDow + 6) % 7;

  function dayStr(d) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const entryDays = {};
  Object.entries(allByDate).forEach(([dateStr, habitMap]) => {
    const d = parseLocal(dateStr);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      const day = d.getDate();
      entryDays[day] = Object.values(habitMap).map(({ habit }) => ({ habitColor: habit.color }));
    }
  });

  // tStr must be declared BEFORE goalMarkerDays — the forEach callbacks close over
  // it synchronously, so declaring it after (as it was) caused a TDZ crash whenever
  // any goal had a targetDate or milestone log entry.
  const tStr = todayStr();

  // Goal deadlines and milestones for this month view
  const goalMarkerDays = {}; // { dayNum: [{ type:"deadline"|"milestone", label, color, emoji, isFuture }] }
  (goals || []).filter(g => g.status !== "completed").forEach(g => {
    if (g.targetDate) {
      const d = parseLocal(g.targetDate);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!goalMarkerDays[day]) goalMarkerDays[day] = [];
        goalMarkerDays[day].push({ type:"deadline", label:g.name, color:g.color, emoji:g.emoji, isFuture:g.targetDate >= tStr, goalId:g.id, currentValue:g.currentValue, targetValue:g.targetValue, startValue:g.startValue, unit:g.unit||"" });
      }
    }
    (g.logs || []).filter(l => l.type === "milestone" && l.date).forEach(ms => {
      const d = parseLocal(ms.date);
      if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
        const day = d.getDate();
        if (!goalMarkerDays[day]) goalMarkerDays[day] = [];
        goalMarkerDays[day].push({ type:"milestone", label:ms.label, color:g.color, emoji:g.emoji, isFuture:ms.date >= tStr, goalId:g.id, goalName:g.name });
      }
    });
  });
  const missedDatesList = Object.keys(missedMap).sort((a, b) => b.localeCompare(a));
  const missedMarkedCount = missedDatesList.length;
  const mergedDatesSet = new Set([...dates, ...missedDatesList]);
  const mergedDesc = [...mergedDatesSet].sort((a, b) => b.localeCompare(a));
  const hasJournalRows = mergedDatesSet.size > 0;
  // Today always first; remaining days newest → oldest (ISO date sort)
  const sortedDatesDesc = hasJournalRows ? [tStr, ...mergedDesc.filter(d => d !== tStr)] : [];
  const weekKeysDesc = [...new Set(sortedDatesDesc.map(d => weekStartFor(d)))].sort((a, b) => b.localeCompare(a));
  const weekKeysKey = weekKeysDesc.join("|");

  useEffect(() => {
    if (viewMode !== "week" || !listFullyExpanded) return;
    setOpenWeeks(new Set(weekKeysDesc));
  }, [viewMode, listFullyExpanded, weekKeysKey]);

  useEffect(() => {
    if (selectedDay == null) { setMonthMissedDraft(""); return; }
    const ds = dayStr(selectedDay);
    setMonthMissedDraft(Object.prototype.hasOwnProperty.call(missedMap, ds) ? (missedMap[ds] || "") : "");
  }, [selectedDay, viewYear, viewMonth, missedMap]);

  function renderDayOrMissed(date) {
    const onAccordionInteraction = () => setListFullyExpanded(false);
    if (Object.prototype.hasOwnProperty.call(missedMap, date)) {
      return (
        <MissedDaySection
          key={date}
          date={date}
          note={missedMap[date]}
          onEdit={() => { setMissedEditDate(date); setMissedNoteDraft(missedMap[date] || ""); }}
          onClear={() => clearMissed(date)}
          listFullyExpanded={listFullyExpanded}
          journalCollapseNonce={journalCollapseNonce}
          onAccordionInteraction={onAccordionInteraction}
        />
      );
    }
    const hasLog = allByDate[date] && Object.keys(allByDate[date]).length > 0;
    if (hasLog || date === tStr) {
      return (
        <DaySection
          key={date}
          date={date}
          dayHabits={hasLog ? Object.values(allByDate[date]) : []}
          onReflect={onReflect}
          onDeleteLogEntry={onDeleteJournalLog}
          listFullyExpanded={listFullyExpanded}
          journalCollapseNonce={journalCollapseNonce}
          onAccordionInteraction={onAccordionInteraction}
        />
      );
    }
    return null;
  }

  const listEmpty = sortedDatesDesc.length === 0;

  // Sort newest-first and deduplicate by date (keep the row with the latest updated_at).
  // Duplicates shouldn't exist after the upsert-based saves, but this guards legacy data.
  const sortedJournalEntries = [...journalEntries]
    .sort((a, b) => {
      const dateDiff = b.date.localeCompare(a.date);
      if (dateDiff !== 0) return dateDiff;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    })
    .filter((entry, idx, arr) => arr.findIndex(e => e.date === entry.date) === idx);
  const todayJournalEntry = journalEntries.find(e => e.date === tStr);

  return (
    <div data-tour="journal-list">
      {/* Compose sheet */}
      {composeDate && (
        <JournalComposeSheet
          date={composeDate}
          initialContent={journalEntries.find(e => e.date === composeDate)?.content || ""}
          onSave={(date, content) => onSaveJournalEntry?.(date, content)}
          onClose={() => setComposeDate(null)}
        />
      )}

      {/* Header */}
      <div style={{ padding:"16px 18px 10px", display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text }}>Journal</div>
          <div style={{ fontSize:13, color:T.muted, marginTop:3 }}>
            {mainTab === "activity" ? (
              <>
                {loggedDaysCount} days logged
                {missedMarkedCount > 0 ? <span> · {missedMarkedCount} missed</span> : null}
              </>
            ) : (
              <>{sortedJournalEntries.length > 0 ? `${sortedJournalEntries.length} ${sortedJournalEntries.length === 1 ? "entry" : "entries"}` : "Your daily story, written by Forged"}</>
            )}
          </div>
        </div>
        {mainTab === "activity" ? (
          <div data-tour="journal-viewmode" style={{ display:"flex", background:T.surface, borderRadius:T.rsm, padding:3, gap:2 }}>
            {[["day","Day"],["week","Week"],["month","Month"]].map(([mode, label]) => (
              <button key={mode} type="button" onClick={() => { setViewMode(mode); setSelectedDay(null); if (mode === "month") setListFullyExpanded(false); }}
                style={{ padding:"5px 10px", borderRadius:7, border:"none", cursor:"pointer",
                  background:viewMode === mode ? T.raised : "none",
                  color:viewMode === mode ? T.text : T.muted, fontSize:11, fontWeight:500, transition:"all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:0, padding:"0 18px 14px" }}>
        {[["journal","Journal"],["activity","Activity"]].map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setMainTab(tab)}
            style={{ padding:"6px 16px", borderRadius:0, border:"none", cursor:"pointer", fontSize:12, fontWeight:500,
              background: mainTab === tab ? T.accent + "22" : "none",
              color: mainTab === tab ? T.accent : T.muted,
              borderBottom: mainTab === tab ? `2px solid ${T.accent}` : "2px solid transparent",
              transition:"all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── JOURNAL TAB ── */}
      {mainTab === "journal" && (
        <div style={{ paddingBottom:32 }}>

          {/* ── Explanation microcopy ── */}
          {(() => {
            const coachLabel = coachName && coachName !== "Coach" ? coachName : "your AI coach";
            return (
              <div style={{ padding:"0 18px 18px" }}>
                <div style={{ fontSize:13, color:T.sub, lineHeight:1.65 }}>
                  You don't have to write this. Log habits, chat to {coachLabel}, add notes — your coach turns the day into a daily entry.
                </div>
              </div>
            );
          })()}

          {/* ── Today's entry ── */}
          <div style={{ padding:"0 16px 24px" }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.sub, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Today</div>
            {todayJournalEntry ? (() => {
              const parsed = tryParseEntry(todayJournalEntry.content);
              return (
                <div style={{ borderRadius:T.r, border:`0.5px solid ${T.border}`, background:T.surface, overflow:"hidden" }}>
                  <div style={{ padding:"16px 18px 14px" }}>
                    {parsed ? (
                      <>
                        <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:10, lineHeight:1.3 }}>{parsed.title}</div>
                        <div style={{ fontSize:14, color:T.text, lineHeight:1.75, marginBottom:14 }}>{parsed.narrative}</div>
                        {[
                          parsed.wins    && { icon:"✓", label:"Wins",    text:parsed.wins,    color:"#27ae60" },
                          parsed.missed  && parsed.missed.toLowerCase() !== "none" && { icon:"✗", label:"Missed",  text:parsed.missed,  color:T.amber },
                          parsed.why     && { icon:"→", label:"Why",     text:parsed.why,     color:T.muted },
                          parsed.pattern && { icon:"◎", label:"Pattern", text:parsed.pattern, color:T.accent },
                          parsed.tomorrow && { icon:"↑", label:"Tomorrow", text:parsed.tomorrow, color:T.muted },
                        ].filter(Boolean).map(row => (
                          <div key={row.label} style={{ display:"flex", gap:8, marginBottom:6, alignItems:"flex-start" }}>
                            <span style={{ fontSize:12, color:row.color, fontWeight:700, minWidth:14, marginTop:2 }}>{row.icon}</span>
                            <div style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>
                              <span style={{ color:T.muted, marginRight:4 }}>{row.label}:</span>
                              {row.text}
                            </div>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div style={{ fontSize:14, color:T.text, lineHeight:1.75, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{todayJournalEntry.content}</div>
                    )}
                  </div>
                  <div style={{ display:"flex", borderTop:`0.5px solid ${T.border}` }}>
                    {confirmRegenDate === tStr ? (
                      <>
                        <button type="button"
                          onClick={() => { setConfirmRegenDate(null); generateEntry(tStr); }}
                          style={{ flex:1, padding:"10px 0", background:"none", border:"none", fontSize:12, color:"#e74c3c", fontWeight:600, cursor:"pointer", borderRight:`0.5px solid ${T.border}` }}>
                          Replace my edits →
                        </button>
                        <button type="button"
                          onClick={() => setConfirmRegenDate(null)}
                          style={{ flex:1, padding:"10px 0", background:"none", border:"none", fontSize:12, color:T.muted, cursor:"pointer" }}>
                          Keep them
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button"
                          onClick={() => {
                            if (todayJournalEntry?.manually_edited) {
                              setConfirmRegenDate(tStr);
                            } else {
                              generateEntry(tStr);
                            }
                          }}
                          disabled={generating}
                          style={{ flex:1, padding:"10px 0", background:"none", border:"none", fontSize:12, color:generating ? T.hint : T.accent, fontWeight:500, cursor:generating ? "not-allowed" : "pointer", borderRight:`0.5px solid ${T.border}` }}>
                          {generating ? "Writing…" : "↺ Regenerate"}
                        </button>
                        <button type="button" onClick={() => { setConfirmRegenDate(null); setComposeDate(tStr); }}
                          style={{ flex:1, padding:"10px 0", background:"none", border:"none", fontSize:12, color:T.muted, cursor:"pointer" }}>
                          ✎ Edit manually
                        </button>
                      </>
                    )}
                  </div>
                  {generateError && (
                    <div style={{ padding:"8px 18px", fontSize:12, color:"#e74c3c", borderTop:`0.5px solid ${T.border}` }}>{generateError}</div>
                  )}
                </div>
              );
            })() : (
              <div style={{ padding:"20px 18px", borderRadius:T.r, border:`1.5px dashed ${T.border}`, background:T.raised }}>
                <div style={{ fontSize:13, color:T.muted, lineHeight:1.7, marginBottom:16 }}>
                  Log habits, chat to {coachName && coachName !== "Coach" ? coachName : "your AI coach"}, add notes — then tap below and your coach writes up the day.
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button type="button" onClick={() => generateEntry(tStr)} disabled={generating}
                    style={{ padding:"10px 18px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:600, cursor:generating ? "not-allowed" : "pointer", opacity:generating ? 0.65 : 1 }}>
                    {generating ? "Writing…" : "Generate today's entry"}
                  </button>
                  <button type="button" onClick={() => setComposeDate(tStr)}
                    style={{ padding:"10px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
                    Write manually
                  </button>
                </div>
                {generateError && <div style={{ marginTop:10, fontSize:12, color:"#e74c3c" }}>{generateError}</div>}
              </div>
            )}
          </div>

          {/* ── Past entries ── */}
          {sortedJournalEntries.filter(e => e.date !== tStr).length > 0 && (
            <div style={{ padding:"0 16px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:T.sub, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>Past entries</div>
              {sortedJournalEntries.filter(e => e.date !== tStr).map(entry => {
                const isExpanded = expandedJournalDates.has(entry.date) || journalSelectedDate === entry.date;
                const parsed = tryParseEntry(entry.content);
                const d = parseLocal(entry.date);
                const label = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
                const previewTitle = parsed?.title || entry.content.split("\n")[0].slice(0, 55);
                const previewLine = (() => {
                  if (!parsed?.narrative) return null;
                  const first = parsed.narrative.split(/[.!?]/)[0].trim();
                  if (!first) return null;
                  return first.length > 80 ? first.slice(0, 77) + "…" : first + ".";
                })();
                return (
                  <div key={entry.id || entry.date} style={{ marginBottom:8 }}>
                    <button type="button"
                      onClick={() => setExpandedJournalDates(prev => {
                        const n = new Set(prev);
                        if (n.has(entry.date)) n.delete(entry.date); else n.add(entry.date);
                        return n;
                      })}
                      style={{
                        width:"100%", padding:"11px 16px",
                        borderRadius:isExpanded ? `${T.r} ${T.r} 0 0` : T.r,
                        border:`0.5px solid ${isExpanded ? T.accent + "66" : T.border}`,
                        background:T.surface, cursor:"pointer",
                        display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, textAlign:"left",
                        transition:"border-color 0.15s",
                      }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, color:T.muted, marginBottom:2 }}>{label}</div>
                        <div style={{ fontSize:14, color:T.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{previewTitle}</div>
                        {previewLine && !isExpanded && (
                          <div style={{ fontSize:12, color:T.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:2 }}>{previewLine}</div>
                        )}
                      </div>
                      <div style={{ color:T.muted, fontSize:16, flexShrink:0, transform:isExpanded ? "rotate(90deg)" : "none", transition:"transform 0.15s" }}>›</div>
                    </button>
                    {isExpanded && (
                      <div style={{ padding:"14px 18px 16px", background:T.raised, borderRadius:`0 0 ${T.r} ${T.r}`, border:`0.5px solid ${T.accent + "66"}`, borderTop:"none" }}>
                        {parsed ? (
                          <>
                            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text, marginBottom:10, lineHeight:1.3 }}>{parsed.title}</div>
                            <div style={{ fontSize:14, color:T.text, lineHeight:1.75, marginBottom:12 }}>{parsed.narrative}</div>
                            {[
                              parsed.wins    && { icon:"✓", label:"Wins",    text:parsed.wins,    color:"#27ae60" },
                              parsed.missed  && parsed.missed.toLowerCase() !== "none" && { icon:"✗", label:"Missed",  text:parsed.missed,  color:T.amber },
                              parsed.why     && { icon:"→", label:"Why",     text:parsed.why,     color:T.muted },
                              parsed.pattern && { icon:"◎", label:"Pattern", text:parsed.pattern, color:T.accent },
                              parsed.tomorrow && { icon:"↑", label:"Tomorrow", text:parsed.tomorrow, color:T.muted },
                            ].filter(Boolean).map(row => (
                              <div key={row.label} style={{ display:"flex", gap:8, marginBottom:6, alignItems:"flex-start" }}>
                                <span style={{ fontSize:12, color:row.color, fontWeight:700, minWidth:14, marginTop:2 }}>{row.icon}</span>
                                <div style={{ fontSize:13, color:T.text, lineHeight:1.5 }}>
                                  <span style={{ color:T.muted, marginRight:4 }}>{row.label}:</span>
                                  {row.text}
                                </div>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div style={{ fontSize:14, color:T.text, lineHeight:1.75, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{entry.content}</div>
                        )}
                        <button type="button" onClick={() => setComposeDate(entry.date)}
                          style={{ marginTop:12, fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", padding:0 }}>Edit →</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {sortedJournalEntries.length === 0 && (
            <div style={{ padding:"32px 24px 0", textAlign:"center", color:T.muted, fontSize:13, lineHeight:1.7 }}>
              No entries yet. Talk to Forged today and tap "Write today's entry".
            </div>
          )}

          {/* ── Activity log link ── */}
          <div style={{ padding:"28px 16px 0", textAlign:"center" }}>
            <button type="button" onClick={() => setMainTab("activity")}
              style={{ background:"none", border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"8px 18px", fontSize:12, color:T.muted, cursor:"pointer" }}>
              View activity log →
            </button>
          </div>
        </div>
      )}

      {/* ── ACTIVITY TAB ── */}
      {mainTab === "activity" && (
      <>
      <div data-tour="journal-filters" style={{ display:"flex", gap:6, padding:"0 16px 14px", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        {[{ id:"all", name:"All", emoji:"", color:T.accent }, ...habits.map(h => ({ id:`habit:${h.id}`, name:h.name, emoji:h.emoji, color:h.color })), ...goals.map(g => ({ id:`goal:${g.id}`, name:g.name, emoji:g.emoji, color:g.color }))].map(f => (
          <button key={f.id} type="button" onClick={() => { setFilter(f.id); setSelectedDay(null); }}
            style={{ padding:"5px 12px", borderRadius:20, whiteSpace:"nowrap", flexShrink:0,
              border:`0.5px solid ${filter === f.id ? f.color : T.borderStrong}`,
              background:filter === f.id ? f.color + "22" : "none",
              color:filter === f.id ? f.color : T.muted,
              fontSize:12, fontWeight:filter === f.id ? 500 : 400, cursor:"pointer" }}>
            {f.emoji ? `${f.emoji} ${f.name}` : f.name}
          </button>
        ))}
      </div>

      {(viewMode === "day" || viewMode === "week") && !listEmpty && (
        <div style={{ padding:"0 16px 12px", display:"flex", justifyContent:"flex-end" }}>
          <button
            type="button"
            onClick={() => {
              if (listFullyExpanded) {
                setListFullyExpanded(false);
                setJournalCollapseNonce(n => n + 1);
                if (viewMode === "week") setOpenWeeks(new Set());
              } else {
                setListFullyExpanded(true);
                if (viewMode === "week") setOpenWeeks(new Set(weekKeysDesc));
              }
            }}
            style={{
              padding:"6px 12px",
              borderRadius:T.rsm,
              border:`0.5px solid ${listFullyExpanded ? T.borderMid : T.borderStrong}`,
              background:listFullyExpanded ? T.raised : T.surface,
              color:listFullyExpanded ? T.text : T.muted,
              fontSize:11,
              fontWeight:500,
              cursor:"pointer",
              transition:"background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
            }}>
            {listFullyExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      {viewMode === "month" && !isPro && (
        <div style={{ position:"relative", margin:"0 14px 16px", borderRadius:T.r, overflow:"hidden" }}>
          {/* Blurred skeleton calendar */}
          <div style={{ filter:"blur(5px)", pointerEvents:"none", userSelect:"none", opacity:0.4, padding:"16px 0" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
              {Array.from({length:35}).map((_, i) => (
                <div key={i} style={{ aspectRatio:"1", borderRadius:8, background:T.surface, border:`1px solid ${T.border}` }}/>
              ))}
            </div>
          </div>
          {/* Lock overlay */}
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, padding:"0 24px", textAlign:"center", background:"rgba(14,14,14,0.80)", backdropFilter:"blur(2px)", borderRadius:T.r }}>
            <div style={{ fontSize:22 }}>🔒</div>
            <div style={{ fontSize:14, fontWeight:500, color:T.text }}>Full history is part of Forged Pro</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>Core logging is free. Full history and the calendar view are included in Forged Pro.</div>
            <button onClick={onUpgrade}
              style={{ marginTop:6, padding:"10px 22px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#0F0F0D", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Unlock Forged Pro →
            </button>
          </div>
        </div>
      )}

      {viewMode === "month" && isPro && (
        <div style={{ padding:"0 14px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <button type="button" onClick={() => { setMonthOffset(o => o + 1); setSelectedDay(null); }}
              style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:20, padding:"4px 8px" }}>‹</button>
            <div style={{ fontFamily:T.serif, fontSize:18, color:T.text }}>{monthLabel}</div>
            <button type="button" onClick={() => { setMonthOffset(o => Math.max(0, o - 1)); setSelectedDay(null); }}
              disabled={monthOffset === 0}
              style={{ background:"none", border:"none", color:monthOffset === 0 ? T.hint : T.muted, cursor:monthOffset === 0 ? "default" : "pointer", fontSize:20, padding:"4px 8px" }}>›</button>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:6 }}>
            {["M","T","W","T","F","S","S"].map((d, i) => (
              <div key={i} style={{ textAlign:"center", fontSize:10, color:T.hint, fontWeight:500 }}>{d}</div>
            ))}
          </div>

          <div style={{ fontSize:10, color:T.hint, marginBottom:8, display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
            <span>● logged</span>
            <span style={{ color:"rgba(230,126,34,0.9)", fontWeight:600 }}>? no log</span>
            <span style={{ color:T.amber, fontWeight:600 }}>✕ missed</span>
            <span style={{ color:T.gold, fontWeight:600 }}>🎯 goal deadline</span>
            <span style={{ color:T.gold }}>◆ milestone</span>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:16 }}>
            {Array.from({ length:startPad }, (_, i) => <div key={`pad-${i}`}/>)}
            {Array.from({ length:daysInMonth }, (_, i) => {
              const day = i + 1;
              const ds = dayStr(day);
              const hasEntries = !!entryDays[day];
              const isToday = ds === tStr;
              const isSelected = selectedDay === day;
              const isJourneyStart = firstLogDate === ds;
              const isMissed = Object.prototype.hasOwnProperty.call(missedMap, ds);
              const canMarkMissed = !!(firstLogDate && ds >= firstLogDate && ds < tStr && !hasEntries);
              const isOpenDay = canMarkMissed && !isMissed;
              const habitColors = hasEntries ? [...new Set(entryDays[day].map(e => e.habitColor))].slice(0, 3) : [];
              const goalMarkers = goalMarkerDays[day] || [];
              const hasDeadline = goalMarkers.some(m => m.type === "deadline");
              const hasMilestone = goalMarkers.some(m => m.type === "milestone");
              const anyGoalMarker = hasDeadline || hasMilestone;
              const goalMarkerTooltip = goalMarkers.map(m => `${m.type === "deadline" ? "🎯 Deadline" : "◆ Milestone"}: ${m.label}`).join(" · ");
              const clickable = hasEntries || isJourneyStart || isMissed || canMarkMissed || anyGoalMarker;
              let border = T.border;
              if (isSelected) border = T.accent;
              else if (isJourneyStart) border = T.gold;
              else if (isMissed) border = "rgba(230,126,34,0.45)";
              else if (hasDeadline) border = "rgba(200,144,42,0.55)";
              else if (hasMilestone) border = "rgba(200,144,42,0.3)";
              else if (isOpenDay) border = T.borderMid;
              else if (isToday) border = T.borderMid;
              return (
                <button key={day} type="button"
                  title={goalMarkerTooltip || undefined}
                  onClick={() => clickable && setSelectedDay(isSelected ? null : day)}
                  style={{
                    aspectRatio:"1", borderRadius:8,
                    border:`1px ${isOpenDay ? "dashed" : "solid"} ${border}`,
                    background:isSelected ? "rgba(192,57,43,0.15)" : hasDeadline ? "rgba(200,144,42,0.1)" : hasMilestone ? "rgba(200,144,42,0.05)" : isJourneyStart && !hasEntries ? "rgba(200,144,42,0.08)" : isMissed ? "rgba(230,126,34,0.06)" : isToday ? T.surface : T.raised,
                    cursor:clickable ? "pointer" : "default",
                    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1,
                    padding:2, transition:"all 0.15s",
                  }}>
                  <span style={{
                    fontSize:11,
                    color:isToday ? T.accent : isJourneyStart ? T.gold : hasEntries ? T.text : isMissed ? T.amber : anyGoalMarker ? T.gold : T.muted,
                    fontWeight:isToday || isJourneyStart || isMissed || anyGoalMarker ? 500 : 400,
                  }}>{day}</span>
                  {hasDeadline ? (
                    <span style={{ fontSize:9, lineHeight:1 }}>🎯</span>
                  ) : hasMilestone ? (
                    <span style={{ fontSize:8, color: goalMarkers.find(m=>m.type==="milestone")?.isFuture ? T.gold : T.hint, lineHeight:1 }}>◆</span>
                  ) : hasEntries ? (
                    <div style={{ display:"flex", gap:2 }}>
                      {habitColors.map((c, ci) => <div key={ci} style={{ width:4, height:4, borderRadius:"50%", background:c }}/>)}
                    </div>
                  ) : isMissed ? (
                    <div title="Marked missed" style={{ fontSize:10, fontWeight:800, color:T.amber, width:16, height:16, borderRadius:"50%", background:"rgba(230,126,34,0.18)", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}>✕</div>
                  ) : isJourneyStart ? (
                    <div style={{ fontSize:7, color:T.gold }}>✦</div>
                  ) : isOpenDay ? (
                    <div title="No logs — select to mark missed" style={{ fontSize:11, fontWeight:700, color:"rgba(230,126,34,0.88)", lineHeight:1 }}>?</div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selectedDay && (() => {
            const selDs = dayStr(selectedDay);
            const selHabits = Object.values(allByDate[selDs] || {});
            const hasSelEntries = selHabits.length > 0;
            const selGoalMarkers = goalMarkerDays[selectedDay] || [];
            const hasGoalMarkers = selGoalMarkers.length > 0;
            const showMissedEditor = !hasSelEntries && firstLogDate && selDs >= firstLogDate && selDs < tStr;
            return (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10 }}>
                  {MONTHS[viewMonth]} {selectedDay}
                </div>
                {firstLogDate && selDs === firstLogDate && (
                  <div style={{ margin:"0 0 8px", padding:"10px 14px", background:"rgba(200,144,42,0.08)", borderRadius:T.rsm, border:"0.5px solid rgba(200,144,42,0.25)", display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:14 }}>✦</span>
                    <span style={{ fontSize:12, color:T.gold, fontWeight:500 }}>Day one — this is where your journey began.</span>
                  </div>
                )}

                {/* Goal deadline / milestone cards for this day */}
                {hasGoalMarkers && (
                  <div style={{ marginBottom: hasSelEntries ? 12 : 0 }}>
                    {selGoalMarkers.map((m, mi) => {
                      if (m.type === "deadline") {
                        const range = (m.targetValue ?? 0) - (m.startValue ?? 0);
                        const pct = range !== 0
                          ? Math.max(0, Math.min(100, Math.round(((m.currentValue - m.startValue) / range) * 100)))
                          : (m.currentValue >= m.targetValue ? 100 : 0);
                        return (
                          <div key={mi} style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${m.color || T.border}55`, marginBottom:8 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                              <span style={{ fontSize:18 }}>{m.emoji || "🎯"}</span>
                              <div style={{ flex:1 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:m.color || T.text, lineHeight:1.3 }}>{m.label}</div>
                                <div style={{ fontSize:11, color:T.hint, marginTop:2 }}>🎯 Target deadline</div>
                              </div>
                            </div>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                              <span style={{ fontSize:12, color:T.muted }}>
                                <strong style={{ color:m.color || T.text }}>{m.currentValue}{m.unit}</strong>
                                {" of "}
                                <strong style={{ color:T.text }}>{m.targetValue}{m.unit}</strong>
                              </span>
                              <span style={{ fontSize:12, color:T.hint }}>{pct}%</span>
                            </div>
                            <div style={{ height:5, borderRadius:3, background:T.raised, overflow:"hidden" }}>
                              <div style={{ height:"100%", borderRadius:3, background:m.color || T.gold, width:`${pct}%`, transition:"width 0.4s" }} />
                            </div>
                          </div>
                        );
                      }
                      if (m.type === "milestone") {
                        return (
                          <div key={mi} style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${m.color || T.border}55`, marginBottom:8, display:"flex", alignItems:"flex-start", gap:10 }}>
                            <span style={{ fontSize:16, marginTop:1 }}>{m.emoji || "◆"}</span>
                            <div>
                              <div style={{ fontSize:11, color:T.hint, marginBottom:3 }}>◆ Milestone · {m.goalName}</div>
                              <div style={{ fontSize:13, fontWeight:600, color:m.color || T.text }}>{m.label}</div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}

                {/* Habit log entries */}
                {hasSelEntries ? (
                  selHabits.map(({ habit, logs, entryKey }) => (
                    <HabitDayCard key={entryKey || habit.id} habit={habit} logs={logs} onReflect={onReflect} onDeleteLogEntry={onDeleteJournalLog}/>
                  ))
                ) : (
                  <div style={{ padding:"0 0 8px" }}>
                    {showMissedEditor ? (
                      <div style={{ padding:"12px 14px", background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
                        <div style={{ fontSize:12, color:T.muted, marginBottom:6, lineHeight:1.5 }}>
                          <span style={{ fontSize:14, fontWeight:700, color:"rgba(230,126,34,0.95)", marginRight:6 }}>?</span>
                          Nothing logged this day. Mark it <strong style={{ color:T.text }}>missed</strong> if you skipped forging, and add a short note (travel, sick day…). Clear later if you catch up on Today.
                        </div>
                        <textarea
                          value={monthMissedDraft}
                          onChange={e => setMonthMissedDraft(e.target.value)}
                          placeholder="Optional note (e.g. sick, travel…)"
                          rows={2}
                          style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font }}
                        />
                        <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                          <button type="button" onClick={() => { setMissed(selDs, monthMissedDraft.trim()); }}
                            style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.amber, color:"#1a1208", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                            Mark missed
                          </button>
                          {Object.prototype.hasOwnProperty.call(missedMap, selDs) ? (
                            <button type="button" onClick={() => { clearMissed(selDs); setMonthMissedDraft(""); }}
                              style={{ padding:"8px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>
                              Clear mark
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      !hasGoalMarkers && (
                        <div style={{ padding:"20px 0", textAlign:"center", color:T.muted, fontSize:13 }}>No entries (future or before you started)</div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {Object.keys(entryDays).length === 0 && firstLogDate && (
            viewYear < firstLogYear ||
            (viewYear === firstLogYear && viewMonth < firstLogMonth)
          ) && (
            <div style={{ padding:"40px 20px", textAlign:"center" }}>
              <div style={{ fontSize:34, marginBottom:12 }}>✨</div>
              <div style={{ fontSize:15, color:T.text, fontWeight:500, marginBottom:8, fontFamily:T.serif }}>
                Your journey hadn't started yet
              </div>
              <div style={{ fontSize:13, color:T.muted, lineHeight:1.7 }}>
                You began forging on{" "}
                <span style={{ color:T.text, fontWeight:500 }}>
                  {MONTHS[firstLogMonth]} {firstLogDay}, {firstLogYear}
                </span>
                {" "}— every great streak has a first day.
              </div>
            </div>
          )}
          {Object.keys(entryDays).length === 0 && !(firstLogDate && (
            viewYear < firstLogYear ||
            (viewYear === firstLogYear && viewMonth < firstLogMonth)
          )) && (
            <div style={{ padding:"40px 20px", textAlign:"center" }}>
              <div style={{ fontSize:13, color:T.muted }}>No entries this month</div>
            </div>
          )}
        </div>
      )}

      {viewMode === "day" && (
        <>
          {listEmpty && (
            <div style={{ padding:"60px 30px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:14 }}>📓</div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>Nothing here yet. Log a habit on <strong style={{ color:T.text }}>Today</strong> and add a line about how it went — that's what the pattern detection reads.</div>
            </div>
          )}
          {!listEmpty && sortedDatesDesc.map(date => renderDayOrMissed(date))}
        </>
      )}

      {viewMode === "week" && (
        <>
          {listEmpty && (
            <div style={{ padding:"60px 30px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:14 }}>📓</div>
              <div style={{ fontSize:14, color:T.muted, lineHeight:1.7 }}>Nothing to group by week yet.</div>
            </div>
          )}
          {!listEmpty && weekKeysDesc.map(ws => {
            const daysInWeek = sortedDatesDesc
              .filter(d => weekStartFor(d) === ws)
              .sort((a, b) => b.localeCompare(a));
            const expanded = openWeeks.has(ws);
            const missedMarkedInWeek = daysInWeek.filter(d => Object.prototype.hasOwnProperty.call(missedMap, d)).length;
            const openDaysInWeek = daysInWeek.filter(d => {
              const hasLog = allByDate[d] && Object.keys(allByDate[d]).length > 0;
              return !!(firstLogDate && d >= firstLogDate && d < tStr && !hasLog && !Object.prototype.hasOwnProperty.call(missedMap, d));
            }).length;
            return (
              <div key={ws} style={{ margin:"0 14px 8px", borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden", background:T.raised }}>
                <button
                  type="button"
                  onClick={() => toggleWeek(ws)}
                  style={{
                    width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"12px 14px", background:T.surface, border:"none", cursor:"pointer", gap:10,
                  }}>
                  <span style={{ fontSize:12, fontWeight:600, color:T.text, textAlign:"left", lineHeight:1.35 }}>
                    Week · {fmtWeekRange(ws)}
                    <span style={{ fontWeight:400, color:T.muted, marginLeft:8 }}>({daysInWeek.length})</span>
                    {missedMarkedInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:500, color:T.muted, marginTop:3 }}>{missedMarkedInWeek} missed</span>
                    ) : null}
                    {missedMarkedInWeek === 0 && openDaysInWeek > 0 ? (
                      <span style={{ display:"block", fontSize:10, fontWeight:500, color:"rgba(230,126,34,0.75)", marginTop:3 }}>? {openDaysInWeek} day{openDaysInWeek !== 1 ? "s" : ""} with no log — check Month or Today</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize:12, color:T.hint, flexShrink:0 }}>{expanded ? "▾" : "▸"}</span>
                </button>
                {expanded ? (
                  <div style={{ padding:"4px 0 10px" }}>
                    {daysInWeek.map(date => renderDayOrMissed(date))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      )}

      {missedEditDate && (
        <div style={{ margin:"0 14px 24px", padding:14, background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:12, color:T.text, marginBottom:8 }}><span style={{ color:T.amber, fontWeight:700, marginRight:6 }}>✕</span>Missed · {fmtEntryDate(missedEditDate)}</div>
          <textarea
            value={missedNoteDraft}
            onChange={e => setMissedNoteDraft(e.target.value)}
            placeholder="Optional note"
            rows={3}
            style={{ width:"100%", boxSizing:"border-box", resize:"vertical", borderRadius:8, border:`0.5px solid ${T.border}`, background:T.raised, color:T.text, fontSize:13, padding:10, fontFamily:T.font }}
          />
          <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
            <button type="button" onClick={() => { setMissed(missedEditDate, missedNoteDraft.trim()); setMissedEditDate(null); }}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:T.amber, color:"#1a1208", fontSize:12, fontWeight:600, cursor:"pointer" }}>Save</button>
            <button type="button" onClick={() => setMissedEditDate(null)}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:12, cursor:"pointer" }}>Cancel</button>
            <button type="button" onClick={() => { clearMissed(missedEditDate); setMissedEditDate(null); }}
              style={{ padding:"8px 14px", borderRadius:T.rsm, border:"none", background:"none", color:T.hint, fontSize:12, cursor:"pointer" }}>Clear mark</button>
          </div>
        </div>
      )}
      </>
      )}

      <div style={{ height:20 }}/>
    </div>
  );
}

// Shared journal entry card
export function EntryCard({ entry, onReflect }) {
  return (
    <div style={{ margin:"0 14px 10px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 15px 10px", borderBottom:`0.5px solid ${T.border}` }}>
        <div style={{ width:26, height:26, borderRadius:7, background:entry.habitColor+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>{entry.habitEmoji}</div>
        <span style={{ fontSize:12, fontWeight:500, color:entry.habitColor }}>{entry.habitName}</span>
        <span style={{ marginLeft:"auto", fontSize:11, color:T.hint, fontFamily:"monospace" }}>{entry.date}</span>
      </div>
      {entry.reflection && (
        <div style={{ padding:"12px 15px", borderBottom:entry.note&&entry.note.trim()?`0.5px solid ${T.border}`:"none" }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Reflection</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.65 }}>{entry.reflection}</div>
        </div>
      )}
      {entry.win && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.green, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Win 🏆</div>
          <div style={{ fontSize:13, color:T.text, lineHeight:1.55 }}>{entry.win}</div>
        </div>
      )}
      {entry.hardPart && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.amber, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Hard part 🧱</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{entry.hardPart}</div>
        </div>
      )}
      {entry.note && entry.note.trim() && (
        <div style={{ padding:"10px 15px", borderTop:`0.5px solid ${T.border}`, background:`${T.surface}88` }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Note</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55, fontStyle:"italic" }}>{entry.note}</div>
        </div>
      )}
      {entry.minutes && (
        <div style={{ padding:"6px 15px 10px" }}>
          <span style={{ fontSize:11, color:T.hint }}>⏱ {entry.minutes} min logged</span>
        </div>
      )}
      {!entry.reflection && (
        <div style={{ padding:"8px 15px" }}>
          <button onClick={() => onReflect(entry.habitId)} style={{ fontSize:12, color:entry.habitColor, background:"none", border:"none", cursor:"pointer", fontWeight:500 }}>Add reflection →</button>
        </div>
      )}
    </div>
  );
}

// isLegacyProgressType is used in HabitDayCard — define it locally since it's also in utils
function isLegacyProgressType(type) {
  return ["progress", "numeric"].includes(type);
}
