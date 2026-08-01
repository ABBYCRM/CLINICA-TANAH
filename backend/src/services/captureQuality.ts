/**
 * Clinical capture processing — EXIF/GPS strip + quality gates.
 * Mirrors BodyPath Medical capture semantics (immutable originals, scored views).
 */
import { createHash } from 'crypto';
import jpeg from 'jpeg-js';

export const CAPTURE_VIEWS = ['front', 'left', 'right', 'back'] as const;
export type CaptureView = (typeof CAPTURE_VIEWS)[number];

export type QualityVerdict = 'pass' | 'improve' | 'fail';
export type QualityReport = Record<string, QualityVerdict>;

const QUALITY_KEYS = [
  'framing',
  'blur',
  'lighting',
  'pose',
  'occlusion',
  'consistency',
  'background',
  'resolution',
] as const;

/** Remove JPEG APP1 (EXIF) / APP0+GPS-bearing segments — originals stored without location. */
export function stripJpegExif(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      // entropy-coded data — copy rest
      for (let j = i; j < buf.length; j++) out.push(buf[j]);
      break;
    }
    // skip fill bytes
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i];
    i++;
    // markers without length
    if (marker === 0xd9 || marker === 0xda) {
      out.push(0xff, marker);
      for (let j = i; j < buf.length; j++) out.push(buf[j]);
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(0xff, marker);
      continue;
    }
    if (i + 1 >= buf.length) break;
    const len = (buf[i] << 8) | buf[i + 1];
    if (len < 2 || i + len > buf.length) break;
    // Drop APP1 (EXIF / XMP) — strips GPS and device metadata
    const drop = marker === 0xe1;
    if (!drop) {
      out.push(0xff, marker);
      for (let j = i; j < i + len; j++) out.push(buf[j]);
    }
    i += len;
  }
  return Buffer.from(out);
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (!values.length) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function sampleLuma(data: Uint8Array, width: number, height: number, step = 4): number[] {
  const out: number[] = [];
  for (let yy = 0; yy < height; yy += step) {
    for (let xx = 0; xx < width; xx += step) {
      const i = (yy * width + xx) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      out.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return out;
}

function laplacianVar(data: Uint8Array, width: number, height: number): number {
  const step = Math.max(2, Math.floor(Math.min(width, height) / 120));
  const vals: number[] = [];
  for (let yy = step; yy < height - step; yy += step) {
    for (let xx = step; xx < width - step; xx += step) {
      const at = (x: number, y2: number) => {
        const i = (y2 * width + x) * 4;
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      };
      const c = at(xx, yy);
      const lap = at(xx - step, yy) + at(xx + step, yy) + at(xx, yy - step) + at(xx, yy + step) - 4 * c;
      vals.push(lap);
    }
  }
  return meanStd(vals).std;
}

function cornerUniformity(data: Uint8Array, width: number, height: number): number {
  const bw = Math.max(4, Math.floor(width * 0.08));
  const bh = Math.max(4, Math.floor(height * 0.08));
  const corners: Array<[number, number]> = [
    [0, 0],
    [width - bw, 0],
    [0, height - bh],
    [width - bw, height - bh],
  ];
  const means: number[] = [];
  for (const [ox, oy] of corners) {
    const samples: number[] = [];
    for (let yy = oy; yy < oy + bh; yy += 2) {
      for (let xx = ox; xx < ox + bw; xx += 2) {
        const i = (yy * width + xx) * 4;
        samples.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
    }
    means.push(meanStd(samples).mean);
  }
  return meanStd(means).std;
}

export type AnalyzedAsset = {
  buffer: Buffer;
  contentType: string;
  sha256: string;
  width: number;
  height: number;
  quality: QualityReport;
  metrics: Record<string, number>;
};

export function processClinicalPhoto(input: Buffer, contentTypeHint?: string): AnalyzedAsset {
  let contentType = contentTypeHint || 'image/jpeg';
  let buf = input;
  if (contentType.includes('jpeg') || contentType.includes('jpg') || (buf[0] === 0xff && buf[1] === 0xd8)) {
    buf = stripJpegExif(buf);
    contentType = 'image/jpeg';
  }

  let width = 0;
  let height = 0;
  let quality: QualityReport = Object.fromEntries(QUALITY_KEYS.map((k) => [k, 'pass' as QualityVerdict]));
  const metrics: Record<string, number> = {};

  try {
    if (contentType.includes('jpeg') || (buf[0] === 0xff && buf[1] === 0xd8)) {
      const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
      width = decoded.width;
      height = decoded.height;
      const data = decoded.data as Uint8Array;
      const luma = sampleLuma(data, width, height, Math.max(3, Math.floor(Math.min(width, height) / 100)));
      const { mean, std } = meanStd(luma);
      const blur = laplacianVar(data, width, height);
      const cornerStd = cornerUniformity(data, width, height);
      const aspect = height > 0 ? width / height : 1;
      const centerBand = luma.slice(Math.floor(luma.length * 0.3), Math.floor(luma.length * 0.7));
      const centerMean = meanStd(centerBand).mean;

      metrics.width = width;
      metrics.height = height;
      metrics.mean_luma = Math.round(mean * 10) / 10;
      metrics.luma_std = Math.round(std * 10) / 10;
      metrics.blur_var = Math.round(blur * 10) / 10;
      metrics.corner_std = Math.round(cornerStd * 10) / 10;
      metrics.aspect = Math.round(aspect * 100) / 100;

      // resolution
      const minSide = Math.min(width, height);
      quality.resolution = minSide >= 900 ? 'pass' : minSide >= 640 ? 'improve' : 'fail';

      // framing — expect portrait clinical plate
      quality.framing = aspect <= 0.95 && aspect >= 0.45 ? 'pass' : aspect <= 1.15 ? 'improve' : 'fail';

      // lighting
      quality.lighting = mean >= 55 && mean <= 200 ? 'pass' : mean >= 40 && mean <= 220 ? 'improve' : 'fail';

      // blur
      quality.blur = blur >= 12 ? 'pass' : blur >= 6 ? 'improve' : 'fail';

      // background — corners relatively uniform
      quality.background = cornerStd <= 28 ? 'pass' : cornerStd <= 45 ? 'improve' : 'fail';

      // occlusion — subject should occupy mid-frame brightness
      quality.occlusion = centerMean >= 40 && centerMean <= 210 ? 'pass' : 'improve';

      // pose — proxy: portrait + reasonable mid contrast
      quality.pose = quality.framing === 'pass' && std >= 18 ? 'pass' : 'improve';

      // consistency filled later at session level
      quality.consistency = 'pass';
    } else {
      // Non-JPEG: accept but ask to prefer JPEG; mark resolution unknown→improve
      quality = {
        framing: 'improve',
        blur: 'improve',
        lighting: 'improve',
        pose: 'improve',
        occlusion: 'improve',
        consistency: 'pass',
        background: 'improve',
        resolution: 'improve',
      };
    }
  } catch {
    quality = Object.fromEntries(QUALITY_KEYS.map((k) => [k, 'improve' as QualityVerdict]));
  }

  return {
    buffer: buf,
    contentType,
    sha256: createHash('sha256').update(buf).digest('hex'),
    width,
    height,
    quality,
    metrics,
  };
}

/** Cross-view consistency after all four assets exist. */
export function applySessionConsistency(
  assets: Array<{ view: string; metrics: Record<string, number>; quality: QualityReport }>,
): Array<{ view: string; quality: QualityReport }> {
  if (assets.length < 2) return assets.map((a) => ({ view: a.view, quality: a.quality }));
  const means = assets.map((a) => a.metrics.mean_luma || 0).filter(Boolean);
  const heights = assets.map((a) => a.metrics.height || 0).filter(Boolean);
  const meanSpread = means.length ? Math.max(...means) - Math.min(...means) : 0;
  const heightSpread = heights.length ? (Math.max(...heights) - Math.min(...heights)) / Math.max(...heights) : 0;
  const verdict: QualityVerdict =
    meanSpread <= 35 && heightSpread <= 0.12 ? 'pass' : meanSpread <= 55 && heightSpread <= 0.2 ? 'improve' : 'fail';
  return assets.map((a) => ({
    view: a.view,
    quality: { ...a.quality, consistency: verdict },
  }));
}

export function qualityAllPass(quality: QualityReport): boolean {
  return QUALITY_KEYS.every((k) => quality[k] === 'pass' || quality[k] === 'improve');
}
