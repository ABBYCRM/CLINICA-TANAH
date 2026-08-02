import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateBodyScenarioImage, morphGuidanceFromEnvelope } from '../src/services/bodyImage';

describe('morphGuidanceFromEnvelope', () => {
  it('maps If/Then envelope into signed silhouette + regional deltas for after-image', () => {
    const g = morphGuidanceFromEnvelope({
      ok: true,
      silhouette_delta_pct: -10.7,
      deltas: { weight_kg: -10.5, fat_mass_kg: -10.3, ffm_kg: -0.2, waist_cm: -5.1 },
      img2img_pipeline_config: {
        version: 'v5',
        identity_locks: ['face', 'height', 'clothing'],
        effective_silhouette_delta_pct: 7,
        magnitude_ceiling_pct: 7,
        rag_kg_preserved_pct: 7,
      },
      regional_anatomical_deltas_pct: {
        waist: -2.7, abdomen: -3.1, hip: -1.8, arm: 0.5, thigh: -0.4, chest: -0.2, neck: 0,
      },
    });
    expect(g).toBeTruthy();
    expect(g!.silhouette_delta_pct).toBe(-7); // capped for img2img
    expect(g!.regional_deltas_pct.waist).toBe(-2.7);
    expect(g!.regional_deltas_pct.abdomen).toBe(-3.1);
    expect(g!.weight_delta_kg).toBe(-10.5);
    expect(g!.identity_locks).toContain('face');
  });
});

describe('local_morph uses calculator guidance', () => {
  it('produces a different after image when silhouette guidance is applied', async () => {
    process.env.A2E_ENABLED = '0';
    process.env.GEMINI_ENABLED = '0';
    delete process.env.A2E_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.BITDEER_API_KEY;
    process.env.LOCAL_MORPH_FALLBACK = '1';
    process.env.IMAGE_PROVIDER_ORDER = 'local_morph';

    // Valid tiny RGB JPEG via Python
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-guide-'));
    const ref = path.join(dir, 'before.jpg');
    const { spawnSync } = await import('child_process');
    spawnSync('python3', ['-c', `
from PIL import Image
im = Image.new('RGB', (120, 200), (180, 140, 120))
im.save(${JSON.stringify(ref)}, 'JPEG')
`]);
    expect(fs.existsSync(ref)).toBe(true);

    const before = fs.readFileSync(ref);
    const res = await generateBodyScenarioImage({
      name: 'guided-after',
      prompt: 'CALCULATED AFTER weight_delta_kg=-10.5',
      referencePath: ref,
      morphGuidance: {
        silhouette_delta_pct: -7,
        regional_deltas_pct: { waist: -2.7, abdomen: -3.1, hip: -1.8 },
        weight_delta_kg: -10.5,
      },
    });
    expect(res.status).toBe('completed');
    expect(res.provider).toBe('local_morph');
    expect(res.imageBytes).toBeTruthy();
    expect(res.imageBytes!.equals(before)).toBe(false);
    expect((res.raw as any)?.morph_guidance?.silhouette_delta_pct).toBe(-7);
  });
});
