/**
 * Playwright config for hitting the LIVE DigitalOcean app (no local webServer).
 */
import { defineConfig, devices } from '@playwright/test';

const BASE = (process.env.LIVE_BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app').replace(/\/$/, '');

export default defineConfig({
  testDir: './tests',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'live-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
});
