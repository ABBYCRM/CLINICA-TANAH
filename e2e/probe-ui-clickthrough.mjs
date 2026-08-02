/**
 * UI click-through every nav tab + primary CTAs on live site.
 * Proof: screenshots + HTTP/console error log.
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app';
const shotDir = '/opt/cursor/artifacts/screenshots/ui-audit';
mkdirSync(shotDir, { recursive: true });

const report = {
  started_at: new Date().toISOString(),
  base: BASE,
  pages: [],
  buttons: [],
  errors: [],
  http4xx: [],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') report.errors.push({ type: 'console', text: msg.text(), url: page.url() });
});
page.on('pageerror', (err) => report.errors.push({ type: 'pageerror', text: String(err), url: page.url() }));
page.on('response', (res) => {
  if (res.status() >= 400 && res.url().includes('/api/')) {
    report.http4xx.push({ status: res.status(), url: res.url(), page: page.url() });
  }
});

async function shot(name) {
  await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: false });
}

function bodyHasError(text) {
  return /something went wrong|uncaught|typeerror|cannot read|failed to fetch|erro interno|internal server/i.test(text);
}

console.log('→ login');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
await page.getByTestId('login-email').fill('Juliana');
await page.getByTestId('login-password').fill('1234');
await page.getByTestId('login-submit').click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25_000 });
await page.waitForTimeout(1200);
await shot('00-dashboard');

const routes = [
  { path: '/', name: 'dashboard' },
  { path: '/patients', name: 'patients' },
  { path: '/appointments', name: 'appointments' },
  { path: '/encounters', name: 'encounters' },
  { path: '/prescriptions', name: 'prescriptions' },
  { path: '/inventory', name: 'inventory' },
  { path: '/vendors', name: 'vendors' },
  { path: '/accounting', name: 'accounting' },
  { path: '/invoices', name: 'invoices' },
  { path: '/payroll', name: 'payroll' },
  { path: '/whatsapp', name: 'whatsapp' },
  { path: '/forms', name: 'forms' },
  { path: '/lgpd', name: 'lgpd' },
  { path: '/manual', name: 'manual' },
  { path: '/apps', name: 'apps' },
  { path: '/team', name: 'team' },
  { path: '/settings', name: 'settings' },
  { path: '/clinics', name: 'clinics' },
];

for (const r of routes) {
  console.log('→', r.path);
  const beforeHttp = report.http4xx.length;
  const beforeErr = report.errors.length;
  await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch((e) => {
    report.errors.push({ type: 'nav', text: e.message, url: r.path });
  });
  await page.waitForTimeout(900);
  const text = await page.locator('body').innerText().catch(() => '');
  const buttons = await page.locator('button:visible, a.btn-primary:visible, a.btn-secondary:visible').evaluateAll((els) =>
    els.slice(0, 40).map((el) => ({
      tag: el.tagName,
      text: (el.innerText || '').trim().slice(0, 80),
      disabled: !!el.disabled,
      testid: el.getAttribute('data-testid'),
    }))
  );
  // Click visible primary "new" buttons that open dialogs (then close with Escape)
  const newBtns = page.locator('[data-testid^="new-"], button.btn-primary:visible').first();
  let clickedNew = false;
  try {
    if (await newBtns.count() && await newBtns.isVisible()) {
      const label = await newBtns.innerText().catch(() => '');
      if (/novo|new|criar|adicionar|add|\+/i.test(label) || (await newBtns.getAttribute('data-testid') || '').startsWith('new-')) {
        await newBtns.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        clickedNew = true;
        await shot(`${String(routes.indexOf(r) + 1).padStart(2, '0')}-${r.name}-form`);
        await page.keyboard.press('Escape');
        // also try cancel button
        const cancel = page.getByRole('button', { name: /cancelar|cancel|fechar|close/i }).first();
        if (await cancel.count()) await cancel.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  } catch (e) {
    report.errors.push({ type: 'click-new', text: String(e.message || e), url: r.path });
  }

  // Tab switches if present
  const tabs = page.locator('.crm-feed-tab:visible, [role="tab"]:visible, button.crm-feed-tab');
  const tabCount = await tabs.count().catch(() => 0);
  for (let i = 0; i < Math.min(tabCount, 6); i++) {
    try {
      await tabs.nth(i).click({ timeout: 2000 });
      await page.waitForTimeout(350);
    } catch { /* ignore */ }
  }

  await shot(`${String(routes.indexOf(r) + 1).padStart(2, '0')}-${r.name}`);
  report.pages.push({
    path: r.path,
    name: r.name,
    url: page.url(),
    text_snippet: text.slice(0, 200),
    has_error_text: bodyHasError(text),
    buttons: buttons.length,
    button_samples: buttons.slice(0, 12),
    clicked_new: clickedNew,
    tabs_clicked: Math.min(tabCount, 6),
    new_http_errors: report.http4xx.length - beforeHttp,
    new_console_errors: report.errors.length - beforeErr,
  });
  report.buttons.push({ path: r.path, buttons });
  console.log('  buttons', buttons.length, 'tabs', tabCount, 'httpΔ', report.http4xx.length - beforeHttp);
}

