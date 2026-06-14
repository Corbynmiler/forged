/**
 * Forged — SOURCE FINAL reel assembly
 * 6-beat structure: hook → proof taps → 5/5 complete → receipt → arc timeline → end card
 * Output: marketing/reels/forged_reel_B_SOURCE_FINAL.mp4
 * Target: 12–16 seconds, 1080×1920, h264, silent
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const CAPS = path.resolve('scripts/captures');
const RECS = path.resolve('scripts/recordings');
const OUT  = path.resolve('marketing/reels');
const TMP  = '/tmp/forged-sf';
const TXTD = '/tmp/forged-sf-txt';

fs.mkdirSync(OUT,  { recursive: true });
fs.mkdirSync(TMP,  { recursive: true });
fs.mkdirSync(TXTD, { recursive: true });

// ── Fonts ─────────────────────────────────────────────────────────────────────
const SERIF   = fs.existsSync('/tmp/DMSerifDisplay-Regular.ttf')
  ? '/tmp/DMSerifDisplay-Regular.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';
const SANS_BD = fs.existsSync('/tmp/DMSans-Bold.ttf')
  ? '/tmp/DMSans-Bold.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const WHITE     = 'white';
const GOLD_HEX  = '0xF5C842';   // goldBright — matches app ring

// ── Text file helper ──────────────────────────────────────────────────────────
let _ti = 0;
function txt(t) {
  const p = path.join(TXTD, `t${_ti++}.txt`);
  fs.writeFileSync(p, t, 'utf8');
  return p;
}

// ── drawtext — lower-third caption ───────────────────────────────────────────
// Safe zone: y=1630 sits inside the dense dark band.
// Delay-fade so caption appears 0.2s after cut.
function cap(text, { color = WHITE, size = 56, delay = 0.2 } = {}) {
  const tf = txt(text);
  return `drawtext=fontfile='${SANS_BD}':textfile='${tf}'` +
         `:fontsize=${size}:fontcolor=${color}` +
         `:x=(w-text_w)/2:y=1630` +
         `:shadowx=3:shadowy=3:shadowcolor=black@0.9` +
         `:alpha='if(gt(t\\,${delay})\\,min(1\\,(t-${delay})/0.2)\\,0)'`;
}

// ── Dark gradient bar (lower ~22% of frame) ───────────────────────────────────
const GRAD = [
  `drawbox=x=0:y=1460:w=1080:h=150:color=black@0.22:t=fill`,
  `drawbox=x=0:y=1610:w=1080:h=310:color=black@0.65:t=fill`,
].join(',');

// ── Scale: 390×844 recordings + 780×1688 PNGs → 1080×1920 ───────────────────
const SCALE_VID = `scale=888:1920:flags=lanczos,pad=1080:1920:96:0:black`;
const SCALE_IMG = `scale=888:1920:flags=lanczos,pad=1080:1920:96:0:black`;

// ── FFmpeg runner ─────────────────────────────────────────────────────────────
function ff(args, label) {
  console.log(`  → ${label}`);
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    console.error(`  ✗ FAILED: ${label}`);
    console.error(r.stderr.toString().slice(-900));
    process.exit(1);
  }
  const outPath = args[args.length - 1];
  const sz = fs.existsSync(outPath) ? `${(fs.statSync(outPath).size/1024).toFixed(0)}KB` : '?';
  console.log(`  ✓ ${label} [${sz}]`);
  return true;
}

// ── Still image segment (subtle 2% push-in zoom) ─────────────────────────────
function stillSeg(label, imgPath, durS, caption, out) {
  const frames = Math.round(durS * 30);
  const zp = `zoompan=z='1+0.02*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`;
  const vf = [SCALE_IMG, zp, GRAD, cap(caption[0], caption[1])].join(',');
  ff([
    '-y', '-loop', '1', '-i', imgPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(durS),
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], label);
}

// ── Video segment ─────────────────────────────────────────────────────────────
function vidSeg(label, vidPath, ss, durS, caption, out) {
  const vf = [SCALE_VID, 'fps=30', GRAD, cap(caption[0], caption[1])].join(',');
  ff([
    '-y', '-ss', String(ss), '-i', vidPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(durS),
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], label);
}

// ── End card ──────────────────────────────────────────────────────────────────
function endCard(out) {
  const tfForged  = txt('Forged');
  const tfTag     = txt('Proof over promises.');
  const forgedDt  = `drawtext=fontfile='${SERIF}':textfile='${tfForged}'` +
                    `:fontsize=144:fontcolor=white:x=(w-text_w)/2:y=820` +
                    `:shadowx=0:shadowy=0` +
                    `:alpha='min(1\\,t/0.4)'`;
  const tagDt     = `drawtext=fontfile='${SANS_BD}':textfile='${tfTag}'` +
                    `:fontsize=48:fontcolor=${GOLD_HEX}:x=(w-text_w)/2:y=1010` +
                    `:shadowx=2:shadowy=2:shadowcolor=black@0.7` +
                    `:alpha='min(1\\,t/0.5)'`;
  const warmGlow  = `drawbox=x=180:y=740:w=720:h=500:color=0xC8902A@0.07:t=fill`;
  const vf = `fps=30,${warmGlow},${forgedDt},${tagDt}`;
  ff([
    '-y',
    '-f', 'lavfi', '-i', `color=c=0x0F0F0D:s=1080x1920:r=30`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '2.2',
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], 'end-card');
}

// ── xfade concat ──────────────────────────────────────────────────────────────
function xfadeConcat(segs, durs, finalOut) {
  const FADE = 0.3;
  const offsets = [];
  let acc = 0;
  for (let i = 0; i < durs.length - 1; i++) {
    acc += i === 0 ? durs[i] : (durs[i] - FADE);
    offsets.push(+(acc - FADE).toFixed(3));
  }
  const totalDur = +(durs.reduce((a, b) => a + b, 0) - (durs.length - 1) * FADE).toFixed(2);
  console.log(`\n  xfade: ${segs.length} segs, offsets=[${offsets.join(', ')}], total=${totalDur}s`);

  let fc = '';
  let prev = '[0:v]';
  for (let i = 1; i < segs.length; i++) {
    const out = i < segs.length - 1 ? `[v${i}]` : '[vf]';
    fc += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offsets[i-1]}${out};`;
    prev = i < segs.length - 1 ? `[v${i}]` : '[vf]';
  }
  fc = fc.slice(0, -1);

  const tmp = path.join(TMP, `vonly.mp4`);
  ff([
    '-y',
    ...segs.flatMap(s => ['-i', s]),
    '-filter_complex', fc,
    '-map', '[vf]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-an', tmp,
  ], `xfade concat → ${totalDur}s`);

  ff([
    '-y', '-i', tmp,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'copy',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-t', String(totalDur),
    '-map', '0:v', '-map', '1:a',
    finalOut,
  ], path.basename(finalOut));
  return totalDur;
}

// ── Assets ────────────────────────────────────────────────────────────────────
const A1 = path.join(CAPS, 'A1_proof_0of5_top.png');       // hook: 0/5 empty ring
const D3 = path.join(CAPS, 'D3_receipt_top.png');           // receipt: Today's Verdict
const R1 = path.join(RECS, 'R1_proof_0to2.webm');           // proof taps 0→2
const R2 = path.join(RECS, 'R2_proof_3to5_complete.webm');  // proof taps 3→5 complete
const R5 = path.join(RECS, 'R5_arc_week_timeline_scroll.webm'); // arc timeline scroll

for (const [k, p] of Object.entries({ A1, D3, R1, R2, R5 })) {
  if (!fs.existsSync(p)) {
    console.error(`\n  ✗ Missing asset: ${k} → ${p}\n`);
    process.exit(1);
  }
}

// ── Beat timings ──────────────────────────────────────────────────────────────
// 6 beats, 5 xfades of 0.3s each → subtract 1.5s from raw total
// Raw: 2.0 + 3.0 + 3.2 + 2.5 + 4.0 + 2.2 = 16.9s → 16.9 - 1.5 = 15.4s ✓
const BEAT_DURS = [2.0, 3.0, 3.2, 2.5, 4.0, 2.2];

// R5: ss=3.0 catches the horizontal rail scroll (skips initial page load)
const R5_SS  = 3.0;
const R5_DUR = 4.0;

;(async () => {
  console.log('\n✨ Forged — SOURCE FINAL reel assembly\n');
  console.log(`  Fonts: ${SERIF.split('/').pop()}, ${SANS_BD.split('/').pop()}\n`);

  const segs = [1,2,3,4,5,6].map(n => path.join(TMP, `sf_s${n}.mp4`));

  // Beat 1: Hook — 0/5 ring, nothing done yet
  stillSeg('s1 hook (0/5 ring)', A1, BEAT_DURS[0],
    ["I nearly skipped today.", { color: WHITE, size: 56 }],
    segs[0]);

  // Beat 2: Proof taps 0→2 (from ss=5s, skip loading)
  vidSeg('s2 proof taps (0→2)', R1, 5.0, BEAT_DURS[1],
    ["So I logged proof instead.", { color: GOLD_HEX, size: 52 }],
    segs[1]);

  // Beat 3: Proof complete 3→5 (from ss=5s, skip loading)
  vidSeg('s3 proof complete (5/5)', R2, 5.0, BEAT_DURS[2],
    ["Not perfect. Recorded.", { color: WHITE, size: 58 }],
    segs[2]);

  // Beat 4: Receipt — Today's Verdict
  stillSeg("s4 receipt (Today's Verdict)", D3, BEAT_DURS[3],
    ["The day didn't disappear.", { color: WHITE, size: 52 }],
    segs[3]);

  // Beat 5: Arc timeline scroll — week rail + evidence spine
  vidSeg('s5 arc timeline scroll', R5, R5_SS, R5_DUR,
    ["21 days. All on record.", { color: GOLD_HEX, size: 52 }],
    segs[4]);

  // Beat 6: End card
  endCard(segs[5]);

  // ── Concat with xfades ────────────────────────────────────────────────────
  const finalOut = path.join(OUT, 'forged_reel_B_SOURCE_FINAL.mp4');
  const finalDur = xfadeConcat(segs, BEAT_DURS, finalOut);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  if (fs.existsSync(finalOut)) {
    const sz = (fs.statSync(finalOut).size / 1024 / 1024).toFixed(2);
    console.log(`\n✅ OUTPUT: ${path.relative(process.cwd(), finalOut)}`);
    console.log(`   Size:   ${sz} MB`);
    console.log(`   Duration: ~${finalDur}s (spec: 12–16s)`);
    console.log('\n   → marketing/reels/forged_reel_B_SOURCE_FINAL.mp4\n');
  } else {
    console.log('\n❌ Output file not created\n');
    process.exit(1);
  }
})();
