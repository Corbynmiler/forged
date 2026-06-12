// ─── FORGE COMPANION ──────────────────────────────────────────────────────────────
// Preview-only experimental companion layer. Additive — does not replace or modify
// the Arc week rail, day spine, or timeline logic. No schema migrations.
// Placed between ArcJourneyHero and the week rail via ArcTimeline's forgeSlot prop.

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { T } from "../theme.js";
import { supabase, rowToForgeBlock } from "../supabase.js";
import {
  getItemPool, getDefaultForgeItem, getForgeProgress,
  getRecentForgeHistory, FORGE_STAGES, ALL_ITEMS,
} from "../lib/forgeItemLogic.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import { Canvas } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

// Preload GLB so it's warm when the sheet opens
useGLTF.preload("/forge-companion.glb");

// ─── STAGE COLOURS ────────────────────────────────────────────────────────────────
const SC = [
  { fill:"#5C3A18", edge:"#C07030", glow:"#C07030", metal:"#8A5228", hot:true  }, // raw ore  — earthy brown
  { fill:"#904020", edge:"#E86820", glow:"#E86820", metal:"#B05828", hot:true  }, // rough     — hot amber-orange
  { fill:"#606870", edge:"#7A8890", glow:"#8096A8", metal:"#606870", hot:false }, // hammered  — cool steel
  { fill:"#94A8B4", edge:"#BDD0DC", glow:"#BDD0DC", metal:"#94A8B4", hot:false }, // tempered  — bright steel
  { fill:"#C8902A", edge:"#F5C842", glow:"#F5C842", metal:"#C8902A", hot:false }, // forged    — gold
];

// ─── CSS ──────────────────────────────────────────────────────────────────────────
const CSS = `
  .fg-fire1{animation:fg-f1 1.4s ease-in-out infinite;transform-origin:46px 170px}
  .fg-fire2{animation:fg-f2 1.9s ease-in-out infinite .35s;transform-origin:46px 170px}
  .fg-fire3{animation:fg-f3 2.1s ease-in-out infinite .7s;transform-origin:46px 170px}
  @keyframes fg-f1{0%,100%{opacity:.88;transform:scaleY(1) scaleX(1)}50%{opacity:.5;transform:scaleY(.9) scaleX(1.05)}}
  @keyframes fg-f2{0%,100%{opacity:.62;transform:scaleY(1.04)}33%{opacity:.88;transform:scaleY(.94) scaleX(.97)}66%{opacity:.38;transform:scaleY(1.02) scaleX(1.04)}}
  @keyframes fg-f3{0%,100%{opacity:.3;transform:scaleY(.94)}50%{opacity:.55;transform:scaleY(1.1) scaleX(.94)}}
  .fg-ember{animation:fg-emb var(--dur,2.2s) ease-out infinite var(--del,0s)}
  @keyframes fg-emb{0%{opacity:.9;transform:translate(0,0) scale(1)}60%{opacity:.6}100%{opacity:0;transform:translate(var(--dx,-10px),-60px) scale(.2)}}
  .fg-glow1{animation:fg-gl1 2.3s ease-in-out infinite}
  .fg-glow2{animation:fg-gl2 3.7s ease-in-out infinite .9s}
  @keyframes fg-gl1{0%,100%{opacity:.2}50%{opacity:.55}}
  @keyframes fg-gl2{0%,100%{opacity:.1}50%{opacity:.32}}
  .fg-item-hot{animation:fg-ih 2s ease-in-out infinite}
  @keyframes fg-ih{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.95;transform:scale(1.12)}}
  .fg-item-gold{animation:fg-ig 3.6s ease-in-out infinite}
  @keyframes fg-ig{0%,100%{opacity:.35}50%{opacity:.72}}
  .fg-breathe{animation:fg-breathe 4.2s ease-in-out infinite}
  @keyframes fg-breathe{
    0%,100%{transform:translateY(0)}
    40%{transform:translateY(-2.5px)}
  }
  .fg-sway{animation:fg-sway 5.6s ease-in-out infinite}
  @keyframes fg-sway{
    0%,100%{transform:rotate(0deg)}
    25%{transform:rotate(-.5deg)}
    75%{transform:rotate(.4deg)}
  }
  .fg-head-tilt{animation:fg-htilt 7.3s ease-in-out infinite}
  @keyframes fg-htilt{
    0%,100%{transform:rotate(0deg)}
    18%,82%{transform:rotate(0deg)}
    35%{transform:rotate(-2deg)}
    65%{transform:rotate(1.5deg)}
  }
  .fg-strike{animation:fg-stk .9s linear 1 forwards;transform-origin:14px -62px}
  @keyframes fg-stk{
    0%  {transform:rotate(0deg);animation-timing-function:cubic-bezier(.55,0,1,1)}
    14% {transform:rotate(45deg);animation-timing-function:cubic-bezier(.5,0,.3,1)}
    17% {transform:rotate(45deg);animation-timing-function:cubic-bezier(.92,0,.95,.8)}
    40% {transform:rotate(-140deg);animation-timing-function:cubic-bezier(.1,.85,.3,1)}
    50% {transform:rotate(-140deg);animation-timing-function:cubic-bezier(.6,0,.5,1)}
    63% {transform:rotate(-115deg);animation-timing-function:cubic-bezier(.4,0,.5,1)}
    76% {transform:rotate(-128deg);animation-timing-function:cubic-bezier(.4,0,.6,1)}
    88% {transform:rotate(-20deg);animation-timing-function:cubic-bezier(.4,0,.6,1)}
    100%{transform:rotate(0deg)}
  }
  .fg-arm-idle{animation:fg-arm-auto 15s linear infinite;animation-delay:8s;transform-origin:14px -62px}
  @keyframes fg-arm-auto{
    0%,84%{transform:rotate(0deg)}
    85.5%{transform:rotate(22deg);animation-timing-function:cubic-bezier(.7,0,.3,1)}
    86.8%{transform:rotate(-50deg);animation-timing-function:cubic-bezier(.4,0,.6,1)}
    87.5%{transform:rotate(0deg)}
    88.5%{transform:rotate(20deg);animation-timing-function:cubic-bezier(.7,0,.3,1)}
    89.5%{transform:rotate(-48deg);animation-timing-function:cubic-bezier(.4,0,.6,1)}
    90%  {transform:rotate(0deg)}
    91%  {transform:rotate(45deg);animation-timing-function:cubic-bezier(.5,0,.2,.8)}
    91.4%{transform:rotate(45deg);animation-timing-function:cubic-bezier(.92,0,.95,1)}
    93.5%{transform:rotate(-140deg);animation-timing-function:cubic-bezier(.1,.85,.3,1)}
    94.3%{transform:rotate(-140deg);animation-timing-function:cubic-bezier(.5,0,.5,1)}
    95.6%{transform:rotate(-115deg);animation-timing-function:cubic-bezier(.4,0,.5,1)}
    96.8%{transform:rotate(-128deg);animation-timing-function:cubic-bezier(.4,0,.6,1)}
    98.5%{transform:rotate(-20deg);animation-timing-function:cubic-bezier(.4,0,.6,1)}
    100% {transform:rotate(0deg)}
  }
  .fg-spark{animation:fg-sp .88s linear var(--del,0s) 1 forwards;opacity:0}
  @keyframes fg-sp{
    0%  {opacity:1;transform:translate(0,0) scale(1);animation-timing-function:cubic-bezier(.2,0,.35,.65)}
    45% {opacity:.85;transform:translate(calc(var(--sx,0px)*.65),var(--sy,-36px)) scale(.6);animation-timing-function:cubic-bezier(.65,0,1,1)}
    100%{opacity:0;transform:translate(calc(var(--sx,0px)*1.15),calc(var(--sy,-36px) + 56px)) scale(.1)}
  }
  .fg-impact{animation:fg-imp .55s ease-out 1 forwards;opacity:0}
  @keyframes fg-imp{0%{opacity:.32}60%{opacity:.14}100%{opacity:0}}
  .fg-card-glow{animation:fg-cg 3s ease-in-out infinite}
  @keyframes fg-cg{0%,100%{opacity:.45}50%{opacity:.82}}
  @media (prefers-reduced-motion:reduce){
    .fg-fire1,.fg-fire2,.fg-fire3,.fg-ember,.fg-glow1,.fg-glow2,.fg-item-hot,.fg-item-gold,
    .fg-breathe,.fg-sway,.fg-head-tilt,.fg-strike,.fg-arm-idle,.fg-spark,.fg-impact,.fg-card-glow{animation:none}
  }
`;

// ─── ITEM SVGS ────────────────────────────────────────────────────────────────────
// Each returns a fragment of SVG content. Wrapped in <svg> by callers.

