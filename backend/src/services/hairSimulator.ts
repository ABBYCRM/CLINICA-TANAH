// @ts-nocheck
// TANAH-HAIR parametric hair-transplant simulator.
// Pure SVG generator — no external API, always works.
// Output: a watermarked composite SVG of a stylized avatar with
// procedurally rendered hair based on the clinician's parameters.

import { randomBytes } from 'crypto';

/** @ts-nocheck — ported verbatim from TANAH-HAIR apps/api/src/simulator.mjs */
function randomId(bytes = 12) {
  return randomBytes(bytes).toString('hex');
}

// ---------- Mulberry32 deterministic PRNG ----------
// (so a given seed + params always yields the same hair pattern)
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

function stringSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

// ---------- Preset catalog ----------

export const HAIRLINE_PRESETS = {
  conservative: {
    id: 'conservative',
    label: 'Mature conservative',
    description: 'Slightly receded temples, no widow\'s peak. Respects age.',
    frontEdge: { cx: 360, cy: 232, rx: 138, ry: 28, peak: -6 }
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced natural',
    description: 'Soft central curve with mild temple recession.',
    frontEdge: { cx: 360, cy: 246, rx: 152, ry: 30, peak: -14 }
  },
  restorative: {
    id: 'restorative',
    label: 'Restorative youthful',
    description: 'Lower, even hairline. Higher graft count; reserved for stable loss.',
    frontEdge: { cx: 360, cy: 262, rx: 168, ry: 32, peak: -20 }
  },
  feminine: {
    id: 'feminine',
    label: 'Feminine rounded',
    description: 'Rounded front with central peak, low temple recession.',
    frontEdge: { cx: 360, cy: 254, rx: 158, ry: 36, peak: -28 }
  }
};

export const COVERAGE_ZONES = {
  frontal: { id: 'frontal', label: 'Frontal band', grafts: 1800, ring: [1, 0, 0, 0] },
  midscalp: { id: 'midscalp', label: 'Frontal + midscalp', grafts: 2600, ring: [1, 1, 0, 0] },
  crown: { id: 'crown', label: 'Frontal + crown', grafts: 2800, ring: [1, 0, 0, 1] },
  full: { id: 'full', label: 'Full scalp', grafts: 3400, ring: [1, 1, 1, 1] },
  temples: { id: 'temples', label: 'Temples + frontal', grafts: 1500, ring: [1, 0.4, 0, 0] }
};

export const HAIR_COLORS = {
  black: { id: 'black', label: 'Black', stroke: '#1A1A1A', root: '#2A2A2A' },
  darkBrown: { id: 'darkBrown', label: 'Dark brown', stroke: '#3D2817', root: '#52361F' },
  mediumBrown: { id: 'mediumBrown', label: 'Medium brown', stroke: '#5C3A22', root: '#72492A' },
  lightBrown: { id: 'lightBrown', label: 'Light brown', stroke: '#8B5A2B', root: '#A06D38' },
  blonde: { id: 'blonde', label: 'Blonde', stroke: '#C8A055', root: '#D8B56A' },
  saltPepper: { id: 'saltPepper', label: 'Salt & pepper', stroke: '#666', root: '#888' }
};

export const HAIR_LENGTHS = {
  buzz: { id: 'buzz', label: 'Buzz (3 mm)', px: 6 },
  short: { id: 'short', label: 'Short (15 mm)', px: 18 },
  medium: { id: 'medium', label: 'Medium (40 mm)', px: 42 },
  long: { id: 'long', label: 'Long (80 mm)', px: 76 }
};

export const SKIN_TONES = {
  light: { id: 'light', base: '#E8C9A8', shade: '#C8A884', blush: '#E5A38A', lip: '#B97A5E' },
  medium: { id: 'medium', base: '#C99A75', shade: '#A87852', blush: '#C77E5A', lip: '#94553C' },
  deep: { id: 'deep', base: '#8A5A3B', shade: '#6B4028', blush: '#9C5A45', lip: '#6B3528' }
};

// ---------- New spec-aligned presets (HairPath §3 visual) ----------

export const TECHNIQUE_PRESETS = {
  fue: { id: 'fue', label: 'FUE (Follicular Unit Extraction)', note: 'No linear scar; scattered punch extractions.' },
  fut: { id: 'fut', label: 'FUT (Strip)', note: 'Linear donor scar; higher single-session yield.' },
  dhi: { id: 'dhi', label: 'DHI (Direct Hair Implantation)', note: 'Implanter pen; higher density per cm².' }
};

export const SESSION_PRESETS = {
  single: { id: 'single', label: 'Single session', note: 'One procedure, typical cap by zone.' },
  multi:  { id: 'multi',  label: 'Multi-session', note: 'Two or more sessions; staged for max density.' }
};

export const CURL_PRESETS = {
  straight: { id: 'straight', label: 'Straight',  curl: 0, wave: 0 },
  slight:   { id: 'slight',   label: 'Slight wave', curl: 0.15, wave: 0.4 },
  wavy:     { id: 'wavy',     label: 'Wavy',      curl: 0.3,  wave: 0.8 },
  curly:    { id: 'curly',    label: 'Curly / coily', curl: 0.55, wave: 1.4 }
};

export const FULLNESS_PRESETS = {
  conservative: { id: 'conservative', label: 'Conservative', densityMul: 0.6,  note: 'Mature restraint.' },
  moderate:     { id: 'moderate',     label: 'Moderate',     densityMul: 0.8,  note: 'Most common in clinic.' },
  fuller:       { id: 'fuller',       label: 'Fuller density', densityMul: 1.0,  note: 'Higher graft count per cm².' }
};

