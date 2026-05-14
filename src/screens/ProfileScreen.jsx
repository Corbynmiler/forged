import { useState, useEffect } from "react";
import { T, COACH_ICON_OPTIONS, PROFILE_DISPLAY_NAME_MAX, PROFILE_COACH_NAME_MAX, clampProfileDisplayName, clampProfileCoachName, FREE_DAILY_LIMIT } from "../theme.js";
import { supabase } from "../supabase.js";
import {
  getLevel, nextLevel, getStreak, getBestStreak,
  isSatisfiedForTodayRing, currentWeekStart, fmtDate,
  openForgedFeedbackMailto,
} from "../utils.js";
import { Modal, GBtn, lbl, inp, Stat, ToggleSwitch, NotifCategoryRow, JoinCoachSection } from "../components/ui.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";
import { CoachSettingsSheet } from "./SocialScreen.jsx";

export function ShareCardModal({ user, habits, xp, onClose }) {
  useScrollLock(true);
  const level = getLevel(xp);
  const realLogs = habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip"));
  const totalLogs = new Set(realLogs.map(l => l.date)).size; // unique days tracked
  const bestStreak = Math.max(0, ...habits.map(h => getStreak(h)));
  const loggedToday = habits.filter(h => h.habitType !== "log" && isSatisfiedForTodayRing(h)).length;
  const ws = currentWeekStart();
  const weekLogs = habits.reduce((s, h) => s + h.logs.filter(l => l.date >= ws && l.value !== "quicknote" && l.value !== "skip").length, 0);
  const weekTotal = habits.length * 7;
  const weekPct = weekTotal > 0 ? Math.min(100, Math.round((weekLogs / weekTotal) * 100)) : 0;
  const isEmoji = user.avatarUrl && !user.avatarUrl.startsWith("http");

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", zIndex:400, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:"100%", maxWidth:380, animation:"shareSlide 0.3s ease-out", touchAction:"auto", maxHeight:"min(92dvh, 92vh)", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        {/* The card — designed for screenshotting */}
        <div id="share-card" style={{ background:"linear-gradient(145deg, #1A1A16 0%, #0F0F0D 100%)", borderRadius:24, padding:"32px 28px 28px", border:`1px solid ${T.borderMid}`, boxShadow:"0 20px 60px rgba(0,0,0,0.8)" }}>
          {/* Top row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:28 }}>
            <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, letterSpacing:"-0.01em" }}>Forged</div>
            <div style={{ fontSize:11, color:T.hint, letterSpacing:"0.06em", textTransform:"uppercase" }}>{fmtDate()}</div>
          </div>
          {/* Avatar + name */}
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
            <div style={{ width:52, height:52, borderRadius:"50%", background:T.accent+"22", border:`2px solid ${T.accent}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              {isEmoji
                ? <span style={{ fontSize:26 }}>{user.avatarUrl}</span>
                : user.avatarUrl
                ? <img src={user.avatarUrl} style={{ width:"100%", height:"100%", borderRadius:"50%", objectFit:"cover" }}/>
                : <span style={{ fontFamily:T.serif, fontSize:24, color:T.accent }}>{(user.name||"?").charAt(0).toUpperCase()}</span>
              }
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{
                fontSize:18, fontWeight:500, color:T.text,
                lineHeight:1.25, wordBreak:"break-word", overflowWrap:"anywhere",
              }}
              >
                {user.name}
              </div>
              <div style={{ fontSize:12, color:level.color, fontWeight:500, marginTop:2 }}>⚡ {level.label} · {xp} xp</div>
            </div>
          </div>
          {/* Stats grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {[
              { label:"This week",    value:`${weekPct}%`,    sub:"completion",   color:weekPct>=70?T.green:T.amber },
              { label:"Today",        value:`${loggedToday}/${habits.length}`, sub:"habits logged", color:T.accent },
              { label:"Best streak",  value:`${bestStreak}d`, sub:"consecutive",  color:T.gold },
              { label:"Days tracked", value:totalLogs,        sub:"all time",     color:T.text },
            ].map((s, i) => (
              <div key={i} style={{ background:"rgba(255,255,255,0.04)", borderRadius:14, padding:"14px 16px", border:`0.5px solid ${T.border}` }}>
                <div style={{ fontSize:22, fontWeight:600, color:s.color }}>{s.value}</div>
                <div style={{ fontSize:11, color:T.hint, marginTop:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>{s.sub}</div>
                <div style={{ fontSize:10, color:T.hint, marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Habits row */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
            {habits.slice(0, 8).map(h => (
              <div key={h.id} style={{ fontSize:11, padding:"4px 10px", borderRadius:12, background:h.color+"22", color:h.color, border:`0.5px solid ${h.color+"44"}` }}>
                {h.emoji} {h.name}
              </div>
            ))}
          </div>
          {/* Footer */}
          <div style={{ borderTop:`0.5px solid ${T.border}`, paddingTop:14, fontSize:11, color:T.hint, letterSpacing:"0.04em" }}>
            forged-sage.vercel.app · track what you're forging
          </div>
        </div>
        {/* Instructions */}
        <div style={{ textAlign:"center", marginTop:18, fontSize:13, color:"rgba(255,255,255,0.5)" }}>
          Screenshot this to share 📸
        </div>
        <button onClick={onClose} style={{ width:"100%", marginTop:14, padding:14, borderRadius:T.rsm, border:"none", background:T.raised, color:T.muted, fontSize:14, cursor:"pointer" }}>
          Close
        </button>
      </div>
    </div>
  );
}
// ─── AVATAR PICKER ────────────────────────────────────────────────────────────
const AVATARS = [
  "🦁","🐯","🐺","🦊","🐼","🐨",
  "🦋","🦅","🦍","🐉","🦄","🐬",
  "🔥","⚡","🌊","🏔️","🌙","☀️",
  "🎯","💎","🥷","⚒️","🛡️","👑",
];

function AvatarPickerModal({ current, onSelect, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:6 }}>Pick your avatar</div>
      <div style={{ fontSize:13, color:T.muted, marginBottom:20 }}>Tap one to set it as your profile picture.</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:10, marginBottom:8 }}>
        {AVATARS.map(a => (
          <button key={a} onClick={() => { onSelect(a); onClose(); }}
            style={{ aspectRatio:"1", borderRadius:12, border:`2px solid ${current===a?T.accent:T.border}`, background:current===a?T.accent+"22":T.surface, fontSize:26, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.12s" }}>
            {a}
          </button>
        ))}
      </div>
      <GBtn onClick={onClose}>Cancel</GBtn>
    </Modal>
  );
}

// ─── DELETE CONFIRM MODAL ────────────────────────────────────────────────────

// ─── PROFILE / SETTINGS SCREEN ────────────────────────────────────────────────
// ─── UPGRADE MODAL ────────────────────────────────────────────────────────────
export function UpgradeModal({ onClose, habitCount = 0, userId, userEmail }) {
  useScrollLock(true);
  const [spots,        setSpots]        = useState(null);
  const [checkoutPlan, setCheckoutPlan] = useState(null); // "monthly" | "annual" | null = idle

  useEffect(() => {
    supabase.rpc("beta_spot_count").then(({ data }) => {
      if (typeof data === "number") setSpots(data);
    });
  }, []);

  const spotsLeft = spots !== null ? Math.max(0, 100 - spots) : null;
  const spotsPct  = spots !== null ? Math.min(100, (spots / 100) * 100) : 0;

  const features = [
    { icon:"∞",  label:"Unlimited habits",    free:"Up to 5",      pro:"No limit",               live:true },
    { icon:"🤖", label:"AI coach messages",    free:`${FREE_DAILY_LIMIT} per day`,   pro:"Unlimited",              live:true },
    { icon:"🎙️", label:"Voice logging",         free:"—",            pro:"Talk to log & reflect",  live:true },
    { icon:"💪", label:"Nudge a friend",       free:"—",            pro:"Keep each other honest", live:true },
    { icon:"📜", label:"Full history",         free:"Last 7 days",  pro:"Every entry, forever",   live:true },
    { icon:"📅", label:"Monthly calendar",     free:"—",            pro:"Spot gaps at a glance",  live:true },
    { icon:"🔔", label:"Smart reminders",      free:"—",            pro:"Daily push nudges",      live:true },
    { icon:"📊", label:"Pattern detection",    free:"Streaks + 28d", pro:"AI pattern analysis",    live:true },
  ];

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.88)", zIndex:500, display:"flex", alignItems:"flex-end", justifyContent:"center", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:430, maxWidth:"100vw", background:T.raised, borderRadius:"24px 24px 0 0", padding:"24px 22px 44px", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", maxHeight:"min(92dvh, 92vh)", touchAction:"pan-y" }}>

        {/* Close */}
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:4 }}>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.muted, fontSize:26, cursor:"pointer", lineHeight:1 }}>×</button>
        </div>

        {/* Beta spots urgency bar */}
        <div style={{ background:"rgba(200,144,42,0.08)", border:`1px solid rgba(200,144,42,0.3)`, borderRadius:T.r, padding:"12px 14px", marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 }}>
            <span style={{ fontSize:12, fontWeight:600, color:T.gold }}>🔥 Beta pricing — first 100 users only</span>
            {spotsLeft !== null && (
              <span style={{ fontSize:11, color: spotsLeft <= 10 ? "#e74c3c" : T.muted, fontWeight:500 }}>
                {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
              </span>
            )}
          </div>
          <div style={{ height:5, background:T.surface, borderRadius:3, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:3, background:T.gold, width:`${spotsPct}%`, transition:"width 0.8s ease" }}/>
          </div>
          <div style={{ fontSize:11, color:T.hint, marginTop:6, lineHeight:1.5 }}>
            Lock in <strong style={{ color:T.text }}>$4.99/mo forever</strong> — goes to $7.99 once we hit 100 users.
          </div>
        </div>

        {/* Header */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, marginBottom:4 }}>Forged early supporter</div>
          {habitCount >= 5 && (
            <div style={{ fontSize:13, color:T.amber }}>You've hit the 5-habit free limit — early supporter access removes it.</div>
          )}
        </div>

        {/* Feature comparison */}
        <div style={{ background:T.surface, borderRadius:T.r, overflow:"hidden", marginBottom:20, border:`0.5px solid ${T.border}` }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px", borderBottom:`0.5px solid ${T.border}`, padding:"7px 14px" }}>
            <span style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em" }}>Feature</span>
            <span style={{ fontSize:10, color:T.hint, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.07em" }}>Free</span>
            <span style={{ fontSize:10, color:T.gold, textAlign:"center", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600 }}>Supporter</span>
          </div>
          {features.map((f, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px", padding:"10px 14px", borderBottom: i < features.length-1 ? `0.5px solid ${T.border}` : "none", alignItems:"center" }}>
              <div>
                <span style={{ fontSize:13 }}>{f.icon} </span>
                <span style={{ fontSize:13, color:T.text, fontWeight:500 }}>{f.label}</span>
                {!f.live && <span style={{ fontSize:9, color:T.hint, marginLeft:6, textTransform:"uppercase", letterSpacing:"0.07em" }}>soon</span>}
              </div>
              <span style={{ fontSize:11, color:T.hint, textAlign:"center" }}>{f.free}</span>
              <span style={{ fontSize:11, color: f.live ? T.gold : T.muted, textAlign:"center", fontWeight: f.live ? 500 : 400 }}>{f.pro}</span>
            </div>
          ))}
        </div>

        {/* Pricing tiers */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
          <div style={{ background:T.surface, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"14px 12px", textAlign:"center" }}>
            <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Monthly</div>
            <div style={{ fontSize:28, fontWeight:600, color:T.text, letterSpacing:"-0.02em" }}>$4.99</div>
            <div style={{ fontSize:11, color:T.hint, marginTop:3, textDecoration:"line-through" }}>$7.99/mo after 100 users</div>
          </div>
          <div style={{ background:"rgba(200,144,42,0.08)", borderRadius:T.r, border:`1px solid rgba(200,144,42,0.45)`, padding:"14px 12px", textAlign:"center", position:"relative" }}>
            <div style={{ position:"absolute", top:-10, left:"50%", transform:"translateX(-50%)", background:T.gold, color:"#1a1a16", fontSize:9, fontWeight:700, padding:"3px 9px", borderRadius:20, letterSpacing:"0.08em", textTransform:"uppercase", whiteSpace:"nowrap" }}>Best value</div>
            <div style={{ fontSize:10, color:T.gold, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:5 }}>Annual</div>
            <div style={{ fontSize:28, fontWeight:600, color:T.gold, letterSpacing:"-0.02em" }}>$39.99</div>
            <div style={{ fontSize:11, color:T.green, marginTop:3 }}>$3.33/mo · save 33%</div>
          </div>
        </div>

        {/* CTA */}
        <button
          disabled={!!checkoutPlan}
          onClick={async () => {
            setCheckoutPlan("monthly");
            try {
              const res = await fetch("/api/create-checkout", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
                },
                body: JSON.stringify({ plan: "monthly" }),
              });
              const { url, error } = await res.json();
              if (url) { window.location.href = url; }
              else { alert(error || "Couldn't start checkout — try again"); setCheckoutPlan(null); }
            } catch { alert("Couldn't connect — try again"); setCheckoutPlan(null); }
          }}
          style={{ display:"block", width:"100%", padding:"16px", borderRadius:T.rsm, border:"none", background:T.gold, color:"#1a1a16", fontSize:16, fontWeight:700, cursor: checkoutPlan ? "wait" : "pointer", marginBottom:10, textAlign:"center", boxSizing:"border-box", letterSpacing:"0.01em", opacity: checkoutPlan ? 0.7 : 1 }}>
          {checkoutPlan === "monthly" ? "Redirecting to checkout…" : "Become an early supporter — $4.99/mo →"}
        </button>
        <button
          disabled={!!checkoutPlan}
          onClick={async () => {
            setCheckoutPlan("annual");
            try {
              const res = await fetch("/api/create-checkout", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
                },
                body: JSON.stringify({ plan: "annual" }),
              });
              const { url, error } = await res.json();
              if (url) { window.location.href = url; }
              else { alert(error || "Couldn't start checkout — try again"); setCheckoutPlan(null); }
            } catch { alert("Couldn't connect — try again"); setCheckoutPlan(null); }
          }}
          style={{ display:"block", width:"100%", padding:"12px", borderRadius:T.rsm, border:`1px solid rgba(200,144,42,0.4)`, background:"none", color:T.gold, fontSize:14, fontWeight:600, cursor: checkoutPlan ? "wait" : "pointer", marginBottom:10, textAlign:"center", boxSizing:"border-box", opacity: checkoutPlan ? 0.7 : 1 }}>
          {checkoutPlan === "annual" ? "Redirecting to checkout…" : "Annual — $39.99/yr (save 33%) →"}
        </button>
        <div style={{ fontSize:11, color:T.hint, textAlign:"center", lineHeight:1.7 }}>
          Your price is locked in forever — even after we raise it publicly
        </div>
      </div>
    </div>
  );
}
export function ProfileScreen({ user, xp, habits, isPro, isCoach, stripeCustomerId, refCode, authEmail, onUpdateUser, onResetOnboarding, onPreviewOnboarding, onReplayPageGuides, onPreviewCoach, onSignOut, onShowTour, onUpgrade, coachName, coachIcon, onSaveCoach, notifEnabled, notifTime, notifLoading, notifPermission, dailyRemindersEnabled, nudgesEnabled, invitesEnabled, onNotifToggle, onNotifTimeChange, onNotifCategoryChange }) {
  const [editingName,    setEditingName]    = useState(false);
  const [nameVal,        setNameVal]        = useState(user.name);
  const [showCoachSheet, setShowCoachSheet] = useState(false);
  const [showAvatarPick, setShowAvatarPick] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [refCount,       setRefCount]       = useState(null);
  const [refCopied,      setRefCopied]      = useState(false);
  const [portalLoading,  setPortalLoading]  = useState(false);
  const [handleDraft,    setHandleDraft]    = useState(() => String(user.username || "").replace(/^@+/, ""));
  const [handleErr,      setHandleErr]      = useState("");
  const [handleSaved,    setHandleSaved]    = useState(false);

  useEffect(() => {
    setHandleDraft(String(user.username || "").replace(/^@+/, ""));
  }, [user.username]);

  useEffect(() => {
    setNameVal(user.name);
  }, [user.name]);

  useEffect(() => {
    supabase.rpc("my_referral_count").then(({ data }) => {
      if (typeof data === "number") setRefCount(data);
    });
  }, []);

  const refLink = refCode
    ? `https://forged-sage.vercel.app/landing.html?ref=${refCode}`
    : null;

  function copyRefLink() {
    if (!refLink) return;
    navigator.clipboard.writeText(refLink).then(() => {
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2000);
    });
  }

  const level = getLevel(xp);
  const next  = nextLevel(xp);
  const pct   = next ? Math.round(((xp - level.min) / (next.min - level.min)) * 100) : 100;
  const totalLogs        = new Set(habits.flatMap(h => h.logs.filter(l => l.value !== "quicknote" && l.value !== "skip").map(l => l.date))).size;
  const totalReflections = habits.reduce((s, h) => s + h.logs.filter(l => l.reflection).length, 0);
  const bestStreak       = Math.max(0, ...habits.map(h => getBestStreak(h)));

  const isEmoji = user.avatarUrl && !user.avatarUrl.startsWith("http");
  const isImage = user.avatarUrl && user.avatarUrl.startsWith("http");

  function SRow({ label, value, onPress, destructive, note }) {
    return (
      <button onClick={onPress || undefined} style={{ display:"flex", alignItems:"center", width:"100%", padding:"13px 16px", background:"none", border:"none", cursor:onPress?"pointer":"default", borderBottom:`0.5px solid ${T.border}`, gap:10 }}>
        <span style={{ fontSize:14, color:destructive?T.accent:T.text, flex:1, textAlign:"left", minWidth:0 }}>{label}</span>
        {note && <span style={{ fontSize:12, color:T.hint, flexShrink:0 }}>{note}</span>}
        {value && (
          <span style={{
            fontSize:13, color:T.muted, flexShrink:1, minWidth:0, maxWidth:"46%",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}
          >
            {value}
          </span>
        )}
        {onPress && !destructive && <span style={{ fontSize:18, color:T.hint, flexShrink:0 }}>›</span>}
      </button>
    );
  }

  return (
    <div>
      {/* Profile header */}
      <div style={{ padding:"24px 18px 0" }}>
        {/* Avatar */}
        <div style={{ position:"relative", width:72, height:72, marginBottom:14 }}>
          <div onClick={() => setShowAvatarPick(true)} style={{ width:72, height:72, borderRadius:"50%", background:T.accent+"22", border:`2px solid ${T.accent}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", overflow:"hidden" }}>
            {isImage
              ? <img src={user.avatarUrl} alt="avatar" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
              : isEmoji
              ? <span style={{ fontSize:34 }}>{user.avatarUrl}</span>
              : <span style={{ fontFamily:T.serif, fontSize:32, color:T.accent }}>{user.name.charAt(0).toUpperCase()}</span>
            }
          </div>
          <div onClick={() => setShowAvatarPick(true)} style={{ position:"absolute", bottom:0, right:0, width:22, height:22, borderRadius:"50%", background:T.raised, border:`1px solid ${T.borderMid}`, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
            <span style={{ fontSize:11 }}>✏️</span>
          </div>
        </div>
        {showAvatarPick && (
          <AvatarPickerModal
            current={user.avatarUrl}
            onSelect={emoji => onUpdateUser({ avatarUrl: emoji })}
            onClose={() => setShowAvatarPick(false)}
          />
        )}

        {/* Name */}
        {editingName ? (
          <div style={{ marginBottom:4 }}>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <input
                style={{ ...inp, fontSize:20, fontFamily:T.serif, flex:1, minWidth:0 }}
                value={nameVal}
                maxLength={PROFILE_DISPLAY_NAME_MAX}
                onChange={e => setNameVal(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    onUpdateUser({ name: clampProfileDisplayName(nameVal.trim() || user.name) });
                    setEditingName(false);
                  }
                }}
              />
              <button
                onClick={() => {
                  onUpdateUser({ name: clampProfileDisplayName(nameVal.trim() || user.name) });
                  setEditingName(false);
                }}
                style={{ padding:"10px 14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, cursor:"pointer", flexShrink:0 }}
              >
                Save
              </button>
            </div>
            <div style={{ fontSize:11, color:T.hint, marginTop:6 }}>
              {nameVal.trim().length}/{PROFILE_DISPLAY_NAME_MAX} — used across the app header and share card
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:4 }}>
            <div style={{
              fontFamily:T.serif, fontSize:26, color:T.text, flex:1, minWidth:0,
              lineHeight:1.2, wordBreak:"break-word", overflowWrap:"anywhere",
            }}
            >
              {user.name}
            </div>
            <button type="button" onClick={() => setEditingName(true)} style={{ fontSize:12, color:T.muted, background:"none", border:"none", cursor:"pointer", flexShrink:0, marginTop:4 }}>Edit</button>
          </div>
        )}
        <div style={{ fontSize:13, color:level.color, fontWeight:500, marginBottom:16 }}>⚡ {level.label} · {xp} xp</div>
        <div data-tour="xp-bar" style={{ height:4, background:T.surface, borderRadius:2, overflow:"hidden", marginBottom:4 }}>
          <div style={{ height:"100%", borderRadius:2, background:level.color, width:`${pct}%`, transition:"width 0.6s ease" }}/>
        </div>
        <div style={{ fontSize:11, color:T.hint, marginBottom:24 }}>{next ? `${next.min - xp} xp to ${next.label}` : "Max level reached"}</div>
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, padding:"0 16px 20px" }}>
        <Stat label="days tracked" value={totalLogs}           color={T.accent}/>
        <Stat label="reflections"  value={totalReflections}    color="#8E44AD"/>
        <Stat label="best streak"  value={`${bestStreak}d`}    color={T.gold}/>
      </div>

      {/* Coaching — only shown when this account is linked to a coach */}
      {user.coachId && (
        <div style={{
          margin:"0 14px 12px",
          background:"linear-gradient(145deg, rgba(39,174,96,0.07) 0%, rgba(39,174,96,0.02) 100%)",
          border:`1px solid rgba(39,174,96,0.28)`,
          borderRadius:14,
          padding:"14px 16px",
        }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#27AE60", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>
            Coaching
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:6 }}>
            <span style={{ fontSize:17, color:T.text, fontWeight:600 }}>
              {user.linkedCoachName || "Your coach"}
            </span>
            <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#27AE60", fontWeight:600, background:"rgba(39,174,96,0.1)", padding:"3px 9px", borderRadius:99 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#27AE60", flexShrink:0 }}/>
              Connected
            </span>
          </div>
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>
            {user.linkedCoachName ? `${user.linkedCoachName} can` : "Your coach can"} see your habit logs and notes to help prepare for your sessions.
          </div>
        </div>
      )}

      {/* Join a coach — shown when not yet linked */}
      {!user.coachId && (
        <JoinCoachSection onLinked={(coachId, coachName) => onUpdateUser({ coachId, linkedCoachName: coachName })} />
      )}

      {/* Account */}
      <div data-tour="profile-account" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>Account</div>
        <SRow label="Display name" value={user.name} onPress={() => setEditingName(true)}/>
        <div style={{ borderBottom:`0.5px solid ${T.border}`, padding:"12px 16px" }}>
          <button type="button" onClick={() => setShowCoachSheet(true)} style={{ display:"flex", alignItems:"center", width:"100%", background:"none", border:"none", cursor:"pointer", gap:10 }}>
            <div style={{ fontSize:18, flexShrink:0 }}>🤖</div>
            <div style={{ flex:1, textAlign:"left", minWidth:0 }}>
              <div style={{ fontSize:14, color:T.text }}>AI coach name</div>
              <div style={{
                fontSize:12, color:T.muted, marginTop:1,
                lineHeight:1.35, wordBreak:"break-word", overflowWrap:"anywhere",
              }}
              >
                {(coachIcon && COACH_ICON_OPTIONS.includes(coachIcon)) ? <>{coachIcon} {coachName || "Coach"}</> : (coachName || "Coach")}
              </div>
            </div>
            <span style={{ fontSize:18, color:T.hint }}>›</span>
          </button>
        </div>
        <div
          style={{
            padding:"14px 16px 16px",
            background:"linear-gradient(135deg, rgba(200,144,42,0.12) 0%, rgba(200,144,42,0.04) 100%)",
            borderTop:`0.5px solid rgba(200,144,42,0.22)`,
          }}
        >
          {/* Header row: icon + label + master toggle. The master toggle
              controls the browser push subscription itself. The three
              category sub-toggles below it gate WHICH push types fire — they
              persist independently per push_subscriptions row so a user can,
              say, accept friend nudges in real time while turning off the
              daily reminder. */}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div
              style={{
                width:40, height:40, borderRadius:12, flexShrink:0,
                background:"rgba(200,144,42,0.18)", border:`0.5px solid rgba(200,144,42,0.35)`,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
              }}
              aria-hidden
            >
              🔔
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:600, color:T.text, letterSpacing:"-0.01em" }}>Push notifications</div>
              <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>
                {notifPermission === "denied"
                  ? "Blocked — enable in your device Settings → Notifications"
                  : notifEnabled
                    ? "Choose what you want to be notified about"
                    : "Tap to enable push notifications on this device"}
              </div>
            </div>
            <ToggleSwitch
              on={notifEnabled}
              onClick={onNotifToggle}
              disabled={notifLoading || notifPermission === "denied"}
              ariaLabel={notifEnabled ? "Disable push notifications" : "Enable push notifications"}
            />
          </div>

          {/* Per-category controls — only relevant once the user has granted
              push permission and we have a live subscription. */}
          {notifEnabled && notifPermission !== "denied" && (
            <div
              style={{
                marginTop:14,
                background:"rgba(0,0,0,0.18)",
                border:`0.5px solid rgba(200,144,42,0.18)`,
                borderRadius:10,
                overflow:"hidden",
              }}
            >
              {/* Daily reminders */}
              <NotifCategoryRow
                emoji="⏰"
                title="Daily reminders"
                subtitle={
                  dailyRemindersEnabled
                    ? "Morning, midday, and evening — from your coach"
                    : "Off — your daily push is paused"
                }
                checked={dailyRemindersEnabled}
                onChange={v => onNotifCategoryChange("daily_reminders_enabled", v)}
                disabled={notifLoading}
              />

              {/* Friend nudges */}
              <NotifCategoryRow
                emoji="💪"
                title="Friend nudges"
                subtitle={
                  nudgesEnabled
                    ? "When a friend nudges you to log"
                    : "Off — in-app toasts still appear, just no push"
                }
                checked={nudgesEnabled}
                onChange={v => onNotifCategoryChange("nudges_enabled", v)}
                disabled={notifLoading}
              />

              {/* Friend requests + shared-goal invites */}
              <NotifCategoryRow
                emoji="🤝"
                title="Requests & invites"
                subtitle={
                  invitesEnabled
                    ? "Friend requests and shared-goal invites"
                    : "Off — accept them in the app instead"
                }
                checked={invitesEnabled}
                onChange={v => onNotifCategoryChange("social_invites_enabled", v)}
                disabled={notifLoading}
                noBorderBottom
              />
            </div>
          )}
        </div>
      </div>

      {/* Social & privacy */}
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>Social & privacy</div>
        <div style={{ padding:"12px 16px 14px", borderBottom:`0.5px solid ${T.border}` }}>
          <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:4 }}>Forged @handle</div>
          <div style={{ fontSize:12, color:T.sub, lineHeight:1.55, marginBottom:10 }}>
            Optional. Friends can send you a request with this username instead of your email. Letters, numbers, and underscore only (3–20 characters).
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:14, color:T.muted, flexShrink:0 }}>@</span>
            <input
              value={handleDraft}
              onChange={e => { setHandleDraft(e.target.value.replace(/\s/g, "")); setHandleErr(""); setHandleSaved(false); }}
              placeholder="your_handle"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ flex:1, minWidth:120, ...inp, marginBottom:0 }}
            />
            <button
              type="button"
              onClick={() => {
                const t = handleDraft.trim().replace(/^@+/, "").toLowerCase();
                if (t && (t.length < 3 || t.length > 20 || !/^[a-z0-9_]+$/.test(t))) {
                  setHandleErr("Use 3–20 characters: a–z, 0–9, or _");
                  return;
                }
                setHandleErr("");
                onUpdateUser({ username: t || "" });
                setHandleSaved(true);
                setTimeout(() => setHandleSaved(false), 2000);
              }}
              style={{ padding:"10px 14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}
            >
              Save handle
            </button>
          </div>
          {handleErr ? <div style={{ fontSize:12, color:"#e05c5c", marginTop:8 }}>{handleErr}</div> : null}
          {handleSaved && !handleErr ? <div style={{ fontSize:12, color:T.green, marginTop:8 }}>Saved.</div> : null}
        </div>
        <div style={{ padding:"14px 16px 16px", display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.text }}>Visible to friends of friends</div>
            <div style={{ fontSize:12, color:T.sub, marginTop:4, lineHeight:1.5 }}>
              Off: only people you’re friends with see you on social surfaces. On: lightweight discovery later (e.g. mutual connections) can include you — direct friends always see you either way.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onUpdateUser({ visibleToFriendsOfFriends: !user.visibleToFriendsOfFriends })}
            style={{
              flexShrink:0, width:48, height:28, borderRadius:14, border:"none",
              background: user.visibleToFriendsOfFriends ? T.gold : T.border,
              cursor:"pointer", position:"relative", transition:"background 0.2s", padding:0,
            }}
            aria-label={user.visibleToFriendsOfFriends ? "Disable friends-of-friends visibility" : "Enable friends-of-friends visibility"}
          >
            <div style={{
              position:"absolute", top:3,
              left: user.visibleToFriendsOfFriends ? "calc(100% - 25px)" : 3,
              width:22, height:22, borderRadius:"50%",
              background:"#fff", transition:"left 0.2s",
              boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
            }}/>
          </button>
        </div>
      </div>

      {/* Pro section */}
      <div data-tour="profile-upgrade" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid rgba(200,144,42,0.3)`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontSize:10, fontWeight:500, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em" }}>Forged Pro</div>
          {isPro && <div style={{ fontSize:10, color:T.green, fontWeight:600, background:T.green+"18", padding:"2px 8px", borderRadius:10 }}>✓ Active</div>}
        </div>
        <div style={{ padding:"4px 16px 16px" }}>
          {isPro ? (
            <div style={{ fontSize:14, color:T.text, lineHeight:1.6 }}>
              You're on Forged Pro — unlimited AI coaching, full history, and everything we ship next. 🙌<br/>
              <span style={{ fontSize:12, color:T.muted }}>AI coach, voice logging, friend nudges, and full history are all unlocked.</span>
              {stripeCustomerId ? (
                <button
                  type="button"
                  disabled={portalLoading}
                  onClick={async () => {
                    setPortalLoading(true);
                    try {
                      const res = await fetch("/api/create-portal-session", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`,
                        },
                        body: "{}",
                      });
                      const json = await res.json().catch(() => ({}));
                      if (res.ok && json.url) window.location.href = json.url;
                      else window.alert(json.error || "Couldn't open billing — try again or email support.");
                    } catch {
                      window.alert("Couldn't connect — try again.");
                    } finally {
                      setPortalLoading(false);
                    }
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 14,
                    padding: "11px 14px",
                    borderRadius: T.rsm,
                    border: `0.5px solid rgba(200,144,42,0.45)`,
                    background: "rgba(200,144,42,0.10)",
                    color: T.gold,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: portalLoading ? "wait" : "pointer",
                    opacity: portalLoading ? 0.75 : 1,
                  }}
                >
                  {portalLoading ? "Opening billing…" : "Manage subscription & billing →"}
                </button>
              ) : (
                <div style={{ fontSize:11, color:T.hint, marginTop:12, lineHeight:1.5 }}>
                  Billing portal links to Stripe after checkout records your customer. If you should have access here, refresh or contact support.
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
                {[
                  { label:"Unlimited habits",            status:"pro" },
                  { label:"Unlimited AI coach messages", status:"pro" },
                  { label:"Voice logging",               status:"pro" },
                  { label:"Nudge friends to stay on track", status:"pro" },
                  { label:"Full history & monthly calendar", status:"pro" },
                  { label:"AI pattern detection",        status:"pro" },
                  { label:"Push notification reminders", status:"pro" },
                ].map((f, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:18, height:18, borderRadius:"50%", background:f.status==="soon"?T.surface:"rgba(200,144,42,0.15)", border:`1px solid ${f.status==="soon"?T.border:"rgba(200,144,42,0.4)"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      {f.status==="pro" && <span style={{ fontSize:9, color:T.gold, fontWeight:700 }}>P</span>}
                    </div>
                    <span style={{ fontSize:13, color:f.status==="soon"?T.muted:T.text }}>{f.label}</span>
                    {f.status==="soon" && <span style={{ fontSize:10, color:T.hint, marginLeft:"auto", letterSpacing:"0.06em", textTransform:"uppercase" }}>Soon</span>}
                    {f.status==="pro" && <span style={{ fontSize:10, color:T.gold, marginLeft:"auto", letterSpacing:"0.06em", textTransform:"uppercase" }}>Supporter</span>}
                  </div>
                ))}
              </div>
              <button onClick={onUpgrade} style={{ width:"100%", padding:"12px", borderRadius:T.rsm, border:"none", background:"rgba(200,144,42,0.15)", color:T.gold, fontSize:14, fontWeight:600, cursor:"pointer", letterSpacing:"0.01em" }}>
                Become an early supporter — $4.99/mo →
              </button>
              <div style={{ fontSize:11, color:T.hint, marginTop:8, textAlign:"center" }}>✦ Early users get this price locked in forever</div>
            </>
          )}
        </div>
      </div>

      {/* Early user feedback */}
      <div data-tour="profile-feedback" style={{ margin:"0 14px 12px", background:"rgba(200,144,42,0.07)", borderRadius:T.r, border:`0.5px solid rgba(200,144,42,0.25)`, padding:"16px 18px" }}>
        <div style={{ fontSize:11, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>⭐ Early user</div>
        <div style={{ fontSize:13, color:T.muted, lineHeight:1.65, marginBottom:12 }}>
          You're one of Forged's first users — thank you. Your feedback shapes what this becomes.
        </div>
        <button type="button" onClick={() => openForgedFeedbackMailto()}
          style={{ width:"100%", padding:"11px", borderRadius:T.rsm, border:`0.5px solid rgba(200,144,42,0.35)`, background:"none", color:T.gold, fontSize:13, fontWeight:500, cursor:"pointer", textAlign:"center" }}>
          Send quick feedback →
        </button>
      </div>

      {/* Refer a friend */}
      {refLink && (
        <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, padding:"16px 18px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ fontSize:10, fontWeight:600, color:T.muted, textTransform:"uppercase", letterSpacing:"0.08em" }}>Refer a friend</div>
            {refCount !== null && refCount > 0 && (
              <div style={{ fontSize:11, color:T.green, fontWeight:600, background:T.green+"18", padding:"2px 9px", borderRadius:10 }}>
                {refCount} joined
              </div>
            )}
          </div>
          <div style={{ fontSize:13, color:T.muted, lineHeight:1.6, marginBottom:14 }}>
            Share your link and every person you bring in helps lock in the beta price for everyone.
          </div>
          {/* Link display + copy */}
          <div style={{ display:"flex", gap:8, alignItems:"stretch" }}>
            <div style={{ flex:1, background:T.surface, border:`0.5px solid ${T.border}`, borderRadius:T.rsm, padding:"10px 12px", fontSize:12, color:T.hint, fontFamily:"monospace", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", letterSpacing:"0.03em" }}>
              {refLink.replace("https://", "")}
            </div>
            <button onClick={copyRefLink}
              style={{ flexShrink:0, padding:"10px 16px", borderRadius:T.rsm, border:"none", background:refCopied ? T.green+"22" : "rgba(255,255,255,0.07)", color:refCopied ? T.green : T.text, fontSize:13, fontWeight:500, cursor:"pointer", transition:"all 0.2s", whiteSpace:"nowrap" }}>
              {refCopied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          {/* Share via native share if available */}
          {typeof navigator.share === "function" && (
            <button onClick={() => navigator.share({ title:"Forged", text:"Track your habits seriously. No fluff.", url: refLink })}
              style={{ width:"100%", marginTop:8, padding:"11px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
              Share →
            </button>
          )}
          <div style={{ fontSize:11, color:T.hint, marginTop:10, textAlign:"center" }}>Your code: <span style={{ color:T.text, fontFamily:"monospace", letterSpacing:"0.1em" }}>{refCode}</span></div>
        </div>
      )}

      {/* Data */}
      <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        <div style={{ padding:"10px 16px 6px", fontSize:10, fontWeight:500, color:T.hint, textTransform:"uppercase", letterSpacing:"0.08em" }}>Data</div>
        <SRow label="Export my data" note="JSON" onPress={() => {
          const blob = new Blob([JSON.stringify({habits}, null, 2)], {type:"application/json"});
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
          a.download = "forged-data.json"; a.click();
        }}/>
        <SRow label="Version" note="0.2.0"/>
      </div>

      {/* Sign out */}
      {/* Dev tools — only shown to corbyn.miller2000@gmail.com, preview mode only (no data changes) */}
      {authEmail && authEmail.toLowerCase() === "corbyn.miller2000@gmail.com" && (
        <div style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.rsm, border:`0.5px solid ${T.border}`, padding:"12px 16px" }}>
          <div style={{ fontSize:10, color:T.hint, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Dev tools</div>
          <button onClick={onPreviewOnboarding}
            style={{ width:"100%", padding:"11px 0", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer", fontFamily:T.font, marginBottom:8 }}>
            Preview onboarding (safe — no data changes)
          </button>
          <button onClick={onReplayPageGuides}
            style={{ width:"100%", padding:"11px 0", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer", fontFamily:T.font, marginBottom:8 }}>
            Replay AI page tour (safe — no data changes)
          </button>
          <button onClick={onPreviewCoach}
            style={{ width:"100%", padding:"11px 0", borderRadius:T.rsm, border:`0.5px solid rgba(200,144,42,0.4)`, background:"none", color:T.gold, fontSize:13, cursor:"pointer", fontFamily:T.font }}>
            Preview coach workspace →
          </button>
        </div>
      )}

      <div data-tour="profile-signout" style={{ margin:"0 14px 12px", background:T.raised, borderRadius:T.r, border:`0.5px solid ${T.border}`, overflow:"hidden" }}>
        {showSignOutConfirm ? (
          <div style={{ padding:"14px 16px" }}>
            <div style={{ fontSize:14, color:T.text, marginBottom:12 }}>Sign out of Forged?</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowSignOutConfirm(false)} style={{ flex:1, padding:10, borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>Cancel</button>
              <button onClick={onSignOut} style={{ flex:1, padding:10, borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:500, cursor:"pointer" }}>Sign out</button>
            </div>
          </div>
        ) : (
          <SRow label="Sign out" destructive onPress={() => setShowSignOutConfirm(true)}/>
        )}
      </div>

      {showCoachSheet && (
        <CoachSettingsSheet
          initialName={coachName}
          initialIcon={coachIcon}
          onClose={() => setShowCoachSheet(false)}
          onSave={onSaveCoach}
        />
      )}

      <div style={{ height:20 }}/>
    </div>
  );
}
