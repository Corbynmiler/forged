import { useRef, useState, useCallback } from "react";
import { supabase } from "../supabase.js";
import { todayStr } from "../utils.js";
import { getCachedTtsChunk, putCachedTtsChunk, pruneStaleTtsCache } from "../lib/ttsCache.js";

/**
 * Splits a reply into sentence-sized chunks so speak() can synthesize and
 * play them back-to-back instead of waiting for one TTS call covering the
 * entire reply — cuts time-to-first-audio for anything longer than a single
 * sentence. Capped defensively so a very long reply can't fan out into an
 * unbounded number of requests. Raised from 8 to support the "Ramble"
 * long-form mode (real 5-10 minute replies) — at 8, a long reply's overflow
 * sentences all got merged into one oversized final chunk, which could
 * exceed api/tts.js's per-request 2000-char cap and fail outright. 60 is
 * comfortably more sentences than even a 10-minute reply needs, so the merge
 * path shouldn't trigger for realistic long-form replies.
 */
const MAX_SPEECH_CHUNKS = 60;
export function splitIntoSpeechChunks(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const raw = trimmed.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [trimmed];
  const chunks = raw.map(s => s.trim()).filter(Boolean);
  if (chunks.length <= MAX_SPEECH_CHUNKS) return chunks;
  return [...chunks.slice(0, MAX_SPEECH_CHUNKS - 1), chunks.slice(MAX_SPEECH_CHUNKS - 1).join(" ")];
}

const REWIND_SECONDS = 10;

/**
 * Pro spoken coach replies via /api/tts (ElevenLabs Flash, server-side).
 * Forged remains the brain — this hook only plays the reply text aloud.
 * No longer auto-invoked when a reply finishes streaming — speak() is only
 * ever called from an explicit per-message tap now (see CompanionScreen.jsx),
 * so nothing gets synthesized unless the user actually asks to hear it.
 *
 * speak(text, cacheKey) synthesizes each sentence-chunk via fetch, decodes it
 * to an AudioBuffer, and schedules it on a single Web Audio graph back-to-back
 * with the previous chunk (gapless — see the scheduling comment in speak()
 * below). Playback used to go through a single reused <audio> element with
 * .src reassigned per chunk; once that element got routed through a
 * createMediaElementSource() graph (for the ember's audio-reactive
 * visualization), reassigning .src on every chunk forced the browser to
 * reload/resync that pipeline at EVERY chunk boundary — audible as "a
 * couple words, cut out, a couple words, cut out." Scheduling raw
 * AudioBuffers on an AudioContext clock instead has no such reload step.
 *
 * Playback controls (pause/resume/rewind) piggyback on that same clock:
 * pause/resume suspend/resume the whole AudioContext (every scheduled
 * source freezes and continues in lockstep, no per-source offset tracking
 * needed); rewind re-derives "how far into this reply are we" from
 * ctx.currentTime and reschedules already-decoded chunks from up to 10s
 * earlier, using AudioBufferSourceNode's own `offset` start parameter
 * rather than re-fetching anything.
 *
 * `cacheKey` (the message's stable ts, passed by the caller) plus the
 * current `voiceId` together make replaying a message in the SAME voice
 * free: each chunk's decoded AudioBuffer is kept in memory for the rest of
 * the session (audioCacheRef), and its raw bytes are also written to
 * IndexedDB (src/lib/ttsCache.js) so a replay survives a page refresh too —
 * "for today only," pruned once per session against today's date. Scoping
 * the cache by voice as well as message means switching voices and
 * replaying the same message correctly re-synthesizes (a different voice is
 * a genuinely different, separately-billed generation) instead of silently
 * playing back stale audio in the old voice.
 */