// Patient workspace deep dive
console.log('→ patient workspace');
await page.goto(`${BASE}/patients`, { waitUntil: 'networkidle', timeout: 45_000 });
const firstPatient = page.locator('a[href^="/patients/"]').first();
if (await firstPatient.count()) {
  await firstPatient.click();
  await page.waitForURL(/\/patients\//, { timeout: 15_000 });
  await page.waitForTimeout(1000);
  await shot('19-patient-record');
  const wsTabs = page.locator('button').filter({ hasText: /visão|overview|clínico|clinical|timeline|tarefas|tasks|privacidade|privacy|body|corpo/i });
  const n = await wsTabs.count();
  for (let i = 0; i < Math.min(n, 10); i++) {
    try {
      const label = await wsTabs.nth(i).innerText();
      await wsTabs.nth(i).click({ timeout: 2000 });
      await page.waitForTimeout(600);
      await shot(`19-patient-tab-${i}-${label.slice(0, 20).replace(/\s+/g, '_')}`);
      report.pages.push({ path: page.url(), name: `patient-tab-${label}`, ok: true });
    } catch { /* ignore */ }
  }
  // click first timeline item if any
  const timelineItem = page.locator('[data-testid^="timeline-"], .timeline-item, button').filter({ hasText: /consulta|atendimento|receita|agendamento|invoice|fatura/i }).first();
  if (await timelineItem.count()) {
    await timelineItem.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
    await shot('19-timeline-inspector');
  }
}

// Encounters / Prescriptions retention tabs explicitly
for (const [path, active, cancelled] of [
  ['/encounters', 'enc-tab-active', 'enc-tab-cancelled'],
  ['/prescriptions', 'rx-tab-active', 'rx-tab-cancelled'],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  for (const tid of [active, cancelled]) {
    const b = page.getByTestId(tid);
    if (await b.count()) {
      await b.click();
      await page.waitForTimeout(500);
      await shot(`20-${path.slice(1)}-${tid}`);
      report.pages.push({ path, name: tid, clicked: true });
    }
  }
}

report.finished_at = new Date().toISOString();
report.summary = {
  pages: report.pages.length,
  pages_with_error_text: report.pages.filter((p) => p.has_error_text).length,
  console_errors: report.errors.filter((e) => e.type === 'console' || e.type === 'pageerror').length,
  api_http_errors: report.http4xx.length,
  unique_api_errors: [...new Set(report.http4xx.map((h) => `${h.status} ${h.url.split('?')[0]}`))],
};

writeFileSync('/opt/cursor/artifacts/ui-clickthrough.json', JSON.stringify(report, null, 2));
console.log('\n=== UI SUMMARY ===');
console.log(JSON.stringify(report.summary, null, 2));
await browser.close();
process.exit(report.summary.pages_with_error_text || report.summary.console_errors > 5 ? 2 : 0);
