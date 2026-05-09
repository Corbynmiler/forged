import { useState } from "react";
import { T, cssPadTopSafe, cssPadBottomSafe, cssPadXSafe } from "../theme.js";
import { supabase } from "../supabase.js";
import { openForgedFeedbackMailto } from "../utils.js";
import { useScrollLock } from "../hooks/useScrollLock.js";

// ─── AUTH SCREENS ─────────────────────────────────────────────────────────────
const authInp = { width:"100%", border:`0.5px solid ${T.borderStrong}`, borderRadius:T.rsm, background:T.surface, padding:"14px 16px", fontSize:16, color:T.text, outline:"none", boxSizing:"border-box", marginBottom:10 };

export function SetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);

  async function handleSave() {
    if (!password || password !== confirm || loading) return;
    setLoading(true); setError("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }
    setDone(true);
    setTimeout(onDone, 2000);
  }

  return (
    <div style={{
      fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100dvh",
      background:`radial-gradient(ellipse 380px 320px at 50% 38%, rgba(200,144,42,0.08) 0%, transparent 65%), ${T.bg}`,
      display:"flex", flexDirection:"column", justifyContent:"center",
      paddingTop: cssPadTopSafe(24), paddingBottom: cssPadBottomSafe(24), ...cssPadXSafe(28),
    }}>
      <div style={{ textAlign:"center", marginBottom:32 }}>
        <img
          src="/logo-icon.png"
          alt="Forged"
          style={{
            width:148, height:148,
            display:"block",
            margin:"0 auto",
            filter:"drop-shadow(0 2px 36px rgba(200,144,42,0.22))",
          }}
        />
        <div style={{ fontFamily:T.serif, fontSize:34, color:T.text, marginTop:16, letterSpacing:"0.01em" }}>
          Forged.
        </div>
      </div>
      {done ? (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>✓</div>
          <div style={{ fontFamily:T.serif, fontSize:22, color:T.green }}>Password updated</div>
          <div style={{ fontSize:14, color:T.muted, marginTop:10 }}>Signing you in…</div>
        </div>
      ) : (
        <>
          <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, marginBottom:8 }}>Set new password</div>
          <div style={{ fontSize:14, color:T.muted, marginBottom:24 }}>Choose something you'll remember.</div>
          <input type="password" placeholder="New password" autoFocus
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()} style={authInp}/>
          <input type="password" placeholder="Confirm password"
            value={confirm} onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()} style={authInp}/>
          {password && confirm && password !== confirm && (
            <div style={{ fontSize:13, color:T.accent, marginBottom:10 }}>Passwords don't match</div>
          )}
          {error && <div style={{ fontSize:13, color:T.accent, marginBottom:10 }}>{error}</div>}
          <button onClick={handleSave} disabled={!password || password !== confirm || loading}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", fontSize:16, fontWeight:500, cursor:"pointer", transition:"all 0.2s",
              background: password && password === confirm && !loading ? T.accent : T.surface,
              color: password && password === confirm && !loading ? "#fff" : T.muted }}>
            {loading ? "…" : "Save password"}
          </button>
        </>
      )}
    </div>
  );
}

