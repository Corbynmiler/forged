/**
 * Forged — Reel C assembly
 * Source: public/SCREENRECORDING.MP4 (iPhone, 1170×2532 HEVC, 80.5s, real device Day 22)
 *
 * Outputs:
 *   marketing/reels/forged_reel_C_captioned.mp4       — with captions
 *   marketing/reels/forged_reel_C_nocaption.mp4       — clean template (no captions, no gradient)
 *
 * Cut plan (all from SCREENRECORDING.MP4):
 *   Beat 1 ss=0.0   dur=2.0  — Today 0/5 hook
 *   Beat 2 ss=2.5   dur=3.5  — Proof taps ring filling 1→2/5
 *   Beat 3 ss=11.0  dur=2.5  — 5/5 complete gold ring
 *   Beat 4 ss=27.0  dur=3.0  — W2 Arc evidence spine (real entries)
 *   Beat 5 ss=56.0  dur=3.5  — W3 expanded receipt (WINS/HARD PARTS/PATTERN)
 *   Beat 6          dur=2.2  — End card
 *
 * Total: ~15.2s (within 12–16s spec)
 */
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const SR   = path.resolve('public/SCREENRECORDING.MP4');
const OUT  = path.resolve('marketing/reels');
const TMP  = '/tmp/forged-rc';
const TXTD = '/tmp/forged-rc-txt';

fs.mkdirSync(OUT,  { recursive: true });
fs.mkdirSync(TMP,  { recursive: true });
fs.mkdirSync(TXTD, { recursive: true });

if (!fs.existsSync(SR)) {
  console.error(`\n  ✗ Missing: ${SR}\n`);
  process.exit(1);
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
const SERIF   = fs.existsSync('/tmp/DMSerifDisplay-Regular.ttf')
  ? '/tmp/DMSerifDisplay-Regular.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf';
const SANS_BD = fs.existsSync('/tmp/DMSans-Bold.ttf')
  ? '/tmp/DMSans-Bold.ttf'
  : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const WHITE    = 'white';
const GOLD_HEX = '0xF5C842';

// ── Text file helper ──────────────────────────────────────────────────────────
let _ti = 0;
function txt(t) {
  const p = path.join(TXTD, `t${_ti++}.txt`);
  fs.writeFileSync(p, t, 'utf8');
  return p;
}

// ── Caption drawtext (lower-third, safe zone y=1630) ─────────────────────────
function cap(text, { color = WHITE, size = 56, delay = 0.2 } = {}) {
  const tf = txt(text);
  return `drawtext=fontfile='${SANS_BD}':textfile='${tf}'` +
         `:fontsize=${size}:fontcolor=${color}` +
         `:x=(w-text_w)/2:y=1630` +
         `:shadowx=3:shadowy=3:shadowcolor=black@0.9` +
         `:alpha='if(gt(t\\,${delay})\\,min(1\\,(t-${delay})/0.2)\\,0)'`;
}

// ── Dark gradient bar — lower 22% of frame ───────────────────────────────────
const GRAD = [
  `drawbox=x=0:y=1460:w=1080:h=150:color=black@0.22:t=fill`,
  `drawbox=x=0:y=1610:w=1080:h=310:color=black@0.65:t=fill`,
].join(',');

// ── Scale: iPhone 1170×2532 → 888×1920 → pad to 1080×1920 ──────────────────
// -2:1920 = maintain aspect to height 1920, round width to even = 888
// then pad width to 1080 (96px black bars each side)
const SCALE_IPHONE = [
  `scale=-2:1920:flags=lanczos`,
  `pad=1080:1920:(ow-iw)/2:0:black`,
].join(',');

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
}

// ── iPhone video segment (HEVC input, explicit v/a mapping) ──────────────────
function iSeg(label, ss, durS, captionArgs /* [text, opts] or null */, out) {
  const filters = [SCALE_IPHONE, 'fps=30'];
  if (captionArgs) filters.push(GRAD, cap(captionArgs[0], captionArgs[1] || {}));
  const vf = filters.join(',');
  ff([
    '-y', '-ss', String(ss), '-i', SR,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(durS),
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-shortest', out,
  ], label);
}

