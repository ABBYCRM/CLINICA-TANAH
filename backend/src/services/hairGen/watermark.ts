/**
 * Spec-mandated watermark wrapper from TANAH-HAIR-GEN.
 * Every AI output is labeled as a hypothetical visualization.
 */

const DEFAULT_WATERMARK = 'HYPOTHETICAL VISUALIZATION';
const DEFAULT_SUBTEXT = 'NOT A PREDICTION OR GUARANTEE OF RESULTS · TANAH-HAIR';

const VIEW_LABELS: Record<string, string> = {
  front: 'FRONTAL',
  top: 'TOP',
  left: 'LEFT LATERAL',
  right: 'RIGHT LATERAL',
  crown: 'CROWN',
  back: 'OCCIPUT',
};

function viewLabel(view?: string | null): string | null {
  if (!view) return null;
  return VIEW_LABELS[String(view).toLowerCase()] || String(view).toUpperCase();
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!,
  );
}

export function watermarkedImageDataUrl(opts: {
  image: { data: string; mimeType: string };
  view?: string | null;
  watermark?: string;
  subtext?: string;
  width?: number;
  height?: number;
}): string {
  const width = opts.width ?? 1024;
  const height = opts.height ?? 1024;
  const safeWatermark = esc(opts.watermark ?? DEFAULT_WATERMARK);
  const safeSubtext = esc(opts.subtext ?? DEFAULT_SUBTEXT);
  const viewTag = viewLabel(opts.view);
  const badgeWidth = 130;
  const badgeHeight = 26;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
  <image href="data:${opts.image.mimeType};base64,${opts.image.data}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
  ${viewTag ? `<g><rect x="${width - badgeWidth - 14}" y="14" width="${badgeWidth}" height="${badgeHeight}" rx="4" fill="#0F172A" fill-opacity="0.78"/><text x="${width - badgeWidth / 2 - 14}" y="32" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#5EEAD4" letter-spacing="1.0">${viewTag}</text></g>` : ''}
  <rect x="0" y="${height - 80}" width="${width}" height="80" fill="#0F172A" fill-opacity="0.92"/>
  <text x="${width / 2}" y="${height - 50}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#fff" letter-spacing="0.8">${safeWatermark}</text>
  <text x="${width / 2}" y="${height - 24}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" fill="#5EEAD4" letter-spacing="0.4">${safeSubtext}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