export function AuthScreen({ onSent, checkoutPending, onCoachSignupIntent }) {
  const [mode,       setMode]       = useState("signin"); // "signin" | "signup" | "forgot"
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  async function handleSubmit() {
    if (loading) return;
    // Fall back to reading DOM values directly — browser autofill often populates
    // the DOM without firing React's onChange, leaving state empty.
    const emailEl = document.querySelector('input[type="email"]');
    const passEl  = document.querySelector('input[type="password"]');
    const e = (email.trim() || emailEl?.value?.trim() || "");
    const p = (password     || passEl?.value          || "");
    if (!e || !p) return;
    // Sync state so UI reflects what we're submitting
    if (!email.trim()) setEmail(e);
    if (!password)     setPassword(p);
    setLoading(true); setError("");
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email: e, password: p, options: { emailRedirectTo: window.location.origin } });
      if (error) {
        // "User already registered" — silently switch to sign-in instead of showing an error
        const alreadyExists = error.message?.toLowerCase().includes("already registered")
          || error.message?.toLowerCase().includes("already exists")
          || error.code === "user_already_exists";
        if (alreadyExists) {
          setMode("signin");
          setError("You already have an account — enter your password to sign in.");
          setLoading(false);
          return;
        }
        setError(error.message);
        setLoading(false);
        return;
      }
      onSent(e);
      setLoading(false);
    } else {
      // Always default to signInWithPassword — never auto-create
      const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
      if (error) {
        // Supabase returns "Invalid login credentials" for both wrong password AND
        // non-existent user — give a clearer message
        const msg = error.message.toLowerCase().includes("invalid login")
          ? "Incorrect email or password. Check your details and try again."
          : error.message;
        setError(msg);
        setLoading(false);
        return;
      }
      // signInWithPassword succeeded — onAuthStateChange(SIGNED_IN) will take it from here
      setLoading(false);
    }
  }

  async function handleForgot() {
    const e = email.trim();
    if (!e || loading) return;
    setLoading(true); setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: window.location.origin });
    if (error) { setError(error.message); setLoading(false); return; }
    setLoading(false);
    setForgotSent(true);
  }

  const wrap = {
    fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100dvh",
    background:`radial-gradient(ellipse 380px 320px at 50% 38%, rgba(200,144,42,0.08) 0%, transparent 65%), ${T.bg}`,
    display:"flex", flexDirection:"column", justifyContent:"center",
    paddingTop: cssPadTopSafe(24), paddingBottom: cssPadBottomSafe(24), ...cssPadXSafe(28),
  };

  // ── Forgot password view ──────────────────────────────────────────────
  if (mode === "forgot") return (
    <div style={wrap}>
      <div style={{ textAlign:"center", marginBottom:36 }}>
        <img
          src="/logo-icon.png"
          alt="Forged"
          style={{
            width:148, height:148,
            display:"block",
            margin:"0 auto",
            filter:"drop-shadow(0 2px 36px rgba(200,144,42,0.22))",
          }}
        />
        <div style={{ fontFamily:T.serif, fontSize:34, color:T.text, marginTop:16, letterSpacing:"0.01em" }}>
          Forged.
        </div>
      </div>
      {forgotSent ? (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📧</div>
          <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:12 }}>Check your inbox</div>
          <div style={{ fontSize:14, color:T.muted, lineHeight:1.8, marginBottom:32 }}>
            Sent a reset link to<br/>
            <span style={{ color:T.text, fontWeight:500 }}>{email}</span><br/><br/>
            Click it, set a new password, then come back and sign in.
          </div>
          <button onClick={() => { setMode("signin"); setForgotSent(false); setError(""); }}
            style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
            ← Back to sign in
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, marginBottom:8 }}>Reset password</div>
          <div style={{ fontSize:14, color:T.muted, marginBottom:24, lineHeight:1.6 }}>Enter your email and we'll send a reset link.</div>
          <input type="email" placeholder="you@example.com" autoFocus
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleForgot()}
            style={authInp}
          />
          {error && <div style={{ fontSize:13, color:T.accent, marginBottom:10 }}>{error}</div>}
          <button onClick={handleForgot} disabled={!email.trim() || loading}
            style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:email.trim()&&!loading?T.accent:T.surface, color:email.trim()&&!loading?"#fff":T.muted, fontSize:16, fontWeight:500, cursor:email.trim()&&!loading?"pointer":"default", transition:"all 0.2s" }}>
            {loading ? "…" : "Send reset link"}
          </button>
          <button onClick={() => { setMode("signin"); setError(""); }}
            style={{ width:"100%", padding:12, background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", marginTop:4 }}>
            ← Back to sign in
          </button>
        </>
      )}
    </div>
  );

  // ── Sign in / Sign up view ────────────────────────────────────────────
  // Note: "ready" only drives button styling — handleSubmit reads DOM values
  // as fallback so browser autofill always works even if React state is empty.
  const ready = (email.trim() || false) && (password || false) && !loading;
  return (
    <div style={wrap}>
      {/* Logo + brand header */}
      <div style={{ textAlign:"center", marginBottom:36 }}>
        <img
          src="/logo-icon.png"
          alt="Forged"
          style={{
            width:148, height:148,
            display:"block",
            margin:"0 auto",
            filter:"drop-shadow(0 2px 36px rgba(200,144,42,0.22))",
          }}
        />
        <div style={{ fontFamily:T.serif, fontSize:34, color:T.text, marginTop:16, letterSpacing:"0.01em" }}>
          Forged.
        </div>
        <div style={{ fontSize:13, color:T.muted, marginTop:6, letterSpacing:"0.03em" }}>
          {mode === "signin" ? "Welcome back." : "Build the life you intend."}
        </div>
      </div>
      {checkoutPending && (
        <div style={{ background:"rgba(200,144,42,0.12)", border:"0.5px solid rgba(200,144,42,0.35)", borderRadius:10, padding:"12px 16px", marginBottom:20, fontSize:13, color:"#C8902A", lineHeight:1.6 }}>
          ✓ Payment received — sign in to access your account.
        </div>
      )}
      <input type="email" placeholder="you@example.com" autoFocus
        value={email}
        onChange={e => setEmail(e.target.value)}
        onInput={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSubmit()}
        style={authInp}
      />
      <input type="password" placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        onInput={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSubmit()}
        style={authInp}
      />
      {/* Cosmetic only — Supabase already persists sessions (persistSession: true). */}
      <label style={{
        display:"flex", alignItems:"flex-start", gap:10,
        marginTop:2, marginBottom:14,
        padding:"10px 12px",
        borderRadius:T.rsm,
        border:`0.5px solid ${T.border}`,
        background:"rgba(255,255,255,0.03)",
        cursor:"pointer",
      }}>
        <input
          type="checkbox"
          checked
          readOnly
          style={{
            marginTop:3,
            width:15,
            height:15,
            accentColor:T.gold,
            flexShrink:0,
            cursor:"pointer",
          }}
        />
        <span style={{ fontSize:12, color:T.sub, lineHeight:1.55 }}>
          <span style={{ color:T.text, fontWeight:600 }}>Remember me</span>
          <span style={{ color:T.muted }}> — stay signed in on this device</span>
        </span>
      </label>
      {error && <div style={{ fontSize:14, color:"#e74c3c", background:"rgba(231,76,60,0.1)", border:"1px solid rgba(231,76,60,0.3)", borderRadius:T.rsm, padding:"10px 14px", marginBottom:12 }}>{error}</div>}
      <button onClick={handleSubmit}
        style={{ width:"100%", padding:16, borderRadius:T.rsm, border:"none", background:!loading?T.accent:T.surface, color:!loading?"#fff":T.muted, fontSize:16, fontWeight:500, cursor:!loading?"pointer":"default", transition:"all 0.2s" }}>
        {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      {/* Secondary actions — kept small so users can't accidentally switch mode */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16 }}>
        {mode === "signin" ? (
          <>
            <button onClick={() => { setMode("forgot"); setError(""); setForgotSent(false); }}
              style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:0 }}>
              Forgot password?
            </button>
            <button onClick={() => { setMode("signup"); setError(""); }}
              style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:0 }}>
              New here? Create account
            </button>
          </>
        ) : (
          <button onClick={() => { setMode("signin"); setError(""); }}
            style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer", padding:0, width:"100%", textAlign:"center" }}>
            ← Already have an account? Sign in
          </button>
        )}
      </div>
      {typeof onCoachSignupIntent === "function" && (
        <div style={{ marginTop:32, borderTop:`0.5px solid ${T.border}`, paddingTop:24 }}>
          <div style={{ fontSize:11, color:T.hint, textAlign:"center", marginBottom:12, lineHeight:1.5 }}>
            Running 1:1 clients? See their habits before every session.
          </div>
          <button
            type="button"
            onClick={onCoachSignupIntent}
            style={{
              width:"100%", padding:"13px 16px", borderRadius:T.rsm,
              border:`1px solid rgba(200,144,42,0.45)`, background:"rgba(200,144,42,0.07)",
              color:T.gold, fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:T.font,
              letterSpacing:"0.01em",
            }}
          >
            Apply for Forged Coach — $49/mo →
          </button>
        </div>
      )}
    </div>
  );
}

