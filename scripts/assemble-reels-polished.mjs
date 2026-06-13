/**
 * Forged — polished reel assembly
 * Improvements over base reels:
 *   - DM Serif Display wordmark on end card
 *   - Stepped dark gradient bars for text legibility
 *   - Subtle 2.5% zoom-in on still segments
 *   - 0.3s xfade transitions between all segments
 *   - Clean end card (Higgsfield bg if available, FFmpeg fallback)
 *   - Total ~13.3s (within 12-16s spec)
 *
 * Higgsfield image: download to HIGGS_BG_PATH before running.
 * Zero credits if HIGGS_BG_PATH doesn't exist — falls back to pure FFmpeg.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const CAPS = path.resolve('scripts/captures');
const RECS = path.resolve('scripts/recordings');
const OUT  = path.resolve('marketing/reels');
const TMP  = '/tmp/forged-polish';
const TXTD = '/tmp/forged-txt-p';

fs.mkdirSync(OUT,  { recursive: true });
fs.mkdirSync(TMP,  { recursive: true });
fs.mkdirSync(TXTD, { recursive: true });

// ── Fonts ────────────────────────────────────────────────────────────────────
// DM Serif Display — Forged brand serif (wordmark)
const SERIF   = fs.existsSync('/tmp/DMSerifDisplay-Regular.ttf')
  ? '/tmp/DMSerifDisplay-Regular.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';
// DM Sans Variable — Forged brand sans (overlays)
const SANS    = fs.existsSync('/tmp/DMSans-Variable.ttf')
  ? '/tmp/DMSans-Variable.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
// DejaVu Sans Bold — reliable fallback for all overlay text
const SANS_BD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// ── Colors ───────────────────────────────────────────────────────────────────
const WHITE = 'white';
const GOLD  = '0xC8902A';

// ── Higgsfield end-card background ───────────────────────────────────────────
// Download the generated image here before running the script.
const HIGGS_BG = '/tmp/forged_endcard_bg.jpg';

// ── Text file helper ─────────────────────────────────────────────────────────
let _ti = 0;
function txt(t) {
  const p = path.join(TXTD, `t${_ti++}.txt`);
  fs.writeFileSync(p, t, 'utf8');
  return p;
}

// ── drawtext filter ──────────────────────────────────────────────────────────
// Uses textfile= to avoid all escaping issues (apostrophes, em-dashes, etc.)
function dt(text, { y, size, color = WHITE, font = SANS_BD, fadeIn = 0.25 } = {}) {
  const tf = txt(text);
  return `drawtext=fontfile='${font}':textfile='${tf}':fontsize=${size}` +
         `:fontcolor=${color}:x=(w-text_w)/2:y=${y}` +
         `:shadowx=2:shadowy=2:shadowcolor=black@0.8` +
         `:alpha='min(1\\,t/${fadeIn})'`;
}

// ── Dark gradient bar ─────────────────────────────────────────────────────────
// Two-step: soft entry at y=1480, dense at y=1600.
// Covers only the bottom ~22% of frame — app proof content stays readable above.
const GRAD = [
  `drawbox=x=0:y=1480:w=1080:h=130:color=black@0.18:t=fill`,
  `drawbox=x=0:y=1610:w=1080:h=310:color=black@0.58:t=fill`,
].join(',');

// ── Scale filter ─────────────────────────────────────────────────────────────
// Source PNGs: 780×1688 (2× capture). Recordings: 390×844. Both AR ≈ 0.462.
// Target: 1080×1920. Scale to height, pad sides with black.
const SCALE = `scale=888:1920:flags=lanczos,pad=1080:1920:96:0:black`;

// ── FFmpeg runner ─────────────────────────────────────────────────────────────
function ff(args, label) {
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    console.error(`  ✗ ${label}`);
    console.error(r.stderr.toString().slice(-700));
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

// ── Still image segment (with subtle zoom-in) ─────────────────────────────────
function stillSeg(label, imgPath, durS, dtFilters, out) {
  const frames = Math.round(durS * 30);
  const zp = `zoompan=z='1+0.025*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`;
  const vf = [SCALE, zp, GRAD, ...dtFilters].join(',');
  return ff([
    '-y', '-loop', '1', '-i', imgPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(durS),
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], label);
}

// ── Video segment ──────────────────────────────────────────────────────────────
function vidSeg(label, vidPath, ss, durS, dtFilters, out) {
  const vf = [SCALE, 'fps=30', GRAD, ...dtFilters].join(',');
  return ff([
    '-y', '-ss', String(ss), '-i', vidPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(durS),
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], label);
}

// ── End card segment ───────────────────────────────────────────────────────────
// Uses Higgsfield background if downloaded, otherwise pure FFmpeg dark bg.
function endCard(tagline, out) {
  const useHiggs = fs.existsSync(HIGGS_BG) && fs.statSync(HIGGS_BG).size > 1000;

  const tfForged = txt('Forged');
  const tfTag    = txt(tagline);
  const forgedDt = `drawtext=fontfile='${SERIF}':textfile='${tfForged}'` +
                   `:fontsize=136:fontcolor=white:x=(w-text_w)/2:y=840` +
                   `:alpha='min(1\\,t/0.4)'`;
  const tagDt    = `drawtext=fontfile='${SANS}':textfile='${tfTag}'` +
                   `:fontsize=50:fontcolor=${GOLD}:x=(w-text_w)/2:y=1018` +
                   `:alpha='min(1\\,t/0.5)'`;

  if (useHiggs) {
    console.log(`  → Using Higgsfield background: ${HIGGS_BG}`);
    // Scale Higgsfield image (768×1344) to fill 1080×1920, add text
    const vf = [
      `scale=1080:1920:force_original_aspect_ratio=increase`,
      `crop=1080:1920:(iw-ow)/2:(ih-oh)/2`,
      `noise=alls=8:allf=t+u`,  // subtle grain to soften AI sharpness
      `fps=30`,
      forgedDt,
      tagDt,
    ].join(',');
    return ff([
      '-y', '-loop', '1', '-i', HIGGS_BG,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', '2.0',
      '-vf', vf,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2',
      '-shortest', out,
    ], 'end-card [Higgsfield bg]');
  } else {
    console.log('  → Higgsfield bg not ready, using FFmpeg fallback');
    const warmGlow = `drawbox=x=190:y=760:w=700:h=460:color=0xC8902A@0.08:t=fill`;
    const vf = `noise=alls=20:allf=t+u,${warmGlow},fps=30,${forgedDt},${tagDt}`;
    return ff([
      '-y',
      '-f', 'lavfi', '-i', `color=c=0x0F0F0D:s=1080x1920:r=30`,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', '2.0',
      '-vf', vf,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '44100', '-ac', '2',
      '-shortest', out,
    ], 'end-card [FFmpeg fallback]');
  }
}

// ── xfade concat ──────────────────────────────────────────────────────────────
// Calculates offsets automatically from segment durations.
function xfadeConcat(segs, durs, finalOut) {
  const FADE = 0.3;
  const offsets = [];
  let acc = 0;
  for (let i = 0; i < durs.length - 1; i++) {
    acc += i === 0 ? durs[i] : (durs[i] - FADE);
    offsets.push(+(acc - FADE).toFixed(3));
  }
  const totalDur = +(durs.reduce((a, b) => a + b, 0) - (durs.length - 1) * FADE).toFixed(2);

  // Build xfade filtergraph
  let fc = '';
  let prev = '[0:v]';
  for (let i = 1; i < segs.length; i++) {
    const out = i < segs.length - 1 ? `[v${i}]` : '[vf]';
    fc += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offsets[i-1]}${out};`;
    prev = i < segs.length - 1 ? `[v${i}]` : '[vf]';
  }
  fc = fc.slice(0, -1);

  // Pass 1: video-only xfade concat
  const tmp = path.join(TMP, `vonly_${Date.now()}.mp4`);
  const ok = ff([
    '-y',
    ...segs.flatMap(s => ['-i', s]),
    '-filter_complex', fc,
    '-map', '[vf]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-an', tmp,
  ], `xfade (${segs.length} segs → ${totalDur}s)`);
  if (!ok) return false;

  // Pass 2: mux with silent audio
  return ff([
    '-y', '-i', tmp,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'copy',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-t', String(totalDur),
    '-map', '0:v', '-map', '1:a',
    finalOut,
  ], path.basename(finalOut));
}

// ── Assets ────────────────────────────────────────────────────────────────────
const A1 = path.join(CAPS, 'A1_proof_0of5_top.png');
const D3 = path.join(CAPS, 'D3_receipt_top.png');
const R1 = path.join(RECS, 'R1_proof_0to2.webm');
const R2 = path.join(RECS, 'R2_proof_3to5_complete.webm');

for (const [k, p] of Object.entries({ A1, D3, R1, R2 })) {
  if (!fs.existsSync(p)) { console.error(`Missing asset: ${k} → ${p}`); process.exit(1); }
}

const R1_SS = 5.0, R1_DUR = 3.5;
const R2_SS = 5.0, R2_DUR = 4.0;
const DURS = [2, R1_DUR, R2_DUR, 3, 2]; // five-segment durations

(async () => {
  console.log('\n✨ Forged — polished reel assembly\n');
  console.log(`  Fonts: ${path.basename(SERIF)}, ${path.basename(SANS)}`);
  console.log(`  Higgsfield bg: ${fs.existsSync(HIGGS_BG) ? 'READY' : 'not yet downloaded'}\n`);

  // ─── REEL B POLISHED ─────────────────────────────────────────────────────
  console.log('[ Reel B — polished ]');
  const BP = [1,2,3,4,5].map(n => path.join(TMP, `BP_s${n}.mp4`));

  stillSeg('B·s1 hook',     A1, 2,      [dt("I nearly skipped today.",     { y:1625, size:58 })], BP[0]);
  vidSeg  ('B·s2 0→2',      R1, R1_SS, R1_DUR, [dt("So I logged proof instead.", { y:1625, size:52, color:GOLD })], BP[1]);
  vidSeg  ('B·s3 3→5',      R2, R2_SS, R2_DUR, [dt("Not perfect. Recorded.",     { y:1625, size:60 })], BP[2]);
  stillSeg('B·s4 receipt',  D3, 3,      [dt("The day didn't disappear.",   { y:1625, size:52 })], BP[3]);
  endCard('Proof over promises.', BP[4]);

  const outBP = path.join(OUT, 'forged_reel_B_polished.mp4');
  if (BP.every(s => fs.existsSync(s))) {
    xfadeConcat(BP, DURS, outBP);
  } else {
    console.error('  ✗ Some B segments missing');
  }

  // ─── REEL A POLISHED (cheap, same pipeline) ───────────────────────────────
  console.log('\n[ Reel A — polished ]');
  const AP = [1,2,3,4,5].map(n => path.join(TMP, `AP_s${n}.mp4`));

  stillSeg('A·s1 hook',     A1, 2,      [dt("Motivation didn't show up today.", { y:1625, size:50 })], AP[0]);
  vidSeg  ('A·s2 0→2',      R1, R1_SS, R1_DUR, [dt("Proof still can.",                { y:1625, size:68, color:GOLD })], AP[1]);
  vidSeg  ('A·s3 3→5',      R2, R2_SS, R2_DUR, [dt("Day 21.  5 of 5.",               { y:1625, size:64 })], AP[2]);
  stillSeg('A·s4 receipt',  D3, 3,      [dt("Every day gets a record.",        { y:1625, size:52 })], AP[3]);
  endCard('Build the evidence.', AP[4]);

  const outAP = path.join(OUT, 'forged_reel_A_polished.mp4');
  if (AP.every(s => fs.existsSync(s))) {
    xfadeConcat(AP, DURS, outAP);
  } else {
    console.error('  ✗ Some A segments missing');
  }

  // ─── THUMBNAIL: frame from Reel B polished at t=1s ────────────────────────
  console.log('\n[ Thumbnail ]');
  const thumbOut = path.join(OUT, 'forged_reel_B_thumbnail.png');
  if (fs.existsSync(outBP)) {
    ff([
      '-y', '-ss', '1', '-i', outBP,
      '-vframes', '1', thumbOut,
    ], 'thumbnail (t=1s)');
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────');
  for (const [label, file] of [
    ['Reel B polished', outBP],
    ['Reel A polished', outAP],
    ['Thumbnail',       thumbOut],
  ]) {
    if (fs.existsSync(file)) {
      const sz = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
      console.log(`✅ ${label}: ${path.relative(process.cwd(), file)} (${sz} MB)`);
    } else {
      console.log(`❌ ${label}: not created`);
    }
  }

  const useHiggs = fs.existsSync(HIGGS_BG) && fs.statSync(HIGGS_BG).size > 1000;
  console.log(`\nHighsfield used: ${useHiggs ? 'YES (end card background)' : 'NO (FFmpeg fallback)'}`);
  console.log('─────────────────────────────────────────────────\n');
})();
