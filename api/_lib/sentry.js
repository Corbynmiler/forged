// Sentry init for Vercel serverless API routes.
//
// Activated by setting SENTRY_DSN as a Vercel project env var. If the env
// var is absent this module is a complete no-op — captureException() just
// returns silently, no network calls fire, no SDK overhead.
//
// Vercel's Node runtime keeps modules warm between invocations on the same
// instance, so initialising once at module load is correct (and idempotent
// via the `initialised` guard for cold starts after redeploys).
//
// Files in api/_lib/ are NOT treated as routes by Vercel — the underscore
// prefix is the convention for shared helpers under api/.

import * as Sentry from "@sentry/node";

let initialised = false;
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0.1,
    // Disable autoSessionTracking — serverless contexts don't have
    // long-lived sessions and it just adds noise.
    autoSessionTracking: false,
  });
  initialised = true;
}

/** Capture an exception. Safe to call when Sentry isn't configured. */
export function captureException(err, context = {}) {
  if (!initialised) return;
  try {
    Sentry.captureException(err, { extra: context });
  } catch {
    // Never let Sentry itself break the request.
  }
}

/** Wrap a Vercel API handler so any thrown error gets reported to Sentry. */
export function withSentry(handler, routeName) {
  return async function wrapped(req, res) {
    try {
      return await handler(req, res);
    } catch (err) {
      captureException(err, {
        route: routeName || "unknown",
        method: req?.method,
        url: req?.url,
      });
      // Re-throw so existing error handling / Vercel's default 500 still kicks in.
      throw err;
    }
  };
}

export { Sentry };
