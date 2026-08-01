/**
 * Generate PWA icons (PNG) from the brand mark for Android, iOS, and Windows.
 * Run: npx tsx scripts/generate-icons.mjs  (or node)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

function brandSvg(size, { rounded = false, maskable = false } = {}) {
  const pad = maskable ? size * 0.2 : size * 0.18;
  const stroke = Math.max(size * 0.08, 4);
  const r = rounded ? size * 0.22 : 0;
  const bg = maskable
    ? `<rect width="${size}" height="${size}" fill="#0d9488"/>`
    : `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#0d9488"/>`;
  const cx = size / 2;
  const cy = size / 2;
  const arm = size / 2 - pad;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  <path d="M${cx} ${cy - arm}v${arm * 2}M${cx - arm} ${cy}h${arm * 2}"
        stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round"/>
</svg>`);
}

async function writePng(file, size, opts) {
  const buf = await sharp(brandSvg(size, opts)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, file), buf);
  console.log(`  ✓ icons/${file} (${size}×${size})`);
}

async function main() {
  console.log('Generating PWA icons…');
  await writePng('icon-192.png', 192, { rounded: true });
  await writePng('icon-512.png', 512, { rounded: true });
  await writePng('icon-maskable-192.png', 192, { maskable: true });
  await writePng('icon-maskable-512.png', 512, { maskable: true });
  await writePng('apple-touch-icon.png', 180, { rounded: false });
  // Windows Start / tiles
  await writePng('icon-144.png', 144, { rounded: true });
  await writePng('mstile-150x150.png', 150, { maskable: true });
  // Copy apple-touch to public root for iOS convention
  fs.copyFileSync(
    path.join(outDir, 'apple-touch-icon.png'),
    path.join(__dirname, '..', 'public', 'apple-touch-icon.png'),
  );
  console.log('  ✓ apple-touch-icon.png (public root)');
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