export function CheckEmailScreen({ email, onBack }) {
  return (
    <div style={{
      fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100dvh",
      background:`radial-gradient(ellipse 380px 320px at 50% 38%, rgba(200,144,42,0.08) 0%, transparent 65%), ${T.bg}`,
      display:"flex", flexDirection:"column", justifyContent:"center", textAlign:"center",
      paddingTop: cssPadTopSafe(24), paddingBottom: cssPadBottomSafe(24), ...cssPadXSafe(28),
    }}>
      <img
        src="/logo-icon.png"
        alt="Forged"
        style={{
          width:96, height:96,
          display:"block",
          margin:"0 auto 10px",
          filter:"drop-shadow(0 2px 28px rgba(200,144,42,0.2))",
        }}
      />
      <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, marginBottom:28, letterSpacing:"0.01em" }}>
        Forged.
      </div>
      <div style={{ fontSize:48, marginBottom:20 }}>✉️</div>
      <div style={{ fontFamily:T.serif, fontSize:28, color:T.text, marginBottom:12 }}>Confirm your email</div>
      <div style={{ fontSize:14, color:T.muted, lineHeight:1.8, marginBottom:32 }}>
        We sent a confirmation link to<br/>
        <span style={{ color:T.text, fontWeight:500 }}>{email}</span><br/><br/>
        Tap it to activate your account, then come back and sign in.
      </div>
      <button onClick={onBack} style={{ background:"none", border:"none", color:T.muted, fontSize:13, cursor:"pointer" }}>
        ← Back to sign in
      </button>
    </div>
  );
}

