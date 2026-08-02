import fs from 'fs';
import { extractInvoiceFromImage } from '../src/services/nvidiaOcr';

async function main() {
  const buffer = fs.readFileSync('/tmp/invoice-ocr-smoke.png');
  const r = await extractInvoiceFromImage({
    buffer,
    mime: 'image/png',
    filename: 'invoice-ocr-smoke.png',
  });
  console.log(JSON.stringify({
    model: r.model,
    invoice_number: r.invoice_number,
    total: r.total,
    patient: r.patient_name,
    conf: r.confidence,
    lines: (r.lines || []).length,
    raw: (r.raw_text || '').slice(0, 200),
  }, null, 2));
}

main().catch((e) => {
  console.error('OCR_FAIL', e?.code || e?.message, e?.status || '');
  process.exit(1);
});
