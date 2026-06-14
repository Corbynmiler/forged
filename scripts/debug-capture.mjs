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

(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/pw-cap-test', {
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const page = await ctx.newPage();

  // Log console messages
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text().substring(0, 200));
  });

  // Inject session BEFORE any navigation
  await page.addInitScript(([key, val]) => {
    localStorage.setItem(key, val);
    // Also try the session key format Supabase v2 uses
    localStorage.setItem('sb-apdmvbzfjuvxworjepze-auth-token-code-verifier', '');
  }, ['sb-apdmvbzfjuvxworjepze-auth-token', SESSION]);

  console.log('Navigating...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });

  console.log('Waiting 3s for initial render...');
  await new Promise(r => setTimeout(r, 3000));

  await page.screenshot({ path: path.join(OUT_DIR, 'debug_01_3sec.png') });
  console.log('Saved debug_01_3sec.png');

  console.log('Waiting 5 more seconds...');
  await new Promise(r => setTimeout(r, 5000));

  await page.screenshot({ path: path.join(OUT_DIR, 'debug_02_8sec.png') });
  console.log('Saved debug_02_8sec.png');

  // Dump page text to understand structure
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('\nPAGE TEXT (first 1000 chars):\n', bodyText.substring(0, 1000));

  // Dump all button/nav elements
  const buttons = await page.evaluate(() => {
    const els = document.querySelectorAll('button, [role="button"], nav, [data-tab]');
    return Array.from(els).slice(0, 20).map(el => ({
      tag: el.tagName,
      text: el.innerText?.substring(0, 50),
      class: el.className?.substring(0, 80),
      ariaLabel: el.getAttribute('aria-label'),
    }));
  });
  console.log('\nBUTTONS/NAV ELEMENTS:', JSON.stringify(buttons, null, 2));

  await ctx.close();
})();
