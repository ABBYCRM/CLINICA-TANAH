import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || '3100';
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Clínica Tanah e2e suite.
 * Boots the real app (seeded SQLite + built frontend) via webServer and
 * checks every spec twice: desktop Chrome and a mobile (Pixel 7) viewport.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node serve.mjs',
    cwd: __dirname,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
    },
  },
});
