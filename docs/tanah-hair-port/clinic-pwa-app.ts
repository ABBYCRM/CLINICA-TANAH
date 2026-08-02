// TANAH-HAIR clinic PWA - clinical skeuomorphism (HairPath §4)
// Renders: login, dashboard, patients, hairline lab (with paper canvas + ruler),
// procedure board (with graft counter + reconciliation), AI sandbox, settings.

type User = { id: string; email: string; displayName: string; role: string };
type GeminiSettings = { configured: boolean; maskedKey: string | null; enabled: boolean; model: string; sandboxAcknowledged: boolean; updatedAt: string | null; lastTestAt: string | null; lastTestStatus: string };
type Patient = { id: string; preferredName: string; initials: string; stage: string; nextAction: string; photoConsent: string; riskChips: string[] };

const state: { user: User | null; csrfToken: string; route: string } = {
  user: null,
  csrfToken: '',
  route: location.hash.slice(1) || 'dashboard'
};
const root = document.querySelector<HTMLElement>('#app')!;

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (state.csrfToken && options.method && options.method !== 'GET') headers.set('x-csrf-token', state.csrfToken);
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.title || `Request failed (${response.status})`);
  return body;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}

function toast(message: string, kind: 'ok' | 'error' | 'warning' = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 4200);
}

function loginView() {
  root.innerHTML = `
    <main class="login-shell">
      <section class="login-panel">
        <div class="brand-mark">TH</div>
        <p class="eyebrow-block">CLÍNICA TANAH</p>
        <h1>TANAH-HAIR</h1>
        <p class="subtle">Hair-transplant planning, procedure operations and patient journey.</p>
        <form id="login-form" class="stack">
          <label>Email<input name="email" type="email" placeholder="you@tanah.hair" autocomplete="username" required></label>
          <label>Password<input name="password" type="password" placeholder="••••" autocomplete="current-password" required></label>
          <button class="primary" type="submit">Enter clinical workspace</button>
          <p id="login-error" class="form-error" role="alert"></p>
        </form>
        <div class="login-demo">
          <p class="eyebrow login-demo-title">Demo accounts (password: 1234)</p>
          <button type="button" class="demo-account" data-email="admin@tanah.hair" data-name="Administrator">
            <strong>admin@tanah.hair</strong>
            <span>Full access · Gemini settings</span>
          </button>
          <button type="button" class="demo-account" data-email="juliana@tanah.hair" data-name="Dra. Juliana Ribeiro">
            <strong>juliana@tanah.hair</strong>
            <span>Clinician · simulator & planning</span>
          </button>
          <button type="button" class="demo-account" data-email="assistant@tanah.hair" data-name="Care assistant">
            <strong>assistant@tanah.hair</strong>
            <span>Care assistant · patient queue</span>
          </button>
        </div>
        <div class="safety-note mt-16">
          <strong>Clinical boundary</strong>
          <span>No autonomous diagnosis, treatment recommendation or guaranteed outcome.</span>
        </div>
      </section>
    </main>
  `;

  // Pre-fill credentials when a demo account chip is clicked
  document.querySelectorAll<HTMLButtonElement>('.demo-account').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = document.querySelector<HTMLFormElement>('#login-form')!;
      (form.elements.namedItem('email') as HTMLInputElement).value = btn.dataset.email || '';
      (form.elements.namedItem('password') as HTMLInputElement).value = '1234';
      (form.elements.namedItem('email') as HTMLInputElement).focus();
    });
  });
  document.querySelector<HTMLFormElement>('#login-form')!.addEventListener('submit', async event => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    try {
      const result = await api<{ user: User; csrfToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      state.user = result.user; state.csrfToken = result.csrfToken; render();
    } catch (error) {
      document.querySelector<HTMLElement>('#login-error')!.textContent = (error as Error).message;
    }
  });
}

const navItems: [string, string, string][] = [
  ['dashboard', 'Overview', '⌂'],
  ['patients', 'Patients', '◉'],
  ['planning', 'Hairline Lab', '⌁'],
  ['procedures', 'Procedure Board', '▦'],
  ['visualization', 'Image Simulator', '✦'],
  ['settings', 'Settings', '⚙']
];