export const GRAFT_SCENARIOS = {
  light:     { id: 'light',     label: 'Light',     range: '1,200 - 1,800', session: 'Single' },
  moderate:  { id: 'moderate',  label: 'Moderate',  range: '1,800 - 2,500', session: 'Single' },
  restorative: { id: 'restorative', label: 'Restorative', range: '2,500 - 3,400', session: 'Single' },
  extensive: { id: 'extensive', label: 'Extensive (multi-session)', range: '3,400 - 5,000+', session: 'Multi' }
};

// ---------- 6-view catalog ----------
// The bundled demo has only the FRONT view. The other 5 view slots are
// reserved for real cases where the patient (or the intake assistant)
// has uploaded the full set. The framework is the same; only the
// base asset differs.
export const VIEW_CATALOG = [
  { id: 'front',  label: 'Frontal',        description: 'Standardized front view, neutral expression.' },
  { id: 'left',   label: 'Left lateral',   description: 'Profile from the patient\'s left side.' },
  { id: 'right',  label: 'Right lateral',  description: 'Profile from the patient\'s right side.' },
  { id: 'top',    label: 'Top (vertex)',   description: 'Top-down view of the crown and midscalp.' },
  { id: 'crown',  label: 'Crown (donor)',  description: 'Donor-area reference at the back of the head.' },
  { id: 'back',   label: 'Posterior',      description: 'Back-of-head reference for donor density.' }
];

export const BUNDLED_DEMO = {
  id: 'demo-001',
  description: 'Synthetic demo patient (Shutterstock-licensed stock). No real patient data.',
  attribution: 'stock sample · 238551875',
  views: {
    front: { assetId: 'sample-patient', width: 347, height: 280, available: true }
    // Other views intentionally left undefined for the bundled demo.
    // A real case will populate these from uploaded patient photos.
  }
};

export function getAvailableViews(patient = BUNDLED_DEMO) {
  return VIEW_CATALOG.map(v => ({
    ...v,
    available: Boolean(patient.views && patient.views[v.id])
  }));
}

// ---------- Geometry ----------

// The head is a 720x720 canvas. Face is in the lower half. Scalp is in the
// upper half. All coordinates are in user space (no scaling needed).

const CANVAS = { w: 720, h: 720 };

// Head outline (front view, slightly elongated). Symmetric around x=360.
function headOutlinePath() {
  return "M 360 70 \
    C 460 70 540 130 555 220 \
    C 565 290 555 350 555 410 \
    C 555 470 540 530 510 575 \
    C 480 615 430 645 360 660 \
    C 290 645 240 615 210 575 \
    C 180 530 165 470 165 410 \
    C 165 350 155 290 165 220 \
    C 180 130 260 70 360 70 Z";
}

// Scalp area — everything above the hairline. Defined as a closed path that
// follows the head outline on the sides/top and the hairline shape at the bottom.
function scalpPath(preset, zone) {
  const fe = preset.frontEdge;
  // The hairline front edge is an ellipse-like curve at (cx,cy) with rx,ry, peak.
  // We trace: from left temple, along the upper head outline, to right temple,
  // then back along the hairline.
  return "M 175 245 \
    C 175 130 260 80 360 80 \
    C 460 80 545 130 545 245 \
    C 520 " + (fe.cy + 4) + " \
    Q " + (fe.cx) + " " + (fe.cy - fe.ry + fe.peak) + " " + (fe.cx - fe.rx) + " " + (fe.cy + 8) + " \
    Q " + (fe.cx) + " " + (fe.cy + 6) + " " + (fe.cx + fe.rx) + " " + (fe.cy + 8) + " \
    C 540 250 200 250 175 245 Z";
}

// ---------- Avatar (neutral, gender-neutral) ----------

function avatarSvg(skinTone) {
  const s = SKIN_TONES[skinTone] || SKIN_TONES.light;
  return `<!-- face base -->
  <path d="${headOutlinePath()}" fill="${s.base}" />
  <!-- subtle shading on sides -->
  <path d="M 200 230 C 190 320 195 420 220 510 C 230 480 215 380 220 280 Z" fill="${s.shade}" opacity="0.45" />
  <path d="M 520 230 C 530 320 525 420 500 510 C 490 480 505 380 500 280 Z" fill="${s.shade}" opacity="0.45" />
  <!-- cheek blush -->
  <ellipse cx="245" cy="430" rx="32" ry="18" fill="${s.blush}" opacity="0.18" />
  <ellipse cx="475" cy="430" rx="32" ry="18" fill="${s.blush}" opacity="0.18" />
  <!-- ears -->
  <path d="M 170 360 C 158 358 152 380 158 410 C 162 430 170 438 178 432 Z" fill="${s.base}" />
  <path d="M 165 385 C 161 395 163 408 168 418 C 168 408 167 396 168 388 Z" fill="${s.shade}" opacity="0.5" />
  <path d="M 550 360 C 562 358 568 380 562 410 C 558 430 550 438 542 432 Z" fill="${s.base}" />
  <path d="M 555 385 C 559 395 557 408 552 418 C 552 408 553 396 552 388 Z" fill="${s.shade}" opacity="0.5" />
  <!-- eyebrows (will be covered by hair if dense) -->
  <path d="M 268 348 Q 305 340 345 348" stroke="#3a2a20" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.85" />
  <path d="M 375 348 Q 415 340 452 348" stroke="#3a2a20" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.85" />
  <!-- eyes (closed-soft, neutral expression) -->
  <path d="M 275 395 Q 305 388 335 395" stroke="#2a1a14" stroke-width="2" fill="none" stroke-linecap="round" />
  <path d="M 385 395 Q 415 388 445 395" stroke="#2a1a14" stroke-width="2" fill="none" stroke-linecap="round" />
  <ellipse cx="305" cy="395" rx="3" ry="1.5" fill="#1a0e08" opacity="0.6" />
  <ellipse cx="415" cy="395" rx="3" ry="1.5" fill="#1a0e08" opacity="0.6" />
  <!-- nose -->
  <path d="M 350 410 C 348 440 345 465 355 480 C 360 488 370 488 375 480 C 385 465 380 440 378 410" fill="${s.shade}" opacity="0.35" />
  <path d="M 355 480 Q 360 484 365 480" stroke="${s.shade}" stroke-width="1.2" fill="none" />
  <!-- nostrils hint -->
  <ellipse cx="354" cy="478" rx="2" ry="1.5" fill="${s.shade}" opacity="0.55" />
  <ellipse cx="366" cy="478" rx="2" ry="1.5" fill="${s.shade}" opacity="0.55" />
  <!-- mouth (neutral, slight smile) -->
  <path d="M 325 535 Q 360 545 395 535" stroke="${s.lip}" stroke-width="2.2" fill="none" stroke-linecap="round" />
  <path d="M 330 535 Q 360 542 390 535" fill="${s.lip}" opacity="0.45" />
  <!-- jaw shadow -->
  <path d="M 245 540 C 260 595 310 645 360 660 C 410 645 460 595 475 540" stroke="${s.shade}" stroke-width="0" fill="${s.shade}" opacity="0.18" />
  <!-- neck -->
  <path d="M 310 650 L 310 720 L 410 720 L 410 650 C 380 670 340 670 310 650 Z" fill="${s.base}" />
  <path d="M 310 650 C 340 668 380 668 410 650" stroke="${s.shade}" stroke-width="1" fill="${s.shade}" opacity="0.25" />`;
}

