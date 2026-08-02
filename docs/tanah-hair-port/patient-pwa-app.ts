// TANAH-HAIR patient PWA - mobile-first, clinical skeuomorphism
// Renders: home, photos, plan, timeline, messages with a bottom tab bar.

type Tab = 'home' | 'photos' | 'plan' | 'timeline' | 'messages';

const state: { tab: Tab } = { tab: 'home' };
const root = document.querySelector<HTMLElement>('#patient-app')!;

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'photos', label: 'Photos', icon: '◉' },
  { id: 'plan', label: 'Plan', icon: '⌁' },
  { id: 'timeline', label: 'Timeline', icon: '▦' },
  { id: 'messages', label: 'Messages', icon: '✉' }
];

function hero() {
  return `
    <header class="hero">
      <div class="brand">TH</div>
      <div>
        <small>CLÍNICA TANAH</small>
        <h1>My Hair Journey</h1>
        <p>Preparation, photo tasks and follow-up in one secure place.</p>
      </div>
    </header>
  `;
}

function patientHeaderCard() {
  return `
    <div class="patient-header">
      <div class="avatar">LL</div>
      <div class="name">
        <strong>Luis Lacerda</strong>
        <span>PT-BR · 36 years · pre-procedure</span>
      </div>
      <span class="chip flex-shrink-0">Care consent active</span>
    </div>
  `;
}

function homeView() {
  return `
    ${hero()}
    <main>
      ${patientHeaderCard()}
      <section class="card next">
        <span class="tag">NEXT ACTION</span>
        <h2>Standardized consultation photos</h2>
        <p>Complete six guided scalp views before your appointment. The camera guide checks framing and blur only; it does not diagnose hair loss.</p>
        <button data-go="photos">Start photo guide</button>
      </section>
      <section class="grid">
        <article class="card">
          <h2>Journey timeline</h2>
          ${[['Consultation','Completed'],['Clinical plan','Awaiting surgeon signature'],['Procedure','Not scheduled'],['Day 2-3 follow-up','Pending']].map(([a,b],i) => `<div class="step"><span>${i+1}</span><div><strong>${a}</strong><small>${b}</small></div></div>`).join('')}
        </article>
        <article class="card">
          <h2>Consent center</h2>
          <div class="consent"><span>✓</span><div><strong>Care photography</strong><small>Active for medical-record use</small></div></div>
          <div class="consent optional"><span>—</span><div><strong>AI visualization</strong><small>Optional and not granted</small></div></div>
          <div class="consent optional"><span>—</span><div><strong>Marketing publication</strong><small>Separate permission, not granted</small></div></div>
        </article>
      </section>
      <section class="card caution">
        <strong>Important</strong>
        <p>The app does not promise density, growth timing or a cosmetic result. Urgent symptoms should be handled through the clinic's emergency instructions.</p>
      </section>
    </main>
  `;
}

function photosView() {
  const views = [
    { name: 'Front / hairline', desc: 'Camera level with glabella; hair pulled back; full frontal hairline and temples.' },
    { name: 'Top / midscalp', desc: 'Head flexed to protocol angle; camera perpendicular to scalp.' },
    { name: 'Crown / vertex', desc: 'Whorl center, consistent distance and lighting.' },
    { name: 'Posterior donor', desc: 'Occipital donor zone centered, hair length documented.' },
    { name: 'Left lateral', desc: 'Temporal recession and parietal donor visible.' },
    { name: 'Right lateral', desc: 'Matched angle and zoom to the left view.' }
  ];
  return `
    ${hero()}
    <main>
      ${patientHeaderCard()}
      <section class="card">
        <span class="tag">PHOTO GUIDE</span>
        <h2>Standardized views</h2>
        <p>Six views are required. The camera guide checks framing, focus and exposure only.</p>
      </section>
      <div class="grid">
        ${views.map((v, i) => `
          <article class="card" data-view="${escapeHtml(v.name)}">
            <h2>${i + 1}. ${escapeHtml(v.name)}</h2>
            <p>${escapeHtml(v.desc)}</p>
            <div class="photo-frame mt-12 ratio-4-3">
              <div class="silhouette"></div>
              <div class="horizon"></div>
              <div class="wb-card" title="White-balance reference"></div>
              <div class="indicator">POSE ${String(i + 1).padStart(2, '0')} · 1/125s</div>
            </div>
          </article>
        `).join('')}
      </div>
      <section class="card caution">
        <strong>Capture boundary</strong>
        <p>The app does not retouch, beautify or grade your photos. Originals are stored with capture metadata and a SHA-256 hash.</p>
      </section>
    </main>
  `;
}

