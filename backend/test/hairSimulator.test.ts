/**
 * TANAH-HAIR simulator port — parametric SVG render + presets (no Gemini required).
 */
import { describe, it, expect } from 'vitest';
import {
  HAIRLINE_PRESETS,
  COVERAGE_ZONES,
  renderSimulation,
  renderPhotoSimulation,
  renderVariants,
  DEMO_SCALP,
} from '../src/services/hairSimulator';

describe('hairSimulator (TANAH-HAIR port)', () => {
  it('exposes hairline and zone catalogs', () => {
    expect(Object.keys(HAIRLINE_PRESETS)).toContain('balanced');
    expect(COVERAGE_ZONES.full.grafts).toBe(3400);
    expect(DEMO_SCALP.width).toBe(347);
  });

  it('renders a watermarked parametric SVG data URL', () => {
    const art = renderSimulation({
      hairline: 'balanced',
      zone: 'full',
      density: 0.55,
      length: 'short',
      color: 'darkBrown',
      skinTone: 'medium',
      seed: 42,
    });
    expect(art.outputDataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(art.grafts).toBe(3400);
    expect(art.label).toMatch(/HYPOTHETICAL/i);
    const svg = Buffer.from(art.outputDataUrl.split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('HYPOTHETICAL VISUALIZATION');
    expect(svg).toContain('<svg');
  });

  it('renders deterministic output for the same seed', () => {
    const a = renderSimulation({ seed: 99, density: 0.4 });
    const b = renderSimulation({ seed: 99, density: 0.4 });
    expect(a.outputDataUrl).toBe(b.outputDataUrl);
  });

  it('renders photo simulation without photo bytes (avatar-only fallback path)', () => {
    const art = renderPhotoSimulation({
      hairline: 'conservative',
      zone: 'frontal',
      density: 0.5,
      photoBase64: null,
    });
    expect(art.outputDataUrl).toMatch(/^data:image\/svg\+xml/);
  });

  it('renders three hairline variants', () => {
    const variants = renderVariants({ zone: 'full', density: 0.6 });
    expect(variants).toHaveLength(3);
    expect(variants.map((v: any) => v.hairline).sort()).toEqual(['balanced', 'conservative', 'restorative']);
  });
});
