import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = 'https://clinica-tanah-bbqu7.ondigitalocean.app';
mkdirSync('/opt/cursor/artifacts/screenshots', { recursive: true });
const browser = await chromium.launch();
for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['mobile', devices['Pixel 7']]]) {
  const ctx = await browser.newContext({ ...opts, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => logs.push({ type: 'pageerror', text: String(e) }));
  page.on('response', r => { if (r.status() >= 400) logs.push({ type: 'http', text: `${r.status()} ${r.url()}` }); });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill('1234');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `/opt/cursor/artifacts/screenshots/painel-${label}.png`, fullPage: true });
  const body = await page.locator('body').innerText();
  console.log('===', label, 'URL', page.url());
  console.log('error-like:', body.split('\n').filter(l => /erro|error|fail|inválid|exception|ocorreu|tente novamente|undefined|NaN/i.test(l)).slice(0, 20));
  // visible error UI
  const alerts = await page.locator('[data-testid*="error"], .text-rose-600, .text-red-600, .bg-rose-50, [role="alert"]').allTextContents();
  console.log('alerts:', alerts);
  console.log('logs:', logs.filter(l => l.type === 'error' || l.type === 'pageerror' || l.type === 'http'));
  // dashboard cards text
  console.log('snippet:', JSON.stringify(body.slice(0, 600)));
  await ctx.close();
}
await browser.close();
