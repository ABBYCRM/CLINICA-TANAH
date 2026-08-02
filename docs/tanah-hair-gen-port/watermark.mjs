// Build a watermarked data URL for a generated image.
// The spec-mandated English watermark is applied to every output so
// every render is clearly labeled as a hypothetical visualization, not
// a clinical prediction. The view label is optional (used by multi-view
// renders) so the front/back/top/side gallery is obvious at a glance.

const DEFAULT_WATERMARK = 'HYPOTHETICAL VISUALIZATION';
const DEFAULT_SUBTEXT = 'NOT A PREDICTION OR GUARANTEE OF RESULTS · TANAH-HAIR';

// Map view IDs to their human-readable short labels that appear in the
// top-right corner badge. Matches the spec's hair-transplant visual
// framework: FRONTAL / TOP / LEFT LATERAL / RIGHT LATERAL / CROWN / OCCIPUT.
const VIEW_LABELS = {
  front: 'FRONTAL',
  top:   'TOP',
  left:  'LEFT LATERAL',
  right: 'RIGHT LATERAL',
  crown: 'CROWN',
  back:  'OCCIPUT'
};

function viewLabel(view) {
  if (!view) return null;
  return VIEW_LABELS[String(view).toLowerCase()] || String(view).toUpperCase();
}

export function watermarkedImageDataUrl({ image, view, watermark = DEFAULT_WATERMARK, subtext = DEFAULT_SUBTEXT, width = 1024, height = 1024 }) {
  // Escape any quotes inside the labels (defensive; user-provided
  // watermark text could in theory come from a future CMS hook).
  const safeWatermark = String(watermark).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeSubtext = String(subtext).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const viewTag = viewLabel(view);
  const badgeWidth = 130;
  const badgeHeight = 26;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
  <image href="data:${image.mimeType};base64,${image.data}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
  ${viewTag ? `<g><rect x="${width - badgeWidth - 14}" y="14" width="${badgeWidth}" height="${badgeHeight}" rx="4" fill="#0F172A" fill-opacity="0.78"/><text x="${width - badgeWidth / 2 - 14}" y="32" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="700" fill="#5EEAD4" letter-spacing="1.0">${viewTag}</text></g>` : ''}
  <rect x="0" y="${height - 80}" width="${width}" height="80" fill="#0F172A" fill-opacity="0.92"/>
  <text x="${width / 2}" y="${height - 50}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="700" fill="#fff" letter-spacing="0.8">${safeWatermark}</text>
  <text x="${width / 2}" y="${height - 24}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" fill="#5EEAD4" letter-spacing="0.4">${safeSubtext}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