function SwordPaths({ stage, s }) {
  if (stage === 0) return (
    <>
      {/* elongated billet — suggests sword shape even in raw ore stage */}
      <rect x="-11" y="-26" width="22" height="44" rx="5" fill={s.metal} style={{filter:"blur(1px)"}}/>
      <rect x="-11" y="-26" width="22" height="9" rx="3" fill={s.edge} opacity=".35"/>
      <rect x="-11" y="-26" width="22" height="44" rx="5" fill="none" stroke={s.edge} strokeWidth=".8" opacity=".45"/>
    </>
  );
  if (stage === 1) return (
    <>
      {/* rough tapered blade silhouette clearly emerging */}
      <path d="M-10-38 L10-38 L8 12 L0 22 L-8 12 Z" fill={s.metal} style={{filter:"blur(.9px)"}}/>
      <path d="M-10-38 L-12-24 L-9-2 L-10 12 L0 22 L10 12 L9-2 L12-24 L10-38 Z"
        fill="none" stroke={s.edge} strokeWidth="1" opacity=".4"/>
    </>
  );
  if (stage === 2) return (
    <>
      {/* defined blade, narrow and clean */}
      <path d="M-4.5-42 L4.5-42 L5.5 12 L0 20 L-5.5 12 Z" fill={s.fill}/>
      <line x1="0" y1="-40" x2="0" y2="10" stroke={s.edge} strokeWidth=".7" opacity=".2"/>
    </>
  );
  if (stage === 3) return (
    <>
      <path d="M-4-44 L4-44 L5 12 L0 18 L-5 12 Z" fill={s.fill}/>
      <line x1="0" y1="-40" x2="0" y2="10" stroke={s.edge} strokeWidth=".7" opacity=".5"/>
      <rect x="-16" y="18" width="32" height="5.5" rx="2.75" fill={s.fill} opacity=".9"/>
      <rect x="-5" y="23.5" width="10" height="20" rx="3.5" fill="#6B4A2A"/>
      {[25.5,28,30.5,33,35.5].map(y=><line key={y} x1="-5" y1={y} x2="5" y2={y} stroke="#8B6A3A" strokeWidth="1.2" opacity=".55"/>)}
    </>
  );
  // stage 4 — complete sword
  return (
    <>
      <path d="M-3.5-44 L3.5-44 L4.5 12 L0 18 L-4.5 12 Z" fill={s.fill}/>
      <line x1="0" y1="-40" x2="0" y2="10" stroke={s.edge} strokeWidth=".7" opacity=".6"/>
      <path d="M3.5-44 L4.5 12 L3 10 L2.5-42 Z" fill={s.edge} opacity=".18"/>
      <path d="M-17.5 12 L17.5 12 L15.5 18 L-15.5 18 Z" fill={s.fill}/>
      <rect x="-5" y="18" width="10" height="24" rx="4" fill="#5C3E20"/>
      {[20,22.5,25,27.5,30,32.5].map(y=><line key={y} x1="-5" y1={y} x2="5" y2={y} stroke="#8B6A3A" strokeWidth="1.2" opacity=".6"/>)}
      <circle cx="0" cy="46" r="8" fill={s.fill}/>
      <circle cx="0" cy="46" r="5.5" fill={s.edge} opacity=".22"/>
      <text x="0" y="-16" textAnchor="middle" fontSize="7" fill={s.edge} opacity=".75" fontFamily="serif">⟡</text>
      <path d="M-1-44 L-1-28 L0-28 L0-44 Z" fill="#FFFBE0" opacity=".14"/>
    </>
  );
}

function DaggerPaths({ stage, s }) {
  if (stage === 0) return (
    <>
      <rect x="-10" y="-10" width="20" height="22" rx="4" fill={s.metal} style={{filter:"blur(.8px)"}}/>
      <rect x="-10" y="-10" width="20" height="7" rx="2" fill={s.edge} opacity=".3"/>
    </>
  );
  if (stage === 1) return (
    <>
      <path d="M-8-24 L8-24 L6 8 L0 14 L-6 8 Z" fill={s.metal} style={{filter:"blur(.8px)"}}/>
      <path d="M-8-24 L-10-12 L-8 4 L0 14 L8 4 L10-12 L8-24 Z"
        fill="none" stroke={s.edge} strokeWidth="1" opacity=".4"/>
    </>
  );
  if (stage === 2) return (
    <>
      <path d="M-5-28 L5-28 L5 8 L0 14 L-5 8 Z" fill={s.fill}/>
      <line x1="0" y1="-26" x2="0" y2="8" stroke={s.edge} strokeWidth=".7" opacity=".2"/>
    </>
  );
  if (stage === 3) return (
    <>
      <path d="M-4-30 L4-30 L4 6 L0 12 L-4 6 Z" fill={s.fill}/>
      <line x1="0" y1="-28" x2="0" y2="4" stroke={s.edge} strokeWidth=".6" opacity=".5"/>
      <rect x="-12" y="12" width="24" height="4.5" rx="2.25" fill={s.fill}/>
      <rect x="-3.5" y="16.5" width="7" height="14" rx="2.5" fill="#6B4A2A"/>
      {[18.5,21,23.5,26].map(y=><line key={y} x1="-3.5" y1={y} x2="3.5" y2={y} stroke="#8B6A3A" strokeWidth="1" opacity=".5"/>)}
    </>
  );
  // stage 4 — complete dagger with pommel
  return (
    <>
      <path d="M-3.5-32 L3.5-32 L3.5 6 L0 12 L-3.5 6 Z" fill={s.fill}/>
      <line x1="0" y1="-30" x2="0" y2="4" stroke={s.edge} strokeWidth=".6" opacity=".6"/>
      <path d="M3.5-32 L3.5 6 L2.5 4 L2-30 Z" fill={s.edge} opacity=".18"/>
      <rect x="-13" y="12" width="26" height="5" rx="2.5" fill={s.fill}/>
      <rect x="-3.5" y="17" width="7" height="15" rx="3" fill="#5C3E20"/>
      {[19,21,23,25,27].map(y=><line key={y} x1="-3.5" y1={y} x2="3.5" y2={y} stroke="#8B6A3A" strokeWidth="1" opacity=".55"/>)}
      <circle cx="0" cy="36" r="5.5" fill={s.fill}/>
      <circle cx="0" cy="36" r="3.5" fill={s.edge} opacity=".2"/>
    </>
  );
}

function ShieldPaths({ stage, s }) {
  if (stage === 0) return (
    <>
      <ellipse cx="0" cy="0" rx="16" ry="12" fill={s.metal}/>
      <ellipse cx="0" cy="0" rx="16" ry="12" fill="none" stroke={s.edge} strokeWidth=".8" opacity=".7"/>
    </>
  );
  const rough = stage <= 1;
  return (
    <>
      <path d="M0-28 L20-15 L20 6 Q20 26 0 28 Q-20 26 -20 6 L-20-15 Z"
        fill={s.fill} opacity={rough?.85:1} style={rough?{filter:"blur(1px)"}:{}}/>
      {stage>=3&&<path d="M0-20 L12-11 L12 3 Q12 17 0 19 Q-12 17 -12 3 L-12-11 Z" fill={s.edge} opacity=".13"/>}
      {stage>=3&&<line x1="0" y1="-22" x2="0" y2="18" stroke={s.edge} strokeWidth=".6" opacity=".45"/>}
      {stage>=3&&<line x1="-12" y1="-4" x2="12" y2="-4" stroke={s.edge} strokeWidth=".6" opacity=".3"/>}
      {stage>=4&&<text x="0" y="4" textAnchor="middle" fontSize="10" fill={s.edge} opacity=".6" fontFamily="serif">⟡</text>}
      {stage>=4&&<circle cx="0" cy="0" r="4" fill={s.edge} opacity=".12"/>}
    </>
  );
}

function HelmetPaths({ stage, s }) {
  if (stage === 0) return <ellipse cx="0" cy="-4" rx="14" ry="18" fill={s.metal} style={{filter:"blur(2px)"}}/>;
  const rough = stage <= 1;
  return (
    <>
      <path d="M-18 10 Q-18-30 0-30 Q18-30 18 10 Z"
        fill={s.fill} opacity={rough?.82:1} style={rough?{filter:"blur(1px)"}:{}}/>
      <rect x="-20" y="8" width="40" height="5.5" rx="2.75" fill={s.fill} opacity={rough?.82:1}/>
      {stage>=3&&<rect x="-2" y="-10" width="4" height="18" rx="2" fill={s.edge} opacity=".7"/>}
      {stage>=3&&<>
        <path d="M-18 10 L-18 24 Q-18 28 -11 28 L-11 10 Z" fill={s.fill} opacity=".88"/>
        <path d="M18 10 L18 24 Q18 28 11 28 L11 10 Z" fill={s.fill} opacity=".88"/>
      </>}
      {stage>=4&&<path d="M0-30 Q5-44 0-42 Q-5-44 0-30" fill={s.edge} opacity=".8"/>}
      {stage>=4&&<line x1="-14" y1="1" x2="14" y2="1" stroke={s.edge} strokeWidth=".5" opacity=".3"/>}
    </>
  );
}

function AxePaths({ stage, s }) {
  if (stage === 0) return (
    <>
      <ellipse cx="-5" cy="-8" rx="13" ry="15" fill={s.metal} style={{filter:"blur(2px)"}}/>
      <rect x="-2" y="4" width="5" height="18" rx="2" fill={s.metal} style={{filter:"blur(1px)"}} opacity=".7"/>
    </>
  );
  const rough = stage <= 1;
  return (
    <>
      <rect x="-3" y="-4" width="6" height="36" rx="3" fill={stage>=2?"#8B6914":"#5A4010"} opacity=".9"/>
      <path d={stage>=2
        ? "M-3-4 L-20-22 Q-26-30 -14-32 Q-4-28 8-18 Q16-8 12 2 L-3-4 Z"
        : "M-3-4 L-16-18 Q-20-26 -10-26 L10-12 Q16-4 12 2 L-3-4 Z"}
        fill={s.fill} opacity={rough?.85:1} style={rough?{filter:"blur(1px)"}:{}}/>
      {stage>=2&&<path d="M-3 8 Q0 4 3 8 L3 18 Q0 22 -3 18 Z" fill={s.fill} opacity=".55"/>}
      {stage>=3&&<line x1="-19" y1="-20" x2="11" y2="2" stroke={s.edge} strokeWidth=".7" opacity=".45"/>}
      {stage>=4&&<text x="-6" y="-12" textAnchor="middle" fontSize="6" fill={s.edge} opacity=".7" fontFamily="serif">⟡</text>}
    </>
  );
}

