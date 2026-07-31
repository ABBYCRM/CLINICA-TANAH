/**
 * Production static serving: serve the React + PWA build from the same Express app.
 * Mounted at the end so /api routes take priority.
 */
import express from 'express';
import path from 'path';
import fs from 'fs';

function isPwaControlFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return (
    base === 'sw.js' ||
    base === 'registerSW.js' ||
    base.endsWith('.webmanifest') ||
    base.startsWith('workbox-')
  );
}

export function mountStatic(app: express.Express): void {
  const candidates = [
    process.env.FRONTEND_DIST,
    path.join(__dirname, '..', 'public'),
    path.join(__dirname, '..', '..', 'frontend', 'dist'),
  ].filter(Boolean) as string[];

  const dist = candidates.find((p) => fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html')));
  if (!dist) {
    console.log('ℹ️  No frontend dist found — running in API-only mode');
    return;
  }
  console.log(`📦 Serving frontend from: ${dist}`);

  app.use(express.static(dist, {
    setHeaders(res, filePath) {
      if (isPwaControlFile(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Service-Worker-Allowed', '/');
      }
    },
  }));

  // SPA fallback — keep /api and asset files alone
  app.get(/^(?!\/api).*/, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const ext = path.extname(req.path);
    if (ext && ext !== '.html') return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}
