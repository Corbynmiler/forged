// ─── ARC COMPLETED SHEET ──────────────────────────────────────────────────────
// Shown once when an Arc reaches its end: presents the Arc Story (generating it
// on demand via /api/arc-review) and the three-way decision — continue the same
// Arc, evolve it with the coach, or close it and rest. Dismissal is remembered
// per-block in localStorage so it never nags.
import { useState } from "react";
import { T } from "../theme.js";
import { supabase } from "../supabase.js";
import { resolveArcTitle, arcDurationWeeksLabel } from "../arcProofMatch.js";
import { parseLocal } from "../utils.js";

export function arcDecidedKey(blockId) {
  return `forged_arc_decided_${blockId}`;
}

export function hasDecidedArc(blockId) {
  try { return localStorage.getItem(arcDecidedKey(blockId)) === "1"; }
  catch { return false; }
}

export function markArcDecided(blockId) {
  try { localStorage.setItem(arcDecidedKey(blockId), "1"); } catch { /* ignore */ }
}

function fmtShort(ymd) {
  if (!ymd) return "";
  return parseLocal(ymd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ArcCompletedSheet({ block, userName, onStoryGenerated, onContinue, onEvolve, onClose }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const story = (block?.review?.text || "").trim();
  const title = resolveArcTitle(block?.title, block?.identity);

  async function generateStory() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in");
      const res = await fetch("/api/arc-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ block_id: block.id, name: userName || "" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not write the Arc Story");
      onStoryGenerated?.(json.block || null, json.review || null);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setGenerating(false);
    }
  }

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn?.(); } finally { setBusy(false); }
  }

  if (!block?.id) return null;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, background:"rgba(10,10,9,0.86)", backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{
        width:"100%", maxWidth:430, maxHeight:"92dvh", overflowY:"auto",
        background:T.bg, borderRadius:"22px 22px 0 0",
        border:`0.5px solid ${T.borderStrong}`, borderBottom:"none",
        padding:"26px 22px", paddingBottom:"max(30px, env(safe-area-inset-bottom, 30px))",
        boxSizing:"border-box", fontFamily:T.font,
      }}>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:44, marginBottom:10 }}>🏁</div>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:8 }}>
            Arc complete
          </div>
          <div style={{ fontFamily:T.serif, fontSize:26, color:T.text, lineHeight:1.15, marginBottom:6 }}>
            {title}
          </div>
          <div style={{ fontSize:12, color:T.muted }}>
            {fmtShort(block.startDate)} – {fmtShort(block.endDate)} · {arcDurationWeeksLabel(block.durationDays)}
            {block.arcRank ? ` · ${block.arcRank}` : ""}
          </div>
        </div>

        {/* Arc Story */}
        <div style={{
          padding:"16px 16px 14px", borderRadius:T.r, marginBottom:18,
          border:"0.5px solid rgba(200,144,42,0.4)",
          background:"linear-gradient(165deg, rgba(192,57,43,0.10) 0%, rgba(26,26,22,0.94) 40%, rgba(26,26,22,0.98) 100%)",
        }}>
          <div style={{ fontSize:10, fontWeight:800, color:T.gold, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:10 }}>
            Your Arc Story
          </div>
          {story ? (
            <div style={{ fontSize:14, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{story}</div>
          ) : (
            <>
              <div style={{ fontSize:13, color:T.sub, lineHeight:1.6, marginBottom:12 }}>
                The honest read on this Arc — what you said on day one versus the proof you actually showed.
              </div>
              {error && <div style={{ fontSize:12, color:T.amber, marginBottom:10, lineHeight:1.5 }}>{error}</div>}
              <button type="button" onClick={generateStory} disabled={generating}
                style={{ width:"100%", padding:"12px 0", borderRadius:T.rsm, border:"none", background:generating?T.surface:T.gold, color:generating?T.muted:"#0F0F0D", fontSize:13.5, fontWeight:700, cursor:generating?"default":"pointer", fontFamily:T.font }}>
                {generating ? "Writing your Arc Story…" : "Write my Arc Story"}
              </button>
            </>
          )}
        </div>

        {/* Decision */}
        <div style={{ fontSize:10, fontWeight:700, color:T.hint, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10, padding:"0 2px" }}>
          What happens next
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:9, marginBottom:6 }}>
          <button type="button" disabled={busy} onClick={() => act(onContinue)}
            style={{ textAlign:"left", padding:"13px 15px", borderRadius:T.rsm, border:"0.5px solid rgba(39,174,96,0.4)", background:"rgba(39,174,96,0.07)", cursor:"pointer", fontFamily:T.font, opacity:busy?0.6:1 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:2 }}>Run it back</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>Same direction, same proof — a fresh {arcDurationWeeksLabel(block.durationDays)} starting today.</div>
          </button>
          <button type="button" disabled={busy} onClick={() => act(onEvolve)}
            style={{ textAlign:"left", padding:"13px 15px", borderRadius:T.rsm, border:"0.5px solid rgba(200,144,42,0.45)", background:"rgba(200,144,42,0.07)", cursor:"pointer", fontFamily:T.font, opacity:busy?0.6:1 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:2 }}>Evolve it</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>Build the next Arc with your coach — it already knows what worked.</div>
          </button>
          <button type="button" disabled={busy} onClick={() => act(onClose)}
            style={{ textAlign:"left", padding:"13px 15px", borderRadius:T.rsm, border:`0.5px solid ${T.border}`, background:T.surface, cursor:"pointer", fontFamily:T.font, opacity:busy?0.6:1 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:2 }}>Close it for now</div>
            <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>Rest. Your habits keep working; start the next Arc whenever you're ready.</div>
          </button>
        </div>
      </div>
    </div>
  );
}
