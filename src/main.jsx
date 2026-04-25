import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import App from "./App.jsx";
import { initSentry, Sentry } from "./sentry.js";

// Sentry must init before render so it captures setup errors.
// No-ops when VITE_SENTRY_DSN is unset.
initSentry();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[Forged] SW registration failed:", err));
  });
}

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
          The app hit an unexpected error. We've been notified. Try reloading.
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

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={CrashFallback}>
      <App />
    </Sentry.ErrorBoundary>
    {/* Vercel Analytics + Speed Insights — both no-op outside Vercel hosting */}
    <Analytics />
    <SpeedInsights />
  </StrictMode>
);
