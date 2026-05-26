// ─── SPEECH INPUT HOOK + MIC BUTTON ──────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { T } from '../theme.js';

// ─── BROWSER DETECTION HELPERS ───────────────────────────────────────────────
export function isAppleMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iP(hone|od|ad)/.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

/**
 * Use Web Speech alone (no getUserMedia first).
 * - Safari / iOS: avoids double permission prompts.
 * - Chromium (Chrome, Edge, Brave, …): holding a MediaStream for the volume meter while SR runs
 *   often yields no transcripts (meter reacts; recognition stays empty). SR-only fixes that.
 */
export function shouldUseSpeechOnlyMicPath() {
  if (typeof navigator === "undefined") return false;
  if (isAppleMobileDevice()) return true;
  const ua = navigator.userAgent || "";
  if (/Chrome|Chromium|Edg|OPR|CriOS|FxiOS|Brave/i.test(ua)) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS/i.test(ua);
}

/**
 * Chromium: Web Speech often returns "service-not-allowed" if the tab never obtained mic access
 * via getUserMedia. We briefly open the mic, stop tracks, then start SR (no parallel capture).
 * Skip for pure Safari / WebKit-only UAs to avoid an extra permission prompt on iOS/macOS Safari.
 */
export function shouldPrimeMicBeforeWebSpeech() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  const ua = navigator.userAgent || "";
  // Android: skip GUM prime — it often still ends in service-not-allowed; SR-only is enough once site policy allows it.
  if (/Android/i.test(ua)) return false;
  const hasChromiumToken = /Chrome|Chromium|Edg|OPR|CriOS|Brave/i.test(ua);
  const pureWebKitSafari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Brave/i.test(ua);
  return hasChromiumToken && !pureWebKitSafari;
}

/** Mobile Chrome / iOS Chrome: compact URL bar (often Share only); mic is under Chrome Settings, not beside URL. */
export function isLikelyMobileChromeSpeechUi() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Only treat as Chrome when the UA actually indicates Chrome.
  // (The prior coarse-pointer fallback misclassified iOS Safari/PWA as Chrome.)
  return /Android.*Chrome|Chrome.*Android|CriOS/i.test(ua);
}

/**
 * Real-volume metering safety guard. We open a parallel MediaStream just to
 * drive the recording bar's height — but only on desktop, because:
 *  - Android Chromium has historically dropped Web Speech transcripts when a
 *    second mic stream is held in parallel.
 *  - iOS Safari can struggle with two simultaneous audio captures.
 * Modern desktop Chrome/Edge/Safari handle parallel streams cleanly. If a
 * regression appears, this single function is the kill-switch.
 */
export function isDesktopBrowserForMeter() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android|Mobi/i.test(ua)) return false;
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches) return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  return true;
}

/** Android Chrome / Edge on Android: continuous dictation is flaky; short utterances are more reliable. */
export function isAndroidChromiumForSpeech() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua) && /Chrome|Edg|OPR|Brave/i.test(ua);
}

/** Installed “Add to Home Screen” Web App (standalone), including iOS Safari PWA. */
export function isLikelyHomeScreenPwa() {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  } catch { /* ignore */ }
  // iOS-only legacy signal
  return window.navigator?.standalone === true;
}

export function speechUnsupportedHelpMessage() {
  if (isAppleMobileDevice() && isLikelyHomeScreenPwa()) {
    return "Voice input may not work in the installed app. Copy the link and open Forged in Safari, or type instead.";
  }
  return "Voice input isn't available in this browser. Type your entry instead.";
}

export function speechServiceBlockedHelpMessage() {
  if (isLikelyMobileChromeSpeechUi()) {
    return "Chrome won't run voice-to-text on some phones — yours may be one of them. It's not you doing anything wrong. Just type in the box; updating Chrome or using a laptop sometimes fixes it.";
  }
  if (isAppleMobileDevice() && isLikelyHomeScreenPwa()) {
    return "Voice input may not work in this mode. Try opening Forged in Safari, or type your entry instead.";
  }
  return "Voice typing didn't start. Allow the microphone for this site in your browser settings, or type your entry instead.";
}

