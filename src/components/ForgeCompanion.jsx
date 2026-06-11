// ─── FORGE COMPANION ─────────────────────────────────────────────────────────────
// Preview-only experimental layer. Additive visual reward system sitting on top of
// the existing Arc — does NOT replace or modify Arc week rail / day spine / timeline.
// Derives all data at render time from existing arc_daily_scores rows. No migrations.

import { useState, useEffect, useMemo } from "react";
import { T } from "../theme.js";
import { supabase, rowToForgeBlock } from "../supabase.js";
import { getForgeItem, getForgeProgress, FORGE_STAGES } from "../lib/forgeItemLogic.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";

// ─── CSS ANIMATIONS ──────────────────────────────────────────────────────────────
// Injected once at mount. Prefixed fg- to avoid collisions with app styles.
const FORGE_CSS = `
  .fg-fire-1 { animation: fg-fire1 1.4s ease-in-out infinite; transform-origin: 46px 168px; }
  .fg-fire-2 { animation: fg-fire2 1.9s ease-in-out infinite 0.35s; transform-origin: 46px 168px; }
  .fg-fire-3 { animation: fg-fire3 2.2s ease-in-out infinite 0.75s; transform-origin: 46px 168px; }
  @keyframes fg-fire1 {
    0%,100% { opacity: 0.88; transform: scaleY(1) scaleX(1); }
    50%      { opacity: 0.52; transform: scaleY(0.9) scaleX(1.06); }
  }
  @keyframes fg-fire2 {
    0%,100% { opacity: 0.62; transform: scaleY(1.04); }
    33%     { opacity: 0.88; transform: scaleY(0.93) scaleX(0.97); }
    66%     { opacity: 0.38; transform: scaleY(1.02) scaleX(1.04); }
  }
  @keyframes fg-fire3 {
    0%,100% { opacity: 0.32; transform: scaleY(0.94); }
    50%     { opacity: 0.58; transform: scaleY(1.12) scaleX(0.93); }
  }
  .fg-ember { animation: fg-ember var(--dur,2.2s) ease-out infinite var(--del,0s); }
  @keyframes fg-ember {
    0%   { opacity: 0.9; transform: translate(0,0) scale(1); }
    60%  { opacity: 0.6; }
    100% { opacity: 0; transform: translate(var(--dx,-10px),-58px) scale(0.25); }
  }
  .fg-glow-pulse { animation: fg-glow-p 2.8s ease-in-out infinite; }
  @keyframes fg-glow-p { 0%,100% { opacity: 0.32; } 50% { opacity: 0.62; } }
  .fg-item-hot { animation: fg-hot 2s ease-in-out infinite; }
  @keyframes fg-hot {
    0%,100% { opacity: 0.55; transform: scale(1); }
    50%     { opacity: 0.9;  transform: scale(1.12); }
  }
  .fg-item-gold { animation: fg-gold 3.6s ease-in-out infinite; }
  @keyframes fg-gold { 0%,100% { opacity: 0.38; } 50% { opacity: 0.72; } }
  .fg-hammer { animation: fg-hamr 2.5s ease-in-out infinite; transform-origin: 234px 108px; }
  @keyframes fg-hamr {
    0%,100% { transform: rotate(0deg); }
    28%     { transform: rotate(-14deg); }
    58%     { transform: rotate(5deg); }
  }
  .fg-card-ember { animation: fg-card-e 3.2s ease-in-out infinite; }
  @keyframes fg-card-e { 0%,100% { opacity: 0.45; } 50% { opacity: 0.82; } }
  .fg-stage-shine { animation: fg-shine 4s ease-in-out infinite; }
  @keyframes fg-shine { 0%,100% { opacity: 0; } 45%,55% { opacity: 0.18; } }
`;

// ─── STAGE VISUAL CONFIG ─────────────────────────────────────────────────────────
const SC = [
  { fill: "#9B4A14", glow: "#E67E22", accent: "#E67E22", hot: true  }, // 0 raw ore
  { fill: "#B03018", glow: "#E74C3C", accent: "#E74C3C", hot: true  }, // 1 rough
  { fill: "#606870", glow: "#7A8890", accent: "#7A8890", hot: false }, // 2 hammered
  { fill: "#94A8B4", glow: "#BDD0DC", accent: "#BDD0DC", hot: false }, // 3 tempered
  { fill: "#C8902A", glow: "#F5C842", accent: "#F5C842", hot: false }, // 4 forged
];

// ─── ITEM SVGs (compact, for card + forge wall) ──────────────────────────────────

