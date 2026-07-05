// ─── TTS AUDIO CACHE (IndexedDB) ──────────────────────────────────────────────
// Persists synthesized TTS audio bytes across page refreshes, for today only.
// Replaying a message you already heard (or reopening the app mid-day) should
// never re-call ElevenLabs for the same text. In-memory caching alone
// (see useCoachTts.jsx's audioCacheRef) covers replays within one session;
// this covers the same thing surviving a refresh, which the in-memory cache
// can't. Best-effort throughout — any failure here just means a cache miss
// (falls back to a real fetch), never a broken reply.

const DB_NAME = "forged_tts_cache_v1";
const STORE = "chunks";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Returns the cached ArrayBuffer for this key, or null on any miss/failure. */
export async function getCachedTtsChunk(key) {
  try {
    const db = await openDb();
    return await new Promise(resolve => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result?.data ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Stores raw audio bytes for this key, tagged with `day` so pruneStaleTtsCache() can find them later. Fire-and-forget — caller doesn't need to await this. */
export async function putCachedTtsChunk(key, arrayBuffer, day) {
  try {
    const db = await openDb();
    await new Promise(resolve => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, data: arrayBuffer, day });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort — a failed cache write never blocks playback */ }
}

/**
 * Deletes every cached chunk not tagged with today's date. Called once per
 * app session (see useCoachTts.jsx's ensureAudioContext) — "for today only"
 * per the actual request, and keeps this from growing forever across days.
 */
export async function pruneStaleTtsCache(today) {
  try {
    const db = await openDb();
    await new Promise(resolve => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { resolve(); return; }
        if (cursor.value?.day !== today) cursor.delete();
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}
