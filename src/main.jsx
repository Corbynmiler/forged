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
