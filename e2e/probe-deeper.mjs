import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = 'https://clinica-tanah-bbqu7.ondigitalocean.app';
mkdirSync('/opt/cursor/artifacts/screenshots', { recursive: true });
const browser = await chromium.launch();

async function run(label, opts) {
  const ctx = await browser.newContext({ ...opts, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => { if (m.type()==='error' || m.type()==='warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e}`));
  page.on('response', r => { if (r.status()>=400) logs.push(`[http ${r.status()}] ${r.url()}`); });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  // bad login first — capture error message UI
  await page.getByTestId('login-email').fill('bad@example.com');
  await page.getByTestId('login-password').fill('wrong');
  await page.getByTestId('login-submit').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/opt/cursor/artifacts/screenshots/${label}-bad-login.png`, fullPage: true });
  const err = await page.locator('[role="alert"], .text-rose-600, .text-red-600, .bg-rose-50').allTextContents().catch(()=>[]);
  console.log(label, 'bad-login alerts:', err);

  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill('1234');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `/opt/cursor/artifacts/screenshots/${label}-dash.png`, fullPage: true });

  // Create clinic flow
  await page.goto(`${BASE}/clinics`, { waitUntil: 'networkidle' });
  await page.getByTestId('new-clinic').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/opt/cursor/artifacts/screenshots/${label}-clinic-modal.png`, fullPage: true });
  await page.locator('input').nth(0).fill('Clínica Teste E2E');
  // fill form fields by label
  const inputs = page.locator('form input');
  const count = await inputs.count();
  console.log(label, 'form inputs', count);
  // slug
  await page.locator('input[pattern]').fill('clinica-teste-e2e');
  await page.locator('input[type="email"]').fill(`admin-teste-${Date.now()}@example.com`);
  await page.locator('input[type="password"]').fill('pass12345');
  // admin name - find by preceding label text
  await page.locator('form').getByRole('textbox').nth(4).fill('Admin Teste').catch(()=>{});
  // try submit
  await page.locator('form button[type="submit"], form .btn-primary').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/opt/cursor/artifacts/screenshots/${label}-clinic-after.png`, fullPage: true });
  const body = await page.locator('body').innerText();
  const errSnips = body.split('\n').filter(l => /erro|error|fail|inválid|invalid|duplicate|required|validation/i.test(l));
  console.log(label, 'error-like lines:', errSnips.slice(0, 15));
  console.log(label, 'console:', logs);
  await ctx.close();
}

await run('desktop', { viewport: { width: 1440, height: 900 } });
await run('mobile', devices['Pixel 7']);
await browser.close();