function shell(content: string, title: string, subtitle: string) {
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark small">TH</div>
          <div>
            <strong>TANAH-HAIR</strong>
            <span>Clinical workspace</span>
          </div>
        </div>
        <nav>${navItems.map(([route, label, icon]) => `<a href="#${route}" class="${state.route === route ? 'active' : ''}"><span class="nav-icon">${icon}</span>${label}</a>`).join('')}</nav>
        <div class="sidebar-footer">
          <span><span class="status-dot"></span>Medical-grade controls</span>
          <div class="user-card">
            <strong>${escapeHtml(state.user?.displayName)}</strong>
            <span>${escapeHtml(state.user?.role)}</span>
          </div>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">TANAH-HAIR / ${escapeHtml(title)}</p>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(subtitle)}</p>
          </div>
          <div class="context-pills">
            <span>Clinical record</span>
            <span>PT-BR</span>
          </div>
        </header>
        <section class="content">${content}</section>
      </main>
    </div>
  `;
}

// ----- Signature components -----

function hairlineLabCanvas() {
  // Vector hairline overlay: midline, glabella, central height, temporal peaks
  // Symmetry markers on either side; scale in mm. All SVG; no raster paint.
  return `
    <div class="head-canvas">
      <div class="head-outline">
        <svg viewBox="0 0 500 400" preserveAspectRatio="xMidYMid meet" aria-label="Hairline planning vector canvas">
          <!-- gridded paper background (already on container) -->
          <!-- head silhouette -->
          <ellipse cx="250" cy="200" rx="140" ry="170" fill="none" stroke="#1F2A3A" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.5"/>
          <!-- glabella reference -->
          <line x1="250" y1="60" x2="250" y2="340" stroke="#1F2A3A" stroke-width="0.6" stroke-dasharray="2 4" opacity="0.5"/>
          <text x="254" y="68" font-family="JetBrains Mono, monospace" font-size="9" fill="#1F2A3A" opacity="0.7">midline</text>
          <!-- proposed central height -->
          <line x1="250" y1="120" x2="250" y2="180" stroke="#BE123C" stroke-width="1.4"/>
          <text x="256" y="135" font-family="JetBrains Mono, monospace" font-size="9" fill="#BE123C">central 72 mm</text>
          <!-- macro hairline (red — proposed) -->
          <path d="M 110 200 Q 160 150 220 130 Q 250 122 280 130 Q 340 150 390 200" fill="none" stroke="#BE123C" stroke-width="1.8" stroke-linecap="round"/>
          <!-- micro irregularity (proposed) -->
          <path d="M 130 210 Q 145 195 160 205 Q 175 192 190 207 Q 205 195 220 200 Q 235 188 250 195 Q 265 188 280 200 Q 295 195 310 207 Q 325 192 340 205 Q 355 195 370 210" fill="none" stroke="#BE123C" stroke-width="1" stroke-linecap="round" opacity="0.7"/>
          <!-- temporal peaks -->
          <circle cx="115" cy="205" r="4" fill="none" stroke="#0284C7" stroke-width="1.4"/>
          <circle cx="385" cy="205" r="4" fill="none" stroke="#0284C7" stroke-width="1.4"/>
          <text x="100" y="225" font-family="JetBrains Mono, monospace" font-size="9" fill="#0284C7">L peak</text>
          <text x="388" y="225" font-family="JetBrains Mono, monospace" font-size="9" fill="#0284C7">R peak</text>
          <!-- frontotemporal angle -->
          <path d="M 115 205 L 220 130" stroke="#0D9488" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.8"/>
          <text x="130" y="160" font-family="JetBrains Mono, monospace" font-size="9" fill="#0D9488" transform="rotate(-32 130 160)">frontotemporal ∠ 78°</text>
          <!-- symmetry markers (centered, no measurement, just presence) -->
          <line x1="240" y1="340" x2="260" y2="340" stroke="#1F2A3A" stroke-width="1"/>
          <line x1="250" y1="332" x2="250" y2="348" stroke="#1F2A3A" stroke-width="1"/>
        </svg>
      </div>
      <span class="measure">72 mm · 78°</span>
      <div class="scale-legend">
        <span>0</span><span class="bar"></span><span>50 mm</span>
      </div>
    </div>
  `;
}

function graftCounter(value: number, label = 'Total grafts') {
  const digits = String(value).padStart(4, '0').split('');
  return `
    <div>
      <p class="eyebrow">${escapeHtml(label)}</p>
      <div class="graft-counter" role="status" aria-label="${escapeHtml(label)} ${value}">
        ${digits.map(d => `<div class="segment">${d}</div>`).join('')}
      </div>
    </div>
  `;
}

function timelineDial(active: 'pre' | 'd0' | 'd1-3' | 'd7-14' | 'm1' | 'm3' | 'm6' | 'm9' | 'm12' | 'm18') {
  const ticks = [
    { id: 'd0', label: 'D 0' },
    { id: 'd1-3', label: 'D 1-3' },
    { id: 'd7-14', label: 'D 7-14' },
    { id: 'm1', label: 'M 1' },
    { id: 'm3', label: 'M 3' },
    { id: 'm6', label: 'M 6' },
    { id: 'm9', label: 'M 9' },
    { id: 'm12', label: 'M 12' },
    { id: 'm18', label: 'M 18' }
  ] as const;
  const order = ['d0', 'd1-3', 'd7-14', 'm1', 'm3', 'm6', 'm9', 'm12', 'm18'];
  const activeIndex = order.indexOf(active);
  return `
    <div class="timeline-dial" role="list" aria-label="Postoperative timeline">
      ${ticks.map((t, i) => {
        const cls = i < activeIndex ? 'done' : i === activeIndex ? 'active' : '';
        return `<div class="tick ${cls}" role="listitem"><span>${t.label}</span></div>`;
      }).join('')}
    </div>
  `;
}

function patientHeader(p: Patient) {
  const risks = p.riskChips?.length
    ? p.riskChips.map(c => `<span class="chip ${c.toLowerCase().includes('alerg') || c.toLowerCase().includes('anticoag') || c.toLowerCase().includes('smok') ? 'warning' : ''}">${escapeHtml(c)}</span>`).join(' ')
    : `<span class="chip muted">No active flags</span>`;
  return `
    <div class="instrument-panel grid-auto">
      <div class="avatar avatar-lg">${escapeHtml(p.initials)}</div>
      <div>
        <div class="flex items-center gap-12 flex-wrap">
          <strong class="name-lg">${escapeHtml(p.preferredName)}</strong>
          <span class="chip">${escapeHtml(p.stage)}</span>
          <span class="chip">${escapeHtml(p.photoConsent)}</span>
        </div>
        <p class="muted mt-4 mb-8">Next: ${escapeHtml(p.nextAction)}</p>
        <div class="flex gap-6 flex-wrap">${risks}</div>
      </div>
    </div>
  `;
}

// ----- Routes -----

async function dashboardView() {
  const data = await api<{ stats: any; recent: Patient[]; ai: GeminiSettings }>('/dashboard');
  shell(`
    <div class="metric-grid">
      ${[
        ['Consultations today', data.stats.consultationsToday, 'Scheduled and confirmed', ''],
        ['Plans awaiting signature', data.stats.plansAwaitingSignature, 'Surgeon action required', 'warning'],
        ['Follow-ups due', data.stats.followUpsDue, 'Day 2 through Month 18', ''],
        ['Procedure rooms', data.stats.procedureRooms, 'Readiness checks active', '']
      ].map(([label, value, meta, mod]) => `<article class="metric-card ${mod}"><span>${label}</span><strong>${value}</strong><small>${meta}</small></article>`).join('')}
    </div>
    <div class="two-column">
      <article class="instrument-panel">
        <div class="section-heading">
          <div><p class="eyebrow">ACTIVE JOURNEYS</p><h2>Patient action queue</h2></div>
          <a href="#patients">Open queue</a>
        </div>
        ${data.recent.slice(0, 6).map(patient => `
          <div class="patient-row">
            <div class="avatar">${escapeHtml(patient.initials)}</div>
            <div>
              <strong>${escapeHtml(patient.preferredName)}</strong>
              <span>${escapeHtml(patient.stage)} · ${escapeHtml(patient.nextAction)}</span>
            </div>
            <span class="chip">${escapeHtml(patient.photoConsent)}</span>
          </div>
        `).join('')}
      </article>
      <article class="instrument-panel">
        <div class="section-heading">
          <div><p class="eyebrow">INTEGRATION HEALTH</p><h2>Gemini Image Gen</h2></div>
          <a href="#settings">Configure</a>
        </div>
        <div class="integration-gauge">
          <div class="gauge-ring ${data.ai.enabled ? 'enabled' : ''}"><span>${data.ai.enabled ? 'ON' : 'OFF'}</span></div>
          <div>
            <strong>${data.ai.configured ? 'Key configured' : 'Not configured'}</strong>
            <p>${escapeHtml(data.ai.model)}</p>
            <p>Last test: ${escapeHtml(data.ai.lastTestStatus)}</p>
          </div>
        </div>
        <div class="safety-note">
          <strong>Sandbox-only</strong>
          <span>Generated concepts are hypothetical, watermarked and isolated from the clinical record.</span>
        </div>
      </article>
    </div>
  `, 'Overview', 'Operational status, clinical queues and integration health.');
}

async function patientsView() {
  const { patients } = await api<{ patients: Patient[] }>('/patients');
  const first = patients[0];
  shell(`
    ${first ? patientHeader(first) : ''}
    <article class="instrument-panel">
      <div class="section-heading">
        <div><p class="eyebrow">CARE OPERATIONS</p><h2>Patient journey queue</h2></div>
        <button class="secondary">New patient</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Stage</th>
              <th>Next action</th>
              <th>Risk context</th>
              <th>Photo consent</th>
            </tr>
          </thead>
          <tbody>
            ${patients.map(patient => `
              <tr>
                <td>
                  <div class="patient-cell">
                    <span class="avatar">${escapeHtml(patient.initials)}</span>
                    <strong>${escapeHtml(patient.preferredName)}</strong>
                  </div>
                </td>
                <td>${escapeHtml(patient.stage)}</td>
                <td>${escapeHtml(patient.nextAction)}</td>
                <td>${patient.riskChips.length
                  ? patient.riskChips.map(c => `<span class="chip warning">${escapeHtml(c)}</span>`).join(' ')
                  : '<span class="muted">No active flags</span>'}</td>
                <td><span class="chip">${escapeHtml(patient.photoConsent)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </article>
    <article class="instrument-panel">
      <div class="section-heading">
        <div><p class="eyebrow">POSTOPERATIVE TIMELINE</p><h2>Active follow-up dial</h2></div>
        <span class="chip muted">Demo data</span>
      </div>
      ${timelineDial('d1-3')}
      <p class="muted timeline-note">Checkpoint status is based on actual photos, not generated progress.</p>
    </article>
  `, 'Patients', 'Purpose-limited access to synthetic demonstration records.');
}

function planningView() {
  shell(`
    <div class="two-column planning-grid">
      <article class="instrument-panel clinical-paper">
        <div class="section-heading">
          <div><p class="eyebrow">VECTOR CANVAS</p><h2>Hairline Lab</h2></div>
          <span class="chip chip-paper">Unsigned draft</span>
        </div>
        ${hairlineLabCanvas()}
        <div class="tool-rack">
          <button class="active">Midline</button>
          <button>Central height</button>
          <button>Temporal peaks</button>
          <button>Frontotemporal ∠</button>
          <button>Macro</button>
          <button>Micro</button>
          <button>Symmetry</button>
        </div>
        <div class="safety-note mt-14">
          <strong>Vector-only</strong>
          <span>The source image is immutable. All overlays are vectors and the original is preserved by hash.</span>
        </div>
      </article>
      <article class="instrument-panel">
        <p class="eyebrow">PLANNING INVARIANTS</p>
        <h2 class="section-h2-tight">Clinician-authored only</h2>
        <ul class="check-list">
          <li>All measurements require calibration.</li>
          <li>Alternatives are named and versioned.</li>
          <li>Patient review cannot alter a signed plan.</li>
          <li>Final graft totals require surgeon signature.</li>
        </ul>
        <div class="safety-note mt-14">
          <strong>Next implementation package</strong>
          <span>Immutable source-image overlays, donor mapping, graft worksheet and signed plan addenda.</span>
        </div>
      </article>
    </div>
  `, 'Hairline Lab', 'Manual vector planning over immutable clinical photography.');
}

function proceduresView() {
  shell(`
    <div class="two-column">
      <article class="instrument-panel">
        <div class="section-heading">
          <div><p class="eyebrow">PROCEDURE DAY</p><h2>Operating phases</h2></div>
          <span class="chip muted">Foundation scaffold</span>
        </div>
        <div class="procedure-board">
          ${[
            ['Pre-op time-out', 'Identity, consent, allergies and signed plan.'],
            ['Harvesting', 'Device, punch, donor zones and extraction count.'],
            ['Graft preparation', '1/2/3/4+ hair units, solution, temperature and time.'],
            ['Implantation', 'Recipient-zone count, direction and angle notes.'],
            ['Closure', 'Reconciliation, adverse events and discharge.']
          ].map(([stage, desc], i) => `
            <article class="procedure-stage">
              <span class="stage-number">${i + 1}</span>
              <h2>${stage}</h2>
              <p>${desc}</p>
              <div class="stage-status">Awaiting live data</div>
            </article>
          `).join('')}
        </div>
      </article>
      <div class="flex-col gap-20">
        <article class="instrument-panel">
          <p class="eyebrow">GRAFT COUNTER</p>
          <h2 class="section-h2-tight">Mechanical tally</h2>
          ${graftCounter(2148, 'Session 1 — running total')}
          <p class="muted mt-8">Every adjustment logs the previous value, new value, author and reason.</p>
        </article>
        <article class="instrument-panel reconciliation">
          <strong class="reconciliation-title">Required accounting invariant</strong>
          <code>extracted = implanted + discarded + damaged + remaining</code>
          <span class="reconciliation-note">Procedure closure must block until reconciled or a surgeon records break-glass evidence.</span>
        </article>
      </div>
    </div>
  `, 'Procedure Board', 'Auditable phase controls and graft reconciliation.');
}

async function visualizationView() {
  // Spec-aligned hair-transplant image simulator (HairPath §3 visual).
  // Photo-based parametric overlay; preserves face/skin/age/lighting/background
  // by construction. Bundled demo photo (no real patient data). Permanent
  // "HYPOTHETICAL VISUALIZATION — NOT A PREDICTION OR GUARANTEE OF RESULTS"
  // watermark on every render.
  shell(`
    <div class="simulator-layout">
      <article class="instrument-panel sim-source">
        <p class="eyebrow">BEFORE</p>
        <h2 class="section-h2-tight">Baseline photo</h2>
        <div class="sim-frame">
          <img id="sim-before" src="/api/simulator/base-image" alt="Bundled demo patient photo (not a real patient)"/>
        </div>
        <p class="muted mt-8">Bundled synthetic demo. No real patient data is processed.</p>
      </article>
      <article class="instrument-panel sim-target">
        <div class="section-heading">
          <div>
            <p class="eyebrow">AFTER · HYPOTHETICAL</p>
            <h2>Restored hairline preview</h2>
          </div>
          <span id="sim-summary" class="chip muted">Awaiting render</span>
        </div>
        <div class="sim-frame">
          <div id="sim-after-wrap" class="visual-placeholder">
            <span>✦</span>
            <p>Adjust the controls and press <strong>Render</strong> to see the restored hairline.</p>
          </div>
        </div>
        <div class="safety-note mt-8">
          <strong>Hard boundary</strong>
          <span>Synthetic concept only. Identity, skin tone, age, head shape, lighting and background are preserved. No patient photograph upload. No diagnosis, prediction or guaranteed outcome.</span>
        </div>
      </article>
      <article class="instrument-panel sim-controls">
        <p class="eyebrow">PARAMETERS</p>
        <h2 class="section-h2-tight">Adjust the simulation</h2>
        <form id="sim-form" class="stack">
          <div class="form-grid-2">
            <label>Hairline shape
              <select name="hairline">
                <option value="conservative">Mature conservative</option>
                <option value="balanced" selected>Balanced natural</option>
                <option value="restorative">Restorative youthful</option>
                <option value="feminine">Feminine rounded</option>
              </select>
            </label>
            <label>Coverage zone
              <select name="zone">
                <option value="frontal">Frontal band</option>
                <option value="midscalp">Frontal + midscalp</option>
                <option value="crown">Frontal + crown</option>
                <option value="full" selected>Full scalp</option>
                <option value="temples">Temples + frontal</option>
              </select>
            </label>
            <label>Density
              <input type="range" name="density" min="0" max="1" step="0.05" value="0.65"/>
              <small>Visual hair count (no clinical graft estimate).</small>
            </label>
            <label>Length
              <select name="length">
                <option value="buzz">Buzz (3 mm)</option>
                <option value="short" selected>Short (15 mm)</option>
                <option value="medium">Medium (40 mm)</option>
                <option value="long">Long (80 mm)</option>
              </select>
            </label>
            <label>Hair color
              <select name="color">
                <option value="black">Black</option>
                <option value="darkBrown" selected>Dark brown</option>
                <option value="mediumBrown">Medium brown</option>
                <option value="lightBrown">Light brown</option>
                <option value="blonde">Blonde</option>
                <option value="saltPepper">Salt &amp; pepper</option>
              </select>
            </label>
            <label>Curl / texture
              <select name="curl">
                <option value="straight" selected>Straight</option>
                <option value="slight">Slight wave</option>
                <option value="wavy">Wavy</option>
                <option value="curly">Curly / coily</option>
              </select>
            </label>
            <label>Fullness
              <select name="fullness">
                <option value="conservative">Conservative</option>
                <option value="moderate" selected>Moderate</option>
                <option value="fuller">Fuller density</option>
              </select>
            </label>
            <label>Technique
              <select name="technique">
                <option value="fue" selected>FUE</option>
                <option value="fut">FUT</option>
                <option value="dhi">DHI</option>
              </select>
            </label>
            <label>Sessions
              <select name="sessions">
                <option value="single" selected>Single session</option>
                <option value="multi">Multi-session</option>
              </select>
            </label>
            <label>Graft scenario
              <select name="graftScenario">
                <option value="light">Light (1,200–1,800)</option>
                <option value="moderate" selected>Moderate (1,800–2,500)</option>
                <option value="restorative">Restorative (2,500–3,400)</option>
                <option value="extensive">Extensive (3,400–5,000+, multi)</option>
              </select>
            </label>
          </div>
          <div class="button-row">
            <button class="primary" type="button" id="sim-ai-generate">AI Generate (Gemini)</button>
            <button class="secondary" type="button" id="sim-ai-multi">AI 4-view (Gemini)</button>
            <button class="secondary" type="submit" id="sim-render">Render (parametric)</button>
            <button class="secondary" type="button" id="sim-variants">3 alternatives</button>
            <button class="secondary" type="button" id="sim-multi">Multi-view</button>
          </div>
        </form>
      </article>
    </div>
    <article class="instrument-panel mt-20">
      <div class="section-heading">
        <div>
          <p class="eyebrow">CASE CONTEXT</p>
          <h2>Standardized photo set (6 views)</h2>
        </div>
        <span class="chip muted">1 of 6 attached</span>
      </div>
      <div class="view-availability" id="sim-view-grid">
        <button class="view-slot attached" data-view="front">
          <span class="view-thumb"><img src="/api/simulator/base-image" alt="Front view"/></span>
          <strong>FRONTAL</strong>
          <span>Attached</span>
        </button>
        <button class="view-slot" data-view="left" disabled>
          <span class="view-thumb">＋</span>
          <strong>LEFT LATERAL</strong>
          <span>Not attached</span>
        </button>
        <button class="view-slot" data-view="right" disabled>
          <span class="view-thumb">＋</span>
          <strong>RIGHT LATERAL</strong>
          <span>Not attached</span>
        </button>
        <button class="view-slot" data-view="top" disabled>
          <span class="view-thumb">＋</span>
          <strong>TOP (VERTEX)</strong>
          <span>Not attached</span>
        </button>
        <button class="view-slot" data-view="crown" disabled>
          <span class="view-thumb">＋</span>
          <strong>CROWN (DONOR)</strong>
          <span>Not attached</span>
        </button>
        <button class="view-slot" data-view="back" disabled>
          <span class="view-thumb">＋</span>
          <strong>POSTERIOR</strong>
          <span>Not attached</span>
        </button>
      </div>
      <p class="muted mt-8">The bundled demo has only the frontal view attached. In a real case, intake photos populate the other 5 slots and the simulator renders all perspectives with the same parameters — synchronized before/after across the standardized set.</p>
    </article>
    <article class="instrument-panel mt-20 sim-variants-hidden" id="sim-variants-panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">VARIANT GALLERY</p>
          <h2>Three looks at the current parameters</h2>
        </div>
        <button class="secondary" id="sim-variants-close">Hide</button>
      </div>
      <div class="variant-grid" id="sim-variants-grid"></div>
    </article>
    <article class="instrument-panel mt-20 sim-variants-hidden" id="sim-multi-panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">SYNCHRONIZED MULTI-VIEW</p>
          <h2>Same parameters across all attached views</h2>
        </div>
        <button class="secondary" id="sim-multi-close">Hide</button>
      </div>
      <div class="multi-view-grid" id="sim-multi-grid"></div>
    </article>
  `, 'Hair Transplant Image Simulator', 'Visualization tool. Hypothetical concepts only — not a prediction or guarantee of results.');
  await renderSimulatorView();
}

async function renderSimulatorView() {
  // Submit handler for single render
  document.querySelector<HTMLFormElement>('#sim-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const body = Object.fromEntries(new FormData(form));
    const button = form.querySelector<HTMLButtonElement>('#sim-render')!;
    button.disabled = true; button.textContent = 'Rendering…';
    try {
      const result = await api<any>('/simulator/apply', { method: 'POST', body: JSON.stringify(body) });
      const wrap = document.querySelector<HTMLElement>('#sim-after-wrap')!;
      wrap.classList.remove('visual-placeholder');
      wrap.innerHTML = `<img src="${result.outputDataUrl}" alt="Simulated hairline render"><p class="muted">${escapeHtml(result.hairlineLabel)} · ${escapeHtml(result.lengthLabel)} · ${escapeHtml(result.colorLabel)} · ${escapeHtml(result.curlLabel)} · ${escapeHtml(result.techniqueLabel)} · ${escapeHtml(result.sessionsLabel)} · ${result.grafts} grafts (${escapeHtml(result.graftRange)})</p>`;
      const sum = document.querySelector<HTMLElement>('#sim-summary')!;
      sum.className = 'chip';
      sum.textContent = `${result.grafts} grafts · ${result.hairlineLabel}`;
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Render'; }
  });

  // Variants handler
  document.querySelector<HTMLButtonElement>('#sim-variants')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true; button.textContent = 'Rendering 3…';
    try {
      const form = document.querySelector<HTMLFormElement>('#sim-form')!;
      const body = Object.fromEntries(new FormData(form));
      const result = await api<any>('/simulator/photo-variants', { method: 'POST', body: JSON.stringify(body) });
      const grid = document.querySelector<HTMLElement>('#sim-variants-grid')!;
      grid.innerHTML = result.variants.map((v: any) => `
        <figure class="variant-card">
          <img src="${v.outputDataUrl}" alt="${escapeHtml(v.hairline)} variant"/>
          <figcaption>
            <strong>${escapeHtml(v.hairline)}</strong>
            <span>${v.grafts} grafts · ${escapeHtml(v.lengthLabel)} · ${escapeHtml(v.colorLabel)} · ${escapeHtml(v.techniqueLabel)}</span>
          </figcaption>
        </figure>
      `).join('');
      const panel = document.querySelector<HTMLElement>('#sim-variants-panel')!;
      panel.classList.remove('sim-variants-hidden');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { button.disabled = false; button.textContent = '3 alternatives'; }
  });

  // Multi-view handler
  document.querySelector<HTMLButtonElement>('#sim-multi')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true; button.textContent = 'Rendering all views…';
    try {
      const form = document.querySelector<HTMLFormElement>('#sim-form')!;
      const body = Object.fromEntries(new FormData(form));
      const result = await api<any>('/simulator/multi-view', { method: 'POST', body: JSON.stringify(body) });
      const grid = document.querySelector<HTMLElement>('#sim-multi-grid')!;
      grid.innerHTML = result.renders.map((v: any) => `
        <figure class="variant-card">
          <img src="${v.outputDataUrl}" alt="${escapeHtml(v.view)} view"/>
          <figcaption>
            <strong>${escapeHtml(v.view.toUpperCase())}</strong>
            <span>${escapeHtml(v.hairline)} · ${v.grafts} grafts · ${escapeHtml(v.technique)} · ${escapeHtml(v.sessions)}</span>
          </figcaption>
        </figure>
      `).join('') || '<p class="muted">No views attached to this case yet.</p>';
      const panel = document.querySelector<HTMLElement>('#sim-multi-panel')!;
      panel.classList.remove('sim-variants-hidden');
    } catch (error) { toast((error as Error).message, 'error'); }
    finally { button.disabled = false; button.textContent = 'Multi-view'; }
  });

  document.querySelector<HTMLButtonElement>('#sim-variants-close')?.addEventListener('click', () => {
    const panel = document.querySelector<HTMLElement>('#sim-variants-panel')!;
    panel.classList.add('sim-variants-hidden');
  });
  document.querySelector<HTMLButtonElement>('#sim-multi-close')?.addEventListener('click', () => {
    const panel = document.querySelector<HTMLElement>('#sim-multi-panel')!;
    panel.classList.add('sim-variants-hidden');
  });

  // AI Generate (Gemini): sends the bundled demo photo + structured
  // prompt with all selected parameters. The model scans the picture,
  // adapts the new hairline to the actual head shape, and preserves
  // identity. Falls back to the parametric render if Gemini is down.
  document.querySelector<HTMLButtonElement>('#sim-ai-generate')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    const renderBtn = document.querySelector<HTMLButtonElement>('#sim-render')!;
    const variantsBtn = document.querySelector<HTMLButtonElement>('#sim-variants')!;
    const multiBtn = document.querySelector<HTMLButtonElement>('#sim-multi')!;
    const multiAiBtn = document.querySelector<HTMLButtonElement>('#sim-ai-multi')!;
    [button, renderBtn, variantsBtn, multiBtn, multiAiBtn].forEach(b => b.disabled = true);
    const originalLabel = button.textContent;
    button.textContent = 'Scanning picture with Gemini…';
    const wrap = document.querySelector<HTMLElement>('#sim-after-wrap')!;
    wrap.classList.add('visual-placeholder');
    wrap.innerHTML = `<span>⏳</span><p>Gemini is analyzing the head shape and generating the simulation. This usually takes 5–15 seconds.</p>`;
    try {
      const form = document.querySelector<HTMLFormElement>('#sim-form')!;
      const body = Object.fromEntries(new FormData(form));
      const result = await api<any>('/simulator/ai-generate', { method: 'POST', body: JSON.stringify(body) });
      wrap.classList.remove('visual-placeholder');
      // The Gemini result is high-res; constrain in CSS so it doesn't
      // blow out the layout.
      wrap.innerHTML = `<img src="${result.outputDataUrl}" alt="AI-generated hair-transplant simulation" style="max-height:360px;width:auto;display:block;margin:0 auto;border-radius:6px"/><p class="muted">Model: ${escapeHtml(result.model)} · params: ${escapeHtml(JSON.stringify({hairline: body.hairline, zone: body.zone, length: body.length, color: body.color, curl: body.curl, fullness: body.fullness, technique: body.technique, sessions: body.sessions}))}</p>`;
      const sum = document.querySelector<HTMLElement>('#sim-summary')!;
      sum.className = 'chip';
      sum.textContent = `AI · ${body.hairline} · ${body.color}`;
    } catch (error) {
      toast('AI generator unavailable — falling back to parametric render. ' + (error as Error).message, 'error');
      // Fallback: trigger the parametric render
      const form = document.querySelector<HTMLFormElement>('#sim-form')!;
      form.requestSubmit();
    } finally {
      [button, renderBtn, variantsBtn, multiBtn, multiAiBtn].forEach(b => b.disabled = false);
      button.textContent = originalLabel || 'AI Generate (Gemini)';
    }
  });

  // AI 4-view: generate front / top / side / back in parallel. Each is
  // a separate Gemini call with a view-specific framing instruction.
  // Total time ~30-60s (2 in parallel × 2 batches).
  document.querySelector<HTMLButtonElement>('#sim-ai-multi')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    const renderBtn = document.querySelector<HTMLButtonElement>('#sim-render')!;
    const variantsBtn = document.querySelector<HTMLButtonElement>('#sim-variants')!;
    const multiBtn = document.querySelector<HTMLButtonElement>('#sim-multi')!;
    const aiBtn = document.querySelector<HTMLButtonElement>('#sim-ai-generate')!;
    [button, renderBtn, variantsBtn, multiBtn, aiBtn].forEach(b => b.disabled = true);
    const originalLabel = button.textContent;
    button.textContent = 'Generating 4 views with Gemini…';
    const grid = document.querySelector<HTMLElement>('#sim-multi-grid')!;
    const panel = document.querySelector<HTMLElement>('#sim-multi-panel')!;
    panel.classList.remove('sim-variants-hidden');
    grid.innerHTML = '<div class="muted" style="grid-column:1/-1;text-align:center;padding:40px"><p>⏳ Generating 4 views (front / top / side / back). Each is a separate AI render. This usually takes 30–60 seconds.</p></div>';
    try {
      const form = document.querySelector<HTMLFormElement>('#sim-form')!;
      const body = Object.fromEntries(new FormData(form));
      const result = await api<any>('/simulator/ai-multi-view', { method: 'POST', body: JSON.stringify(body) });
      grid.innerHTML = result.views.map((v: any) => {
        if (v.error) {
          return `<figure class="variant-card"><div class="visual-placeholder" style="height:200px"><span>!</span><p>${escapeHtml(v.error)}</p></div><figcaption><strong>${escapeHtml(v.view.toUpperCase())}</strong><span>Failed</span></figcaption></figure>`;
        }
        return `<figure class="variant-card"><img src="${v.outputDataUrl}" alt="${escapeHtml(v.view)} view" style="max-height:300px;width:auto;display:block;margin:0 auto"/><figcaption><strong>${escapeHtml(v.view.toUpperCase())}</strong><span>${escapeHtml(v.model)} · AI</span></figcaption></figure>`;
      }).join('');
    } catch (error) {
      toast('AI 4-view failed: ' + (error as Error).message, 'error');
      grid.innerHTML = `<p class="muted">AI 4-view failed: ${escapeHtml((error as Error).message)}</p>`;
    } finally {
      [button, renderBtn, variantsBtn, multiBtn, aiBtn].forEach(b => b.disabled = false);
      button.textContent = originalLabel || 'AI 4-view (Gemini)';
    }
  });
}