// ---------- Hair renderer ----------

// Generate a single hair strand as an SVG path. Direction is from the root
// outward, with a slight S-curve for naturalness.
function hairPath(x, y, angleDeg, length, jitter) {
  const rad = (angleDeg - 90) * Math.PI / 180; // 0deg = down
  const tipX = x + Math.cos(rad) * length;
  const tipY = y + Math.sin(rad) * length;
  // Control points for a slight S-curve
  const midX = (x + tipX) / 2 + (jitter - 0.5) * 3;
  const midY = (y + tipY) / 2 + (jitter - 0.5) * 3;
  return `M ${x.toFixed(2)} ${y.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${tipX.toFixed(2)} ${tipY.toFixed(2)}`;
}

// Sample points within a region using a simple stratified grid with jitter.
// Returns a function that yields (x, y) for each hair root.
function* sampleScalpPoints(preset, zone, density, rng) {
  const fe = preset.frontEdge;
  // Scalp bounding box (front view).
  const minX = 178;
  const maxX = 542;
  const baseY = fe.cy + 6; // start just behind the hairline
  const maxY = 80;        // top of scalp

  // Density 0-1 → grid resolution (higher density = more points).
  // We compute total point count first.
  const targetCount = Math.floor(180 + density * 1820); // 180-2000
  // Compute grid size based on target count.
  const gridN = Math.max(6, Math.round(Math.sqrt(targetCount * 1.6)));
  const cellW = (maxX - minX) / gridN;
  const cellH = (baseY - maxY) / gridN;

  // Sample one point per cell with rejection sampling.
  for (let gy = 0; gy < gridN; gy++) {
    for (let gx = 0; gx < gridN; gx++) {
      const x = minX + (gx + rng()) * cellW;
      const y = maxY + (gy + rng()) * cellH;
      // Reject if in the temple recess.
      const fe2 = preset.frontEdge;
      const templeX = (x < 220 || x > 500) && y > fe2.cy - 30;
      if (templeX && rng() < 0.45) continue;
      // For coverage zones, reject based on Y position.
      if (zone === 'frontal' && y > 200) continue;
      if (zone === 'midscalp' && (y < 130 || y > 250)) continue;
      if (zone === 'crown' && y > 170) continue;
      if (zone === 'temples' && !(x < 240 || x > 480)) continue;
      yield [x, y];
    }
  }
}

// Render all hair strands for a given configuration.
function renderHair({ preset, zone, density, length, color, seed, rng }) {
  const len = HAIR_LENGTHS[length] || HAIR_LENGTHS.short;
  const col = HAIR_COLORS[color] || HAIR_COLORS.darkBrown;
  const strands = [];
  let count = 0;

  for (const [x, y] of sampleScalpPoints(preset, zone, density, rng)) {
    // Angle depends on position: at hairline, hair grows forward/down;
    // at crown, hair grows outward radially.
    const cx = 360, cy = 80;
    const dx = x - cx;
    const dy = y - cy;
    let angle;
    if (Math.abs(dx) > Math.abs(dy)) {
      // Side: hair grows outward
      angle = dx > 0 ? 30 : 150;
      // Add a small forward tilt
      angle += dx > 0 ? -10 : 10;
    } else {
      // Top: hair grows mostly down/forward
      angle = 95 + (rng() - 0.5) * 30;
    }
    // Hairline edge hairs lean forward more
    if (y > 220) angle = 110 + (rng() - 0.5) * 25;
    // Hair near temples leans outward
    if (x < 200) angle = 50 + (rng() - 0.5) * 20;
    if (x > 520) angle = 130 + (rng() - 0.5) * 20;
    // Add jitter
    angle += (rng() - 0.5) * 12;
    const thisLen = len.px * (0.85 + rng() * 0.35);
    const path = hairPath(x, y, angle, thisLen, rng());
    // Two-tone stroke: base + a darker root
    const opacity = 0.55 + rng() * 0.35;
    const strokeW = 0.6 + rng() * 0.5;
    strands.push(`<path d="${path}" stroke="${col.stroke}" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round" fill="none" opacity="${opacity.toFixed(2)}"/>`);
    count++;
    if (count > 2400) break; // safety cap
  }
  return strands.join('');
}

// ---------- Watermark ----------

function watermark(label) {
  return `<rect x="0" y="660" width="720" height="60" fill="#0F172A" fill-opacity="0.92" />
    <text x="360" y="687" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="700" fill="#fff" letter-spacing="1.2">HYPOTHETICAL VISUALIZATION</text>
    <text x="360" y="704" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#5EEAD4" letter-spacing="0.6">NOT A PREDICTION OR GUARANTEE OF RESULTS · TANAH-HAIR</text>`;
}

