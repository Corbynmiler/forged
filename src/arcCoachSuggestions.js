/**
 * Arc setup/edit coach — openers, stage detection, and suggestion pills.
 */

export const ARC_OPENER_EXISTING =
  "Let's build your 8-week Arc. You've already got some habits tracked, so we'll use those as raw material. Picture yourself eight weeks from now — in an ideal world, what feels different? What are you doing more of, doing less of, or finally getting under control?";

export const ARC_OPENER_NEW =
  "Let's build your first 8-week Arc. Picture yourself eight weeks from now — in an ideal world, what feels different? What are you doing more of, doing less of, or finally getting under control?";

export const ARC_EDIT_OPENER =
  "Want to adjust the title, identity, proof actions, or bad-day minimum? Tap View Arc above to see everything at a glance.";

/** @typedef {{ label: string, mode: "send" | "insert", text: string }} ArcSuggestionPill */

/**
 * Infer which Arc question we're on from the latest assistant turn + context.
 * @returns {"vision"|"why"|"pattern"|"minimum"|"proof"|"edit"|"general"}
 */
export function inferArcCoachStage({ msgs = [], arcPayload = {}, isEdit = false, priorTurns = 0 }) {
  if (isEdit && priorTurns === 0 && (msgs || []).filter(m => m.role === "user").length === 0) {
    return "edit";
  }

  const lastAssistant = [...(msgs || [])]
    .reverse()
    .find(m => m?.role === "assistant")?.content?.toLowerCase() || "";

  if (/bad[- ]?day|minimum|worst day|still counts|on a rough day/.test(lastAssistant)) return "minimum";
  if (/proof action|proof list|which habit|habits.*(arc|prove)|existing habits/.test(lastAssistant)) return "proof";
  if (/pattern|trip you up|old habit|weaken|fall off|keeps catching/.test(lastAssistant)) return "pattern";
  if (/why|matter|stakes|reason|important/.test(lastAssistant)) return "why";
  if (/eight weeks|picture yourself|ideal world|feels different/.test(lastAssistant)) return "vision";

  const identity = String(arcPayload?.identity || "").trim();
  const why = String(arcPayload?.why || "").trim();
  const oldPattern = String(arcPayload?.oldPattern || "").trim();
  const minimum = String(arcPayload?.minimumProof || "").trim();
  const userTurns = (msgs || []).filter(m => m.role === "user").length;

  if (!identity || userTurns <= 1) return "vision";
  if (!why) return "why";
  if (!oldPattern) return "pattern";
  if (!minimum) return "minimum";
  return "proof";
}

/** @returns {ArcSuggestionPill[]} */
export function getArcSuggestionPills(stage) {
  const examples = { label: "Give examples", mode: "send", text: "Give me a few concrete examples of what people say here." };

  switch (stage) {
    case "vision":
      return [
        examples,
        { label: "Health reset", mode: "insert", text: "Health reset — eating better, moving more, sleeping properly." },
        { label: "More consistent", mode: "insert", text: "More consistent — fewer skipped days and less chaos." },
        { label: "Less nicotine", mode: "insert", text: "Less nicotine — fewer pouches and not needing it to get through work." },
      ];
    case "why":
      return [
        examples,
        { label: "Health", mode: "insert", text: "My health — I want to feel better day to day." },
        { label: "Money", mode: "insert", text: "Money — stop bleeding cash on habits that don't help." },
        { label: "Confidence", mode: "insert", text: "Confidence — I want to trust myself again." },
      ];
    case "pattern":
      return [
        examples,
        { label: "Skip when tired", mode: "insert", text: "I skip the good stuff when I'm tired or stressed." },
        { label: "All or nothing", mode: "insert", text: "All-or-nothing — one slip and I write the day off." },
      ];
    case "minimum":
      return [
        examples,
        { label: "Tiny version", mode: "insert", text: "Tiny version still counts — one small proof action." },
        { label: "One non-negotiable", mode: "insert", text: "One non-negotiable — the smallest thing I won't skip." },
      ];
    case "proof":
      return [
        examples,
        { label: "Keep it tight", mode: "send", text: "Keep the proof list tight — 3 to 5 habits max." },
        { label: "Use my habits", mode: "send", text: "Use the habits I'm already tracking where they fit." },
      ];
    case "edit":
      return [
        { label: "Rename Arc", mode: "send", text: "Suggest 3 short title options for my Arc." },
        { label: "Tweak proof", mode: "send", text: "I want to adjust the proof actions." },
        { label: "Bad-day minimum", mode: "send", text: "I want to change the bad-day minimum." },
      ];
    default:
      return [examples];
  }
}

export function onboardingArcOpener(arcIdentity) {
  const idt = String(arcIdentity || "").trim();
  if (!idt) return ARC_OPENER_NEW;
  const short = idt.length > 90 ? `${idt.slice(0, 87)}…` : idt;
  return `Let's lock in your first Arc. You wrote: "${short}" Picture yourself eight weeks from now — in an ideal world, what else feels different?`;
}
