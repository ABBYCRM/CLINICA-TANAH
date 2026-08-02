/**
 * E2E — doctor-predicted Δkg image generator (new morph path).
 * Fills predicted loss / target weight, step-up password, generates 4-view AFTER images.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const PASSWORD = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.E2E_PASSWORD || '12345678';
const SHOT = '/opt/cursor/artifacts/screenshots/doctor-predicted-image-gen';
mkdirSync(SHOT, { recursive: true });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('Juliana');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
}

async function openMariaScenarios(page: Page) {
  await page.goto('/patients');
  const row = page.locator('[data-testid^="patient-row-"]').filter({ hasText: 'Maria Aparecida' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.waitForURL(/\/patients\//, { timeout: 15_000 });
  await expect(page.getByTestId('patient-workspace')).toBeVisible({ timeout: 15_000 });

  const clinical = page.getByTestId('workspace-tab-clinical');
  if (await clinical.count()) await clinical.click();
  else {
    const open = page.getByTestId('action-open-clinical');
    if (await open.count()) await open.click();
  }

  const bodyTab = page.getByTestId('chart-tab-corpo')
    .or(page.getByTestId('chart-tab-body'))
    .or(page.getByRole('button', { name: /corpo|body/i }))
    .first();
  await expect(bodyTab).toBeVisible({ timeout: 15_000 });
  await bodyTab.click();

  await page.getByTestId('body-tab-scenarios').click();
  await expect(page.getByTestId('body-scenarios-full')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sim-generate-panel')).toBeVisible({ timeout: 10_000 });
}

async function apiLogin(request: APIRequestContext, baseURL: string) {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { email: 'Juliana', password: PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  return json.token as string;
}

test.describe('Doctor-predicted image generator', () => {
  test.setTimeout(180_000);

  test('API: preview + generate with doctor Δkg yields 4-view morph', async ({ request, baseURL }) => {
    expect(baseURL).toBeTruthy();
    const token = await apiLogin(request, baseURL!);
    const headers = { Authorization: `Bearer ${token}` };

    const patients = await request.get(`${baseURL}/api/patients?q=${encodeURIComponent('Maria Aparecida')}&limit=10`, { headers });
    expect(patients.ok()).toBeTruthy();
    const plist = await patients.json();
    const maria = (plist.patients || []).find((p: any) => /Maria Aparecida/i.test(p.full_name || ''));
    expect(maria?.id).toBeTruthy();

    const preview = await request.post(`${baseURL}/api/clinical/body/${maria.id}/scenarios/preview`, {
      headers,
      data: {
        horizon_weeks: 12,
        doctor_predicted_loss_kg: 18,
        target_weight_kg: 74.5,
        assumptions: { change_magnitude: 'moderate' },
      },
    });
    expect(preview.ok(), await preview.text()).toBeTruthy();
    const previewBody = await preview.json();
    const plan = previewBody.execution_plan || previewBody;
    expect(plan.ok).toBe(true);
    expect(plan.doctor_override).toBe(true);
    expect(plan.deltas.weight_kg).toBeCloseTo(-18, 0);
    expect(Math.abs(plan.silhouette_delta_pct || 0)).toBeGreaterThan(7);

    const step = await request.post(`${baseURL}/api/auth/step-up`, {
      headers,
      data: { password: PASSWORD },
    });
    expect(step.ok()).toBeTruthy();
    const { step_up_token } = await step.json();

    const create = await request.post(`${baseURL}/api/clinical/body/${maria.id}/scenarios`, {
      headers: { ...headers, 'x-step-up': step_up_token },
      data: {
        title: 'E2E doctor Δkg — Maria',
        goal: 'Teste e2e morph com perda prevista pelo clínico',
        weeks: 12,
        horizon_weeks: 12,
        generate: true,
        photorealism: true,
        doctor_predicted_loss_kg: 18,
        target_weight_kg: 74.5,
        change_magnitude: 'moderate',
        sleep_adequate: true,
        hydration_adequate: true,
        recovery_adequate: true,
        comorbidity_stable: true,
      },
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const created = await create.json();
    const scenarioId = created.id || created.scenario?.id;
    expect(scenarioId).toBeTruthy();
    expect(created.execution_plan?.doctor_override || created.scenario?.execution_plan?.doctor_override).toBe(true);

    let final: any = created.scenario || created;
    for (let i = 0; i < 48; i++) {
      const st = String(final.status || '');
      if (st && !['generating', 'queued', 'pending'].includes(st)) break;
      await new Promise((r) => setTimeout(r, 1500));
      const polled = await request.get(`${baseURL}/api/clinical/body/${maria.id}/scenarios/${scenarioId}`, { headers });
      expect(polled.ok()).toBeTruthy();
      const body = await polled.json();
      final = body.scenario || body;
    }

    expect(['completed', 'ready'].includes(String(final.status)), JSON.stringify({
      status: final.status,
      error: final.error,
      provider: final.provider,
    })).toBeTruthy();

    const viewCount = final.output_view_count
      ?? Object.values(final.output_views || {}).filter((v: any) => v?.has_image).length
      ?? (final.has_image ? 1 : 0);
    expect(viewCount).toBeGreaterThanOrEqual(4);

    const deltas = final.execution_plan?.deltas || final.deltas;
    expect(Number(deltas?.weight_kg)).toBeCloseTo(-18, 0);

    console.log(JSON.stringify({
      patient: maria.full_name,
      scenario_id: scenarioId,
      status: final.status,
      provider: final.provider,
      output_view_count: viewCount,
      doctor_override: final.execution_plan?.doctor_override,
      weight_delta: deltas?.weight_kg,
      projected_weight: final.execution_plan?.projected?.weight_kg || final.projected?.weight_kg,
    }));
  });

  test('UI: doctor loss required then Gerar imagem produces AFTER views', async ({ page }, testInfo) => {
    // Desktop project only for full generate (avoid double cloud spend / time on mobile)
    test.skip(testInfo.project.name !== 'desktop-chrome', 'full generate on desktop only');

    await signIn(page);
    await openMariaScenarios(page);

    const gen = page.getByTestId('sim-generate');
    await expect(gen).toBeDisabled();
    await expect(page.getByTestId('sim-doctor-loss-needed')).toBeVisible();

    await page.getByTestId('sim-predicted-loss').fill('18');
    await expect(page.getByTestId('sim-target-weight')).toHaveValue(/74[.,]5/);
    await expect(page.getByTestId('sim-doctor-loss-preview')).toContainText(/92[.,]5/);
    await expect(page.getByTestId('sim-doctor-loss-needed')).toHaveCount(0);

    await page.getByTestId('sim-step-password').fill(PASSWORD);
    await expect(gen).toBeEnabled();

    await page.screenshot({
      path: path.join(SHOT, 'before-generate.png'),
      fullPage: false,
    });

    const scenarioPost = page.waitForResponse(
      (r) => r.request().method() === 'POST'
        && /\/api\/clinical\/body\/[^/]+\/scenarios\/?$/.test(new URL(r.url()).pathname)
        && !r.url().includes('preview'),
      { timeout: 120_000 },
    );
    await gen.click();
    const resp = await scenarioPost;
    const body = await resp.json().catch(() => ({}));
    expect(resp.ok(), JSON.stringify(body)).toBeTruthy();
    expect(body.execution_plan?.doctor_override || body.scenario?.execution_plan?.doctor_override).toBe(true);
    expect(Number(body.execution_plan?.deltas?.weight_kg ?? body.scenario?.execution_plan?.deltas?.weight_kg)).toBeCloseTo(-18, 0);

    const scenarioId = body.id || body.scenario?.id;
    expect(scenarioId).toBeTruthy();

    // Poll until this scenario shows 4/4 (generation may finish in the same POST or shortly after)
    await expect.poll(async () => {
      const card = page.getByTestId(`body-scenario-${scenarioId}`);
      if (!(await card.count())) return 'missing-card';
      const text = await card.innerText();
      if (/failed|falha/i.test(text)) return `failed:${text}`;
      if (/4\s*\/\s*4/.test(text) || /completed|ready/i.test(text)) return 'done';
      return text.slice(0, 80);
    }, { timeout: 90_000, intervals: [500, 1000, 2000] }).toBe('done');

    await page.getByTestId(`body-scenario-${scenarioId}`).click();
    await expect(page.getByTestId('sim-inspector')).toContainText(/4\s*\/\s*4|completed|local_morph/i, { timeout: 15_000 });

    await page.screenshot({
      path: path.join(SHOT, 'after-generate.png'),
      fullPage: true,
    });
  });
});
