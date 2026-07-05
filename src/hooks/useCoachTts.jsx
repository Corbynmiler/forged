import { useRef, useState, useCallback } from "react";
import { supabase } from "../supabase.js";
import { todayStr } from "../utils.js";

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
 * speak(text) synthesizes each sentence-chunk via fetch, decodes it to an
 * AudioBuffer, and schedules it on a single Web Audio graph back-to-back
 * with the previous chunk (gapless — see the scheduling comment in speak()
 * below). Playback used to go through a single reused <audio> element with
 * .src reassigned per chunk; once that element got routed through a
 * createMediaElementSource() graph (for the ember's audio-reactive
 * visualization), reassigning .src on every chunk forced the browser to
 * reload/resync that pipeline at EVERY chunk boundary — audible as "a
 * couple words, cut out, a couple words, cut out." Scheduling raw
 * AudioBuffers on an AudioContext clock instead has no such reload step.
 */
export function useCoachTts({ enabled = false, isPro = false, voiceId = null } = {}) {
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  /** Currently scheduled/playing AudioBufferSourceNodes, so stopSpeaking() can silence them immediately. */
  const activeSourcesRef = useRef([]);
  const [speaking, setSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState(null);
  /** Bumped by stopSpeaking()/a new speak() call to cancel any in-flight chunk sequence. */
  const sessionRef = useRef(0);

  /**
   * Creates the AudioContext (+ analyser, wired straight to destination) the
   * first time it's needed, and resumes it every call. AudioContexts commonly
   * start 'suspended' (especially iOS Safari) and must be resumed inside a
   * real user gesture to reliably unlock — callers invoke this synchronously
   * from tap/send handlers, not only once a reply has already streamed back.
   */
  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.connect(ctx.destination);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      }
      audioCtxRef.current.resume?.().catch(() => { /* gesture may not be enough yet */ });
    } catch { /* ignore — falls back to the CSS-only pulse / speak() just won't play */ }
    return audioCtxRef.current;
  }, []);

  const primeAudio = useCallback(() => { ensureAudioContext(); }, [ensureAudioContext]);

  const stopSpeaking = useCallback(() => {
    // Bump the session so any in-flight chunk sequence (fetching, decoding,
    // or already scheduled) sees it's been superseded and quietly bails out.
    sessionRef.current += 1;
    for (const src of activeSourcesRef.current) {
      try { src.onended = null; src.stop(); } catch { /* already ended/stopped */ }
    }
    activeSourcesRef.current = [];
    setSpeaking(false);
  }, []);

  /**
   * Fetches one chunk's audio and decodes it to a playable AudioBuffer, or
   * null on failure. Takes an already-fetched `token` rather than calling
   * supabase.auth.getSession() itself — that was previously refetched on
   * every single chunk, adding a needless async round-trip to the critical
   * path of the very first (most latency-sensitive) chunk. speak() now
   * fetches the session once per call and reuses it.
   */
  const fetchChunkBuffer = useCallback(async (chunkText, token, session, ctx) => {
    try {
      if (!token) return { buffer: null, quotaExhausted: false };

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

      if (session !== sessionRef.current) return { buffer: null, quotaExhausted: false };

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setTtsError(json.error || "Could not play reply");
        return { buffer: null, quotaExhausted: res.status === 429 };
      }

      const arrayBuf = await res.arrayBuffer();
      if (session !== sessionRef.current) return { buffer: null, quotaExhausted: false };
      const audioBuffer = await ctx.decodeAudioData(arrayBuf);
      if (session !== sessionRef.current) return { buffer: null, quotaExhausted: false };
      return { buffer: audioBuffer, quotaExhausted: false };
    } catch {
      if (session === sessionRef.current) setTtsError("Could not play reply");
      return { buffer: null, quotaExhausted: false };
    }
  }, [voiceId]);

  const speak = useCallback(async (text) => {
    const spoken = String(text || "").trim();
    if (!enabled || !isPro || !spoken) return;
    setTtsError(null);
    stopSpeaking();
    const session = sessionRef.current; // stable after stopSpeaking's bump above

    const chunks = splitIntoSpeechChunks(spoken);
    if (!chunks.length) return;

    const ctx = ensureAudioContext();
    if (!ctx) return;

    setSpeaking(true);
    try {
      // Fetch the auth token ONCE for this whole reply, not once per chunk —
      // shaves a redundant async round-trip off the critical path of the
      // very first chunk, which is exactly the delay between "reply
      // finished streaming" and "audio actually starts."
      const { data: { session: sbSession } } = await supabase.auth.getSession();
      const token = sbSession?.access_token;
      if (!token || session !== sessionRef.current) return;

      // Prefetch with a bounded sliding window instead of either extreme:
      //   - staggered one-ahead: chunk N+1 only starts fetching once chunk
      //     N's fetch RESOLVES — for a short sentence that's not enough lead
      //     time, producing an audible gap.
      //   - fire-everything-at-once: ElevenLabs caps CONCURRENT requests per
      //     account (free tier: 2; Starter: 3) — firing all chunks at once
      //     blows through that and gets extra requests rejected outright.
      // A window of 2 concurrent fetches stays within even the free tier's
      // limit while giving every chunk beyond the first two a real head start.
      const CONCURRENT_TTS_FETCH_WINDOW = 2;
      const windowSize = Math.min(CONCURRENT_TTS_FETCH_WINDOW, chunks.length);
      const chunkPromises = new Array(chunks.length);
      for (let i = 0; i < windowSize; i++) {
        chunkPromises[i] = fetchChunkBuffer(chunks[i], token, session, ctx);
      }

      // Gapless scheduling: each chunk is scheduled to start exactly when the
      // previous one's buffer ends, on the AudioContext's own clock — not
      // "await playback, then start the next fetch." If a later chunk's
      // fetch+decode hasn't resolved by the time its slot arrives, its start
      // time has already passed and it plays immediately (a small gap under
      // slow network conditions), but on-schedule chunks play back-to-back
      // with zero seam, unlike reassigning .src on a shared <audio> element.
      let nextStartTime = ctx.currentTime;
      let lastSource = null;

      for (let i = 0; i < chunks.length; i++) {
        if (session !== sessionRef.current) return;
        const { buffer, quotaExhausted } = await chunkPromises[i];
        if (session !== sessionRef.current) return;
        // Only start the next fetch AFTER this slot's request has actually
        // resolved (freeing it), not before — starting it earlier would
        // briefly push concurrency to windowSize+1, exactly the mistake
        // that caused ElevenLabs to reject requests outright.
        const nextIdx = i + windowSize;
        if (nextIdx < chunks.length) {
          chunkPromises[nextIdx] = fetchChunkBuffer(chunks[nextIdx], token, session, ctx);
        }
        if (quotaExhausted) break; // further chunks will fail the same way — stop early
        if (buffer) {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(analyserRef.current || ctx.destination);
          const startAt = Math.max(nextStartTime, ctx.currentTime);
          source.start(startAt);
          nextStartTime = startAt + buffer.duration;
          activeSourcesRef.current.push(source);
          lastSource = source;
        }
      }

      if (lastSource) {
        await new Promise(resolve => {
          if (session !== sessionRef.current) { resolve(); return; }
          lastSource.onended = resolve;
        });
      }
    } finally {
      if (session === sessionRef.current) {
        activeSourcesRef.current = [];
        setSpeaking(false);
      }
    }
  }, [enabled, isPro, stopSpeaking, fetchChunkBuffer, ensureAudioContext]);

  return {
    speak, stopSpeaking, primeAudio, speaking, ttsError,
    clearTtsError: () => setTtsError(null),
    /** Read-only: analyser node a consumer can pull frequency data from for an audio-reactive animation. */
    analyserRef,
  };
}