function PickPaths({ stage, s }) {
  if (stage === 0) return <rect x="-10" y="-6" width="20" height="12" rx="3" fill={s.metal} style={{filter:"blur(1.5px)"}}/>;
  return (
    <>
      <rect x="-2" y="-6" width="4" height="32" rx="2" fill={stage>=2?"#8B6914":"#5A4010"} opacity=".9"/>
      <path d="M-2-6 L-14-18 Q-18-22 -12-22 L10-8 Q14-4 10 0 L-2-6 Z"
        fill={s.fill} opacity={stage<=1?.85:1} style={stage<=1?{filter:"blur(.8px)"}:{}}/>
      {stage>=2&&<path d="M-2-6 L14-18 Q18-22 12-22 L10-8 Z" fill={s.fill} opacity=".75"/>}
      {stage>=4&&<line x1="-13" y1="-16" x2="9" y2="-6" stroke={s.edge} strokeWidth=".5" opacity=".45"/>}
    </>
  );
}

function BannerPaths({ stage, s }) {
  if (stage === 0) return (
    <>
      <rect x="-2.5" y="-22" width="5" height="44" rx="2.5" fill={s.metal} opacity=".7" style={{filter:"blur(1px)"}}/>
      <rect x="-1" y="-18" width="22" height="28" rx="2" fill={s.metal} style={{filter:"blur(2px)"}}/>
    </>
  );
  return (
    <>
      <rect x="-2.5" y="-30" width="5" height="60" rx="2.5" fill={stage>=2?"#8B6914":"#5A4010"} opacity=".9"/>
      <path d={stage>=2
        ? "M2.5-26 L32-14 L32 8 L2.5 14 Z"
        : "M2.5-22 L20-13 L20 4 L2.5 9 Z"}
        fill={s.fill} opacity={stage<=1?.85:.92}/>
      {stage>=3&&<polygon points="0,-30 -4,-21 4,-21" fill={s.fill} opacity=".9"/>}
      {stage>=4&&<text x="17" y="-3" textAnchor="middle" fontSize="7" fill={s.edge} opacity=".7" fontFamily="serif">⟡</text>}
    </>
  );
}

function CharmPaths({ stage, s }) {
  if (stage === 0) return <ellipse cx="0" cy="0" rx="11" ry="10" fill={s.metal} style={{filter:"blur(2px)"}}/>;
  if (stage === 1) return (
    <path d="M0-12 L10-5 L10 5 L0 12 L-10 5 L-10-5 Z"
      fill={s.fill} opacity=".85" style={{filter:"blur(.8px)"}}/>
  );
  return (
    <>
      <path d="M0-15 L13-7 L13 7 L0 15 L-13 7 L-13-7 Z" fill={s.fill}/>
      <path d="M0-15 L4-12 L13-7" fill="none" stroke="#FFF" strokeWidth=".7" opacity=".15"/>
      {stage>=3&&<path d="M0-9 L8-4 L8 4 L0 9 L-8 4 L-8-4 Z" fill={s.edge} opacity=".2"/>}
      {stage>=3&&<line x1="0" y1="-15" x2="0" y2="15" stroke={s.edge} strokeWidth=".5" opacity=".2"/>}
      {stage>=4&&<text x="0" y="5" textAnchor="middle" fontSize="10" fill={s.edge} opacity=".75" fontFamily="serif">✦</text>}
    </>
  );
}

function ArmourPaths({ stage, s }) {
  if (stage === 0) return <rect x="-16" y="-20" width="32" height="36" rx="4" fill={s.metal} style={{filter:"blur(2.5px)"}}/>;
  const rough = stage <= 1;
  return (
    <>
      {/* breastplate */}
      <path d="M-16-18 Q-16-28 0-28 Q16-28 16-18 L18 10 Q18 20 0 22 Q-18 20 -18 10 Z"
        fill={s.fill} opacity={rough?.82:1} style={rough?{filter:"blur(1px)"}:{}}/>
      {stage>=2&&<>
        {/* shoulder pauldrons */}
        <path d="M-16-18 Q-22-18 -24-10 Q-24-4 -18 0 L-16 0 L-16-18 Z" fill={s.fill} opacity=".9"/>
        <path d="M16-18 Q22-18 24-10 Q24-4 18 0 L16 0 L16-18 Z" fill={s.fill} opacity=".9"/>
      </>}
      {stage>=3&&<line x1="0" y1="-24" x2="0" y2="18" stroke={s.edge} strokeWidth=".7" opacity=".4"/>}
      {stage>=3&&<line x1="-12" y1="-6" x2="12" y2="-6" stroke={s.edge} strokeWidth=".5" opacity=".35"/>}
      {stage>=4&&<text x="0" y="4" textAnchor="middle" fontSize="9" fill={s.edge} opacity=".55" fontFamily="serif">⟡</text>}
      {stage>=4&&<path d="M-16-18 L16-18 L14-16 L-14-16 Z" fill={s.edge} opacity=".1"/>}
    </>
  );
}

function AegisPaths({ stage, s }) {
  if (stage === 0) return <ellipse cx="0" cy="0" rx="20" ry="24" fill={s.metal} style={{filter:"blur(2.5px)"}}/>;
  const rough = stage <= 1;
  return (
    <>
      <path d="M0-30 L24-16 L24 8 Q24 34 0 38 Q-24 34 -24 8 L-24-16 Z"
        fill={s.fill} opacity={rough?.82:1} style={rough?{filter:"blur(1px)"}:{}}/>
      {stage>=2&&<path d="M0-30 L26-16 L28 8 Q0 40 0 40 Q-28 8 -28-16 Z" fill="none" stroke={s.edge} strokeWidth="1.5" opacity=".2"/>}
      {stage>=3&&<path d="M0-20 L14-10 L14 5 Q14 20 0 22 Q-14 20 -14 5 L-14-10 Z" fill={s.edge} opacity=".12"/>}
      {stage>=3&&<line x1="0" y1="-24" x2="0" y2="22" stroke={s.edge} strokeWidth=".7" opacity=".4"/>}
      {stage>=4&&<>
        <text x="0" y="6" textAnchor="middle" fontSize="14" fill={s.edge} opacity=".55" fontFamily="serif">⟡</text>
        <circle cx="0" cy="0" r="6" fill={s.edge} opacity=".08"/>
        <line x1="-16" y1="0" x2="16" y2="0" stroke={s.edge} strokeWidth=".5" opacity=".25"/>
      </>}
    </>
  );
}

function ItemPaths({ type, stage }) {
  const s = SC[Math.min(stage, 4)];
  switch (type) {
    case "sword": return <SwordPaths stage={stage} s={s}/>;
    case "dagger": return <DaggerPaths stage={stage} s={s}/>;
    case "shield": return <ShieldPaths stage={stage} s={s}/>;
    case "helmet": return <HelmetPaths stage={stage} s={s}/>;
    case "axe": return <AxePaths stage={stage} s={s}/>;
    case "pick": return <PickPaths stage={stage} s={s}/>;
    case "banner": return <BannerPaths stage={stage} s={s}/>;
    case "charm": return <CharmPaths stage={stage} s={s}/>;
    case "armour": return <ArmourPaths stage={stage} s={s}/>;
    case "aegis": return <AegisPaths stage={stage} s={s}/>;
    default: return <SwordPaths stage={stage} s={s}/>;
  }
}

// viewBox per item type (width height cx cy) for the compact card & forge wall
const VB = {
  sword:  { vb:"-16 -48 32 96",  w:.55 },
  dagger: { vb:"-10 -44 20 88",  w:.42 },
  shield: { vb:"-24 -34 48 68",  w:.70 },
  helmet: { vb:"-24 -36 48 72",  w:.74 },
  axe:    { vb:"-24 -36 48 68",  w:.72 },
  pick:   { vb:"-20 -30 40 60",  w:.68 },
  banner: { vb:"-6 -36 44 76",   w:.65 },
  charm:  { vb:"-16 -20 32 40",  w:.78 },
  armour: { vb:"-24 -34 48 66",  w:.80 },
  aegis:  { vb:"-28 -36 56 80",  w:.80 },
};

function ItemPreview({ type, stage, height = 52 }) {
  const s = SC[Math.min(stage, 4)];
  const cfg = VB[type] ?? VB.sword;
  const filter = s.hot
    ? `drop-shadow(0 0 5px ${s.glow})`
    : stage === 4 ? `drop-shadow(0 0 4px ${s.glow}70)` : "none";
  return (
    <svg viewBox={cfg.vb} width={Math.round(height * cfg.w)} height={height}
      style={{ overflow:"visible", filter, display:"block" }}>
      <ItemPaths type={type} stage={stage}/>
    </svg>
  );
}

