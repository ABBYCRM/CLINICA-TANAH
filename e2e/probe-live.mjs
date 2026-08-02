/** Probe live DigitalOcean site for console/page errors with Playwright. */
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app';
mkdirSync('/opt/cursor/artifacts/screenshots', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const logs = [];
page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text() }));
page.on('pageerror', (err) => logs.push({ type: 'pageerror', text: String(err) }));
page.on('response', (res) => {
  if (res.status() >= 400) logs.push({ type: 'http', text: `${res.status()} ${res.url()}` });
});

async function shot(name) {
  await page.screenshot({ path: `/opt/cursor/artifacts/screenshots/${name}.png`, fullPage: true });
}

console.log('→ login page');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(1000);
await shot('live-login');

const bodyText = await page.locator('body').innerText().catch(() => '');
console.log('LOGIN BODY SNIPPET:', JSON.stringify(bodyText.slice(0, 500)));

console.log('→ sign in');
await page.getByTestId('login-email').fill('Juliana');
await page.getByTestId('login-password').fill('1234');
await page.getByTestId('login-submit').click();
try {
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 });
} catch (e) {
  logs.push({ type: 'nav', text: `login did not navigate: ${page.url()}` });
}
await page.waitForTimeout(1500);
await shot('live-after-login');
const dashText = await page.locator('body').innerText().catch(() => '');
console.log('AFTER LOGIN SNIPPET:', JSON.stringify(dashText.slice(0, 800)));
console.log('URL:', page.url());

// Visit a few routes for tenant/PWA issues
for (const path of ['/patients', '/appointments', '/clinics', '/settings']) {
  console.log('→', path);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch((e) => {
    logs.push({ type: 'nav', text: `${path}: ${e.message}` });
  });
  await page.waitForTimeout(800);
  await shot(`live${path.replace(/\//g, '-') || '-home'}`);
  const t = await page.locator('body').innerText().catch(() => '');
  if (/error|erro|failed|não encontrado|something went wrong/i.test(t)) {
    console.log('POSSIBLE ERROR TEXT on', path, ':', JSON.stringify(t.slice(0, 400)));
  }
}

writeFileSync('/opt/cursor/artifacts/live-playwright-logs.json', JSON.stringify(logs, null, 2));
console.log('\n=== LOGS ===');
for (const l of logs) console.log(`[${l.type}] ${l.text}`);
console.log('total log lines', logs.length);

await browser.close();