async function settingsView() {
  const settings = await api<GeminiSettings>('/settings/integrations/gemini');
  shell(`
    <div class="settings-layout">
      <aside class="settings-nav instrument-panel flat">
        <strong>Settings</strong>
        <a class="active">Gemini Image Gen</a>
        <a>Security</a>
        <a>Roles and access</a>
        <a>Audit</a>
        <a>Retention</a>
      </aside>
      <article class="instrument-panel">
        <div class="section-heading">
          <div><p class="eyebrow">SERVER-SIDE INTEGRATION</p><h2>Gemini Image Gen API</h2></div>
          <span class="chip ${settings.configured ? '' : 'warning'}">${settings.configured ? 'Configured' : 'Not configured'}</span>
        </div>
        <p class="lede-paragraph">The key is encrypted by the API and never exposed to the browser after save. Changing or testing it requires step-up authentication.</p>
        <form id="gemini-form" class="stack">
          <label>API key
            <input name="apiKey" type="password" autocomplete="new-password" placeholder="${escapeHtml(settings.maskedKey || 'Paste a new Gemini API key')}">
            <small>Leave blank to retain the existing encrypted key.</small>
          </label>
          <label>Image model
            <select name="model">
              <option value="gemini-3.1-flash-image" ${settings.model === 'gemini-3.1-flash-image' ? 'selected' : ''}>Gemini 3.1 Flash Image</option>
              <option value="gemini-3.1-flash-lite-image" ${settings.model === 'gemini-3.1-flash-lite-image' ? 'selected' : ''}>Gemini 3.1 Flash Lite Image</option>
              <option value="gemini-3-pro-image" ${settings.model === 'gemini-3-pro-image' ? 'selected' : ''}>Gemini 3 Pro Image</option>
            </select>
          </label>
          <label class="toggle-row">
            <input name="enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
            <span>
              <strong>Enable Gemini visualization</strong>
              <small>Tenant kill switch. Clinical workflows remain functional when off.</small>
            </span>
          </label>
          <label class="toggle-row">
            <input name="sandboxAcknowledged" type="checkbox" ${settings.sandboxAcknowledged ? 'checked' : ''}>
            <span>
              <strong>Restrict to non-clinical hypothetical visualization</strong>
              <small>No identifiable patient images, diagnosis, advice, prediction or marketing result.</small>
            </span>
          </label>
          <label>Administrator password for step-up
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <div class="button-row">
            <button class="primary" type="submit">Save encrypted settings</button>
            <button id="test-gemini" class="secondary" type="button">Test connection</button>
          </div>
        </form>
        <dl class="metadata">
          <div><dt>Stored key</dt><dd>${escapeHtml(settings.maskedKey || 'None')}</dd></div>
          <div><dt>Last test</dt><dd>${escapeHtml(settings.lastTestStatus)}${settings.lastTestAt ? ` · ${escapeHtml(settings.lastTestAt)}` : ''}</dd></div>
          <div><dt>Last update</dt><dd>${escapeHtml(settings.updatedAt || 'Never')}</dd></div>
        </dl>
        <div class="safety-note mt-14">
          <strong>Secret handling</strong>
          <span>No VITE_ variable, no frontend SDK, no logging, no plaintext read-back. Production should replace local encrypted storage with a managed secret service.</span>
        </div>
      </article>
    </div>
  `, 'Settings', 'Tenant integrations, secrets and safety controls.');

  async function stepUp(password: string) {
    const result = await api<{ stepUpToken: string }>('/auth/step-up', { method: 'POST', body: JSON.stringify({ password }) });
    return result.stepUpToken;
  }
  const form = document.querySelector<HTMLFormElement>('#gemini-form')!;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const token = await stepUp(String(data.get('password') || ''));
      const body = { apiKey: data.get('apiKey'), model: data.get('model'), enabled: data.get('enabled') === 'on', sandboxAcknowledged: data.get('sandboxAcknowledged') === 'on' };
      await api('/settings/integrations/gemini', { method: 'PUT', headers: { 'x-step-up-token': token }, body: JSON.stringify(body) });
      toast('Gemini settings encrypted and saved.'); await settingsView();
    } catch (error) { toast((error as Error).message, 'error'); }
  });
  document.querySelector<HTMLButtonElement>('#test-gemini')!.addEventListener('click', async () => {
    const data = new FormData(form);
    try {
      const token = await stepUp(String(data.get('password') || ''));
      const result = await api<any>('/settings/integrations/gemini/test', { method: 'POST', headers: { 'x-step-up-token': token }, body: '{}' });
      toast(result.modelVisible ? 'Connected and selected model is visible.' : 'Connected, but selected model was not listed for this key.', result.modelVisible ? 'ok' : 'warning');
      await settingsView();
    } catch (error) { toast((error as Error).message, 'error'); }
  });
}