function SwordSVG({ s, stage, h }) {
  return (
    <svg viewBox="-14 -32 28 68" width={h * 0.5} height={h} style={{ overflow: "visible" }}
      filter={s.hot ? `drop-shadow(0 0 5px ${s.glow})` : stage === 4 ? `drop-shadow(0 0 4px ${s.glow}70)` : "none"}>
      {stage === 0 && <ellipse cx="0" cy="4" rx="9" ry="14" fill={s.fill} opacity="0.8" style={{ filter: "blur(3px)" }}/>}
      {stage === 0 && <ellipse cx="0" cy="4" rx="6" ry="9"  fill={s.glow} opacity="0.35" style={{ filter: "blur(2px)" }}/>}
      {stage >= 1 && (
        <>
          {stage <= 1 && <ellipse cx="0" cy="-22" rx="5" ry="7" fill={s.glow} opacity="0.4" style={{ filter: "blur(2px)" }}/>}
          <path
            d={stage === 1 ? "M-3.5 -28 L3.5 -28 L4.5 8 L0 14 L-4.5 8 Z" : "M-2.5 -28 L2.5 -28 L3 6 L0 12 L-3 6 Z"}
            fill={s.fill} opacity={stage <= 1 ? 0.88 : 1}
            style={stage === 1 ? { filter: "blur(0.8px)" } : {}}
          />
          {stage >= 3 && <line x1="0" y1="-24" x2="0" y2="4" stroke={s.glow} strokeWidth="0.5" opacity="0.55"/>}
          {stage >= 2 && <rect x="-10" y="12" width="20" height="3.5" rx="1.75" fill={s.fill}/>}
          {stage >= 2 && <rect x="-3.5" y="15.5" width="7" height="16" rx="3" fill={stage >= 3 ? "#8B6914" : "#4A3A10"}/>}
          {stage >= 3 && <circle cx="0" cy="33" r="4.5" fill={s.fill}/>}
          {stage >= 4 && <text x="0" y="-10" textAnchor="middle" fontSize="5" fill={s.glow} opacity="0.75" style={{ fontFamily: "serif" }}>⟡</text>}
          {stage >= 4 && <ellipse cx="0" cy="33" rx="6" ry="6" fill={s.glow} opacity="0.22" style={{ filter: "blur(1px)" }}/>}
        </>
      )}
    </svg>
  );
}

function ShieldSVG({ s, stage, h }) {
  return (
    <svg viewBox="-22 -30 44 60" width={h * 0.72} height={h} style={{ overflow: "visible" }}
      filter={s.hot ? `drop-shadow(0 0 5px ${s.glow})` : stage === 4 ? `drop-shadow(0 0 4px ${s.glow}70)` : "none"}>
      {stage === 0 && <ellipse cx="0" cy="0" rx="16" ry="22" fill={s.fill} opacity="0.75" style={{ filter: "blur(3px)" }}/>}
      {stage >= 1 && (
        <>
          <path d="M0 -28 L20 -15 L20 5 Q20 26 0 28 Q-20 26 -20 5 L-20 -15 Z"
            fill={s.fill} opacity={stage <= 1 ? 0.82 : 0.96}
            style={stage === 1 ? { filter: "blur(1px)" } : {}}/>
          {stage >= 3 && <path d="M0 -20 L12 -11 L12 3 Q12 16 0 18 Q-12 16 -12 3 L-12 -11 Z" fill={s.glow} opacity="0.14"/>}
          {stage >= 3 && <line x1="0" y1="-22" x2="0" y2="18" stroke={s.glow} strokeWidth="0.6" opacity="0.45"/>}
          {stage >= 4 && <text x="0" y="3" textAnchor="middle" fontSize="9" fill={s.glow} opacity="0.62" style={{ fontFamily: "serif" }}>⟡</text>}
        </>
      )}
    </svg>
  );
}

function HelmetSVG({ s, stage, h }) {
  return (
    <svg viewBox="-22 -30 44 58" width={h * 0.76} height={h} style={{ overflow: "visible" }}
      filter={s.hot ? `drop-shadow(0 0 5px ${s.glow})` : stage === 4 ? `drop-shadow(0 0 4px ${s.glow}70)` : "none"}>
      {stage === 0 && <ellipse cx="0" cy="-6" rx="14" ry="20" fill={s.fill} opacity="0.8" style={{ filter: "blur(3px)" }}/>}
      {stage >= 1 && (
        <>
          <path d="M-17 8 Q-17 -28 0 -28 Q17 -28 17 8 Z"
            fill={s.fill} opacity={stage <= 1 ? 0.82 : 0.96}
            style={stage === 1 ? { filter: "blur(1px)" } : {}}/>
          <rect x="-19" y="6" width="38" height="5" rx="2.5" fill={s.fill} opacity={stage <= 1 ? 0.82 : 0.96}/>
          {stage >= 3 && <rect x="-1.5" y="-8" width="3" height="17" rx="1.5" fill={s.glow} opacity="0.7"/>}
          {stage >= 3 && <>
            <path d="M-17 8 L-17 22 Q-17 26 -10 26 L-10 8 Z" fill={s.fill} opacity="0.88"/>
            <path d="M17 8 L17 22 Q17 26 10 26 L10 8 Z" fill={s.fill} opacity="0.88"/>
          </>}
          {stage >= 4 && <path d="M0 -28 Q4 -40 0 -37 Q-4 -40 0 -28" fill={s.glow} opacity="0.8"/>}
        </>
      )}
    </svg>
  );
}

function DaggerSVG({ s, stage, h }) {
  return (
    <svg viewBox="-10 -30 20 60" width={h * 0.42} height={h} style={{ overflow: "visible" }}
      filter={s.hot ? `drop-shadow(0 0 5px ${s.glow})` : stage === 4 ? `drop-shadow(0 0 4px ${s.glow}70)` : "none"}>
      {stage === 0 && <ellipse cx="0" cy="2" rx="6" ry="14" fill={s.fill} opacity="0.8" style={{ filter: "blur(2.5px)" }}/>}
      {stage >= 1 && (
        <>
          <path d={stage === 1 ? "M-3 -28 L3 -28 L3.5 6 L0 10 L-3.5 6 Z" : "M-2 -28 L2 -28 L2.5 4 L0 8 L-2.5 4 Z"}
            fill={s.fill} opacity={stage <= 1 ? 0.85 : 1}
            style={stage === 1 ? { filter: "blur(0.6px)" } : {}}/>
          {stage >= 2 && <rect x="-7" y="8" width="14" height="2.5" rx="1.25" fill={s.fill}/>}
          {stage >= 2 && <rect x="-2.5" y="10.5" width="5" height="12" rx="2.5" fill={stage >= 3 ? "#8B6914" : "#4A3A10"}/>}
          {stage >= 3 && <circle cx="0" cy="24" r="3" fill={s.fill}/>}
          {stage >= 4 && <line x1="0" y1="-24" x2="0" y2="2" stroke={s.glow} strokeWidth="0.4" opacity="0.55"/>}
        </>
      )}
    </svg>
  );
}

