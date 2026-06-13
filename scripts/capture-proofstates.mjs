/**
 * Proof-state captures for Forged marketing.
 * Produces 9 screenshots across 4 proof completion states + arc + receipt + coach.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'path';
import fs from 'fs';

const UID = 'ac1e6500-0511-4ce2-801a-eccf7a328027';
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
// Set expires_at far in the future so Supabase client doesn't try to refresh
const SESSION = JSON.stringify({
  access_token: ACCESS_TOKEN, token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 365, refresh_token: 'mock-refresh', user: USER_OBJ,
});

const PROFILE = [{id:UID,name:'Molly',avatar_url:'🐼',onboarded:true,created_at:'2026-04-25T13:22:24.215124+00:00',updated_at:'2026-06-13T03:17:11.131+00:00'}];

const FORGE_BLOCKS = [{
  id:BLOCK_ID,user_id:UID,
  identity:'The person who ships proof, not promises',
  why_statement:"Because I've been 'almost ready' for two years. This time I'm building evidence instead of waiting for motivation.",
  old_pattern:'Planning without shipping. Starting without finishing. Telling myself I need more preparation.',
  minimum_proof:'One focused deep work session. Show up even when it feels mechanical.',
  start_date:'2026-05-24',end_date:'2026-07-04',status:'active',duration_days:42,review:null,
  created_at:'2026-06-13T02:03:48.735221+00:00',updated_at:'2026-06-13T03:33:12.62+00:00',
  title:'Build the System',arc_xp:490,completion_score:'71',arc_rank:'Tempered',
}];

// Base habit logs (all historical, no today entries for the "0/5" state)
const HABIT_BASE = [
  {id:'a0600001-0001-4001-8001-000000000011',user_id:UID,name:'Deep work session',emoji:'🎯',habit_type:'daily',color:'#2980B9',streak:7,best_streak:12,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'65 min, flow midway through',value:true},
    {date:'2026-06-07',note:'85 min — best session this arc',value:true},
    {date:'2026-06-08',note:'60 min, meetings cut in but got it done',value:true},
    {date:'2026-06-09',note:'55 min, slower day',value:true},
    {date:'2026-06-10',note:'80 min, real flow state',value:true},
    {date:'2026-06-11',note:'70 min',value:true},
    {date:'2026-06-12',note:'75 min, closed a loop I\'d been avoiding',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000012',user_id:UID,name:'Move daily',emoji:'🏃',habit_type:'daily',color:'#27AE60',streak:4,best_streak:8,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'4km run',value:true},
    {date:'2026-06-07',note:'6km — furthest this arc',value:true},
    {date:'2026-06-09',note:'4km',value:true},
    {date:'2026-06-10',note:'5km run',value:true},
    {date:'2026-06-11',note:'short loop',value:true},
    {date:'2026-06-12',note:'4km',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000013',user_id:UID,name:'No doom scroll before 9am',emoji:'📵',habit_type:'daily',color:'#E67E22',streak:7,best_streak:7,reflection:false,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'',value:true},{date:'2026-06-07',note:'',value:true},
    {date:'2026-06-08',note:'',value:true},{date:'2026-06-09',note:'',value:true},
    {date:'2026-06-10',note:'',value:true},{date:'2026-06-11',note:'',value:true},
    {date:'2026-06-12',note:'',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000014',user_id:UID,name:'Post one useful thing',emoji:'📤',habit_type:'daily',color:'#9B59B6',streak:1,best_streak:3,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-07',note:'posted a breakdown on product thinking — 3 DMs',value:true},
    {date:'2026-06-08',note:'shared rough mental model, got replies',value:true},
    {date:'2026-06-12',note:'published something rough, it worked',value:true},
  ]},
  {id:'a0600001-0001-4001-8001-000000000015',user_id:UID,name:'Evening check-in',emoji:'🌙',habit_type:'daily',color:'#1ABC9C',streak:1,best_streak:6,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00',logs:[
    {date:'2026-06-06',note:'',value:true},{date:'2026-06-07',note:'',value:true},
    {date:'2026-06-08',note:'',value:true},{date:'2026-06-09',note:'',value:true},
    {date:'2026-06-10',note:'',value:true},{date:'2026-06-12',note:'',value:true},
  ]},
];

// Today-log entries for each proof action
const TODAY_LOGS = {
  '11': {date:TODAY, note:'72 min, locked in from the first 5 minutes', value:true},
  '12': {date:TODAY, note:'5km, felt strong', value:true},
  '13': {date:TODAY, note:'', value:true},
  '14': {date:TODAY, note:'posted the rough draft — good replies coming in', value:true},
  '15': {date:TODAY, note:'', value:true},
};

// Build habits with N proof actions logged today (by index 0..4 of the 5 habits)
function buildHabits(doneCount) {
  const ids = ['11','12','13','14','15'];
  return HABIT_BASE.map((h, i) => {
    const suffix = ids[i];
    const extraLog = i < doneCount ? [TODAY_LOGS[suffix]] : [];
    // Adjust streak to reflect today's log
    const streak = i < doneCount ? (h.streak + 1) : h.streak;
    return { ...h, streak, logs: [...h.logs, ...extraLog] };
  });
}

const ARC_DAILY_SCORES = [
  {id:'1c7dc369-65a4-436f-a9b8-0222932da07b',user_id:UID,block_id:BLOCK_ID,date:'2026-05-24',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'c6c9d851-c3cf-4308-bd4f-934902ce4136',user_id:UID,block_id:BLOCK_ID,date:'2026-05-25',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'240b8d08-f0a7-4a2d-8a59-ff83a4e62ef4',user_id:UID,block_id:BLOCK_ID,date:'2026-05-26',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
  {id:'cdece9cc-8e81-4619-ba9c-cfc1216d6176',user_id:UID,block_id:BLOCK_ID,date:'2026-05-27',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'17ea475c-cafd-4c29-b9b1-67a3c1ea4ee3',user_id:UID,block_id:BLOCK_ID,date:'2026-05-28',proof_total:5,proof_done:2,arc_xp_awarded:12,perfect_day:false},
  {id:'2cdcf167-3060-4b9c-aab5-b24e9e2694f6',user_id:UID,block_id:BLOCK_ID,date:'2026-05-29',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'3fa32685-1c76-4edc-be3d-bf43bfc2520b',user_id:UID,block_id:BLOCK_ID,date:'2026-05-30',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'5d61acc9-6c3f-450f-ab7b-dd56be948232',user_id:UID,block_id:BLOCK_ID,date:'2026-05-31',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
  {id:'b88e405e-96bb-4eba-9387-0fce9b721b93',user_id:UID,block_id:BLOCK_ID,date:'2026-06-01',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'470f1934-c539-426e-ac31-490056772f78',user_id:UID,block_id:BLOCK_ID,date:'2026-06-02',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'704483ab-7082-4b1c-be12-c1dfd829ac39',user_id:UID,block_id:BLOCK_ID,date:'2026-06-03',proof_total:5,proof_done:1,arc_xp_awarded:6,perfect_day:false},
  {id:'616d3386-0c20-4ed8-a438-22027ca133ab',user_id:UID,block_id:BLOCK_ID,date:'2026-06-04',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'8cb38850-bafe-415a-9ecd-aaf739d300ca',user_id:UID,block_id:BLOCK_ID,date:'2026-06-05',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'ff78e703-66a4-45d4-b236-998cd0dde2e7',user_id:UID,block_id:BLOCK_ID,date:'2026-06-06',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'a952dc64-6789-4213-b8eb-5e2403625a3c',user_id:UID,block_id:BLOCK_ID,date:'2026-06-07',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
  {id:'adad1b09-7410-45d8-8d9b-9c472126db0e',user_id:UID,block_id:BLOCK_ID,date:'2026-06-08',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'00af7b90-47e2-4435-8876-a8bf7920dced',user_id:UID,block_id:BLOCK_ID,date:'2026-06-09',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'e1377794-5959-4b84-97d5-64c4b71ea58e',user_id:UID,block_id:BLOCK_ID,date:'2026-06-10',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false},
  {id:'97babed2-5dd1-4e7d-9625-40c316df3ec9',user_id:UID,block_id:BLOCK_ID,date:'2026-06-11',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false},
  {id:'28b870aa-272b-4651-867b-cfa7bb0b78bc',user_id:UID,block_id:BLOCK_ID,date:'2026-06-12',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
  // today: 5/5 perfect — used for "all done" captures
  {id:'5f6f7c83-43fe-4560-addb-1149542cab86',user_id:UID,block_id:BLOCK_ID,date:TODAY,proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true},
];

// Score list for partially-done states (today = 0/5)
const ARC_SCORES_TODAY_0 = [
  ...ARC_DAILY_SCORES.slice(0,-1),
  {id:'5f6f7c83-43fe-4560-addb-1149542cab86',user_id:UID,block_id:BLOCK_ID,date:TODAY,proof_total:5,proof_done:0,arc_xp_awarded:0,perfect_day:false},
];
const ARC_SCORES_TODAY_2 = [
  ...ARC_DAILY_SCORES.slice(0,-1),
  {id:'5f6f7c83-43fe-4560-addb-1149542cab86',user_id:UID,block_id:BLOCK_ID,date:TODAY,proof_total:5,proof_done:2,arc_xp_awarded:12,perfect_day:false},
];

const JOURNAL_ENTRIES = [
  {id:'24f6c304-5236-49e4-9e1d-30e44c35639b',user_id:UID,date:'2026-06-12',content:"Proof shown: Deep work (75 min), run 4km ✓, no doom scroll ✓, posted (mental model thread — got replies), evening check-in ✓. 5/5. Fourth perfect day.\n\nWins: Published the thing I've been sitting on. Three people replied with their own version of the same problem. That's what posting is for.\n\nHard parts: Still wrestling with the gap between doing the work and showing the work. They're not the same muscle but they need each other.\n\nPattern: The system is working. But a system without an output valve just accumulates. Shipping is part of the proof, not extra credit.\n\nTomorrow: Tomorrow is Day 21. That felt very far away on Day 1.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
  {id:'dbcdd0ea-cb40-48ae-9cc1-2b1375c9f62b',user_id:UID,date:'2026-06-11',content:"3/5 again. Starting to notice I do deep work, move, and check-in on autopilot now — but consistently miss the post and sometimes doom scroll in the morning. That asymmetry is interesting. Will ask Arlo about it.",daily_context:[],is_ai_generated:false,manually_edited:false,created_at:'2026-06-13T02:04:50.311091+00:00'},
  {id:'8f07f3fb-b061-4b06-84c9-fba1af3e54f8',user_id:UID,date:'2026-06-10',content:"Proof shown: Deep work (80 min), run 4km ✓, no doom scroll ✓, evening check-in ✓. 4/5. (Missed the post again.)\n\nWins: Best deep work session in two weeks — 80 minutes felt like 30. Flow state showing up more consistently.\n\nHard parts: Posting is becoming my weak spot. Need to rethink how I'm generating output worth sharing.\n\nPattern: Deep work is building well. But deep work without visible output is just spinning. Need to close more loops publicly.\n\nTomorrow: Whatever comes out of deep work tomorrow goes out that day. Rough draft is fine.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
];

// Today's generated receipt — used for "after Generate Entry" states
const JOURNAL_ENTRY_TODAY = {
  id:'ae4b2912-a1b2-4c3d-8e9f-0123456789ab',user_id:UID,date:TODAY,
  content:"Proof shown: Deep work (72 min) ✓, run 5km ✓, no doom scroll ✓, posted rough draft ✓, evening check-in ✓. 5/5. Fifth perfect day.\n\nWins: Locked in from the first 5 minutes. That's been the hardest part — starting. Today it clicked immediately.\n\nHard parts: Almost skipped the post. Shipped it anyway. Rough and published beats polished and stuck.\n\nPattern: The system is building momentum. Each proof action feeds the next. This is what evidence over motivation looks like in practice.\n\nTomorrow: Day 22. Keep the chain.",
  daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T21:05:00.000Z',
};
const JOURNAL_ENTRIES_WITH_TODAY = [...JOURNAL_ENTRIES, JOURNAL_ENTRY_TODAY];

const WEEKLY_BRIEFS = [
  {user_id:UID,week_start:'2026-06-01',brief_text:"Week 2 complete. Proof rate: 69% — including a bad day on arc day 11 (1/5, work emergency) and a clean bounce back the next morning. That recovery pattern is the clearest proof in the arc so far. Week 2 also had a second perfect day (arc day 15). Deep work is now Molly's most reliable habit — 6 of 7 days and the sessions are getting longer. Posting publicly is the consistent gap: she's shipping less than her other proof actions. The system is real. The output valve needs work."},
  {user_id:UID,week_start:'2026-05-25',brief_text:"Week 1 of Build the System is in. Molly held a 71% proof rate across 7 days — including her first perfect day on Saturday. She hit the deep work session on 6 of 7 days and ran more than she has in months. The real signal this week: she showed up on Wednesday with 2/5 instead of abandoning the arc entirely. That floor-holding is new. The morning sequence is forming. The system has a heartbeat."},
];

const COACH_MEMORY = [{
  content: "Molly, 22-day arc checkpoint (42 total). Core mission: break planning-without-shipping, starting-without-finishing, waiting-for-perfect prep. Proof over promises.\n\nLocked in: Deep work 80+ min (now reliable, tolerate mechanical days), daily movement 4–5km, no doom scroll before 9am (7+ day streak). Mornings are her strongest cognitive window; flow states reliable.\n\nBottleneck: posting publicly. Completes all work, skips share—says \"not ready,\" exact old pattern. Day 12 proved it works (rough thread → 3 replies). Knows intellectually, still emotionally resists.\n\nNext: Continue shipping rough. Any format. Before other work. The feeling-gap closes through repetition, not readiness. 20 days left to embed this.",
  updated_at: '2026-06-13T03:23:10.274+00:00',
}];

const OUT_DIR = path.resolve('/home/user/forged/scripts/captures');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.readdirSync(OUT_DIR).filter(f=>f.endsWith('.png')).forEach(f => fs.unlinkSync(path.join(OUT_DIR,f)));

function jsonResp(data) {
  return { status:200, contentType:'application/json',
    headers:{'Content-Range':`0-${Math.max(0,data.length-1)}/${data.length}`,'Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(data) };
}
function emptyResp() { return {status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'[]'}; }

function buildMockMap(habits, arcScores, journalEntries = JOURNAL_ENTRIES) {
  return { profiles: PROFILE, habits, forge_blocks: FORGE_BLOCKS,
    arc_daily_scores: arcScores, journal_entries: journalEntries,
    weekly_brief_generation_usage: WEEKLY_BRIEFS, coach_memory: COACH_MEMORY };
}

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
    // Mark first-time page guides as already seen so they don't overlay proof cards
    for (const pg of ['today','arc','social','journal','insights']) {
      localStorage.setItem(`forged_ai_page_guide_seen:${uid}:${pg}`, '1');
    }
  }, ['sb-apdmvbzfjuvxworjepze-auth-token', SESSION, UID]);
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function dismissCoachBubble(page) {
  try {
    const x = page.locator('[aria-label="Dismiss coach tip"]').first();
    if (await x.count() > 0) { await x.click(); await wait(300); }
  } catch {}
  await page.keyboard.press('Escape');
  await wait(200);
}

async function loadPage(page, url = 'http://localhost:5173') {
  await page.goto(url, {waitUntil:'networkidle',timeout:30000});
  // Wait for React to mount and render past the loading spinner
  try {
    await page.waitForFunction(() => {
      const body = document.body.innerText;
      return body.length > 50 && !body.startsWith('STEP 1');
    }, {timeout: 15000});
  } catch {
    // Take the page as-is if timeout (it may be loading screen still)
  }
  await wait(3500);
  await dismissCoachBubble(page);
  await wait(300);
}

async function shot(page, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({path: p, fullPage: false});
  console.log(`  📸 ${name}`);
}

async function launchMobile(userData, label) {
  // Remove stale persistent context dir to avoid cached auth/onboarding state
  const { execSync } = await import('child_process');
  try { execSync(`rm -rf /tmp/pw-proof-${label}`); } catch {}
  const ctx = await chromium.launchPersistentContext(`/tmp/pw-proof-${label}`, {
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'],
    viewport: {width:390, height:844},
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await setupMocks(page, userData);
  return { ctx, page };
}

(async () => {
  console.log('\n📸 Forged — proof-state captures\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE 1: 0/5 — nothing logged yet (morning, fresh start)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ 0/5 — fresh start ]');
  const { ctx: ctx0, page: page0 } = await launchMobile(
    buildMockMap(buildHabits(0), ARC_SCORES_TODAY_0), '0of5');
  await loadPage(page0);
  // Scroll to proof section
  await page0.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  await shot(page0, 'A1_proof_0of5_top');
  await page0.evaluate(() => window.scrollTo(0, 280));
  await wait(200);
  await shot(page0, 'A2_proof_0of5_cards');
  await ctx0.close();

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE 2: 2/5 — deep work + move done (mid-morning)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ 2/5 — in progress ]');
  const { ctx: ctx2, page: page2 } = await launchMobile(
    buildMockMap(buildHabits(2), ARC_SCORES_TODAY_2), '2of5');
  await loadPage(page2);
  await page2.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  await shot(page2, 'B1_proof_2of5_cards');
  await ctx2.close();

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE 3: 3/5 — deep work + move + no doom scroll done
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ 3/5 — most done ]');
  const { ctx: ctx3, page: page3 } = await launchMobile(
    buildMockMap(buildHabits(3), ARC_SCORES_TODAY_2), '3of5');
  await loadPage(page3);
  await page3.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  await shot(page3, 'C1_proof_3of5_cards');
  await ctx3.close();

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE 4: 5/5 — all done (perfect day)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ 5/5 — perfect day ]');
  const { ctx: ctx5, page: page5 } = await launchMobile(
    buildMockMap(buildHabits(5), ARC_DAILY_SCORES), '5of5');
  await loadPage(page5);
  await page5.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  await shot(page5, 'D1_proof_5of5_hero');
  await page5.evaluate(() => window.scrollTo(0, 280));
  await wait(200);
  await shot(page5, 'D2_proof_5of5_cards');

  // ═══════════════════════════════════════════════════════════════════════════
  // ARC SCREEN — overview, timeline, details (from the 5/5 context)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ ARC screen ]');
  const arcBtn = page5.locator('[data-tour="nav"] button:has-text("Arc"), nav button:has-text("Arc")').first();
  if (await arcBtn.count() > 0) {
    await arcBtn.click();
    await wait(2500);
    await dismissCoachBubble(page5);
    await shot(page5, 'E1_arc_overview');
    await page5.evaluate(() => window.scrollBy(0, 200));
    await wait(400);
    await shot(page5, 'E2_arc_timeline');
    // Details tab
    const detailsTab = page5.locator('text="Details"').first();
    if (await detailsTab.count() > 0) {
      await detailsTab.click();
      await wait(1000);
      await shot(page5, 'E3_arc_details');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JOURNAL RECEIPT — yesterday's 5/5 entry
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ Journal receipt ]');
  await loadPage(page5);
  const hubBtn = page5.locator('[aria-label="Open Hub — all habits, goals, and quick tasks"]').first();
  if (await hubBtn.count() > 0) {
    await hubBtn.click();
    await wait(1500);
    await dismissCoachBubble(page5);
    const journalTab = page5.locator('text="Journal"').first();
    if (await journalTab.count() > 0) {
      await journalTab.click();
      await wait(1200);
      await shot(page5, 'F1_journal_list');
      const firstEntry = page5.locator('text="Proof shown"').first();
      if (await firstEntry.count() > 0) {
        await firstEntry.click();
        await wait(800);
        await shot(page5, 'F2_journal_receipt');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COACH CHAT — open chat interface
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ Coach chat ]');
  await loadPage(page5);
  let chatFound = false;
  for (const sel of [
    '[aria-label="Open chat with Coach"]',
    '[aria-label="Coach — open chat"]',
    'button:has-text("Coach")',
    'button:has-text("Chat")',
  ]) {
    const btn = page5.locator(sel).first();
    if (await btn.count() > 0) {
      await btn.click();
      await wait(1500);
      await shot(page5, 'G1_coach_chat');
      chatFound = true;
      break;
    }
  }
  if (!chatFound) console.log('  ⚠️ Coach chat button not found');

  await ctx5.close();

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE 5: 5/5 + TODAY'S RECEIPT — after Generate Entry
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ 5/5 + receipt — after Generate Entry ]');
  const { ctx: ctx5r, page: page5r } = await launchMobile(
    buildMockMap(buildHabits(5), ARC_DAILY_SCORES, JOURNAL_ENTRIES_WITH_TODAY), '5of5r');
  await loadPage(page5r);
  await page5r.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  await shot(page5r, 'D3_receipt_top');
  // Scroll down to where the TodayReceiptCard typically appears (below proof section)
  await page5r.evaluate(() => window.scrollTo(0, 500));
  await wait(400);
  await shot(page5r, 'D4_receipt_card');

  // ═══════════════════════════════════════════════════════════════════════════
  // ARC WITH TODAY'S EVIDENCE — week view showing today's receipt dot
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ Arc with today\'s evidence ]');
  const arcBtn5r = page5r.locator('[data-tour="nav"] button:has-text("Arc"), nav button:has-text("Arc")').first();
  if (await arcBtn5r.count() > 0) {
    await page5r.evaluate(() => window.scrollTo(0, 0));
    await wait(200);
    await arcBtn5r.click();
    await wait(2500);
    await dismissCoachBubble(page5r);
    await shot(page5r, 'E4_arc_today_evidence_overview');
    await page5r.evaluate(() => window.scrollBy(0, 200));
    await wait(400);
    await shot(page5r, 'E5_arc_today_evidence_timeline');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUB PAGE — All habits & goals
  // Navigate back to Today first, then click "All habits & goals" button
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ Hub page ]');
  // Go back to Today screen via nav
  await loadPage(page5r);
  await wait(500);
  // Now find and click the "All habits & goals" hub shortcut
  const hubShortcut = page5r.locator('[aria-label="Open Hub — all habits, goals, and quick tasks"]').first();
  if (await hubShortcut.count() > 0) {
    await hubShortcut.click();
    await wait(1800);
    await dismissCoachBubble(page5r);
    await shot(page5r, 'I1_hub_top');
    await page5r.evaluate(() => window.scrollTo(0, 300));
    await wait(300);
    await shot(page5r, 'I2_hub_habits');
  } else {
    console.log('  ⚠️ Hub shortcut not found on Today — app may not have arcActive');
  }

  await ctx5r.close();

  // ═══════════════════════════════════════════════════════════════════════════
  // DESKTOP — hero shot of today + arc
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ Desktop ]');
  const { execSync: ex2 } = await import('child_process');
  try { ex2('rm -rf /tmp/pw-proof-desktop'); } catch {}
  const dCtx = await chromium.launchPersistentContext('/tmp/pw-proof-desktop', {
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'],
    viewport: {width:1440, height:900},
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const dPage = await dCtx.newPage();
  await setupMocks(dPage, buildMockMap(buildHabits(2), ARC_SCORES_TODAY_2));
  await loadPage(dPage);
  await dPage.screenshot({path: path.join(OUT_DIR,'H1_desktop_today.png'), fullPage:false});
  console.log('  📸 H1_desktop_today');
  await dCtx.close();

  // Summary
  const files = fs.readdirSync(OUT_DIR).filter(f=>f.endsWith('.png')).sort();
  console.log(`\n✅ Done — ${files.length} screenshots:\n  ${files.join('\n  ')}`);
})();
