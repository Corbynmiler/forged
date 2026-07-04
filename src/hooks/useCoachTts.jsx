import { useRef, useState, useCallback } from "react";
import { supabase } from "../supabase.js";
import { todayStr } from "../utils.js";

/** Minimal silent WAV — primes iOS Safari audio in the same user-gesture turn. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";

/**
 * Splits a reply into sentence-sized chunks so speak() can synthesize and
 * play them back-to-back instead of waiting for one TTS call covering the
 * entire reply — cuts time-to-first-audio for anything longer than a single
 * sentence. Capped defensively so a very long reply can't fan out into an
 * unbounded number of requests.
 */
const MAX_SPEECH_CHUNKS = 8;
export function splitIntoSpeechChunks(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const raw = trimmed.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [trimmed];
  const chunks = raw.map(s => s.trim()).filter(Boolean);
  if (chunks.length <= MAX_SPEECH_CHUNKS) return chunks;
  return [...chunks.slice(0, MAX_SPEECH_CHUNKS - 1), chunks.slice(MAX_SPEECH_CHUNKS - 1).join(" ")];
}

/**
 * Pro spoken coach replies via /api/tts (ElevenLabs Flash, server-side).
 * Forged remains the brain — this hook only plays the reply text aloud.
 *
 * speak(text) synthesizes and plays the reply one sentence-chunk at a time:
 * chunk N+1 is fetched in the background while chunk N is still playing, so
 * playback is gapless but the user hears the first words much sooner than
 * waiting for the whole reply to be synthesized as one clip.
 */
export function useCoachTts({ enabled = false, isPro = false, voiceId = null } = {}) {
  const audioRef = useRef(null);
  const primedRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState(null);
  /** Bumped by stopSpeaking()/a new speak() call to cancel any in-flight chunk sequence. */
  const sessionRef = useRef(0);

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
    // Bump the session so any in-flight chunk sequence (fetching or awaiting
    // its turn to play) sees it's been superseded and quietly bails out.
    sessionRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch { /* ignore */ }
    }
    setSpeaking(false);
  }, []);

  /** Fetch one chunk's audio and resolve to a playable object URL, or null on failure. */
  const fetchChunkAudioUrl = useCallback(async (chunkText, session) => {
    try {
      const { data: { session: sbSession } } = await supabase.auth.getSession();
      const token = sbSession?.access_token;
      if (!token) return { url: null, quotaExhausted: false };

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: chunkText.slice(0, 2000),
          voice_id: voiceId || undefined,
          client_date: todayStr(),
        }),
      });

      if (session !== sessionRef.current) return { url: null, quotaExhausted: false };

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setTtsError(json.error || "Could not play reply");
        return { url: null, quotaExhausted: res.status === 429 };
      }

      const blob = await res.blob();
      if (session !== sessionRef.current) return { url: null, quotaExhausted: false };
      return { url: URL.createObjectURL(blob), quotaExhausted: false };
    } catch {
      if (session === sessionRef.current) setTtsError("Could not play reply");
      return { url: null, quotaExhausted: false };
    }
  }, [voiceId]);

  /** Plays one chunk's audio to completion (or error/interruption). */
  const playChunkUrl = useCallback((url, session) => {
    return new Promise((resolve) => {
      if (session !== sessionRef.current) { URL.revokeObjectURL(url); resolve(); return; }
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;
      const finish = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onended = finish;
      audio.onerror = () => { setTtsError("Playback failed"); finish(); };
      audio.play().catch(finish);
    });
  }, []);

  const speak = useCallback(async (text) => {
    const spoken = String(text || "").trim();
    if (!enabled || !isPro || !spoken) return;
    setTtsError(null);
    stopSpeaking();
    const session = sessionRef.current; // stable after stopSpeaking's bump above

    const chunks = splitIntoSpeechChunks(spoken);
    if (!chunks.length) return;

    setSpeaking(true);
    try {
      // Kick off the first chunk, and always keep the NEXT chunk's fetch
      // in flight while the current one plays — by the time playback of
      // chunk N ends, chunk N+1's audio is usually already downloaded.
      let nextChunkPromise = fetchChunkAudioUrl(chunks[0], session);
      for (let i = 0; i < chunks.length; i++) {
        if (session !== sessionRef.current) return;
        const { url, quotaExhausted } = await nextChunkPromise;
        if (session !== sessionRef.current) { if (url) URL.revokeObjectURL(url); return; }
        if (quotaExhausted) break; // further chunks will fail the same way — stop early
        nextChunkPromise = i + 1 < chunks.length
          ? fetchChunkAudioUrl(chunks[i + 1], session)
          : Promise.resolve({ url: null, quotaExhausted: false });
        if (url) await playChunkUrl(url, session);
      }
    } finally {
      if (session === sessionRef.current) setSpeaking(false);
    }
  }, [enabled, isPro, stopSpeaking, fetchChunkAudioUrl, playChunkUrl]);

  return { speak, stopSpeaking, primeAudio, speaking, ttsError, clearTtsError: () => setTtsError(null) };
}
