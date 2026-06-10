# Forged — agent guidance

This file is read by Cursor, Claude Code, and any other agent supporting `AGENTS.md`. It encodes the conventions of this repo so agents stop suggesting patterns that don't fit.

## What Forged is

Forged is a habit / goal / coach app. Stack:

- **Frontend**: Vite + React 19, `src/App.jsx` (~3.6k lines, router shell only) + extracted modules in `src/components/`, `src/screens/`, `src/hooks/`, `src/coach/`, `src/theme.js`, `src/utils.js`
- **Backend**: Vercel serverless functions in `api/*.js` (Node, ESM)
- **DB / Auth**: Supabase (Postgres + Auth + Realtime), migrations in `supabase/migrations/`
- **AI coach**: `@anthropic-ai/sdk` directly, model `claude-haiku-4-5`, custom SSE streaming, Anthropic tool-use loop
- **Payments**: Stripe (Checkout + Customer Portal + webhook)
- **Push**: `web-push` with VAPID keys
- **Hosting**: Vercel
- **Observability**: Vercel Analytics (optional, free tier — enable in dashboard). Server-side `@sentry/node` is wired in `api/_lib/sentry.js` but is a **no-op until `SENTRY_DSN` is set** — skip that until you want error tracking. No Speed Insights (paid).

Hard constraints:

- **No TypeScript** (deliberate for now — revisit after `App.jsx` is split)
- **No Tailwind / no CSS-in-JS lib** — inline styles only, using the `T` design-token object in `App.jsx`
- **No Next.js** — Vite SPA, do not suggest App Router patterns
- **No new UI frameworks** (no shadcn / Radix / Chakra / Mantine) — they conflict with the bespoke design system

## Conventions to follow

### Dates

Habit log dates **must** land on the user's local calendar day, not UTC. The pattern:

- Client computes `todayStr()` (local YYYY-MM-DD) and sends it as `client_date`
- Server validates via `safeClientDate()` and falls back to UTC only if missing/invalid
- Never call `new Date().toISOString().slice(0,10)` on the server when the result will be stored as a user-facing log date

See the comment block at the top of `api/chat.js` for the canonical implementation.

### API routes

Every route in `api/` follows this shape:

```js
import { withSentry } from "./_lib/sentry.js";
// ...other imports

async function handler(req, res) {
  // ...
}

export default withSentry(handler, "route-name");
```

For routes that catch their own errors (SSE streams, Stripe webhook), also call `captureException(err, { route, ...context })` inside the catch — it only reports when `SENTRY_DSN` is set.

### Auth in API routes

```js
const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
if (!token) return res.status(401).json({ error: "Not authenticated" });

const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
});
const { data: { user }, error } = await userClient.auth.getUser();
if (error || !user?.id) return res.status(401).json({ error: "Invalid token" });

// Use service role client ONLY after auth has been verified
const db = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
```

The Supabase anon key is hardcoded in `src/supabase.js` and route files — that's intentional, it's a public key. Don't try to "fix" it.

### Anthropic / AI cost discipline

- Default model is `claude-haiku-4-5`. Do not silently swap to Sonnet/Opus.
- `api/chat.js` uses **prompt caching** (`cache_control: { type: "ephemeral" }`) on the tools array and system prompt (all `messages.create` / `messages.stream` paths). `api/coach-summary.js` caches the stable system prompt the same way. Don't strip these.
- Free-tier daily quota is 5/day, enforced server-side via the `chat_usage` table (`FREE_DAILY_LIMIT` in both `api/chat.js` and `src/theme.js` — keep in sync). Client-side cap exists too but is not authoritative.
- `trimmedMessages = messages.slice(-12)` keeps context small. If you're tempted to raise this, consider cost first.
- Tools are executed sequentially (not in parallel) because the model sometimes calls `create_habit` then `log_habit` on the new habit in one turn.

### Design tokens