// ── End card ──────────────────────────────────────────────────────────────────
function endCard(captionArgs, out) {
  const tfForged = txt('Forged');
  const tfTag    = txt('Proof over promises.');
  const forgedDt = `drawtext=fontfile='${SERIF}':textfile='${tfForged}'` +
                   `:fontsize=144:fontcolor=white:x=(w-text_w)/2:y=820` +
                   `:alpha='min(1\\,t/0.4)'`;
  const tagDt    = `drawtext=fontfile='${SANS_BD}':textfile='${tfTag}'` +
                   `:fontsize=48:fontcolor=${GOLD_HEX}:x=(w-text_w)/2:y=1010` +
                   `:shadowx=2:shadowy=2:shadowcolor=black@0.7` +
                   `:alpha='min(1\\,t/0.5)'`;
  const warmGlow = `drawbox=x=180:y=740:w=720:h=500:color=0xC8902A@0.07:t=fill`;
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
  console.log(`\n  xfade: ${segs.length} segs, total=${totalDur}s`);

  let fc = '';
  let prev = '[0:v]';
  for (let i = 1; i < segs.length; i++) {
    const out = i < segs.length - 1 ? `[v${i}]` : '[vf]';
    fc += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offsets[i-1]}${out};`;
    prev = i < segs.length - 1 ? `[v${i}]` : '[vf]';
  }
  fc = fc.slice(0, -1);

  const tmp = path.join(TMP, `vonly_${Date.now()}.mp4`);
  ff([
    '-y', ...segs.flatMap(s => ['-i', s]),
    '-filter_complex', fc,
    '-map', '[vf]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-an', tmp,
  ], `xfade → ${totalDur}s`);

  ff([
    '-y', '-i', tmp,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-t', String(totalDur), '-map', '0:v', '-map', '1:a',
    finalOut,
  ], path.basename(finalOut));
  return totalDur;
}

// ── Beat timings ──────────────────────────────────────────────────────────────
// Raw: 2.0+3.5+2.5+3.0+3.5+2.2 = 16.7s → 5×0.3 xfades = 15.2s
const DURS = [2.0, 3.5, 2.5, 3.0, 3.5, 2.2];

;(async () => {
  console.log('\n✨ Forged — Reel C assembly (real device footage)\n');
  console.log(`  Source: ${SR}`);
  console.log(`  Size:   ${(fs.statSync(SR).size/1024/1024).toFixed(1)} MB`);
  console.log(`  Fonts:  ${SERIF.split('/').pop()}, ${SANS_BD.split('/').pop()}\n`);

  // ── CAPTIONED REEL ──────────────────────────────────────────────────────────
  console.log('[ Reel C — captioned ]');
  const C = [1,2,3,4,5,6].map(n => path.join(TMP, `C_s${n}.mp4`));

  iSeg('C·s1 hook (0/5)',        0.0, 2.0, ["I nearly skipped today.",     { color: WHITE,    size: 56 }], C[0]);
  iSeg('C·s2 proof taps (→2/5)', 2.5, 3.5, ["So I logged proof instead.", { color: GOLD_HEX, size: 52 }], C[1]);
  iSeg('C·s3 complete (5/5)',    11.0, 2.5, ["Not perfect. Recorded.",      { color: WHITE,    size: 58 }], C[2]);
  iSeg('C·s4 arc evidence W2',  27.0, 3.0, ["22 days. All on record.",     { color: GOLD_HEX, size: 52 }], C[3]);
  iSeg('C·s5 receipt W3',       56.0, 3.5, ["The day didn't disappear.",   { color: WHITE,    size: 52 }], C[4]);
  endCard(null, C[5]);

  const captionedOut = path.join(OUT, 'forged_reel_C_captioned.mp4');
  const dur = xfadeConcat(C, DURS, captionedOut);

  // ── NO-CAPTION TEMPLATE ─────────────────────────────────────────────────────
  console.log('\n[ Reel C — no-caption template ]');
  const N = [1,2,3,4,5,6].map(n => path.join(TMP, `N_s${n}.mp4`));

  iSeg('N·s1 hook',        0.0,  2.0, null, N[0]);
  iSeg('N·s2 proof taps',  2.5,  3.5, null, N[1]);
  iSeg('N·s3 complete',   11.0,  2.5, null, N[2]);
  iSeg('N·s4 arc W2',     27.0,  3.0, null, N[3]);
  iSeg('N·s5 receipt W3', 56.0,  3.5, null, N[4]);
  endCard(null, N[5]);   // end card always keeps wordmark

  const nocapOut = path.join(OUT, 'forged_reel_C_nocaption.mp4');
  xfadeConcat(N, DURS, nocapOut);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  for (const [label, file] of [
    ['Captioned', captionedOut],
    ['No-caption', nocapOut],
  ]) {
    if (fs.existsSync(file)) {
      const sz = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
      console.log(`✅ ${label}: ${path.relative(process.cwd(), file)} (${sz} MB, ~${dur}s)`);
    } else {
      console.log(`❌ ${label}: not created`);
    }
  }
  console.log('─'.repeat(60) + '\n');
})();
