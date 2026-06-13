import { useState, useEffect } from "react";
import { T, COLORS, COACH_ICON_OPTIONS, PROFILE_COACH_NAME_MAX, clampProfileCoachName } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  todayStr, parseLocal, daysAgo, getGoalProgress, sharedMemberWeekSessionCount, normalizeCoachIcon,
} from "../utils.js";
import { Modal, GBtn, PBtn, FG, lbl, inp } from "../components/ui.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";

/** Must match /api/nudge-friend.js — max nudges per friend per sender-local calendar day. */
const NUDGE_DAILY_LIMIT = 3;

export function LogGoalModal({ goal, onClose, onLog }) {
  const [val,  setVal]  = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:4 }}>{goal.emoji} {goal.name}</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:22 }}>
        Now: <strong style={{ color:goal.color }}>{goal.currentValue}{goal.unit}</strong>
        {" → "}Goal: <strong style={{ color:T.text }}>{goal.targetValue}{goal.unit}</strong>
      </div>
      <FG label={`Current ${goal.unit || "value"}`}>
        <input style={inp} type="number" step="any" placeholder={`e.g. ${goal.currentValue}`}
          value={val} onChange={e => setVal(e.target.value)} autoFocus/>
      </FG>
      <FG label="Note (optional)" mb={0}>
        <input style={inp} placeholder="Optional note" value={note} onChange={e => setNote(e.target.value)} maxLength={140}/>
      </FG>
      <PBtn onClick={() => { if (!val) return; onLog(goal.id, parseFloat(val), note); onClose(); }}>Log it</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── ADD GOAL MODAL ───────────────────────────────────────────────────────────
export function AddGoalModal({ onClose, onSave }) {
  const [name,       setName]       = useState("");
  const [emoji,      setEmoji]      = useState("");
  const [unit,       setUnit]       = useState("");
  const [startVal,   setStartVal]   = useState("");
  const [targetVal,  setTargetVal]  = useState("");
  const [targetDate, setTargetDate] = useState("");

  const start  = parseFloat(startVal);
  const target = parseFloat(targetVal);
  const hasValues = !isNaN(start) && !isNaN(target) && start !== target;
  const direction = hasValues && target < start ? "decreasing" : "increasing";
  const canSave = name.trim() && hasValues;

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:4 }}>Set a goal</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:14, lineHeight:1.55 }}>
        A <strong style={{ color:T.text }}>goal</strong> is an outcome with a start and target number (you log how close you are). <strong style={{ color:T.text }}>Habits</strong> are repeated actions (daily tap, weekly sessions, build time, or staying under a limit).
      </div>
      <div style={{ marginBottom:20, padding:"12px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}` }}>
        <div style={{ fontSize:10, fontWeight:600, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Examples</div>
        <ul style={{ margin:0, paddingLeft:18, fontSize:12, color:T.muted, lineHeight:1.65 }}>
          <li>Weight: 92 kg → 85 kg (log weigh-ins toward the target)</li>
          <li>Savings: $0 → $5,000 emergency fund</li>
          <li>Strength: squat 1RM 225 → 275 lb</li>
          <li>Body fat %, race time, or any number you want to reach by a date</li>
        </ul>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Goal name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lose weight" maxLength={40} autoFocus/>
        </div>
        <div>
          <label style={lbl}>Emoji</label>
          <input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🎯" maxLength={2}/>
        </div>
      </div>

      <FG label="What are you tracking? (unit)">
        <input style={inp} value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. kg, $, km, hours" maxLength={20}/>
      </FG>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Starting value</label>
          <input style={inp} type="number" step="any" value={startVal} onChange={e => setStartVal(e.target.value)} placeholder="74.5"/>
        </div>
        <div style={{ flex:1 }}>
          <label style={lbl}>Target value</label>
          <input style={inp} type="number" step="any" value={targetVal} onChange={e => setTargetVal(e.target.value)} placeholder="80"/>
        </div>
      </div>

      {hasValues && (
        <div style={{ marginBottom:20, padding:"10px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, fontSize:12, color:T.muted }}>
          Direction inferred: <strong style={{ color:T.text }}>{direction === "decreasing" ? "↓ decreasing" : "↑ increasing"}</strong>
          {unit ? ` (${start}${unit} → ${target}${unit})` : ""}
        </div>
      )}

      <FG label="Target date (optional)" mb={20}>
        <input style={inp} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}/>
      </FG>

      <PBtn onClick={() => {
        if (!canSave) return;
        onSave({
          id: String(Date.now()),
          name: name.trim(),
          emoji: emoji || "🎯",
          unit: unit.trim(),
          startValue: start,
          targetValue: target,
          currentValue: start,
          direction,
          targetDate: targetDate || null,
          status: "active",
          logs: [],
          color: "#E67E22",
        });
        onClose();
      }}>Set goal</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── EDIT GOAL MODAL ───────────────────────────────────────────────────────────
export function EditGoalModal({ goal, onClose, onSave }) {
  const [name,       setName]       = useState(goal.name || "");
  const [emoji,      setEmoji]      = useState(goal.emoji || "");
  const [unit,       setUnit]       = useState(goal.unit || "");
  const [startVal,   setStartVal]   = useState(String(goal.startValue ?? ""));
  const [targetVal,  setTargetVal]  = useState(String(goal.targetValue ?? ""));
  const [currentVal, setCurrentVal] = useState(String(goal.currentValue ?? ""));
  const [targetDate, setTargetDate] = useState(goal.targetDate || "");
  const [color,      setColor]      = useState(goal.color || "#E67E22");

  const start = parseFloat(startVal);
  const target = parseFloat(targetVal);
  const current = parseFloat(currentVal);
  const hasCore = Number.isFinite(start) && Number.isFinite(target) && start !== target;
  const hasCurrent = Number.isFinite(current);
  const canSave = name.trim() && hasCore && hasCurrent;
  const direction = hasCore && target < start ? "decreasing" : "increasing";

  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:24, color:T.text, marginBottom:4 }}>Edit goal</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:22 }}>Update values and targeting for this goal.</div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Goal name</label>
          <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gain weight" maxLength={40} autoFocus/>
        </div>
        <div>
          <label style={lbl}>Emoji</label>
          <input style={{ ...inp, fontSize:22, textAlign:"center", width:60 }} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🎯" maxLength={2}/>
        </div>
      </div>

      <FG label="What are you tracking? (unit)">
        <input style={inp} value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. kg, $, km, hours" maxLength={20}/>
      </FG>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <div style={{ flex:1 }}>
          <label style={lbl}>Starting value</label>
          <input style={inp} type="number" step="any" value={startVal} onChange={e => setStartVal(e.target.value)} placeholder="74.5"/>
        </div>
        <div style={{ flex:1 }}>
          <label style={lbl}>Target value</label>
          <input style={inp} type="number" step="any" value={targetVal} onChange={e => setTargetVal(e.target.value)} placeholder="80"/>
        </div>
      </div>

      <FG label={`Current ${unit || "value"}`}>
        <input style={inp} type="number" step="any" value={currentVal} onChange={e => setCurrentVal(e.target.value)} placeholder={`e.g. ${goal.currentValue}`}/>
      </FG>

      {hasCore && (
        <div style={{ marginBottom:20, padding:"10px 14px", background:T.surface, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, fontSize:12, color:T.muted }}>
          Direction inferred: <strong style={{ color:T.text }}>{direction === "decreasing" ? "↓ decreasing" : "↑ increasing"}</strong>
          {unit ? ` (${start}${unit} → ${target}${unit})` : ""}
        </div>
      )}

      <FG label="Target date (optional)" mb={20}>
        <input style={inp} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}/>
      </FG>

      <div style={{ marginBottom:20 }}>
        <label style={lbl}>Color</label>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {COLORS.map(c => <div key={c} onClick={() => setColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer", outline:color===c?`2.5px solid ${c}`:"none", outlineOffset:2 }}/>)}
        </div>
      </div>

      <PBtn onClick={() => {
        if (!canSave) return;
        onSave(goal.id, {
          name: name.trim(),
          emoji: emoji || "🎯",
          unit: unit.trim(),
          startValue: start,
          targetValue: target,
          currentValue: current,
          direction,
          targetDate: targetDate || null,
          color,
          status: getGoalProgress({ ...goal, startValue: start, targetValue: target, currentValue: current, direction }).isComplete ? "completed" : "active",
        });
        onClose();
      }}>Save goal</PBtn>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── ADD ACTION SHEET ─────────────────────────────────────────────────────────
export function AddActionSheet({ onAddHabit, onAddGoal, onAddLog, onClose }) {
  useScrollLock(true);
  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.5)", zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"20px 16px 40px", touchAction:"auto" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }}/>
        <button type="button" onClick={onAddHabit} style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:10, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22 }}>⚒️</span>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>Add a habit</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Daily check-ins, weekly targets, build habits, or limit/reduce tracking</div>
          </div>
        </button>
        <button type="button" onClick={onAddGoal} style={{ display:"flex", alignItems:"center", gap:14, width:"100%", padding:"14px 16px", borderRadius:T.r, border:`0.5px solid ${T.borderStrong}`, background:T.surface, marginBottom:10, cursor:"pointer", textAlign:"left" }}>
          <span style={{ fontSize:22 }}>🎯</span>
          <div>
            <div style={{ fontSize:15, fontWeight:500, color:T.text }}>Set a goal</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Outcomes with numbers (weight, savings, PRs) — not the same as daily habits or limits</div>
          </div>
        </button>
        <button type="button" onClick={onClose} style={{ width:"100%", padding:"13px", borderRadius:T.rsm, border:"none", background:T.surface, color:T.muted, fontSize:14, cursor:"pointer", marginTop:4 }}>Cancel</button>
      </div>
    </div>
  );
}

