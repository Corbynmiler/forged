/**
 * Forged reel assembly — two 15-second 1080x1920 MP4s from captured assets.
 * No Higgsfield. No external APIs. No audio credits.
 * Run: node scripts/assemble-reels.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const CAPS = path.resolve('scripts/captures');
const RECS = path.resolve('scripts/recordings');
const OUT  = path.resolve('marketing/reels');
const TMP  = '/tmp/forged-reels';
const TXTD = '/tmp/forged-txt';

fs.mkdirSync(OUT,  { recursive: true });
fs.mkdirSync(TMP,  { recursive: true });
fs.mkdirSync(TXTD, { recursive: true });

// Fonts
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_REG  = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
if (!fs.existsSync(FONT_BOLD)) { console.error('Font not found:', FONT_BOLD); process.exit(1); }

// Text color constants
const WHITE = 'white';
const GOLD  = '0xC8902A';

let _txtIdx = 0;
function writeTxt(text) {
  const p = path.join(TXTD, `t${_txtIdx++}.txt`);
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

// Scale source (780x1688 PNGs or 390x844 WebMs) to fit inside 1080x1920
// Both have AR 0.462; target AR 0.5625 → scale to height 1920, pad sides
const SCALE_PAD = 'scale=888:1920:flags=lanczos,pad=1080:1920:96:0:black';

// Build a drawtext filter for one text line.
// y values tuned for 1080x1920 canvas:
//   upper-third ≈ 300, middle ≈ 900, lower-third ≈ 1450, near-bottom ≈ 1560
function dt(text, { y = 1480, size = 56, color = WHITE, bold = true } = {}) {
  const tf  = writeTxt(text);
  const ff  = bold ? FONT_BOLD : FONT_REG;
  // drawtext: fade in over 0.3s from segment start (t is per-clip timestamp)
  return `drawtext=fontfile='${ff}':textfile='${tf}':fontsize=${size}` +
         `:fontcolor=${color}:x=(w-text_w)/2:y=${y}` +
         `:shadowx=3:shadowy=3:shadowcolor=black@0.85` +
         `:alpha='min(1\\,t/0.3)'`;
}

// Build full -vf value for a segment
function vf(dtFilters) {
  return [SCALE_PAD, 'fps=30', ...dtFilters].join(',');
}

// Run ffmpeg. Returns true on success.
function ff(args, label) {
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    console.error(`  ✗ ${label}`);
    console.error(r.stderr.toString().slice(-600));
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

// Still image → MP4 segment (with silent audio for clean concat)
function imgSeg(label, imgPath, dur, dtList, out) {
  return ff([
    '-y',
    '-loop', '1', '-i', imgPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(dur),
    '-vf', vf(dtList),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], label);
}

// Video clip → MP4 segment (seek + trim + overlay)
function vidSeg(label, vidPath, ss, dur, dtList, out) {
  return ff([
    '-y',
    '-ss', String(ss), '-i', vidPath,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(dur),
    '-vf', vf(dtList),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], label);
}

// Concat segments into final MP4
function concatSegs(segs, out) {
  const listPath = path.join(TMP, `concat-${Date.now()}.txt`);
  fs.writeFileSync(listPath, segs.map(s => `file '${s}'`).join('\n'));
  return ff([
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    out,
  ], path.basename(out));
}

// ─── Asset paths ─────────────────────────────────────────────────────────────
const A1  = path.join(CAPS, 'A1_proof_0of5_top.png');
const D3  = path.join(CAPS, 'D3_receipt_top.png');
const E4  = path.join(CAPS, 'E4_arc_today_evidence_overview.png');
const R1  = path.join(RECS, 'R1_proof_0to2.webm');
const R2  = path.join(RECS, 'R2_proof_3to5_complete.webm');

// Verify all assets exist
const required = { A1, D3, E4, R1, R2 };
let missing = false;
for (const [k, p] of Object.entries(required)) {
  if (!fs.existsSync(p)) { console.error(`Missing: ${k} → ${p}`); missing = true; }
}
if (missing) process.exit(1);

// ─── Timing for recording trims ──────────────────────────────────────────────
// R1: 0/5 → 2/5 (total 11.36s)
//   loadPage+settle ≈ 5s, hold 0/5 1.5s, taps at ~6.5s and ~7.1s, hold 2/5 2s → end ~9.1s
//   Trim: ss=5.0, t=3.5 → shows: end of 0/5 hold + both taps + 2/5 state
const R1_SS = 5.0;
const R1_DUR = 3.5;

// R2: 3/5 → 5/5 (total 11.52s)
//   loadPage+settle ≈ 5s, hold 3/5 1.2s, taps at ~6.2s and ~7.1s, hold complete 2.5s → end ~9.6s
//   Trim: ss=5.0, t=4.0 → shows: end of 3/5 hold + both taps + completion banner
const R2_SS = 5.0;
const R2_DUR = 4.0;

(async () => {
  console.log('\n🎬 Forged — assembling reels\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION A: "Motivation didn't show up today. Proof still can."
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[ Reel A ]');

  const segA = [
    path.join(TMP, 'A_seg1.mp4'),
    path.join(TMP, 'A_seg2.mp4'),
    path.join(TMP, 'A_seg3.mp4'),
    path.join(TMP, 'A_seg4.mp4'),
    path.join(TMP, 'A_seg5.mp4'),
  ];

  // A1: 0/5 state — 2s — hook text
  imgSeg('A·seg1 (0/5 hook)', A1, 2.0, [
    dt("Motivation didn't show up today.", { y: 1460, size: 52, color: WHITE }),
  ], segA[0]);

  // A2: R1 trim — 3.5s — payoff line
  vidSeg('A·seg2 (0→2 taps)', R1, R1_SS, R1_DUR, [
    dt('Proof still can.', { y: 1480, size: 68, color: GOLD }),
  ], segA[1]);

  // A3: R2 trim — 4s — 3→5/5 taps
  vidSeg('A·seg3 (3→5 complete)', R2, R2_SS, R2_DUR, [
    dt('Day 21.  5 of 5.', { y: 1480, size: 64, color: WHITE }),
  ], segA[2]);

  // A4: Receipt — 3s
  imgSeg('A·seg4 (receipt)', D3, 3.0, [
    dt('Every day gets a record.', { y: 1480, size: 52, color: WHITE }),
  ], segA[3]);

  // A5: Arc evidence — 3.5s — branding
  imgSeg('A·seg5 (arc+brand)', E4, 3.5, [
    dt('Forged', { y: 1430, size: 72, color: GOLD }),
    dt('build the evidence.', { y: 1510, size: 46, color: WHITE, bold: false }),
  ], segA[4]);

  const outA = path.join(OUT, 'forged_reel_A.mp4');
  if (segA.every(s => fs.existsSync(s))) {
    concatSegs(segA, outA);
  } else {
    console.error('  ✗ Some A segments missing — skipping concat');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION B: "I nearly skipped today. So I logged proof instead."
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n[ Reel B ]');

  const segB = [
    path.join(TMP, 'B_seg1.mp4'),
    path.join(TMP, 'B_seg2.mp4'),
    path.join(TMP, 'B_seg3.mp4'),
    path.join(TMP, 'B_seg4.mp4'),
    path.join(TMP, 'B_seg5.mp4'),
  ];

  // B1: 0/5 state — 2s — first-person hook
  imgSeg('B·seg1 (skip hook)', A1, 2.0, [
    dt('I nearly skipped today.', { y: 1460, size: 58, color: WHITE }),
  ], segB[0]);

  // B2: R1 trim — 3.5s
  vidSeg('B·seg2 (0→2 taps)', R1, R1_SS, R1_DUR, [
    dt('So I logged proof instead.', { y: 1480, size: 52, color: GOLD }),
  ], segB[1]);

  // B3: R2 trim — 4s — completion
  vidSeg('B·seg3 (3→5 complete)', R2, R2_SS, R2_DUR, [
    dt('Not perfect.  Recorded.', { y: 1480, size: 60, color: WHITE }),
  ], segB[2]);

  // B4: Receipt — 3s
  imgSeg('B·seg4 (receipt)', D3, 3.0, [
    dt("The day didn't disappear.", { y: 1480, size: 52, color: WHITE }),
  ], segB[3]);

  // B5: Arc evidence — 3.5s — branding
  imgSeg('B·seg5 (arc+brand)', E4, 3.5, [
    dt('Forged', { y: 1430, size: 72, color: GOLD }),
    dt('proof over promises.', { y: 1510, size: 46, color: WHITE, bold: false }),
  ], segB[4]);

  const outB = path.join(OUT, 'forged_reel_B.mp4');
  if (segB.every(s => fs.existsSync(s))) {
    concatSegs(segB, outB);
  } else {
    console.error('  ✗ Some B segments missing — skipping concat');
  }

  // ─── Final report ──────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────');
  for (const [label, out] of [['Reel A', outA], ['Reel B', outB]]) {
    if (fs.existsSync(out)) {
      const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
      console.log(`✅ ${label}: ${out} (${size} MB)`);
    } else {
      console.log(`❌ ${label}: MISSING`);
    }
  }
  console.log('─────────────────────────────────────────\n');
})();
