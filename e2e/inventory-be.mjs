import fs from 'node:fs';
import path from 'node:path';

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const files = walk('backend/src/routes');
const routes = [];
const re = /\b(router|r)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(t))) {
    routes.push({ file: f.replace(/\\/g, '/'), method: m[2].toUpperCase(), path: m[3] });
  }
}
fs.writeFileSync('/opt/cursor/artifacts/inventory-be-routes.json', JSON.stringify(routes, null, 2));
console.log('BE route handlers:', routes.length);
for (const r of routes) console.log(r.method.padEnd(6), r.path.padEnd(50), '←', path.basename(r.file));
