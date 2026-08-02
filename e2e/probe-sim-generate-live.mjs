/**
 * Live smoke: Cenários shows Gerar imagem on mobile + desktop.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app';
const SHOT = '/opt/cursor/artifacts/screenshots/sim-generate-live';
mkdirSync(SHOT, { recursive: true });

async function check(label, contextOptions) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill('1234');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/($|\?)/, { timeout: 30_000 });

  await page.goto(`${BASE}/patients`, { waitUntil: 'domcontentloaded' });
  const row = page.locator('[data-testid^="patient-row-"]').filter({ hasText: 'Maria Aparecida' }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page.waitForURL(/\/patients\//, { timeout: 20_000 });

  const clinical = page.getByTestId('workspace-tab-clinical');
  if (await clinical.count()) await clinical.click();
  else {
    const open = page.getByTestId('action-open-clinical');
    if (await open.count()) await open.click();
  }

  await page.getByTestId('chart-tab-corpo').click();
  await page.getByTestId('body-tab-scenarios').click();
  await page.getByTestId('body-scenarios-full').waitFor({ timeout: 20_000 });

  const panel = page.getByTestId('sim-generate-panel');
  const gen = page.getByTestId('sim-generate');
  await panel.waitFor({ timeout: 10_000 });
  await panel.scrollIntoViewIfNeeded();
  const visible = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight, text: el.textContent?.slice(0, 80) };
  });
  const labelText = await gen.innerText();
  const sticky = await page.getByTestId('sim-sticky-generate').isVisible();
  await page.getByTestId('sim-step-password').fill('1234');
  const enabled = await gen.isEnabled();

  await page.screenshot({ path: path.join(SHOT, `${label}.png`), fullPage: false });
  await browser.close();

  const ok = visible.top < visible.vh * 0.9 && /Gerar imagem/i.test(labelText) && sticky && enabled;
  console.log(JSON.stringify({ label, ok, labelText, sticky, enabled, visible }, null, 2));
  if (!ok) process.exitCode = 1;
}

await check('desktop', { viewport: { width: 1280, height: 720 } });
await check('mobile', { ...devices['Pixel 7'] });
console.log('done');