// ---------- Main render ----------

export function renderSimulation({
  hairline = 'balanced',
  zone = 'full',
  density = 0.55,
  length = 'short',
  color = 'darkBrown',
  skinTone = 'medium',
  seed,
  label
} = {}) {
  const preset = HAIRLINE_PRESETS[hairline] || HAIRLINE_PRESETS.balanced;
  const rng = mulberry32((seed !== undefined ? seed : stringSeed(`${hairline}-${zone}-${density}-${length}-${color}-${skinTone}`)) >>> 0);
  const id = randomId();
  const createdAt = new Date().toISOString();
  const grafts = COVERAGE_ZONES[zone]?.grafts || 2000;

  const hair = renderHair({
    preset, zone, density,
    length: HAIR_LENGTHS[length] ? length : 'short',
    color: HAIR_COLORS[color] ? color : 'darkBrown',
    seed, rng
  });

  const wm = label || 'HYPOTHETICAL VISUALIZATION - NOT A PREDICTION OR GUARANTEE OF RESULTS';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" width="720" height="720">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#F4F0E8"/>
      <stop offset="100%" stop-color="#D7CFBF"/>
    </radialGradient>
    <clipPath id="scalpClip">
      <path d="${scalpPath(preset, zone)}"/>
    </clipPath>
  </defs>
  <rect width="720" height="720" fill="url(#bg)"/>
  <!-- capture frame (matte black) -->
  <rect x="20" y="20" width="680" height="680" fill="none" stroke="#0A0A0C" stroke-width="3" rx="4"/>
  <!-- horizon line (capture alignment) -->
  <line x1="60" y1="380" x2="660" y2="380" stroke="#0D9488" stroke-width="0.5" stroke-dasharray="2 4" opacity="0.4"/>
  <!-- avatar -->
  ${avatarSvg(skinTone)}
  <!-- hair: rendered inside the scalp clip -->
  <g clip-path="url(#scalpClip)">
    ${hair}
  </g>
  <!-- hairline drawn explicitly on top of the avatar's forehead so the
       boundary is visible regardless of clip precision -->
  <path d="M ${preset.frontEdge.cx - preset.frontEdge.rx} ${preset.frontEdge.cy + 8} \
           Q ${preset.frontEdge.cx} ${preset.frontEdge.cy - preset.frontEdge.ry + preset.frontEdge.peak} \
             ${preset.frontEdge.cx + preset.frontEdge.rx} ${preset.frontEdge.cy + 8}" \
        fill="none" stroke="${(HAIR_COLORS[color] || HAIR_COLORS.darkBrown).stroke}" stroke-width="1" opacity="0.7"/>
  <!-- watermark -->
  ${watermark(wm)}
</svg>`;

  return {
    id,
    createdAt,
    svg,
    outputDataUrl: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
    width: 720,
    height: 720,
    hairline: preset.id,
    zone,
    density,
    length,
    color,
    skinTone,
    grafts,
    seed: seed !== undefined ? seed : stringSeed(`${hairline}-${zone}-${density}-${length}-${color}-${skinTone}`),
    label: wm
  };
}

/**
 * Render N alternative looks for the same base configuration. Used by the
 * front-end to show a variant gallery (conservative / balanced / restorative).
 */
export function renderVariants({
  hairline = 'balanced',
  zone = 'full',
  density = 0.55,
  length = 'short',
  color = 'darkBrown',
  skinTone = 'medium',
  variants = ['conservative', 'balanced', 'restorative']
} = {}) {
  return variants.map(v => renderSimulation({
    hairline: v, zone, density, length, color, skinTone
  }));
}

// ============================================================================
// PHOTO-BASED SIMULATOR
// ----------------------------------------------------------------------------
// Takes a real photograph and overlays procedural hair on the bald area. This
// is the "what-if" mode used by every commercial hair-transplant simulator —
// the photo provides the patient's actual head/face; the overlay provides the
// hypothetical restored hairline. The result is a single self-contained SVG.
//
// All coordinates are relative to the photo's pixel space; the front-end can
// scale by adjusting the rendered <svg> width/height.
// ============================================================================

/**
 * Scalp area in the bundled demo photo (Shutterstock-style balding male, top
 * of head visible). Coordinates are calibrated for a 347x280 image. The
 * "current" receded hairline traces an M shape with receded temples; the
 * simulated hairline is drawn forward of that boundary inside the bald area.
 */
const DEMO_SCALP = {
  width: 347,
  height: 280,
  // Outline of the entire scalp/hair-bearing region (above the receded
  // hairline, around the top of the head, and back to the right temple).
  outline: "M 88 132 \
    C 80 110 78 80 92 50 \
    C 110 22 145 12 173 12 \
    C 201 12 236 22 254 50 \
    C 268 80 266 110 258 132 \
    Q 245 124 230 120 \
    Q 215 116 200 120 \
    Q 188 124 173 124 \
    Q 158 124 146 120 \
    Q 131 116 116 120 \
    Q 101 124 88 132 Z",
  // The current receded hairline (existing bald boundary) in the demo photo.
  recededHairline: { leftTemple: [88, 132], center: [173, 105], rightTemple: [258, 132] }
};

/**
 * Adjusts the hairline forward of the receded edge by the preset amount.
 * Returns 3 points (left-temple, center, right-temple) for the new hairline.
 */
function shiftedHairline(preset, density) {
  // density also nudges the hairline slightly forward at higher density
  const forward = { conservative: -8, balanced: 4, restorative: 18, feminine: 6 }[preset.id] || 0;
  const adjust = forward + Math.round(density * 6);
  const d = DEMO_SCALP.recededHairline;
  return {
    leftTemple: [d.leftTemple[0], Math.max(40, d.leftTemple[1] - adjust)],
    center:     [d.center[0],     Math.max(30, d.center[1] - adjust)],
    rightTemple:[d.rightTemple[0],Math.max(40, d.rightTemple[1] - adjust)]
  };
}

/**
 * Generates the "simulated hair zone" path: the bald area minus the area in
 * front of the new hairline. Hair will be drawn only inside this region.
 */
function simulatedZonePath(preset, density) {
  const h = shiftedHairline(preset, density);
  const [lx, ly] = h.leftTemple;
  const [cx, cy] = h.center;
  const [rx, ry] = h.rightTemple;
  // Close the zone by following the existing scalp outline on the sides/top
  // and the new hairline across the bottom.
  return "M " + lx + " " + ly + " \
    C 80 110 78 80 92 50 \
    C 110 22 145 12 173 12 \
    C 201 12 236 22 254 50 \
    C 268 80 266 110 258 132 \
    L " + rx + " " + ry + " \
    Q " + cx + " " + (cy - 6) + " " + lx + " " + ly + " Z";
}

// ---------- High-quality photo-based hair rendering ----------
//
// Strategy for realistic hair on a 347x280 photo:
//   1. Color palette: 4 shades of the chosen color (root dark, mid, tip
//      lighter, highlight) — every strand picks one, so the overall mass
//      looks like multi-tone natural hair, not a flat block of color.
//   2. Layered passes:
//        base     — short, dense, low-opacity undercoat (creates depth)
//        bulk     — full-length strands forming the visual mass
//        flyaways — few long fine strands on top (the "wispy" texture)
//   3. Follicle clustering: strands come in groups of 1-4 with a small
//      angular spread, like natural follicular units.
//   4. Directional flow: each point in the scalp gets a primary direction
//      from a flow field (forward at the hairline, radial whorl at the
//      vertex, backward at the midscalp, outward at the temples) plus
//      per-strand noise.
//   5. Soft edge: a Gaussian-blur filter + strands that extend ~2px past
//      the clip path so the hair boundary is wispy, not a hard line.
//   6. Tapered tips: a subtle gradient per strand (slightly thinner at
//      the tip than the root) via the path stroke shape.
//
// The result is 2500-4500 small SVG paths per render. Browsers handle
// this in ~50ms.

const HAIR_PALETTES = {
  black:       ['#0A0A0A', '#1F1F1F', '#2C2C2C', '#3A3A3A', '#1A1A1A'],
  darkBrown:   ['#1A0F08', '#2A1A10', '#3D2817', '#52361F', '#6B4028'],
  mediumBrown: ['#3D2415', '#5C3A22', '#72492A', '#8B5A35', '#A06D40'],
  lightBrown:  ['#5C3A1E', '#8B5A2B', '#A06D38', '#B98748', '#CFA05A'],
  blonde:      ['#9A7A35', '#C8A055', '#D8B56A', '#E8C885', '#F2DBA0'],
  saltPepper:  ['#3F3F3F', '#7A7A7A', '#B0B0B0', '#D5D5D5', '#5A5A5A']
};

function colorPalette(color) {
  return HAIR_PALETTES[color] || HAIR_PALETTES.darkBrown;
}

// Directional flow field: returns the primary hair direction (radians) at
// a given (x, y) on the 347x280 photo canvas. Real hair doesn't follow a
// clean flow field — every strand points slightly differently. We return
// a soft average direction and rely on per-strand noise (added in the
// pass loops) to provide the natural variation. The whorl is also kept
// very subtle so the hair doesn't look like a combed spiral.
function hairFlow(x, y, h, zone) {
  const cx = 173;
  const vertexX = 173, vertexY = 32;

  // Distance from the vertex
  const dvx = x - vertexX, dvy = y - vertexY;
  const distFromVertex = Math.sqrt(dvx * dvx + dvy * dvy);

  // VERY subtle whorl at the vertex — small effect, no perfect spiral.
  // We just bias the direction tangentially by a small amount.
  if (distFromVertex < 14) {
    const ang = Math.atan2(dvy, dvx);
    return ang + Math.PI / 2;  // pure tangent, small effect
  }

  // Front hairline zone: hair sweeps forward and down (towards the
  // forehead), with a slight outward angle at the temples.
  const distFromHairline = h.center[1] - 4 - y;
  if (distFromHairline > 0 && distFromHairline < 22) {
    const xBias = (x - cx) / 82;  // -1 (left) to +1 (right)
    return Math.PI / 2 + xBias * 0.55 + (distFromHairline / 22) * 0.3;
  }

  // Mid-scalp: blend radial-outward with forward-down for a natural
  // comb-over pattern.
  const radialOut = Math.atan2(y - vertexY, x - vertexX) + Math.PI / 2;
  const forwardDown = Math.PI / 2 + (x - cx) / 82 * 0.4;
  const t = Math.max(0, Math.min(1, distFromHairline / 60));
  return radialOut * (1 - t) + forwardDown * t;
}

function isInsideScalp(x, y) {
  const nx = (x - 173) / 82;
  const ny = (y - 75) / 65;
  return nx * nx + ny * ny <= 1.0;
}

function isInsideZone(x, y, h) {
  if (y > h.center[1] - 4) return false;  // in front of new hairline
  return isInsideScalp(x, y);
}

// Generate a single tapered strand as a filled quad (a thin "leaf" shape
// with the root slightly wider than the tip). This is how real hair-
// rendering tools do it: a filled polygon per strand rather than a
// stroked line, so the strand has actual width and tapers naturally.
function strandPath(x, y, len, dir, curl, wave, jitter, rootW = 0.45, tipW = 0.12) {
  const rad = dir;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const tipX = x + dx * len;
  const tipY = y + dy * len;
  const perpX = -dy, perpY = dx;

  // Curve control points — pull perpendicular by `curl` for natural bend.
  const curlAmt = curl * (0.5 + jitter * 0.5);
  const waveAmt = (jitter - 0.5) * wave;
  const c1x = x + dx * len * 0.33 + perpX * curlAmt * len * 0.4;
  const c1y = y + dy * len * 0.33 + perpY * curlAmt * len * 0.4;
  const c2x = x + dx * len * 0.66 + perpX * curlAmt * len * 0.8 + waveAmt;
  const c2y = y + dy * len * 0.66 + perpY * curlAmt * len * 0.8 + waveAmt;

  // Sample the cubic at t=0 (root) and t=1 (tip) to compute the
  // perpendicular direction at each end, so the quad's left/right edges
  // follow the curve.
  const rootDX = 3 * (c1x - x),         rootDY = 3 * (c1y - y);
  const tipDX  = 3 * (tipX - c2x),      tipDY  = 3 * (tipY - c2y);
  const rootAng = Math.atan2(rootDY, rootDX);
  const tipAng  = Math.atan2(tipDY,  tipDX);
  const rootPerpX = -Math.sin(rootAng), rootPerpY = Math.cos(rootAng);
  const tipPerpX  = -Math.sin(tipAng),  tipPerpY  = Math.cos(tipAng);

  // Quad: root-left, tip-left, tip-right, root-right
  const rlX = x + rootPerpX * rootW, rlY = y + rootPerpY * rootW;
  const rrX = x - rootPerpX * rootW, rrY = y - rootPerpY * rootW;
  const tlX = tipX + tipPerpX * tipW, tlY = tipY + tipPerpY * tipW;
  const trX = tipX - tipPerpX * tipW, trY = tipY - tipPerpY * tipW;

  return `M ${rlX.toFixed(2)} ${rlY.toFixed(2)} Q ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${tlX.toFixed(2)} ${tlY.toFixed(2)} L ${trX.toFixed(2)} ${trY.toFixed(2)} Q ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${rrX.toFixed(2)} ${rrY.toFixed(2)} Z`;
}

function renderPhotoHair(preset, zone, density, length, color, rng, opts = {}) {
  const len = HAIR_LENGTHS[length] || HAIR_LENGTHS.short;
  const curl = (opts.curl && opts.curl.curl) || 0;
  const wave = (opts.curl && opts.curl.wave) || 0;
  const densityMul = (opts.fullness && opts.fullness.densityMul) || 1.0;
  const palette = colorPalette(color);
  const h = shiftedHairline(preset, density);

  // Photo canvas: 347x280
  // Scalp occupies the rounded area centered at (173, 75), rx=82, ry=65
  const minX = 88, maxX = 258;
  const maxY = 14;
  const baseY = h.center[1] - 3;  // just behind the new hairline

  // Total strand target. Filled quads blend more than strokes so we can
  // use fewer (~3500 at full). Tuned for visible-but-not-drawn look.
  const total = Math.floor((2400 + density * 1800) * densityMul);
  const baseCount  = Math.floor(total * 0.50);  // undercoat
  const bulkCount  = Math.floor(total * 0.40);  // bulk
  const flyCount   = Math.floor(total * 0.10);  // flyaways

  const strands = [];
  const baseFillColor = palette[2];  // mid-tone for the base fill

  // Helper: jitter a position by a small radius (follicle spread)
  function jitterPos(baseX, baseY, spread) {
    const r = rng() * spread;
    const a = rng() * Math.PI * 2;
    return [baseX + Math.cos(a) * r, baseY + Math.sin(a) * r];
  }

  // Distance from the new hairline — used for density falloff so the
  // front edge is sparser than the interior.
  function distFromHairline(y) {
    return Math.max(0, h.center[1] - 4 - y);
  }

  // Probability gate based on distance from hairline: strands near the
  // hairline are sparser (the "feathered" edge), strands further back are
  // denser.
  function densityGate(y) {
    const d = distFromHairline(y);
    if (d < 3) return rng() * 0.25 + 0.05;     // very sparse at the edge
    if (d < 8) return rng() * 0.5 + 0.25;      // sparser
    if (d < 18) return rng() * 0.4 + 0.55;     // normal
    return 1.0;                                 // full density further back
  }

  // Generate follicle centers: a grid in the scalp region, then jitter.
  const gridDensity = Math.max(20, Math.round(Math.sqrt(total / 3)));
  const cellW = (maxX - minX) / gridDensity;
  const cellH = (baseY - maxY) / gridDensity;
  const follicles = [];
  for (let gy = 0; gy < gridDensity; gy++) {
    for (let gx = 0; gx < gridDensity; gx++) {
      const fx = minX + (gx + rng()) * cellW;
      const fy = maxY + (gy + rng()) * cellH;
      if (!isInsideZone(fx, fy, h)) continue;
      // Skip ~50% of follicles in the first 4px from the hairline
      if (distFromHairline(fy) < 4 && rng() > 0.4) continue;
      follicles.push([fx, fy]);
    }
  }

  // ---- Pass 1: base undercoat (short, dense, low opacity) ----
  for (let i = 0; i < baseCount; i++) {
    const f = follicles[Math.floor(rng() * follicles.length)];
    if (!f) break;
    const [bx, by] = jitterPos(f[0], f[1], 1.8);
    if (!isInsideZone(bx, by, h)) continue;
    if (rng() > densityGate(by)) continue;
    const dir = hairFlow(bx, by, h, zone) + (rng() - 0.5) * 0.9;
    const thisLen = len.px * (0.18 + rng() * 0.35) * (347 / 720);
    const rootW = 0.30 + rng() * 0.20;
    const tipW = 0.08 + rng() * 0.10;
    const path = strandPath(bx, by, thisLen, dir, curl * 0.4, wave, rng(), rootW, tipW);
    const op = 0.25 + rng() * 0.30;
    const c = palette[Math.floor(rng() * palette.length)];
    strands.push(`<path d="${path}" fill="${c}" opacity="${op.toFixed(2)}"/>`);
  }

  // ---- Pass 2: bulk (shorter than natural, varied opacity, full color variation) ----
  for (let i = 0; i < bulkCount; i++) {
    const f = follicles[Math.floor(rng() * follicles.length)];
    if (!f) break;
    const cluster = 1 + Math.floor(rng() * 2);
    for (let c = 0; c < cluster; c++) {
      const [bx, by] = jitterPos(f[0], f[1], 1.4);
      if (!isInsideZone(bx, by, h)) continue;
      if (rng() > densityGate(by)) continue;
      const dir = hairFlow(bx, by, h, zone) + (rng() - 0.5) * 0.85;
      const thisLen = len.px * (0.45 + rng() * 0.45) * (347 / 720);
      const rootW = 0.35 + rng() * 0.25;
      const tipW = 0.08 + rng() * 0.10;
      const path = strandPath(bx, by, thisLen, dir, curl, wave, rng(), rootW, tipW);
      const op = 0.5 + rng() * 0.40;
      const cIdx = Math.floor(rng() * palette.length);
      strands.push(`<path d="${path}" fill="${palette[cIdx]}" opacity="${op.toFixed(2)}"/>`);
    }
  }

  // ---- Pass 3: flyaways (a few longer fine strands for the wispy edge) ----
  for (let i = 0; i < flyCount; i++) {
    const f = follicles[Math.floor(rng() * follicles.length)];
    if (!f) break;
    const [bx, by] = jitterPos(f[0], f[1], 5.0);
    if (by > h.center[1] + 4) continue;
    if (!isInsideScalp(bx, by) && rng() > 0.1) continue;
    const dir = hairFlow(bx, by, h, zone) + (rng() - 0.5) * 0.9;
    const thisLen = len.px * (0.8 + rng() * 0.5) * (347 / 720);
    const rootW = 0.20 + rng() * 0.18;
    const tipW = 0.05 + rng() * 0.08;
    const path = strandPath(bx, by, thisLen, dir, curl * 1.3, wave * 1.5, rng(), rootW, tipW);
    const op = 0.4 + rng() * 0.40;
    const cIdx = Math.floor(rng() * palette.length);
    strands.push(`<path d="${path}" fill="${palette[cIdx]}" opacity="${op.toFixed(2)}"/>`);
  }

  // ---- Pass 4: hairline edge — very short thin strands biased to the front ----
  for (let i = 0; i < Math.floor(total * 0.10); i++) {
    const yPos = h.center[1] - 4 - rng() * 14;
    if (yPos < maxY) continue;
    const xPos = minX + rng() * (maxX - minX);
    if (!isInsideZone(xPos, yPos, h)) continue;
    const [bx, by] = jitterPos(xPos, yPos, 2.0);
    if (!isInsideZone(bx, by, h)) continue;
    const dir = hairFlow(bx, by, h, zone) + (rng() - 0.5) * 0.85;
    const thisLen = len.px * (0.14 + rng() * 0.24) * (347 / 720);
    const rootW = 0.22 + rng() * 0.16;
    const tipW = 0.05 + rng() * 0.06;
    const path = strandPath(bx, by, thisLen, dir, curl * 0.6, wave, rng(), rootW, tipW);
    const op = 0.45 + rng() * 0.35;
    const cIdx = Math.floor(rng() * palette.length);
    strands.push(`<path d="${path}" fill="${palette[cIdx]}" opacity="${op.toFixed(2)}"/>`);
  }

  return strands.join('');
}

/**
 * Renders a hair-transplant simulation on top of a real photo.
 * Returns an SVG that includes the photo as a base64 <image> plus the hair
 * overlay plus the watermark.
 */
export function renderPhotoSimulation({
  photoBase64,
  photoMime = 'image/webp',
  photoWidth = 347,
  photoHeight = 280,
  hairline = 'balanced',
  zone = 'full',
  density = 0.55,
  length = 'short',
  color = 'darkBrown',
  curl = 'straight',
  fullness = 'moderate',
  technique = 'fue',
  sessions = 'single',
  graftScenario = 'moderate',
  view = 'front',
  caseId = 'demo-001',
  seed,
  label
} = {}) {
  const preset = HAIRLINE_PRESETS[hairline] || HAIRLINE_PRESETS.balanced;
  const curlObj = CURL_PRESETS[curl] || CURL_PRESETS.straight;
  const fullnessObj = FULLNESS_PRESETS[fullness] || FULLNESS_PRESETS.moderate;
  const techniqueObj = TECHNIQUE_PRESETS[technique] || TECHNIQUE_PRESETS.fue;
  const sessionObj = SESSION_PRESETS[sessions] || SESSION_PRESETS.single;
  const graftObj = GRAFT_SCENARIOS[graftScenario] || GRAFT_SCENARIOS.moderate;
  const effectiveDensity = Math.min(1, density * fullnessObj.densityMul);
  const seedKey = `${hairline}-${zone}-${density}-${length}-${color}-${curl}-${fullness}-${view}`;
  const rng = mulberry32((seed !== undefined ? seed : stringSeed(seedKey)) >>> 0);
  const id = randomId();
  const createdAt = new Date().toISOString();
  const grafts = COVERAGE_ZONES[zone]?.grafts || 2000;
  const h = shiftedHairline(preset, density);
  const hair = renderPhotoHair(preset, zone, density, length, color, rng, { curl: curlObj, fullness: fullnessObj });
  const zonePath = simulatedZonePath(preset, density);
  const wm = label || 'HYPOTHETICAL VISUALIZATION - NOT A PREDICTION OR GUARANTEE OF RESULTS';
  const col = HAIR_COLORS[color] || HAIR_COLORS.darkBrown;

  // Natural hairline: an irregular Q-curve, not a perfect one. Add small
  // per-step perturbations so the front edge looks like real hairline
  // micro-irregularity (slight zig-zag, not a smooth arc).
  function naturalHairline() {
    const [lx, ly] = h.leftTemple;
    const [cx, cy] = h.center;
    const [rx, ry] = h.rightTemple;
    const samples = 12;
    let d = `M ${lx} ${ly}`;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      // Q-curve interpolation between the three control points
      const x = (1 - t) * (1 - t) * lx + 2 * (1 - t) * t * cx + t * t * rx;
      const baseY = (1 - t) * (1 - t) * ly + 2 * (1 - t) * t * (cy - 4) + t * t * ry;
      // Micro-irregularity: ±1.2px vertical noise so the hairline isn't a
      // perfect arc. Centered, less at the temples, more in the middle.
      const noise = (rng() - 0.5) * 2.4 * Math.sin(t * Math.PI);
      d += ` L ${x.toFixed(2)} ${(baseY + noise).toFixed(2)}`;
    }
    d += ` L ${rx} ${ry}`;
    return d;
  }
  const hairlinePath = naturalHairline();

  // View label on top of the watermark so multi-view galleries are obvious.
  const viewLabel = VIEW_CATALOG.find(v => v.id === view)?.label?.toUpperCase() || 'FRONTAL';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${photoWidth} ${photoHeight}" width="${photoWidth}" height="${photoHeight}">
  <defs>
    <clipPath id="zoneClip">
      <path d="${zonePath}"/>
    </clipPath>
    <!-- Soft-edge filter: moderate Gaussian blur so the individual
         strands blend into a cohesive mass without losing directional
         flow. stdDeviation 0.30 with filled quads. -->
    <filter id="hairSoft" x="-3%" y="-3%" width="106%" height="106%">
      <feGaussianBlur stdDeviation="0.30" />
    </filter>
    <!-- Organic hair texture: feTurbulence generates a noise pattern
         (per-pixel random values) that we composite as a subtle overlay.
         The result is a fine "grain" of color variation that mimics the
         way real hair catches light unevenly. -->
    <filter id="hairTexture" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.8" numOctaves="2" seed="3" result="noise"/>
      <feColorMatrix in="noise" type="matrix"
        values="0 0 0 0 0.2
                0 0 0 0 0.15
                0 0 0 0 0.1
                0 0 0 0.18 0" result="tint"/>
      <feComposite in="tint" in2="SourceGraphic" operator="in"/>
    </filter>
    <!-- Subtle inner-glow gradient at the hairline for natural density falloff -->
    <linearGradient id="hairDensity" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#000" stop-opacity="0"/>
      <stop offset="60%"  stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.05"/>
    </linearGradient>
  </defs>
  <!-- original photo (identity, skin tone, age, lighting, background ALL preserved) -->
  ${photoBase64 ? `<image href="data:${photoMime};base64,${photoBase64}" x="0" y="0" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid slice"/>` : ''}
  <!-- subtle darken on the bald area so the hair reads on top of the skin tone -->
  <path d="${zonePath}" fill="#000" opacity="0.04" clip-path="url(#zoneClip)"/>
  <!-- hair overlay (soft-blurred so individual strands blend naturally) -->
  <g clip-path="url(#zoneClip)" filter="url(#hairSoft)">
    ${hair}
  </g>
  <!-- Organic hair texture overlay: subtle noise grain that breaks up
       the uniform "drawn" look and makes the mass read as actual hair. -->
  <g clip-path="url(#zoneClip)" opacity="0.55" style="mix-blend-mode:multiply">
    <rect x="0" y="0" width="${photoWidth}" height="${photoHeight}" filter="url(#hairTexture)"/>
  </g>
  <!-- hairline trace removed — the new front edge is implied by the
       density falloff in the hair itself, no need for an explicit line -->
  <!-- view tag (top-right) -->
  <g>
    <rect x="${photoWidth - 56}" y="6" width="50" height="14" rx="3" fill="#0F172A" fill-opacity="0.78"/>
    <text x="${photoWidth - 31}" y="16" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="7" font-weight="700" fill="#5EEAD4" letter-spacing="0.6">${viewLabel}</text>
  </g>
  <!-- watermark (spec-mandated) -->
  <rect x="0" y="${photoHeight - 26}" width="${photoWidth}" height="26" fill="#0F172A" fill-opacity="0.92"/>
  <text x="${photoWidth / 2}" y="${photoHeight - 14}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="700" fill="#fff" letter-spacing="0.6">HYPOTHETICAL VISUALIZATION</text>
  <text x="${photoWidth / 2}" y="${photoHeight - 4}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="6.5" fill="#5EEAD4" letter-spacing="0.4">NOT A PREDICTION OR GUARANTEE OF RESULTS · TANAH-HAIR</text>
</svg>`;

  return {
    id,
    createdAt,
    svg,
    outputDataUrl: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
    width: photoWidth,
    height: photoHeight,
    view,
    caseId,
    hairline: preset.id,
    hairlineLabel: preset.label,
    zone,
    zoneLabel: COVERAGE_ZONES[zone]?.label || zone,
    density,
    effectiveDensity,
    length,
    lengthLabel: HAIR_LENGTHS[length]?.label || length,
    color,
    colorLabel: HAIR_COLORS[color]?.label || color,
    curl: curlObj.id,
    curlLabel: curlObj.label,
    fullness: fullnessObj.id,
    fullnessLabel: fullnessObj.label,
    technique: techniqueObj.id,
    techniqueLabel: techniqueObj.label,
    sessions: sessionObj.id,
    sessionsLabel: sessionObj.label,
    graftScenario: graftObj.id,
    graftScenarioLabel: graftObj.label,
    graftRange: graftObj.range,
    grafts,
    seed: seed !== undefined ? seed : stringSeed(seedKey),
    label: wm
  };
}

export function renderPhotoVariants(opts = {}) {
  return ['conservative', 'balanced', 'restorative'].map(h => renderPhotoSimulation({ ...opts, hairline: h }));
}

export { DEMO_SCALP };