function AxeSVG({ s, stage, h }) {
  return (
    <svg viewBox="-20 -30 40 60" width={h * 0.68} height={h} style={{ overflow: "visible" }}
      filter={s.hot ? `drop-shadow(0 0 5px ${s.glow})` : stage === 4 ? `drop-shadow(0 0 4px ${s.glow}70)` : "none"}>
      {stage === 0 && <ellipse cx="-2" cy="-4" rx="14" ry="20" fill={s.fill} opacity="0.78" style={{ filter: "blur(3px)" }}/>}
      {stage >= 1 && (
        <>
          <rect x="-2.5" y="-4" width="5" height="34" rx="2.5" fill={stage >= 2 ? "#8B6914" : "#5A4010"} opacity="0.9"/>
          <path d={stage === 1
            ? "M-2.5 -4 L-16 -22 Q-20 -28 -10 -28 L14 -10 Q20 -4 13 2 L-2.5 -4 Z"
            : "M-2.5 -4 L-16 -22 Q-20 -28 -10 -28 L13 -8 Q19 -3 13 3 L-2.5 -4 Z"}
            fill={s.fill} opacity={stage <= 1 ? 0.85 : 0.96}
            style={stage === 1 ? { filter: "blur(0.8px)" } : {}}/>
          {stage >= 3 && <line x1="-17" y1="-20" x2="11" y2="2" stroke={s.glow} strokeWidth="0.5" opacity="0.5"/>}
          {stage >= 4 && <text x="-5" y="-11" textAnchor="middle" fontSize="5" fill={s.glow} opacity="0.7" style={{ fontFamily: "serif" }}>⟡</text>}
        </>
      )}
    </svg>
  );
}

function BannerSVG({ s, stage, h }) {
  return (
    <svg viewBox="-14 -30 28 60" width={h * 0.55} height={h} style={{ overflow: "visible" }}
      filter={s.hot ? `drop-shadow(0 0 5px ${s.glow})` : stage === 4 ? `drop-shadow(0 0 4px ${s.glow}70)` : "none"}>
      {stage === 0 && <rect x="-9" y="-18" width="18" height="36" rx="3" fill={s.fill} opacity="0.78" style={{ filter: "blur(2.5px)" }}/>}
      {stage >= 1 && (
        <>
          <rect x="-2" y="-30" width="4" height="60" rx="2" fill={stage >= 2 ? "#8B6914" : "#5A4010"} opacity="0.9"/>
          <path d={stage >= 2 ? "M2 -26 L15 -19 L15 5 L2 8 Z" : "M2 -24 L13 -17 L13 3 L2 6 Z"}
            fill={s.fill} opacity={stage <= 1 ? 0.85 : 0.92}
            style={stage === 1 ? { filter: "blur(0.8px)" } : {}}/>
          {stage >= 3 && <polygon points="0,-30 -3,-23 3,-23" fill={s.fill} opacity="0.9"/>}
          {stage >= 4 && <text x="9" y="-4" textAnchor="middle" fontSize="5" fill={s.glow} opacity="0.7" style={{ fontFamily: "serif" }}>⟡</text>}
        </>
      )}
    </svg>
  );
}

function ItemPreviewSVG({ type, stage, size = 52 }) {
  const s = SC[stage] || SC[0];
  const props = { s, stage, h: size };
  if (stage === 0) return <DaggerSVG {...props}/>; // blob stage uses dagger slot but shows raw form
  switch (type) {
    case "sword": case "aegis": return <SwordSVG  {...props}/>;
    case "shield":              return <ShieldSVG {...props}/>;
    case "helmet": case "armour": return <HelmetSVG {...props}/>;
    case "dagger": case "charm": case "ring": return <DaggerSVG {...props}/>;
    case "axe": case "warhammer":  return <AxeSVG   {...props}/>;
    case "banner":              return <BannerSVG {...props}/>;
    default:                    return <SwordSVG  {...props}/>;
  }
}

// ─── ANVIL ITEM (larger, for workshop scene) ──────────────────────────────────────

