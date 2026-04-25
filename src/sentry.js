// Sentry init for the React app.
//
// Activated by setting VITE_SENTRY_DSN at build time. If the env var is
// absent (e.g. local dev with no DSN, or PR previews), this file is a
// complete no-op — Sentry is never initialised, no network requests fire,
// and bundle impact is minimal because the SDK only spins up after init().
//
// Set VITE_PUBLIC_VERCEL_ENV to "production" | "preview" | "development"
// in vercel.json or via Vercel project env vars to tag events with the
// deploy environment. Falls back to import.meta.env.MODE otherwise.

import * as Sentry from "@sentry/react";

let initialised = false;

export function initSentry() {
  if (initialised) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      import.meta.env.VITE_PUBLIC_VERCEL_ENV ||
      import.meta.env.MODE ||
      "development",
    release: import.meta.env.VITE_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
    // Conservative: full error capture, modest perf sampling. Ratchet up
    // tracesSampleRate once you've confirmed Sentry quota headroom.
    tracesSampleRate: 0.1,
    // Don't send 4xx fetch errors as breadcrumbs noise.
    sendDefaultPii: false,
  });

  initialised = true;
}

export { Sentry };
