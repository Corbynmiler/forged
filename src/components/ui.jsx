// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────
import { useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { T } from '../theme.js';
import { supabase } from '../supabase.js';
import { useScrollLock } from "../hooks/useScrollLock.js";

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────────
export function Particle({ x, y, color, angle, dist, onDone }) {
  const dx = Math.cos((angle * Math.PI) / 180) * dist;
  const dy = Math.sin((angle * Math.PI) / 180) * dist;
  useEffect(() => { const t = setTimeout(onDone, 600); return () => clearTimeout(t); }, []);
  return <div style={{
    position:"fixed", left:x-4, top:y-4, width:7, height:7,
    borderRadius:"50%", background:color, pointerEvents:"none", zIndex:9999,
    animation:"burst 0.55s ease-out forwards", "--dx":dx+"px", "--dy":dy+"px",
  }}/>;
}
export function XPFlash({ x, y, text, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 950); return () => clearTimeout(t); }, []);
  return <div style={{
    position:"fixed", left:x-18, top:y-14, zIndex:9999,
    fontSize:13, fontWeight:500, color:T.goldBright,
    pointerEvents:"none", animation:"xpUp 0.95s ease-out forwards",
  }}>{text}</div>;
}
export function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, []);
  return <div style={{
    position:"fixed", bottom:92, left:"50%", transform:"translateX(-50%)",
    zIndex:9999, background:T.raised, border:`0.5px solid ${T.borderStrong}`,
    borderRadius:T.rsm, padding:"10px 18px", fontSize:13, color:T.text,
    whiteSpace:"nowrap", animation:"toastSlide 0.3s ease-out",
    boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
  }}>{msg}</div>;
}
export function Ring({ pct, size = 88 }) {
  const r = size * 0.4, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth="6" stroke={T.surface}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth="6"
          stroke={pct === 100 ? T.goldBright : T.accent} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
          style={{ transition:"stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:16, fontWeight:500, color:T.text }}>{pct}%</span>
        <span style={{ fontSize:9, color:T.muted, letterSpacing:"0.05em", textTransform:"uppercase" }}>forged</span>
      </div>
    </div>
  );
}
export function SLabel({ children }) {
  return <div style={{ padding:"6px 18px 8px", fontSize:11, fontWeight:600, letterSpacing:"0.08em", color:T.sub, textTransform:"uppercase" }}>{children}</div>;
}
export function Stat({ label, value, color }) {
  return (
    <div style={{ background:T.surface, borderRadius:8, padding:"8px 10px", textAlign:"center", flex:1 }}>
      <div style={{ fontSize:15, fontWeight:500, color:color||T.text }}>{value}</div>
      <div style={{ fontSize:10, color:T.hint, marginTop:2, lineHeight:1.3 }}>{label}</div>
    </div>
  );
}
function ModalBackdrop({ onClose, children }) {
  useScrollLock(true);
  return (
    <div
      style={{
        position:"fixed", inset:0, width:"100%", minHeight:"100dvh",
        background:"rgba(0,0,0,0.75)", zIndex:10000, display:"flex", alignItems:"flex-end", justifyContent:"center",
        overscrollBehavior:"contain", touchAction:"none",
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}
export function Modal({ children, onClose }) {
  return createPortal(
    (
      <ModalBackdrop onClose={onClose}>
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width:430, maxWidth:"100%", maxHeight:"min(92dvh, 92vh)", overflowY:"auto",
            WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y",
            background:T.raised, borderRadius:"22px 22px 0 0", padding:"0 20px 60px", boxSizing:"border-box",
          }}
        >
          <div style={{ width:36, height:4, background:T.borderStrong, borderRadius:2, margin:"14px auto 22px" }}/>
          {children}
        </div>
      </ModalBackdrop>
    ),
    document.body
  );
}
export const lbl = { fontSize:10, fontWeight:500, color:T.muted, marginBottom:7, display:"block", textTransform:"uppercase", letterSpacing:"0.07em" };
export const inp = { width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm, background:T.surface, padding:"10px 12px", fontSize:16, color:T.text, outline:"none", boxSizing:"border-box" };
export function FG({ label, children, mb = 20 }) {
  return <div style={{ marginBottom:mb }}><label style={lbl}>{label}</label>{children}</div>;
}
export function PBtn({ onClick, children, color }) {
  return <button onClick={onClick} style={{ width:"100%", padding:14, borderRadius:T.rsm, border:"none", background:color||T.accent, color:"#fff", fontSize:15, fontWeight:500, cursor:"pointer", marginTop:10 }}>{children}</button>;
}
export function GBtn({ onClick, children }) {
  return <button onClick={onClick} style={{ width:"100%", padding:12, borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:14, cursor:"pointer", marginTop:8 }}>{children}</button>;
}
export function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width:44, height:24, borderRadius:12, border:"none", cursor:"pointer", background:on?T.accent:T.surface, position:"relative", transition:"background 0.2s", flexShrink:0 }}>
      <div style={{ position:"absolute", top:3, left:on?22:3, width:18, height:18, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }}/>
    </button>
  );
}

