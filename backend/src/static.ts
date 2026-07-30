/**
 * Production static serving: serve the React build from the same Express app.
 * Mounted at the end so /api routes take priority.
 */
import express from 'express';
import path from 'path';
import fs from 'fs';

export function mountStatic(app: express.Express): void {
  // Look in backend/public, sibling frontend/dist, or env FRONTEND_DIST
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
  app.use(express.static(dist));
  // SPA fallback
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'));
  });
}