/** User-visible message when SpeechRecognition.start() or construction fails. */
export function speechMicStartFailedMessage() {
  if (isAppleMobileDevice() && isLikelyHomeScreenPwa()) {
    return "Microphone didn't start in the installed app. Copy the link and open Forged in Safari, or type instead.";
  }
  return "Voice input didn't start. Allow the microphone for this site and try again, or type instead.";
}

/**
 * iOS Home Screen PWA: auto-starting SR after a setTimeout loses the user-gesture
 * chain. Defer to an in-sheet mic tap instead.
 */
export function shouldDeferCoachMicAutoStart() {
  return isAppleMobileDevice() && isLikelyHomeScreenPwa();
}

/** URL to open in Safari (no hash). */
export function forgedShareUrl() {
  if (typeof window === "undefined") return "";
  return window.location.href.split("#")[0];
}

/** Copy the app URL for opening in Safari — reliable from iOS standalone PWA. */
export async function copyForgedUrlToClipboard() {
  const url = forgedShareUrl();
  if (!url) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch { /* fallback below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

// ─── SPEECH UTILITY FUNCTIONS ─────────────────────────────────────────────────
/** BCP-47 tag for SpeechRecognition; bare `en` → `en-US` for broader engine support on Chromium. */
export function speechRecognitionLangTag() {
  if (typeof navigator === "undefined") return "en-US";
  const raw = (navigator.language || "en-US").split(",")[0].trim() || "en-US";
  if (/^en$/i.test(raw)) return "en-US";
  return raw;
}

/** Utterance-boundary → sentence break heuristics are English-tuned (German nouns cap mid-sentence, etc.). */
export function shouldSentenceBreakDictation() {
  if (typeof navigator === "undefined") return true;
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("en");
}

export function pickBestTranscriptFromResult(result) {
  if (!result?.length) return "";
  let best = result[0];
  let bestC =
    typeof best.confidence === "number" && !Number.isNaN(best.confidence) ? best.confidence : -1;
  for (let i = 1; i < result.length; i++) {
    const alt = result[i];
    const c =
      typeof alt.confidence === "number" && !Number.isNaN(alt.confidence) ? alt.confidence : -1;
    if (c > bestC) {
      bestC = c;
      best = alt;
    }
  }
  return (best?.transcript || "").trim();
}

export function polishSpeechWhitespace(s) {
  if (s == null) return "";
  return String(s)
    .replace(/ /g, " ")
    .replace(/[ \t\r\n\f\v]+/g, " ")
    .trim();
}

/** Light cleanup for live interim display (stable, avoids flashy rewrites). */
export function polishInterimDisplay(raw) {
  return polishSpeechWhitespace(raw);
}

/** Per-segment cleanup after Web Speech (final or flushed interim). */
export function polishSpeechSegment(raw) {
  let t = polishSpeechWhitespace(raw);
  if (!t) return "";
  t = t.replace(/\s+([.,!?;:])/g, "$1");
  t = t.replace(/\s+([''])\s*/g, "$1");
  t = t.replace(/\bi\b/g, "I");
  t = t.replace(/\bim\b/gi, "I'm");
  t = t.replace(/\bive\b/gi, "I've");
  t = t.replace(/\bdont\b/gi, "don't");
  t = t.replace(/\bwont\b/gi, "won't");
  t = t.replace(/\bcant\b/gi, "can't");
  t = t.replace(/\bisnt\b/gi, "isn't");
  t = t.replace(/\bdidnt\b/gi, "didn't");
  t = t.replace(/\bwasnt\b/gi, "wasn't");
  t = t.replace(/\bwerent\b/gi, "weren't");
  t = t.replace(/\barent\b/gi, "aren't");
  t = t.replace(/\bwouldnt\b/gi, "wouldn't");
  t = t.replace(/\bcouldnt\b/gi, "couldn't");
  t = t.replace(/\bshouldnt\b/gi, "shouldn't");
  t = t.replace(/\bthats\b/gi, "that's");
  t = t.replace(/\bwhats\b/gi, "what's");
  t = t.replace(/\bheres\b/gi, "here's");
  t = t.replace(/\btheres\b/gi, "there's");
  return t.trim();
}

export function capitalizeFirstWord(s) {
  const t = polishSpeechWhitespace(s);
  if (!t) return t;
  const i = t.search(/[a-zA-Z]/);
  if (i < 0) return t;
  return t.slice(0, i) + t.charAt(i).toUpperCase() + t.slice(i + 1);
}

export function endsWithSentencePunct(s) {
  return /[.!?…]["']?$/.test(String(s || "").trimEnd());
}

export function endsWithClausePunct(s) {
  return /[,;:—-]["']?$/.test(String(s || "").trimEnd());
}

export function firstMeaningfulChar(s) {
  const t = String(s || "").replace(/^['"(\[\s]+/, "");
  return t.charAt(0) || "";
}

/** Merge a new final (or stop-flushed) segment into accumulated dictation. */
export function mergeDictationIntoText(prev, segmentRaw) {
  const next = polishSpeechSegment(segmentRaw);
  const p = (prev || "").trimEnd();
  if (!next) return polishSpeechWhitespace(p);
  if (!p) return capitalizeFirstWord(next);

  if (endsWithSentencePunct(p) || endsWithClausePunct(p)) {
    return polishSpeechWhitespace(`${p} ${next}`);
  }

  const fc = firstMeaningfulChar(next);
  const isLowerStart = /[a-z]/.test(fc);
  if (isLowerStart) {
    return polishSpeechWhitespace(`${p} ${next}`);
  }

  if (shouldSentenceBreakDictation() && /[A-Za-z0-9]/.test(fc)) {
    const firstTok = next.replace(/^['"(\[]+/, "").match(/^(\S+)/)?.[1] || "";
    if (/^[A-Z]{2,5}$/.test(firstTok) && firstTok === firstTok.toUpperCase() && !/\d/.test(firstTok)) {
      return polishSpeechWhitespace(`${p} ${next}`);
    }
    return polishSpeechWhitespace(`${p}. ${capitalizeFirstWord(next)}`);
  }

  return polishSpeechWhitespace(`${p} ${next}`);
}

// ─── useSpeechInput HOOK ─────────────────────────────────────────────────────
export function useSpeechInput(onFinal, opts = {}) {
  const { autoRestart = false, meter = false } = opts;
  const [listening, setListening] = useState(false);
  const [interim,   setInterim]   = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const [speechError, setSpeechError] = useState("");
  // Live recording duration in ms (only relevant when listening). Updated
  // every 200ms while the recognizer is active so the recording bar can show
  // a mm:ss timer without the consumer needing to manage its own interval.
  const [recordingMs, setRecordingMs] = useState(0);
  // R holds mutable refs that must not trigger re-renders
  const R = useRef({ recog:null, stream:null, ctx:null, raf:null, ringEl:null });
  const stopping = useRef(false); // true while we're mid-teardown
  const micSessionRef = useRef(0); // invalidates in-flight getUserMedia if user taps again
  const pendingInterimRef = useRef("");
  // Distinguish a user-initiated stop (tap Stop / unmount) from the browser
  // auto-ending a recognition session. autoRestart only kicks in when the
  // user did NOT initiate the stop and no real error occurred.
  const userStoppedRef = useRef(false);
  const errorOccurredRef = useRef(false);
  const sessionStartRef = useRef(0);
  const tickIntervalRef = useRef(null);
  // Hold autoRestart in a ref so the closure inside beginRecognition can read
  // the latest value without re-binding the callback every render.
  const autoRestartRef = useRef(autoRestart);
  useEffect(() => { autoRestartRef.current = autoRestart; }, [autoRestart]);
  const onFinalRef = useRef(onFinal);
  useEffect(() => { onFinalRef.current = onFinal; }, [onFinal]);
  // Hard cap on a single continuous recording — defensive against runaway
  // sessions if the user walks away with the coach open. Matches typical
  // ChatGPT-style voice limits without being annoying for normal use.
  const SESSION_MAX_MS = 30 * 60 * 1000;
  // Real-volume metering (opt-in, desktop only). Independent of SR's stream.
  // If we can't open this stream the bars fall back to their CSS animation.
  const meterRef = useRef({ stream:null, ctx:null, raf:null, els:[], starting:false, prev:[] });
  const setBarEls = useCallback(els => {
    meterRef.current.els = (els || []).filter(Boolean);
    meterRef.current.prev = meterRef.current.els.map(() => 0.4);
  }, []);
  // Only relevant when `meter:true` is passed by the consumer.
  const meterOptRef = useRef(meter);
  useEffect(() => { meterOptRef.current = meter; }, [meter]);

  const supported = !!(typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition));

  const stopAll = useCallback((fromOnEnd = false) => {
    const r = R.current;
    stopping.current = true;

    // Commit partial dictation before tearing down (avoids losing last phrase on stop / onend races).
    if (r.recog) {
      const tail = polishSpeechSegment(pendingInterimRef.current || "");
      if (tail) {
        try { onFinalRef.current(tail); } catch (e) { console.warn("[speech] interim flush:", e); }
      }
      pendingInterimRef.current = "";
    }

    micSessionRef.current += 1; // cancel any pending async mic start

    // Cancel volume animation
    if (r.raf) { cancelAnimationFrame(r.raf); r.raf = null; }

    // Stop mic stream
    if (r.stream) { r.stream.getTracks().forEach(t => t.stop()); r.stream = null; }

    // Suspend (not close) AudioContext so it can be reused next time.
    // close() on iOS blocks creation of new contexts for ~300ms and causes silent failures.
    if (r.ctx) { try { r.ctx.suspend(); } catch {} }

    // Null out recog FIRST, then stop — this prevents the onend callback
    // (which fires async after stop()) from calling stopAll a second time.
    const recog = r.recog;
    r.recog = null;
    if (!fromOnEnd && recog) { try { recog.stop(); } catch {} }

    if (r.ringEl) { r.ringEl.style.transform = "scale(1)"; r.ringEl.style.opacity = "0"; }
    // Tear down the parallel volume-meter stream / analyser so the bars fall
    // back to their CSS animation on the next start.
    {
      const m = meterRef.current;
      if (m.raf) { cancelAnimationFrame(m.raf); m.raf = null; }
      if (m.stream) { try { m.stream.getTracks().forEach(t => t.stop()); } catch {} m.stream = null; }
      if (m.ctx) { try { m.ctx.suspend(); } catch {} }
      m.starting = false;
      m.els.forEach(el => {
        if (!el) return;
        el.style.transform = "";
        el.style.animation = "";
      });
    }
    if (tickIntervalRef.current) { clearInterval(tickIntervalRef.current); tickIntervalRef.current = null; }
    setListening(false);
    setInterim("");
    setRecordingMs(0);
    // Do not clear pendingInterimRef here — recog.onend may still flush it after stop().

    // Allow restart after a brief settling period
    setTimeout(() => { stopping.current = false; }, 350);
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  const setRingEl = useCallback(el => { R.current.ringEl = el; }, []);

  /** Volume ring — only when a MediaStream is held (non–speech-only path; Chromium uses SR-only). */
  function startVolumeMeter(stream) {
    const r = R.current;
    if (!stream || !r.recog) return;
    if (r.raf) { cancelAnimationFrame(r.raf); r.raf = null; }
    if (!r.ctx) {
      try { r.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return; }
    }
    r.ctx.resume().catch(() => {});
    try {
      const analyser = r.ctx.createAnalyser();
      analyser.fftSize = 64;
      r.ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!R.current.recog) return;
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        const v = Math.min(1, avg / 48);
        const el = R.current.ringEl;
        if (el) { el.style.transform = `scale(${1 + v * 0.65})`; el.style.opacity = String(Math.max(0.12, v)); }
        R.current.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn("[speech] volume meter:", e);
    }
  }

  /**
   * Parallel volume meter — opens its OWN MediaStream just to drive the
   * recording bar's height in real time. Independent of SpeechRecognition's
   * audio source. Desktop-only (see isDesktopBrowserForMeter); on mobile we
   * deliberately skip and let the CSS animation play instead.
   *
   * Failure modes are silent on purpose: if the user denies the additional
   * permission prompt, or if AudioContext can't initialise, the bars just
   * fall back to their CSS animation. Recording itself is unaffected.
   */
  async function startMeterStream() {
    const m = meterRef.current;
    if (m.starting || m.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    m.starting = true;
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
      });
    } catch {
      m.starting = false;
      return;
    }
    // If recording was stopped between the await and now, drop the stream.
    if (!R.current.recog) {
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      m.starting = false;
      return;
    }
    try {
      if (!m.ctx) m.ctx = new (window.AudioContext || window.webkitAudioContext)();
      m.ctx.resume().catch(() => {});
      const analyser = m.ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.55;
      m.ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      m.stream = stream;
      m.starting = false;
      m.prev = (m.els || []).map(() => 0.4);
      // Per the CSS spec, animations override inline `transform` unless the
      // animation itself is removed. Disable the keyframe animation on each
      // bar so our rAF-driven inline transform takes effect; stopAll() puts
      // it back so the next session falls back cleanly when needed.
      (m.els || []).forEach(el => { if (el) el.style.animation = "none"; });
      const tick = () => {
        if (!m.stream || !R.current.recog) return;
        analyser.getByteFrequencyData(buf);
        // RMS-style level across the spectrum, normalised to 0..1.
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length) / 255;
        // Boost so normal speaking voice maps roughly to 0.4–0.9.
        const v = Math.min(1, rms * 3);
        const els = m.els;
        if (els && els.length) {
          const now = performance.now() / 1000;
          for (let i = 0; i < els.length; i++) {
            // Per-bar phase wobble keeps the row organic instead of moving
            // as a single block.
            const wobble = 0.55 + 0.45 * Math.sin(i * 0.55 + now * 6);
            const target = 0.22 + 0.78 * v * (0.55 + 0.45 * wobble);
            const cur = m.prev[i] ?? 0.3;
            // Smooth toward target (faster on the way up than on the way
            // down so the bars feel responsive but don't jitter).
            const k = target > cur ? 0.55 : 0.25;
            const next = cur + (target - cur) * k;
            m.prev[i] = next;
            const el = els[i];
            if (el) el.style.transform = `scaleY(${next.toFixed(3)})`;
          }
        }
        m.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn("[speech] meter stream:", e);
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      m.stream = null;
      m.starting = false;
      // Defensive: if we'd already disabled the bar animation, put it back.
      (m.els || []).forEach(el => {
        if (!el) return;
        el.style.transform = "";
        el.style.animation = "";
      });
    }
  }

  const beginRecognition = useCallback((stream, session) => {
    // Session bump (from stopAll) invalidates in-flight starts; do not also gate on stopping —
    // that ref stays true briefly after stop and would swallow the next tap on mobile.
    if (session !== micSessionRef.current) {
      stream?.getTracks().forEach(t => t.stop());
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recog;
    try {
      recog = new SR();
    } catch (e) {
      console.warn("[speech] SpeechRecognition constructor:", e);
      stream?.getTracks().forEach(t => t.stop());
      setSpeechError(speechMicStartFailedMessage());
      return;
    }

    // iOS WebKit: continuous=true often stops immediately. Android Chromium: short runs are more reliable.
    recog.continuous = stream ? true : (!isAppleMobileDevice() && !isAndroidChromiumForSpeech());
    recog.interimResults = true;
    recog.lang = speechRecognitionLangTag();
    try {
      recog.maxAlternatives = 5;
    } catch {
      /* some engines cap or ignore */
    }

    recog.onstart = () => {
      pendingInterimRef.current = "";
      setMicBlocked(false);
      setSpeechError("");
      setListening(true);
      // First start of this user-initiated session — record start time for
      // the duration cap and the live mm:ss timer. Auto-restarts of the same
      // logical session don't reset the start time.
      if (!sessionStartRef.current) {
        sessionStartRef.current = Date.now();
        setRecordingMs(0);
        if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = setInterval(() => {
          if (sessionStartRef.current) setRecordingMs(Date.now() - sessionStartRef.current);
        }, 200);
      }
      // Opt-in: kick off a parallel mic stream just for live volume metering.
      // Only on desktop browsers — see isDesktopBrowserForMeter() for why.
      // Restarts of the same session reuse the existing meter stream, so we
      // gate on `meter.starting` and `meter.stream` to start exactly once.
      if (meterOptRef.current && isDesktopBrowserForMeter()) {
        const m = meterRef.current;
        if (!m.stream && !m.starting) startMeterStream();
      }
    };

    recog.onresult = e => {
      let iText = "";
      for (let j = e.resultIndex; j < e.results.length; j++) {
        const row = e.results[j];
        if (row.isFinal) {
          const t = pickBestTranscriptFromResult(row);
          const polished = polishSpeechSegment(t);
          if (polished) onFinalRef.current(polished);
          pendingInterimRef.current = "";
          setInterim("");
        } else {
          iText += pickBestTranscriptFromResult(row) || "";
        }
      }
      if (iText) {
        pendingInterimRef.current = iText;
        setInterim(polishInterimDisplay(iText));
      }
    };

    recog.onerror = (ev) => {
      const code = ev?.error || "";
      if (code === "aborted") return;
      // In auto-restart mode "no-speech" is the *expected* nudge to
      // re-arm — the user just paused briefly between sentences. Suppress
      // the error and let onend trigger a restart.
      if (autoRestartRef.current && code === "no-speech") return;
      errorOccurredRef.current = true;
      if (code === "not-allowed") setMicBlocked(true);
      const friendly = {
        "not-allowed": "Microphone access was denied. Allow the mic for this site and try again.",
        "service-not-allowed": speechServiceBlockedHelpMessage(),
        "network": "Could not reach speech recognition. Check your connection and try again.",
        "no-speech": "No speech was detected. Speak a bit louder or closer to the mic, then try again.",
        "audio-capture": "The microphone is not available or is being used by another app.",
        "bad-grammar": "Voice recognition hit an error. Try again with a shorter phrase.",
      };
      setSpeechError(friendly[code] || `Voice input stopped (${code}). You can try again or type instead.`);
      console.warn("[speech] recognition:", code, ev?.message || "");
      stopAll();
    };

    recog.onend = () => {
      // Auto-restart for continuous-until-user-stops mode (AI coach, etc.).
      // The browser ends recognition after each utterance on iOS Safari and
      // Android Chromium, and after long pauses on desktop Chrome — we want
      // to seamlessly re-arm so the user can keep talking without tapping
      // the mic again. Synchronous restart inside onend preserves the user
      // activation gesture on iOS, where a setTimeout would lose it.
      if (
        autoRestartRef.current &&
        !userStoppedRef.current &&
        !errorOccurredRef.current &&
        sessionStartRef.current &&
        Date.now() - sessionStartRef.current < SESSION_MAX_MS
      ) {
        setInterim("");
        pendingInterimRef.current = "";
        if (R.current.recog === recog) R.current.recog = null;
        beginRecognition(R.current.stream, micSessionRef.current);
        return;
      }
      setListening(false);
      setInterim("");
      if (R.current.recog === recog) stopAll(true);
    };

    R.current.recog = recog;
    R.current.stream = stream || null;

    try {
      recog.start();
      if (stream) startVolumeMeter(stream);
    } catch (e) {
      console.warn("[speech] recog.start:", e);
      setSpeechError(speechMicStartFailedMessage());
      stopAll();
    }
    // onFinal intentionally omitted — we read it via onFinalRef so this
    // callback stays stable across renders and the auto-restart self-call
    // resolves to the right instance.
  }, [stopAll]);

  const toggle = useCallback(() => {
    if (listening) {
      // Mark as user-initiated so onend's auto-restart path bails out.
      userStoppedRef.current = true;
      sessionStartRef.current = 0;
      stopAll();
      return;
    }
    // New tap to start: lift post-stop debounce so the next press is never a no-op (mobile Chrome).
    stopping.current = false;
    userStoppedRef.current = false;
    errorOccurredRef.current = false;
    sessionStartRef.current = 0;

    if (!supported) {
      alert(speechUnsupportedHelpMessage());
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      alert("Voice input needs a secure connection (HTTPS).");
      return;
    }

    setMicBlocked(false);
    setSpeechError("");

    if (shouldUseSpeechOnlyMicPath()) {
      const session = ++micSessionRef.current;
      if (shouldPrimeMicBeforeWebSpeech()) {
        void (async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            stream.getTracks().forEach(t => t.stop());
            // Do not insert setTimeout here — Chrome drops user activation before SpeechRecognition.start().
          } catch (err) {
            console.warn("[speech] mic prime:", err?.name, err?.message);
            const n = err?.name || "";
            if (n === "NotAllowedError" || n === "PermissionDeniedError" || n === "SecurityError") {
              setMicBlocked(true);
            } else {
              setSpeechError("Could not open the microphone for voice typing. Check that no other app is using the mic, then try again.");
            }
            return;
          }
          if (session !== micSessionRef.current) return;
          beginRecognition(null, session);
        })();
        return;
      }
      beginRecognition(null, session);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Microphone access is not available in this browser.");
      return;
    }

    const session = ++micSessionRef.current;
    void (async () => {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (err) {
        console.warn("[speech] getUserMedia:", err?.name, err?.message);
        const n = err?.name || "";
        if (n === "NotAllowedError" || n === "PermissionDeniedError" || n === "SecurityError") {
          setMicBlocked(true);
        }
        return;
      }

      if (session !== micSessionRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      beginRecognition(stream, session);
    })();
  }, [listening, supported, stopAll, beginRecognition]);

  // Cancel = stop without committing the current interim. Used by the AI
  // coach's recording-bar "×" button to discard a recording the user
  // doesn't want to send. Still safe for non-autoRestart consumers.
  const cancel = useCallback(() => {
    userStoppedRef.current = true;
    sessionStartRef.current = 0;
    pendingInterimRef.current = "";
    stopAll();
  }, [stopAll]);

  return { listening, interim, toggle, cancel, supported, setRingEl, setBarEls, micBlocked, speechError, recordingMs };
}

// ─── MIC BUTTON COMPONENT ─────────────────────────────────────────────────────
export function MicBtn({ speech, color = T.accent, size = 28, prominent = false, locked = false, onLockedClick }) {
  // Touch: touchend (activation). Mouse/pen: pointerdown + suppress duplicate click (Chrome desktop).
  const suppressClickRef = useRef(false);
  const supported = !!speech.supported;
  const blocked = !!speech.micBlocked;
  const c = !supported ? T.muted : (speech.listening ? color : blocked ? T.muted : locked ? T.gold : prominent ? color : T.hint);
  const label = !supported ? "Voice input unavailable" : (locked ? "Voice dumps are a Pro feature" : speech.listening ? "Stop dictation" : blocked ? "Microphone blocked" : "Start dictation");
  const idleBorder = locked ? "rgba(200,144,42,0.45)" : blocked ? T.border : prominent ? `${color}55` : T.border;
  const idleBg = locked ? "rgba(200,144,42,0.10)" : blocked ? "transparent" : prominent ? `${color}16` : "transparent";
  function handleActivate() {
    if (locked) { onLockedClick?.(); return; }
    if (!supported) { alert(speechUnsupportedHelpMessage()); return; }
    speech.toggle();
  }
  return (
    <>
      <style>{`
        @keyframes coachMicPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.55; }
        }
      `}</style>
    <button
      type="button"
      aria-label={label}
      title={locked ? "Voice dumps — tap to unlock with Pro" : speech.listening ? "Tap to stop" : blocked ? "Microphone blocked" : "Tap to dictate"}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.pointerType === "touch") return;
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 400);
        e.preventDefault();
        handleActivate();
      }}
      onTouchEnd={(e) => {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 400);
        if (e.cancelable) e.preventDefault();
        handleActivate();
      }}
      onClick={(e) => {
        e.preventDefault();
        if (suppressClickRef.current) return;
        handleActivate();
      }}
      style={{ position:"relative", width:size, height:size, borderRadius:"50%",
        border:`1px solid ${supported && speech.listening ? color+"55" : idleBorder}`,
        background: supported && speech.listening ? color+"14" : idleBg,
        boxShadow: prominent && !speech.listening && !blocked && !locked ? `0 0 0 1px ${color}0d` : "none",
        cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
        flexShrink:0, padding:0, transition:"border-color 0.2s, background 0.2s, box-shadow 0.2s",
        touchAction:"manipulation", WebkitTapHighlightColor:"transparent" }}>
      {supported && speech.listening ? (
        <span
          aria-hidden
          style={{
            position:"absolute", top:3, right:3, width:7, height:7, borderRadius:"50%",
            background:"#e53935", boxShadow:"0 0 0 1px rgba(0,0,0,0.2)",
            animation:"coachMicPulse 1.1s ease-in-out infinite", pointerEvents:"none",
          }}
        />
      ) : null}
      {/* Locked: tiny gold lock dot so it reads as Pro at a glance. */}
      {locked && !speech.listening ? (
        <span aria-hidden style={{
          position:"absolute", top:-2, right:-2, width:12, height:12, borderRadius:"50%",
          background:T.gold, color:"#0F0F0D",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:7, fontWeight:800, letterSpacing:"0.02em",
          border:"1px solid #0F0F0D", pointerEvents:"none",
        }}>P</span>
      ) : null}
      {/* volume ring — animated via direct DOM in RAF loop, no React state */}
      <div ref={speech.setRingEl} style={{ position:"absolute", inset:-5, borderRadius:"50%",
        border:`1.5px solid ${color}`, opacity:0, transform:"scale(1)", pointerEvents:"none",
        transition: speech.listening ? "none" : "opacity 0.5s" }}/>
      {/* mic icon (crossed out when permission denied) */}
      <svg width={size*0.56} height={size*0.56} viewBox="0 0 16 16" fill="none" style={{ color:c, transition:"color 0.2s" }}>
        <rect x="5" y="1" width="6" height="8" rx="3" fill="currentColor"/>
        <path d="M3 7.5a5 5 0 0 0 10 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
        <line x1="8" y1="12.5" x2="8" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="5.5" y1="14.5" x2="10.5" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        {blocked ? (
          <line x1="1.5" y1="1.5" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : null}
      </svg>
    </button>
    </>
  );
}
