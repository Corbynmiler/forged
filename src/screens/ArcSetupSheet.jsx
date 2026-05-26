import { useMemo, useState } from "react";
import { T } from "../theme.js";
import { Modal, inp } from "../components/ui.jsx";
import { todayStr } from "../utils.js";
import { ARC_IDENTITY_EXAMPLES } from "./OnboardingScreen.jsx";

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays, 12, 0, 0);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 10px",
        borderRadius: 999,
        border: `0.5px solid ${active ? "rgba(192,57,43,0.55)" : T.border}`,
        background: active ? "rgba(192,57,43,0.10)" : "rgba(255,255,255,0.03)",
        color: active ? T.text : T.sub,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: T.font,
        lineHeight: 1.2,
        textAlign: "left",
      }}
    >
      {children}
    </button>
  );
}

function HabitPickRow({ habit, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 12px",
        borderRadius: T.rsm,
        border: `0.5px solid ${selected ? "rgba(192,57,43,0.45)" : T.border}`,
        background: selected ? "rgba(192,57,43,0.08)" : T.surface,
        cursor: "pointer",
        fontFamily: T.font,
        boxSizing: "border-box",
        textAlign: "left",
      }}
    >
      <div style={{ fontSize: 16, lineHeight: 1, width: 22, textAlign: "center", flexShrink: 0 }}>
        {habit.emoji || "•"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: T.text, fontWeight: 500, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {habit.name}
        </div>
      </div>
      <div
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          border: `1.5px solid ${selected ? T.accent : T.borderStrong}`,
          background: selected ? T.accent : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 12,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {selected ? "✓" : ""}
      </div>
    </button>
  );
}

