import { StrictMode, Component } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App.jsx";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[Forged] SW registration failed:", err));
  });
}

// ─── Stale-PWA detector ────────────────────────────────────────────────────
// index.html is already served no-cache (see vercel.json) and every build
// gets a uniquely-hashed JS bundle — so a plain reload always picks up the
// latest deploy. But iOS keeps a home-screen web app's WKWebView process
// alive in the background rather than reloading it on every icon tap; the
// app can just resume the SAME in-memory session from days ago, headers or
// not, since no network request happens at all. Not a caching bug — there's
// nothing to purge — so the fix is a version check on resume, offering a
// manual refresh (never automatic — that could cut off an in-progress
// conversation or dictation).
(function watchForStaleBuild() {
  const currentSrc = document.querySelector('script[type="module"]')?.src || "";
  if (!currentSrc) return; // dev server serves an unhashed path — nothing meaningful to compare
  let lastCheckAt = 0;

  async function check() {
    const now = Date.now();
    if (now - lastCheckAt < 30000) return; // debounce rapid focus/visibility events
    lastCheckAt = now;
    try {
      const res = await fetch("/index.html", { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.text();
      const scriptTag = (html.match(/<script\b[^>]*>/g) || [])
        .find(tag => /type=["']module["']/.test(tag) && /src=/.test(tag));
      const latestSrc = scriptTag?.match(/src=["']([^"']+)["']/)?.[1];
      if (!latestSrc) return;
      const latestPath = new URL(latestSrc, window.location.origin).pathname;
      const currentPath = new URL(currentSrc, window.location.origin).pathname;
      if (latestPath && currentPath && latestPath !== currentPath) showBanner();
    } catch {
      // offline, or the fetch was blocked — never let this affect the app itself
    }
  }

  function showBanner() {
    if (document.getElementById("forged-update-banner")) return;
    const bar = document.createElement("div");
    bar.id = "forged-update-banner";
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#C8902A;color:#0F0F0D;" +
      "font:600 13px 'DM Sans',system-ui,sans-serif;padding:10px 16px;display:flex;" +
      "align-items:center;justify-content:center;gap:10px;" +
      "padding-bottom:calc(10px + env(safe-area-inset-bottom, 0px));";
    const label = document.createElement("span");
    label.textContent = "A newer version of Forged is ready.";
    const btn = document.createElement("button");
    btn.textContent = "Refresh";
    btn.style.cssText =
      "background:#0F0F0D;color:#F0EDE6;border:none;border-radius:8px;padding:6px 12px;" +
      "font:600 12px 'DM Sans',system-ui,sans-serif;cursor:pointer;";
    btn.onclick = () => window.location.reload();
    bar.appendChild(label);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("pageshow", check);
})();

function CrashFallback({ resetError }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0F0F0D", color: "#F0EDE6", fontFamily: "'DM Sans',system-ui,sans-serif",
      padding: 24, textAlign: "center",
    }}>
      <div style={{ maxWidth: 360 }}>
        <div style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 28, marginBottom: 12 }}>
          Something broke.
        </div>
        <div style={{ color: "#A8A49C", marginBottom: 20, lineHeight: 1.5 }}>
          The app hit an unexpected error. Try reloading. If it keeps happening, check the browser console.
        </div>
        <button
          onClick={() => { resetError?.(); window.location.reload(); }}
          style={{
            background: "#C0392B", color: "#F0EDE6", border: "none",
            padding: "10px 18px", borderRadius: 10, fontWeight: 600, cursor: "pointer",
          }}
        >
          Reload Forged
        </button>
      </div>
    </div>
  );
}

/** Lightweight boundary — no third-party service; logs to console only. */
class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[Forged] App crashed:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <CrashFallback
          resetError={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    {/* Vercel Analytics: free tier; enable in project dashboard if you want data */}
    <Analytics />
  </StrictMode>
);
