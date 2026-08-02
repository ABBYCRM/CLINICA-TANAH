// Parameter catalogs for the hair-transplant image generator.
// These are the inputs the user (or calling CRM) can set on a generation
// request. Values are deliberately kept short and stable so the API
// surface is a clear, JSON-friendly contract.

export const HAIRLINE_PRESETS = {
  conservative: { id: 'conservative', label: 'Mature conservative', grafts: 2000, description: 'Slight temple recession, no widow\'s peak, age-appropriate.' },
  balanced:     { id: 'balanced',     label: 'Balanced natural',   grafts: 2800, description: 'Soft M-shape, slight temple recession, normal adult-male position.' },
  restorative:  { id: 'restorative',  label: 'Restorative youthful', grafts: 3400, description: 'Lower even hairline with fuller frontal coverage.' },
  feminine:     { id: 'feminine',     label: 'Feminine rounded',   grafts: 2200, description: 'Soft curve with a central peak, no temple recession.' }
};

export const ZONE_PRESETS = {
  temples:  { id: 'temples',  label: 'Temples + frontal',  grafts: 1500 },
  frontal:  { id: 'frontal',  label: 'Frontal band',        grafts: 1800 },
  midscalp: { id: 'midscalp', label: 'Frontal + mid-scalp', grafts: 2600 },
  crown:    { id: 'crown',    label: 'Frontal + crown',     grafts: 2800 },
  full:     { id: 'full',     label: 'Full scalp',          grafts: 3400 }
};

export const LENGTH_PRESETS = {
  buzz:   { id: 'buzz',   label: 'Buzz (3 mm)',     px: 6 },
  short:  { id: 'short',  label: 'Short (15 mm)',   px: 18 },
  medium: { id: 'medium', label: 'Medium (40 mm)',  px: 42 },
  long:   { id: 'long',   label: 'Long (80 mm)',    px: 76 }
};

export const COLOR_PRESETS = {
  black:       { id: 'black',       label: 'Black' },
  darkBrown:   { id: 'darkBrown',   label: 'Dark brown' },
  mediumBrown: { id: 'mediumBrown', label: 'Medium brown' },
  lightBrown:  { id: 'lightBrown',  label: 'Light brown' },
  blonde:      { id: 'blonde',      label: 'Blonde' },
  saltPepper:  { id: 'saltPepper',  label: 'Salt & pepper' }
};

export const CURL_PRESETS = {
  straight: { id: 'straight', label: 'Straight' },
  slight:   { id: 'slight',   label: 'Slight wave' },
  wavy:     { id: 'wavy',     label: 'Wavy' },
  curly:    { id: 'curly',    label: 'Curly / coily' }
};

export const FULLNESS_PRESETS = {
  conservative: { id: 'conservative', label: 'Conservative', densityMul: 0.6 },
  moderate:     { id: 'moderate',     label: 'Moderate',     densityMul: 0.85 },
  fuller:       { id: 'fuller',       label: 'Fuller density', densityMul: 1.05 }
};

export const TECHNIQUE_PRESETS = {
  fue: { id: 'fue', label: 'FUE (Follicular Unit Extraction)' },
  fut: { id: 'fut', label: 'FUT (Strip)' },
  dhi: { id: 'dhi', label: 'DHI (Direct Hair Implantation)' }
};

export const SESSION_PRESETS = {
  single: { id: 'single', label: 'Single session' },
  multi:  { id: 'multi',  label: 'Multi-session' }
};

export const GRAFT_SCENARIOS = {
  light:      { id: 'light',      label: 'Light',         range: '1,200 – 1,800' },
  moderate:   { id: 'moderate',   label: 'Moderate',      range: '1,800 – 2,500' },
  restorative:{ id: 'restorative',label: 'Restorative',   range: '2,500 – 3,400' },
  extensive:  { id: 'extensive',  label: 'Extensive (multi-session)', range: '3,400 – 5,000+' }
};

export const VIEW_CATALOG = [
  { id: 'front',  label: 'Frontal',       description: 'Standardized front view, neutral expression.' },
  { id: 'top',    label: 'Top (vertex)',  description: 'Top-down view of the crown and midscalp.' },
  { id: 'left',   label: 'Left lateral',  description: 'Profile from the patient\'s left side.' },
  { id: 'right',  label: 'Right lateral', description: 'Profile from the patient\'s right side.' },
  { id: 'crown',  label: 'Crown (donor)', description: 'Donor-area reference at the back of the head.' },
  { id: 'back',   label: 'Posterior',     description: 'Back-of-head reference for donor density.' }
];
