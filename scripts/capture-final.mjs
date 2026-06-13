/**
 * Final polished marketing capture for Forged.
 * Dismisses coach bubble, captures all key screens in clean state.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import path from 'path';
import fs from 'fs';

const UID = 'ac1e6500-0511-4ce2-801a-eccf7a328027';
const BLOCK_ID = 'a0600001-0001-4001-8001-000000000001';
const ACCESS_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjkyOWY2ZWU3LThhOGYtNGJiZC1hNDhkLTRjZDI0NGYxYzY1OCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FwZG12YnpmanV2eHdvcmplcHplLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJhYzFlNjUwMC0wNTExLTRjZTItODAxYS1lY2NmN2EzMjgwMjciLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzgxMzI0NTczLCJpYXQiOjE3ODEzMjA5NzMsImVtYWlsIjoiY2hlZXNlZmluZ2Vyc2F0aG90bWFpbC5jby5uQGdtYWlsLmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJjaGVlc2VmaW5nZXJzYXRob3RtYWlsLmNvLm5AZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiYWMxZTY1MDAtMDUxMS00Y2UyLTgwMWEtZWNjZjdhMzI4MDI3In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3ODEzMjA5NzN9XSwic2Vzc2lvbl9pZCI6IjYzYjhkZDAxLTJlMzgtNGQ1Yy05ZWJkLTFkYmJmOGM5OTQ0ZSIsImlzX2Fub255bW91cyI6ZmFsc2V9.ZyMpMIAJ8fmeQ-9HgGFO4EHIJZZ3izzlKe3QOKxiFCmUffm4PbHEd1PP_j7I3A3XwbAppKaI0b-lXHcCRSVWwA';

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
  id:BLOCK_ID,user_id:UID,
  identity:'The person who ships proof, not promises',
  why_statement:"Because I've been 'almost ready' for two years. This time I'm building evidence instead of waiting for motivation.",
  old_pattern:'Planning without shipping. Starting without finishing. Telling myself I need more preparation.',
  minimum_proof:'One focused deep work session. Show up even when it feels mechanical.',
  start_date:'2026-05-24',end_date:'2026-07-04',status:'active',duration_days:42,review:null,
  created_at:'2026-06-13T02:03:48.735221+00:00',updated_at:'2026-06-13T03:33:12.62+00:00',
  title:'Build the System',arc_xp:490,completion_score:'71',arc_rank:'Tempered',
}];

const HABITS = [
  {id:'a0600001-0001-4001-8001-000000000011',user_id:UID,name:'Deep work session',emoji:'🎯',habit_type:'daily',color:'#2980B9',streak:7,best_streak:12,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,logs:[{date:'2026-06-06',note:'65 min, flow midway through',value:true},{date:'2026-06-07',note:'85 min — best session this arc',value:true},{date:'2026-06-08',note:'60 min, meetings cut in but got it done',value:true},{date:'2026-06-09',note:'55 min, slower day',value:true},{date:'2026-06-10',note:'80 min, real flow state',value:true},{date:'2026-06-11',note:'70 min',value:true},{date:'2026-06-12',note:'75 min, closed a loop I\'d been avoiding',value:true}],goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00'},
  {id:'a0600001-0001-4001-8001-000000000012',user_id:UID,name:'Move daily',emoji:'🏃',habit_type:'daily',color:'#27AE60',streak:4,best_streak:8,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,logs:[{date:'2026-06-06',note:'4km run',value:true},{date:'2026-06-07',note:'6km — furthest this arc',value:true},{date:'2026-06-09',note:'4km',value:true},{date:'2026-06-10',note:'5km run',value:true},{date:'2026-06-11',note:'short loop',value:true},{date:'2026-06-12',note:'4km',value:true}],goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00'},
  {id:'a0600001-0001-4001-8001-000000000013',user_id:UID,name:'No doom scroll before 9am',emoji:'📵',habit_type:'daily',color:'#E67E22',streak:7,best_streak:7,reflection:false,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,logs:[{date:'2026-06-06',note:'',value:true},{date:'2026-06-07',note:'',value:true},{date:'2026-06-08',note:'',value:true},{date:'2026-06-09',note:'',value:true},{date:'2026-06-10',note:'',value:true},{date:'2026-06-11',note:'',value:true},{date:'2026-06-12',note:'',value:true}],goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00'},
  {id:'a0600001-0001-4001-8001-000000000014',user_id:UID,name:'Post one useful thing',emoji:'📤',habit_type:'daily',color:'#9B59B6',streak:1,best_streak:3,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,logs:[{date:'2026-06-07',note:'posted a breakdown on product thinking — 3 DMs',value:true},{date:'2026-06-08',note:'shared rough mental model, got replies',value:true},{date:'2026-06-12',note:'published something rough, it worked',value:true}],goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00'},
  {id:'a0600001-0001-4001-8001-000000000015',user_id:UID,name:'Evening check-in',emoji:'🌙',habit_type:'daily',color:'#1ABC9C',streak:1,best_streak:6,reflection:true,reflection_prompt:'',weekly_target:null,start_value:null,target_value:null,unit:null,daily_budget:null,tap_increment:1,daily_target_minutes:null,block_id:BLOCK_ID,is_proof_action:true,logs:[{date:'2026-06-06',note:'',value:true},{date:'2026-06-07',note:'',value:true},{date:'2026-06-08',note:'',value:true},{date:'2026-06-09',note:'',value:true},{date:'2026-06-10',note:'',value:true},{date:'2026-06-12',note:'',value:true}],goal_aim:'maintain',original_budget:null,created_at:'2026-06-13T02:04:11.271332+00:00',updated_at:'2026-06-13T02:04:11.271332+00:00'},
];

const ARC_DAILY_SCORES = [
  {id:'1c7dc369-65a4-436f-a9b8-0222932da07b',user_id:UID,block_id:BLOCK_ID,date:'2026-05-24',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'c6c9d851-c3cf-4308-bd4f-934902ce4136',user_id:UID,block_id:BLOCK_ID,date:'2026-05-25',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'240b8d08-f0a7-4a2d-8a59-ff83a4e62ef4',user_id:UID,block_id:BLOCK_ID,date:'2026-05-26',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'cdece9cc-8e81-4619-ba9c-cfc1216d6176',user_id:UID,block_id:BLOCK_ID,date:'2026-05-27',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'17ea475c-cafd-4c29-b9b1-67a3c1ea4ee3',user_id:UID,block_id:BLOCK_ID,date:'2026-05-28',proof_total:5,proof_done:2,arc_xp_awarded:12,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'2cdcf167-3060-4b9c-aab5-b24e9e2694f6',user_id:UID,block_id:BLOCK_ID,date:'2026-05-29',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'3fa32685-1c76-4edc-be3d-bf43bfc2520b',user_id:UID,block_id:BLOCK_ID,date:'2026-05-30',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'5d61acc9-6c3f-450f-ab7b-dd56be948232',user_id:UID,block_id:BLOCK_ID,date:'2026-05-31',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'b88e405e-96bb-4eba-9387-0fce9b721b93',user_id:UID,block_id:BLOCK_ID,date:'2026-06-01',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'470f1934-c539-426e-ac31-490056772f78',user_id:UID,block_id:BLOCK_ID,date:'2026-06-02',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'704483ab-7082-4b1c-be12-c1dfd829ac39',user_id:UID,block_id:BLOCK_ID,date:'2026-06-03',proof_total:5,proof_done:1,arc_xp_awarded:6,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'616d3386-0c20-4ed8-a438-22027ca133ab',user_id:UID,block_id:BLOCK_ID,date:'2026-06-04',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'8cb38850-bafe-415a-9ecd-aaf739d300ca',user_id:UID,block_id:BLOCK_ID,date:'2026-06-05',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'ff78e703-66a4-45d4-b236-998cd0dde2e7',user_id:UID,block_id:BLOCK_ID,date:'2026-06-06',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'a952dc64-6789-4213-b8eb-5e2403625a3c',user_id:UID,block_id:BLOCK_ID,date:'2026-06-07',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'adad1b09-7410-45d8-8d9b-9c472126db0e',user_id:UID,block_id:BLOCK_ID,date:'2026-06-08',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'00af7b90-47e2-4435-8876-a8bf7920dced',user_id:UID,block_id:BLOCK_ID,date:'2026-06-09',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'e1377794-5959-4b84-97d5-64c4b71ea58e',user_id:UID,block_id:BLOCK_ID,date:'2026-06-10',proof_total:5,proof_done:4,arc_xp_awarded:24,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'97babed2-5dd1-4e7d-9625-40c316df3ec9',user_id:UID,block_id:BLOCK_ID,date:'2026-06-11',proof_total:5,proof_done:3,arc_xp_awarded:18,perfect_day:false,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'28b870aa-272b-4651-867b-cfa7bb0b78bc',user_id:UID,block_id:BLOCK_ID,date:'2026-06-12',proof_total:5,proof_done:5,arc_xp_awarded:40,perfect_day:true,created_at:'2026-06-13T02:04:30.428821+00:00'},
  {id:'5f6f7c83-43fe-4560-addb-1149542cab86',user_id:UID,block_id:BLOCK_ID,date:'2026-06-13',proof_total:5,proof_done:0,arc_xp_awarded:0,perfect_day:false,created_at:'2026-06-13T03:17:12.025908+00:00'},
];

const JOURNAL_ENTRIES = [
  {id:'24f6c304-5236-49e4-9e1d-30e44c35639b',user_id:UID,date:'2026-06-12',content:"Proof shown: Deep work (75 min), run 4km ✓, no doom scroll ✓, posted (mental model thread — got replies), evening check-in ✓. 5/5. Fourth perfect day.\n\nWins: Published the thing I've been sitting on. Three people replied with their own version of the same problem. That's what posting is for.\n\nHard parts: Still wrestling with the gap between doing the work and showing the work. They're not the same muscle but they need each other.\n\nPattern: The system is working. But a system without an output valve just accumulates. Shipping is part of the proof, not extra credit.\n\nTomorrow: Tomorrow is Day 21. That felt very far away on Day 1.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
  {id:'dbcdd0ea-cb40-48ae-9cc1-2b1375c9f62b',user_id:UID,date:'2026-06-11',content:"3/5 again. Starting to notice I do deep work, move, and check-in on autopilot now — but consistently miss the post and sometimes doom scroll in the morning. That asymmetry is interesting. Will ask Arlo about it.",daily_context:[],is_ai_generated:false,manually_edited:false,created_at:'2026-06-13T02:04:50.311091+00:00'},
  {id:'8f07f3fb-b061-4b06-84c9-fba1af3e54f8',user_id:UID,date:'2026-06-10',content:"Proof shown: Deep work (80 min), run 4km ✓, no doom scroll ✓, evening check-in ✓. 4/5. (Missed the post again.)\n\nWins: Best deep work session in two weeks — 80 minutes felt like 30. Flow state showing up more consistently.\n\nHard parts: Posting is becoming my weak spot. Need to rethink how I'm generating output worth sharing.\n\nPattern: Deep work is building well. But deep work without visible output is just spinning. Need to close more loops publicly.\n\nTomorrow: Whatever comes out of deep work tomorrow goes out that day. Rough draft is fine.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
  {id:'3efddf45-975b-443a-92d6-2f51897a1d9b',user_id:UID,date:'2026-06-08',content:"Proof shown: Deep work (60 min), moved ✓, no doom scroll ✓, posted (rough mental model), evening check-in ✓. 4/5.\n\nWins: Week 2 complete. Looked back at the timeline for the first time. More green than I expected.\n\nHard parts: Deep work felt mechanical today. Not inspired, just executing. Fine, but noticeable.\n\nPattern: Not every day needs to be a highlight. Most days are just days. The system runs anyway.\n\nTomorrow: Find something actually worth posting. Even a rough idea counts.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
  {id:'681972d4-c91e-4216-9d9f-12487b94cf33',user_id:UID,date:'2026-06-07',content:"Proof shown: Deep work (85 min), 6km run, phone-free until 9am, posted one useful breakdown, evening reflection. 5/5. Third perfect day.\n\nWins: Ran the furthest I have in months without planning to — just felt like it. That's compounding. The physical system catching up with the mental one.\n\nHard parts: Had to cancel a dinner to keep the morning clean. Felt bad for an hour. Fine after.\n\nPattern: I'm protecting the morning like it means something now. Because it does.\n\nTomorrow: Week 3 starts. Don't let the momentum become pressure. Same actions, different week.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
  {id:'93cb886c-e8a4-4e8f-b8b7-c62a848cfe5b',user_id:UID,date:'2026-06-05',content:"Proof shown: Deep work (72 min), run 5km ✓, no doom scroll ✓, posted one useful breakdown on product thinking, evening log done.\n\nWins: The post landed — 3 DMs asking follow-up questions. That's the proof. Shipping creates surface area.\n\nHard parts: Almost talked myself out of the post. \"Not ready, needs polish.\" Published it rough and it worked fine.\n\nPattern: \"Not ready\" is the old pattern. Posting is the proof action. The post IS the work.\n\nTomorrow: Follow up on the DMs. They're signal.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
  {id:'1842b2bb-a253-4634-9630-8324dd183138',user_id:UID,date:'2026-06-04',content:"Proof shown: Deep work (45 min), short walk ✓, no doom scroll ✓, evening check-in ✓. Back to 4/5.\n\nWins: Bounced back. One bad day didn't become two. That's new.\n\nHard parts: Yesterday still feels present. The work blowup is unresolved. Hard to concentrate with ambient stress.\n\nPattern: Bad days don't undo the system. The system is specifically for the days when motivation is gone.\n\nTomorrow: Short morning check-in to surface whatever's blocking before it becomes ambient noise.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
  {id:'a603f0ab-f26f-4219-a058-46ad74f6042e',user_id:UID,date:'2026-06-03',content:"Worst day so far. Work blew up, barely got 1 habit in (just the check-in). Felt like watching the streak die in slow motion. But I didn't delete the app. That's the floor and I'm standing on it.",daily_context:[],is_ai_generated:false,manually_edited:false,created_at:'2026-06-13T02:04:50.311091+00:00'},
  {id:'c72c334e-6a26-44f4-971d-1b7d538ffd20',user_id:UID,date:'2026-06-01',content:"Tired after a solid week. 3/5 but they were the right 3 — deep work, move, evening. Skipped posting and let myself off the doom scroll thing in the morning. Still counts as showing up.",daily_context:[],is_ai_generated:false,manually_edited:false,created_at:'2026-06-13T02:04:50.311091+00:00'},
  {id:'3569eab2-c9de-4d4a-a807-0e115c85d8c5',user_id:UID,date:'2026-05-31',content:"Proof shown: Deep work (90 min), 5km run, no doom scroll until 9:30am, posted two useful things, evening check-in complete. First 5/5 day.\n\nWins: Stringing all five together felt different. Not just completing items — actually building something that resembles a system.\n\nHard parts: Evening check-in nearly missed — had dinner plans and almost called it. Opened the app at 11pm and logged anyway.\n\nPattern: Perfect days feel possible when I don't negotiate with myself in the morning.\n\nTomorrow: Keep the morning sequence tight. See if I can repeat.",daily_context:[],is_ai_generated:true,manually_edited:false,created_at:'2026-06-13T02:05:29.900687+00:00'},
];

const WEEKLY_BRIEFS = [
  {user_id:UID,week_start:'2026-06-01',brief_text:"Week 2 complete. Proof rate: 69% — including a bad day on arc day 11 (1/5, work emergency) and a clean bounce back the next morning. That recovery pattern is the clearest proof in the arc so far. Week 2 also had a second perfect day (arc day 15). Deep work is now Molly's most reliable habit — 6 of 7 days and the sessions are getting longer. Posting publicly is the consistent gap: she's shipping less than her other proof actions. The system is real. The output valve needs work."},
  {user_id:UID,week_start:'2026-05-25',brief_text:"Week 1 of Build the System is in. Molly held a 71% proof rate across 7 days — including her first perfect day on Saturday. She hit the deep work session on 6 of 7 days and ran more than she has in months. The real signal this week: she showed up on Wednesday with 2/5 instead of abandoning the arc entirely. That floor-holding is new. The morning sequence is forming. The system has a heartbeat."},
];

const COACH_MEMORY = [{
  content: "Molly, 22-day arc checkpoint (42 total). Core mission: break planning-without-shipping, starting-without-finishing, waiting-for-perfect prep. Proof over promises.\n\nLocked in: Deep work 80+ min (now reliable, tolerate mechanical days), daily movement 4–5km, no doom scroll before 9am (7+ day streak). Mornings are her strongest cognitive window; flow states reliable.\n\nBottleneck: posting publicly. Completes all work, skips share—says \"not ready,\" exact old pattern. Day 12 proved it works (rough thread → 3 replies). Knows intellectually, still emotionally resists.\n\nNext: Continue shipping rough. Any format. Before other work. The feeling-gap closes through repetition, not readiness. 20 days left to embed this.",
  updated_at: '2026-06-13T03:23:10.274+00:00',
}];

// ── Setup ─────────────────────────────────────────────────────────────────────

const OUT_DIR = path.resolve('/home/user/forged/scripts/captures');
fs.mkdirSync(OUT_DIR, { recursive: true });
// Clean previous
fs.readdirSync(OUT_DIR).filter(f=>f.endsWith('.png')).forEach(f => fs.unlinkSync(path.join(OUT_DIR,f)));

function jsonResp(data) {
  return { status:200, contentType:'application/json',
    headers:{'Content-Range':`0-${Math.max(0,data.length-1)}/${data.length}`,'Access-Control-Allow-Origin':'*'},
    body: JSON.stringify(data) };
}
function emptyResp() { return {status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'[]'}; }

const MOCK_MAP = {
  profiles: PROFILE, habits: HABITS, forge_blocks: FORGE_BLOCKS,
  arc_daily_scores: ARC_DAILY_SCORES, journal_entries: JOURNAL_ENTRIES,
  weekly_brief_generation_usage: WEEKLY_BRIEFS, coach_memory: COACH_MEMORY,
};

async function setupMocks(page) {
  await page.route('**apdmvbzfjuvxworjepze.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.includes('/auth/v1/')) {
      await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(p.includes('/user')?USER_OBJ:{access_token:ACCESS_TOKEN,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+86400*365,refresh_token:'mock-refresh',user:USER_OBJ})});
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
  await page.addInitScript(([k,v]) => localStorage.setItem(k,v), ['sb-apdmvbzfjuvxworjepze-auth-token', SESSION]);
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shot(page, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({path: p, fullPage: false});
  console.log(`  📸 ${name}`);
}

async function dismissCoachBubble(page) {
  try {
    const x = page.locator('[aria-label="Dismiss coach tip"]').first();
    if (await x.count() > 0) { await x.click(); await wait(300); }
  } catch {}
  // Also try pressing Escape
  await page.keyboard.press('Escape');
  await wait(200);
}

async function loadPage(page, url = 'http://localhost:5173') {
  await page.goto(url, {waitUntil:'networkidle',timeout:30000});
  await wait(3000);
  await dismissCoachBubble(page);
  await wait(300);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🎬 Forged — final marketing captures\n');

  // ── MOBILE CONTEXT ───────────────────────────────────────────────────────────
  const ctx = await chromium.launchPersistentContext('/tmp/pw-final-mobile', {
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'],
    viewport: {width:390, height:844},
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const page = await ctx.newPage();
  await setupMocks(page);

  // ═══ TODAY ════════════════════════════════════════════════════════════════════
  console.log('[ TODAY ]');
  await loadPage(page);
  await shot(page, '01_today_hero');

  // Scroll to see all habits
  await page.evaluate(() => window.scrollTo(0, 320));
  await wait(300);
  await shot(page, '02_today_all_habits');

  // Focus on arc card area
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(200);
  // Try tapping a habit to show proof state — tap deep work
  const deepWorkCheckBtn = page.locator('text="Deep work session"').first();
  if (await deepWorkCheckBtn.count() > 0) {
    const box = await deepWorkCheckBtn.boundingBox();
    // Tap the checkmark (right side of the row)
    if (box) await page.mouse.click(box.x + box.width + 50, box.y + box.height/2);
    await wait(800);
    await shot(page, '03_today_habit_checked');
    // Now also check move daily
    await page.evaluate(() => window.scrollTo(0, 100));
    await wait(200);
    await shot(page, '04_today_two_checked');
  }

  // Reset — reload clean
  await loadPage(page);

  // ═══ ARC PAGE ════════════════════════════════════════════════════════════════
  console.log('[ ARC ]');
  const arcBtn = page.locator('button:has-text("Arc")').first();
  if (await arcBtn.count() > 0) {
    await arcBtn.click();
    await wait(2000);
    await dismissCoachBubble(page);
    await shot(page, '05_arc_overview');

    // Scroll down to see the week timeline
    await page.evaluate(() => window.scrollBy(0, 200));
    await wait(400);
    await shot(page, '06_arc_timeline');

    // Try clicking "Details" tab
    const detailsTab = page.locator('text="Details"').first();
    if (await detailsTab.count() > 0) {
      await detailsTab.click();
      await wait(1000);
      await shot(page, '07_arc_details');
    }
  }

  // ═══ YOU / PROFILE PAGE ══════════════════════════════════════════════════════
  console.log('[ YOU ]');
  const youBtn = page.locator('button:has-text("You")').first();
  if (await youBtn.count() > 0) {
    await youBtn.click();
    await wait(2000);
    await dismissCoachBubble(page);
    await shot(page, '08_you_top');
    await page.evaluate(() => window.scrollBy(0, 300));
    await wait(300);
    await shot(page, '09_you_scrolled');
  }

  // ═══ JOURNAL (from hub or direct nav) ════════════════════════════════════════
  console.log('[ JOURNAL ]');
  // Go to today first, then look for journal link
  await loadPage(page);
  // The hub "All habits & goals →" button might show journal
  const hubBtn = page.locator('[aria-label="Open Hub — all habits, goals, and loose ends"]').first();
  if (await hubBtn.count() > 0) {
    await hubBtn.click();
    await wait(1500);
    await dismissCoachBubble(page);
    await shot(page, '10_hub_view');
    // Look for Journal tab in hub
    const journalTab = page.locator('text="Journal"').first();
    if (await journalTab.count() > 0) {
      await journalTab.click();
      await wait(1200);
      await shot(page, '11_journal_list');
      // Click first entry
      const firstEntry = page.locator('text="Proof shown"').first();
      if (await firstEntry.count() > 0) {
        await firstEntry.click();
        await wait(800);
        await shot(page, '12_journal_entry');
      }
    }
  }

  // ═══ COACH CHAT ══════════════════════════════════════════════════════════════
  console.log('[ COACH CHAT ]');
  await loadPage(page);
  // Try the Chat button in bottom nav
  const chatBtn = page.locator('[aria-label="Open chat with Coach"]').first();
  if (await chatBtn.count() > 0) {
    await chatBtn.click();
    await wait(1500);
    await shot(page, '13_coach_chat_empty');
  } else {
    // try aria-label="Coach — open chat"
    const coachChatBtn = page.locator('[aria-label="Coach — open chat"]').first();
    if (await coachChatBtn.count() > 0) {
      await coachChatBtn.click();
      await wait(1500);
      await shot(page, '13_coach_chat_open');
    }
  }

  // ═══ CLEAN HERO SHOTS ════════════════════════════════════════════════════════
  console.log('[ HERO SHOTS ]');
  await loadPage(page);
  await shot(page, '14_today_hero_clean');

  await page.evaluate(() => window.scrollTo(0, 150));
  await wait(300);
  await shot(page, '15_today_habits_scrolled');

  await ctx.close();

  // ── DESKTOP CONTEXT ──────────────────────────────────────────────────────────
  console.log('[ DESKTOP ]');
  const dCtx = await chromium.launchPersistentContext('/tmp/pw-final-desktop', {
    executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'],
    viewport: {width:1440, height:900},
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const dPage = await dCtx.newPage();
  await setupMocks(dPage);
  await loadPage(dPage);
  await dPage.screenshot({path: path.join(OUT_DIR,'16_desktop_today.png'), fullPage:false});
  console.log('  📸 16_desktop_today');

  const dArcBtn = dPage.locator('button:has-text("Arc")').first();
  if (await dArcBtn.count() > 0) {
    await dArcBtn.click();
    await wait(2000);
    await dismissCoachBubble(dPage);
    await dPage.screenshot({path: path.join(OUT_DIR,'17_desktop_arc.png'), fullPage:false});
    console.log('  📸 17_desktop_arc');
  }
  await dCtx.close();

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  console.log('\n✅ All captures complete!');
  const files = fs.readdirSync(OUT_DIR).filter(f=>f.endsWith('.png'));
  console.log(`\n📁 ${files.length} screenshots:\n`);
  files.sort().forEach(f => console.log(`   ${f}`));
})();