/** Bottom sheet: edit AI coach name and preset icon. */
export function CoachSettingsSheet({ onClose, onSave, initialName, initialIcon }) {
  useScrollLock(true);
  const [nameDraft, setNameDraft] = useState((initialName ?? "").trim() || "Coach");
  const [iconDraft, setIconDraft] = useState(() => normalizeCoachIcon(initialIcon));
  useEffect(() => {
    setNameDraft((initialName ?? "").trim() || "Coach");
    setIconDraft(normalizeCoachIcon(initialIcon));
  }, [initialName, initialIcon]);
  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.52)", zIndex:302, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"20px 20px 0 0", padding:"22px 20px 36px", borderTop:`0.5px solid ${T.borderMid}`, boxSizing:"border-box", touchAction:"auto" }}
      >
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 18px" }}/>
        <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:14 }}>AI coach</div>
        <label style={{ ...lbl, marginBottom:6 }}>Coach name</label>
        <input
          style={{ ...inp, marginBottom:8 }}
          value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          placeholder="e.g. Atlas, Sam…"
          maxLength={PROFILE_COACH_NAME_MAX}
          autoFocus
        />
        <div style={{ fontSize:11, color:T.hint, marginBottom:18 }}>
          {nameDraft.trim().length}/{PROFILE_COACH_NAME_MAX} characters
        </div>
        <div style={{ fontSize:10, fontWeight:500, color:T.muted, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.07em" }}>Coach icon</div>
        <div style={{ fontSize:11, color:T.hint, marginBottom:8, lineHeight:1.35 }}>Scroll the grid — {COACH_ICON_OPTIONS.length} to choose from</div>
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:8, marginBottom:22,
          maxHeight: "min(32vh, 280px)",
          overflowY: "auto", WebkitOverflowScrolling: "touch", paddingRight: 4,
        }}
        >
          {COACH_ICON_OPTIONS.map(ic => (
            <button
              key={ic}
              type="button"
              onClick={() => setIconDraft(ic)}
              style={{
                aspectRatio:1, borderRadius:T.rsm,
                border:`0.5px solid ${iconDraft === ic ? T.gold : T.borderStrong}`,
                background: iconDraft === ic ? "rgba(200,144,42,0.14)" : T.surface,
                fontSize:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                lineHeight:1, padding:0,
              }}
            >
              {ic}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex:1, padding:13, borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:14, fontWeight:500, cursor:"pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave({ name: clampProfileCoachName(nameDraft.trim() || "Coach"), icon: iconDraft });
              onClose();
            }}
            style={{ flex:1, padding:13, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function CoachComingSoonSheet({ onClose, coachName, context }) {
  useScrollLock(true);
  const trimmed = (coachName ?? "").trim();
  const displayName = trimmed.length ? trimmed : "Your coach";
  const where =
    context === "journal" ? "Journal" :
    context === "insights" ? "Insights" :
    context === "today" ? "Today" : "Forged";
  const bullet = (icon, title, body) => (
    <div style={{ display:"flex", gap:12, alignItems:"flex-start", marginBottom:14 }}>
      <div style={{ width:36, height:36, borderRadius:10, background:"rgba(200,144,42,0.14)", border:`0.5px solid rgba(200,144,42,0.25)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:T.text, marginBottom:3 }}>{title}</div>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.55 }}>{body}</div>
      </div>
    </div>
  );
  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.55)", zIndex:301, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ width:430, maxWidth:"100vw", background:`linear-gradient(180deg, rgba(200,144,42,0.14) 0%, ${T.raised} 52px)`, borderRadius:"20px 20px 0 0", padding:"18px 20px 34px", borderTop:`0.5px solid rgba(200,144,42,0.35)`, boxSizing:"border-box", touchAction:"auto" }}
      >
        <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 16px" }}/>
        <div style={{ textAlign:"center", marginBottom:6 }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:"0.12em", textTransform:"uppercase", color:T.gold }}>Coming soon</span>
        </div>
        <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, textAlign:"center", marginBottom:8, letterSpacing:"-0.02em", lineHeight:1.2 }}>
          Meet <span style={{ color:T.gold }}>{displayName}</span> — your voice and text forge partner
        </div>
        <p style={{ fontSize:14, color:T.sub, lineHeight:1.55, textAlign:"center", margin:"0 4px 18px" }}>
          {"This is the big unlock: a coach that actually knows your habits, goals, and logs. We're building it so Forged feels effortless — starting from "}{where}{"."}
        </p>
        <div style={{ margin:"0 0 20px", padding:"14px 14px 4px", borderRadius:T.r, border:`0.5px solid ${T.border}`, background:"rgba(0,0,0,0.12)" }}>
          {bullet("🎯", "Goals without the friction", "Brainstorm targets, break them into steps, and keep them honest — conversationally.")}
          {bullet("🎙️", "Talk or type", "Voice when you’re on the move, text when you’re focused. Same coach, same context.")}
          {bullet("⚡", "Log & fill the day faster", "Quick check-ins so updating habits doesn’t feel like another chore.")}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ width:"100%", padding:14, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer", boxShadow:"0 4px 18px rgba(192,57,43,0.35)" }}
        >
          {"Got it — I'm ready"}
        </button>
      </div>
    </div>
  );
}

// ─── SOCIAL / FORGE PRO TEASER (replaces former Habits tab) ───────────────────
function SocialTeaserCard({ emoji, title, children }) {
  return (
    <div className="rc" style={{ margin:"0 14px 10px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden", padding:"16px 16px 15px" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
        <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:"rgba(200,144,42,0.12)", border:`0.5px solid rgba(200,144,42,0.22)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{emoji}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:600, color:T.text, letterSpacing:"-0.01em", marginBottom:6 }}>{title}</div>
          <div style={{ fontSize:13, color:T.sub, lineHeight:1.55 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SocialScreen({ user, xp, habits, friends, friendRequests, sentRequests, friendsLoading, onSendRequest, onAccept, onDecline, onRemoveFriend, onCancelSentRequest, sharedGoals, sharedGoalsLoading, sharedGoalInvites, onAcceptGoalInvite, onDeclineGoalInvite, currentUserId, onDeleteSharedGoal, onNudgeFriend, onShareHabit, sharingHabitId, onToast, pendingInviteGoalId, onClearPendingInvite, betaLeaderboard = [], leaderboardLoading = false, myBetaRank = null, betaTotalCount = null, betaTicker = [], isPro = false, onUpgrade }) {
  const [showAddFriend,      setShowAddFriend]      = useState(false);
  const [addEmail,           setAddEmail]           = useState("");
  const [addError,           setAddError]           = useState("");
  const [addLoading,         setAddLoading]         = useState(false);
  const [addDone,            setAddDone]            = useState(false);
  // --- Nudge counts persistence (per friend, per sender-local calendar day) ---
  // Stored in localStorage so UI matches daily limits across reloads. Purge stale day keys on mount.
  const NUDGED_KEY_PREFIX = "forged_nudged_today_";
  function nudgedStorageKey(dayStr) { return `${NUDGED_KEY_PREFIX}${dayStr}`; }
  /** @returns {Record<string, number>} friendId -> nudges sent today (capped) */
  function loadNudgeCountsToday() {
    try {
      const t = todayStr();
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NUDGED_KEY_PREFIX) && k !== nudgedStorageKey(t)) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
      const raw = localStorage.getItem(nudgedStorageKey(t));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out = {};
        for (const [id, v] of Object.entries(parsed)) {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) out[id] = Math.min(NUDGE_DAILY_LIMIT, n);
        }
        return out;
      }
      // Legacy: array of friend ids (treated as one nudge each)
      if (Array.isArray(parsed)) {
        const out = {};
        for (const id of parsed) {
          if (typeof id === "string") out[id] = Math.min(NUDGE_DAILY_LIMIT, (out[id] || 0) + 1);
        }
        return out;
      }
      return {};
    } catch {
      return {};
    }
  }
  function persistNudgeCountsToday(map) {
    try {
      localStorage.setItem(nudgedStorageKey(todayStr()), JSON.stringify(map));
    } catch {}
  }
  function nudgeCountForFriend(map, userId) {
    const n = Number(map[userId]);
    return Number.isFinite(n) && n > 0 ? Math.min(NUDGE_DAILY_LIMIT, n) : 0;
  }

  // Per-goal all-time best group streak. Reads from localStorage and bumps the
  // stored value if the current streak beats it, so a new record implicitly
  // shows up as a higher "best Nd" badge next to the live streak pill.
  function updateGroupStreakBest(goalId, current) {
    if (!goalId) return Math.max(0, current | 0);
    const key = `forged_group_streak_best_${goalId}`;
    try {
      const raw = localStorage.getItem(key);
      let best = raw ? parseInt(raw, 10) : 0;
      if (!Number.isFinite(best) || best < 0) best = 0;
      if ((current | 0) > best) {
        localStorage.setItem(key, String(current | 0));
        return current | 0;
      }
      return best;
    } catch {
      return Math.max(0, current | 0);
    }
  }

  const [inviteGoalId,       setInviteGoalId]       = useState(null);
  const [invitedFriends,     setInvitedFriends]     = useState(() => new Set());
  const [sharedGoalDeleteId, setSharedGoalDeleteId] = useState(null);
  const [deleteSharedLoading,setDeleteSharedLoading]= useState(false);
  const [selectedFriend,     setSelectedFriend]     = useState(null);
  // Compact Friends sheet — replaces the inline friends list in the body.
  // Holds: incoming requests, outgoing/pending requests, current friends, and
  // the Add friend form. Keeps the main Social page focused on leaderboard
  // and accountability while preserving every friend flow.
  const [showFriendsSheet,   setShowFriendsSheet]   = useState(false);
  const [nudgeCountsToday, setNudgeCountsToday] = useState(loadNudgeCountsToday);
  function bumpNudgeCount(userId) {
    setNudgeCountsToday(prev => {
      const next = { ...prev, [userId]: Math.min(NUDGE_DAILY_LIMIT, (prev[userId] || 0) + 1) };
      persistNudgeCountsToday(next);
      return next;
    });
  }
  /** When the server returns 429, align local counts so the UI stays in sync. */
  function setNudgeCountToLimit(userId) {
    setNudgeCountsToday(prev => {
      const next = { ...prev, [userId]: NUDGE_DAILY_LIMIT };
      persistNudgeCountsToday(next);
      return next;
    });
  }
  // Nudge message sheet
  const [nudgeTarget,        setNudgeTarget]        = useState(null); // { userId, name }
  const [nudgeMessage,       setNudgeMessage]       = useState("");
  const [nudgeSending,       setNudgeSending]       = useState(false);
  // Share-a-habit picker (when user already has shared goals and wants to start another)
  const [showSharePicker,    setShowSharePicker]    = useState(false);

  useScrollLock(showSharePicker || Boolean(inviteGoalId) || Boolean(nudgeTarget) || showFriendsSheet || Boolean(selectedFriend));

  // Auto-open invite picker when navigating here after sharing a habit
  useEffect(() => {
    if (pendingInviteGoalId) {
      setInviteGoalId(pendingInviteGoalId);
      setInvitedFriends(new Set());
      onClearPendingInvite?.();
    }
  }, [pendingInviteGoalId]);

  const today = todayStr();
  // Most-recent log date per friend, derived from shared-goal member logs we
  // already have in memory. Used to show "last active: Xd ago" in the compact
  // friends list so inactive accounts are visually distinct from active lurkers.
  const friendLastLogDate = (() => {
    const map = new Map();
    for (const g of sharedGoals || []) {
      for (const m of g.members || []) {
        if (!m.userId || m.isMe) continue;
        const logs = m.logs || [];
        for (const l of logs) {
          const d = typeof l?.date === "string" ? l.date : "";
          if (!d) continue;
          const prev = map.get(m.userId);
          if (!prev || d > prev) map.set(m.userId, d);
        }
      }
    }
    return map;
  })();
  function friendLastActiveLabel(friendId) {
    const d = friendLastLogDate.get(friendId);
    if (!d) return null;
    if (d === today) return "today";
    const t = parseLocal(today);
    const then = parseLocal(d);
    if (!t || !then) return null;
    const days = Math.max(0, Math.floor((t.getTime() - then.getTime()) / (24 * 60 * 60 * 1000)));
    if (days <= 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }
  const myStreak = habits.length ? Math.max(0, ...habits.map(h => h.streak || 0)) : 0;
  const myLoggedToday = habits.filter(h => (h.logs||[]).some(l => l.date === today)).length;

  const card = { background: T.raised, border: `0.5px solid ${T.border}`, borderRadius: T.r, padding: "14px 16px", marginBottom: 10 };
  const sectionLabel = { fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 };

  async function handleSendRequest() {
    if (!addEmail.trim()) return;
    setAddLoading(true); setAddError("");
    const res = await onSendRequest(addEmail.trim());
    setAddLoading(false);
    if (res?.error) { setAddError(res.error); }
    else { setAddDone(true); setAddEmail(""); }
  }

  function Avatar({ name, avatarUrl, size = 32 }) {
    if (avatarUrl && !avatarUrl.startsWith("http")) {
      return <div style={{ width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, background: T.surface, flexShrink: 0 }}>{avatarUrl}</div>;
    }
    if (avatarUrl) {
      return <img src={avatarUrl} alt={name} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
    }
    const initials = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    return <div style={{ width: size, height: size, borderRadius: "50%", background: "rgba(200,144,42,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, color: T.gold, flexShrink: 0 }}>{initials}</div>;
  }

  // XP → level (1 per 100 xp, purely cosmetic)
  const myLevel = Math.max(1, Math.floor((xp || 0) / 100) + 1);
  const xpIntoLevel = (xp || 0) % 100;

  // Rank medal for the beta board
  function medal(rank) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return null;
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* ── Hero: Your card ─────────────────────────────────────────────── */}
      <div style={{
        position: "relative",
        margin: "0 0 22px",
        padding: "18px 18px 16px",
        background: `linear-gradient(140deg, rgba(200,144,42,0.18) 0%, rgba(200,144,42,0.06) 55%, ${T.surface} 100%)`,
        border: `0.5px solid rgba(200,144,42,0.35)`,
        borderRadius: T.r,
        boxShadow: "0 2px 24px rgba(200,144,42,0.06)",
        overflow: "hidden",
      }}>
        {/* Top row: avatar + name + pro/rank pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Avatar name={user?.name} avatarUrl={user?.avatarUrl} size={46} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{user?.name || "You"}</div>
              {isPro && (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: T.gold, background: "rgba(200,144,42,0.16)", border: "0.5px solid rgba(200,144,42,0.4)", padding: "2px 7px", borderRadius: 8 }}>PRO</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
              Level {myLevel}
              {myBetaRank != null && (
                <> · <span style={{ color: T.gold, fontWeight: 600 }}>#{myBetaRank} in beta</span></>
              )}
            </div>
          </div>
        </div>

        {/* XP progress bar within level */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginBottom: 4, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
            <span>Level {myLevel}</span>
            <span>{xpIntoLevel}/100 xp</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.05)", overflow: "hidden", border: `0.5px solid ${T.border}` }}>
            <div style={{ height: "100%", width: `${xpIntoLevel}%`, background: `linear-gradient(90deg, ${T.gold}, #e0a94f)`, borderRadius: 3, transition: "width 0.5s ease" }} />
          </div>
          {(() => {
            // Social-proof pill: only show once the user is meaningfully ranked.
            if (myBetaRank == null || myBetaRank < 3) return null;
            if (betaLeaderboard.length < 5) return null;
            let label = null;
            if (betaTotalCount && betaTotalCount >= 5) {
              const pct = Math.max(1, Math.min(99, Math.round((myBetaRank / betaTotalCount) * 100)));
              const ahead = Math.max(0, betaTotalCount - myBetaRank);
              label = pct <= 25
                ? `Top ${pct}% of beta testers`
                : ahead >= 1
                  ? `Ahead of ${ahead} tester${ahead === 1 ? "" : "s"}`
                  : null;
            } else if (myBetaRank <= betaLeaderboard.length) {
              // No accurate total yet but user is in top 10 → percentile against the board.
              const pct = Math.max(1, Math.round((myBetaRank / betaLeaderboard.length) * 100));
              label = `Top ${pct}% of the board`;
            }
            if (!label) return null;
            return (
              <div style={{
                marginTop: 8,
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(200,144,42,0.14)",
                border: "0.5px solid rgba(200,144,42,0.35)",
                fontSize: 11, fontWeight: 600, color: T.gold,
                letterSpacing: "0.02em",
              }}>
                <span aria-hidden style={{ fontSize: 10 }}>▲</span>
                <span>{label}</span>
              </div>
            );
          })()}
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 0, borderTop: `0.5px solid ${T.border}`, paddingTop: 12 }}>
          <div style={{ flex: 1, textAlign: "center", borderRight: `0.5px solid ${T.border}` }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: myStreak > 0 ? T.text : T.muted, lineHeight: 1.1 }}>{myStreak}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>🔥 Streak</div>
          </div>
          <div style={{ flex: 1, textAlign: "center", borderRight: `0.5px solid ${T.border}` }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>{xp}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>⚡ XP</div>
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: myLoggedToday > 0 ? T.green : T.muted, lineHeight: 1.1 }}>{myLoggedToday}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>Today</div>
          </div>
        </div>
      </div>

      {/* ── Compact Friends control ────────────────────────────────────────
          The full friends list, incoming requests, outgoing requests, and
          Add-friend form all live inside the FriendsSheet modal below. This
          button is the only friends affordance on the main page so the
          leaderboard + accountability stay front-and-center. */}
      <button
        type="button"
        onClick={() => setShowFriendsSheet(true)}
        style={{
          width: "100%",
          marginBottom: 18,
          padding: "12px 14px",
          background: T.raised,
          border: `0.5px solid ${T.border}`,
          borderRadius: T.r,
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: T.font,
          color: T.text,
          position: "relative",
        }}
      >
        {/* Avatar stack — up to 3 friend avatars */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, minWidth: 38 }}>
          {friends.length > 0 ? (
            friends.slice(0, 3).map((f, i) => (
              <div key={f.id} style={{
                marginLeft: i === 0 ? 0 : -10,
                border: `2px solid ${T.raised}`,
                borderRadius: "50%",
                lineHeight: 0,
              }}>
                <Avatar name={f.name} avatarUrl={f.avatarUrl} size={26} />
              </div>
            ))
          ) : (
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "rgba(200,144,42,0.12)",
              border: "0.5px solid rgba(200,144,42,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16,
            }}>👥</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Friends</span>
            <span style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>
              {friends.length === 0
                ? "Add someone →"
                : `${friends.length} connected`}
            </span>
            {friendRequests.length > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 999,
                background: T.accent, color: "#fff",
                fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
              }}>
                {friendRequests.length} new request{friendRequests.length === 1 ? "" : "s"}
              </span>
            )}
            {friendRequests.length === 0 && sentRequests.length > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 999,
                background: "rgba(200,144,42,0.16)",
                color: T.gold,
                fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                border: "0.5px solid rgba(200,144,42,0.3)",
              }}>
                {sentRequests.length} pending
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: T.hint, marginTop: 2 }}>
            Add a friend to start a shared goal or send nudges
          </div>
        </div>
        <div style={{ color: T.muted, fontSize: 16, flexShrink: 0 }}>›</div>
      </button>

      {/* ── Forged Beta Leaderboard (global top 10 by XP) ────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ ...sectionLabel, marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <span>🏆 Forged Beta</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.hint, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Top 10 · Lifetime XP
            <span style={{ display:"block", fontSize:10, fontWeight:500, color:T.hint, marginTop:2, letterSpacing:0 }}>Activity metric — not Arc rank</span>
          </div>
        </div>

        {leaderboardLoading ? (
          <div style={{ ...card, textAlign: "center", padding: "18px 0", color: T.muted, fontSize: 13 }}>Loading leaderboard…</div>
        ) : betaLeaderboard.length === 0 ? (
          <div style={{ ...card, textAlign: "center", padding: "24px 16px", color: T.muted, fontSize: 13, lineHeight: 1.6 }}>
            Be the first on the board.<br />
            Log a habit to start earning XP.
          </div>
        ) : (
          <div style={{ borderRadius: T.r, overflow: "hidden", border: `0.5px solid ${T.border}`, background: T.raised }}>
            {betaLeaderboard.map((row, i) => {
              const m = medal(row.rank);
              const highlight = row.isMe;
              return (
                <div key={row.id} style={{
                  display: "flex", alignItems: "center", gap: 11,
                  padding: "11px 14px",
                  borderBottom: i === betaLeaderboard.length - 1 ? "none" : `0.5px solid ${T.border}`,
                  background: highlight
                    ? "linear-gradient(90deg, rgba(200,144,42,0.14), rgba(200,144,42,0.04))"
                    : (row.rank <= 3 ? "rgba(200,144,42,0.035)" : "transparent"),
                }}>
                  {/* Rank / medal */}
                  <div style={{
                    width: 26, textAlign: "center", flexShrink: 0,
                    fontSize: m ? 18 : 13,
                    fontWeight: 700,
                    color: row.rank === 1 ? T.gold : row.rank <= 3 ? T.sub : T.muted,
                    lineHeight: 1,
                  }}>
                    {m || `#${row.rank}`}
                  </div>
                  <Avatar name={row.name} avatarUrl={row.avatarUrl} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: highlight ? 700 : 600,
                        color: highlight ? T.gold : T.text,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {highlight ? "You" : row.name}
                      </div>
                      {row.isPro && !highlight && (
                        <span style={{ fontSize: 8, fontWeight: 700, color: T.gold, background: "rgba(200,144,42,0.15)", padding: "1px 5px", borderRadius: 5, letterSpacing: "0.04em", flexShrink: 0 }}>PRO</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>
                      {row.streak > 0 ? `🔥 ${row.streak}` : "—"}
                      {row.loggedToday && <> · <span style={{ color: T.green }}>✓ active today</span></>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: highlight ? T.gold : T.text, lineHeight: 1.1 }}>
                      {row.xp.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 9, color: T.hint, marginTop: 2, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>xp</div>
                  </div>
                </div>
              );
            })}
            {/* "You're #N" footer if user isn't in the top 10 */}
            {myBetaRank != null && !betaLeaderboard.some(r => r.isMe) && (
              <div style={{
                padding: "10px 14px",
                background: "rgba(200,144,42,0.07)",
                borderTop: `0.5px solid ${T.border}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div style={{ fontSize: 12, color: T.sub }}>
                  You're <strong style={{ color: T.gold }}>#{myBetaRank}</strong> overall
                </div>
                <div style={{ fontSize: 11, color: T.muted }}>Keep forging ⚡</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Live-ish beta activity ticker ────────────────────────────────── */}
      {Array.isArray(betaTicker) && betaTicker.length > 0 && (() => {
        const items = betaTicker.slice(0, 3).map(r => {
          const isMeLikely = currentUserId && r.userId === currentUserId;
          const who = isMeLikely ? "You" : (r.firstName || "Someone");
          const name = r.habitName || "a habit";
          const emoji = r.emoji || "";
          if (r.streak && r.streak >= 5) {
            return `${emoji ? emoji + " " : ""}${who} on a ${r.streak}-day streak`;
          }
          const verb = r.habitType === "limit"
            ? "kept to a limit on"
            : r.habitType === "project"
              ? "made progress on"
              : "just logged";
          return `${emoji ? emoji + " " : ""}${who} ${verb} ${name}`;
        });
        if (items.length === 0) return null;
        const marqueeText = items.join("   •   ");
        return (
          <div style={{
            marginBottom: 18,
            padding: "8px 0",
            background: "rgba(200,144,42,0.04)",
            border: `0.5px solid ${T.border}`,
            borderRadius: T.rsm,
            overflow: "hidden",
            position: "relative",
          }}>
            <div aria-hidden style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 18,
              background: `linear-gradient(90deg, ${T.bg || "rgba(20,20,20,1)"} 0%, rgba(0,0,0,0) 100%)`,
              pointerEvents: "none", zIndex: 2,
            }} />
            <div aria-hidden style={{
              position: "absolute", right: 0, top: 0, bottom: 0, width: 18,
              background: `linear-gradient(270deg, ${T.bg || "rgba(20,20,20,1)"} 0%, rgba(0,0,0,0) 100%)`,
              pointerEvents: "none", zIndex: 2,
            }} />
            <div style={{
              display: "inline-block",
              whiteSpace: "nowrap",
              animation: "forgedTicker 38s linear infinite",
              fontSize: 12, color: T.sub, letterSpacing: "0.01em",
              paddingLeft: "100%",
            }}>
              {marqueeText}   •   {marqueeText}
            </div>
            <style>{`
              @keyframes forgedTicker {
                0%   { transform: translateX(0); }
                100% { transform: translateX(-50%); }
              }
              @media (prefers-reduced-motion: reduce) {
                div[data-forged-ticker] { animation: none !important; }
              }
            `}</style>
          </div>
        );
      })()}

      {/* Friends list / requests / Add friend now live in the FriendsSheet
          modal at the bottom of this component, opened by the compact
          Friends button above. Keeps the page focused on leaderboard +
          accountability. */}

      {/* ── Accountability / Shared goals ── */}
      <div style={{ marginBottom: 24 }}>
        {(() => {
          const shareableHabits = (habits || []).filter(h => h.habitType !== "log" && !h.sharedGoalId);
          return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ ...sectionLabel, marginBottom: 0 }}>Accountability</div>
              {sharedGoals.length > 0 && shareableHabits.length > 0 && onShareHabit && (
                <button type="button"
                  onClick={() => setShowSharePicker(true)}
                  disabled={!!sharingHabitId}
                  style={{ padding: "5px 12px", borderRadius: 16, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.gold, fontSize: 12, fontWeight: 600, cursor: sharingHabitId ? "default" : "pointer", opacity: sharingHabitId ? 0.6 : 1 }}>
                  {sharingHabitId ? "…" : "+ New goal"}
                </button>
              )}
            </div>
          );
        })()}

        {/* Pending goal invites */}
        {sharedGoalInvites.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {sharedGoalInvites.map(inv => (
              <div key={inv.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12, background: "rgba(200,144,42,0.06)", border: `0.5px solid rgba(200,144,42,0.28)` }}>
                <div style={{ fontSize: 28, lineHeight: 1 }}>{inv.goal_emoji || "🎯"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{inv.goal_name}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                    <strong style={{ color: T.gold }}>{inv.inviter_name}</strong> invited you to join
                  </div>
                </div>
                <button type="button" onClick={() => onAcceptGoalInvite(inv)}
                  style={{ padding: "7px 16px", borderRadius: 16, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", marginRight: 6, flexShrink: 0 }}>
                  Join
                </button>
                <button type="button" onClick={() => onDeclineGoalInvite(inv.id)}
                  style={{ padding: "7px 10px", borderRadius: 16, border: `0.5px solid ${T.border}`, background: "none", color: T.muted, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Shared goal cards */}
        {sharedGoalsLoading ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: T.muted, fontSize: 13 }}>Loading…</div>
        ) : sharedGoals.length === 0 ? (
          (() => {
            const shareableHabits = (habits || []).filter(h => h.habitType !== "log" && !h.sharedGoalId);
            const hasFriends = (friends || []).length > 0;
            return (
              <div style={{
                borderRadius: T.r,
                overflow: "hidden",
                border: `0.5px solid rgba(200,144,42,0.32)`,
                background: `linear-gradient(155deg, rgba(200,144,42,0.09) 0%, rgba(200,144,42,0.02) 50%, ${T.raised} 100%)`,
              }}>
                {/* Value prop header */}
                <div style={{ padding: "18px 18px 14px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 28, lineHeight: 1 }}>🤝</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Stay accountable with a friend</div>
                      <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>
                        Share a habit — you'll each see when the other logs. People who build habits with a partner are <strong style={{ color: T.gold }}>2–3× more likely</strong> to stick with them.
                      </div>
                    </div>
                  </div>

                  {/* Tiny proof row */}
                  <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: T.muted, background: T.surface, border: `0.5px solid ${T.border}`, padding: "4px 9px", borderRadius: 10 }}>✓ See who logged today</span>
                    <span style={{ fontSize: 11, color: T.muted, background: T.surface, border: `0.5px solid ${T.border}`, padding: "4px 9px", borderRadius: 10 }}>💪 Nudge them if they skip</span>
                  </div>
                </div>

                {/* Action area */}
                {shareableHabits.length > 0 && onShareHabit ? (
                  <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "14px 18px 16px", background: T.raised }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
                      Pick a habit to share
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {shareableHabits.slice(0, 4).map(h => {
                        const busy = sharingHabitId === h.id;
                        return (
                          <button key={h.id} type="button"
                            onClick={() => onShareHabit(h.id)}
                            disabled={!!sharingHabitId}
                            style={{
                              display: "flex", alignItems: "center", gap: 11,
                              padding: "10px 12px", borderRadius: T.rsm,
                              border: `0.5px solid ${T.borderStrong}`,
                              background: T.surface, color: T.text,
                              cursor: sharingHabitId ? "default" : "pointer",
                              textAlign: "left",
                              opacity: (sharingHabitId && !busy) ? 0.5 : 1,
                            }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{h.emoji}</span>
                            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</span>
                            <span style={{ fontSize: 11, color: T.gold, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>
                              {busy ? "…" : "Share →"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {!hasFriends && (
                      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 11, lineHeight: 1.55 }}>
                        No friends yet? Go ahead and create the goal — you can invite them the moment they accept your friend request.
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "14px 18px 16px", background: T.raised, fontSize: 12.5, color: T.sub, lineHeight: 1.55 }}>
                    Add a habit on the <strong style={{ color: T.text }}>Today</strong> screen first — then come back here to share it with a friend.
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          sharedGoals.map(g => {
            const isCreator = currentUserId && g.creatorId === currentUserId;
            const totalMembers = g.members.length;
            const wt = g.weeklyTarget || 3;
            const isWeekly = g.habitType === "weekly";

            // Kind-aware "did this member log today?" — accepts daily true,
            // numeric goal value, or non-zero limit value.
            function memberLoggedOn(logs, dateStr) {
              return (logs || []).some(l => {
                if (l.date !== dateStr) return false;
                if (g.habitType === "goal") {
                  const n = typeof l.value === "number" ? l.value : Number(l.value);
                  return Number.isFinite(n) || l.value === true;
                }
                if (g.habitType === "limit") return l.value === true || (typeof l.value === "number" && l.value !== 0);
                return true;
              });
            }
            // Distinct days a member has any qualifying log inside [from, to].
            function memberActivityCount(logs, fromStr, toStr) {
              const seen = new Set();
              for (const l of logs || []) {
                if (!l?.date) continue;
                if (l.date < fromStr || l.date > toStr) continue;
                if (g.habitType === "goal") {
                  const n = typeof l.value === "number" ? l.value : Number(l.value);
                  if (!(Number.isFinite(n) || l.value === true)) continue;
                } else if (g.habitType === "limit") {
                  if (!(l.value === true || (typeof l.value === "number" && l.value !== 0))) continue;
                }
                seen.add(l.date);
              }
              return seen.size;
            }

            const membersLoggedToday = g.members.filter(m => memberLoggedOn(m.logs, today)).length;
            const membersHitWeekTarget = isWeekly
              ? g.members.filter(m => sharedMemberWeekSessionCount(m.logs) >= wt).length
              : 0;
            const progress = isWeekly
              ? (totalMembers > 0 ? membersHitWeekTarget / totalMembers : 0)
              : (totalMembers > 0 ? membersLoggedToday / totalMembers : 0);

            // Last 7 vs prior 7 — total team activity-days. Honest signal for
            // "is this group cooling off or heating up?".
            const last7From  = daysAgo(6);
            const prior7From = daysAgo(13);
            const prior7To   = daysAgo(7);
            const last7Total  = g.members.reduce((s, m) => s + memberActivityCount(m.logs, last7From, today), 0);
            const prior7Total = g.members.reduce((s, m) => s + memberActivityCount(m.logs, prior7From, prior7To), 0);
            const weekDelta = last7Total - prior7Total;

            // Live group streak: consecutive trailing days where every member logged.
            // Today is counted only once everyone has already logged; otherwise we
            // skip it so yesterday's streak still stands in the morning.
            const groupStreak = (() => {
              if (totalMembers === 0) return 0;
              const memberDateSets = g.members.map(m => new Set((m.logs || []).map(l => l.date).filter(Boolean)));
              const oneDay = 24 * 60 * 60 * 1000;
              const todayDate = parseLocal(today);
              let count = 0;
              for (let i = 0; i < 365; i++) {
                const d = new Date(todayDate.getTime() - i * oneDay);
                const y = d.getFullYear();
                const mo = String(d.getMonth() + 1).padStart(2, "0");
                const dd = String(d.getDate()).padStart(2, "0");
                const ds = `${y}-${mo}-${dd}`;
                const allLogged = memberDateSets.every(s => s.has(ds));
                if (allLogged) count++;
                else if (i === 0) continue;
                else break;
              }
              return count;
            })();
            const groupStreakBest = updateGroupStreakBest(g.id, groupStreak);
            const isNewRecord = groupStreak > 0 && groupStreak === groupStreakBest && groupStreak >= 3;

            // Sort members by who's "ahead": weekly sessions (weekly), or
            // last-14-day activity (everything else). "You" stays in natural
            // sorted position so leadership reads truthfully.
            const sortKey = m => {
              if (isWeekly) return sharedMemberWeekSessionCount(m.logs);
              return memberActivityCount(m.logs, daysAgo(13), today);
            };
            const sortedMembers = [...g.members].sort((a, b) => {
              const sb = sortKey(b) - sortKey(a);
              if (sb !== 0) return sb;
              // Tiebreak: people who logged today first
              const al = memberLoggedOn(a.logs, today) ? 1 : 0;
              const bl = memberLoggedOn(b.logs, today) ? 1 : 0;
              return bl - al;
            });
            // Only crown a leader when there's a real gap (not a tie at zero).
            const leaderM = sortedMembers[0];
            const leaderScore = leaderM ? sortKey(leaderM) : 0;
            const runnerScore = sortedMembers[1] ? sortKey(sortedMembers[1]) : 0;
            const leaderId = (leaderScore > 0 && (totalMembers === 1 || leaderScore > runnerScore)) ? leaderM?.userId : null;

            // Pulse line — single dynamic momentum message at the top of the
            // card. Cascade picks the most relevant scenario; falls back to
            // null (no banner) so we never show filler.
            const me = g.members.find(m => m.isMe);
            const others = g.members.filter(m => !m.isMe);
            const meLogged = me ? memberLoggedOn(me.logs, today) : false;
            const othersLoggedToday = others.filter(m => memberLoggedOn(m.logs, today));
            const allLoggedToday = totalMembers > 0 && g.members.every(m => memberLoggedOn(m.logs, today));
            const meWeekSessions = me ? sharedMemberWeekSessionCount(me.logs) : 0;
            const meWeekDone = isWeekly && meWeekSessions >= wt;
            const allWeekDone = isWeekly && totalMembers > 0 && g.members.every(m => sharedMemberWeekSessionCount(m.logs) >= wt);

            const pulse = (() => {
              if (totalMembers <= 1) return null; // solo card — pulse is awkward
              if (isNewRecord) {
                return { icon: "🎉", text: `New record — ${groupStreak}-day group streak!`, tone: "good" };
              }
              if (isWeekly && allWeekDone) {
                return { icon: "🏆", text: `Whole crew hit ${wt} sessions this week.`, tone: "good" };
              }
              if (!isWeekly && allLoggedToday) {
                return { icon: "🎯", text: "Everyone's logged today — keep it alive tomorrow.", tone: "good" };
              }
              if (isWeekly && me) {
                if (meWeekDone) {
                  const behind = others.filter(m => sharedMemberWeekSessionCount(m.logs) < wt);
                  if (behind.length === 1) {
                    const need = wt - sharedMemberWeekSessionCount(behind[0].logs);
                    return { icon: "⚡", text: `Your week's done — ${behind[0].name || "they"} need ${need} more.`, tone: "ahead" };
                  }
                  if (behind.length > 1) {
                    return { icon: "⚡", text: `Your week's done — pull the team across.`, tone: "ahead" };
                  }
                } else if (meWeekSessions === wt - 1) {
                  return { icon: "🏁", text: `1 more session and your week's done.`, tone: "push" };
                } else if (meWeekSessions === 0) {
                  const ahead = others.find(m => sharedMemberWeekSessionCount(m.logs) > 0);
                  if (ahead) return { icon: "💪", text: `${ahead.name || "Friend"}'s already in this week — your move.`, tone: "behind" };
                }
              }
              if (!isWeekly && me) {
                if (meLogged && othersLoggedToday.length === 0 && others.length > 0) {
                  const single = others.length === 1 ? (others[0].name || "Friend") : null;
                  return { icon: "⚡", text: single ? `You're ahead today — ${single} hasn't logged.` : `You're ahead today — others haven't logged yet.`, tone: "ahead" };
                }
                if (!meLogged && othersLoggedToday.length > 0) {
                  const first = othersLoggedToday[0].name || "Friend";
                  return { icon: "💪", text: `${first}'s already logged — your move.`, tone: "behind" };
                }
              }
              if (groupStreak >= 3) {
                return { icon: "🔥", text: `${groupStreak} days strong as a team.`, tone: "good" };
              }
              if (!isWeekly && totalMembers > 0 && membersLoggedToday === 0) {
                return { icon: "⏳", text: "Nobody's logged today — be the one who starts it.", tone: "quiet" };
              }
              return null;
            })();
            const pulseColors = pulse ? ({
              good:   { bg: "rgba(78, 168, 110, 0.10)", border: "rgba(78, 168, 110, 0.30)", text: T.green },
              ahead:  { bg: "rgba(200,144,42,0.10)",    border: "rgba(200,144,42,0.30)",   text: T.gold  },
              behind: { bg: "rgba(200,144,42,0.10)",    border: "rgba(200,144,42,0.30)",   text: T.gold  },
              push:   { bg: "rgba(200,144,42,0.10)",    border: "rgba(200,144,42,0.30)",   text: T.gold  },
              quiet:  { bg: T.surface,                  border: T.border,                  text: T.sub   },
            }[pulse.tone]) : null;

            const habitTypeLabel = isWeekly
              ? `Weekly ×${wt}`
              : g.habitType === "project" ? "Build"
                : g.habitType === "goal" ? "Progress goal"
                  : g.habitType === "limit" ? "Limit"
                    : "Daily";
            const progressTitle = isWeekly ? "This week" : "Today's progress";
            const progressSummary = isWeekly
              ? `${membersHitWeekTarget} / ${totalMembers} hit target`
              : `${membersLoggedToday} / ${totalMembers} logged`;
            const accentColor = g.color || T.accent;
            return (
              <div key={g.id} style={{ marginBottom: 14, borderRadius: T.r, overflow: "hidden", border: `0.5px solid ${T.border}`, background: T.raised, boxShadow: "0 1px 10px rgba(0,0,0,0.14)" }}>
                {/* Color accent bar */}
                <div style={{ height: 3, background: accentColor }} />

                {/* Header */}
                <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ fontSize: 28, lineHeight: 1.1 }}>{g.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>{g.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em", background: T.surface, borderRadius: 6, padding: "2px 7px", border: `0.5px solid ${T.border}` }}>{habitTypeLabel}</span>
                      <span style={{ fontSize: 11, color: T.muted }}>{totalMembers} member{totalMembers !== 1 ? "s" : ""}</span>
                      {groupStreak > 0 && (
                        <span title="Consecutive days where everyone logged"
                          style={{ fontSize: 10, fontWeight: 800, color: isNewRecord ? T.green : T.gold,
                            background: isNewRecord ? "rgba(78,168,110,0.14)" : "rgba(200,144,42,0.14)",
                            border: `0.5px solid ${isNewRecord ? "rgba(78,168,110,0.4)" : "rgba(200,144,42,0.35)"}`,
                            borderRadius: 6, padding: "2px 7px", letterSpacing: "0.02em" }}>
                          🔥 {groupStreak}d together
                        </span>
                      )}
                      {groupStreakBest > 0 && groupStreakBest !== groupStreak && (
                        <span title="Best group streak ever achieved"
                          style={{ fontSize: 10, fontWeight: 600, color: T.hint, letterSpacing: "0.02em" }}>
                          best {groupStreakBest}d
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => { setInviteGoalId(g.id); setInvitedFriends(new Set()); }}
                    style={{ flexShrink: 0, padding: "5px 12px", borderRadius: 12, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.sub, fontSize: 11, cursor: "pointer", fontWeight: 600, marginTop: 2 }}>
                    + Invite
                  </button>
                </div>

                {/* Pulse line — momentum / leadership / nudge prompt */}
                {pulse && pulseColors && (
                  <div style={{
                    margin: "0 16px 12px",
                    padding: "9px 12px",
                    background: pulseColors.bg,
                    border: `0.5px solid ${pulseColors.border}`,
                    borderRadius: T.rsm,
                    display: "flex", alignItems: "center", gap: 9,
                  }}>
                    <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{pulse.icon}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: pulseColors.text, lineHeight: 1.4 }}>
                      {pulse.text}
                    </span>
                  </div>
                )}

                {/* Progress bar */}
                <div style={{ padding: "0 16px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                    <span style={{ fontSize: 11, color: T.muted, fontWeight: 500 }}>{progressTitle}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: (isWeekly ? membersHitWeekTarget : membersLoggedToday) > 0 ? T.green : T.hint, display: "flex", alignItems: "center", gap: 8 }}>
                      {progressSummary}
                      {(last7Total + prior7Total) >= 4 && weekDelta !== 0 && (
                        <span title="Team activity last 7 days vs the 7 days before"
                          style={{
                            fontSize: 10, fontWeight: 700,
                            color: weekDelta > 0 ? T.green : T.amber,
                            background: weekDelta > 0 ? "rgba(78,168,110,0.10)" : "rgba(200,144,42,0.10)",
                            border: `0.5px solid ${weekDelta > 0 ? "rgba(78,168,110,0.3)" : "rgba(200,144,42,0.3)"}`,
                            padding: "1px 6px", borderRadius: 6, letterSpacing: "0.02em",
                          }}>
                          {weekDelta > 0 ? `↑ ${weekDelta} vs last 7d` : `↓ ${Math.abs(weekDelta)} vs last 7d`}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: T.surface, overflow: "hidden", border: `0.5px solid ${T.border}` }}>
                    <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: accentColor, borderRadius: 3, transition: "width 0.4s ease" }} />
                  </div>
                </div>

                {/* Member roster — sorted by progress, leader gets a 🥇 */}
                <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "10px 16px 6px" }}>
                  {sortedMembers.map(m => {
                    const logs = m.logs || [];
                    const mWeekSessions = sharedMemberWeekSessionCount(logs);
                    const mHitWeek = isWeekly && mWeekSessions >= wt;
                    const mLoggedToday = memberLoggedOn(logs, today);
                    const mOnTrack = isWeekly ? mHitWeek : mLoggedToday;
                    const todayGoalNums = g.habitType === "goal"
                      ? logs
                        .filter(l => l.date === today)
                        .map(l => (typeof l.value === "number" ? l.value : Number(l.value)))
                        .filter(Number.isFinite)
                      : [];
                    const statusLabel = isWeekly
                      ? (mHitWeek ? `✓ ${mWeekSessions}/${wt}` : `${mWeekSessions}/${wt} sessions`)
                      : (g.habitType === "goal" && todayGoalNums.length)
                        ? `● ${todayGoalNums[todayGoalNums.length - 1]}`
                        : mLoggedToday ? "✓ done" : "— not yet";
                    const nudgeCount = nudgeCountForFriend(nudgeCountsToday, m.userId);
                    const atNudgeLimit = nudgeCount >= NUDGE_DAILY_LIMIT;
                    // Free users see the nudge affordance but tapping it routes
                    // to the upgrade modal — accountability/nudges are a Pro
                    // feature (see landing "Accountability + nudge features").
                    const canShowNudge = !m.isMe && !mOnTrack && !atNudgeLimit && onNudgeFriend;
                    const canNudge = canShowNudge && isPro;
                    const nudgeLocked = !m.isMe && !mOnTrack && !atNudgeLimit && onNudgeFriend && !isPro;
                    const isLeader = leaderId && m.userId === leaderId;
                    return (
                      <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ position: "relative", flexShrink: 0 }}>
                          <Avatar name={m.name} avatarUrl={m.avatarUrl} size={28} />
                          {isLeader && (
                            <span aria-label="Leader"
                              title={isWeekly ? "Most sessions this week" : "Most active in the last 14 days"}
                              style={{
                                position: "absolute", right: -5, bottom: -4,
                                fontSize: 11, lineHeight: 1,
                                background: T.bg, borderRadius: "50%",
                                padding: "1px 2px",
                              }}>
                              🥇
                            </span>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: m.isMe ? T.text : T.sub }}>
                          {m.isMe ? "You" : (m.name || "Member")}
                        </div>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: mOnTrack ? T.green : T.hint,
                          flexShrink: 0,
                        }}>{statusLabel}</span>
                        {canNudge && (
                          <button type="button"
                            onClick={() => { setNudgeTarget({ userId: m.userId, name: m.name || "Member" }); setNudgeMessage(""); }}
                            style={{ flexShrink: 0, marginLeft: 4, padding: "3px 10px", borderRadius: 10, border: `0.5px solid rgba(200,144,42,0.4)`, background: "rgba(200,144,42,0.1)", color: T.gold, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                            💪 Nudge
                          </button>
                        )}
                        {nudgeLocked && (
                          <button type="button"
                            onClick={() => onUpgrade?.()}
                            aria-label="Nudge is a Pro feature — tap to preview"
                            title="Nudges are a Pro accountability feature"
                            style={{ flexShrink: 0, marginLeft: 4, padding: "3px 10px", borderRadius: 10, border: `0.5px solid rgba(200,144,42,0.3)`, background: "rgba(200,144,42,0.06)", color: T.muted, fontSize: 11, fontWeight: 700, cursor: "pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                            💪 Nudge
                            <span style={{ fontSize:8, fontWeight:800, color:"#0F0F0D", background:T.gold, padding:"1px 4px", borderRadius:4, letterSpacing:"0.04em" }}>PRO</span>
                          </button>
                        )}
                        {!m.isMe && atNudgeLimit && !mOnTrack && (
                          <span style={{ fontSize: 10, color: T.muted, flexShrink: 0, marginLeft: 4 }} title="Daily nudge limit reached">
                            3/3 today
                          </span>
                        )}
                        {!m.isMe && nudgeCount > 0 && nudgeCount < NUDGE_DAILY_LIMIT && !mOnTrack && (
                          <span style={{ fontSize: 10, color: T.muted, flexShrink: 0, marginLeft: 4 }}>{nudgeCount}/3 today</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Footer: delete (creator only) */}
                {isCreator && onDeleteSharedGoal && (
                  <div style={{ borderTop: `0.5px solid ${T.border}`, padding: "8px 16px", display: "flex", justifyContent: "flex-end" }}>
                    {sharedGoalDeleteId === g.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: T.accent, fontWeight: 500 }}>Remove for everyone?</span>
                        <button type="button" disabled={deleteSharedLoading}
                          onClick={async () => {
                            setDeleteSharedLoading(true);
                            const res = await onDeleteSharedGoal(g.id);
                            setDeleteSharedLoading(false);
                            if (!res?.error) setSharedGoalDeleteId(null);
                          }}
                          style={{ padding: "4px 12px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: deleteSharedLoading ? 0.6 : 1 }}>
                          {deleteSharedLoading ? "…" : "Remove"}
                        </button>
                        <button type="button" disabled={deleteSharedLoading} onClick={() => setSharedGoalDeleteId(null)}
                          style={{ padding: "4px 10px", borderRadius: 8, border: `0.5px solid ${T.border}`, background: "none", color: T.muted, fontSize: 11, cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setSharedGoalDeleteId(g.id)}
                        style={{ padding: "4px 10px", borderRadius: 8, border: `0.5px solid rgba(231,76,60,0.3)`, background: "none", color: "#e05c5c", fontSize: 11, cursor: "pointer" }}>
                        Remove goal
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Start-an-accountability-goal picker (when sharedGoals > 0) ── */}
      {showSharePicker && onShareHabit && (() => {
        const shareableHabits = (habits || []).filter(h => h.habitType !== "log" && !h.sharedGoalId);
        return (
          <div style={{ position:"fixed", inset:0, minHeight:"100dvh", zIndex:120, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", overscrollBehavior:"contain", touchAction:"none" }}
            onClick={() => setShowSharePicker(false)}>
            <div style={{ width:"100%", background:T.bg, borderRadius:"20px 20px 0 0", padding:"24px 20px 52px", maxHeight:"min(70dvh, 70vh)", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }} />
              <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:4 }}>Start an accountability goal</div>
              <div style={{ fontSize:13, color:T.muted, marginBottom:18, lineHeight:1.5 }}>
                Pick a habit to share. Your friend will see when you log — and so will you.
              </div>
              {shareableHabits.length === 0 ? (
                (() => {
                  // If the user has existing shared goals they can still invite more
                  // friends into, show them inline so the sheet never dead-ends.
                  const openableGoals = (sharedGoals || []).slice(0, 4);
                  const hasHabits = (habits || []).some(h => h.habitType !== "log");
                  if (openableGoals.length > 0 && hasHabits) {
                    return (
                      <div>
                        <div style={{ fontSize:13, color:T.muted, padding:"6px 0 14px", lineHeight:1.55 }}>
                          Every habit you have is already shared — invite more friends to one of your existing goals instead.
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          {openableGoals.map(g => (
                            <button key={g.id} type="button"
                              onClick={() => {
                                setInviteGoalId(g.id);
                                setInvitedFriends(new Set());
                                setShowSharePicker(false);
                              }}
                              style={{
                                display:"flex", alignItems:"center", gap:12,
                                padding:"12px 14px", borderRadius:T.rsm,
                                border:`0.5px solid ${T.borderStrong}`,
                                background:T.surface, color:T.text,
                                cursor:"pointer", textAlign:"left",
                              }}>
                              <span style={{ fontSize:22, flexShrink:0 }}>{g.emoji || "🎯"}</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:14, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{g.name}</div>
                                <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
                                  {(g.members || []).length} member{(g.members || []).length === 1 ? "" : "s"}
                                </div>
                              </div>
                              <span style={{ fontSize:12, color:T.gold, fontWeight:700, flexShrink:0 }}>
                                Open →
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div style={{ fontSize:13, color:T.muted, padding:"24px 0", textAlign:"center", lineHeight:1.6 }}>
                      Every habit you have is already shared. Add a new habit on <strong style={{ color: T.sub }}>Today</strong> first.
                    </div>
                  );
                })()
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {shareableHabits.map(h => {
                    const busy = sharingHabitId === h.id;
                    return (
                      <button key={h.id} type="button"
                        disabled={!!sharingHabitId}
                        onClick={async () => {
                          await onShareHabit(h.id);
                          setShowSharePicker(false);
                        }}
                        style={{
                          display:"flex", alignItems:"center", gap:12,
                          padding:"12px 14px", borderRadius:T.rsm,
                          border:`0.5px solid ${T.borderStrong}`,
                          background:T.surface, color:T.text,
                          cursor: sharingHabitId ? "default" : "pointer",
                          textAlign:"left",
                          opacity: (sharingHabitId && !busy) ? 0.5 : 1,
                        }}>
                        <span style={{ fontSize:22, flexShrink:0 }}>{h.emoji}</span>
                        <span style={{ flex:1, fontSize:14, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{h.name}</span>
                        <span style={{ fontSize:12, color:T.gold, fontWeight:700, flexShrink:0 }}>
                          {busy ? "…" : "Share →"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <button type="button" onClick={() => setShowSharePicker(false)}
                style={{ marginTop:20, width:"100%", padding:"13px 0", background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, color:T.sub, fontSize:14, fontWeight:500, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Shared goal invite picker ── */}
      {inviteGoalId && (() => {
        const invGoal = sharedGoals.find(g => g.id === inviteGoalId);
        if (!invGoal) return null;
        const memberIds = new Set((invGoal.members || []).map(m => m.userId));
        const eligibleFriends = (friends || []).filter(f => !memberIds.has(f.id));
        return (
          <div style={{ position:"fixed", inset:0, minHeight:"100dvh", zIndex:120, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"flex-end", overscrollBehavior:"contain", touchAction:"none" }}
            onClick={() => setInviteGoalId(null)}>
            <div style={{ width:"100%", background:T.bg, borderRadius:"20px 20px 0 0", padding:"24px 20px 52px", maxHeight:"min(70dvh, 70vh)", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y" }}
              onClick={e => e.stopPropagation()}>
              {/* Handle bar */}
              <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }} />
              <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:4 }}>Invite to "{invGoal.name}"</div>
              <div style={{ fontSize:13, color:T.muted, marginBottom:20, lineHeight:1.5 }}>
                Friends you invite will get a notification and can join from Social. Their personal habit will auto-sync to this goal.
              </div>
              {eligibleFriends.length === 0 && (
                <div style={{ fontSize:13, color:T.muted, padding:"24px 0", textAlign:"center", lineHeight:1.6 }}>
                  {(friends || []).length === 0
                    ? "Add some friends first — then you can invite them here."
                    : "All your friends are already in this goal! 🎉"}
                </div>
              )}
              {eligibleFriends.map(f => {
                const alreadyInvited = invitedFriends.has(f.id);
                return (
                  <button key={f.id} type="button"
                    onClick={async () => {
                      if (alreadyInvited) return;
                      setInvitedFriends(prev => new Set([...prev, f.id]));
                      try {
                        const { data: { session } } = await supabase.auth.getSession();
                        const uid = session?.user?.id;
                        const myName = user?.name || "Someone";
                        await supabase.from("shared_goal_invites").upsert({
                          goal_id:      invGoal.id,
                          invite_code:  invGoal.inviteCode,
                          inviter_id:   uid,
                          invitee_id:   f.id,
                          goal_name:    invGoal.name,
                          goal_emoji:   invGoal.emoji || "🎯",
                          inviter_name: myName,
                          status:       "pending",
                        }, { onConflict: "goal_id,invitee_id" });
                        fetch("/api/nudge-friend", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
                          body: JSON.stringify({ recipientId: f.id, type: "shared_goal_invite", goalName: invGoal.name }),
                        }).catch(() => {});
                      } catch {}
                    }}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"12px 0", background:"none", border:"none", borderBottom:`0.5px solid ${T.border}`, cursor: alreadyInvited ? "default" : "pointer", textAlign:"left" }}>
                    <Avatar name={f.name} avatarUrl={f.avatarUrl} size={38} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:600, color:T.text }}>{f.name || "Friend"}</div>
                      {f.streak > 0 && <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{f.streak}🔥 streak</div>}
                    </div>
                    <span style={{ fontSize:12, fontWeight:700, color: alreadyInvited ? T.green : T.accent, flexShrink:0 }}>
                      {alreadyInvited ? "✓ Invited" : "Invite"}
                    </span>
                  </button>
                );
              })}
              <button type="button" onClick={() => setInviteGoalId(null)}
                style={{ marginTop:20, width:"100%", padding:"13px 0", background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, color:T.sub, fontSize:14, fontWeight:500, cursor:"pointer" }}>
                {invitedFriends.size > 0 ? `Done — ${invitedFriends.size} invited` : "Cancel"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Friends sheet ────────────────────────────────────────────────
          Houses the full friends list, incoming requests, outgoing/pending
          requests, and the Add friend form. Triggered by the compact Friends
          button at the top of the Social page. Lives behind the friend
          profile sheet (z-index 180 vs 200) so tapping a friend layers the
          detail sheet on top cleanly without unmounting this one. */}
      {showFriendsSheet && (
        <>
          <div onClick={() => setShowFriendsSheet(false)}
            style={{ position: "fixed", inset: 0, minHeight: "100dvh", background: "rgba(0,0,0,0.65)", zIndex: 180, overscrollBehavior: "contain", touchAction: "none" }} />
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 181,
            background: T.bg, borderRadius: "20px 20px 0 0",
            padding: "18px 20px 32px", maxWidth: 430, margin: "0 auto",
            maxHeight: "min(85dvh, 85vh)", display: "flex", flexDirection: "column",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
            touchAction: "auto",
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border, margin: "0 auto 14px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexShrink: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Friends</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => { setShowAddFriend(s => !s); setAddError(""); setAddDone(false); }}
                  style={{ padding: "6px 12px", borderRadius: 16, border: `0.5px solid ${T.borderStrong}`, background: showAddFriend ? "rgba(200,144,42,0.12)" : "none", color: T.gold, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {showAddFriend ? "Close" : "+ Add"}
                </button>
                <button onClick={() => setShowFriendsSheet(false)}
                  style={{ width: 34, height: 34, borderRadius: "50%", border: `0.5px solid ${T.borderStrong}`, background: T.raised, color: T.text, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ×
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
              {/* Add-friend form */}
              {showAddFriend && (
                <div style={{ ...card, marginBottom: 14 }}>
                  {addDone ? (
                    <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 6 }}>Invite sent</div>
                      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 16 }}>
                        They’ll see it under Friend requests when they open Forged. You’ll both be notified when they accept.
                      </div>
                      <button
                        type="button"
                        onClick={() => { setAddDone(false); setShowAddFriend(false); }}
                        style={{ padding: "10px 28px", borderRadius: 20, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6 }}>Add a friend</div>
                      <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55, marginBottom: 10 }}>
                        Enter the <strong style={{ color: T.text }}>email they use for Forged</strong> or their <strong style={{ color: T.text }}>@username</strong> (set in Profile → Social). They’ll get a request — once accepted, you’ll see each other here.
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="text"
                          placeholder="friend@email.com or @username"
                          autoComplete="off"
                          value={addEmail}
                          onChange={e => { setAddEmail(e.target.value); setAddError(""); }}
                          onKeyDown={e => e.key === "Enter" && handleSendRequest()}
                          style={{ flex: 1, background: T.surface, border: `0.5px solid ${T.borderStrong}`, borderRadius: T.rsm, padding: "9px 12px", fontSize: 16, color: T.text, outline: "none" }}
                        />
                        <button type="button" onClick={handleSendRequest} disabled={addLoading || !addEmail.trim()}
                          style={{ padding: "9px 14px", borderRadius: T.rsm, border: "none", background: T.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (!addEmail.trim() || addLoading) ? 0.6 : 1 }}>
                          {addLoading ? "…" : "Send"}
                        </button>
                      </div>
                      {addError && <div style={{ fontSize: 12, color: "#e05c5c", marginTop: 6 }}>{addError}</div>}
                    </>
                  )}
                </div>
              )}

              {/* Incoming requests */}
              {friendRequests.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={sectionLabel}>Incoming requests</div>
                  {friendRequests.map(req => (
                    <div key={req.friendshipId} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={req.name} avatarUrl={req.avatarUrl} size={34} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{req.name}</div>
                        <div style={{ fontSize: 12, color: T.muted }}>wants to be friends</div>
                      </div>
                      <button onClick={() => onAccept(req.friendshipId)} style={{ padding: "6px 12px", borderRadius: 16, border: "none", background: T.accent, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 6 }}>Accept</button>
                      <button onClick={() => onDecline(req.friendshipId)} style={{ padding: "6px 10px", borderRadius: 16, border: `0.5px solid ${T.border}`, background: "none", color: T.muted, fontSize: 12, cursor: "pointer" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Outgoing / pending requests */}
              {sentRequests.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={sectionLabel}>Pending — awaiting them</div>
                  {sentRequests.map(s => (
                    <div key={s.friendshipId} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={s.name} avatarUrl={s.avatarUrl} size={34} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: T.muted }}>Request sent · pending</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onCancelSentRequest(s.friendshipId)}
                        style={{ padding: "5px 10px", borderRadius: T.rsm, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Current friends */}
              <div style={{ marginBottom: 6 }}>
                <div style={sectionLabel}>
                  Your friends{friends.length > 0 ? ` · ${friends.length}` : ""}
                </div>
                {friendsLoading ? (
                  <div style={{ textAlign: "center", padding: "24px 0", color: T.muted, fontSize: 13 }}>Loading…</div>
                ) : friends.length === 0 ? (
                  <div style={{ ...card, padding: "22px 18px", textAlign: "center" }}>
                    <div style={{ fontSize: 26, marginBottom: 8 }}>👥</div>
                    {sentRequests.length > 0 ? (
                      <>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 6 }}>Invite pending</div>
                        <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.6 }}>
                          Your invite is on its way — they'll appear here once they accept. Want to invite someone else?
                        </div>
                        <button type="button"
                          onClick={() => { setShowAddFriend(true); setAddError(""); setAddEmail(""); setAddDone(false); }}
                          style={{ marginTop: 12, padding: "8px 18px", borderRadius: 18, border: `0.5px solid ${T.borderStrong}`, background: "none", color: T.gold, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                          + Add another
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 6 }}>No friends yet</div>
                        <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>
                          Invite someone you actually want to stay consistent with. You'll see each other's daily logs and streaks.
                        </div>
                        <button type="button"
                          onClick={() => { setShowAddFriend(true); setAddError(""); setAddEmail(""); setAddDone(false); }}
                          style={{ padding: "8px 18px", borderRadius: 18, border: "none", background: T.accent, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                          Add a friend
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  friends.map((f, i) => {
                    const lastActive = !f.loggedToday ? friendLastActiveLabel(f.id) : null;
                    return (
                      <div key={f.id} onClick={() => { setSelectedFriend(f); }}
                        style={{ ...card, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? T.gold : T.muted, width: 18, textAlign: "center" }}>{i + 1}</div>
                        <Avatar name={f.name} avatarUrl={f.avatarUrl} size={34} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, color: T.text, fontWeight: 500 }}>{f.name}</div>
                          <div style={{ fontSize: 12, color: T.muted }}>⚡ {f.xp} xp{f.streak > 0 ? ` · 🔥 ${f.streak}` : ""}</div>
                        </div>
                        <div style={{ textAlign: "center", marginRight: 4, minWidth: 48 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: f.loggedToday ? T.green : T.muted }}>
                            {f.loggedToday ? "✓" : (lastActive && lastActive !== "today" ? lastActive : "—")}
                          </div>
                          <div style={{ fontSize: 10, color: T.hint }}>
                            {f.loggedToday ? "today" : (lastActive && lastActive !== "today" ? "last active" : "today")}
                          </div>
                        </div>
                        <div style={{ color: T.hint, fontSize: 14, flexShrink: 0 }}>›</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Friend profile modal ── */}
      {selectedFriend && (() => {
        const f = selectedFriend;
        const sharedWithFriend = sharedGoals.filter(g =>
          g.members.some(m => m.userId === f.id) && g.members.some(m => m.isMe)
        );
        const friendNudgeCount = nudgeCountForFriend(nudgeCountsToday, f.id);
        const friendAtNudgeLimit = friendNudgeCount >= NUDGE_DAILY_LIMIT;

        function handleNudge() {
          if (!onNudgeFriend || friendAtNudgeLimit) return;
          setNudgeTarget({ userId: f.id, name: f.name || "Friend" });
          setNudgeMessage("");
        }

        return (
          <>
            {/* Overlay */}
            <div onClick={() => setSelectedFriend(null)}
              style={{ position: "fixed", inset: 0, minHeight: "100dvh", background: "rgba(0,0,0,0.65)", zIndex: 200, overscrollBehavior: "contain", touchAction: "none" }} />
            {/* Sheet */}
            <div style={{
              position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 201,
              background: T.bg, borderRadius: "20px 20px 0 0",
              padding: "24px 24px 48px", maxWidth: 430, margin: "0 auto",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
              maxHeight: "min(88dvh, 88vh)",
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              overscrollBehavior: "contain",
              touchAction: "auto",
            }}>
              {/* Handle + close */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border, margin: "0 auto" }} />
                <button onClick={() => setSelectedFriend(null)}
                  style={{ position: "absolute", right: 20, top: 16, width: 28, height: 28, borderRadius: "50%", border: "none", background: T.surface, color: T.muted, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  ×
                </button>
              </div>

              {/* Friend header */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                <Avatar name={f.name} avatarUrl={f.avatarUrl} size={52} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{f.name}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                    {f.loggedToday ? "✓ Logged today" : "— Nothing logged today"}
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
                {[
                  { value: `🔥 ${f.streak}`, label: "streak" },
                  { value: `⚡ ${f.xp}`, label: "xp" },
                  { value: f.loggedToday ? "✓" : "—", label: "today", color: f.loggedToday ? T.green : T.muted },
                ].map(({ value, label, color }) => (
                  <div key={label} style={{ flex: 1, textAlign: "center", background: T.raised, borderRadius: T.rsm, padding: "10px 8px", border: `0.5px solid ${T.border}` }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: color || T.text }}>{value}</div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Shared goals */}
              {sharedWithFriend.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                    Shared goals
                  </div>
                  {sharedWithFriend.map(g => {
                    const fMember = g.members.find(m => m.userId === f.id);
                    const fDone = (fMember?.logs || []).some(l => l.date === today);
                    return (
                      <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, background: T.raised, borderRadius: T.rsm, padding: "10px 12px", marginBottom: 6, border: `0.5px solid ${T.border}` }}>
                        <span style={{ fontSize: 20 }}>{g.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{g.name}</div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: fDone ? T.green : T.hint }}>
                          {fDone ? "✓ done" : "— not yet"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Nudge button — Pro-gated accountability feature. Free users
                  see the button but tapping it opens the upgrade modal. */}
              {isPro ? (
                <button
                  onClick={handleNudge}
                  disabled={friendAtNudgeLimit}
                  style={{
                    width: "100%", padding: "13px 0", borderRadius: T.rsm, border: "none",
                    background: friendAtNudgeLimit ? T.surface : T.gold,
                    color: friendAtNudgeLimit ? T.muted : "#0F0F0D",
                    fontSize: 15, fontWeight: 700, cursor: friendAtNudgeLimit ? "default" : "pointer",
                    transition: "all 0.2s",
                  }}>
                  {friendAtNudgeLimit
                    ? "💪 3/3 nudges today"
                    : friendNudgeCount > 0
                      ? `💪 Nudge again (${friendNudgeCount}/${NUDGE_DAILY_LIMIT} today)`
                      : "💪 Nudge"}
                </button>
              ) : null}
              {isPro && friendAtNudgeLimit && (
                <div style={{ fontSize: 12, color: T.muted, textAlign: "center", marginTop: 10, lineHeight: 1.45, padding: "0 8px" }}>
                  You’ve nudged them {NUDGE_DAILY_LIMIT} times today. Give them a bit of breathing room and try again tomorrow.
                </div>
              )}
              {isPro ? null : (
                <button
                  onClick={() => { onUpgrade?.(); setSelectedFriend(null); }}
                  style={{
                    width: "100%", padding: "13px 0", borderRadius: T.rsm,
                    border: `1px solid rgba(200,144,42,0.45)`,
                    background: "rgba(200,144,42,0.10)",
                    color: T.gold,
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8,
                    transition: "all 0.2s",
                  }}>
                  💪 Nudge
                  <span style={{ fontSize:9, fontWeight:800, color:"#0F0F0D", background:T.gold, padding:"2px 6px", borderRadius:5, letterSpacing:"0.05em" }}>PRO</span>
                </button>
              )}
              <button onClick={() => { onRemoveFriend(f.friendshipId); setSelectedFriend(null); }}
                style={{ width: "100%", padding: "10px 0", marginTop: 8, background: "none", border: "none", color: T.hint, fontSize: 13, cursor: "pointer" }}>
                Remove friend
              </button>
            </div>
          </>
        );
      })()}

      {/* ── Nudge message sheet ── */}
      {nudgeTarget && (
        <div
          style={{ position:"fixed", inset:0, minHeight:"100dvh", zIndex:350, background:"rgba(0,0,0,0.65)", display:"flex", alignItems:"flex-end", overscrollBehavior:"contain", touchAction:"none" }}
          onClick={() => { if (!nudgeSending) { setNudgeTarget(null); setNudgeMessage(""); } }}>
          <div
            style={{ width:"100%", background:T.bg, borderRadius:"20px 20px 0 0", padding:"24px 20px 52px", maxWidth:430, margin:"0 auto", touchAction:"auto" }}
            onClick={e => e.stopPropagation()}>
            {/* Handle */}
            <div style={{ width:36, height:4, borderRadius:2, background:T.border, margin:"0 auto 20px" }} />
            <div style={{ fontSize:16, fontWeight:700, color:T.text, marginBottom:16 }}>
              Nudge {nudgeTarget.name} 💪
            </div>
            <textarea
              placeholder="Add a message… (optional)"
              value={nudgeMessage}
              onChange={e => setNudgeMessage(e.target.value)}
              maxLength={160}
              rows={3}
              style={{
                width:"100%", border:`0.5px solid ${T.border}`, borderRadius:T.rsm,
                background:T.surface, color:T.text, fontSize:16, padding:"10px 12px",
                fontFamily:T.font, resize:"none", boxSizing:"border-box", outline:"none",
              }}
            />
            <div style={{ fontSize:11, color:T.hint, textAlign:"right", marginTop:4 }}>
              {nudgeMessage.length}/160
            </div>
            <button
              type="button"
              disabled={nudgeSending}
              onClick={async () => {
                setNudgeSending(true);
                const res = await onNudgeFriend(nudgeTarget.userId, nudgeMessage.trim());
                setNudgeSending(false);
                if (res?.error) {
                  onToast?.(`Couldn't send nudge — ${res.error}`);
                  const errLow = String(res.error).toLowerCase();
                  if (
                    errLow.includes("already nudged") ||
                    errLow.includes("3 times today") ||
                    errLow.includes("breathing room") ||
                    res.limit != null
                  ) {
                    setNudgeCountToLimit(nudgeTarget.userId);
                  }
                  return;
                }
                onToast?.("💪 Nudge sent!");
                bumpNudgeCount(nudgeTarget.userId);
                setNudgeTarget(null);
                setNudgeMessage("");
              }}
              style={{
                width:"100%", marginTop:12, padding:"13px 0",
                background: nudgeSending ? T.surface : T.gold,
                color: nudgeSending ? T.muted : "#0F0F0D",
                borderRadius:T.rsm, border:"none", fontSize:15, fontWeight:700,
                cursor: nudgeSending ? "default" : "pointer", transition:"all 0.2s",
              }}>
              {nudgeSending ? "Sending…" : "Send nudge 💪"}
            </button>
            <button
              type="button"
              disabled={nudgeSending}
              onClick={() => { setNudgeTarget(null); setNudgeMessage(""); }}
              style={{ width:"100%", padding:"10px 0", background:"none", border:"none", color:T.hint, fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
