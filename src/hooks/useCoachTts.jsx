import { useRef, useState, useCallback } from "react";
import { supabase } from "../supabase.js";
import { todayStr } from "../utils.js";

/** Minimal silent WAV — primes iOS Safari audio in the same user-gesture turn. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";

/**
 * Pro spoken coach replies via /api/tts (ElevenLabs Flash, server-side).
 * Forged remains the brain — this hook only plays the reply text aloud.
 */
export function useCoachTts({ enabled = false, isPro = false, voiceId = null } = {}) {
  const audioRef = useRef(null);
  const primedRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState(null);

  const primeAudio = useCallback(() => {
    if (primedRef.current || typeof window === "undefined") return;
    try {
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.muted = true;
      audio.volume = 0;
      audio.src = SILENT_WAV;
      const p = audio.play();
      if (p?.then) {
        p.then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          audio.volume = 1;
          primedRef.current = true;
        }).catch(() => { /* gesture may not be enough yet */ });
      }
    } catch { /* ignore */ }
  }, []);

  const stopSpeaking = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch { /* ignore */ }
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text) => {
    const spoken = String(text || "").trim();
    if (!enabled || !isPro || !spoken) return;
    setTtsError(null);
    stopSpeaking();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      setSpeaking(true);
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: spoken.slice(0, 2000),
          voice_id: voiceId || undefined,
          client_date: todayStr(),
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setTtsError(json.error || "Could not play reply");
        setSpeaking(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setSpeaking(false);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setSpeaking(false);
        setTtsError("Playback failed");
      };
      await audio.play();
    } catch {
      setSpeaking(false);
      setTtsError("Could not play reply");
    }
  }, [enabled, isPro, voiceId, stopSpeaking]);

  return { speak, stopSpeaking, primeAudio, speaking, ttsError, clearTtsError: () => setTtsError(null) };
}