export function useCoachTts({ enabled = false, isPro = false, voiceId = null } = {}) {
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  /** Currently scheduled/playing AudioBufferSourceNodes, so stopSpeaking()/rewind() can silence them immediately. */
  const activeSourcesRef = useRef([]);
  /** Every chunk decoded so far this reply, as {start, end, buffer} in reply-elapsed seconds — lets rewind() re-derive "what plays at time T" without re-fetching. Reset at the start of each speak() call. */
  const chunkMarksRef = useRef([]);
  /** ctx.currentTime value such that (ctx.currentTime - positionOriginRef.current) == seconds elapsed into the current reply. Shifted forward whenever a chunk's start gets clamped late (slow fetch), and reset by rewind(). */
  const positionOriginRef = useRef(0);
  /** Ref (not a closure-local) so rewind() can redirect where the still-running speak() loop schedules its NEXT not-yet-decoded chunk. */
  const nextStartTimeRef = useRef(0);
  /** In-memory decoded-AudioBuffer cache, keyed by `${cacheKey}:${voiceId}:${chunkIndex}` — survives for the life of this hook instance (the whole session), not just one speak() call. */
  const audioCacheRef = useRef(new Map());
  const prunedRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ttsError, setTtsError] = useState(null);
  /** Which message (by the cacheKey the caller passed to speak()) is the currently active one — lets the UI show pause/stop/rewind controls on the right message bubble instead of a single global indicator. */
  const [speakingKey, setSpeakingKey] = useState(null);
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
      if (!prunedRef.current) {
        prunedRef.current = true;
        void pruneStaleTtsCache(todayStr());
      }
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
    chunkMarksRef.current = [];
    setSpeaking(false);
    setPaused(false);
    setSpeakingKey(null);
  }, []);

  /** Pause playback in place — suspends the whole AudioContext clock, so every scheduled chunk freezes and resumes together with no per-chunk bookkeeping. */
  const pauseSpeaking = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !speaking || paused) return;
    ctx.suspend?.().catch(() => {});
    setPaused(true);
  }, [speaking, paused]);

  const resumeSpeaking = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !paused) return;
    ctx.resume?.().catch(() => {});
    setPaused(false);
  }, [paused]);

  /**
   * Jumps back `REWIND_SECONDS` and replays from there. Stops whatever's
   * currently scheduled, finds which already-decoded chunk(s) cover the
   * target position, and restarts them right now via
   * AudioBufferSourceNode.start(when, offset) — no re-fetch, since rewinding
   * can only ever land in content that's already played (and therefore
   * already decoded). Also redirects nextStartTimeRef so if speak()'s loop
   * is still fetching later chunks, they get scheduled right after this
   * rather than at their stale pre-rewind time.
   */
  const rewindSpeaking = useCallback(() => {
    const ctx = audioCtxRef.current;
    const session = sessionRef.current;
    if (!ctx || !chunkMarksRef.current.length) return;

    const wasPaused = paused;
    const currentPos = ctx.currentTime - positionOriginRef.current;
    const targetPos = Math.max(0, currentPos - REWIND_SECONDS);

    for (const src of activeSourcesRef.current) {
      try { src.onended = null; src.stop(); } catch { /* already ended/stopped */ }
    }
    activeSourcesRef.current = [];

    // Resume just long enough to reschedule against a live clock — start()
    // times are relative to ctx.currentTime, which doesn't advance while
    // suspended, so scheduling while still suspended would bunch everything
    // at the same instant. Re-suspend immediately after if it was paused.
    if (wasPaused) ctx.resume?.().catch(() => {});

    const marks = chunkMarksRef.current.filter(m => m.end > targetPos);
    let startAt = ctx.currentTime;
    let lastSource = null;
    marks.forEach((m, i) => {
      const offset = i === 0 ? Math.max(0, targetPos - m.start) : 0;
      const source = ctx.createBufferSource();
      source.buffer = m.buffer;
      source.connect(analyserRef.current || ctx.destination);
      source.start(startAt, offset);
      activeSourcesRef.current.push(source);
      lastSource = source;
      startAt += (m.end - m.start) - offset;
    });

    positionOriginRef.current = ctx.currentTime - targetPos;
    nextStartTimeRef.current = startAt;

    if (lastSource) {
      lastSource.onended = () => { if (session === sessionRef.current) { setSpeaking(false); setSpeakingKey(null); } };
    }

    if (wasPaused) { ctx.suspend?.().catch(() => {}); setPaused(true); }
  }, [paused]);

  /**
   * Fetches one chunk's audio and decodes it to a playable AudioBuffer, or
   * null on failure. Checks caches first when `cacheKey` is given (a
   * per-message identity, e.g. the message's ts) — in-memory first (this
   * session), then IndexedDB (survives a refresh, today only) — and only
   * hits ElevenLabs on a genuine miss, writing the result back to both
   * caches so the next replay of this exact message is free.
   *
   * Takes an already-fetched `token` rather than calling
   * supabase.auth.getSession() itself — that was previously refetched on
   * every single chunk, adding a needless async round-trip to the critical
   * path of the very first (most latency-sensitive) chunk. speak() now
   * fetches the session once per call and reuses it.
   */
  const fetchChunkBuffer = useCallback(async (chunkText, token, session, ctx, cacheKey) => {
    try {
      if (cacheKey) {
        const mem = audioCacheRef.current.get(cacheKey);
        if (mem) return { buffer: mem, quotaExhausted: false };

        const cachedBytes = await getCachedTtsChunk(cacheKey);
        if (session !== sessionRef.current) return { buffer: null, quotaExhausted: false };
        if (cachedBytes) {
          try {
            const buf = await ctx.decodeAudioData(cachedBytes);
            audioCacheRef.current.set(cacheKey, buf);
            return { buffer: buf, quotaExhausted: false };
          } catch { /* corrupt/stale cache entry — fall through to a real fetch */ }
        }
      }

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
      // decodeAudioData detaches the buffer it's given — decode a clone so
      // the original bytes are still valid to hand to the cache below.
      const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
      if (session !== sessionRef.current) return { buffer: null, quotaExhausted: false };
      if (cacheKey) {
        audioCacheRef.current.set(cacheKey, audioBuffer);
        void putCachedTtsChunk(cacheKey, arrayBuf, todayStr());
      }
      return { buffer: audioBuffer, quotaExhausted: false };
    } catch {
      if (session === sessionRef.current) setTtsError("Could not play reply");
      return { buffer: null, quotaExhausted: false };
    }
  }, [voiceId]);

  const speak = useCallback(async (text, cacheKey = null) => {
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
    setSpeakingKey(cacheKey);
    try {
      // Fetch the auth token ONCE for this whole reply, not once per chunk —
      // shaves a redundant async round-trip off the critical path of the
      // very first chunk, which is exactly the delay between "reply
      // finished streaming" and "audio actually starts." Skipped entirely
      // when every chunk turns out to be cached, since fetchChunkBuffer
      // never needs the token in that case — but we don't know that yet,
      // so it's still fetched eagerly to avoid a second round-trip on a
      // partial cache hit.
      const { data: { session: sbSession } } = await supabase.auth.getSession();
      const token = sbSession?.access_token;
      if (session !== sessionRef.current) return;

      // Prefetch with a bounded sliding window instead of either extreme:
      //   - staggered one-ahead: chunk N+1 only starts fetching once chunk
      //     N's fetch RESOLVES — for a short sentence that's not enough lead
      //     time, producing an audible gap.
      //   - fire-everything-at-once: ElevenLabs caps CONCURRENT requests per
      //     account (free tier: 2; Starter: 3) — firing all chunks at once
      //     blows through that and gets extra requests rejected outright.
      // A window of 2 concurrent fetches stays within even the free tier's
      // limit while giving every chunk beyond the first two a real head start.
      // (Cached chunks resolve near-instantly regardless of this window —
      // it only throttles genuine network fetches.)
      const CONCURRENT_TTS_FETCH_WINDOW = 2;
      const windowSize = Math.min(CONCURRENT_TTS_FETCH_WINDOW, chunks.length);
      // Voice ID is part of the cache key, not just the message's ts —
      // otherwise replaying a message after switching voices would silently
      // play back the OLD voice's cached audio instead of either regenerating
      // in the new voice or making it obvious nothing changed. Scoping the
      // cache per (message, voice) pair means: first listen in a given voice
      // costs real ElevenLabs characters (unavoidable — a different voice is
      // a genuinely different synthesis, same cost as the first generation);
      // every later replay in that SAME voice stays free; switching voice and
      // replaying correctly re-synthesizes rather than reusing stale audio.
      const chunkKey = i => (cacheKey ? `${cacheKey}:${voiceId || "default"}:${i}` : null);
      const chunkPromises = new Array(chunks.length);
      for (let i = 0; i < windowSize; i++) {
        chunkPromises[i] = fetchChunkBuffer(chunks[i], token, session, ctx, chunkKey(i));
      }

      // Gapless scheduling: each chunk is scheduled to start exactly when the
      // previous one's buffer ends, on the AudioContext's own clock — not
      // "await playback, then start the next fetch." If a later chunk's
      // fetch+decode hasn't resolved by the time its slot arrives, its start
      // time has already passed and it plays immediately (a small gap under
      // slow network conditions), but on-schedule chunks play back-to-back
      // with zero seam, unlike reassigning .src on a shared <audio> element.
      //
      // nextStartTimeRef/positionOriginRef/chunkMarksRef are refs, not
      // closure-locals, specifically so rewindSpeaking() can redirect them
      // mid-flight: if the user rewinds while this loop is still fetching
      // later chunks, those chunks need to land after the rewound audio,
      // not at their stale pre-rewind schedule time.
      nextStartTimeRef.current = ctx.currentTime;
      positionOriginRef.current = ctx.currentTime;
      let contentCursor = 0;
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
          chunkPromises[nextIdx] = fetchChunkBuffer(chunks[nextIdx], token, session, ctx, chunkKey(nextIdx));
        }
        if (quotaExhausted) break; // further chunks will fail the same way — stop early
        if (buffer) {
          const startAt = Math.max(nextStartTimeRef.current, ctx.currentTime);
          // If this chunk got clamped later than intended (a slow fetch let
          // real time catch up to it), the ctx-time-to-content-position
          // mapping just shifted forward by the gap — keep positionOriginRef
          // accurate so rewind()'s "how far in are we" math stays correct.
          if (startAt > nextStartTimeRef.current) positionOriginRef.current += (startAt - nextStartTimeRef.current);
          chunkMarksRef.current.push({ start: contentCursor, end: contentCursor + buffer.duration, buffer });
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(analyserRef.current || ctx.destination);
          source.start(startAt);
          nextStartTimeRef.current = startAt + buffer.duration;
          contentCursor += buffer.duration;
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
        setPaused(false);
        setSpeakingKey(null);
      }
    }
  }, [enabled, isPro, stopSpeaking, fetchChunkBuffer, ensureAudioContext]);

  return {
    speak, stopSpeaking, primeAudio, speaking, ttsError,
    clearTtsError: () => setTtsError(null),
    /** Playback controls — pause/resume/rewind 10s/stop, plus which message (by cacheKey) is currently active. */
    paused, pauseSpeaking, resumeSpeaking, rewindSpeaking, speakingKey,
    /** Read-only: analyser node a consumer can pull frequency data from for an audio-reactive animation. */
    analyserRef,
  };
}