All colors, spacing, fonts come from the `T` object near the top of `App.jsx`:

```js
const T = {
  bg:"#0F0F0D", surface:"#1A1A16", raised:"#222220",
  border:"rgba(255,255,255,0.07)", ...
  accent:"#C0392B", gold:"#C8902A", green:"#27AE60", amber:"#E67E22",
  font:"'DM Sans',system-ui,sans-serif",
  serif:"'DM Serif Display',Georgia,serif",
};
```

Do not introduce raw hex values in components — use `T.*`.

### Supabase migrations

Sequentially numbered + dated: `YYYYMMDDHHMMSS_short_name.sql`. New migrations go in `supabase/migrations/`. Don't edit migrations that have already been applied to production.

### Stripe

- Checkout session created in `api/create-checkout.js`
- Customer portal in `api/create-portal-session.js`
- Webhook in `api/stripe-webhook.js` — `bodyParser: false` is required for signature verification, do not remove it
- `profiles.is_pro` and `profiles.stripe_customer_id` are the source of truth

### Push notifications

- VAPID keys in env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Subscriptions stored in `push_subscriptions` table
- Cron at `/api/cron-reminders` runs every 5 min (see `vercel.json`)
- Stale 404/410 subscriptions are auto-pruned

## Splitting App.jsx — when, not whether

`src/App.jsx` is a large monolithic file by design. When you eventually split it, the target structure is:

```
src/
  App.jsx              # router + top-level shell only
  main.jsx             # entry (current)
  supabase.js          # current
  lib/
    dates.js           # todayStr, daysAgo, parseLocal, fmtDate, weekStartFor, etc.
    streaks.js         # getDailyStreak, getWeeklyStreak, etc.
    push.js            # urlBase64ToUint8Array + subscription helpers
    coach.js           # client-side coach helpers
  hooks/
    useHabits.js
    useGoals.js
    useProfile.js
  screens/
    TodayScreen.jsx
    HabitsScreen.jsx
    GoalsScreen.jsx
    CoachScreen.jsx
    SettingsScreen.jsx
  components/
    HabitCard.jsx
    GoalCard.jsx
    Sheet.jsx
    Modal.jsx
    Toast.jsx
```

**Do not start this split unsolicited.** If asked to split, do it incrementally — extract `lib/dates.js` first (purely functional, no dependencies), verify build, commit, then move on.

## Things to avoid

- Don't suggest TypeScript migration unless explicitly asked
- Don't suggest moving to Next.js or next-forge
- Don't suggest installing shadcn/ui, Radix, Chakra, MUI, or any UI kit
- Don't add ESLint/Prettier piecemeal — if linting is wanted, install Biome (`@biomejs/biome`) instead
- Don't replace inline styles with CSS files or styled-components
- Don't proactively bump dependencies major versions
- Don't widen the `messages.slice(-12)` chat history cap without discussing cost
- Don't strip the `cache_control` blocks from `api/chat.js` — they're saving real money

## Useful local commands

```sh
npm run dev      # vite dev server
npm run build    # production build
npm run preview  # preview the production build locally
```

There is no test runner installed. There is no linter installed.

## Environment variables

Local dev: `.env.local` (gitignored). Production: Vercel project env vars.

Required:
- `ANTHROPIC_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_ANNUAL_PRICE_ID`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `CRON_SECRET` (Vercel sets this automatically on cron invocations when set as project env var)

Optional (observability — fail safely when missing):
- `SENTRY_DSN` — Node Sentry for API routes (omit until you set up Sentry)
- `VITE_PUBLIC_VERCEL_ENV` — e.g. `production` | `preview` (if you add client telemetry later)

### Cursor + Supabase MCP

`.cursor/mcp.json` mirrors `.claude/settings.json`: Supabase hosted MCP for this project (`project_ref` in the URL). First use may open a browser login to Supabase. If Cursor expects a different MCP schema on your version, see [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol).
