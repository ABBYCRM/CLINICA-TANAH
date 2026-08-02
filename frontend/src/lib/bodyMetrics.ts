/**
 * Shared body anthropometric helpers — mirrors backend normalizeHeightCm / calcBmi.
 * Used by Medidas prévia and any UI that must not treat meters as centimeters.
 */

/** Values in (0.5, 2.5] are meters mistaken as cm (e.g. 1.80 → 180). */
export function normalizeHeightCm(height?: number | null): number | null {
  if (height == null || !Number.isFinite(height) || height <= 0) return null;
  let cm = height;
  if (height > 0.5 && height <= 2.5) {
    cm = Math.round(height * 1000) / 10;
  }
  if (cm < 50 || cm > 250) return null;
  return cm;
}

export function calcBmi(heightCm?: number | null, weightKg?: number | null): number | null {
  const h = normalizeHeightCm(heightCm);
  if (!h || !weightKg || weightKg <= 0) return null;
  const m = h / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function parsePlanParams(plan: any): Record<string, any> {
  if (!plan) return {};
  const raw = plan.params;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return typeof raw === 'object' ? raw : {};
}
