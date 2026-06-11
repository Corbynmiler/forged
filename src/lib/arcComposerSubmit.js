import { normalizeChatInput } from "../arcProofMatch.js";
import { mergeDictationIntoText, polishInterimDisplay } from "../hooks/useSpeechInput.jsx";

/** Text to send: committed input plus any live interim dictation. */
export function captureArcComposerText(input, speech) {
  let raw = String(input || "");
  if (speech?.listening && speech.interim?.trim()) {
    raw = mergeDictationIntoText(raw, polishInterimDisplay(speech.interim));
  }
  return normalizeChatInput(raw);
}

/** Whether the composer currently has sendable content. */
export function arcComposerHasText(input, speech) {
  return !!captureArcComposerText(input, speech);
}

/**
 * After capturing outbound text, stop speech without flushing stale audio
 * into the next turn and clear the composer.
 */
export function resetArcComposerAfterSend({ speech, setInput, textareaRef, turnRef }) {
  if (turnRef) turnRef.current += 1;
  speech?.cancel?.();
  setInput("");
  const el = textareaRef?.current;
  if (el) el.style.height = "auto";
}

/** Speech onFinal handler that ignores callbacks from prior turns. */
export function makeArcSpeechFinalHandler(setInput, turnRef) {
  return (text) => {
    const turn = turnRef.current;
    queueMicrotask(() => {
      if (turn !== turnRef.current) return;
      setInput(prev => mergeDictationIntoText(prev, text));
    });
  };
}