// ─── SMITH CHARACTER ──────────────────────────────────────────────────────────────
// A proper layered SVG companion character. Defined relative to foot-center (0,0).
// Translate the group to position within the scene.

function SmithCharacter({ striking = false, reducedMotion = false, bandanaColor = "#C04018" }) {
  return (
    <g>
      {/* Shadow stays on ground — unaffected by any body animation */}
      <ellipse cx="0" cy="1" rx="19" ry="4" fill="#000" opacity=".45"/>
      {/* Lateral body sway — slow, pivots from feet */}
      <g className={reducedMotion ? "" : "fg-sway"}>
        {/* Vertical breathing — asymmetric inhale/exhale */}
        <g className={reducedMotion ? "" : "fg-breathe"}>
          {/* LEGS */}
          <rect x="-13" y="-28" width="11" height="29" rx="4" fill="#2A3040"/>
          <rect x="2"   y="-26" width="11" height="27" rx="4" fill="#2A3040"/>
          {/* Boots */}
          <path d="M-16-2 Q-15 2 -6 2 L-6-1 L-14-2 Z" fill="#3A2A18"/>
          <path d="M1-1 Q1 3 10 3 L11-1 L2-2 Z" fill="#3A2A18"/>
          {/* TORSO */}
          <rect x="-16" y="-66" width="32" height="40" rx="7" fill="#2E3848"/>
          {/* APRON */}
          <path d="M-12-60 L12-60 L14-28 L-14-28 Z" fill="#5C3A1C"/>
          <line x1="0" y1="-60" x2="0" y2="-28" stroke="#4A2E14" strokeWidth="1.5" opacity=".5"/>
          <rect x="-5" y="-44" width="10" height="8" rx="2" fill="#4A2E14" opacity=".8"/>
          {/* Apron strings */}
          <line x1="-12" y1="-60" x2="-8" y2="-70" stroke="#5C3A1C" strokeWidth="2.5"/>
          <line x1="12"  y1="-60" x2="8"  y2="-70" stroke="#5C3A1C" strokeWidth="2.5"/>
          {/* LEFT ARM + TONGS */}
          <rect x="-24" y="-64" width="9" height="28" rx="4" fill="#B87840"/>
          <path d="M-24-38 Q-28-36 -26-32 Q-24-28 -20-30 L-20-36 Z" fill="#8B5E3C"/>
          <line x1="-24" y1="-32" x2="-27" y2="-47" stroke="#6A6860" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="-22" y1="-32" x2="-24" y2="-47" stroke="#6A6860" strokeWidth="2"   strokeLinecap="round"/>
          {/* RIGHT ARM + HAMMER — independent rotation animation */}
          <g className={!reducedMotion ? (striking ? "fg-strike" : "fg-arm-idle") : ""} style={{transformOrigin:"14px -62px"}}>
            <rect x="13" y="-64" width="9" height="28" rx="4" fill="#B87840"/>
            <path d="M13-38 Q17-36 18-32 Q19-28 15-29 L13-35 Z" fill="#8B5E3C"/>
            <rect x="16" y="-86" width="4.5" height="30" rx="2.25" fill="#5C3E20"/>
            <rect x="9"  y="-98" width="20" height="14" rx="3.5" fill="#6A6860"/>
            <rect x="9"  y="-98" width="20" height="4"  rx="1.5" fill="#8A8880" opacity=".5"/>
            <rect x="9"  y="-88" width="20" height="4"  rx="1.5" fill="#5A5858" opacity=".4"/>
          </g>
          {/* HEAD GROUP — independent subtle tilt, pivoting at neck base */}
          <g className={reducedMotion ? "" : "fg-head-tilt"} style={{transformOrigin:"0px -78px"}}>
            {/* Neck */}
            <rect x="-7" y="-78" width="14" height="10" rx="5" fill="#B87840"/>
            {/* Head */}
            <ellipse cx="0" cy="-90" rx="17" ry="19" fill="#C8844A"/>
            {/* Hair */}
            <path d="M-17-97 Q-17-110 0-112 Q17-110 17-97 L13-97 Q13-108 0-110 Q-13-108 -13-97 Z" fill="#1A1412"/>
            {/* Bandana accent — color driven by coach identity */}
            <path d="M-17-97 Q-17-106 0-108 Q17-106 17-97" fill="none" stroke={bandanaColor} strokeWidth="3.5" opacity=".88"/>
            <path d="M17-97 Q21-99 19-94 Q17-89 15-91" fill={bandanaColor} opacity=".7"/>
            {/* Eye sockets */}
            <ellipse cx="-5.5" cy="-89" rx="4" ry="3.5" fill="#B07030" opacity=".2"/>
            <ellipse cx="5.5"  cy="-89" rx="4" ry="3.5" fill="#B07030" opacity=".2"/>
            {/* Eyes */}
            <circle cx="-5.5" cy="-89" r="2.8" fill="#1A1412"/>
            <circle cx="5.5"  cy="-89" r="2.8" fill="#1A1412"/>
            {/* Gleams */}
            <circle cx="-4.5" cy="-90" r="1.1" fill="#FFF" opacity=".82"/>
            <circle cx="6.5"  cy="-90" r="1.1" fill="#FFF" opacity=".82"/>
            {/* Brows */}
            <path d="M-9-93 Q-5.5-95 -2-93" fill="none" stroke="#8B4820" strokeWidth="1.5" opacity=".4"/>
            <path d="M2-93 Q5.5-95 9-93"    fill="none" stroke="#8B4820" strokeWidth="1.5" opacity=".4"/>
            {/* Nose */}
            <path d="M-3-84 Q0-82 3-84" fill="none" stroke="#A06830" strokeWidth="1.5" opacity=".5"/>
            {/* Mouth */}
            <path d="M-5-78 Q0-76 5-78" fill="none" stroke="#8B4820" strokeWidth="1.6" strokeLinecap="round"/>
            {/* Jaw shadow */}
            <path d="M-16-96 Q-17-82 -13-76" stroke="#A06030" strokeWidth="1.5" fill="none" opacity=".25"/>
            <path d="M16-96 Q17-82 13-76"    stroke="#A06030" strokeWidth="1.5" fill="none" opacity=".25"/>
            {/* Cheek highlight */}
            <ellipse cx="-10" cy="-83" rx="5" ry="3" fill="#E07040" opacity=".12"/>
            <ellipse cx="10"  cy="-83" rx="5" ry="3" fill="#E07040" opacity=".12"/>
          </g>{/* /fg-head-tilt */}
        </g>{/* /fg-breathe */}
      </g>{/* /fg-sway */}
    </g>
  );
}