// ─── DEMO BANNER ──────────────────────────────────────────────────────────────
export function DemoBanner({ onGetStarted }) {
  return (
    <div style={{
      position:"sticky", top:0, zIndex:200,
      background:"rgba(192,57,43,0.96)", backdropFilter:"blur(8px)",
      paddingTop: cssPadTopSafe(10), paddingBottom: 10, ...cssPadXSafe(18),
      display:"flex", alignItems:"center", justifyContent:"space-between", gap:10,
    }}>
      <div style={{ fontSize:13, color:"#fff", lineHeight:1.4, flex:1 }}>
        You're in preview — create an account to start for real.
      </div>
      <button onClick={onGetStarted}
        style={{ background:"#fff", border:"none", borderRadius:20, padding:"7px 16px", fontSize:13, fontWeight:600, color:"#C0392B", cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" }}>
        Get started
      </button>
    </div>
  );
}

// ─── BETA PAYWALL MODAL ───────────────────────────────────────────────────────
// Shown inline when a free user hits a gated feature. Never blocks the whole app.
export function BetaPaywallModal({ onClose }) {
  useScrollLock(true);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ plan: "monthly" }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Could not start checkout");
      localStorage.setItem('forged_checkout_pending', '1');
      window.location.href = json.url;
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.82)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:T.raised, borderRadius:20, border:`0.5px solid ${T.border}`, padding:"36px 28px 28px", maxWidth:360, width:"100%", textAlign:"center", touchAction:"auto", maxHeight:"min(90dvh, 90vh)", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <h2 style={{ fontFamily:T.serif, fontSize:24, color:T.text, margin:"0 0 14px", lineHeight:1.2 }}>
          Unlock Forged Pro.
        </h2>
        <p style={{ fontSize:14, color:T.sub, lineHeight:1.75, margin:"0 0 28px" }}>
          Unlimited AI coaching, unlimited habits, friend nudges, voice logging, and full history — <strong style={{ color:T.text }}>$4.99/month</strong>. Cancel anytime.
        </p>
        {error && <div style={{ fontSize:13, color:T.accent, marginBottom:12 }}>{error}</div>}
        <button onClick={handleCheckout} disabled={loading}
          style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:T.gold, color:"#0F0F0D", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, fontFamily:T.font, marginBottom:12, transition:"opacity 0.15s" }}>
          {loading ? "Opening checkout…" : "Unlock Forged Pro — $4.99/month"}
        </button>
        <button onClick={onClose}
          style={{ background:"none", border:"none", color:T.muted, fontSize:14, cursor:"pointer", padding:"4px 0" }}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─── WELCOME MODAL (shown once after successful beta payment) ─────────────────
