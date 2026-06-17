import { useState, useEffect, useRef, useMemo } from "react";
import { T } from "../theme.js";
import { todayStr, parseLocal } from "../utils.js";
import { habitToRow, rowToHabit } from "../supabase.js";
import {
  resolveProofActionHabits,
  buildNewProofHabit,
  bubbleContentForDisplay,
  normalizeChatInput,
  formatCoachChatDisplay,
  resolveArcTitle,
  clampArcDurationDays,
  arcDurationWeeksLabel,
  normalizeProofActionEntry,
  proofActionDisplayName,
  forgeBlockToArcDraft,
} from "../arcProofMatch.js";
import { parseArcDraftFromText, parseArcOptionsFromText } from "./OnboardingScreen.jsx";
import { ArcDurationEditor } from "../components/ArcDurationEditor.jsx";
import ArcSuggestionPills from "../components/ArcSuggestionPills.jsx";
import { useSpeechInput, MicBtn, polishInterimDisplay } from "../hooks/useSpeechInput.jsx";
import { useScrollLock } from "../hooks/useScrollLock.js";
import { useArcChatScroll } from "../hooks/useArcChatScroll.js";
import { useVisualViewportInset } from "../hooks/useVisualViewportInset.js";
import {
  captureArcComposerText,
  arcComposerHasText,
  resetArcComposerAfterSend,
  makeArcSpeechFinalHandler,
} from "../lib/arcComposerSubmit.js";
import {
  ARC_OPENER_EXISTING,
  ARC_EDIT_OPENER,
  inferArcCoachStage,
  getArcSuggestionPills,
} from "../arcCoachSuggestions.js";

const MAX_QUESTIONS = 6;

const styleInp = {
  width: "100%",
  boxSizing: "border-box",
  background: T.surface,
  border: `0.5px solid ${T.borderStrong}`,
  borderRadius: T.rsm,
  padding: "10px 12px",
  fontSize: 14,
  color: T.text,
  fontFamily: T.font,
  outline: "none",
};

function addDaysLocalYmd(startYmd, deltaDays) {
  const [y, m, d] = String(startYmd || "").split("-").map(Number);
  const end = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}

function apiMessagesFromUi(msgs) {
  const trimmed = msgs
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({ role: m.role, content: normalizeChatInput(m.content) || String(m.content || "") }));
  if (trimmed.length > 0 && trimmed[0].role === "assistant") {
    return [{ role: "user", content: "." }, ...trimmed];
  }
  return trimmed;
}

function buildRequestBody({ name, coachName, messages, existingHabits, arc, isEditMode, multiOptions, priorArc }) {
  return {
    name: name || "there",
    coachName: coachName || "Coach",
    habitName: "",
    habitType: "daily",
    messages,
    arc: arc || { title: "", identity: "", why: "", oldPattern: "", minimumProof: "" },
    existingHabits: (existingHabits || []).map(h => ({
      id: h.id,
      name: h.name,
      emoji: h.emoji || "",
      habitType: h.habitType,
      isProofAction: !!h.isProofAction,
    })),
    isExistingUser: true,
    isEditMode: !!isEditMode,
    multiOptions: !!multiOptions,
    priorArc: priorArc || undefined,
  };
}

