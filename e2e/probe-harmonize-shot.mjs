import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4099';
mkdirSync('/opt/cursor/artifacts/screenshots/harmonize', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByTestId('login-email').fill('Juliana');
await page.getByTestId('login-password').fill('1234');
await page.getByTestId('login-submit').click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);

await page.goto(`${BASE}/patients`, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(600);
const link = page.locator('a[href^="/patients/"]').first();
if (!(await link.count())) {
  console.log('No patients — creating one via API');
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const res = await fetch(`${BASE}/api/patients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      full_name: 'Harmonize Test',
      birth_date: '1990-01-15',
      phone: '+5511999000111',
      lgpd_consent_granted: true,
      chronic_conditions: ['Asma leve'],
      health_insurance: 'Amil',
      address_city: 'São Paulo',
      address_state: 'SP',
    }),
  });
  const p = await res.json();
  console.log('created', res.status, p.id);
  await page.goto(`${BASE}/patients/${p.id}`, { waitUntil: 'networkidle' });
} else {
  await link.click();
  await page.waitForURL(/\/patients\//, { timeout: 15000 });
}
await page.waitForTimeout(1000);

const clinical = page.getByTestId('workspace-tab-clinical');
if (await clinical.count()) {
  await clinical.click();
  await page.waitForTimeout(1200);
}

await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/harmonize/01-clinical-capture.png', fullPage: true });
await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/harmonize/01-clinical-capture-viewport.png', fullPage: false });

const meas = page.getByTestId('body-tab-measurements');
if (await meas.count()) {
  await meas.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/harmonize/02-measurements.png', fullPage: false });
}

await page.getByTestId('workspace-tab-overview').click().catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/harmonize/03-overview.png', fullPage: false });

console.log('URL', page.url());
console.log('DONE');
await browser.close();
