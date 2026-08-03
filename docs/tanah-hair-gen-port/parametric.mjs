// Parametric SVG hair renderer (always-on offline fallback).
//
// This is the deterministic, no-AI path. Used when:
//   - The Gemini API key is missing or the call fails (429 / 400 / 500).
//   - The CRM wants a fast preview without paying for an AI render.
//   - You want reproducible, byte-identical results for a given seed.
//
// The output is a watermarked composite SVG that overlays a procedural
// hair layer on the bundled sample photo. Quality is significantly lower
// than the Gemini path, but it always works.

import { HAIRLINE_PRESETS, COLOR_PRESETS, LENGTH_PRESETS } from './presets.mjs';

// Demo scalp geometry for the bundled sample-patient.webp (347x280).
// In a real CRM case the photo and geometry would be different; this
// file is the constant fallback.
const DEMO_SCALP = {
  width: 347, height: 280,
  recededHairline: {
    leftTemple: [88, 132],
    center:     [173, 105],
    rightTemple:[258, 132]
  }
};

// Mulberry32 deterministic PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stringSeed(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

// 5-shade color palette per preset (root dark, mid, tip, highlight)
const HAIR_PALETTES = {
  black:     ['#0A0A0A', '#1F1F1F', '#2C2C2C', '#3A3A3A', '#1A1A1A'],
  darkBrown: ['#1A0F08', '#2A1A10', '#3D2817', '#52361F', '#6B4028'],
  mediumBrown:['#3D2415','#5C3A22', '#72492A', '#8B5A35', '#A06D40'],
  lightBrown:['#5C3A1E', '#8B5A2B', '#A06D38', '#B98748', '#CFA05A'],
  blonde:    ['#9A7A35', '#C8A055', '#D8B56A', '#E8C885', '#F2DBA0'],
  saltPepper:['#3F3F3F', '#7A7A7A', '#B0B0B0', '#D5D5D5', '#5A5A5A']
};

function shiftedHairline(preset, density) {
  const forward = { conservative: -8, balanced: 4, restorative: 18, feminine: 6 }[preset.id] || 0;
  const adjust = forward + Math.round(density * 6);
  const d = DEMO_SCALP.recededHairline;
  return {
    leftTemple:  [d.leftTemple[0],  Math.max(40, d.leftTemple[1]  - adjust)],
    center:      [d.center[0],      Math.max(30, d.center[1]      - adjust)],
    rightTemple: [d.rightTemple[0], Math.max(40, d.rightTemple[1] - adjust)]
  };
}

function simulatedZonePath(preset, density, w, h) {
  const hh = shiftedHairline(preset, density);
  const [lx, ly] = hh.leftTemple;
  const [cx, cy] = hh.center;
  const [rx, ry] = hh.rightTemple;
  return `M ${lx} ${ly} C 80 110 78 80 92 50 C 110 22 145 12 ${cx} 12 C 201 12 236 22 254 50 C 268 80 266 110 ${rx} ${ry} L ${rx} ${ry} Q ${cx} ${cy - 6} ${lx} ${ly} Z`;
}

function hairFlow(x, y, h) {
  const cx = 173;
  const vertexX = 173, vertexY = 32;
  const dvh = Math.hypot(x - vertexX, y - vertexY);
  if (dvh < 14) return Math.atan2(y - vertexY, x - vertexX) + Math.PI / 2;
  const dfl = h.center[1] - 4 - y;
  if (dfl > 0 && dfl < 22) return Math.PI / 2 + (x - cx) / 82 * 0.55;
  const radialOut = Math.atan2(y - vertexY, x - vertexX) + Math.PI / 2;
  const forwardDown = Math.PI / 2 + (x - cx) / 82 * 0.4;
  const t = Math.max(0, Math.min(1, dfl / 60));
  return radialOut * (1 - t) + forwardDown * t;
}

function strandPath(x, y, len, dir, rng) {
  const rad = dir;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const tipX = x + dx * len, tipY = y + dy * len;
  const midX = (x + tipX) / 2 + (rng() - 0.5) * 2;
  const midY = (y + tipY) / 2 + (rng() - 0.5) * 2;
  return `M ${x.toFixed(2)} ${y.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${tipX.toFixed(2)} ${tipY.toFixed(2)}`;
}