function planView() {
  return `
    ${hero()}
    <main>
      ${patientHeaderCard()}
      <section class="card next">
        <span class="tag">YOUR PLAN</span>
        <h2>Hairline design alternatives</h2>
        <p>Three clinician-authored options. None is a guarantee; you cannot alter a signed plan.</p>
      </section>
      <section class="card">
        <h2>Option A — Conservative</h2>
        <p>Lower central height with subtle temporal peaks. Designed for long-term natural appearance.</p>
        <div class="step"><span>A</span><div><strong>Central height</strong><small>72 mm · ∠ 78°</small></div></div>
        <div class="step"><span>•</span><div><strong>Donor estimate</strong><small>2 100 grafts available</small></div></div>
      </section>
      <section class="card">
        <h2>Option B — Balanced</h2>
        <p>Natural irregularity with slightly more frontal density. Most common patient choice.</p>
        <div class="step"><span>B</span><div><strong>Central height</strong><small>68 mm · ∠ 82°</small></div></div>
        <div class="step"><span>•</span><div><strong>Donor estimate</strong><small>2 350 grafts used</small></div></div>
      </section>
      <section class="card">
        <h2>Option C — Restorative</h2>
        <p>Denser-looking coverage, requires careful donor management. Reserved for stable loss patterns.</p>
        <div class="step"><span>C</span><div><strong>Central height</strong><small>65 mm · ∠ 84°</small></div></div>
        <div class="step"><span>•</span><div><strong>Donor estimate</strong><small>2 600 grafts used</small></div></div>
      </section>
      <section class="card caution">
        <strong>Pending</strong>
        <p>Your plan is awaiting the surgeon's signature. The clinical record is the only source of truth.</p>
      </section>
    </main>
  `;
}

function timelineView() {
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
  ];
  const active = 1; // D 1-3
  return `
    ${hero()}
    <main>
      ${patientHeaderCard()}
      <section class="card">
        <span class="tag">POSTOPERATIVE TIMELINE</span>
        <h2>Day-by-day guidance</h2>
        <p>Each checkpoint has its own instructions. Status comes from your photos, not generated progress.</p>
      </section>
      <div class="timeline-dial timeline-dial-3">
        ${ticks.map((t, i) => {
          const cls = i < active ? 'done' : i === active ? 'active' : '';
          return `<div class="tick ${cls}"><span>${t.label}</span></div>`;
        }).join('')}
      </div>
      <section class="card">
        <h2>Today — Day 1-3</h2>
        <div class="step"><span>1</span><div><strong>Sleep with head elevated 30°</strong><small>Use the travel pillow provided</small></div></div>
        <div class="step pending"><span>2</span><div><strong>Saline spray every 2 hours</strong><small>Do not rub; pat dry only</small></div></div>
        <div class="step pending"><span>3</span><div><strong>No alcohol or smoking</strong><small>Until cleared at your Day 7 visit</small></div></div>
      </section>
      <section class="card caution">
        <strong>Red flags</strong>
        <p>Excessive bleeding, fever above 38°C, sudden swelling or asymmetry. Call the clinic emergency line immediately.</p>
      </section>
    </main>
  `;
}

function messagesView() {
  const items = [
    { who: 'Dra. Helena Tanaka', when: 'Today, 09:14', text: 'Welcome to the program. Your consultation is confirmed for the 12th at 14:00.', initial: 'HT' },
    { who: 'Care team', when: 'Yesterday', text: 'Photo guide is unlocked. Please complete the six standardized views before your appointment.', initial: 'CT' },
    { who: 'Reception', when: 'Mon', text: 'Reminder: avoid anticoagulants 7 days before your procedure unless otherwise instructed.', initial: 'RX' }
  ];
  return `
    ${hero()}
    <main>
      ${patientHeaderCard()}
      <section class="card">
        <span class="tag">SECURE MESSAGES</span>
        <h2>Conversations</h2>
        <p>End-to-end encrypted. Your clinical record is separate from this thread.</p>
      </section>
      ${items.map(m => `
        <section class="card message-row">
          <div class="avatar flex-shrink-0">${escapeHtml(m.initial)}</div>
          <div class="flex-1">
            <div class="message-head">
              <strong class="message-name">${escapeHtml(m.who)}</strong>
              <span class="muted message-when">${escapeHtml(m.when)}</span>
            </div>
            <p class="photo-caption">${escapeHtml(m.text)}</p>
          </div>
        </section>
      `).join('')}
    </main>
  `;
}

function tabbar() {
  return `
    <nav class="tabbar" role="tablist" aria-label="Patient navigation">
      ${TABS.map(t => `<a href="#${t.id}" data-tab="${t.id}" class="${state.tab === t.id ? 'active' : ''}" role="tab" aria-selected="${state.tab === t.id}"><span class="ic">${t.icon}</span>${t.label}</a>`).join('')}
    </nav>
  `;
}

function render() {
  let content = '';
  if (state.tab === 'home') content = homeView();
  else if (state.tab === 'photos') content = photosView();
  else if (state.tab === 'plan') content = planView();
  else if (state.tab === 'timeline') content = timelineView();
  else if (state.tab === 'messages') content = messagesView();
  root.innerHTML = content + tabbar();
  root.querySelectorAll<HTMLElement>('[data-tab]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const tab = el.dataset.tab as Tab;
      if (tab && tab !== state.tab) { state.tab = tab; history.replaceState(null, '', `#${tab}`); render(); }
    });
  });
  root.querySelectorAll<HTMLElement>('[data-go]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const tab = el.dataset.go as Tab;
      if (tab) { state.tab = tab; history.replaceState(null, '', `#${tab}`); render(); }
    });
  });
}

const initial = (location.hash.slice(1) as Tab) || 'home';
state.tab = (['home','photos','plan','timeline','messages'].includes(initial) ? initial : 'home') as Tab;
window.addEventListener('hashchange', () => {
  const next = (location.hash.slice(1) as Tab) || 'home';
  if (next !== state.tab) { state.tab = next; render(); }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/patient/service-worker.js').catch(console.error);
render();