// ─── DONE BANNER ─────────────────────────────────────────────────────────────
export function DoneBanner({ habit }) {
  return (
    <div style={{ margin:"0 15px 12px", background:`${habit.color}18`, borderRadius:T.rsm, padding:"8px 12px", display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ width:20, height:20, borderRadius:"50%", background:habit.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M2 5.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <span style={{ fontSize:12, fontWeight:500, color:habit.color }}>Logged for today</span>
    </div>
  );
}

// ─── TOUR OVERLAY ─────────────────────────────────────────────────────────────
export function TourOverlay({ steps, stepIdx, onNext, onSkip }) {
  useScrollLock(true);
  const [rect, setRect] = useState(null);
  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  // Steps that don't count as "welcome" in the progress bar
  const progressSteps = steps.filter(s => !s.welcome);
  const progressIdx   = stepIdx - steps.filter((s, i) => s.welcome && i < stepIdx).length;

  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    } else {
      setRect(null);
    }
  }, [stepIdx, step?.target]);

  const PAD = step?.pad ?? 8;
  const hl = rect ? {
    top:    rect.top    - PAD,
    left:   rect.left   - PAD,
    width:  rect.width  + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  // Auto-detect callout position: element in bottom 45% → show callout near top
  let calloutPos = step?.callout;
  if (!calloutPos) {
    if (!rect || step?.welcome) calloutPos = "center";
    else calloutPos = (rect.top + rect.height / 2) > window.innerHeight * 0.55 ? "top" : "bottom";
  }

  const calloutStyle =
    calloutPos === "top"    ? { top: 64, left: "50%", transform: "translateX(-50%)" } :
    calloutPos === "center" ? { top: "50%", left: "50%", transform: "translate(-50%,-50%)" } :
                              { bottom: 32, left: "50%", transform: "translateX(-50%)" };

  // Welcome card — special full-screen layout for the first global step
  if (step?.welcome) {
    return (
      <div style={{ position:"fixed", inset:0, minHeight:"100dvh", zIndex:600, background:"rgba(0,0,0,0.88)", display:"flex", alignItems:"center", justifyContent:"center", padding:20, overscrollBehavior:"contain", touchAction:"none" }}>
        <div style={{ width:360, maxWidth:"calc(100vw - 24px)", background:T.raised, borderRadius:22, padding:"32px 24px 28px", boxShadow:"0 12px 48px rgba(0,0,0,0.6)" }}>
          <div style={{ fontSize:36, marginBottom:16, textAlign:"center" }}>⚒️</div>
          <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, marginBottom:10, textAlign:"center" }}>{step.title}</div>
          <div style={{ fontSize:14, color:T.muted, lineHeight:1.7, marginBottom:28, textAlign:"center" }}>{step.body}</div>
          <button onClick={onNext}
            style={{ width:"100%", padding:"14px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:500, cursor:"pointer", marginBottom:10 }}>
            Show me around →
          </button>
          <button onClick={onSkip}
            style={{ width:"100%", padding:"10px", borderRadius:T.rsm, border:"none", background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", zIndex:600, overscrollBehavior:"contain", touchAction:"none" }} onMouseDown={e => e.stopPropagation()}>
      {/* Spotlight */}
      {hl ? (
        <div style={{
          position:"fixed",
          top: hl.top, left: hl.left, width: hl.width, height: hl.height,
          borderRadius: step?.radius ?? 14,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.82)",
          border: "1.5px solid rgba(200,144,42,0.6)",
          pointerEvents: "none",
          zIndex: 601,
          transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
        }}/>
      ) : (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", pointerEvents:"none", zIndex:601 }}/>
      )}

      {/* Callout card */}
      <div style={{
        position:"fixed", ...calloutStyle,
        width:340, maxWidth:"calc(100vw - 24px)",
        background:T.raised, borderRadius:18,
        padding:"18px 20px 20px",
        zIndex:602,
        boxShadow:"0 8px 40px rgba(0,0,0,0.55)",
      }}>
        {/* Progress dots */}
        {progressSteps.length > 1 && (
          <div style={{ display:"flex", gap:4, marginBottom:14 }}>
            {progressSteps.map((_, i) => (
              <div key={i} style={{ height:3, flex:1, borderRadius:2, background:i<=progressIdx?T.accent:T.surface, transition:"background 0.2s" }}/>
            ))}
          </div>
        )}
        <div style={{ fontFamily:T.serif, fontSize:20, color:T.text, marginBottom:7 }}>{step.title}</div>
        <div style={{ fontSize:13, color:T.muted, lineHeight:1.65, marginBottom:16 }}>{step.body}</div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onSkip}
            style={{ flex:1, padding:"10px", borderRadius:T.rsm, border:`0.5px solid ${T.borderStrong}`, background:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
            {progressSteps.length > 1 ? "Skip" : "Done"}
          </button>
          <button onClick={onNext}
            style={{ flex:2, padding:"10px", borderRadius:T.rsm, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:500, cursor:"pointer" }}>
            {isLast ? "Got it 🔥" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TOGGLE SWITCH ────────────────────────────────────────────────────────────
export function ToggleSwitch({ on, onClick, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{
        flexShrink:0, width:48, height:28, borderRadius:14, border:"none",
        background: on ? T.gold : T.border,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        position:"relative", transition:"background 0.2s", padding:0,
      }}
    >
      <div style={{
        position:"absolute", top:3,
        left: on ? "calc(100% - 25px)" : 3,
        width:22, height:22, borderRadius:"50%",
        background:"#fff", transition:"left 0.2s",
        boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
      }}/>
    </button>
  );
}

// One row inside the notification-categories panel. Three of these stack
// inside the dark sub-card on Profile.
export function NotifCategoryRow({ emoji, title, subtitle, checked, onChange, disabled, noBorderBottom }) {
  return (
    <div
      style={{
        display:"flex", alignItems:"center", gap:12,
        padding:"12px 14px",
        borderBottom: noBorderBottom ? "none" : `0.5px solid rgba(255,255,255,0.04)`,
      }}
    >
      <span style={{ fontSize:18, width:24, textAlign:"center", flexShrink:0 }} aria-hidden>{emoji}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13.5, fontWeight:600, color:T.text }}>{title}</div>
        <div style={{ fontSize:11.5, color:T.muted, marginTop:1, lineHeight:1.35 }}>{subtitle}</div>
      </div>
      <ToggleSwitch
        on={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        ariaLabel={`${checked ? "Disable" : "Enable"} ${title}`}
      />
    </div>
  );
}

/** Shown in Profile for users who don't have a coach yet. Lets them enter a
 *  coach code (8 hex chars, e.g. ABCD-1234) to link to an existing coach. */
export function JoinCoachSection({ onLinked }) {
  const [code,    setCode]    = useState("");
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState("");
  const [success, setSuccess] = useState(null); // { coachName }
  const [open,    setOpen]    = useState(false);

  function formatCode(raw) {
    const clean = raw.replace(/[^a-fA-F0-9]/g, "").toUpperCase().slice(0, 8);
    return clean.length > 4 ? `${clean.slice(0,4)}-${clean.slice(4)}` : clean;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const clean = code.replace(/-/g, "").toLowerCase();
    if (clean.length < 6) { setErr("Code too short — try again"); return; }
    setBusy(true); setErr("");
    try {
      // Look up the coach by UUID prefix
      const { data: coaches, error: lookupErr } = await supabase
        .from("profiles")
        .select("id, name")
        .or("is_coach.eq.true,coach_tier.not.is.null")
        .ilike("id", `${clean}%`)
        .limit(1);
      if (lookupErr) throw new Error(lookupErr.message);
      if (!coaches || coaches.length === 0) { setErr("Code not found — double-check and try again"); setBusy(false); return; }
      const coach = coaches[0];
      // Link via the existing accept-coach-invite endpoint
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/accept-coach-invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ coach: btoa(coach.id) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to link");
      setSuccess({ coachName: coach.name });
      onLinked?.(coach.id, coach.name);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div style={{
        margin:"0 14px 12px",
        background:"linear-gradient(145deg, rgba(39,174,96,0.07), rgba(39,174,96,0.02))",
        border:`1px solid rgba(39,174,96,0.28)`, borderRadius:14, padding:"14px 16px",
      }}>
        <div style={{ fontSize:10, fontWeight:700, color:"#27AE60", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Coaching</div>
        <div style={{ fontSize:15, fontWeight:600, color:T.text, marginBottom:4 }}>Connected to {success.coachName}</div>
        <div style={{ fontSize:12, color:T.muted, lineHeight:1.6 }}>Your coach can now see your habits and notes. You&apos;ve also been upgraded to Forged Pro.</div>
      </div>
    );
  }

  if (!open) {
    return (
      <div style={{ margin:"0 14px 12px" }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            width:"100%", padding:"12px 16px", borderRadius:12, border:`1px solid ${T.border}`,
            background:T.surface, color:T.muted, fontSize:13, cursor:"pointer",
            fontFamily:T.font, textAlign:"left", display:"flex", alignItems:"center", justifyContent:"space-between",
          }}
        >
          <span>Join a coach</span>
          <span style={{ fontSize:18, color:T.hint }}>›</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ margin:"0 14px 12px", background:T.raised, border:`0.5px solid ${T.border}`, borderRadius:14, padding:"14px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ fontSize:14, fontWeight:600, color:T.text }}>Join a coach</div>
        <button type="button" onClick={() => { setOpen(false); setErr(""); setCode(""); }}
          style={{ background:"none", border:"none", color:T.muted, fontSize:18, cursor:"pointer", lineHeight:1 }}>×</button>
      </div>
      <div style={{ fontSize:12, color:T.muted, lineHeight:1.65, marginBottom:14 }}>
        Enter the 8-character coach code your coach shared with you. You&apos;ll be linked instantly and upgraded to Pro.
      </div>
      <form onSubmit={handleSubmit}>
        <input
          value={code}
          onChange={e => { setCode(formatCode(e.target.value)); setErr(""); }}
          placeholder="ABCD-1234"
          maxLength={9}
          style={{
            width:"100%", padding:"11px 14px", borderRadius:10, fontSize:18, fontWeight:700,
            letterSpacing:"0.12em", textAlign:"center", fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",
            background:T.surface, border:`1px solid ${err ? "#E74C3C" : T.border}`,
            color:T.text, outline:"none", boxSizing:"border-box", marginBottom:err ? 6 : 12,
          }}
          autoCapitalize="characters"
          autoComplete="off"
        />
        {err && <div style={{ fontSize:12, color:"#E74C3C", marginBottom:10, textAlign:"center" }}>{err}</div>}
        <button
          type="submit"
          disabled={busy || code.replace(/-/g,"").length < 6}
          style={{
            width:"100%", padding:"12px 0", borderRadius:10, border:"none",
            background: (busy || code.replace(/-/g,"").length < 6) ? "rgba(255,255,255,0.07)" : T.gold,
            color: (busy || code.replace(/-/g,"").length < 6) ? T.muted : "#1a1a16",
            fontSize:14, fontWeight:700, fontFamily:T.font,
            cursor: (busy || code.replace(/-/g,"").length < 6) ? "default" : "pointer",
            transition:"background 0.2s, color 0.2s",
          }}
        >
          {busy ? "Connecting…" : "Connect to coach"}
        </button>
      </form>
    </div>
  );
}

// ─── COACH DASHBOARD COMPONENTS ───────────────────────────────────────────────
export function ActivityDots({ last7, size = 9 }) {
  return (
    <div style={{ display:"flex", gap:3 }}>
      {(last7 || []).map((d, i) => (
        <div
          key={i}
          title={d.date}
          style={{
            width:size, height:size, borderRadius:2,
            background: d.logged ? "#27AE60" : d.skip ? "rgba(200,144,42,0.45)" : "rgba(255,255,255,0.08)",
          }}
        />
      ))}
    </div>
  );
}

// Thin progress bar — today's completion ratio
export function CompletionBar({ done, total }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  const bar = done === total ? "#27AE60" : done > 0 ? T.gold : "rgba(255,255,255,0.08)";
  return (
    <div style={{ marginTop:6, height:3, background:"rgba(255,255,255,0.06)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ width:`${pct}%`, height:"100%", background:bar, borderRadius:2, transition:"width 0.4s" }} />
    </div>
  );
}
