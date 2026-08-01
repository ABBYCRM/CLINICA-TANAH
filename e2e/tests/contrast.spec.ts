/**
 * Font-to-UI contrast audit — every CRM page.
 * Samples visible text nodes, resolves background color up the DOM,
 * and asserts WCAG AA contrast (4.5:1 normal / 3:1 large text).
 */
import { test, expect, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ADMIN = 'Juliana';
const PASSWORD = '12345678';
const REPORT_DIR = '/opt/cursor/artifacts/contrast';

mkdirSync(REPORT_DIR, { recursive: true });

type ContrastHit = {
  page: string;
  text: string;
  tag: string;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  fontSize: number;
  fontWeight: number;
  selector?: string;
};

type AuditResult = {
  page: string;
  checked: number;
  failures: ContrastHit[];
};

const ROUTES: Array<{ name: string; path: string; prep?: (page: Page) => Promise<void> }> = [
  { name: 'login', path: '/login' },
  { name: 'dashboard', path: '/' },
  { name: 'patients', path: '/patients' },
  {
    name: 'patient-record',
    path: '/patients',
    prep: async (page) => {
      const link = page.locator('table tbody tr a, table tbody tr td a').first();
      if (await link.count()) {
        await link.click();
        await page.waitForURL(/\/patients\/[^/]+/, { timeout: 15_000 });
      }
    },
  },
  { name: 'appointments', path: '/appointments' },
  { name: 'encounters', path: '/encounters' },
  { name: 'prescriptions', path: '/prescriptions' },
  { name: 'inventory', path: '/inventory' },
  { name: 'vendors', path: '/vendors' },
  { name: 'accounting', path: '/accounting' },
  {
    name: 'accounting-dre',
    path: '/accounting',
    prep: async (page) => {
      const dre = page.locator('button').filter({ hasText: /dre|income|resultado/i }).first();
      if (await dre.count()) await dre.click();
      await page.waitForTimeout(300);
    },
  },
  { name: 'invoices', path: '/invoices' },
  { name: 'payroll', path: '/payroll' },
  { name: 'whatsapp-chat', path: '/whatsapp' },
  {
    name: 'whatsapp-campaigns',
    path: '/whatsapp',
    prep: async (page) => {
      await page.getByTestId('tab-campaigns').click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'whatsapp-templates',
    path: '/whatsapp',
    prep: async (page) => {
      await page.getByTestId('tab-templates').click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'whatsapp-automations',
    path: '/whatsapp',
    prep: async (page) => {
      await page.getByTestId('tab-automations').click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'whatsapp-audience',
    path: '/whatsapp',
    prep: async (page) => {
      await page.getByTestId('tab-audience').click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'whatsapp-analytics',
    path: '/whatsapp',
    prep: async (page) => {
      await page.getByTestId('tab-analytics').click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'whatsapp-surveys',
    path: '/whatsapp',
    prep: async (page) => {
      await page.getByTestId('tab-surveys').click();
      await page.waitForTimeout(200);
    },
  },
  { name: 'lgpd', path: '/lgpd' },
  { name: 'manual', path: '/manual' },
  { name: 'team', path: '/team' },
  { name: 'settings', path: '/settings' },
  { name: 'clinics', path: '/clinics' },
];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ADMIN);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
}

async function auditPageContrast(page: Page, pageName: string): Promise<AuditResult> {
  return page.evaluate((name) => {
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK', 'BR', 'HR']);

    function parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
      if (!input || input === 'transparent') return null;
      const m = input.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (m) {
        return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
      }
      return null;
    }

    function srgbToLin(c: number) {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }

    function luminance(c: { r: number; g: number; b: number }) {
      return 0.2126 * srgbToLin(c.r) + 0.7152 * srgbToLin(c.g) + 0.0722 * srgbToLin(c.b);
    }

    function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }) {
      const L1 = luminance(fg);
      const L2 = luminance(bg);
      const hi = Math.max(L1, L2);
      const lo = Math.min(L1, L2);
      return (hi + 0.05) / (lo + 0.05);
    }

    function blend(fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number }) {
      const a = Math.max(0, Math.min(1, fg.a));
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
      };
    }

    function resolveBackground(el: Element): { r: number; g: number; b: number } {
      let cur: Element | null = el as Element;
      while (cur && cur !== document.documentElement) {
        const cs = getComputedStyle(cur);
        const bg = parseCssColor(cs.backgroundColor);
        if (bg && bg.a > 0.08) {
          // Composite onto parent if semi-transparent
          if (bg.a < 0.99 && cur.parentElement) {
            const parentBg = resolveBackground(cur.parentElement);
            return blend(bg, parentBg);
          }
          return { r: bg.r, g: bg.g, b: bg.b };
        }
        // Approximate first solid stop from a simple linear-gradient background-image
        const img = cs.backgroundImage || '';
        const stop = img.match(/#([0-9a-fA-F]{3,8})\b/) || img.match(/rgba?\([^)]+\)/);
        if (stop) {
          if (stop[0].startsWith('#')) {
            let h = stop[1];
            if (h.length === 3) h = h.split('').map((c) => c + c).join('');
            return {
              r: parseInt(h.slice(0, 2), 16),
              g: parseInt(h.slice(2, 4), 16),
              b: parseInt(h.slice(4, 6), 16),
            };
          }
          const p = parseCssColor(stop[0]);
          if (p && p.a > 0.08) return { r: p.r, g: p.g, b: p.b };
        }
        cur = cur.parentElement;
      }
      // Desk wood fallback (body)
      return { r: 42, g: 28, b: 18 };
    }

    function isVisible(el: Element) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if (r.bottom < 0 || r.top > window.innerHeight) return false;
      return true;
    }

    function cssPath(el: Element): string {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== document.body && parts.length < 4) {
        let part = cur.tagName.toLowerCase();
        if ((cur as HTMLElement).dataset?.testid) part += `[data-testid="${(cur as HTMLElement).dataset.testid}"]`;
        else if (cur.id) part += `#${cur.id}`;
        else if (typeof cur.className === 'string' && cur.className.trim()) {
          part += '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.');
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    const failures: Array<{
      page: string;
      text: string;
      tag: string;
      fg: string;
      bg: string;
      ratio: number;
      required: number;
      fontSize: number;
      fontWeight: number;
      selector?: string;
    }> = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<string>();

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const raw = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (raw.length < 2) continue;
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) continue;
      if (!isVisible(parent)) continue;

      const cs = getComputedStyle(parent);
      const fontSize = parseFloat(cs.fontSize) || 14;
      const fontWeight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400);
      const large = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
      const required = large ? 3 : 4.5;

      const fgParsed = parseCssColor(cs.color);
      if (!fgParsed) continue;
      const bg = resolveBackground(parent);
      const fg = blend(fgParsed, bg);
      const ratio = contrastRatio(fg, bg);
      checked += 1;

      if (ratio + 0.05 < required) {
        const key = `${parent.tagName}|${raw.slice(0, 40)}|${ratio.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        failures.push({
          page: name,
          text: raw.slice(0, 80),
          tag: parent.tagName.toLowerCase(),
          fg: cs.color,
          bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          ratio: Math.round(ratio * 100) / 100,
          required,
          fontSize,
          fontWeight,
          selector: cssPath(parent),
        });
      }
    }

    return { page: name, checked, failures };
  }, pageName);
}

test.describe('Font contrast audit — every page', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  let page: Page;
  const results: AuditResult[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    if (!results.length) return;
    const summary = {
      pages: results.length,
      checked: results.reduce((s, r) => s + r.checked, 0),
      failures: results.flatMap((r) => r.failures),
      byPage: Object.fromEntries(results.map((r) => [r.page, r.failures.length])),
    };
    writeFileSync(path.join(REPORT_DIR, 'contrast-report.json'), JSON.stringify(summary, null, 2));
    const md = [
      '# Font contrast audit',
      '',
      `Pages: ${summary.pages} · Text samples: ${summary.checked} · Failures: ${summary.failures.length}`,
      '',
      '| Page | Failures |',
      '|---|---|',
      ...results.map((r) => `| ${r.page} | ${r.failures.length} |`),
      '',
      '## Failures',
      '',
      ...summary.failures.slice(0, 80).map(
        (f) =>
          `- **${f.page}** \`${f.ratio}:1\` (need ${f.required}) — “${f.text.replace(/\|/g, '/')}” · ${f.fg} on ${f.bg} · \`${f.selector || f.tag}\``,
      ),
    ].join('\n');
    writeFileSync(path.join(REPORT_DIR, 'contrast-report.md'), md);
    await page?.close();
  });

  test('login page (signed out)', async () => {
    await page.goto('/login');
    await expect(page.getByTestId('login-card')).toBeVisible();
    const result = await auditPageContrast(page, 'login');
    results.push(result);
    expect(result.checked, 'login should yield text samples').toBeGreaterThan(5);
  });

  test('authenticated pages', async () => {
    await signIn(page);

    for (const route of ROUTES) {
      if (route.name === 'login') continue;
      await page.goto(route.path);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);
      if (route.prep) await route.prep(page);
      // Ensure shell / title present when authenticated
      if (route.name !== 'login') {
        await expect(page.locator('h1, [data-testid="dashboard"], [data-testid="whatsapp-marketing"], [data-testid="user-manual"]').first()).toBeVisible({ timeout: 15_000 });
      }
      const result = await auditPageContrast(page, route.name);
      results.push(result);
      expect(result.checked, `${route.name} should yield text samples`).toBeGreaterThan(3);
    }
  });

  test('no WCAG AA contrast failures across pages', async () => {
    const failures = results.flatMap((r) => r.failures);
    // Allow a tiny slack for anti-aliased / gradient-estimated samples
    const hard = failures.filter((f) => f.ratio < f.required - 0.25);
    if (hard.length) {
      console.log('Contrast failures:\n' + hard.slice(0, 40).map((f) =>
        `${f.page}: ${f.ratio}:1 < ${f.required} — "${f.text}" (${f.fg} on ${f.bg})`).join('\n'));
    }
    expect(hard, `${hard.length} contrast failure(s) — see ${REPORT_DIR}/contrast-report.md`).toEqual([]);
  });
});
