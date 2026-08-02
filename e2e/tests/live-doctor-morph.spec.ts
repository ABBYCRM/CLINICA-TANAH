/**
 * LIVE Playwright — doctor Δkg morph must change AFTER pixels vs BEFORE.
 *   LIVE_BASE_URL=https://clinica-tanah-bbqu7.ondigitalocean.app npx playwright test \
 *     --config e2e/playwright.live.config.ts e2e/tests/live-doctor-morph.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BASE = (process.env.LIVE_BASE_URL || 'https://clinica-tanah-bbqu7.ondigitalocean.app').replace(/\/$/, '');
const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';
const SHOT = '/opt/cursor/artifacts/screenshots/live-doctor-morph';
mkdirSync(SHOT, { recursive: true });

function meanAbsDiff(beforePath: string, afterPath: string): number | null {
  const py = `
from PIL import Image
import sys
a = Image.open(sys.argv[1]).convert('RGB').resize((160, 240))
b = Image.open(sys.argv[2]).convert('RGB').resize((160, 240))
pa = list(a.getdata()); pb = list(b.getdata())
s = 0.0; n = 0
for (r1,g1,b1),(r2,g2,b2) in zip(pa, pb):
    s += abs(r1-r2)+abs(g1-g2)+abs(b1-b2); n += 3
print((s / n / 255.0) if n else 1.0)
`;
  const res = spawnSync('python3', ['-c', py, beforePath, afterPath], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const v = Number(String(res.stdout || '').trim());
  return Number.isFinite(v) ? v : null;
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/($|\?)/, { timeout: 30_000 });
}

test.describe('LIVE doctor morph', () => {
  test.setTimeout(240_000);

  test('José: predicted loss unlocks generate and AFTER ≠ BEFORE', async ({ page, request }) => {
    // API: login + find José
    const login = await request.post(`${BASE}/api/auth/login`, {
      data: { email: 'Juliana', password: PASSWORD },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const patients = await request.get(`${BASE}/api/patients?q=${encodeURIComponent('José Carlos')}&limit=10`, { headers });
    expect(patients.ok()).toBeTruthy();
    const plist = await patients.json();
    const jose = (plist.patients || []).find((p: any) => /Jos[eé]\s+Carlos\s+Pereira/i.test(p.full_name || ''));
    expect(jose?.id, 'José must exist on live').toBeTruthy();

    // Ensure body consents + measurement exist (redeploy may wipe)
    await request.post(`${BASE}/api/clinical/body/${jose.id}/consents`, {
      headers,
      data: { purposes: ['clinical_record', 'image_processing', 'generative_ai'] },
    });

    const body = await request.get(`${BASE}/api/clinical/body/${jose.id}`, { headers });
    expect(body.ok()).toBeTruthy();
    const bodyJson = await body.json();
    expect(bodyJson.simulations_allowed, 'simulations_allowed').toBeTruthy();

    // UI path
    await signIn(page);
    await page.goto(`${BASE}/patients/${jose.id}`);
    await expect(page.getByTestId('patient-workspace')).toBeVisible({ timeout: 20_000 });

    const clinical = page.getByTestId('workspace-tab-clinical');
    if (await clinical.count()) await clinical.click();
    const bodyTab = page.getByTestId('chart-tab-corpo')
      .or(page.getByTestId('chart-tab-body'))
      .or(page.getByRole('button', { name: /corpo|body/i }))
      .first();
    await expect(bodyTab).toBeVisible({ timeout: 15_000 });
    await bodyTab.click();
    await page.getByTestId('body-tab-scenarios').click();
    await expect(page.getByTestId('body-scenarios-full')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('sim-doctor-loss')).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: path.join(SHOT, '01-scenarios-panel.png'), fullPage: false });

    const gen = page.getByTestId('sim-generate');
    await expect(gen).toBeDisabled();
    await page.getByTestId('sim-predicted-loss').fill('40');
    await expect(page.getByTestId('sim-doctor-loss-preview')).toContainText(/40|58/);
    await page.getByTestId('sim-step-password').fill(PASSWORD);
    await expect(gen).toBeEnabled();

    const scenarioPost = page.waitForResponse(
      (r) => r.request().method() === 'POST'
        && /\/api\/clinical\/body\/[^/]+\/scenarios\/?$/.test(new URL(r.url()).pathname)
        && !r.url().includes('preview'),
      { timeout: 180_000 },
    );
    await gen.click();
    const resp = await scenarioPost;
    const created = await resp.json().catch(() => ({}));
    expect(resp.ok(), JSON.stringify(created)).toBeTruthy();
    expect(created.execution_plan?.doctor_override).toBe(true);
    expect(Number(created.execution_plan?.deltas?.weight_kg)).toBeCloseTo(-40, 0);
    const scenarioId = created.id || created.scenario?.id;
    expect(scenarioId).toBeTruthy();

    // Wait for card completed 4/4
    await expect.poll(async () => {
      const card = page.getByTestId(`body-scenario-${scenarioId}`);
      if (!(await card.count())) return 'missing';
      return (await card.innerText()).replace(/\s+/g, ' ').slice(0, 120);
    }, { timeout: 120_000 }).toMatch(/4\s*\/\s*4|Conclu|completed/i);

    await page.getByTestId(`body-scenario-${scenarioId}`).click();
    await page.screenshot({ path: path.join(SHOT, '02-after-generate.png'), fullPage: true });

    // Fetch before/after bytes via API and assert pixel difference
    const afterRes = await request.get(
      `${BASE}/api/clinical/body/${jose.id}/scenarios/${scenarioId}/image?view=front`,
      { headers },
    );
    expect(afterRes.ok()).toBeTruthy();
    const afterBuf = Buffer.from(await afterRes.body());

    const sessionId = bodyJson.active_capture_session?.id
      || (await (await request.get(`${BASE}/api/clinical/body/${jose.id}`, { headers })).json()).active_capture_session?.id;
    expect(sessionId).toBeTruthy();
    const beforeRes = await request.get(
      `${BASE}/api/clinical/body/${jose.id}/capture-sessions/${sessionId}/assets/front/image`,
      { headers },
    );
    expect(beforeRes.ok()).toBeTruthy();
    const beforeBuf = Buffer.from(await beforeRes.body());

    const beforePath = path.join(SHOT, `live-before-${scenarioId}.jpg`);
    const afterPath = path.join(SHOT, `live-after-${scenarioId}.jpg`);
    writeFileSync(beforePath, beforeBuf);
    writeFileSync(afterPath, afterBuf);

    expect(afterBuf.equals(beforeBuf), 'AFTER must not be byte-identical to BEFORE').toBeFalsy();
    const diff = meanAbsDiff(beforePath, afterPath);
    expect(diff, 'mean abs pixel diff').not.toBeNull();
    expect(diff!, `diff=${diff}`).toBeGreaterThan(0.02);

    // Provider should reflect real morph, not silent noop
    const polled = await request.get(`${BASE}/api/clinical/body/${jose.id}/scenarios/${scenarioId}`, { headers });
    const sc = (await polled.json()).scenario || await polled.json();
    expect(String(sc.provider || '')).toMatch(/morph/i);
    expect(sc.output_view_count).toBeGreaterThanOrEqual(4);

    writeFileSync(path.join(SHOT, 'result.json'), JSON.stringify({
      patient_id: jose.id,
      scenario_id: scenarioId,
      provider: sc.provider,
      views: sc.output_view_count,
      doctor_override: sc.execution_plan?.doctor_override,
      delta: sc.execution_plan?.deltas?.weight_kg,
      mean_abs_diff: diff,
      identical_bytes: afterBuf.equals(beforeBuf),
    }, null, 2));
  });
});
