import { createHash } from 'node:crypto';

export const EBOOK = Object.freeze({
  id: 'elitebot-strategy-rulebook',
  title: 'EliteBot Strategy Rulebook',
  priceCents: 5000,
  currency: 'USD',
  pages: 8,
  fileName: 'EliteBot_Strategy_Rulebook.pdf',
  previewUrl: '/ebooks/elitebot-strategy-preview.pdf'
});

export function sendEbook(res, bytes, expectedHash) {
  const pdf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'base64');
  if (pdf.subarray(0, 5).toString() !== '%PDF-' ||
      (expectedHash && createHash('sha256').update(pdf).digest('hex') !== expectedHash)) {
    throw new Error('The ebook file failed its integrity check.');
  }
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${EBOOK.fileName}"`,
    'Content-Length': pdf.length,
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Vary': 'Authorization, Cookie'
  });
  res.end(pdf);
}
