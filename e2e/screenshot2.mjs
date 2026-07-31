/** Visual check: MedX patient form + WhatsApp campaigns/surveys tabs. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3100';
mkdirSync('/tmp/shots', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

await p.goto(`${BASE}/login`);
await p.getByTestId('login-email').fill('Juliana');
await p.getByTestId('login-password').fill('1234');
await p.getByTestId('login-submit').click();
await p.waitForURL(/\/$/, { timeout: 15_000 });

await p.goto(`${BASE}/patients`);
await p.getByTestId('new-patient').click();
await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/shots/patient-form.png', fullPage: false });
await p.keyboard.press('Escape');

// create a campaign to see the tab
await p.goto(`${BASE}/whatsapp`);
await p.getByTestId('tab-campaigns').click();
await p.getByTestId('new-campaign').click();
await p.getByTestId('campaign-name').fill('Dia do Cliente — Agosto');
await p.getByTestId('campaign-message').fill('Olá {{name}}! 💙 Semana do Cliente: 20% off em dermatologia. Agende pelo WhatsApp!');
await p.getByTestId('form-submit').click();
await p.waitForTimeout(800);
const card = p.locator('.card', { hasText: 'Dia do Cliente — Agosto' });
await card.getByRole('button', { name: /disparar/i }).click();
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/shots/campaigns.png' });

await p.getByTestId('tab-surveys').click();
await p.waitForTimeout(800);
await p.screenshot({ path: '/tmp/shots/surveys.png' });

await browser.close();
console.log('done');