async function render() {
  if (!state.user) return loginView();
  try {
    if (state.route === 'dashboard') return await dashboardView();
    if (state.route === 'patients') return await patientsView();
    if (state.route === 'planning') return planningView();
    if (state.route === 'procedures') return proceduresView();
    if (state.route === 'visualization') return await visualizationView();
    if (state.route === 'settings') return await settingsView();
    state.route = 'dashboard'; await dashboardView();
  } catch (error) {
    if ((error as Error).message.toLowerCase().includes('sign in')) { state.user = null; return loginView(); }
    root.innerHTML = `<main class="fatal"><h1>Unable to load workspace</h1><p>${escapeHtml((error as Error).message)}</p><button class="primary" onclick="location.reload()">Retry</button></main>`;
  }
}

window.addEventListener('hashchange', () => { state.route = location.hash.slice(1) || 'dashboard'; render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/clinic/service-worker.js').catch(console.error);
// Auto-login: try an existing session first; if none, create a demo session
// (the API seeds an admin user and the demo endpoint mints a session for it
// without a password). No login screen unless the demo endpoint is disabled.
api<{ user: User; csrfToken: string }>('/auth/me')
  .then(result => { state.user = result.user; state.csrfToken = result.csrfToken; render(); })
  .catch(() => api<{ user: User; csrfToken: string }>('/auth/demo', { method: 'POST' })
    .then(result => { state.user = result.user; state.csrfToken = result.csrfToken; render(); })
    .catch(error => {
      // Demo auto-login disabled — fall back to the legacy login screen.
      if ((error as Error).message.toLowerCase().includes('demo') ||
          (error as Error).message.toLowerCase().includes('disabled')) {
        loginView();
      } else {
        loginView();
      }
    }));