function renderHair(preset, length, color, density, rng) {
  const len = LENGTH_PRESETS[length] || LENGTH_PRESETS.short;
  const palette = HAIR_PALETTES[color] || HAIR_PALETTES.darkBrown;
  const h = shiftedHairline(preset, density);
  const minX = 88, maxX = 258, maxY = 14, baseY = h.center[1] - 3;
  const total = Math.floor((1400 + density * 1800));
  const baseCount = Math.floor(total * 0.55);
  const bulkCount = Math.floor(total * 0.35);
  const flyCount  = Math.floor(total * 0.10);
  const strands = [];
  const gridN = Math.max(20, Math.round(Math.sqrt(total / 3)));
  const cellW = (maxX - minX) / gridN, cellH = (baseY - maxY) / gridN;
  const follicles = [];
  for (let gy = 0; gy < gridN; gy++) for (let gx = 0; gx < gridN; gx++) {
    const fx = minX + (gx + rng()) * cellW, fy = maxY + (gy + rng()) * cellH;
    if (fy > h.center[1] - 4) continue;
    const nx = (fx - 173) / 82, ny = (fy - 75) / 65;
    if (nx * nx + ny * ny > 1.05) continue;
    follicles.push([fx, fy]);
  }
  function jitterPos(bx, by, sp) { const r = rng() * sp, a = rng() * Math.PI * 2; return [bx + Math.cos(a) * r, by + Math.sin(a) * r]; }
  for (let i = 0; i < baseCount; i++) {
    const f = follicles[Math.floor(rng() * follicles.length)]; if (!f) break;
    const [bx, by] = jitterPos(f[0], f[1], 1.8);
    if (by > h.center[1] - 4) continue;
    const dir = hairFlow(bx, by, h) + (rng() - 0.5) * 0.9;
    const thisLen = len.px * (0.18 + rng() * 0.35) * (347 / 720);
    const path = strandPath(bx, by, thisLen, dir, rng);
    const sw = 0.30 + rng() * 0.20, op = 0.25 + rng() * 0.30;
    const c = palette[Math.floor(rng() * palette.length)];
    strands.push(`<path d="${path}" stroke="${c}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" fill="none" opacity="${op.toFixed(2)}"/>`);
  }
  for (let i = 0; i < bulkCount; i++) {
    const f = follicles[Math.floor(rng() * follicles.length)]; if (!f) break;
    const cluster = 1 + Math.floor(rng() * 2);
    for (let c = 0; c < cluster; c++) {
      const [bx, by] = jitterPos(f[0], f[1], 1.4);
      if (by > h.center[1] - 4) continue;
      const dir = hairFlow(bx, by, h) + (rng() - 0.5) * 0.85;
      const thisLen = len.px * (0.45 + rng() * 0.45) * (347 / 720);
      const path = strandPath(bx, by, thisLen, dir, rng);
      const sw = 0.35 + rng() * 0.25, op = 0.5 + rng() * 0.40;
      const cIdx = Math.floor(rng() * palette.length);
      strands.push(`<path d="${path}" stroke="${palette[cIdx]}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" fill="none" opacity="${op.toFixed(2)}"/>`);
    }
  }
  for (let i = 0; i < flyCount; i++) {
    const f = follicles[Math.floor(rng() * follicles.length)]; if (!f) break;
    const [bx, by] = jitterPos(f[0], f[1], 5);
    if (by > h.center[1] + 4) continue;
    const dir = hairFlow(bx, by, h) + (rng() - 0.5) * 0.9;
    const thisLen = len.px * (0.8 + rng() * 0.5) * (347 / 720);
    const path = strandPath(bx, by, thisLen, dir, rng);
    const sw = 0.20 + rng() * 0.18, op = 0.4 + rng() * 0.40;
    const cIdx = Math.floor(rng() * palette.length);
    strands.push(`<path d="${path}" stroke="${palette[cIdx]}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" fill="none" opacity="${op.toFixed(2)}"/>`);
  }
  return strands.join('');
}

export function renderParametricSvg({ params, photoBase64, photoMime = 'image/webp', seed }) {
  const safeParams = {
    hairline: HAIRLINE_PRESETS[params.hairline] ? params.hairline : 'balanced',
    length: LENGTH_PRESETS[params.length] ? params.length : 'short',
    color: COLOR_PRESETS[params.color] ? params.color : 'darkBrown',
    density: Math.max(0, Math.min(1, Number(params.density) || 0.65))
  };
  const preset = HAIRLINE_PRESETS[safeParams.hairline];
  const seedKey = `${safeParams.hairline}-${safeParams.length}-${safeParams.color}-${safeParams.density}`;
  const rng = mulberry32((seed !== undefined ? seed : stringSeed(seedKey)) >>> 0);
  const w = DEMO_SCALP.width, h = DEMO_SCALP.height;
  const zone = simulatedZonePath(preset, safeParams.density, w, h);
  const hair = renderHair(preset, safeParams.length, safeParams.color, safeParams.density, rng);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <clipPath id="zoneClip"><path d="${zone}"/></clipPath>
    <filter id="hairSoft" x="-3%" y="-3%" width="106%" height="106%"><feGaussianBlur stdDeviation="0.30"/></filter>
  </defs>
  ${photoBase64 ? `<image href="data:${photoMime};base64,${photoBase64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>` : ''}
  <path d="${zone}" fill="#000" opacity="0.04" clip-path="url(#zoneClip)"/>
  <g clip-path="url(#zoneClip)" filter="url(#hairSoft)">${hair}</g>
</svg>`;
}