function ArcDraftCard({ draft, existingHabits, saveError, saving, isEdit }) {
  const displayTitle = resolveArcTitle(draft?.title, draft?.identity);
  const { unmatched } = useMemo(
    () => resolveProofActionHabits(draft?.proofActions || [], existingHabits),
    [draft, existingHabits],
  );

  return (
    <div style={{
      margin: "4px 0 6px",
      padding: "14px 16px",
      borderRadius: T.r,
      border: "0.5px solid rgba(200,144,42,0.45)",
      background: "linear-gradient(180deg, rgba(200,144,42,0.10), rgba(26,26,22,0.96))",
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>
        Arc draft
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 22, color: T.text, lineHeight: 1.2, marginBottom: 6 }}>
        {displayTitle}
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 12 }}>
        {arcDurationWeeksLabel(draft?.durationDays)} · {draft?.durationDays || 56} days
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
        You&apos;re becoming
      </div>
      <div style={{ fontSize: 14, color: T.sub, lineHeight: 1.5, marginBottom: 14 }}>
        {draft.identity}
      </div>
      {draft.why ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Why</div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.55 }}>{draft.why}</div>
        </div>
      ) : null}
      {draft.oldPattern ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Old pattern</div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.55 }}>{draft.oldPattern}</div>
        </div>
      ) : null}
      {draft.minimumProof ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Bad-day minimum</div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.55 }}>{draft.minimumProof}</div>
        </div>
      ) : null}
      {draft.proofActions?.length > 0 ? (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Suggested proof actions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {draft.proofActions.map((p, i) => (
              <div key={`${proofActionDisplayName(p)}-${i}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 11, color: T.gold, fontWeight: 700, marginTop: 2, flexShrink: 0 }}>·</span>
                <span style={{ fontSize: 13, color: T.text, lineHeight: 1.45 }}>{proofActionDisplayName(p)}</span>
              </div>
            ))}
          </div>
          {unmatched.length > 0 ? (
            <div style={{ fontSize: 11, color: T.hint, marginTop: 10, lineHeight: 1.5 }}>
              Add later: {unmatched.join(" • ")}
            </div>
          ) : null}
        </div>
      ) : null}
      {saveError ? (
        <div style={{ marginTop: 10, fontSize: 12, color: T.amber, lineHeight: 1.5 }}>{saveError}</div>
      ) : null}
      {saving ? (
        <div style={{ marginTop: 8, fontSize: 11, color: T.muted }}>Starting Arc…</div>
      ) : null}
    </div>
  );
}

export default function ArcCoachSheet({
  onClose,
  onCreated,
  onSyncStart,
  onUseFormInstead,
  userId,
  existingHabits,
  coachName,
  coachIcon,
  name,
  supabase,
  mode = "create",
  activeBlock = null,
  seedArc = null,
}) {
  useScrollLock(true);
  const isEdit = mode === "edit" && !!activeBlock?.id;
  const arcPayload = isEdit
    ? {
        title: activeBlock.title || "",
        identity: activeBlock.identity || "",
        why: activeBlock.whyStatement || "",
        oldPattern: activeBlock.oldPattern || "",
        minimumProof: activeBlock.minimumProof || "",
      }
    : { title: "", identity: "", why: "", oldPattern: "", minimumProof: "" };
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOpener, setLoadingOpener] = useState(true);
  const [arcDraft, setArcDraft] = useState(null);
  const [arcOptions, setArcOptions] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [editedArc, setEditedArc] = useState(null);
  const [editingArc, setEditingArc] = useState(false);
  const [priorTurns, setPriorTurns] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showViewArc, setShowViewArc] = useState(false);

  const textareaRef = useRef(null);
  const composerTurnRef = useRef(0);
  const openerFetched = useRef(false);
  const keyboardInset = useVisualViewportInset();
  const isRunItBack = !isEdit && seedArc?.type === "runItBack" && seedArc?.block;
  const isEvolve = !isEdit && seedArc?.type === "evolve" && seedArc?.block;

  const { scrollRef, bottomRef, onScroll, onComposerFocus } = useArcChatScroll(
    [msgs, sending, arcDraft, arcOptions, selectedIdx, showViewArc],
  );

  const speech = useSpeechInput(
    makeArcSpeechFinalHandler(setInput, composerTurnRef),
    { autoRestart: true },
  );

  const coachDisplay = (coachName || "Coach").trim() || "Coach";
  const avatar = (coachIcon || "").trim() || "🤖";
  const showConfirmCard = !isEdit && selectedIdx != null && editedArc;
  const inputLocked = isEdit ? !!arcDraft : showConfirmCard;
  const canSend = arcComposerHasText(input, speech) && !sending && !inputLocked;

  const coachStage = inferArcCoachStage({
    msgs,
    arcPayload,
    isEdit,
    priorTurns,
  });
  const suggestionPills = !inputLocked && !loadingOpener && !sending && !arcOptions
    ? getArcSuggestionPills(coachStage)
    : [];

  const proofHabitsForView = useMemo(
    () => (existingHabits || []).filter(
      h => h?.isProofAction && h.blockId === activeBlock?.id,
    ),
    [existingHabits, activeBlock?.id],
  );

  useEffect(() => {
    if (openerFetched.current) return;
    openerFetched.current = true;
    if (isEdit) {
      setMsgs([{ role: "assistant", content: ARC_EDIT_OPENER }]);
      setLoadingOpener(false);
      return;
    }
    if (isRunItBack) {
      const block = seedArc.block;
      const proofHabits = (existingHabits || []).filter(
        h => h?.isProofAction && h.blockId === block.id,
      );
      const draft = forgeBlockToArcDraft(block, proofHabits);
      const title = resolveArcTitle(block.title, block.identity);
      setMsgs([{
        role: "assistant",
        content: `Same Arc, fresh start — ${arcDurationWeeksLabel(draft?.durationDays)} from today. Review it below, tweak anything, then confirm.`,
      }]);
      if (draft) {
        setEditedArc(draft);
        setSelectedIdx(0);
      }
      setLoadingOpener(false);
      return;
    }
    if (isEvolve) {
      const b = seedArc.block;
      setMsgs([{
        role: "assistant",
        content: `You just finished "${resolveArcTitle(b.title, b.identity)}". What's the next season — push the same direction further, or pivot? Picture the weeks ahead.`,
      }]);
      setLoadingOpener(false);
      return;
    }
    setMsgs([{ role: "assistant", content: ARC_OPENER_EXISTING }]);
    setLoadingOpener(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function postChat(nextMsgs) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not signed in");

    const res = await fetch("/api/onboard-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(buildRequestBody({
        name,
        coachName: coachDisplay,
        messages: apiMessagesFromUi(nextMsgs),
        existingHabits,
        arc: arcPayload,
        isEditMode: isEdit,
        multiOptions: !isEdit,
        priorArc: isEvolve ? {
          title: seedArc.block.title,
          identity: seedArc.block.identity,
          why: seedArc.block.whyStatement,
          oldPattern: seedArc.block.oldPattern,
          minimumProof: seedArc.block.minimumProof,
          durationDays: seedArc.block.durationDays,
        } : undefined,
      })),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Request failed");
    }
    return res.json();
  }

  function pickOption(idx) {
    const opt = arcOptions?.[idx];
    if (!opt) return;
    setSelectedIdx(idx);
    setEditedArc({ ...opt, proofActions: [...(opt.proofActions || [])] });
    setEditingArc(false);
    setSaveError("");
  }

  function handleSuggestionPill(pill) {
    if (!pill || sending || inputLocked) return;
    if (pill.mode === "insert") {
      setInput(pill.text);
      textareaRef.current?.focus();
      return;
    }
    sendMessage(pill.text);
  }

  async function sendMessage(forcedText) {
    const text = forcedText !== undefined
      ? normalizeChatInput(forcedText)
      : captureArcComposerText(input, speech);
    if (!text || sending || inputLocked) return;
    resetArcComposerAfterSend({ speech, setInput, textareaRef, turnRef: composerTurnRef });
    setSaveError("");
    if (!isEdit) {
      setArcOptions(null);
      setSelectedIdx(null);
      setEditedArc(null);
    }

    const withUser = [...msgs, { role: "user", content: text }];
    setMsgs(withUser);
    setSending(true);

    try {
      const j = await postChat(withUser);
      if (j.reply) {
        if (isEdit) {
          const { prose, draft } = parseArcDraftFromText(j.reply);
          setMsgs(p => [...p, { role: "assistant", content: formatCoachChatDisplay(prose || j.reply) }]);
          if (draft) setArcDraft(draft);
        } else {
          const { prose, options } = parseArcOptionsFromText(j.reply);
          setMsgs(p => [...p, { role: "assistant", content: formatCoachChatDisplay(prose || j.reply) }]);
          if (options?.length) setArcOptions(options);
        }
      }
      if (typeof j.prior_assistant_turns === "number") setPriorTurns(j.prior_assistant_turns);
    } catch (e) {
      setMsgs(p => [...p, { role: "assistant", content: "Something went wrong — try again in a moment." }]);
    } finally {
      setSending(false);
    }
  }

  async function applyProofActionsFromDraft(blockId, draft, nowIso) {
    const entries = (draft.proofActions || []).map(normalizeProofActionEntry).filter(Boolean);
    const names = entries.map(e => e.name);
    const { matched, unmatched } = resolveProofActionHabits(names, existingHabits);
    const habitsPatch = [];
    const toLink = matched.filter(m => !(m.habit.blockId === blockId && m.habit.isProofAction));
    const matchedIds = toLink.map(m => m.habit.id);

    if (matchedIds.length > 0) {
      const { error: updErr } = await supabase
        .from("habits")
        .update({ block_id: blockId, is_proof_action: true, updated_at: nowIso })
        .eq("user_id", userId)
        .in("id", matchedIds);
      if (updErr) throw updErr;
      for (const { habit } of toLink) {
        habitsPatch.push({ ...habit, blockId, isProofAction: true });
      }
    }

    for (const proofName of unmatched) {
      const entry = entries.find(e => e.name === proofName);
      const draftHabit = buildNewProofHabit(proofName, blockId, entry?.cadence);
      const { data: row, error: createErr } = await supabase
        .from("habits")
        .insert(habitToRow(draftHabit, userId))
        .select("*")
        .single();
      if (createErr) throw createErr;
      habitsPatch.push(rowToHabit(row));
    }
    return habitsPatch;
  }

  async function confirmArc() {
    const draft = isEdit ? arcDraft : editedArc;
    if (!draft?.identity?.trim() || !userId || !supabase || saving) return;
    if (!isEdit && !draft?.minimumProof?.trim()) return;
    setSaving(true);
    setSaveError("");
    onSyncStart?.();

    try {
      const nowIso = new Date().toISOString();
      const arcTitle = resolveArcTitle(draft.title, draft.identity);
      let blockRow;

      if (isEdit) {
        // duration_days / end_date unchanged on edit — changing mid-Arc needs XP-3 (see plan).
        const { data, error: updErr } = await supabase
          .from("forge_blocks")
          .update({
            title: arcTitle,
            identity: draft.identity.trim(),
            why_statement: (draft.why || "").trim() || null,
            old_pattern: (draft.oldPattern || "").trim() || null,
            minimum_proof: (draft.minimumProof || "").trim() || null,
            updated_at: nowIso,
          })
          .eq("id", activeBlock.id)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (updErr) throw updErr;
        if (!data?.id) throw new Error("Arc update failed");
        blockRow = data;
      } else {
        const startDate = todayStr();
        const durationDays = clampArcDurationDays(draft.durationDays);
        const endDate = addDaysLocalYmd(startDate, durationDays);
        const { data, error: insErr } = await supabase
          .from("forge_blocks")
          .insert({
            user_id: userId,
            title: arcTitle,
            identity: draft.identity.trim(),
            why_statement: (draft.why || "").trim() || null,
            old_pattern: (draft.oldPattern || "").trim() || null,
            minimum_proof: (draft.minimumProof || "").trim() || null,
            start_date: startDate,
            end_date: endDate,
            status: "active",
            duration_days: durationDays,
            updated_at: nowIso,
          })
          .select("*")
          .single();
        if (insErr) throw insErr;
        if (!data?.id) throw new Error("Arc insert failed");
        blockRow = data;
      }

      const habitsPatch = await applyProofActionsFromDraft(blockRow.id, draft, nowIso);
      if (onCreated) await onCreated({ block: blockRow, habitsPatch });
      onClose();
    } catch (e) {
      setSaveError(e?.message || (isEdit ? "Could not update Arc" : "Could not start Arc"));
    } finally {
      setSaving(false);
    }
  }

  const questionNum = Math.min(priorTurns + 1, MAX_QUESTIONS);
  const showQuestionIndicator = !inputLocked && !loadingOpener;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: T.bg, display: "flex", flexDirection: "column", fontFamily: T.font, maxWidth: 430, margin: "0 auto", overflow: "hidden", height: "100dvh" }}>
      <style>{`@keyframes arcDot{0%,60%,100%{opacity:.2;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}`}</style>

      <div style={{ flexShrink: 0, paddingTop: "max(16px, env(safe-area-inset-top, 16px))", paddingBottom: 12, paddingLeft: 20, paddingRight: 20, borderBottom: `0.5px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, background: T.bg }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(200,144,42,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
          {avatar}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{coachDisplay}</div>
          <div style={{ fontSize: 11, color: T.gold, marginTop: 1 }}>{isEdit ? "Edit your Arc" : "Arc setup"}</div>
        </div>
        {isEdit && activeBlock ? (
          <button
            type="button"
            onClick={() => setShowViewArc(v => !v)}
            style={{
              flexShrink: 0, padding: "6px 10px", borderRadius: T.rsm,
              border: `0.5px solid rgba(200,144,42,0.45)`, background: showViewArc ? "rgba(200,144,42,0.18)" : "rgba(200,144,42,0.08)",
              color: T.gold, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font,
            }}
          >
            {showViewArc ? "Hide" : "View Arc"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          style={{ flexShrink: 0, background: "none", border: "none", color: T.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "4px 8px" }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {showViewArc && isEdit && activeBlock ? (
        <div style={{
          flexShrink: 0, margin: "0 16px", padding: "12px 14px", borderRadius: T.rsm,
          border: `0.5px solid rgba(200,144,42,0.35)`, background: "rgba(200,144,42,0.06)",
          maxHeight: 200, overflowY: "auto",
        }}>
          <div style={{ fontFamily: T.serif, fontSize: 18, color: T.text, marginBottom: 4 }}>
            {resolveArcTitle(activeBlock.title, activeBlock.identity)}
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>
            {(() => {
              const dur = activeBlock.durationDays || 56;
              const elapsed = Math.floor((parseLocal(todayStr()) - parseLocal(activeBlock.startDate)) / 86400000);
              const dayX = Math.min(dur, Math.max(1, elapsed + 1));
              return `${arcDurationWeeksLabel(dur)} · Day ${dayX} of ${dur}`;
            })()}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Direction</div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 10 }}>{activeBlock.identity}</div>
          {activeBlock.whyStatement ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Why</div>
              <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 10 }}>{activeBlock.whyStatement}</div>
            </>
          ) : null}
          {activeBlock.oldPattern ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Old pattern</div>
              <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 10 }}>{activeBlock.oldPattern}</div>
            </>
          ) : null}
          {activeBlock.minimumProof ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>Bad-day minimum</div>
              <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 10 }}>{activeBlock.minimumProof}</div>
            </>
          ) : null}
          {proofHabitsForView.length > 0 ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Proof actions</div>
              {proofHabitsForView.map(h => (
                <div key={h.id} style={{ fontSize: 13, color: T.text, marginBottom: 4 }}>
                  {h.emoji ? `${h.emoji} ` : ""}{h.name}
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", padding: "20px 16px 8px", display: "flex", flexDirection: "column", gap: 12 }}
      >
        {loadingOpener && msgs.length === 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(200,144,42,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{avatar}</div>
            <div style={{ padding: "10px 16px", background: T.surface, borderRadius: "14px 14px 14px 3px", display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: T.muted, animation: `arcDot 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
            </div>
          </div>
        )}

        {msgs.map((msg, i) =>
          msg.role === "assistant" ? (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(200,144,42,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{avatar}</div>
              <div style={{ background: T.surface, borderRadius: "14px 14px 14px 3px", padding: "10px 16px", fontSize: 15, color: T.text, lineHeight: 1.65, maxWidth: "82%", whiteSpace: "pre-wrap" }}>
                {bubbleContentForDisplay(msg.content)}
              </div>
            </div>
          ) : (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ background: T.accent, borderRadius: "14px 14px 3px 14px", padding: "10px 16px", fontSize: 15, color: "#fff", lineHeight: 1.65, maxWidth: "82%", whiteSpace: "pre-wrap" }}>
                {bubbleContentForDisplay(msg.content)}
              </div>
            </div>
          ),
        )}

        {sending && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(200,144,42,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{avatar}</div>
            <div style={{ padding: "10px 16px", background: T.surface, borderRadius: "14px 14px 14px 3px", display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: T.muted, animation: `arcDot 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
            </div>
          </div>
        )}

        {isEdit && arcDraft ? (
          <ArcDraftCard draft={arcDraft} existingHabits={existingHabits} saveError={saveError} saving={saving} isEdit={isEdit} />
        ) : null}

        {!isEdit && arcOptions && !showConfirmCard ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "4px 0 6px" }}>
            {arcOptions.map((opt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickOption(i)}
                style={{
                  textAlign: "left", padding: "14px 16px", borderRadius: T.r,
                  border: "0.5px solid rgba(200,144,42,0.45)",
                  background: "linear-gradient(180deg, rgba(200,144,42,0.08), rgba(26,26,22,0.96))",
                  cursor: "pointer", fontFamily: T.font,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontFamily: T.serif, fontSize: 19, color: T.text, lineHeight: 1.2 }}>
                    {opt.title || resolveArcTitle("", opt.identity)}
                  </span>
                  <span style={{ fontSize: 11, color: T.gold, fontWeight: 700, flexShrink: 0, marginLeft: 10 }}>
                    {arcDurationWeeksLabel(opt.durationDays)}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5, marginBottom: 8 }}>{opt.identity}</div>
                {opt.proofActions?.length > 0 ? (
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
                    {opt.proofActions.map(p => `· ${proofActionDisplayName(p)}`).join("  ")}
                  </div>
                ) : null}
                <div style={{ fontSize: 12, color: T.gold, fontWeight: 600, marginTop: 9 }}>Pick this one →</div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setArcOptions(null); setTimeout(() => textareaRef.current?.focus(), 60); }}
              style={{ padding: "8px 0", background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: T.font }}
            >
              None of these fit — keep talking
            </button>
          </div>
        ) : null}

        {showConfirmCard && editedArc ? (
          <div style={{
            margin: "4px 0 6px", padding: "16px 16px 14px", borderRadius: T.r,
            border: "0.5px solid rgba(200,144,42,0.5)",
            background: "linear-gradient(180deg, rgba(200,144,42,0.10), rgba(26,26,22,0.97))",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: T.gold, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Your Arc
              </div>
              <button type="button" onClick={() => setEditingArc(e => !e)}
                style={{ background: "none", border: "none", color: T.gold, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font, padding: "2px 4px" }}>
                {editingArc ? "Done editing" : "Edit"}
              </button>
            </div>
            {editingArc ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input style={styleInp} value={editedArc.title} maxLength={40}
                  onChange={e => setEditedArc(a => ({ ...a, title: e.target.value }))} placeholder="Arc title" />
                <textarea style={{ ...styleInp, minHeight: 56, resize: "vertical", lineHeight: 1.5 }} value={editedArc.identity} maxLength={250}
                  onChange={e => setEditedArc(a => ({ ...a, identity: e.target.value }))} placeholder="Direction — one concrete sentence" />
                <textarea style={{ ...styleInp, minHeight: 44, resize: "vertical", lineHeight: 1.5 }} value={editedArc.why} maxLength={250}
                  onChange={e => setEditedArc(a => ({ ...a, why: e.target.value }))} placeholder="Why it matters (optional)" />
                <input style={styleInp} value={editedArc.minimumProof} maxLength={150}
                  onChange={e => setEditedArc(a => ({ ...a, minimumProof: e.target.value }))} placeholder="Bad-day minimum — the least that still counts" />
                <ArcDurationEditor
                  durationDays={editedArc.durationDays}
                  onChange={d => setEditedArc(a => ({ ...a, durationDays: d }))}
                />
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Proof actions</div>
                  {editedArc.proofActions.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input style={{ ...styleInp, flex: 1, padding: "8px 10px", fontSize: 14 }} value={proofActionDisplayName(p)} maxLength={40}
                        onChange={e => {
                          const next = [...editedArc.proofActions];
                          next[i] = e.target.value;
                          setEditedArc(a => ({ ...a, proofActions: next }));
                        }} />
                      <button type="button" aria-label="Remove proof action"
                        onClick={() => setEditedArc(a => ({ ...a, proofActions: a.proofActions.filter((_, j) => j !== i) }))}
                        style={{ width: 34, borderRadius: T.rsm, border: `0.5px solid ${T.border}`, background: T.surface, color: T.muted, fontSize: 14, cursor: "pointer" }}>
                        ✕
                      </button>
                    </div>
                  ))}
                  {editedArc.proofActions.length < 5 ? (
                    <button type="button"
                      onClick={() => setEditedArc(a => ({ ...a, proofActions: [...a.proofActions, ""] }))}
                      style={{ padding: "7px 12px", borderRadius: T.rsm, border: `0.5px dashed ${T.borderStrong}`, background: "none", color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: T.font }}>
                      + Add proof action
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontFamily: T.serif, fontSize: 22, color: T.text, lineHeight: 1.2, marginBottom: 4 }}>
                  {editedArc.title || resolveArcTitle("", editedArc.identity)}
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 12 }}>
                  {arcDurationWeeksLabel(editedArc.durationDays)} · starts today
                </div>
                <div style={{ fontSize: 14, color: T.sub, lineHeight: 1.5, marginBottom: 12 }}>{editedArc.identity}</div>
                {editedArc.minimumProof ? (
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, marginBottom: 10 }}>
                    <span style={{ color: T.green, fontWeight: 600 }}>Bad-day minimum:</span> {editedArc.minimumProof}
                  </div>
                ) : (
                  <div style={{
                    marginBottom: 12, padding: "10px 12px", borderRadius: T.rsm,
                    border: "0.5px solid rgba(200,144,42,0.45)", background: "rgba(200,144,42,0.08)",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.gold, marginBottom: 6 }}>
                      Set a bad-day minimum to start this Arc
                    </div>
                    <input
                      style={{ ...styleInp, padding: "8px 10px", fontSize: 14 }}
                      value={editedArc.minimumProof || ""}
                      maxLength={150}
                      onChange={e => setEditedArc(a => ({ ...a, minimumProof: e.target.value }))}
                      placeholder="The least that still counts on a bad day"
                      autoFocus
                    />
                  </div>
                )}
                {editedArc.proofActions?.filter(p => proofActionDisplayName(p).trim()).length > 0 ? (
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.hint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                      Proof actions
                    </div>
                    {editedArc.proofActions.filter(p => proofActionDisplayName(p).trim()).map((p, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: T.gold, fontWeight: 700, marginTop: 2, flexShrink: 0 }}>·</span>
                        <span style={{ fontSize: 13, color: T.text, lineHeight: 1.45 }}>{proofActionDisplayName(p)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            {saveError ? (
              <div style={{ marginTop: 10, fontSize: 12, color: T.amber, lineHeight: 1.5 }}>{saveError}</div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={confirmArc}
                disabled={!editedArc.identity?.trim() || !editedArc.minimumProof?.trim() || saving}
                style={{ width: "100%", padding: 14, borderRadius: T.rsm, border: "none", background: T.gold, color: "#0F0F0D", fontSize: 15, fontWeight: 700, cursor: (saving || !editedArc.identity?.trim() || !editedArc.minimumProof?.trim()) ? "default" : "pointer", opacity: (saving || !editedArc.identity?.trim() || !editedArc.minimumProof?.trim()) ? 0.6 : 1, fontFamily: T.font, transition: "opacity 0.15s" }}>
                {saving ? (isRunItBack ? "Restarting…" : "Starting Arc…") : (isRunItBack ? "Run it back →" : "Start this Arc →")}
              </button>
              <button type="button" onClick={() => { setSelectedIdx(null); setEditedArc(null); }}
                style={{ width: "100%", padding: 8, background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", fontFamily: T.font }}>
                ← Back to the options
              </button>
            </div>
          </div>
        ) : null}

        {!inputLocked && !showConfirmCard ? (
          <div style={{ padding: "4px 0 8px", display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%", padding: 12, borderRadius: T.rsm,
                border: `0.5px solid ${T.border}`, background: "none",
                color: T.muted, fontSize: 14, cursor: "pointer", fontFamily: T.font,
              }}
            >
              Cancel Arc setup
            </button>
            {onUseFormInstead ? (
              <button
                type="button"
                onClick={onUseFormInstead}
                disabled={saving}
                style={{
                  width: "100%", background: "none", border: "none",
                  color: T.muted, fontSize: 12, fontFamily: T.font, cursor: "pointer",
                  textDecoration: "underline", textUnderlineOffset: 3,
                  textDecorationColor: "rgba(168,164,156,0.35)",
                }}
              >
                Use the form instead
              </button>
            ) : null}
          </div>
        ) : null}

        {isEdit && arcDraft ? (
          <div style={{ padding: "4px 0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={confirmArc}
              disabled={saving}
              style={{
                width: "100%", padding: 15, borderRadius: T.rsm, border: "none",
                background: T.gold, color: "#0F0F0D",
                fontSize: 16, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1, fontFamily: T.font,
              }}
            >
              {saving ? "Saving…" : "Save changes →"}
            </button>
            <button
              type="button"
              onClick={() => { setArcDraft(null); setSaveError(""); }}
              disabled={saving}
              style={{
                width: "100%", padding: 10, background: "none", border: "none",
                color: T.muted, fontSize: 12, cursor: saving ? "default" : "pointer", fontFamily: T.font,
              }}
            >
              Keep chatting first
            </button>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {!inputLocked ? (
        <div
          style={{
            flexShrink: 0,
            borderTop: `0.5px solid ${T.border}`,
            padding: "10px 14px",
            paddingBottom: "max(10px, env(safe-area-inset-bottom, 10px))",
            background: T.bg,
            marginBottom: keyboardInset,
          }}
        >
          {showQuestionIndicator ? (
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 8, textAlign: "center" }}>
              Question {questionNum} of up to {MAX_QUESTIONS}
            </div>
          ) : null}
          <ArcSuggestionPills
            pills={suggestionPills}
            onPill={handleSuggestionPill}
            disabled={sending || loadingOpener}
          />
          {speech.listening && speech.interim?.trim() ? (
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 8, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {polishInterimDisplay(speech.interim)}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            {speech.supported ? (
              <div style={{ flexShrink: 0, alignSelf: "flex-end", marginBottom: 1 }}>
                <MicBtn speech={speech} color={T.gold} size={44} prominent />
              </div>
            ) : null}
            <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onInput={e => { e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 88)}px`; }}
                onFocus={onComposerFocus}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                placeholder={speech.listening ? "Listening…" : (loadingOpener ? "Coach is typing…" : "Your answer…")}
                disabled={sending || loadingOpener}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: T.surface, border: `0.5px solid ${T.borderStrong}`,
                  borderRadius: T.rsm, padding: "10px 14px",
                  fontSize: 16, color: T.text, resize: "none",
                  fontFamily: T.font, lineHeight: 1.5, outline: "none",
                  minHeight: "42px", maxHeight: "88px", overflowY: "auto", height: "auto",
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => sendMessage()}
              disabled={!canSend}
              style={{
                width: 36, height: 36, borderRadius: "50%", border: `0.5px solid ${T.border}`,
                flexShrink: 0, alignSelf: "flex-end",
                background: canSend ? T.gold : T.surface,
                cursor: canSend ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                <path d="M2 9h14M9 2l7 7-7 7" stroke={canSend ? "#1a1a16" : T.hint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {speech.speechError ? (
            <div style={{ fontSize: 11, color: T.accent, marginTop: 8, lineHeight: 1.5, whiteSpace: "pre-line" }}>{speech.speechError}</div>
          ) : null}
          {!speech.supported ? (
            <div style={{ fontSize: 11, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>Voice typing isn&apos;t available in this browser — type instead.</div>
          ) : null}
        </div>
      ) : null}

      {isEdit && !arcDraft ? (
        <div style={{ flexShrink: 0, padding: "8px 16px", paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))", background: T.bg, marginBottom: keyboardInset }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "100%", padding: 12, borderRadius: T.rsm,
              border: `0.5px solid ${T.border}`, background: "none",
              color: T.muted, fontSize: 14, cursor: "pointer", fontFamily: T.font,
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
