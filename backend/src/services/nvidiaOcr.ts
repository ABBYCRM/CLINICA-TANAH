/**
 * NVIDIA NIM free-tier vision OCR / invoice extraction.
 * Rotates across NVIDIA_API_KEYS (comma or newline separated).
 * Primary model: nvidia/nemotron-nano-12b-v2-vl (strong DocVQA / invoice OCR on integrate.api.nvidia.com).
 */
import fs from 'fs';
import path from 'path';

const NVIDIA_BASE = process.env.NVIDIA_API_BASE || 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = process.env.NVIDIA_OCR_MODEL || 'nvidia/nemotron-nano-12b-v2-vl';
const FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'nvidia/nemotron-nano-12b-v2-vl',
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
  'meta/llama-3.2-11b-vision-instruct',
].filter((v, i, a) => a.indexOf(v) === i);

let keyCursor = 0;

export function nvidiaKeysConfigured(): boolean {
  return loadKeys().length > 0;
}

function loadKeys(): string[] {
  const raw = [
    process.env.NVIDIA_API_KEYS || '',
    process.env.NVIDIA_API_KEY || '',
  ].join(',');
  return raw
    .split(/[\n,]+/)
    .map((k) => k.replace(/^Bearer\s+/i, '').trim())
    .filter((k) => k.startsWith('nvapi-'));
}

function nextKey(): string {
  const keys = loadKeys();
  if (!keys.length) {
    throw Object.assign(new Error('nvidia_api_key_missing'), { code: 'nvidia_api_key_missing' });
  }
  const key = keys[keyCursor % keys.length];
  keyCursor = (keyCursor + 1) % keys.length;
  return key;
}

export type OcrInvoiceLine = {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
};

export type OcrInvoiceResult = {
  model: string;
  raw_text: string;
  invoice_number?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  patient_name?: string | null;
  vendor_name?: string | null;
  total?: number | null;
  currency?: string | null;
  payment_method?: string | null;
  lines: OcrInvoiceLine[];
  confidence?: string | null;
};

const SYSTEM_PROMPT = `/no_think
You are an OCR + invoice extractor for a Brazilian medical clinic (Clínica Tanah).
Read the document image carefully (NF-e, NFS-e, recibo, boleto, fatura clínica) and extract structured fields.
Return ONLY a single JSON object (no markdown) with this schema:
{
  "invoice_number": string|null,
  "issue_date": "YYYY-MM-DD"|null,
  "due_date": "YYYY-MM-DD"|null,
  "patient_name": string|null,
  "vendor_name": string|null,
  "total": number|null,
  "currency": "BRL"|string|null,
  "payment_method": string|null,
  "lines": [{"description": string, "quantity": number, "unit_price": number, "tax_rate": number}],
  "raw_text": string,
  "confidence": "high"|"medium"|"low"
}
Rules:
- Convert Brazilian dates (DD/MM/YYYY) to YYYY-MM-DD.
- Numbers use dot decimal (250.00 not 250,00).
- If a field is missing, use null.
- Prefer Portuguese descriptions when present.
- Capture CNPJ/CPF mentions inside raw_text when visible.
- raw_text should contain the readable OCR text of the document.`;

function mimeFromName(filename: string, fallback = 'image/jpeg'): string {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.pdf') return 'application/pdf';
  return fallback;
}

export function isOcrableMime(mime: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime);
}

