// ─── COMPANION MEMORY SCREEN ──────────────────────────────────────────────────
// The companion's own understanding of this person — not a settings page.
// Reads memory_facts (durable, atomic things extracted from real conversation
// by the nightly rollover) plus coach_memory (the rolling narrative summary)
// and the active Arc's identity/why. Not editable by default; a fact that's
// wrong or stale can be dismissed (soft-delete via status), which also keeps
// it out of what the coach retrieves going forward — that's the "allow
// corrections" mechanism, not a free-text editor.
import { useState, useEffect } from "react";
import { T } from "../theme.js";
import { supabase } from "../supabase.js";

const KIND_SECTIONS = [
  { kind: "project",          label: "Projects" },
  { kind: "person",           label: "Important people" },
  { kind: "commitment",       label: "Things you said you'd do" },
  { kind: "preference",       label: "How you work" },
  { kind: "emotional_pattern",label: "Patterns" },
  { kind: "event",            label: "Notable moments" },
  { kind: "fact",             label: "Other things it's noticed" },
];

function FactRow({ fact, onDismiss }) {
  const [dismissing, setDismissing] = useState(false);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: `0.5px solid ${T.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5 }}>{fact.content}</div>
        {fact.source_day ? (
          <div style={{ fontSize: 10.5, color: T.hint, marginTop: 3 }}>Noticed {fact.source_day}</div>
        ) : null}
      </div>
      <button
        type="button"
        disabled={dismissing}
        onClick={async () => {
          setDismissing(true);
          await onDismiss(fact.id);
        }}
        title="This isn't right — forget it"
        aria-label="Dismiss this — the companion will stop remembering it"
        style={{
          flexShrink: 0, background: "none", border: "none", cursor: dismissing ? "default" : "pointer",
          color: T.hint, fontSize: 13, padding: "2px 4px", opacity: dismissing ? 0.4 : 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

function Section({ label, facts, onDismiss }) {
  if (!facts.length) return null;
  return (
    <div style={{ margin: "0 14px 18px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
        {label}
      </div>
      {facts.map(f => <FactRow key={f.id} fact={f} onDismiss={onDismiss} />)}
    </div>
  );
}

export function CompanionMemoryScreen({ userId, activeBlock, coachName, onBack }) {
  const [facts, setFacts] = useState(null);
  const [memory, setMemory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const [{ data: factRows }, { data: memRow }] = await Promise.all([
          supabase
            .from("memory_facts")
            .select("id, kind, content, importance, source_day")
            .eq("user_id", userId)
            .eq("status", "active")
            .order("importance", { ascending: false })
            .order("first_seen_at", { ascending: false })
            .limit(200),
          supabase.from("coach_memory").select("content").eq("user_id", userId).maybeSingle(),
        ]);
        if (cancelled) return;
        setFacts(factRows || []);
        setMemory(memRow?.content || "");
      } catch {
        if (!cancelled) { setFacts([]); setMemory(""); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function dismissFact(id) {
    setFacts(prev => (prev || []).filter(f => f.id !== id));
    try {
      await supabase.from("memory_facts").update({ status: "dismissed" }).eq("id", id);
    } catch { /* best-effort — already removed from view */ }
  }

  const name = coachName || "Your companion";
  const grouped = KIND_SECTIONS.map(s => ({
    ...s,
    facts: (facts || []).filter(f => f.kind === s.kind),
  }));
  const hasAnyFacts = grouped.some(s => s.facts.length > 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "6px 14px 14px" }}>
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 22, color: T.text, lineHeight: 1.2 }}>
            What {name} remembers
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.5, maxWidth: 380 }}>
            This is its own understanding of you, built up from real conversation over time — not settings you configure. If something's wrong or out of date, dismiss it below.
          </div>
        </div>
        {onBack && (
          <button type="button" onClick={onBack}
            style={{ flexShrink: 0, padding: "8px 14px", borderRadius: T.rsm, background: T.surface, border: `0.5px solid ${T.border}`, color: T.sub, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
            ← You
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: "24px 14px", fontSize: 13, color: T.muted }}>Loading…</div>
      ) : (
        <>
          {activeBlock?.id ? (
            <div style={{ margin: "0 14px 18px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                Current direction
              </div>
              <div style={{ padding: "14px 16px", borderRadius: T.r, border: `0.5px solid ${T.border}`, background: T.raised }}>
                <div style={{ fontFamily: T.serif, fontSize: 16, color: T.text, lineHeight: 1.3, marginBottom: activeBlock.whyStatement ? 6 : 0 }}>
                  {activeBlock.identity || activeBlock.title || "Untitled direction"}
                </div>
                {activeBlock.whyStatement ? (
                  <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.5 }}>{activeBlock.whyStatement}</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {memory ? (
            <div style={{ margin: "0 14px 18px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                The overall picture
              </div>
              <div style={{ padding: "14px 16px", borderRadius: T.r, border: `0.5px solid ${T.border}`, background: T.raised, fontSize: 13, color: T.sub, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                {memory}
              </div>
            </div>
          ) : null}

          {hasAnyFacts ? (
            grouped.map(s => <Section key={s.kind} label={s.label} facts={s.facts} onDismiss={dismissFact} />)
          ) : (
            <div style={{ margin: "0 14px", padding: "24px 16px", textAlign: "center", borderRadius: T.r, border: `0.5px dashed ${T.borderStrong}` }}>
              <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6 }}>
                Nothing specific yet — the more you talk, the more {name} picks up on. Check back after a few real conversations.
              </div>
            </div>
          )}
        </>
      )}
      <div style={{ height: 24 }} />
    </div>
  );
}