// Small portrait crop (just head+shoulders) for the compact card
function SmithPortrait({ size = 44 }) {
  return (
    <svg viewBox="-20 -115 40 55" width={size} height={size}
      style={{ display:"block", borderRadius:"50%", background:"#1A1208" }}>
      {/* Shoulders */}
      <rect x="-16" y="-76" width="32" height="12" rx="6" fill="#2E3848"/>
      <path d="M-12-76 L12-76 L10-72 L-10-72 Z" fill="#5C3A1C"/>
      {/* Bandana strings hint */}
      <line x1="-12" y1="-76" x2="-8" y2="-82" stroke="#5C3A1C" strokeWidth="2"/>
      <line x1="12"  y1="-76" x2="8"  y2="-82" stroke="#5C3A1C" strokeWidth="2"/>
      {/* Neck */}
      <rect x="-6" y="-84" width="12" height="8" rx="4" fill="#B87840"/>
      {/* Head */}
      <ellipse cx="0" cy="-96" rx="16" ry="18" fill="#C8844A"/>
      {/* Hair */}
      <path d="M-16-102 Q-16-115 0-117 Q16-115 16-102 L13-102 Q13-113 0-115 Q-13-113 -13-102 Z" fill="#1A1412"/>
      <path d="M-16-102 Q-16-111 0-113 Q16-111 16-102" fill="none" stroke="#C04018" strokeWidth="3" opacity=".85"/>
      {/* Eyes */}
      <circle cx="-5.5" cy="-94" r="2.5" fill="#1A1412"/>
      <circle cx="5.5"  cy="-94" r="2.5" fill="#1A1412"/>
      <circle cx="-4.5" cy="-95" r="1"   fill="#FFF" opacity=".8"/>
      <circle cx="6.5"  cy="-95" r="1"   fill="#FFF" opacity=".8"/>
      {/* Mouth */}
      <path d="M-4-87 Q0-85 4-87" fill="none" stroke="#8B4820" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

// ─── 3D BLACKSMITH ────────────────────────────────────────────────────────────────

function BlacksmithModel({ striking, reducedMotion }) {
  // Ref must sit on the primitive itself — the mixer needs the scene root
  // that contains the 41 skeleton joints, not a wrapper Group
  const sceneRef = useRef();
  const { scene, animations } = useGLTF("/forge-companion.glb");
  const { actions, mixer } = useAnimations(animations, sceneRef);

  // 2H_Melee_Idle = heavy weapon-ready stance
  useEffect(() => {
    if (!actions["2H_Melee_Idle"]) return;
    actions["2H_Melee_Idle"].reset().play();
  }, [actions]);

  // Trigger chop, fade back to idle when the one-shot finishes
  useEffect(() => {
    if (reducedMotion || !striking) return;
    const idle = actions["2H_Melee_Idle"];
    const chop = actions["2H_Melee_Attack_Chop"];
    if (!chop || !mixer) return;

    chop.reset().setLoop(THREE.LoopOnce, 1);
    chop.clampWhenFinished = false;
    idle?.fadeOut(0.08);
    chop.fadeIn(0.08).play();

    const onDone = (e) => {
      if (e.action === chop) idle?.reset().fadeIn(0.3).play();
    };
    mixer.addEventListener("finished", onDone);
    return () => mixer.removeEventListener("finished", onDone);
  }, [striking]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <primitive
      ref={sceneRef}
      object={scene}
      scale={0.82}
      position={[0.1, -0.66, 0]}
      rotation={[0, 0.2, 0]}
    />
  );
}

// ─── WORKSHOP SCENE ───────────────────────────────────────────────────────────────

const EMBERS = [
  {cx:39,cy:107,del:"0s",  dur:"2.3s",dx:"-14px",r:1.6},
  {cx:53,cy:107,del:".6s", dur:"1.9s",dx:"-5px", r:1.0},
  {cx:35,cy:107,del:"1.1s",dur:"2.7s",dx:"-18px",r:1.3},
  {cx:57,cy:107,del:".25s",dur:"2.1s",dx:"7px",  r:0.9},
  {cx:46,cy:107,del:"1.5s",dur:"1.7s",dx:"-10px",r:1.9},
  {cx:43,cy:107,del:".9s", dur:"2.5s",dx:"10px", r:1.1},
  {cx:50,cy:107,del:"1.8s",dur:"2.0s",dx:"-4px", r:0.8},
];

const SPARK_OFFSETS = [
  {sx:"-22px",sy:"-40px",del:".30s"},{sx:"18px", sy:"-44px",del:".33s"},
  {sx:"-30px",sy:"-32px",del:".31s"},{sx:"26px", sy:"-36px",del:".35s"},
  {sx:"-12px",sy:"-50px",del:".28s"},{sx:"10px", sy:"-48px",del:".38s"},
];

function WorkshopScene({ item, progress, striking, reducedMotion, bandanaColor }) {
  const { stage } = progress;
  const s = SC[Math.min(stage,4)];

  // viewbox for item on anvil (varies by type)
  const itemVbMap = {
    sword:  {vb:"-16 -48 32 100",ty:-35},
    dagger: {vb:"-10 -44 20 88", ty:-30},
    shield: {vb:"-24 -34 48 70", ty:-20},
    helmet: {vb:"-24 -36 48 72", ty:-18},
    axe:    {vb:"-24 -36 48 70", ty:-22},
    pick:   {vb:"-20 -28 40 58", ty:-16},
    banner: {vb:"-6 -36 44 76", ty:-30},
    charm:  {vb:"-16 -20 32 44", ty:-8},
    armour: {vb:"-24 -34 48 68", ty:-18},
    aegis:  {vb:"-28 -36 56 82", ty:-22},
  };
  const iCfg = itemVbMap[item.type] ?? itemVbMap.sword;

  return (
    <div style={{position:"relative",width:"100%"}}>
    <svg viewBox="0 0 340 222" style={{width:"100%",height:"auto",display:"block"}}>
      <defs>
        <radialGradient id="fg-amb" cx="23%" cy="76%" r="46%">
          <stop offset="0%"  stopColor="#E67E22" stopOpacity=".38"/>
          <stop offset="50%" stopColor="#C0392B" stopOpacity=".1"/>
          <stop offset="100%" stopColor="#0D0D0B" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="fg-hot-h" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#E67E22" stopOpacity=".85"/>
          <stop offset="100%" stopColor="#E67E22" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="fg-gold-h" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="#F5C842" stopOpacity=".78"/>
          <stop offset="100%" stopColor="#F5C842" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="fg-cool-h" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor={s.glow} stopOpacity=".5"/>
          <stop offset="100%" stopColor={s.glow} stopOpacity="0"/>
        </radialGradient>
        <filter id="fg-b3"><feGaussianBlur stdDeviation="3"/></filter>
        <filter id="fg-b6"><feGaussianBlur stdDeviation="6"/></filter>
        <clipPath id="fg-scene"><rect width="340" height="222"/></clipPath>
      </defs>

      <g clipPath="url(#fg-scene)">
        {/* ── BACKGROUND — deep dark stone, no noisy seam lines ── */}
        <rect width="340" height="222" fill="#080807"/>
        {/* Wide forge-fire atmosphere sweeping from left across whole scene */}
        <rect width="340" height="222" fill="url(#fg-amb)"/>
        {/* Faint mid-floor horizon line */}
        <line x1="0" y1="170" x2="340" y2="170" stroke="#1A1814" strokeWidth="1.5"/>

        {/* ── FURNACE — simplified silhouette, no stone seams ── */}
        {/* Chimney stack */}
        <rect x="18" y="0" width="46" height="38" rx="3" fill="#111009"/>
        {/* Body */}
        <rect x="6" y="32" width="82" height="140" rx="6" fill="#111009"/>
        {/* Arch opening */}
        <path d="M18 170 L18 100 Q46 60 74 100 L74 170 Z" fill="#050403"/>
        {/* Arch frame — single warm stroke */}
        <path d="M16 102 Q46 58 76 102" fill="none" stroke="#2A2010" strokeWidth="4"/>
        {/* Ash bed */}
        <ellipse cx="46" cy="168" rx="22" ry="4" fill="#1A1208" opacity=".9"/>
        {/* Fire */}
        <path className={reducedMotion?"":"fg-fire1"} d="M26 170 L34 138 L41 154 L47 130 L53 147 L60 133 L67 170 Z" fill="#B03018" opacity=".9"/>
        <path className={reducedMotion?"":"fg-fire2"} d="M30 170 L38 122 L47 142 L55 116 L63 137 L69 170 Z"       fill="#E67E22" opacity=".7"/>
        <path className={reducedMotion?"":"fg-fire3"} d="M34 170 L42 132 L47 112 L52 128 L59 120 L65 170 Z"       fill="#F5C842" opacity=".38"/>
        {/* Wide floor glow — now spans full width to wash the character too */}
        <ellipse cx="170" cy="170" rx="170" ry="22" fill="#E67E22"
          opacity={reducedMotion?.08:.12} className={reducedMotion?"":"fg-glow1"} style={{filter:"blur(10px)"}}/>
        <ellipse cx="46" cy="170" rx="55" ry="10" fill="#E86820"
          opacity={reducedMotion?.14:.2} className={reducedMotion?"":"fg-glow2"} style={{filter:"blur(4px)"}}/>
        {/* Embers */}
        {!reducedMotion && EMBERS.map((e,i)=>(
          <circle key={i} cx={e.cx} cy={e.cy} r={e.r}
            fill={i%3===0?"#F5C842":"#E67E22"}
            className="fg-ember"
            style={{"--dur":e.dur,"--del":e.del,"--dx":e.dx}}/>
        ))}

        {/* ── ANVIL — bolder, heavier silhouette ── */}
        <ellipse cx="180" cy="177" rx="58" ry="8" fill="#000" opacity=".6" style={{filter:"blur(3px)"}}/>
        {/* Horn */}
        <path d="M123 132 Q104 135 108 140 L123 140 Z" fill="#1E1C18"/>
        {/* Top plate */}
        <rect x="121" y="122" width="118" height="20" rx="4" fill="#282520"/>
        <rect x="121" y="122" width="118" height="4"  rx="2" fill="#38342C" opacity=".7"/>
        {/* Body */}
        <rect x="140" y="142" width="82" height="22" rx="3" fill="#1C1A16"/>
        {/* Base */}
        <rect x="126" y="164" width="108" height="14" rx="3" fill="#242018"/>
        <rect x="126" y="164" width="108" height="3"  rx="1.5" fill="#302C22" opacity=".6"/>

        {/* ── ITEM ON ANVIL ── glow tracks item shape via drop-shadow */}
        <svg x="138" y="8" viewBox={iCfg.vb} width="100" height="114" preserveAspectRatio="xMidYMax meet"
          style={{overflow:"visible", filter: s.hot
            ? `drop-shadow(0 0 8px ${s.glow}) drop-shadow(0 0 16px ${s.glow}50)`
            : stage===4
              ? `drop-shadow(0 0 6px ${s.glow}90) drop-shadow(0 0 12px ${s.glow}40)`
              : stage>=2
                ? `drop-shadow(0 0 4px ${s.glow}60)`
                : "none"
          }}>
          <ItemPaths type={item.type} stage={stage}/>
        </svg>

        {/* IMPACT FLASH — cx=215 matches where the 3D chop arc lands on the anvil */}
        {!reducedMotion && striking && (
          <ellipse cx="215" cy="122" rx="26" ry="7"
            fill="#F5C842" className="fg-impact" style={{filter:"blur(3px)"}}/>
        )}
        {/* STRIKE SPARKS */}
        {!reducedMotion && striking && SPARK_OFFSETS.map((sp,i)=>(
          <circle key={i} cx="215" cy="118" r={i<2?3.5:2} fill={i%2===0?"#F5C842":"#E67E22"}
            className="fg-spark" style={{"--sx":sp.sx,"--sy":sp.sy,"--del":sp.del}}/>
        ))}
        {!reducedMotion && striking && [0,1,2].map(i=>(
          <circle key={`c${i}`} cx={213+(i-1)*8} cy="112" r="1.8" fill="#FFFBE0"
            className="fg-spark" style={{"--sx":`${(i-1)*12}px`,"--sy":"-34px","--del":`.28s`}}/>
        ))}

        {/* ── FLOOR — dark stone, two simple depth lines ── */}
        <rect x="0" y="170" width="340" height="52" fill="#0C0B09"/>
        <line x1="0" y1="192" x2="340" y2="192" stroke="#161410" strokeWidth=".8"/>

        {/* Stage label */}
        <text x="320" y="17" textAnchor="end" fontSize="8"
          fontFamily="DM Sans,system-ui,sans-serif" fontWeight="700" letterSpacing=".1em"
          fill={s.edge} opacity=".6">
          {(FORGE_STAGES[stage]?.label??"").toUpperCase()}
        </text>
      </g>
    </svg>

    {/* 3D character — overlaid on the right ~40% of the scene */}
    <div style={{
      position:"absolute", right:0, top:0, bottom:0, width:"42%",
      pointerEvents:"none",
    }}>
      <Suspense fallback={null}>
        <Canvas
          gl={{ alpha:true, antialias:false }}
          dpr={[1, 1.5]}
          camera={{ position:[0, 0.1, 3.4], fov:46 }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          style={{ width:"100%", height:"100%", background:"transparent" }}
        >
          {/* Warm forge-fire ambient — matches SVG scene orange glow */}
          <ambientLight intensity={0.35} color="#C04A10" />
          <pointLight position={[-4, 0.5, 2]} intensity={2.2} color="#E86820" />
          <pointLight position={[1, 2.5, 2]} intensity={0.5} color="#F5C842" />
          <BlacksmithModel striking={striking} reducedMotion={reducedMotion} />
        </Canvas>
      </Suspense>
    </div>
    </div>
  );
}

// ─── STAGE TRACKER ────────────────────────────────────────────────────────────────

function StageTracker({ stage }) {
  return (
    <div style={{display:"flex",alignItems:"flex-start",padding:"0 2px"}}>
      {FORGE_STAGES.map((st,i)=>{
        const done=i<stage, active=i===stage;
        const c=SC[i];
        return (
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6,position:"relative"}}>
            {i<FORGE_STAGES.length-1&&(
              <div style={{position:"absolute",top:11,left:"50%",right:0,height:2,
                background:done?`linear-gradient(90deg,${T.gold}80,${T.gold}40)`:T.hint+"28",zIndex:0}}/>
            )}
            <div style={{width:22,height:22,borderRadius:"50%",zIndex:1,position:"relative",
              border:`2px solid ${active?c.edge:done?c.edge+"60":T.hint+"28"}`,
              background:active?c.edge+"22":done?c.edge+"10":"transparent",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:9,fontWeight:700,
              color:active?c.edge:done?c.edge+"AA":T.hint+"55",
              boxShadow:active?`0 0 12px ${c.edge}55`:"none",
              transition:"box-shadow .5s ease"}}>
              {done?"✓":i+1}
            </div>
            <div style={{fontSize:8.5,fontWeight:active?700:500,color:active?T.text:done?T.sub:T.hint,
              textAlign:"center",lineHeight:1.3,transition:"color .3s"}}>
              {st.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ITEM SELECTOR ────────────────────────────────────────────────────────────────

function ItemSelector({ arc, currentItem, onSelect, isLocked, onReset }) {
  const arcPool = useMemo(()=>getItemPool(arc),[arc?.id,arc?.duration_days,arc?.durationDays]);

  if (isLocked) {
    return (
      <div style={{marginBottom:4}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",
          background:T.raised,borderRadius:T.rsm,border:`1px solid ${T.gold}30`}}>
          <ItemPreview type={currentItem.type} stage={4} height={28}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,color:T.text,fontWeight:600}}>{currentItem.name}</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>Locked to this Arc 🔒</div>
          </div>
          {/* Dev reset — preview builds only */}
          <button type="button" onClick={onReset}
            style={{padding:"5px 10px",borderRadius:T.rsm,border:`1px solid ${T.border}`,
              background:"none",color:T.hint,fontSize:10,fontFamily:T.font,cursor:"pointer",
              flexShrink:0}}>
            Reset
          </button>
        </div>
        <div style={{fontSize:10,color:T.hint,marginTop:8,lineHeight:1.5}}>
          Your item is set. The forge tracks progress toward this specific artifact.
        </div>
      </div>
    );
  }

  return (
    <div style={{marginBottom:4}}>
      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
        {ALL_ITEMS.map(item=>{
          const active=item.id===currentItem.id;
          const inPool=arcPool.some(p=>p.id===item.id);
          return (
            <button key={item.id} type="button" onClick={()=>onSelect(item)}
              style={{display:"flex",alignItems:"center",gap:7,padding:"8px 13px",
                borderRadius:T.rsm,
                border:`1px solid ${active?T.gold+"80":inPool?T.borderMid:T.border}`,
                background:active?T.gold+"14":inPool?T.raised:T.surface,
                cursor:"pointer",fontFamily:T.font,fontSize:12,
                color:active?T.text:inPool?T.sub:T.muted,
                fontWeight:active?600:400,
                boxShadow:active?`0 0 10px ${T.gold}20`:"none",
                transition:"all .2s ease"}}>
              <ItemPreview type={item.type} stage={4} height={20}/>
              <span>{item.name}</span>
              {inPool&&!active&&<span style={{fontSize:9,color:T.gold+"90",fontWeight:600,marginLeft:1}}>✦</span>}
            </button>
          );
        })}
      </div>
      <div style={{fontSize:10,color:T.hint,marginTop:8,lineHeight:1.5}}>
        ✦ Suggested for this Arc length · Choosing locks this item to your Arc.
      </div>
    </div>
  );
}

// ─── RECENT FORGE HISTORY ─────────────────────────────────────────────────────────

function RecentHistory({ rows, item }) {
  if (!rows.length) return null;

  const buildMessages = [
    "ore collected", "billet heated", "rough shape found",
    "edges hammered", "blade formed", "surface flattened",
    "guard shaped", "handle wrapped", "polish started", "final edge set",
  ];

  return (
    <div style={{marginBottom:16}}>
      <div style={{fontSize:10,fontWeight:700,color:T.hint,letterSpacing:".12em",
        textTransform:"uppercase",marginBottom:10}}>
        Recent forge days
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {rows.map((r,i)=>{
          const d=new Date(r.date+"T12:00:00");
          const now=new Date();
          const diffDays=Math.round((now-d)/(86400000));
          const label=diffDays===0?"Today":diffDays===1?"Yesterday":
            d.toLocaleDateString("en-AU",{weekday:"short",day:"numeric",month:"short"});
          const pct=r.total>0?Math.round((r.done/r.total)*100):0;
          const msgIdx=(r.date.charCodeAt(r.date.length-1)+(i*3))%buildMessages.length;
          return (
            <div key={r.date} style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:6,height:6,borderRadius:"50%",
                background:i===0?T.gold:T.gold+"50",flexShrink:0}}/>
              <div style={{fontSize:11,color:i===0?T.sub:T.muted,lineHeight:1.4,minWidth:0}}>
                <span style={{color:i===0?T.text:T.sub,fontWeight:i===0?600:400}}>{label}</span>
                <span style={{color:T.hint}}> — </span>
                {buildMessages[msgIdx]}
                <span style={{color:T.hint}}> · {pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FORGE WALL ───────────────────────────────────────────────────────────────────

function ForgeWall({ userId }) {
  const [arcs,setArcs]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    if(!userId)return;
    let c=false;
    supabase.from("forge_blocks")
      .select("id,title,duration_days,completion_score,start_date,end_date,status")
      .eq("user_id",userId).eq("status","completed")
      .order("start_date",{ascending:false}).limit(12)
      .then(({data})=>{
        if(c)return;
        setArcs(data?data.map(rowToForgeBlock):[]);
        setLoading(false);
      });
    return()=>{c=true;};
  },[userId]);

  return (
    <div style={{margin:"0 0 20px"}}>
      <div style={{fontSize:10,fontWeight:700,color:T.hint,letterSpacing:".12em",
        textTransform:"uppercase",marginBottom:10}}>
        Forge Wall
      </div>
      {loading&&(
        <div style={{fontSize:13,color:T.hint,padding:"10px 0"}}>Loading…</div>
      )}
      {!loading&&(!arcs||arcs.length===0)&&(
        <div style={{padding:"14px 16px",background:T.surface,borderRadius:T.rsm,
          border:`1px dashed ${T.hint}28`}}>
          <div style={{fontSize:13,color:T.hint,lineHeight:1.65}}>
            Finish this Arc and your forged item joins the wall. Every completed Arc leaves an artifact.
          </div>
        </div>
      )}
      {!loading&&arcs&&arcs.length>0&&(
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {arcs.map((arc,i)=>{
            const item=getDefaultForgeItem(arc);
            const score=arc.completionScore??arc.completion_score??0;
            const finalStage=score>=85?4:score>=60?3:score>=35?2:1;
            const isComplete=finalStage>=4;
            return (
              <div key={arc.id||i} style={{width:76,display:"flex",flexDirection:"column",
                alignItems:"center",gap:5,padding:"12px 6px 10px",
                background:T.surface,borderRadius:T.rsm,
                border:`1px solid ${isComplete?T.gold+"30":T.border}`,
                boxShadow:isComplete?`0 0 16px ${T.gold}14`:"none"}}>
                <ItemPreview type={item.type} stage={finalStage} height={44}/>
                <div style={{fontSize:9,color:T.muted,textAlign:"center",lineHeight:1.3,fontWeight:600}}>
                  {item.name}
                </div>
                <div style={{fontSize:8,color:isComplete?T.gold:T.hint,fontWeight:700}}>
                  {score}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── WORKSHOP SHEET ───────────────────────────────────────────────────────────────

function WorkshopSheet({ arc, item, progress, userId, onClose, onSelectItem, onResetItem, isLocked, reducedMotion, coachName, coachIcon, bandanaColor }) {
  const [striking, setStriking] = useState(false);
  const s = SC[Math.min(progress.stage,4)];
  const { daysForged, elapsedDays, consistency, pct, totalDays, stage, nextStage, daysToNext } = progress;

  // Three opening strikes, then keep firing every 10s so the 3D animation never idles out
  useEffect(()=>{
    if(reducedMotion)return;
    const fire = () => {
      setStriking(true);
      setTimeout(()=>setStriking(false), 950);
    };
    const ts=[
      setTimeout(fire,  350),
      setTimeout(fire, 2800),
      setTimeout(fire, 5600),
    ];
    const loop = setInterval(fire, 10000);
    return()=>{ ts.forEach(clearTimeout); clearInterval(loop); };
  },[reducedMotion]);

  const stageNarrative=[
    `The forge is lit and the ore is ready. ${item.name} exists only as raw potential — the first real proof day lands the first strike.`,
    `The metal is hot and a rough shape has emerged from the ore. The outline of ${item.name} is taking form.`,
    `The hammer has found its rhythm. Structure is set — ${item.name} is recognisably itself now, waiting for refinement.`,
    `Heat and patience are doing their work. The details are being carved in. ${item.name} is close.`,
    `The forge work is done. ${item.name} has been quenched, tempered, and polished. Sustained effort made solid.`,
  ][stage]??"";

  // Consistency label
  const consistencyLabel = consistency >= 80 ? "Strong pace"
    : consistency >= 55 ? "Good pace"
    : consistency >= 35 ? "Building"
    : consistency > 0   ? "Slow start"
    : "";

  const hasContext = elapsedDays > 0;

  return (
    <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(5,5,4,.88)",
      display:"flex",flexDirection:"column",justifyContent:"flex-end"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:T.bg,borderRadius:"22px 22px 0 0",maxHeight:"95dvh",
          overflowY:"auto",WebkitOverflowScrolling:"touch",
          paddingBottom:`max(36px,env(safe-area-inset-bottom,0px))`}}>

        {/* Handle */}
        <div style={{padding:"12px 0 2px",display:"flex",justifyContent:"center"}}>
          <div style={{width:38,height:4,borderRadius:2,background:T.hint+"55"}}/>
        </div>

        {/* Header */}
        <div style={{padding:"10px 20px 0",display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:9,fontWeight:700,color:s.edge,letterSpacing:".17em",
              textTransform:"uppercase",marginBottom:4}}>
              The Forge
              {coachName && coachName !== "Coach" && (
                <span style={{textTransform:"none",letterSpacing:0,fontWeight:500,
                  color:s.edge+"AA",marginLeft:6}}>
                  · {coachIcon ? `${coachIcon} ` : ""}{coachName}
                </span>
              )}
            </div>
            <h2 style={{fontFamily:T.serif,fontSize:26,color:T.text,margin:0,lineHeight:1.1}}>
              {item.name}
            </h2>
            <div style={{fontSize:12,color:T.muted,marginTop:3,fontStyle:"italic"}}>
              "{item.desc}"
            </div>
          </div>
          <button type="button" onClick={onClose}
            style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,
              padding:"7px 14px",color:T.sub,fontSize:13,fontFamily:T.font,cursor:"pointer",
              marginTop:2,flexShrink:0}}>
            Done
          </button>
        </div>

        {/* Workshop scene */}
        <div style={{margin:"12px 0 0",borderTop:`0.5px solid ${T.border}`,borderBottom:`0.5px solid ${T.border}`}}>
          <WorkshopScene item={item} progress={progress} striking={striking} reducedMotion={reducedMotion} bandanaColor={bandanaColor}/>
        </div>

        <div style={{padding:"0 20px"}}>
          {/* Stage tracker */}
          <div style={{padding:"16px 0 4px"}}>
            <StageTracker stage={stage}/>
          </div>

          {/* Progress block — the key numbers, explained clearly */}
          <div style={{margin:"10px 0",padding:"16px",background:T.surface,borderRadius:T.rsm,border:`1px solid ${T.border}`}}>

            {/* Two numbers side by side */}
            <div style={{display:"flex",gap:16,marginBottom:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:T.hint,marginBottom:3,textTransform:"uppercase",letterSpacing:".08em",fontWeight:700}}>
                  Forge days
                </div>
                <div style={{fontFamily:T.serif,fontSize:28,color:T.text,lineHeight:1}}>
                  {daysForged}
                  {hasContext && (
                    <span style={{fontFamily:T.font,fontSize:13,color:T.hint,marginLeft:4}}>
                      of {elapsedDays} in Arc
                    </span>
                  )}
                </div>
              </div>
              {hasContext && (
                <div style={{flex:1,textAlign:"right"}}>
                  <div style={{fontSize:9,color:T.hint,marginBottom:3,textTransform:"uppercase",letterSpacing:".08em",fontWeight:700}}>
                    Consistency
                  </div>
                  <div style={{lineHeight:1}}>
                    <span style={{fontFamily:T.serif,fontSize:28,color:s.edge}}>{consistency}%</span>
                    {consistencyLabel && (
                      <div style={{fontSize:10,color:T.sub,marginTop:3,fontWeight:600}}>{consistencyLabel}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Forge progress bar — how complete is the item */}
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <div style={{fontSize:10,color:T.muted,fontWeight:600}}>Item progress</div>
                <div style={{fontSize:10,color:s.edge,fontWeight:700}}>{pct}%</div>
              </div>
              <div style={{height:6,background:T.raised,borderRadius:4,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,
                  background:`linear-gradient(90deg,${s.fill},${s.edge})`,borderRadius:4,
                  transition:reducedMotion?"none":"width .9s cubic-bezier(.4,0,.2,1)",
                  minWidth:pct>0?6:0}}/>
              </div>
            </div>

            {/* Arc timeline bar (shows where user is in the Arc overall) */}
            {hasContext && (
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <div style={{fontSize:10,color:T.muted,fontWeight:600}}>Arc timeline</div>
                  <div style={{fontSize:10,color:T.muted}}>
                    Day {elapsedDays} of {totalDays}
                  </div>
                </div>
                <div style={{height:6,background:T.raised,borderRadius:4,overflow:"hidden",position:"relative"}}>
                  {/* elapsed */}
                  <div style={{height:"100%",
                    width:`${Math.min(100,Math.round(elapsedDays/totalDays*100))}%`,
                    background:`${T.hint}50`,borderRadius:4}}/>
                  {/* forge days (overlay) */}
                  <div style={{position:"absolute",top:0,left:0,height:"100%",
                    width:`${pct}%`,
                    background:`linear-gradient(90deg,${s.fill}80,${s.edge}90)`,borderRadius:4,
                    transition:reducedMotion?"none":"width .9s cubic-bezier(.4,0,.2,1)"}}/>
                </div>
                <div style={{fontSize:9,color:T.hint,marginTop:4,lineHeight:1.4}}>
                  Gold fill = forge days claimed · Grey = days elapsed
                </div>
              </div>
            )}

            <div style={{fontSize:12,color:T.sub,lineHeight:1.65,borderTop:`1px solid ${T.border}`,paddingTop:12}}>
              {stageNarrative}
            </div>
            {nextStage&&daysToNext>0&&(
              <div style={{marginTop:10,fontSize:11,color:T.hint,borderTop:`1px solid ${T.border}`,paddingTop:10}}>
                <span style={{color:T.sub}}>Next stage:</span>{" "}{nextStage.label}
                {" · "}<span style={{color:T.text,fontWeight:600}}>{daysToNext} more forge day{daysToNext!==1?"s":""}</span> to unlock
              </div>
            )}
          </div>

          {/* Forge days — what counts */}
          <div style={{margin:"0 0 14px",padding:"12px 14px",background:`${s.edge}09`,
            borderRadius:T.rsm,borderLeft:`2px solid ${s.edge}50`}}>
            <div style={{fontSize:10,color:s.edge,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",marginBottom:5}}>
              What is a forge day?
            </div>
            <div style={{fontSize:12,color:T.sub,lineHeight:1.7}}>
              Any day you hit ≥50% of your proof habits. Missing a day never removes progress — the work done stays in the metal. Hit enough forge days and the item completes.
            </div>
          </div>

          {/* Recent forge days */}
          {(progress.history ?? []).length > 0 && (
            <RecentHistory rows={progress.history} item={item}/>
          )}

          {/* Item selector */}
          <div style={{marginBottom:16,paddingTop:4,borderTop:`0.5px solid ${T.border}`}}>
            <div style={{fontSize:9,fontWeight:700,color:T.hint,letterSpacing:".12em",
              textTransform:"uppercase",margin:"14px 0 10px"}}>
              Forged item <span style={{color:T.hint+"80",fontWeight:500,letterSpacing:"0",textTransform:"none",fontSize:10}}>· preview only, saved locally</span>
            </div>
            <ItemSelector arc={arc} currentItem={item} onSelect={onSelectItem}
              isLocked={isLocked} onReset={onResetItem}/>
          </div>

          {/* Forge Wall */}
          <ForgeWall userId={userId}/>
        </div>
      </div>
    </div>
  );
}

// ─── COMPACT CARD ─────────────────────────────────────────────────────────────────

function ForgeCard({ item, progress, onOpen, reducedMotion, coachIcon, weekHeat }) {
  const s = SC[Math.min(progress.stage,4)];
  const { daysForged, elapsedDays, consistency, stage } = progress;

  const statusLine = elapsedDays > 0
    ? `${daysForged} forge day${daysForged !== 1 ? "s" : ""} · ${consistency}% consistent`
    : `${daysForged} forge day${daysForged !== 1 ? "s" : ""}`;

  return (
    <button type="button" onClick={onOpen}
      style={{width:"100%",display:"flex",alignItems:"center",gap:0,
        background:T.surface,border:`1px solid ${T.border}`,
        borderRadius:T.r,padding:0,cursor:"pointer",fontFamily:T.font,
        textAlign:"left",position:"relative",overflow:"hidden",minHeight:72}}>

      {/* Left ember accent */}
      <div style={{position:"absolute",top:0,left:0,bottom:0,width:3,
        background:`linear-gradient(180deg,${s.edge}50,${s.edge}95,${s.edge}50)`,
        borderRadius:"16px 0 0 16px"}}
        className={!reducedMotion&&s.hot?"fg-card-glow":""}/>

      {/* Smith portrait — coach icon badge overlaid */}
      <div style={{width:56,minWidth:56,height:72,display:"flex",alignItems:"center",
        justifyContent:"center",background:`radial-gradient(ellipse at center,${s.edge}12 0%,transparent 65%)`}}>
        <div style={{position:"relative"}}>
          <div style={{width:42,height:42,borderRadius:"50%",overflow:"hidden",
            border:`1.5px solid ${s.edge}38`,flexShrink:0}}>
            <SmithPortrait size={42}/>
          </div>
          {coachIcon && (
            <div style={{position:"absolute",bottom:-3,right:-3,
              fontSize:12,lineHeight:1,background:T.surface,borderRadius:"50%",
              padding:"2px",border:`1px solid ${T.border}`,userSelect:"none"}}>
              {coachIcon}
            </div>
          )}
        </div>
      </div>

      {/* Item preview */}
      <div style={{width:46,minWidth:46,height:72,display:"flex",alignItems:"center",
        justifyContent:"center",flexShrink:0}}>
        <ItemPreview type={item.type} stage={stage} height={48}/>
      </div>

      {/* Info */}
      <div style={{flex:1,padding:"10px 6px 10px 6px",minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
          <span style={{fontFamily:T.serif,fontSize:14,color:T.text,lineHeight:1.2,letterSpacing:".01em"}}>
            {item.name}
          </span>
          <span style={{fontSize:9,fontWeight:700,color:s.edge,letterSpacing:".09em",
            textTransform:"uppercase",opacity:.85,whiteSpace:"nowrap"}}>
            {FORGE_STAGES[stage]?.label}
          </span>
        </div>
        {/* Stage pips */}
        <div style={{display:"flex",gap:3,alignItems:"center",marginBottom:4}}>
          {FORGE_STAGES.map((_,i)=>{
            const done=i<stage,active=i===stage;
            return <div key={i} style={{height:4,width:active?14:5,borderRadius:3,
              background:active?s.edge:done?s.edge+"55":T.hint+"30",
              transition:"width .45s ease,background .45s ease"}}/>;
          })}
        </div>
        {/* 7-day forge heat strip */}
        {weekHeat && (
          <div style={{display:"flex",gap:4,alignItems:"flex-end",marginBottom:4}}>
            {weekHeat.map(day=>(
              <div key={day.date} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:7,height:7,borderRadius:"50%",
                  background:day.isForge ? s.edge : T.hint+"28",
                  boxShadow:day.isForge ? `0 0 4px ${s.edge}60` : "none"}}/>
                <div style={{fontSize:6,color:day.isForge ? s.edge+"CC" : T.hint+"40",fontWeight:600,lineHeight:1}}>
                  {day.dayLetter}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{fontSize:10,color:T.muted,lineHeight:1}}>
          {statusLine}
        </div>
      </div>

      <div style={{padding:"0 12px 0 2px",fontSize:20,color:T.hint+"80",lineHeight:1,flexShrink:0}}>›</div>
    </button>
  );
}

// ─── ROOT EXPORT ──────────────────────────────────────────────────────────────────

export function ForgeCompanion({ arc, arcLedgerRows, userId, style, coachName = "Coach", coachIcon = "" }) {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();

  // localStorage-persisted item selection per arc
  const storageKey = arc?.id ? `fg_item_${arc.id}` : null;
  const lockKey   = arc?.id ? `fg_item_locked_${arc.id}` : null;

  const [selectedItem, setSelectedItem] = useState(() => {
    if (!arc) return null;
    const saved = storageKey ? localStorage.getItem(storageKey) : null;
    if (saved) {
      const found = getItemPool(arc).find(i => i.id === saved) ?? getDefaultForgeItem(arc);
      return found;
    }
    return getDefaultForgeItem(arc);
  });

  // isLocked = user has made an explicit selection at least once
  const [isLocked, setIsLocked] = useState(() => {
    return lockKey ? !!localStorage.getItem(lockKey) : false;
  });

  // Recompute if arc changes
  useEffect(() => {
    if (!arc) return;
    const saved = storageKey ? localStorage.getItem(storageKey) : null;
    if (saved) {
      const found = getItemPool(arc).find(i=>i.id===saved);
      setSelectedItem(found ?? getDefaultForgeItem(arc));
    } else {
      setSelectedItem(getDefaultForgeItem(arc));
    }
    setIsLocked(lockKey ? !!localStorage.getItem(lockKey) : false);
  }, [arc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = useMemo(
    () => getForgeProgress(arc, arcLedgerRows),
    [arc?.id, arc?.duration_days, arc?.durationDays, arcLedgerRows]
  );

  const history = useMemo(
    () => getRecentForgeHistory(arcLedgerRows, arc),
    [arcLedgerRows, arc?.id]
  );

  // Last 7 calendar days with forge day status for the heat strip
  const weekHeat = useMemo(() => {
    const today = new Date();
    const forgeSet = new Set(
      arcLedgerRows.filter(r => {
        const total = r.proofTotal ?? r.proof_total ?? 0;
        const done  = r.proofDone  ?? r.proof_done  ?? 0;
        return total > 0 && done / total >= 0.5;
      }).map(r => r.date)
    );
    return Array.from({length:7}, (_,i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (6 - i));
      const date = d.toISOString().slice(0,10);
      return { date, dayLetter:"SMTWTFS"[d.getDay()], isForge: forgeSet.has(date) };
    });
  }, [arcLedgerRows, arc?.id]);

  // Derive bandana color from coach icon or fall back to accent red
  // Maps common "warm" icons to gold, "cool" to accent, otherwise accent default
  const bandanaColor = useMemo(() => {
    if (!coachIcon) return "#C04018";
    const goldIcons = ["🔥","⚡","🌟","✨","💎","🎯","☀️","⭐","💫","☄️","🎵","🎸","🏹","🥊","🦾"];
    const blueIcons = ["🌊","🧘","🌿","🔮","🏔️","⛰️","🕊️","⚓"];
    if (goldIcons.includes(coachIcon)) return "#C8902A";
    if (blueIcons.includes(coachIcon)) return "#2980B9";
    return "#C04018";
  }, [coachIcon]);

  function handleSelectItem(item) {
    if (isLocked) return;
    setSelectedItem(item);
    if (storageKey) localStorage.setItem(storageKey, item.id);
    // First explicit selection locks this item to this Arc
    if (lockKey) localStorage.setItem(lockKey, "1");
    setIsLocked(true);
  }

  function handleResetItem() {
    if (storageKey) localStorage.removeItem(storageKey);
    if (lockKey) localStorage.removeItem(lockKey);
    setIsLocked(false);
    setSelectedItem(getDefaultForgeItem(arc));
  }

  if (!arc || !selectedItem) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: CSS}}/>
      <div style={style}>
        <ForgeCard
          item={selectedItem}
          progress={progress}
          onOpen={()=>setExpanded(true)}
          reducedMotion={reducedMotion}
          coachIcon={coachIcon}
          weekHeat={weekHeat}
        />
      </div>
      {expanded && (
        <WorkshopSheet
          arc={arc}
          item={selectedItem}
          progress={{...progress, history}}
          userId={userId}
          onClose={()=>setExpanded(false)}
          onSelectItem={handleSelectItem}
          onResetItem={handleResetItem}
          isLocked={isLocked}
          reducedMotion={reducedMotion}
          coachName={coachName}
          coachIcon={coachIcon}
          bandanaColor={bandanaColor}
        />
      )}
    </>
  );
}
