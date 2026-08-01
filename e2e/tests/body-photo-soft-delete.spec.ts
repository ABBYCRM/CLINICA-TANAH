/**
 * Soft-delete body capture photos — hide from chart, retain files (CFM/LGPD).
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ADMIN = 'Juliana';
const PASSWORD = '12345678';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

function writeTempJpeg(label: string): string {
  const p = path.join(os.tmpdir(), `tanah-del-${label}-${Date.now()}.jpg`);
  execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (480, 640), (90, 110, 130))
d = ImageDraw.Draw(im)
d.rectangle([60,80,420,560], outline=(220,200,180), width=4)
d.text((160,40), ${JSON.stringify(label)}, fill=(255,255,255))
im.save(${JSON.stringify(p)}, format='JPEG', quality=85)
`]);
  return p;
}

test.describe('Body photo soft-delete retention', () => {
  test.setTimeout(120_000);

  test('API soft-delete retains file and hides from clinical session', async ({ request, baseURL }) => {
    const login = await request.post(`${baseURL}/api/auth/login`, {
      data: { email: ADMIN, password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const patients = await request.get(`${baseURL}/api/patients?q=Ana%20Beatriz`, { headers });
    const plist = await patients.json();
    const ana = (plist.patients || plist).find((p: any) => /Ana Beatriz/i.test(p.full_name));
    expect(ana?.id).toBeTruthy();

    const overview = await request.get(`${baseURL}/api/clinical/body/${ana.id}`, { headers });
    const body = await overview.json();
    const seeded = (body.capture_sessions || []).find((s: any) => s.status === 'complete' && s.assets?.back);
    expect(seeded?.id).toBeTruthy();
    expect(seeded.assets.back).toBeTruthy();

    const del = await request.delete(
      `${baseURL}/api/clinical/body/capture-sessions/${seeded.id}/assets/back`,
      { headers },
    );
    expect(del.ok()).toBeTruthy();
    const delBody = await del.json();
    expect(delBody.clinical_retention).toBe(true);
    expect(delBody.deleted_at).toBeTruthy();
    expect(delBody.session?.assets?.back).toBeFalsy();
    expect(delBody.session?.assets?.front).toBeTruthy(); // other views remain

    const again = await request.get(
      `${baseURL}/api/clinical/body/${ana.id}/capture-sessions/${seeded.id}`,
      { headers },
    );
    const sess = await again.json();
    expect(sess.assets?.back).toBeFalsy();

    // Retained copy on disk
    const dbPath = path.resolve('e2e/.data/clinica-tanah.db');
    const row = execFileSync('sqlite3', [
      dbPath,
      `SELECT deleted_at IS NOT NULL, retained_path, image_path FROM body_capture_assets WHERE session_id='${seeded.id}' AND view='back';`,
    ]).toString().trim();
    const [deleted, retainedPath, imagePath] = row.split('|');
    expect(deleted).toBe('1');
    expect(retainedPath).toBeTruthy();
    expect(fs.existsSync(retainedPath)).toBe(true);
    expect(fs.existsSync(imagePath)).toBe(true); // original also kept
  });

  test('UI exposes delete + retention notice', async ({ page }) => {
    await signIn(page);
    await page.goto('/patients');
    const row = page.locator('[data-testid^="patient-row-"]').filter({ hasText: /Ana Beatriz/ }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await page.waitForURL(/\/patients\//);
    await page.getByTestId('workspace-tab-clinical').click();
    await page.getByTestId('chart-tab-corpo').click();
    await page.getByTestId('body-tab-capture').click();
    await expect(page.getByTestId('body-capture-studio')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('capture-new-session').click();
    await expect(page.getByTestId('capture-status')).toContainText(/Nova sessão|New session|Nueva sesión/i, { timeout: 10_000 });

    const jpg = writeTempJpeg('FRONT');
    await page.getByTestId('capture-file-input').setInputFiles(jpg);
    await expect(page.getByTestId('capture-status')).toContainText(/enviada|uploaded|sucesso|éxito/i, { timeout: 20_000 });
    fs.unlinkSync(jpg);

    await expect(page.getByTestId('capture-delete-photo')).toBeVisible();
    await expect(page.getByTestId('capture-retention-hint')).toContainText(/reten|CFM|LGPD|archive|archivo/i);
    await expect(page.getByTestId('capture-delete-all')).toBeVisible();
  });
});
