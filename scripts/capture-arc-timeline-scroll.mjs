/**
 * Capture R5_arc_week_timeline_scroll.webm
 * Shows the Arc page scrolling through the full week-by-week timeline.
 * ~12 seconds: settle on Arc overview → scroll slowly through W1→W2→W3 evidence spine.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'path';
import fs from 'fs';

const UID      = 'ac1e6500-0511-4ce2-801a-eccf7a328027';
const BLOCK_ID = 'a0600001-0001-4001-8001-000000000001';

// Generate a fresh JWT at runtime — the Supabase JS client checks exp locally,
// so a hardcoded token that has expired causes an auth error screen.
function makeJWT() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header  = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    iss: 'https://apdmvbzfjuvxworjepze.supabase.co/auth/v1',
    sub: UID, aud: 'authenticated',
    exp: now + 86400 * 365, iat: now,
    email: 'cheesefingersathotmail.co.n@gmail.com', phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { email: 'cheesefingersathotmail.co.n@gmail.com', email_verified: true, phone_verified: false, sub: UID },
    role: 'authenticated', aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    session_id: '63b8dd01-2e38-4d5c-9ebd-1dbbf8c9944e',
    is_anonymous: false,
  });
  return `${header}.${payload}.ZmFrZXNpZ25hdHVyZQ`;
}
const ACCESS_TOKEN = makeJWT();

const USER_OBJ = {
  id: UID, aud: 'authenticated', role: 'authenticated',
  email: 'cheesefingersathotmail.co.n@gmail.com',
  email_confirmed_at: '2026-06-13T03:22:53.000Z', phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { email: 'cheesefingersathotmail.co.n@gmail.com', email_verified: true, phone_verified: false, sub: UID },
  created_at: '2026-06-13T03:22:53.000Z', updated_at: '2026-06-13T03:22:53.000Z',
};

const SESSION = JSON.stringify({
  access_token: ACCESS_TOKEN, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 365, refresh_token: 'mock-refresh', user: USER_OBJ,
});

const PROFILE = [{ id: UID, name: 'Molly', avatar_url: '🐼', onboarded: true, created_at: '2026-04-25T13:22:24.215124+00:00', updated_at: '2026-06-13T03:17:11.131+00:00' }];

const FORGE_BLOCKS = [{
  id: BLOCK_ID, user_id: UID,
  identity: 'The person who ships proof, not promises',
  why_statement: "Because I've been 'almost ready' for two years. This time I'm building evidence instead of waiting for motivation.",
  old_pattern: 'Planning without shipping. Starting without finishing. Telling myself I need more preparation.',
  minimum_proof: 'One focused deep work session. Show up even when it feels mechanical.',
  start_date: '2026-05-24', end_date: '2026-07-04', status: 'active', duration_days: 42,
  review: null, created_at: '2026-06-13T02:03:48.735221+00:00', updated_at: '2026-06-13T03:33:12.62+00:00',
  title: 'Build the System', arc_xp: 490, completion_score: '71', arc_rank: 'Tempered',
}];

const HABITS = [
  { id: 'a0600001-0001-4001-8001-000000000011', user_id: UID, name: 'Deep work session', emoji: '🎯', habit_type: 'daily', color: '#2980B9', streak: 7, best_streak: 12, reflection: true, reflection_prompt: '', weekly_target: null, start_value: null, target_value: null, unit: null, daily_budget: null, tap_increment: 1, daily_target_minutes: null, block_id: BLOCK_ID, is_proof_action: true, logs: [{ date: '2026-06-06', value: true }, { date: '2026-06-07', value: true }, { date: '2026-06-08', value: true }, { date: '2026-06-09', value: true }, { date: '2026-06-10', value: true }, { date: '2026-06-11', value: true }, { date: '2026-06-12', value: true }], goal_aim: 'maintain', original_budget: null, created_at: '2026-06-13T02:04:11.271332+00:00', updated_at: '2026-06-13T02:04:11.271332+00:00' },
  { id: 'a0600001-0001-4001-8001-000000000012', user_id: UID, name: 'Move daily', emoji: '🏃', habit_type: 'daily', color: '#27AE60', streak: 4, best_streak: 8, reflection: true, reflection_prompt: '', weekly_target: null, start_value: null, target_value: null, unit: null, daily_budget: null, tap_increment: 1, daily_target_minutes: null, block_id: BLOCK_ID, is_proof_action: true, logs: [{ date: '2026-06-06', value: true }, { date: '2026-06-07', value: true }, { date: '2026-06-09', value: true }, { date: '2026-06-10', value: true }, { date: '2026-06-11', value: true }, { date: '2026-06-12', value: true }], goal_aim: 'maintain', original_budget: null, created_at: '2026-06-13T02:04:11.271332+00:00', updated_at: '2026-06-13T02:04:11.271332+00:00' },
  { id: 'a0600001-0001-4001-8001-000000000013', user_id: UID, name: 'No doom scroll before 9am', emoji: '📵', habit_type: 'daily', color: '#E67E22', streak: 7, best_streak: 7, reflection: false, reflection_prompt: '', weekly_target: null, start_value: null, target_value: null, unit: null, daily_budget: null, tap_increment: 1, daily_target_minutes: null, block_id: BLOCK_ID, is_proof_action: true, logs: [{ date: '2026-06-06', value: true }, { date: '2026-06-07', value: true }, { date: '2026-06-08', value: true }, { date: '2026-06-09', value: true }, { date: '2026-06-10', value: true }, { date: '2026-06-11', value: true }, { date: '2026-06-12', value: true }], goal_aim: 'maintain', original_budget: null, created_at: '2026-06-13T02:04:11.271332+00:00', updated_at: '2026-06-13T02:04:11.271332+00:00' },
  { id: 'a0600001-0001-4001-8001-000000000014', user_id: UID, name: 'Post one useful thing', emoji: '📤', habit_type: 'daily', color: '#9B59B6', streak: 1, best_streak: 3, reflection: true, reflection_prompt: '', weekly_target: null, start_value: null, target_value: null, unit: null, daily_budget: null, tap_increment: 1, daily_target_minutes: null, block_id: BLOCK_ID, is_proof_action: true, logs: [{ date: '2026-06-07', value: true }, { date: '2026-06-08', value: true }, { date: '2026-06-12', value: true }], goal_aim: 'maintain', original_budget: null, created_at: '2026-06-13T02:04:11.271332+00:00', updated_at: '2026-06-13T02:04:11.271332+00:00' },
  { id: 'a0600001-0001-4001-8001-000000000015', user_id: UID, name: 'Evening check-in', emoji: '🌙', habit_type: 'daily', color: '#1ABC9C', streak: 1, best_streak: 6, reflection: true, reflection_prompt: '', weekly_target: null, start_value: null, target_value: null, unit: null, daily_budget: null, tap_increment: 1, daily_target_minutes: null, block_id: BLOCK_ID, is_proof_action: true, logs: [{ date: '2026-06-06', value: true }, { date: '2026-06-07', value: true }, { date: '2026-06-08', value: true }, { date: '2026-06-09', value: true }, { date: '2026-06-10', value: true }, { date: '2026-06-12', value: true }], goal_aim: 'maintain', original_budget: null, created_at: '2026-06-13T02:04:11.271332+00:00', updated_at: '2026-06-13T02:04:11.271332+00:00' },
];

const ARC_DAILY_SCORES = [
  { id: '1c7dc369', user_id: UID, block_id: BLOCK_ID, date: '2026-05-24', proof_total: 5, proof_done: 3, arc_xp_awarded: 18, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: 'c6c9d851', user_id: UID, block_id: BLOCK_ID, date: '2026-05-25', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '240b8d08', user_id: UID, block_id: BLOCK_ID, date: '2026-05-26', proof_total: 5, proof_done: 5, arc_xp_awarded: 40, perfect_day: true, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: 'cdece9cc', user_id: UID, block_id: BLOCK_ID, date: '2026-05-27', proof_total: 5, proof_done: 3, arc_xp_awarded: 18, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '17ea475c', user_id: UID, block_id: BLOCK_ID, date: '2026-05-28', proof_total: 5, proof_done: 2, arc_xp_awarded: 12, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '2cdcf167', user_id: UID, block_id: BLOCK_ID, date: '2026-05-29', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '3fa32685', user_id: UID, block_id: BLOCK_ID, date: '2026-05-30', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '5d61acc9', user_id: UID, block_id: BLOCK_ID, date: '2026-05-31', proof_total: 5, proof_done: 5, arc_xp_awarded: 40, perfect_day: true, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: 'b88e405e', user_id: UID, block_id: BLOCK_ID, date: '2026-06-01', proof_total: 5, proof_done: 3, arc_xp_awarded: 18, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '470f1934', user_id: UID, block_id: BLOCK_ID, date: '2026-06-02', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '704483ab', user_id: UID, block_id: BLOCK_ID, date: '2026-06-03', proof_total: 5, proof_done: 1, arc_xp_awarded: 6, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '616d3386', user_id: UID, block_id: BLOCK_ID, date: '2026-06-04', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '8cb38850', user_id: UID, block_id: BLOCK_ID, date: '2026-06-05', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: 'ff78e703', user_id: UID, block_id: BLOCK_ID, date: '2026-06-06', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: 'a952dc64', user_id: UID, block_id: BLOCK_ID, date: '2026-06-07', proof_total: 5, proof_done: 5, arc_xp_awarded: 40, perfect_day: true, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: 'adad1b09', user_id: UID, block_id: BLOCK_ID, date: '2026-06-08', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '00af7b90', user_id: UID, block_id: BLOCK_ID, date: '2026-06-09', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: 'e1377794', user_id: UID, block_id: BLOCK_ID, date: '2026-06-10', proof_total: 5, proof_done: 4, arc_xp_awarded: 24, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '97babed2', user_id: UID, block_id: BLOCK_ID, date: '2026-06-11', proof_total: 5, proof_done: 3, arc_xp_awarded: 18, perfect_day: false, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '28b870aa', user_id: UID, block_id: BLOCK_ID, date: '2026-06-12', proof_total: 5, proof_done: 5, arc_xp_awarded: 40, perfect_day: true, created_at: '2026-06-13T02:04:30.428821+00:00' },
  { id: '5f6f7c83', user_id: UID, block_id: BLOCK_ID, date: '2026-06-13', proof_total: 5, proof_done: 0, arc_xp_awarded: 0, perfect_day: false, created_at: '2026-06-13T03:17:12.025908+00:00' },
];

const JOURNAL_ENTRIES = [
  { id: '24f6c304', user_id: UID, date: '2026-06-12', content: "Proof shown: Deep work (75 min), run 4km ✓, no doom scroll ✓, posted (mental model thread — got replies), evening check-in ✓. 5/5. Fourth perfect day.\n\nThe system is working. But a system without an output valve just accumulates. Shipping is part of the proof, not extra credit.\n\nTomorrow: Day 21.", daily_context: [], is_ai_generated: true, manually_edited: false, created_at: '2026-06-13T02:05:29.900687+00:00' },
  { id: 'dbcdd0ea', user_id: UID, date: '2026-06-11', content: "3/5 again. Deep work, move, check-in on autopilot now. Consistently miss the post.", daily_context: [], is_ai_generated: false, manually_edited: false, created_at: '2026-06-13T02:04:50.311091+00:00' },
  { id: '8f07f3fb', user_id: UID, date: '2026-06-10', content: "Proof shown: Deep work (80 min), run 4km ✓, no doom scroll ✓, evening check-in ✓. 4/5.\n\nBest deep work session in two weeks — 80 minutes felt like 30. Flow state showing up more consistently.", daily_context: [], is_ai_generated: true, manually_edited: false, created_at: '2026-06-13T02:05:29.900687+00:00' },
  { id: '681972d4', user_id: UID, date: '2026-06-07', content: "Proof shown: Deep work (85 min), 6km run, phone-free until 9am, posted one useful breakdown, evening reflection. 5/5. Third perfect day.\n\nRan the furthest I have in months without planning to.", daily_context: [], is_ai_generated: true, manually_edited: false, created_at: '2026-06-13T02:05:29.900687+00:00' },
  { id: '3569eab2', user_id: UID, date: '2026-05-31', content: "Proof shown: Deep work (90 min), 5km run, no doom scroll until 9:30am, posted two useful things, evening check-in complete. First 5/5 day.\n\nStringing all five together felt different. Not just completing items — actually building something that resembles a system.", daily_context: [], is_ai_generated: true, manually_edited: false, created_at: '2026-06-13T02:05:29.900687+00:00' },
];

const WEEKLY_BRIEFS = [
  { user_id: UID, week_start: '2026-06-08', brief_text: "Week 3 underway. Proof rate holding at 70%+ across the first 5 days. Deep work is the anchor — 5 of 5 days. Fourth perfect day on Day 20 (June 12). The posting gap is the one thread still loose." },
  { user_id: UID, week_start: '2026-06-01', brief_text: "Week 2 complete. 69% proof rate including a bad day on Arc day 11 (1/5, work emergency) and a clean bounce back. That recovery pattern is the clearest proof in the Arc so far. Second perfect day on day 15." },
  { user_id: UID, week_start: '2026-05-25', brief_text: "Week 1 of Build the System is in. 71% proof rate across 7 days — including the first perfect day on Saturday. Deep work hit 6 of 7 days. The morning sequence is forming." },
];

const COACH_MEMORY = [{
  content: "Molly, 22-day arc checkpoint. Core: break planning-without-shipping. Deep work reliable. Posting is the bottleneck — knows it, still resists.",
  updated_at: '2026-06-13T03:23:10.274+00:00',
}];

const MOCK_MAP = {
  profiles: PROFILE, habits: HABITS, forge_blocks: FORGE_BLOCKS,
  arc_daily_scores: ARC_DAILY_SCORES, journal_entries: JOURNAL_ENTRIES,
  weekly_brief_generation_usage: WEEKLY_BRIEFS, coach_memory: COACH_MEMORY,
};

function jsonResp(data) {
  return {
    status: 200, contentType: 'application/json',
    headers: { 'Content-Range': `0-${Math.max(0, data.length - 1)}/${data.length}`, 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data),
  };
}
function emptyResp() { return { status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '[]' }; }

async function setupMocks(page) {
  await page.route('**apdmvbzfjuvxworjepze.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.includes('/auth/v1/')) {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(p.includes('/user') ? USER_OBJ : { access_token: ACCESS_TOKEN, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400 * 365, refresh_token: 'mock-refresh', user: USER_OBJ }) });
    } else if (p.includes('/realtime/')) {
      await route.abort('failed');
    } else if (p.includes('/rest/v1/')) {
      const tbl = p.split('/rest/v1/')[1]?.split('?')[0];
      const data = MOCK_MAP[tbl];
      await route.fulfill(data ? jsonResp(data) : emptyResp());
    } else {
      await route.abort('failed');
    }
  });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-apdmvbzfjuvxworjepze-auth-token', SESSION]);
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Smoothly scroll by scrolling in small increments
async function smoothScroll(page, targetY, durationMs = 1800) {
  const startY = await page.evaluate(() => window.scrollY);
  const distance = targetY - startY;
  const steps = Math.max(20, Math.round(durationMs / 50));
  for (let i = 1; i <= steps; i++) {
    const y = startY + distance * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await wait(durationMs / steps);
  }
}

const REC_DIR = path.resolve('/home/user/forged/scripts/recordings');
const TMP_DIR = path.resolve('/home/user/forged/scripts/recordings/tmp-r5');
fs.mkdirSync(TMP_DIR, { recursive: true });

(async () => {
  console.log('\n🎬 Capturing R5 — Arc week timeline scroll\n');

  const ctx = await chromium.launchPersistentContext(TMP_DIR, {
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    recordVideo: { dir: TMP_DIR, size: { width: 390, height: 844 } },
  });

  const page = await ctx.newPage();
  await setupMocks(page);

  // ── Load Today first, settle ────────────────────────────────────────────────
  console.log('  Loading Today...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
  await wait(3000);

  // Dismiss coach bubble if present
  try {
    const x = page.locator('[aria-label="Dismiss coach tip"]').first();
    if (await x.count() > 0) { await x.click(); await wait(300); }
  } catch {}
  await page.keyboard.press('Escape');
  await wait(300);

  // ── Navigate to Arc ─────────────────────────────────────────────────────────
  console.log('  Navigating to Arc...');
  const arcBtn = page.locator('[data-tour="nav"] button:has-text("Arc"), nav button:has-text("Arc")').first();
  if (await arcBtn.count() > 0) {
    await arcBtn.click();
  } else {
    // fallback: try any button with Arc text that isn't inside a card
    const allArcBtns = page.locator('button:has-text("Arc")');
    const count = await allArcBtns.count();
    for (let i = 0; i < count; i++) {
      const btn = allArcBtns.nth(i);
      const text = await btn.innerText();
      if (text.trim() === 'Arc') { await btn.click(); break; }
    }
  }

  await wait(2500);

  // Dismiss any coach overlay
  try {
    const x = page.locator('[aria-label="Dismiss coach tip"]').first();
    if (await x.count() > 0) { await x.click(); await wait(300); }
  } catch {}

  // ── Hold on Arc overview (rail at far left) ────────────────────────────────
  console.log('  Holding on Arc overview...');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Make sure the rail is scrolled to the start
  await page.evaluate(() => {
    const btn = document.querySelector('[data-segment]');
    if (!btn) return;
    let el = btn.parentElement;
    while (el && getComputedStyle(el).overflowX !== 'auto') el = el.parentElement;
    if (el) el.scrollLeft = 0;
  });
  await wait(2000);

  // ── Scroll rail left → right across all weeks ───────────────────────────────
  console.log('  Scrolling rail left → right...');
  await page.evaluate(() => {
    const btn = document.querySelector('[data-segment]');
    if (!btn) return;
    let rail = btn.parentElement;
    while (rail && getComputedStyle(rail).overflowX !== 'auto') rail = rail.parentElement;
    if (!rail) return;
    const maxScroll = rail.scrollWidth - rail.clientWidth;
    const duration = 3200;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      // ease-in-out
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      rail.scrollLeft = ease * maxScroll;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await wait(3400); // let animation finish

  // ── Tap week-3 (current week — has receipts + 4/7 days completed) ──────────
  console.log('  Tapping week 3...');
  const w3 = page.locator('[data-segment="week-3"]').first();
  if (await w3.count() > 0) {
    await w3.click();
  } else {
    // fallback: click the 3rd week-N segment button
    const segs = page.locator('[data-segment^="week-"]');
    const n = await segs.count();
    if (n >= 3) await segs.nth(2).click();
    else if (n > 0) await segs.last().click();
  }
  await wait(1500); // let detail panel expand

  // ── Scroll page down to reveal the daily evidence spine ────────────────────
  console.log('  Scrolling down to daily evidence...');
  await smoothScroll(page, 400, 1800);
  await wait(600);
  await smoothScroll(page, 800, 2000);
  await wait(700);
  await smoothScroll(page, 1200, 1800);
  await wait(1000);

  // ── Close context — this flushes the video ──────────────────────────────────
  console.log('  Closing context and flushing video...');
  const videoPath = await page.video()?.path();
  await ctx.close();

  // Find the webm that was written
  if (videoPath && fs.existsSync(videoPath)) {
    const dest = path.join(REC_DIR, 'R5_arc_week_timeline_scroll.webm');
    fs.copyFileSync(videoPath, dest);
    const size = (fs.statSync(dest).size / 1024).toFixed(0);
    console.log(`\n✅ R5_arc_week_timeline_scroll.webm — ${size} KB`);
    console.log(`   Path: ${dest}`);
  } else {
    // Search tmp dir for any webm
    const files = fs.readdirSync(TMP_DIR).filter(f => f.endsWith('.webm'));
    if (files.length > 0) {
      const src = path.join(TMP_DIR, files[0]);
      const dest = path.join(REC_DIR, 'R5_arc_week_timeline_scroll.webm');
      fs.copyFileSync(src, dest);
      const size = (fs.statSync(dest).size / 1024).toFixed(0);
      console.log(`\n✅ R5_arc_week_timeline_scroll.webm — ${size} KB`);
      console.log(`   Path: ${dest}`);
    } else {
      console.error('\n❌ No video file found in tmp dir');
      console.log('Files in tmp:', fs.readdirSync(TMP_DIR));
    }
  }
})();
