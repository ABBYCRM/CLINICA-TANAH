/**
 * Playwright UI walkthrough — José Carlos body composition on live.
 *
 *   BASE_URL=https://clinica-tanah-bbqu7.ondigitalocean.app \
 *   OUT_DIR=/opt/cursor/artifacts/jose-body \
 *   node scripts/jose-body-ui-shots.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = (process.env.BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || '/opt/cursor/artifacts/jose-body';
const PATIENT = process.env.PATIENT_ID || 'd5c78191-eb34-483e-9a44-4978c2677860';
const USER = process.env.ADMIN_USER || 'Juliana';
const PASS = process.env.ADMIN_PASSWORD || '12345678';

fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('✓', file);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(45_000);

  console.log(`▸ Login ${BASE}`);
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-email').fill(USER);
  await page.getByTestId('login-password').fill(PASS);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 });

  console.log(`▸ Open José ${PATIENT}`);
  await page.goto(`${BASE}/patients/${PATIENT}`);
  await page.waitForTimeout(1500);
  await shot(page, '01-patient-record');

  await page.getByTestId('workspace-tab-clinical').click();
  await page.waitForTimeout(800);
  await page.getByTestId('chart-tab-corpo').click();
  await page.getByTestId('body-prontuario').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(1200);
  await shot(page, '02-body-capture');

  await page.getByTestId('body-tab-measurements').click();
  await page.waitForTimeout(800);
  await shot(page, '03-body-measurements');

  await page.getByTestId('body-tab-lifestyle').click();
  await page.waitForTimeout(800);
  await shot(page, '04-body-lifestyle');

  await page.getByTestId('body-tab-scenarios').click();
  await page.waitForTimeout(1500);
  await shot(page, '05-body-scenarios');

  await page.getByTestId('body-tab-reports').click();
  await page.waitForTimeout(1000);
  await shot(page, '06-body-reports');

  // Documentos tab if present
  const docsTab = page.getByTestId('workspace-tab-documents');
  if (await docsTab.count()) {
    await docsTab.click();
    await page.waitForTimeout(1200);
    await shot(page, '07-documents');
  }

  await browser.close();
  console.log('✅ José body UI shots done →', OUT);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