function AnvilItemSVG({ type, stage }) {
  const s = SC[stage] || SC[0];

  if (stage === 0) {
    return (
      <g>
        <ellipse cx="0" cy="8" rx="13" ry="17" fill={s.fill} opacity="0.72" style={{ filter: "blur(3.5px)" }}/>
        <ellipse cx="0" cy="8" rx="8" ry="11" fill={s.glow} opacity="0.28" style={{ filter: "blur(2px)" }}/>
      </g>
    );
  }

  switch (type) {
    case "shield": return (
      <g>
        <path d="M0 -36 L26 -19 L26 7 Q26 34 0 38 Q-26 34 -26 7 L-26 -19 Z"
          fill={s.fill} opacity={stage <= 1 ? 0.8 : 0.95}
          style={stage === 1 ? { filter: "blur(1px)" } : {}}/>
        {stage >= 3 && <path d="M0 -24 L15 -13 L15 4 Q15 18 0 22 Q-15 18 -15 4 L-15 -13 Z" fill={s.glow} opacity="0.14"/>}
        {stage >= 3 && <line x1="0" y1="-26" x2="0" y2="22" stroke={s.glow} strokeWidth="0.7" opacity="0.4"/>}
        {stage >= 4 && <text x="0" y="4" textAnchor="middle" fontSize="13" fill={s.glow} opacity="0.6" style={{ fontFamily: "serif" }}>⟡</text>}
      </g>
    );
    case "helmet": case "armour": return (
      <g>
        {stage <= 1
          ? <ellipse cx="0" cy="-8" rx="16" ry="22" fill={s.fill} opacity="0.8" style={{ filter: "blur(1.5px)" }}/>
          : <>
            <path d="M-19 9 Q-19 -30 0 -30 Q19 -30 19 9 Z" fill={s.fill} opacity="0.95"/>
            <rect x="-21" y="7" width="42" height="6" rx="3" fill={s.fill} opacity="0.95"/>
            {stage >= 3 && <rect x="-1.8" y="-12" width="3.6" height="20" rx="1.8" fill={s.glow} opacity="0.7"/>}
            {stage >= 3 && <>
              <path d="M-19 9 L-19 24 Q-19 29 -12 29 L-12 9 Z" fill={s.fill} opacity="0.88"/>
              <path d="M19 9 L19 24 Q19 29 12 29 L12 9 Z" fill={s.fill} opacity="0.88"/>
            </>}
            {stage >= 4 && <path d="M0 -30 Q5 -44 0 -41 Q-5 -44 0 -30" fill={s.glow} opacity="0.8"/>}
          </>
        }
      </g>
    );
    case "axe": case "warhammer": return (
      <g>
        <rect x="-3" y="-5" width="6" height="42" rx="3" fill={stage >= 2 ? "#8B6914" : "#5A4010"} opacity="0.9"/>
        <path d={stage === 1
          ? "M-3 -5 L-20 -26 Q-26 -34 -13 -34 L18 -12 Q25 -5 17 3 L-3 -5 Z"
          : "M-3 -5 L-20 -26 Q-26 -34 -12 -34 L17 -11 Q24 -4 16 3 L-3 -5 Z"}
          fill={s.fill} opacity={stage <= 1 ? 0.85 : 0.95}
          style={stage === 1 ? { filter: "blur(1px)" } : {}}/>
        {stage >= 3 && <line x1="-21" y1="-24" x2="14" y2="2" stroke={s.glow} strokeWidth="0.6" opacity="0.5"/>}
        {stage >= 4 && <text x="-7" y="-14" textAnchor="middle" fontSize="7" fill={s.glow} opacity="0.7" style={{ fontFamily: "serif" }}>⟡</text>}
      </g>
    );
    case "banner": return (
      <g>
        <rect x="-2.5" y="-40" width="5" height="70" rx="2.5" fill={stage >= 2 ? "#8B6914" : "#5A4010"} opacity="0.9"/>
        <path d={stage >= 2 ? "M2.5 -36 L20 -27 L20 6 L2.5 10 Z" : "M2.5 -32 L17 -23 L17 4 L2.5 7 Z"}
          fill={s.fill} opacity={stage <= 1 ? 0.85 : 0.92}/>
        {stage >= 3 && <polygon points="0,-40 -4,-30 4,-30" fill={s.fill} opacity="0.9"/>}
        {stage >= 4 && <text x="12" y="-6" textAnchor="middle" fontSize="7" fill={s.glow} opacity="0.7" style={{ fontFamily: "serif" }}>⟡</text>}
      </g>
    );
    default: { // sword / dagger / charm / ring / aegis
      const isTiny = (type === "dagger" || type === "charm" || type === "ring");
      const xScale = isTiny ? 0.7 : 1;
      return (
        <g transform={`scale(${xScale},1)`}>
          {stage === 1 && <ellipse cx="0" cy="-26" rx="7" ry="9" fill={s.glow} opacity="0.4" style={{ filter: "blur(3px)" }}/>}
          <path
            d={stage === 1 ? "M-4.5 -42 L4.5 -42 L5.5 10 L0 18 L-5.5 10 Z" : "M-3.5 -42 L3.5 -42 L4 8 L0 16 L-4 8 Z"}
            fill={s.fill} opacity={stage <= 1 ? 0.86 : 1}
            style={stage === 1 ? { filter: "blur(1px)" } : {}}
          />
          {stage >= 3 && <line x1="0" y1="-36" x2="0" y2="6" stroke={s.glow} strokeWidth="0.7" opacity="0.5"/>}
          {stage >= 2 && <rect x="-15" y="16" width="30" height="5.5" rx="2.75" fill={s.fill} opacity="0.9"/>}
          {stage >= 2 && <rect x="-5" y="21.5" width="10" height="22" rx="4" fill={stage >= 3 ? "#8B6914" : "#4A3A10"} opacity="0.9"/>}
          {stage >= 3 && <circle cx="0" cy="46" r="7" fill={s.fill} opacity="0.9"/>}
          {stage >= 4 && <>
            <text x="0" y="-14" textAnchor="middle" fontSize="8" fill={s.glow} opacity="0.78" style={{ fontFamily: "serif" }}>⟡</text>
            <ellipse cx="0" cy="46" rx="10" ry="10" fill={s.glow} opacity="0.2" style={{ filter: "blur(1px)" }}/>
          </>}
        </g>
      );
    }
  }
}

// ─── WORKSHOP SCENE ─────────────────────────────────────────────────────────────────