export function WelcomeModal({ onContinue }) {
  useScrollLock(true);
  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.88)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px", overscrollBehavior:"contain", touchAction:"none" }}>
      <div style={{ background:"#1C1C18", borderRadius:20, border:"0.5px solid rgba(200,144,42,0.35)", padding:"40px 28px 32px", maxWidth:340, width:"100%", textAlign:"center", animation:"paywallIn 0.45s cubic-bezier(0.22,1,0.36,1) both", touchAction:"auto", maxHeight:"min(90dvh, 90vh)", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <div style={{ fontSize:48, marginBottom:20 }}>🔥</div>
        <div style={{ fontSize:11, fontWeight:600, color:"#C8902A", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Forged Pro unlocked</div>
        <h2 style={{ fontFamily:"'DM Serif Display',Georgia,serif", fontSize:28, color:"#F0EDE6", margin:"0 0 14px", lineHeight:1.2 }}>You're in.</h2>
        <p style={{ fontSize:14, color:"#A8A49C", lineHeight:1.75, margin:"0 0 28px" }}>
          Forged Pro is fully unlocked — unlimited AI coaching, full history, friend nudges, and everything we ship next. Now go build the thing.
        </p>
        <button
          onClick={onContinue}
          style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:"#C0392B", color:"#fff", fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}
        >
          Let's go →
        </button>
      </div>
    </div>
  );
}


function forgedBetaEmailOptInKey(userId) {
  return userId ? `forged_beta_email_opt_in:${userId}` : "forged_beta_email_opt_in";
}

function readForgedBetaEmailOptIn(userId) {
  return localStorage.getItem(forgedBetaEmailOptInKey(userId)) === "1";
}

function writeForgedBetaEmailOptIn(userId, on) {
  try {
    localStorage.setItem(forgedBetaEmailOptInKey(userId), on ? "1" : "0");
  } catch (_) { /* quota / private mode */ }
}

/** Snippet for profiles upsert/update — weekly product email opt-in (see migration weekly_updates_email_opt_in). */
function weeklyUpdatesEmailOptInRow(emailUpdatesOptIn) {
  if (typeof emailUpdatesOptIn !== "boolean") return {};
  return {
    weekly_updates_email_opt_in: emailUpdatesOptIn,
    weekly_updates_email_opt_in_at: emailUpdatesOptIn ? new Date().toISOString() : null,
  };
}

/** One short step after WelcomeModal — thanks, feedback CTA, weekly email opt-in (DB + localStorage). */
export function ProThankYouModal({ userId, onClose, onPersistWeeklyEmailOptIn }) {
  useScrollLock(true);
  const [betaUpdates, setBetaUpdates] = useState(() => readForgedBetaEmailOptIn(userId));

  function persistOptIn() {
    writeForgedBetaEmailOptIn(userId, betaUpdates);
    if (typeof onPersistWeeklyEmailOptIn === "function") {
      Promise.resolve(onPersistWeeklyEmailOptIn(betaUpdates)).catch(() => {});
    }
  }

  return (
    <div style={{ position:"fixed", inset:0, minHeight:"100dvh", background:"rgba(0,0,0,0.88)", zIndex:2001, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px", overscrollBehavior:"contain", touchAction:"none" }}
      onClick={e => e.target === e.currentTarget && (persistOptIn(), onClose())}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background:"#1C1C18", borderRadius:20, border:"0.5px solid rgba(200,144,42,0.35)", padding:"32px 26px 28px", maxWidth:340, width:"100%", textAlign:"center", animation:"paywallIn 0.45s cubic-bezier(0.22,1,0.36,1) both", touchAction:"auto", maxHeight:"min(90dvh, 90vh)", overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
        <div style={{ fontSize:11, fontWeight:600, color:"#C8902A", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Thank you</div>
        <h2 style={{ fontFamily:"'DM Serif Display',Georgia,serif", fontSize:22, color:"#F0EDE6", margin:"0 0 12px", lineHeight:1.25 }}>Thanks for backing the beta.</h2>
        <p style={{ fontSize:14, color:"#A8A49C", lineHeight:1.7, margin:"0 0 10px", textAlign:"left" }}>
          Tell us what would make Forged genuinely more useful for you.
        </p>
        <p style={{ fontSize:13, color:"#8A8680", lineHeight:1.65, margin:"0 0 22px", textAlign:"left" }}>
          If anything feels broken, confusing, or missing, we want to know.
        </p>

        <label style={{ display:"flex", alignItems:"flex-start", gap:10, cursor:"pointer", textAlign:"left", marginBottom:22, padding:"12px 14px", borderRadius:12, border:"0.5px solid rgba(200,144,42,0.2)", background:"rgba(200,144,42,0.06)" }}>
          <input
            type="checkbox"
            checked={betaUpdates}
            onChange={e => {
              const v = e.target.checked;
              setBetaUpdates(v);
              writeForgedBetaEmailOptIn(userId, v);
              if (typeof onPersistWeeklyEmailOptIn === "function") {
                Promise.resolve(onPersistWeeklyEmailOptIn(v)).catch(() => {});
              }
            }}
            style={{ marginTop:3, width:16, height:16, accentColor:"#C0392B", flexShrink:0, cursor:"pointer" }}
          />
          <span style={{ fontSize:12, color:"#C4C0B8", lineHeight:1.5 }}>
            <span style={{ color:"#E8E4DC", fontWeight:500 }}>Keep me updated</span>
            {" "}with Forged beta updates — occasional emails, not spam.
          </span>
        </label>

        <button
          type="button"
          onClick={() => { persistOptIn(); openForgedFeedbackMailto("I just unlocked Forged Pro."); onClose(); }}
          style={{ width:"100%", padding:"14px 0", borderRadius:12, border:"none", background:"#C0392B", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:10 }}
        >
          Send feedback
        </button>
        <button
          type="button"
          onClick={() => { persistOptIn(); onClose(); }}
          style={{ width:"100%", padding:"10px 0", borderRadius:12, border:"none", background:"none", color:"#8A8680", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─── PAYWALL SCREEN ───────────────────────────────────────────────────────────
export function PaywallScreen({ onPaid }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ plan: "monthly" }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Could not start checkout");
      localStorage.setItem('forged_checkout_pending', '1');
      window.location.href = json.url;
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily:T.font, maxWidth:430, margin:"0 auto", minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 28px" }}>
      <style>{`
        @keyframes paywallIn { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
      <div style={{ width:"100%", maxWidth:360, animation:"paywallIn 0.5s ease both" }}>
        {/* Wordmark */}
        <div style={{ fontFamily:T.serif, fontSize:22, color:T.text, marginBottom:32, textAlign:"center", letterSpacing:"0.01em" }}>Forged.</div>

        {/* Card */}
        <div style={{ background:T.surface, borderRadius:20, border:`0.5px solid ${T.border}`, padding:"32px 28px 28px", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:18 }}>⚡</div>

          <div style={{ fontSize:11, fontWeight:600, color:T.gold, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>
            Forged Pro
          </div>

          <h1 style={{ fontFamily:T.serif, fontSize:26, color:T.text, margin:"0 0 14px", lineHeight:1.2 }}>
            Your AI coach. Unlimited.
          </h1>

          <p style={{ fontSize:14, color:T.sub, lineHeight:1.7, margin:"0 0 8px" }}>
            The coach reads your real logs and reflections to tell you why things aren't sticking — and what to do next.
          </p>
          <p style={{ fontSize:13, color:T.muted, lineHeight:1.6, margin:"0 0 24px" }}>
            Unlimited AI coaching, full history, friend nudges, and voice logging — <strong style={{ color:T.text }}>$4.99/month</strong>.
          </p>

          <button
            onClick={handleCheckout}
            disabled={loading}
            style={{ width:"100%", padding:"15px 0", borderRadius:12, border:"none", background:T.gold, color:"#0F0F0D", fontSize:15, fontWeight:700, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, fontFamily:T.font, marginBottom:12, transition:"opacity 0.15s" }}
          >
            {loading ? "Opening checkout…" : "Unlock Forged Pro — $4.99/month"}
          </button>

          {error && (
            <p style={{ fontSize:12, color:"#e05c5c", margin:"0 0 10px", lineHeight:1.5 }}>{error}</p>
          )}

          <a
            href="/landing.html"
            style={{ display:"block", fontSize:13, color:T.muted, textDecoration:"none", padding:"8px 0" }}
          >
            Learn more →
          </a>
        </div>

        <p style={{ fontSize:11, color:T.hint, textAlign:"center", marginTop:20, lineHeight:1.6 }}>
          Secure checkout via Stripe. Cancel anytime.
        </p>
      </div>
    </div>
  );
}
