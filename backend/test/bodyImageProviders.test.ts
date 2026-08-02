import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jpeg from 'jpeg-js';
import { generateBodyScenarioImage, imageProvidersStatus } from '../src/services/bodyImage';

const ENV_KEYS = [
  'A2E_API_KEY', 'A2E_ENABLED',
  'GEMINI_API_KEY', 'GEMINI_ENABLED',
  'BITDEER_API_KEY', 'BITDEER_BASE_URL', 'BITDEER_ENABLED',
  'LOCAL_MORPH_FALLBACK', 'IMAGE_PROVIDER_ORDER',
] as const;

const saved: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {};

function stashEnv() {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function writeViewJpeg(filePath: string, tone: number) {
  const w = 80;
  const h = 120;
  const data = Buffer.alloc(w * h * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = tone;
    data[i + 1] = Math.max(0, tone - 20);
    data[i + 2] = Math.max(0, tone - 40);
  }
  // Distinct vertical band so left/right refs differ after morph too
  for (let y = 30; y < 90; y++) {
    for (let x = 25; x < 55; x++) {
      const i = (y * w + x) * 3;
      data[i] = 220;
      data[i + 1] = 180;
      data[i + 2] = 150;
    }
  }
  fs.writeFileSync(filePath, jpeg.encode({ width: w, height: h, data }, 90).data);
}

describe('body image providers', () => {
  afterEach(() => restoreEnv());

  it('enables local_morph by default and reports bitdeer only when configured', () => {
    stashEnv();
    delete process.env.BITDEER_API_KEY;
    delete process.env.BITDEER_BASE_URL;
    delete process.env.LOCAL_MORPH_FALLBACK;
    process.env.A2E_ENABLED = '0';
    process.env.GEMINI_ENABLED = '0';
    delete process.env.A2E_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const status = imageProvidersStatus();
    expect(status.local_morph).toBe(true);
    expect(status.bitdeer).toBe(false);
    expect(status.order).toEqual(['local_morph']);
  });

  it('falls through to local_morph per-view when A2E cannot img2img without public URL', async () => {
    stashEnv();
    process.env.A2E_ENABLED = 'true';
    process.env.A2E_API_KEY = 'test-key';
    process.env.GEMINI_ENABLED = '0';
    delete process.env.GEMINI_API_KEY;
    delete process.env.BITDEER_API_KEY;
    delete process.env.BITDEER_BASE_URL;
    process.env.LOCAL_MORPH_FALLBACK = '1';
    process.env.IMAGE_PROVIDER_ORDER = 'a2e,gemini,bitdeer,local_morph';

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'body-img-'));
    const left = path.join(dir, 'left.jpg');
    const right = path.join(dir, 'right.jpg');
    writeViewJpeg(left, 100);
    writeViewJpeg(right, 160);

    const leftRes = await generateBodyScenarioImage({
      name: 'test-left',
      prompt: 'left profile clinical edit',
      referencePath: left,
      referencePublicUrl: null,
    });
    const rightRes = await generateBodyScenarioImage({
      name: 'test-right',
      prompt: 'right profile clinical edit',
      referencePath: right,
      referencePublicUrl: null,
    });

    expect(leftRes.status).toBe('completed');
    expect(leftRes.provider).toBe('local_morph');
    // Must NOT be a noop copy of before (prod bug)
    expect(leftRes.imageBytes?.equals(fs.readFileSync(left))).toBe(false);

    expect(rightRes.status).toBe('completed');
    expect(rightRes.provider).toBe('local_morph');
    expect(rightRes.imageBytes?.equals(fs.readFileSync(right))).toBe(false);
    // Distinct per-view references — not a shared front hallucination
    expect(leftRes.imageBytes?.equals(rightRes.imageBytes!)).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
