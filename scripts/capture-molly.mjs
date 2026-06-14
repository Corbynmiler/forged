/**
 * Playwright capture script for Forged marketing screenshots.
 * Logs in as Molly demo account via injected session token.
 * Target: https://forged-sage.vercel.app
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'path';
import fs from 'fs';

const ACCESS_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjkyOWY2ZWU3LThhOGYtNGJiZC1hNDhkLTRjZDI0NGYxYzY1OCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FwZG12YnpmanV2eHdvcmplcHplLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJhYzFlNjUwMC0wNTExLTRjZTItODAxYS1lY2NmN2EzMjgwMjciLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzgxMzI0NTczLCJpYXQiOjE3ODEzMjA5NzMsImVtYWlsIjoiY2hlZXNlZmluZ2Vyc2F0aG90bWFpbC5jby5uQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJjaGVlc2VmaW5nZXJzYXRob3RtYWlsLmNvLm5AZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiYWMxZTY1MDAtMDUxMS00Y2UyLTgwMWEtZWNjZjdhMzI4MDI3In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3ODEzMjA5NzN9XSwic2Vzc2lvbl9pZCI6IjYzYjhkZDAxLTJlMzgtNGQ1Yy05ZWJkLTFkYmJmOGM5OTQ0ZSIsImlzX2Fub255bW91cyI6ZmFsc2V9.ZyMpMIAJ8fmeQ-9HgGFO4EHIJZZ3izzlKe3QOKxiFCmUffm4PbHEd1PP_j7I3A3XwbAppKaI0b-lXHcCRSVWwA';

const SESSION = JSON.stringify({
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 1781324573,
  refresh_token: '',
  user: {
    id: 'ac1e6500-0511-4ce2-801a-eccf7a328027',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'cheesefingersathotmail.co.n@gmail.com',
    email_confirmed_at: '2026-06-13T03:22:53.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {
      email: 'cheesefingersathotmail.co.n@gmail.com',
      email_verified: true,
      phone_verified: false,
      sub: 'ac1e6500-0511-4ce2-801a-eccf7a328027',
    },
    created_at: '2026-06-13T03:22:53.000Z',
  },
});

const OUT_DIR = path.resolve('/home/user/forged/scripts/captures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = 'http://localhost:5173';

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function injectSession(page) {
  await page.addInitScript(([key, val]) => {
    localStorage.setItem(key, val);
  }, ['sb-apdmvbzfjuvxworjepze-auth-token', SESSION]);
}

async function shot(page, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return p;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });

  // iPhone 14 Pro dimensions, 2x DPR for crisp renders
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const page = await ctx.newPage();

  // Inject session before any navigation
  await injectSession(page);

  console.log('\n🚀 Starting Forged marketing captures...\n');

  // ── 1. TODAY PAGE ──────────────────────────────────────────────────────────
  console.log('[ TODAY ]');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await wait(2000);
  await shot(page, '01_today_full');

  // Scroll down to see more habits
  await page.evaluate(() => window.scrollBy(0, 200));
  await wait(500);
  await shot(page, '02_today_habits_scrolled');

  // Scroll back to top for Arc card
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(400);
  await shot(page, '03_today_arc_card_top');

  // ── 2. ARC / TIMELINE PAGE ─────────────────────────────────────────────────
  console.log('[ ARC ]');
  // Look for the Arc tab or navigate button — try clicking the arc/block section
  const arcNav = page.locator('text=Arc').first();
  const arcNavExists = await arcNav.count();
  if (arcNavExists > 0) {
    await arcNav.click();
    await wait(1500);
    await shot(page, '04_arc_overview');
    await page.evaluate(() => window.scrollBy(0, 300));
    await wait(400);
    await shot(page, '05_arc_scrolled');
  } else {
    // Try URL-based navigation — Arc/progress usually has its own route
    await page.goto(BASE_URL + '#arc', { waitUntil: 'networkidle' });
    await wait(1500);
    await shot(page, '04_arc_overview');
  }

  // ── 3. JOURNAL PAGE ────────────────────────────────────────────────────────
  console.log('[ JOURNAL ]');
  const journalNav = page.locator('text=Journal').first();
  const journalExists = await journalNav.count();
  if (journalExists > 0) {
    await journalNav.click();
    await wait(1500);
    await shot(page, '06_journal_list');

    // Tap first journal entry to expand it
    const firstEntry = page.locator('[data-entry]').first();
    const firstEntryExists = await firstEntry.count();
    if (firstEntryExists > 0) {
      await firstEntry.click();
      await wait(800);
      await shot(page, '07_journal_entry_open');
    } else {
      // Try clicking first visible card-like element in journal
      const cards = page.locator('div').filter({ hasText: 'Proof shown' }).first();
      const cardsExist = await cards.count();
      if (cardsExist > 0) {
        await cards.click();
        await wait(800);
        await shot(page, '07_journal_entry_open');
      }
    }
  }

  // ── 4. INSIGHTS / WEEKLY BRIEF ─────────────────────────────────────────────
  console.log('[ INSIGHTS ]');
  const insightsNav = page.locator('text=Insights').first();
  const insightsExists = await insightsNav.count();
  if (insightsExists > 0) {
    await insightsNav.click();
    await wait(1500);
    await shot(page, '08_insights_top');
    await page.evaluate(() => window.scrollBy(0, 300));
    await wait(400);
    await shot(page, '09_insights_brief');
  }

  // ── 5. COACH / ARLO CHAT ───────────────────────────────────────────────────
  console.log('[ COACH ]');
  // Go back to today first, then open coach
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await wait(1500);

  // Find the Arlo/coach bar button
  const coachBtn = page.locator('[aria-label="Open coach"]').first();
  const coachBtnExists = await coachBtn.count();
  if (coachBtnExists > 0) {
    await coachBtn.click();
    await wait(1000);
    await shot(page, '10_coach_open');
  } else {
    // Try clicking the bottom bar area with Arlo face
    const arloArea = page.locator('text=Arlo').first();
    const arloExists = await arloArea.count();
    if (arloExists > 0) {
      await arloArea.click();
      await wait(1000);
      await shot(page, '10_coach_open');
    }
  }

  // ── 6. FULL-PAGE DESKTOP SCREENSHOT ────────────────────────────────────────
  console.log('[ DESKTOP VIEW ]');
  const desktopCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const desktopPage = await desktopCtx.newPage();
  await injectSession(desktopPage);
  await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle' });
  await wait(2000);
  await desktopPage.screenshot({ path: path.join(OUT_DIR, '11_desktop_today.png'), fullPage: false });
  console.log('  📸 11_desktop_today.png');
  await desktopCtx.close();

  // ── 7. TODAY — CLEAN STATE AFTER SCROLL RESET ──────────────────────────────
  console.log('[ FINAL CLEAN SHOTS ]');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await wait(2500);
  // Take a clean final shot with no scroll
  await shot(page, '12_today_final_clean');

  // Scroll just enough to show the habit list under the Arc card
  await page.evaluate(() => window.scrollTo(0, 180));
  await wait(500);
  await shot(page, '13_today_habits_focus');

  await browser.close();

  console.log('\n✅ Captures complete!');
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png'));
  console.log(`\n📁 ${files.length} files in scripts/captures/`);
  files.forEach(f => console.log(`   ${f}`));
})();
