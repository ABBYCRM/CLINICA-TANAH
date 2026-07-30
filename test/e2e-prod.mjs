// Quick Playwright E2E for Clínica Tanah production
import { chromium } from 'playwright';

const URL = 'https://clinica-tanah.onrender.com';

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }

t('Health endpoint', async () => {
  const r = await fetch(`${URL}/api/health`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (!d.ok) throw new Error('health not ok');
});

t('Login + dashboard', async () => {
  const r = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@clinica-tanah.com.br', password: 'clinica2026' }),
  });
  if (!r.ok) throw new Error(`login HTTP ${r.status}`);
  const d = await r.json();
  if (!d.token) throw new Error('no token');
  const dr = await fetch(`${URL}/api/dashboard`, { headers: { Authorization: `Bearer ${d.token}` } });
  const dd = await dr.json();
  if (dd.patients_total < 1) throw new Error(`no patients (got ${dd.patients_total})`);
});

t('WhatsApp trilingual bot with new specialties', async () => {
  const lr = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@clinica-tanah.com.br', password: 'clinica2026' }),
  });
  const { token } = await lr.json();
  for (const [lang, body, expected] of [
    ['pt-BR', 'oi', 'Dermatologia'],
    ['es', 'hola', 'Dermatología'],
    ['en', 'hello', 'Dermatology'],
  ]) {
    const r = await fetch(`${URL}/api/whatsapp/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ phone: `+5511999${Math.floor(Math.random() * 1000000)}`, body, locale: lang }),
    });
    const d = await r.json();
    if (!d.last_bot_reply?.body?.includes(expected)) {
      throw new Error(`${lang} bot reply missing "${expected}" — got: ${d.last_bot_reply?.body?.slice(0, 80)}`);
    }
  }
});

t('Booking routes to correct specialty doctor', async () => {
  const lr = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@clinica-tanah.com.br', password: 'clinica2026' }),
  });
  const { token } = await lr.json();
  // 1. Greet
  const phone = `+55119887766${Math.floor(Math.random() * 100)}`;
  await fetch(`${URL}/api/whatsapp/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone, body: 'oi', locale: 'pt-BR' }),
  });
  // 2. Choose option 1 (booking) - asks for CPF
  await fetch(`${URL}/api/whatsapp/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone, body: '1', locale: 'pt-BR' }),
  });
  // 3. Provide CPF
  await fetch(`${URL}/api/whatsapp/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone, body: '12345678901', locale: 'pt-BR' }),
  });
  // 4. Choose specialty 2 = Transplante Capilar
  const r = await fetch(`${URL}/api/whatsapp/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone, body: '2', locale: 'pt-BR' }),
  });
  const d = await r.json();
  // Expect the bot to mention "Transplante Capilar" or "Dr. Roberto Silva" or "amanhã"
  const reply = d.last_bot_reply?.body || '';
  if (!reply.toLowerCase().includes('amanh') && !reply.toLowerCase().includes('data')) {
    throw new Error(`Expected date prompt, got: ${reply.slice(0, 100)}`);
  }
});

t('Browser: login + sidebar nav + language switch', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[type=email]', 'admin@clinica-tanah.com.br');
  await page.fill('input[type=password]', 'clinica2026');
  await page.click('button[type=submit]');
  await page.waitForURL(`${URL}/`, { timeout: 30000 });
  await page.waitForSelector('text=Bem-vindo de volta', { timeout: 15000 });
  for (const nav of ['Pacientes', 'Consultas', 'Estoque', 'Fornecedores', 'WhatsApp', 'LGPD']) {
    await page.click(`a:has-text("${nav}")`);
    await page.waitForLoadState('networkidle');
  }
  await page.click('button:has-text("ES")');
  await page.waitForSelector('text=Panel', { timeout: 5000 });
  await page.click('button:has-text("EN")');
  await page.waitForSelector('text=Dashboard', { timeout: 5000 });
  await page.screenshot({ path: '/workspace/test/screenshots/clinica-tanah-en.png', fullPage: false });
  if (errors.length > 0) {
    console.log('  Browser errors:', errors.slice(0, 3));
  }
  await browser.close();
});

(async () => {
  let pass = 0, fail = 0;
  for (const test of tests) {
    try {
      await test.fn();
      console.log(`✓ ${test.name}`);
      pass++;
    } catch (e) {
      console.log(`✗ ${test.name}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\n${pass}/${tests.length} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