function WorkshopScene({ item, progress, reducedMotion }) {
  const { stage } = progress;
  const s = SC[stage] || SC[0];

  const EMBERS = [
    { cx: 39, delay: "0s",   dur: "2.3s", dx: "-14px", r: 1.6 },
    { cx: 53, delay: "0.7s", dur: "1.9s", dx: "-6px",  r: 1.0 },
    { cx: 35, delay: "1.2s", dur: "2.7s", dx: "-18px", r: 1.3 },
    { cx: 57, delay: "0.25s",dur: "2.1s", dx: "7px",   r: 0.9 },
    { cx: 46, delay: "1.6s", dur: "1.7s", dx: "-10px", r: 1.9 },
    { cx: 42, delay: "0.9s", dur: "2.5s", dx: "10px",  r: 1.1 },
    { cx: 50, delay: "1.9s", dur: "2.0s", dx: "-4px",  r: 0.8 },
  ];

  return (
    <svg viewBox="0 0 320 200" style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <radialGradient id="fg-forge-amb" cx="22%" cy="78%" r="48%">
          <stop offset="0%"   stopColor="#E67E22" stopOpacity="0.38"/>
          <stop offset="52%"  stopColor="#C0392B" stopOpacity="0.1"/>
          <stop offset="100%" stopColor="#0D0D0B" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="fg-hot-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#E67E22" stopOpacity="0.85"/>
          <stop offset="100%" stopColor="#E67E22" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="fg-gold-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#F5C842" stopOpacity="0.75"/>
          <stop offset="100%" stopColor="#F5C842" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="fg-cool-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={s.glow}  stopOpacity="0.5"/>
          <stop offset="100%" stopColor={s.glow}  stopOpacity="0"/>
        </radialGradient>
        <filter id="fg-blur3"><feGaussianBlur stdDeviation="3"/></filter>
        <filter id="fg-blur6"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>

      {/* Background */}
      <rect width="320" height="200" fill="#0D0D0B"/>
      <rect width="320" height="200" fill="url(#fg-forge-amb)"/>

      {/* Wall back line */}
      <line x1="0" y1="170" x2="320" y2="170" stroke="#1E1C16" strokeWidth="1.5"/>

      {/* ── FORGE FURNACE ── */}
      {/* Chimney */}
      <rect x="23" y="6" width="36" height="30" rx="2" fill="#1C1A14"/>
      <rect x="26" y="6" width="30" height="3" rx="1" fill="#242218"/>
      {/* Furnace body */}
      <rect x="10" y="32" width="74" height="138" rx="5" fill="#1E1C16"/>
      {/* Stone seams */}
      {[68, 100, 130].map(y => (
        <line key={y} x1="10" y1={y} x2="84" y2={y} stroke="#141210" strokeWidth="1"/>
      ))}
      <line x1="47" y1="32" x2="47" y2="170" stroke="#141210" strokeWidth="0.5" opacity="0.5"/>
      {/* Arch outline */}
      <path d="M18 102 Q47 62 76 102" fill="none" stroke="#2A2820" strokeWidth="5"/>
      <path d="M18 102 Q47 64 76 102" fill="none" stroke="#161410" strokeWidth="2.5"/>
      {/* Opening interior */}
      <path d="M20 170 L20 102 Q47 66 74 102 L74 170 Z" fill="#090806"/>
      {/* Ash bed */}
      <ellipse cx="47" cy="166" rx="24" ry="4" fill="#201C10" opacity="0.95"/>

      {/* Fire (animated layers) */}
      <g>
        <path className={reducedMotion ? "" : "fg-fire-1"}
          d="M26 170 L34 138 L41 154 L47 130 L53 147 L60 133 L67 170 Z"
          fill="#B03018" opacity="0.88"/>
        <path className={reducedMotion ? "" : "fg-fire-2"}
          d="M30 170 L38 122 L47 142 L55 116 L63 137 L69 170 Z"
          fill="#E67E22" opacity="0.65"/>
        <path className={reducedMotion ? "" : "fg-fire-3"}
          d="M34 170 L42 132 L47 112 L52 128 L59 120 L65 170 Z"
          fill="#F5C842" opacity="0.34"/>
      </g>

      {/* Floor glow from forge */}
      <ellipse cx="47" cy="170" rx="40" ry="8" fill="#E67E22"
        opacity={reducedMotion ? 0.14 : 0.18}
        className={reducedMotion ? "" : "fg-glow-pulse"}
        style={{ filter: "blur(5px)" }}/>
      {/* Arch glow */}
      <path d="M10 102 Q10 48 22 30 Q34 12 47 8 Q60 12 72 30 Q84 48 84 102 L74 102 Q74 54 47 38 Q20 54 20 102 Z"
        fill="#E67E22" opacity="0.055"/>

      {/* Embers */}
      {!reducedMotion && EMBERS.map((e, i) => (
        <circle key={i} cx={e.cx} cy="105" r={e.r} fill={i % 3 === 0 ? "#F5C842" : "#E67E22"}
          className="fg-ember"
          style={{ "--dur": e.dur, "--del": e.delay, "--dx": e.dx }}/>
      ))}

      {/* ── ANVIL ── */}
      {/* Shadow */}
      <ellipse cx="178" cy="174" rx="52" ry="7" fill="#000" opacity="0.45" style={{ filter: "blur(2px)" }}/>
      {/* Horn */}
      <path d="M127 128 Q110 131 114 136 L127 136 Z" fill="#242220"/>
      {/* Top plate */}
      <rect x="125" y="121" width="106" height="17" rx="3" fill="#302E26"/>
      <rect x="125" y="121" width="106" height="3"  rx="1.5" fill="#3A3830" opacity="0.65"/>
      {/* Body */}
      <rect x="140" y="138" width="76" height="20" rx="2" fill="#242220"/>
      {/* Base */}
      <rect x="130" y="158" width="98" height="16" rx="3" fill="#302E26"/>
      <rect x="130" y="158" width="98" height="3"  rx="1.5" fill="#3A3830" opacity="0.55"/>

      {/* Item glow halo on anvil */}
      {s.hot && (
        <ellipse cx="190" cy="121" rx="30" ry="12"
          fill="url(#fg-hot-halo)"
          className={reducedMotion ? "" : "fg-item-hot"}
          style={{ filter: "blur(4px)" }}/>
      )}
      {stage === 4 && (
        <ellipse cx="190" cy="121" rx="26" ry="10"
          fill="url(#fg-gold-halo)"
          className={reducedMotion ? "" : "fg-item-gold"}
          style={{ filter: "blur(3px)" }}/>
      )}
      {stage >= 2 && stage <= 3 && (
        <ellipse cx="190" cy="121" rx="22" ry="9"
          fill="url(#fg-cool-halo)"
          opacity="0.5"
          style={{ filter: "blur(3px)" }}/>
      )}

      {/* Current item on anvil */}
      <g transform="translate(190,80)">
        <AnvilItemSVG type={item.type} stage={stage}/>
      </g>

      {/* ── BLACKSMITH SILHOUETTE ── */}
      <g opacity="0.62">
        <ellipse cx="248" cy="88"  rx="13" ry="14"  fill="#1A1814"/> {/* head */}
        <rect    x="236" y="100"  width="24" height="48" rx="9"  fill="#1A1814"/> {/* torso */}
        {/* Raised arm + hammer */}
        <g className={!reducedMotion && (stage === 1 || stage === 2) ? "fg-hammer" : ""}>
          <path d="M236 110 L217 84 L222 79 L240 108" fill="#1A1814"/>
          <rect x="208" y="72" width="17" height="9" rx="2.5" fill="#36342C"/>
          <line x1="221" y1="77" x2="236" y2="94" stroke="#36342C" strokeWidth="3.5" strokeLinecap="round"/>
        </g>
        {/* Down arm */}
        <path d="M260 113 L274 130 L269 134 L256 118" fill="#1A1814"/>
        {/* Legs */}
        <rect x="238" y="146" width="10" height="24" rx="4" fill="#1A1814"/>
        <rect x="250" y="148" width="10" height="22" rx="4" fill="#1A1814"/>
        {/* Leather apron */}
        <path d="M238 122 L260 122 L257 146 L240 146 Z" fill="#121008" opacity="0.7"/>
      </g>

      {/* ── TOOL RACK (right) ── */}
      <rect x="295" y="14"  width="4" height="156" rx="2" fill="#1C1A14"/>
      <rect x="292" y="14"  width="10" height="3" rx="1.5" fill="#242220"/>
      <rect x="292" y="167" width="10" height="3" rx="1.5" fill="#242220"/>
      {[30, 57, 84, 111, 138].map((y, i) => (
        <g key={i}>
          <rect x="292" y={y} width="10" height="3" rx="1" fill="#2A2820"/>
          <line x1="297" y1={y + 3} x2="304" y2={y + 20} stroke="#3A3830" strokeWidth="1.5"/>
          {i % 2 === 0
            ? <rect x="301" y={y + 18} width="7" height="13" rx="2" fill="#3A3830" opacity="0.8"/>
            : <path d={`M299 ${y+18} L307 ${y+18} L303 ${y+30} Z`} fill="#3A3830" opacity="0.72"/>
          }
        </g>
      ))}

      {/* ── FLOOR ── */}
      <rect x="0" y="170" width="320" height="30" fill="#141210"/>
      {[80, 160, 240].map(x => (
        <line key={x} x1={x} y1="170" x2={x} y2="200" stroke="#1C1A16" strokeWidth="1"/>
      ))}
      <line x1="0" y1="185" x2="320" y2="185" stroke="#1C1A16" strokeWidth="0.5"/>

      {/* Stage label watermark */}
      <text x="312" y="17" textAnchor="end" fontSize="8" fill={s.accent} opacity="0.55"
        fontFamily="DM Sans,system-ui,sans-serif" fontWeight="700" letterSpacing="0.1em">
        {(FORGE_STAGES[stage]?.label ?? "").toUpperCase()}
      </text>
    </svg>
  );
}