function parseModelJson(content: string): any {
  const trimmed = String(content || '').trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('ocr_parse_failed');
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeResult(parsed: any, model: string, fallbackText: string): OcrInvoiceResult {
  const linesRaw = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const lines: OcrInvoiceLine[] = linesRaw
    .map((l: any) => ({
      description: String(l?.description || '').trim(),
      quantity: Number(l?.quantity) > 0 ? Number(l.quantity) : 1,
      unit_price: Number(l?.unit_price) || 0,
      tax_rate: Number(l?.tax_rate) || 0,
    }))
    .filter((l: OcrInvoiceLine) => l.description);

  const total = parsed?.total != null && parsed.total !== ''
    ? Number(String(parsed.total).replace(',', '.'))
    : (lines.length
      ? lines.reduce((s, l) => s + l.quantity * l.unit_price * (1 + (l.tax_rate || 0) / 100), 0)
      : null);

  return {
    model,
    raw_text: String(parsed?.raw_text || fallbackText || '').slice(0, 20000),
    invoice_number: parsed?.invoice_number ? String(parsed.invoice_number) : null,
    issue_date: parsed?.issue_date ? String(parsed.issue_date).slice(0, 10) : null,
    due_date: parsed?.due_date ? String(parsed.due_date).slice(0, 10) : null,
    patient_name: parsed?.patient_name ? String(parsed.patient_name) : null,
    vendor_name: parsed?.vendor_name ? String(parsed.vendor_name) : null,
    total: total != null && !Number.isNaN(total) ? Math.round(Number(total) * 100) / 100 : null,
    currency: parsed?.currency ? String(parsed.currency) : 'BRL',
    payment_method: parsed?.payment_method ? String(parsed.payment_method) : null,
    lines,
    confidence: parsed?.confidence ? String(parsed.confidence) : null,
  };
}

async function callVision(model: string, dataUrl: string, apiKey: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22_000);
  let res: Response;
  try {
    res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        top_p: 0.1,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: SYSTEM_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
  } catch (e: any) {
    const err: any = new Error(e?.name === 'AbortError' ? 'nvidia_timeout' : (e?.message || 'nvidia_fetch_failed'));
    err.code = e?.name === 'AbortError' ? 'nvidia_ocr_failed' : 'nvidia_ocr_failed';
    err.status = 504;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || text || res.statusText;
    const err: any = new Error(msg);
    err.code = res.status === 429 ? 'nvidia_rate_limited' : 'nvidia_ocr_failed';
    err.status = res.status;
    err.body = body;
    throw err;
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw Object.assign(new Error('nvidia_empty_response'), { code: 'nvidia_empty_response' });
  return String(content);
}

export async function extractInvoiceFromImage(opts: {
  buffer: Buffer;
  mime: string;
  filename?: string;
}): Promise<OcrInvoiceResult> {
  if (!isOcrableMime(opts.mime)) {
    throw Object.assign(new Error('ocr_unsupported_type'), { code: 'ocr_unsupported_type' });
  }
  if (!opts.buffer?.length) {
    throw Object.assign(new Error('empty_file'), { code: 'empty_file' });
  }
  // Vision models reject very large payloads; ~4MB binary is plenty for invoices
  if (opts.buffer.length > 4.5 * 1024 * 1024) {
    throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
  }

  const dataUrl = `data:${opts.mime};base64,${opts.buffer.toString('base64')}`;
  const keys = loadKeys();
  if (!keys.length) {
    throw Object.assign(new Error('nvidia_api_key_missing'), { code: 'nvidia_api_key_missing' });
  }

  let lastErr: any = null;
  const deadline = Date.now() + 50_000; // stay under DO gateway ~60s
  // Auth/rate-limit: try more keys. Parse/model failures: keep budget tight.
  let keyBudget = Math.min(keys.length, 6);
  let parseFailKeys = 0;

  for (let attempt = 0; attempt < keyBudget; attempt++) {
    if (Date.now() > deadline) break;
    const apiKey = nextKey();
    let authFail = false;
    let hadParseFail = false;

    for (const model of FALLBACK_MODELS) {
      if (Date.now() > deadline) break;
      try {
        const content = await callVision(model, dataUrl, apiKey);
        const parsed = parseModelJson(content);
        return normalizeResult(parsed, model, content);
      } catch (e: any) {
        lastErr = e;
        if (e?.status === 401 || e?.status === 403 || e?.code === 'nvidia_rate_limited') {
          authFail = true;
          break; // next key
        }
        // HTTP OK but unusable JSON / model error → try next model, then limited keys
        hadParseFail = true;
      }
    }

    if (!authFail && hadParseFail) {
      parseFailKeys += 1;
      if (parseFailKeys >= 2) break; // unlikely another key fixes bad image/parse
    }
  }
  throw lastErr || Object.assign(new Error('nvidia_ocr_failed'), { code: 'nvidia_ocr_failed' });
}

export function uploadsRoot(): string {
  const root = process.env.UPLOADS_DIR
    || path.join(process.env.DB_DIR || path.join(process.cwd(), 'data'), 'uploads');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function invoiceUploadDir(tenantId: string, invoiceId: string): string {
  const dir = path.join(uploadsRoot(), tenantId, 'invoices', invoiceId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export { mimeFromName };
