/** Local visual check: capture login + dashboard on desktop and mobile. */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3100';
mkdirSync('/tmp/shots', { recursive: true });

const browser = await chromium.launch();

// Desktop
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dp = await desktop.newPage();
await dp.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await dp.waitForTimeout(700);
await dp.screenshot({ path: '/tmp/shots/login-desktop.png' });
await dp.getByTestId('login-email').fill('Juliana');
await dp.getByTestId('login-password').fill('1234');
await dp.getByTestId('login-submit').click();
await dp.waitForURL(/\/$/, { timeout: 15_000 });
await dp.waitForTimeout(700);
await dp.screenshot({ path: '/tmp/shots/dashboard-desktop.png' });
await desktop.close();

// Mobile
const mobile = await browser.newContext({ ...devices['Pixel 7'] });
const mp = await mobile.newPage();
await mp.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await mp.waitForTimeout(700);
await mp.screenshot({ path: '/tmp/shots/login-mobile.png' });
await mp.getByTestId('login-email').fill('Juliana');
await mp.getByTestId('login-password').fill('1234');
await mp.getByTestId('login-submit').click();
await mp.waitForURL(/\/$/, { timeout: 15_000 });
await mp.waitForTimeout(700);
await mp.screenshot({ path: '/tmp/shots/dashboard-mobile.png' });
await mp.getByTestId('mobile-menu-button').click();
await mp.waitForTimeout(500);
await mp.screenshot({ path: '/tmp/shots/drawer-mobile.png' });
await mobile.close();

await browser.close();
console.log('screenshots written to /tmp/shots');
