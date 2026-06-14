/**
 * Screen recordings for Forged marketing.
 * Produces 4 WebM clips from the clean production app (no Forge/Three.js).
 * Run: node scripts/capture-recordings.mjs
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'path';
import fs from 'fs';

const UID   = 'ac1e6500-0511-4ce2-801a-eccf7a328027';
const BLOCK_ID = 'a0600001-0001-4001-8001-000000000001';
const ACCESS_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjkyOWY2ZWU3LThhOGYtNGJiZC1hNDhkLTRjZDI0NGYxYzY1OCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FwZG12YnpmanV2eHdvcmplcHplLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJhYzFlNjUwMC0wNTExLTRjZTItODAxYS1lY2NmN2EzMjgwMjciLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzgxMzI0NTczLCJpYXQiOjE3ODEzMjA5NzMsImVtYWlsIjoiY2hlZXNlZmluZ2Vyc2F0aG90bWFpbC5jby5uQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJjaGVlc2VmaW5nZXJzYXRob3RtYWlsLmNvLm5AZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiYWMxZTY1MDAtMDUxMS00Y2UyLTgwMWEtZWNjZjdhMzI4MDI3In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3ODEzMjA5NzN9XSwic2Vzc2lvbl9pZCI6IjYzYjhkZDAxLTJlMzgtNGQ1Yy05ZWJkLTFkYmJmOGM5OTQ0ZSIsImlzX2Fub255bW91cyI6ZmFsc2V9.ZyMpMIAJ8fmeQ-9HgGFO4EHIJZZ3izzlKe3QOKxiFCmUffm4PbHEd1PP_j7I3A3XwbAppKaI0b-lXHcCRSVWwA';
const TODAY = '2026-06-13';

const USER_OBJ = {
  id: UID, aud: 'authenticated', role: 'authenticated',
  email: 'cheesefingersathotmail.co.n@gmail.com',
  email_confirmed_at: '2026-06-13T03:22:53.000Z', phone: '',
  app_metadata: {provider:'email',providers:['email']},
  user_metadata: {email:'cheesefingersathotmail.co.n@gmail.com',email_verified:true,phone_verified:false,sub:UID},
  created_at: '2026-06-13T03:22:53.000Z', updated_at: '2026-06-13T03:22:53.000Z',
};
const SESSION = JSON.stringify({
  access_token: ACCESS_TOKEN, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 365, refresh_token: 'mock-refresh', user: USER_OBJ,
});

const PROFILE = [{id:UID,name:'Molly',avatar_url:'🐼',onboarded:true,created_at:'2026-04-25T13:22:24.215124+00:00',updated_at:'2026-06-13T03:17:11.131+00:00'}];

const FORGE_BLOCKS = [{
  id:BLOCK_ID,user_id:UID,title:'Build the System',start_date:'2026-05-24',
  duration_weeks:6,
  habit_ids:['a0600001-0001-4001-8001-000000000011','a0600001-0001-4001-8001-000000000012','a0600001-0001-4001-8001-000000000013','a0600001-0001-4001-8001-000000000014','a0600001-0001-4001-8001-000000000015'],
  motivation:"Because I've been 'almost ready' for two years.",
  created_at:'2026-05-24T06:00:00.000Z',updated_at:'2026-06-13T06:00:00.000Z',
}];

const JOURNAL_ENTRIES = [];
const WEEKLY_BRIEFS  = [];
const COACH_MEMORY   = [];

const ARC_DAILY_SCORES = [
  {id:'1c7dc369',user_id:UID,block_id:BLOCK_ID,date:'2026-05-24',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'c6c9d851',user_id:UID,block_id:BLOCK_ID,date:'2026-05-25',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'240b8d08',user_id:UID,block_id:BLOCK_ID,date:'2026-05-26',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
  {id:'cdece9cc',user_id:UID,block_id:BLOCK_ID,date:'2026-05-27',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'17ea475c',user_id:UID,block_id:BLOCK_ID,date:'2026-05-28',proof_total:5,proof_done:2,arc_xp_awarded:12,perfect_day:false},
  {id:'2cdcf167',user_id:UID,block_id:BLOCK_ID,date:'2026-05-29',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'3fa32685',user_id:UID,block_id:BLOCK_ID,date:'2026-05-30',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'5d61acc9',user_id:UID,block_id:BLOCK_ID,date:'2026-05-31',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
  {id:'b88e405e',user_id:UID,block_id:BLOCK_ID,date:'2026-06-01',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'470f1934',user_id:UID,block_id:BLOCK_ID,date:'2026-06-02',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'704483ab',user_id:UID,block_id:BLOCK_ID,date:'2026-06-03',proof_total:5,proof_done:1,arc_xp_awarded:6,perfect_day:false},
  {id:'616d3386',user_id:UID,block_id:BLOCK_ID,date:'2026-06-04',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'8cb38850',user_id:UID,block_id:BLOCK_ID,date:'2026-06-05',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'ff78e703',user_id:UID,block_id:BLOCK_ID,date:'2026-06-06',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'a952dc64',user_id:UID,block_id:BLOCK_ID,date:'2026-06-07',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
  {id:'adad1b09',user_id:UID,block_id:BLOCK_ID,date:'2026-06-08',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'00af7b90',user_id:UID,block_id:BLOCK_ID,date:'2026-06-09',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'e1377794',user_id:UID,block_id:BLOCK_ID,date:'2026-06-10',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'97babed2',user_id:UID,block_id:BLOCK_ID,date:'2026-06-11',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'28b870aa',user_id:UID,block_id:BLOCK_ID,date:'2026-06-12',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
];
const ARC_SCORES_TODAY_0 = ARC_DAILY_SCORES;
const ARC_SCORES_TODAY_2 = [...ARC_DAILY_SCORES, {id:'arc-today',user_id:UID,block_id:BLOCK_ID,date:TODAY,proof_total:5,proof_done:2,arc_xp_awarded:0,perfect_day:false}];
const ARC_SCORES_TODAY_3 = [...ARC_DAILY_SCORES, {id:'arc-today',user_id:UID,block_id:BLOCK_ID,date:TODAY,proof_total:5,proof_done:3,arc_xp_awarded:0,perfect_day:false}];

// Full habit rows — must include is_proof_action:true for PROOF ACTIONS section
const HABIT_BASE = [
  {id:'a0600001-0001-4001-8001-000000000011',user_id:UID,name:'Deep work session',emoji:'🎯',habit_type:'daily',color:'#2980B9',streak:7,best_streak:12,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'65 min',value:true},{date:'2026-06-07',note:'85 min',value:true},
    {date:'2026-06-08',note:'60 min',value:true},{date:'2026-06-09',note:'55 min',value:true},
    {date:'2026-06-10',note:'80 min',value:true},{date:'2026-06-11',note:'70 min',value:true},
    {date:'2026-06-12',note:'75 min',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000012',user_id:UID,name:'Move daily',emoji:'🏃',habit_type:'daily',color:'#27AE60',streak:4,best_streak:8,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'4km',value:true},{date:'2026-06-07',note:'6km',value:true},
    {date:'2026-06-09',note:'4km',value:true},{date:'2026-06-10',note:'5km',value:true},
    {date:'2026-06-11',note:'short',value:true},{date:'2026-06-12',note:'4km',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000013',user_id:UID,name:'No doom scroll before 9am',emoji:'📵',habit_type:'daily',color:'#E67E22',streak:7,best_streak:7,reflection:false,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'',value:true},{date:'2026-06-07',note:'',value:true},
    {date:'2026-06-08',note:'',value:true},{date:'2026-06-09',note:'',value:true},
    {date:'2026-06-10',note:'',value:true},{date:'2026-06-11',note:'',value:true},{date:'2026-06-12',note:'',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000014',user_id:UID,name:'Post one useful thing',emoji:'📤',habit_type:'daily',color:'#9B59B6',streak:1,best_streak:3,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-07',note:'posted',value:true},{date:'2026-06-08',note:'shared',value:true},{date:'2026-06-12',note:'published',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000015',user_id:UID,name:'Evening check-in',emoji:'🌙',habit_type:'daily',color:'#1ABC9C',streak:1,best_streak:6,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'',value:true},{date:'2026-06-07',note:'',value:true},
    {date:'2026-06-08',note:'',value:true},{date:'2026-06-09',note:'',value:true},
    {date:'2026-06-10',note:'',value:true},{date:'2026-06-12',note:'',value:true},
  ]},
];
const TODAY_LOGS = {
  '11': {date:TODAY,note:'72 min, locked in',value:true},
  '12': {date:TODAY,note:'5km',value:true},
  '13': {date:TODAY,note:'',value:true},
  '14': {date:TODAY,note:'posted rough draft',value:true},
  '15': {date:TODAY,note:'',value:true},
};
function buildHabits(doneCount) {
  const ids = ['11','12','13','14','15'];
  return HABIT_BASE.map((h, i) => {
    const extraLog = i < doneCount ? [TODAY_LOGS[ids[i]]] : [];
    return { ...h, streak: i < doneCount ? h.streak + 1 : h.streak, logs: [...h.logs, ...extraLog] };
  });
}

function buildMockMap(habits, arcScores) {
  return { profiles: PROFILE, habits, forge_blocks: FORGE_BLOCKS,
    arc_daily_scores: arcScores, journal_entries: JOURNAL_ENTRIES,
    weekly_brief_generation_usage: WEEKLY_BRIEFS, coach_memory: COACH_MEMORY };
}

function jsonResp(data) {
  return { status:200, contentType:'application/json',
    headers:{'Content-Range':`0-${Math.max(0,data.length-1)}/${data.length}`,'Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(data) };
}
function emptyResp() { return {status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'[]'}; }

async function setupMocks(page, mockMap) {
  await page.route('**apdmvbzfjuvxworjepze.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.includes('/auth/v1/')) {
      const futureExp = Math.floor(Date.now() / 1000) + 86400 * 365;
      await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},
        body:JSON.stringify(p.includes('/user')?USER_OBJ:{access_token:ACCESS_TOKEN,token_type:'bearer',expires_in:3600,expires_at:futureExp,refresh_token:'mock-refresh',user:USER_OBJ})});
    } else if (p.includes('/realtime/')) {
      await route.abort('failed');
    } else if (p.includes('/rest/v1/')) {
      const tbl = p.split('/rest/v1/')[1]?.split('?')[0];
      const data = mockMap[tbl];
      await route.fulfill(data ? jsonResp(data) : emptyResp());
    } else {
      await route.abort('failed');
    }
  });
  await page.addInitScript(([k,v,uid]) => {
    localStorage.setItem(k, v);
    localStorage.setItem('forged_coach_opened', '1');
    localStorage.setItem('forged_notif_nudge_dismissed', '1');
    for (const pg of ['today','arc','social','journal','insights']) {
      localStorage.setItem(`forged_ai_page_guide_seen:${uid}:${pg}`, '1');
    }
    // Allow the proof context nudge to fire (clear it so recording 4 shows it)
    // (handled per-recording below)
  }, ['sb-apdmvbzfjuvxworjepze-auth-token', SESSION, UID]);
}

// Suppress proof-context nudge for recordings that don't need it
async function suppressProofNudge(page) {
  await page.addInitScript(([uid, today]) => {
    localStorage.setItem(`forged_proof_ctx_nudge:${uid}:${today}`, '1');
  }, [UID, TODAY]);
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loadPage(page, url = 'http://localhost:5173') {
  await page.goto(url, {waitUntil:'networkidle',timeout:30000});
  try {
    await page.waitForFunction(() => {
      const body = document.body.innerText;
      return body.length > 50 && !body.startsWith('STEP 1');
    }, {timeout: 15000});
  } catch {}
  await wait(3500); // outlast the 2800ms auto-hide coach nudge timer
}

// Click a habit's check button by its name
async function tapHabit(page, name) {
  const card = page.locator('.rc', { hasText: name }).first();
  const btn  = card.locator('button.tap').last(); // check circle is last button.tap in card
  await btn.click();
  await wait(600); // let animation start
}

const OUT_DIR = path.join(process.cwd(), 'scripts', 'recordings');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function launchCtx(label, videoDir) {
  const { execSync } = await import('child_process');
  try { execSync(`rm -rf /tmp/pw-rec-${label}`); } catch {}
  return chromium.launchPersistentContext(`/tmp/pw-rec-${label}`, {
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
  });
}

(async () => {
  console.log('\n🎬 Forged — screen recordings\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORDING 1: 0/5 → 2/5 (tap Deep work + Move daily)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ REC 1: 0/5 → 2/5 ]');
  {
    const dir1 = path.join(OUT_DIR, 'tmp-r1');
    fs.mkdirSync(dir1, { recursive: true });
    const ctx = await launchCtx('r1', dir1);
    const page = ctx.pages()[0] || await ctx.newPage();
    await setupMocks(page, buildMockMap(buildHabits(0), ARC_SCORES_TODAY_0));
    await suppressProofNudge(page);
    await loadPage(page);
    // Show the full ring + top
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(1500); // hold 0/5 state
    // Tap Deep work session
    await tapHabit(page, 'Deep work session');
    await wait(1000);
    // Tap Move daily
    await tapHabit(page, 'Move daily');
    await wait(2000); // hold 2/5 state
    const videoPath1 = await page.video()?.path();
    await ctx.close();
    // Move to final output
    if (videoPath1) {
      const dest = path.join(OUT_DIR, 'R1_proof_0to2.webm');
      fs.renameSync(videoPath1, dest);
      console.log(`  🎥 R1_proof_0to2.webm`);
    } else {
      console.log('  ⚠️ R1: no video file');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORDING 2: 3/5 → 5/5 complete
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ REC 2: 3/5 → 5/5 complete ]');
  {
    const dir2 = path.join(OUT_DIR, 'tmp-r2');
    fs.mkdirSync(dir2, { recursive: true });
    const ctx = await launchCtx('r2', dir2);
    const page = ctx.pages()[0] || await ctx.newPage();
    await setupMocks(page, buildMockMap(buildHabits(3), ARC_SCORES_TODAY_3));
    await suppressProofNudge(page);
    await loadPage(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(1200); // hold 3/5 state
    // Tap Post one useful thing (4th habit, index 3)
    await tapHabit(page, 'Post one useful thing');
    await wait(900);
    // Tap Evening check-in (5th habit, index 4)
    await tapHabit(page, 'Evening check-in');
    await wait(2500); // hold "Today is complete" state
    const videoPath2 = await page.video()?.path();
    await ctx.close();
    if (videoPath2) {
      const dest = path.join(OUT_DIR, 'R2_proof_3to5_complete.webm');
      fs.renameSync(videoPath2, dest);
      console.log(`  🎥 R2_proof_3to5_complete.webm`);
    } else {
      console.log('  ⚠️ R2: no video file');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORDING 3: Arc timeline scroll
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ REC 3: Arc timeline scroll ]');
  {
    const dir3 = path.join(OUT_DIR, 'tmp-r3');
    fs.mkdirSync(dir3, { recursive: true });
    const ctx = await launchCtx('r3', dir3);
    const page = ctx.pages()[0] || await ctx.newPage();
    await setupMocks(page, buildMockMap(buildHabits(5), ARC_DAILY_SCORES));
    await suppressProofNudge(page);
    await loadPage(page);
    // Navigate to Arc
    const arcBtn = page.locator('nav button', { hasText: 'Arc' }).first();
    if (await arcBtn.count() === 0) {
      // Try bottom nav
      const arcBtns = page.locator('button', { hasText: 'Arc' });
      const count = await arcBtns.count();
      for (let i = 0; i < count; i++) {
        const rect = await arcBtns.nth(i).boundingBox();
        if (rect && rect.y > 700) { await arcBtns.nth(i).click(); break; }
      }
    } else {
      await arcBtn.click();
    }
    await wait(2000); // show Arc overview
    // Slow scroll through evidence
    await page.evaluate(() => window.scrollBy(0, 120)); await wait(600);
    await page.evaluate(() => window.scrollBy(0, 120)); await wait(600);
    await page.evaluate(() => window.scrollBy(0, 150)); await wait(600);
    await page.evaluate(() => window.scrollBy(0, 150)); await wait(800);
    await wait(1000); // hold on evidence spine
    const videoPath3 = await page.video()?.path();
    await ctx.close();
    if (videoPath3) {
      const dest = path.join(OUT_DIR, 'R3_arc_scroll.webm');
      fs.renameSync(videoPath3, dest);
      console.log(`  🎥 R3_arc_scroll.webm`);
    } else {
      console.log('  ⚠️ R3: no video file');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORDING 4: Coach context nudge + coach open
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ REC 4: Coach context nudge + open ]');
  {
    const dir4 = path.join(OUT_DIR, 'tmp-r4');
    fs.mkdirSync(dir4, { recursive: true });
    const ctx = await launchCtx('r4', dir4); // proof nudge NOT suppressed for this recording
    const page = ctx.pages()[0] || await ctx.newPage();
    await setupMocks(page, buildMockMap(buildHabits(0), ARC_SCORES_TODAY_0));
    // Don't call suppressProofNudge — let it fire
    await loadPage(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(800);
    // Tap first proof action — should trigger the context nudge
    await tapHabit(page, 'Deep work session');
    await wait(3500); // let nudge appear and animate (2800ms animation)
    // Now open coach
    for (const sel of [
      '[aria-label="Open chat with Coach"]',
      '[aria-label="Coach — open chat"]',
      'button:has-text("Coach")',
      'button:has-text("Chat")',
    ]) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) { await btn.click(); break; }
    }
    await wait(2000); // show coach greeting
    const videoPath4 = await page.video()?.path();
    await ctx.close();
    if (videoPath4) {
      const dest = path.join(OUT_DIR, 'R4_coach_nudge_and_open.webm');
      fs.renameSync(videoPath4, dest);
      console.log(`  🎥 R4_coach_nudge_and_open.webm`);
    } else {
      console.log('  ⚠️ R4: no video file');
    }
  }

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webm')).sort();
  console.log(`\n✅ Done — ${files.length} recordings:\n  ${files.join('\n  ')}`);
})();
