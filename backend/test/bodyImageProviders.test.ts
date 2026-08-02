import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateBodyScenarioImage, imageProvidersStatus } from '../src/services/bodyImage';

const ENV_KEYS = [
  'A2E_API_KEY', 'A2E_ENABLED',
  'GEMINI_API_KEY', 'GEMINI_ENABLED',
  'OPENAI_API_KEY', 'OPENAI_ENABLED', 'OPENAI_IMAGE_MODEL',
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

describe('body image providers', () => {
  afterEach(() => restoreEnv());

  it('enables local_morph by default and reports bitdeer only when configured', () => {
    stashEnv();
    delete process.env.BITDEER_API_KEY;
    delete process.env.BITDEER_BASE_URL;
    delete process.env.LOCAL_MORPH_FALLBACK;
    process.env.A2E_ENABLED = '0';
    process.env.GEMINI_ENABLED = '0';
    process.env.OPENAI_ENABLED = '0';
    delete process.env.A2E_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const status = imageProvidersStatus();
    expect(status.local_morph).toBe(true);
    expect(status.bitdeer).toBe(false);
    expect(status.openai).toBe(false);
    expect(status.order).toEqual(['local_morph']);
  });

  it('includes openai in provider order when OPENAI_API_KEY is set', () => {
    stashEnv();
    process.env.A2E_ENABLED = '0';
    process.env.GEMINI_ENABLED = '0';
    delete process.env.A2E_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.BITDEER_API_KEY;
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_IMAGE_MODEL = 'gpt-image-1';
    process.env.IMAGE_PROVIDER_ORDER = 'gemini,a2e,openai,local_morph';
    process.env.LOCAL_MORPH_FALLBACK = '1';

    const status = imageProvidersStatus();
    expect(status.openai).toBe(true);
    expect(status.openai_model).toBe('gpt-image-1');
    expect(status.order).toEqual(['openai', 'local_morph']);
  });

  it('falls through to local_morph per-view when A2E cannot img2img without public URL', async () => {
    stashEnv();
    process.env.A2E_ENABLED = 'true';
    process.env.A2E_API_KEY = 'test-key';
    process.env.GEMINI_ENABLED = '0';
    process.env.OPENAI_ENABLED = '0';
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.BITDEER_API_KEY;
    delete process.env.BITDEER_BASE_URL;
    process.env.LOCAL_MORPH_FALLBACK = '1';
    process.env.IMAGE_PROVIDER_ORDER = 'a2e,gemini,openai,bitdeer,local_morph';

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'body-img-'));
    const left = path.join(dir, 'left.jpg');
    const right = path.join(dir, 'right.jpg');
    fs.writeFileSync(left, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x01, 0x02, 0x03, 0x04]));
    fs.writeFileSync(right, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x05, 0x06, 0x07, 0x08]));

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
    expect(leftRes.imageBytes?.equals(fs.readFileSync(left))).toBe(true);

    expect(rightRes.status).toBe('completed');
    expect(rightRes.provider).toBe('local_morph');
    expect(rightRes.imageBytes?.equals(fs.readFileSync(right))).toBe(true);
    // Distinct per-view references — not a shared front hallucination
    expect(leftRes.imageBytes?.equals(rightRes.imageBytes!)).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
