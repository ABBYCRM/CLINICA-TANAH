/**
 * Mobile body capture — gallery upload must work without capture= forcing camera-only.
 * Pixel 7 project only.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';

test.skip(({ isMobile }) => !isMobile, 'Mobile-only capture checks');

const ADMIN = 'Juliana';
const PASSWORD = '12345678';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

function writeTempJpeg(): string {
  const p = path.join(os.tmpdir(), `tanah-capture-${Date.now()}.jpg`);
  try {
    execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (720, 960), (70, 90, 120))
d = ImageDraw.Draw(im)
d.rectangle([80,100,640,860], outline=(220,200,180), width=6)
d.text((200,40), 'FRONT', fill=(255,255,255))
im.save(${JSON.stringify(p)}, format='JPEG', quality=85)
`]);
  } catch {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
    ]);
    fs.writeFileSync(p, jpeg);
  }
  return p;
}

test('body capture studio has separate gallery + camera inputs on mobile', async ({ page }) => {
  await signIn(page);
  await page.goto('/patients');
  await expect(page.getByTestId('patients-crm')).toBeVisible({ timeout: 15_000 });

  const patientLink = page.locator('[data-testid^="patient-row-"]').first();
  await expect(patientLink).toBeVisible({ timeout: 15_000 });
  await patientLink.click();
  await page.waitForURL(/\/patients\//, { timeout: 15_000 });

  await page.getByTestId('workspace-tab-clinical').click();
  await page.getByTestId('chart-tab-corpo').click();

  await expect(page.getByTestId('body-capture-studio')).toBeVisible({ timeout: 15_000 });

  const gate = page.getByTestId('capture-consent-gate');
  if (await gate.isVisible().catch(() => false)) {
    await page.getByTestId('capture-grant-consents').click();
    await expect(page.getByTestId('capture-choose-photo')).toBeVisible({ timeout: 15_000 });
  }

  await expect(page.getByTestId('capture-choose-photo')).toBeVisible();
  await expect(page.getByTestId('capture-take-photo')).toBeVisible();

  const gallery = page.getByTestId('capture-file-input');
  const camera = page.getByTestId('capture-camera-input');
  await expect(gallery).toHaveAttribute('accept', /image/);
  const galleryCapture = await gallery.getAttribute('capture');
  expect(galleryCapture == null || galleryCapture === '').toBeTruthy();
  await expect(camera).toHaveAttribute('capture', 'environment');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `capture page overflows by ${overflow}px`).toBeLessThanOrEqual(2);

  const jpegPath = writeTempJpeg();
  await gallery.setInputFiles(jpegPath);
  await expect(page.getByTestId('body-capture-studio')).toBeVisible();
  await expect(page.getByTestId('capture-status')).toBeVisible({ timeout: 20_000 });
  const text = await page.getByTestId('capture-status').innerText();
  expect(text.length).toBeGreaterThan(0);
  const crashed = await page.locator('text=/Something went wrong|Unhandled|TypeError/i').count();
  expect(crashed).toBe(0);
  fs.unlinkSync(jpegPath);
});
