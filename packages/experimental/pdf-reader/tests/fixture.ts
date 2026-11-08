/** Minimal binary fixtures shared by the PDF reader host suites. */

/** A structurally shallow but header-valid PDF; the Host checks magic only. */
export function pdfFixture(text = 'Sample PDF body'): Uint8Array {
  const body = [
    '%PDF-1.7',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj',
    `4 0 obj << /Length ${text.length} >> stream`,
    text,
    'endstream endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n')
  return new TextEncoder().encode(body)
}

/** The smallest header-valid PNG; the Host checks magic only. */
export function pngFixture(bytes = 64): Uint8Array {
  const png = new Uint8Array(bytes)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  return png
}

/** One fixture as canonical base64, as the browser sends it. */
export function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}