export default function ArcSetupSheet({ onClose, onCreated, onSyncStart, userId, existingHabits, supabase }) {
  const [identity, setIdentity] = useState("");
  const [why, setWhy] = useState("");
  const [oldPattern, setOldPattern] = useState("");
  const [minimumProof, setMinimumProof] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const trackHabits = useMemo(
    () => (existingHabits || []).filter((h) => h && h.habitType !== "log"),
    [existingHabits],
  );

  const selectedCount = selected.size;
  const softCapHint = selectedCount > 5;
  const canStart = !!identity.trim() && !saving;

  function toggleHabit(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function startArc() {
    const idt = identity.trim();
    if (!idt || !userId || !supabase) return;
    setSaving(true);
    setErr("");
    onSyncStart?.();
    try {
      const start = todayStr();
      const end = addDaysYmd(start, 56);
      const nowIso = new Date().toISOString();

      const insertPayload = {
        user_id: userId,
        identity: idt,
        why_statement: why.trim() || null,
        old_pattern: oldPattern.trim() || null,
        minimum_proof: minimumProof.trim() || null,
        start_date: start,
        end_date: end,
        status: "active",
        duration_days: 56,
        updated_at: nowIso,
      };

      const { data: blockRow, error: insErr } = await supabase
        .from("forge_blocks")
        .insert(insertPayload)
        .select("*")
        .single();
      if (insErr) throw insErr;
      if (!blockRow?.id) throw new Error("Arc insert failed");

      const ids = Array.from(selected);
      if (ids.length > 0) {
        const { error: updErr } = await supabase
          .from("habits")
          .update({ block_id: blockRow.id, is_proof_action: true, updated_at: nowIso })
          .eq("user_id", userId)
          .in("id", ids);
        if (updErr) throw updErr;
      }

      if (onCreated) await onCreated({ block: blockRow, linkedIds: ids });
      onClose();
    } catch (e) {
      setErr(e?.message || "Could not start Arc");
    } finally {
      setSaving(false);
    }
  }

  const examples = (ARC_IDENTITY_EXAMPLES || []).slice(0, 5);
  const arcLbl = {
    fontSize: 11,
    fontWeight: 700,
    color: T.sub,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 8,
    display: "block",
  };
  const arcHint = { fontSize: 12, color: T.muted, lineHeight: 1.5 };

  return (
    <Modal onClose={onClose}>
      <div style={{ paddingBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: T.accent, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
          8-WEEK ARC
        </div>
        <div style={{ fontFamily: T.serif, fontSize: 22, color: T.text, marginBottom: 8 }}>
          Start your first Arc
        </div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.7, marginBottom: 18 }}>
          Eight weeks to become a slightly different person. Define who. Pick the daily proof. The coach takes it from there. Everything below can change later.
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={arcLbl}>Who are you becoming?</label>
          <textarea
            autoFocus
            value={identity}
            onChange={(e) => setIdentity(e.target.value.slice(0, 250))}
            rows={3}
            maxLength={250}
            placeholder="e.g. Gain 3kg without skipping breakfast."
            style={{ ...inp, resize: "none", lineHeight: 1.55 }}
          />
        </div>
        <div style={{ ...arcHint, marginBottom: 12 }}>
          Specific lands better than vague. Pick an example below or write your own.
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 18px" }}>
          {examples.map((ex) => (
            <Chip key={ex} active={identity.trim() === ex} onClick={() => setIdentity(ex)}>
              {ex}
            </Chip>
          ))}
        </div>

        <div style={{ marginBottom: 6 }}>
          <label style={arcLbl}>Why does this matter right now? (optional)</label>
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value.slice(0, 250))}
            rows={3}
            maxLength={250}
            placeholder="What would change if you stuck to this?"
            style={{ ...inp, resize: "none", lineHeight: 1.55 }}
          />
        </div>
        <div style={{ ...arcHint, marginBottom: 14 }}>
          The coach reads this back to you on hard days.
        </div>

        <div style={{ marginBottom: 6 }}>
          <label style={arcLbl}>Old pattern to weaken (optional)</label>
          <textarea
            value={oldPattern}
            onChange={(e) => setOldPattern(e.target.value.slice(0, 200))}
            rows={2}
            maxLength={200}
            placeholder="e.g. Nicotine kills appetite and I skip breakfast."
            style={{ ...inp, resize: "none", lineHeight: 1.55 }}
          />
        </div>
        <div style={{ ...arcHint, marginBottom: 14 }}>
          Naming it once helps the coach call it out when it shows up.
        </div>

        <div style={{ marginBottom: 6 }}>
          <label style={arcLbl}>On a bad day, what still counts as proof? (optional)</label>
          <input
            value={minimumProof}
            onChange={(e) => setMinimumProof(e.target.value.slice(0, 150))}
            maxLength={150}
            placeholder="e.g. Eat breakfast and one small build action."
            style={{ ...inp, fontSize: 15 }}
          />
        </div>
        <div style={{ ...arcHint, marginBottom: 18 }}>
          The bare minimum the coach falls back to on rough days.
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={arcLbl}>
            Pick your proof actions
          </div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55, marginBottom: 12 }}>
            Proof actions are the habits that count toward this Arc each day. Pick three to five.
          </div>
          {trackHabits.length === 0 ? (
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55, padding: "10px 12px", borderRadius: T.rsm, border: `0.5px dashed ${T.border}`, background: T.surface }}>
              You don&apos;t have any habits yet. Start the Arc, then add proof actions from Today.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {trackHabits.map((h) => (
                <HabitPickRow
                  key={h.id}
                  habit={h}
                  selected={selected.has(h.id)}
                  onToggle={() => toggleHabit(h.id)}
                />
              ))}
            </div>
          )}
          {softCapHint && (
            <div style={{ marginTop: 10, fontSize: 11, color: T.hint, lineHeight: 1.5 }}>
              Five proof actions is usually enough.
            </div>
          )}
        </div>

        {err && (
          <div style={{ marginTop: 10, marginBottom: 4, fontSize: 12, color: T.amber, lineHeight: 1.5 }}>
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={startArc}
          disabled={!canStart}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: T.rsm,
            border: "none",
            background: T.accent,
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: !canStart ? "not-allowed" : "pointer",
            marginTop: 10,
            fontFamily: T.font,
            opacity: !canStart ? 0.45 : 1,
          }}
        >
          {saving ? "Starting…" : "Start Arc"}
        </button>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 10,
            background: "none",
            border: "none",
            color: T.muted,
            fontSize: 12,
            fontFamily: T.font,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
            textDecorationColor: "rgba(168,164,156,0.35)",
          }}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