// ─── STAGE TRACKER ─────────────────────────────────────────────────────────────────

function StageTracker({ currentStage }) {
  return (
    <div style={{ padding: "18px 0 6px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", padding: "0 2px" }}>
        {FORGE_STAGES.map((stage, i) => {
          const done   = i < currentStage;
          const active = i === currentStage;
          const s = SC[i];
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, position: "relative" }}>
              {i < FORGE_STAGES.length - 1 && (
                <div style={{
                  position: "absolute", top: 11, left: "50%", right: 0, height: 2,
                  background: done ? `linear-gradient(90deg,${T.gold}80,${T.gold}40)` : T.hint + "30",
                  zIndex: 0,
                }}/>
              )}
              <div style={{
                width: 22, height: 22, borderRadius: "50%", zIndex: 1, position: "relative",
                border: `2px solid ${active ? s.accent : done ? s.accent + "60" : T.hint + "30"}`,
                background: active ? s.accent + "22" : done ? s.accent + "11" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, fontWeight: 700,
                color: active ? s.accent : done ? s.accent + "AA" : T.hint + "60",
                boxShadow: active ? `0 0 12px ${s.accent}50` : "none",
                transition: "box-shadow 0.5s ease",
              }}>
                {done ? "✓" : i + 1}
              </div>
              <div style={{
                fontSize: 8.5, fontWeight: active ? 700 : 500,
                color: active ? T.text : done ? T.sub : T.hint,
                textAlign: "center", lineHeight: 1.3,
                transition: "color 0.3s",
              }}>
                {stage.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FORGE WALL (past completed arc items) ─────────────────────────────────────────

function ForgeWall({ pastArcs }) {
  const items = useMemo(() => pastArcs.map(arc => ({
    arc,
    item: getForgeItem(arc),
    finalStage: Math.min(4,
      (arc.completion_score ?? 0) >= 85 ? 4 :
      (arc.completion_score ?? 0) >= 60 ? 3 :
      (arc.completion_score ?? 0) >= 35 ? 2 : 1
    ),
    score: arc.completion_score ?? 0,
  })), [pastArcs]);

  return (
    <div style={{ margin: "0 20px 20px" }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: T.hint,
        letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12,
      }}>
        Forge Wall · {items.length} completed
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {items.map((entry, i) => {
          const isComplete = entry.finalStage >= 4;
          return (
            <div key={entry.arc.id || i} style={{
              width: 72, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
              padding: "12px 6px 10px",
              background: T.surface,
              borderRadius: T.rsm,
              border: `1px solid ${isComplete ? T.gold + "30" : T.border}`,
              boxShadow: isComplete ? `0 0 16px ${T.gold}14` : "none",
            }}>
              <ItemPreviewSVG type={entry.item.type} stage={entry.finalStage} size={42}/>
              <div style={{ fontSize: 9, color: T.muted, textAlign: "center", lineHeight: 1.3, fontWeight: 600 }}>
                {entry.item.name}
              </div>
              <div style={{ fontSize: 8, color: isComplete ? T.gold : T.hint, fontWeight: 700 }}>
                {entry.score}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STAGE NARRATIVE ─────────────────────────────────────────────────────────────

function stageNarrative(stage, item) {
  return [
    `Raw materials are assembled. The forge is lit. ${item.name} exists only as potential — the first real strike hasn't landed yet.`,
    `Metal is heating. A rough shape is starting to emerge from the ore. The outline of ${item.name} is visible in the glow.`,
    `The hammer has found its rhythm. Structure is set. ${item.name} is recognisably itself now, waiting for refinement.`,
    `Heat and patience have done their work. Details are being carved in. ${item.name} is nearly complete.`,
    `The forge work is done. ${item.name} has been quenched, tempered, and polished. This is what sustained effort looks like.`,
  ][stage] ?? "";
}

// ─── WORKSHOP SHEET ─────────────────────────────────────────────────────────────────

function ForgeWorkshopSheet({ arc, item, progress, userId, onClose, reducedMotion }) {
  const [pastArcs, setPastArcs] = useState(null);
  const s = SC[progress.stage] || SC[0];

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("forge_blocks")
      .select("id, title, duration_days, arc_rank, completion_score, start_date, end_date, status")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("start_date", { ascending: false })
      .limit(12)
      .then(({ data }) => {
        if (!cancelled && data) setPastArcs(data.map(rowToForgeBlock));
      });
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(5,5,4,0.88)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.bg,
          borderRadius: "22px 22px 0 0",
          maxHeight: "95dvh",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: `max(36px, env(safe-area-inset-bottom, 0px))`,
        }}
      >
        {/* Drag handle */}
        <div style={{ padding: "12px 0 2px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: 38, height: 4, borderRadius: 2, background: T.hint + "55" }}/>
        </div>

        {/* Header */}
        <div style={{ padding: "10px 20px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, color: s.accent,
              letterSpacing: "0.17em", textTransform: "uppercase", marginBottom: 4,
            }}>
              The Forge · {arc?.title ? arc.title.slice(0, 36) + (arc.title.length > 36 ? "…" : "") : "Your Arc"}
            </div>
            <h2 style={{ fontFamily: T.serif, fontSize: 28, color: T.text, margin: 0, lineHeight: 1.1 }}>
              {item.name}
            </h2>
          </div>
          <button type="button" onClick={onClose} style={{
            background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 20, padding: "7px 16px",
            color: T.sub, fontSize: 13, fontFamily: T.font, cursor: "pointer",
            marginTop: 2, flexShrink: 0,
          }}>Done</button>
        </div>

        {/* Workshop scene */}
        <div style={{ margin: "14px 0 0", borderTop: `0.5px solid ${T.border}`, borderBottom: `0.5px solid ${T.border}` }}>
          <WorkshopScene item={item} progress={progress} reducedMotion={reducedMotion}/>
        </div>

        {/* Stage tracker */}
        <div style={{ padding: "0 20px" }}>
          <StageTracker currentStage={progress.stage}/>
        </div>

        {/* Progress block */}
        <div style={{ margin: "10px 20px", padding: "18px", background: T.surface, borderRadius: T.rsm, border: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: T.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Days at the forge</div>
              <div style={{ fontFamily: T.serif, fontSize: 30, color: T.text, lineHeight: 1 }}>
                {progress.daysForged}
                <span style={{ fontFamily: T.font, fontSize: 14, color: T.hint, marginLeft: 5 }}>/ {progress.totalDays}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: T.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Complete</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.accent, lineHeight: 1 }}>{progress.pct}%</div>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ height: 7, background: T.raised, borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${progress.pct}%`,
              background: `linear-gradient(90deg,${s.fill},${s.accent})`,
              borderRadius: 4,
              transition: reducedMotion ? "none" : "width 0.9s cubic-bezier(0.4,0,0.2,1)",
              minWidth: progress.pct > 0 ? 8 : 0,
            }}/>
          </div>
          <div style={{ marginTop: 14, fontSize: 13, color: T.sub, lineHeight: 1.65 }}>
            {stageNarrative(progress.stage, item)}
          </div>
        </div>

        {/* Item description */}
        <div style={{ margin: "2px 20px 16px", fontSize: 14, color: T.muted, lineHeight: 1.75, fontStyle: "italic" }}>
          "{item.desc}"
        </div>

        {/* Rules card */}
        <div style={{
          margin: "0 20px 20px", padding: "14px 16px",
          background: `${s.accent}09`,
          borderRadius: T.rsm,
          borderLeft: `2px solid ${s.accent}50`,
        }}>
          <div style={{ fontSize: 10, color: s.accent, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
            How the forge works
          </div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.75 }}>
            Every day you hit your proof threshold, the forge advances. Missing a day doesn't reset progress — the work you've done stays. Each completed Arc produces a finished item. Your collection grows as you grow.
          </div>
        </div>

        {/* Forge wall — past arcs */}
        {pastArcs && pastArcs.length > 0 && (
          <ForgeWall pastArcs={pastArcs}/>
        )}

        {/* Empty forge wall placeholder */}
        {(pastArcs === null || pastArcs.length === 0) && (
          <div style={{
            margin: "0 20px 20px", padding: "16px 18px",
            background: T.surface, borderRadius: T.rsm,
            border: `1px dashed ${T.hint}28`,
          }}>
            <div style={{ fontSize: 10, color: T.hint, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
              Forge Wall
            </div>
            <div style={{ fontSize: 13, color: T.hint, lineHeight: 1.65 }}>
              Finish this Arc and {item.name} joins your collection. Every completed Arc becomes a permanent artifact in your workshop.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── COMPACT CARD ─────────────────────────────────────────────────────────────────

function ForgeCard({ item, progress, onOpen, reducedMotion }) {
  const s = SC[progress.stage] || SC[0];

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        width: "100%", display: "flex", alignItems: "center",
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.r,
        padding: 0,
        cursor: "pointer",
        fontFamily: T.font,
        textAlign: "left",
        position: "relative",
        overflow: "hidden",
        minHeight: 80,
      }}
    >
      {/* Left ember accent bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, bottom: 0, width: 3,
        background: `linear-gradient(180deg,${s.accent}50,${s.accent}95,${s.accent}50)`,
        borderRadius: "16px 0 0 16px",
      }} className={!reducedMotion && s.hot ? "fg-card-ember" : ""}/>

      {/* Item icon area */}
      <div style={{
        width: 68, minWidth: 68, height: 80,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `radial-gradient(ellipse at center, ${s.accent}14 0%, transparent 68%)`,
        position: "relative",
      }}>
        {!reducedMotion && s.hot && (
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(ellipse at center, ${s.accent}1A 0%, transparent 60%)`,
          }} className="fg-glow-pulse"/>
        )}
        <ItemPreviewSVG type={item.type} stage={progress.stage} size={54}/>
      </div>

      {/* Info */}
      <div style={{ flex: 1, padding: "13px 6px 13px 2px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 4 }}>
          <span style={{ fontFamily: T.serif, fontSize: 15, color: T.text, lineHeight: 1.2 }}>
            {item.name}
          </span>
          <span style={{ fontSize: 8.5, color: T.hint, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0 }}>
            The Forge
          </span>
        </div>

        {/* Stage pill strip */}
        <div style={{ display: "flex", gap: 4, marginBottom: 6, alignItems: "center" }}>
          {FORGE_STAGES.map((_, i) => {
            const done   = i < progress.stage;
            const active = i === progress.stage;
            return (
              <div key={i} style={{
                height: 6,
                width: active ? 20 : 7,
                borderRadius: 3,
                background: active ? s.accent : done ? s.accent + "55" : T.hint + "38",
                transition: "width 0.45s ease, background 0.45s ease",
              }}/>
            );
          })}
          <span style={{ fontSize: 10, color: T.sub, marginLeft: 2 }}>
            {FORGE_STAGES[progress.stage]?.label}
          </span>
        </div>

        <div style={{ fontSize: 11, color: T.muted }}>
          {progress.daysForged} of {progress.totalDays} days forged
          <span style={{ color: T.hint }}> · </span>
          <span style={{ color: s.accent, fontWeight: 600 }}>{progress.pct}%</span>
        </div>
      </div>

      {/* Open chevron */}
      <div style={{ padding: "0 16px 0 4px", fontSize: 22, color: T.hint, lineHeight: 1, flexShrink: 0 }}>›</div>
    </button>
  );
}

// ─── ROOT EXPORT ─────────────────────────────────────────────────────────────────

export function ForgeCompanion({ arc, arcLedgerRows, userId, style }) {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();

  const item     = useMemo(() => getForgeItem(arc), [arc?.id, arc?.duration_days]);
  const progress = useMemo(() => getForgeProgress(arc, arcLedgerRows), [arc?.id, arc?.duration_days, arcLedgerRows]);

  if (!arc) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: FORGE_CSS }}/>
      <div style={style}>
        <ForgeCard
          item={item}
          progress={progress}
          onOpen={() => setExpanded(true)}
          reducedMotion={reducedMotion}
        />
      </div>
      {expanded && (
        <ForgeWorkshopSheet
          arc={arc}
          item={item}
          progress={progress}
          userId={userId}
          onClose={() => setExpanded(false)}
          reducedMotion={reducedMotion}
        />
      )}
    </>
  );
}
