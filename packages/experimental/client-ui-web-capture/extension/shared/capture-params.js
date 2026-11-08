/**
 * Pure capture planning shared by the extension's service worker and tests:
 * print-paper geometry, base64 chunking, and decoded-size arithmetic.
 *
 * No chrome.* or DOM access lives here so the module runs under plain Node.
 */

/** CSS pixels per inch, the unit CDP print paper sizes are denominated in. */
export const CSS_PX_PER_INCH = 96
/** Chromium's print-paper ceiling per side; larger content paginates onto further pages. */
export const MAX_PAPER_INCHES = 200
/** The same ceiling in CSS pixels. */
export const MAX_PAPER_PX = MAX_PAPER_INCHES * CSS_PX_PER_INCH
/** Deep-capture screen budget: the scroll pass stops after this many viewports. */
export const DEEP_MAX_SCREENS = 40
/** Characters per relayed base64 chunk; a multiple of 4 so no encoded quantum is split. */
export const CHUNK_CHARS = 4 * 384 * 1024
/** Relay chunk-count ceiling, mirrored by the GUI plugin. */
export const TOTAL_CHUNK_LIMIT = 2048
/** ISO A4 portrait paper in inches. */
export const A4_PAPER = { paperWidth: 8.27, paperHeight: 11.69 }

/**
 * Paper size of one long-mode capture: the page's own width, and a height
 * holding the whole document so the PDF is a single 1:1 page. Sides clamp to
 * Chromium's paper ceiling; taller content paginates onto further tall pages.
 * @param scrollWidthPx - the document's full scroll width in CSS pixels.
 * @param scrollHeightPx - the document's full scroll height in CSS pixels.
 * @returns paper width and height in inches, rounded to print granularity.
 */
export function longPaper(scrollWidthPx, scrollHeightPx) {
  const clamp = px => Math.min(Math.max(Math.ceil(px || 0), 320), MAX_PAPER_PX)
  const inches = px => Math.round((px / CSS_PX_PER_INCH) * 100) / 100
  return { paperWidth: inches(clamp(scrollWidthPx)), paperHeight: inches(clamp(scrollHeightPx)) }
}

/**
 * Split one canonical base64 body into relayable chunks.
 * @param base64 - the complete body; its length must be a multiple of 4.
 * @param chunkChars - chunk size in characters; a positive multiple of 4.
 * @returns chunks in ascending `seq`, each `{ seq, data }`.
 */
export function chunkBase64(base64, chunkChars = CHUNK_CHARS) {
  if (typeof base64 !== 'string' || base64.length % 4 !== 0) throw new Error('chunkBase64: the body length must be a multiple of 4')
  if (!Number.isSafeInteger(chunkChars) || chunkChars <= 0 || chunkChars % 4 !== 0) throw new Error('chunkBase64: chunkChars must be a positive multiple of 4')
  const chunks = []
  for (let offset = 0; offset < base64.length; offset += chunkChars) {
    chunks.push({ seq: chunks.length, data: base64.slice(offset, offset + chunkChars) })
  }
  return chunks
}

/**
 * How many chunks one body spans, and whether that stays inside the relay ceiling.
 * @param base64Length - the complete body's character length.
 * @param chunkChars - chunk size in characters; a positive multiple of 4.
 * @returns `{ ok: true, totalChunks }` or `{ ok: false, totalChunks, limit }`.
 */
export function planChunks(base64Length, chunkChars = CHUNK_CHARS) {
  if (!Number.isSafeInteger(base64Length) || base64Length < 0) return { ok: false, totalChunks: Number.NaN, limit: TOTAL_CHUNK_LIMIT }
  const totalChunks = Math.max(1, Math.ceil(base64Length / chunkChars))
  return totalChunks <= TOTAL_CHUNK_LIMIT
    ? { ok: true, totalChunks }
    : { ok: false, totalChunks, limit: TOTAL_CHUNK_LIMIT }
}

/**
 * Decoded byte count of one canonical base64 body.
 * @param base64 - the body to measure.
 * @returns the decoded length, or `NaN` when the body is not canonical base64.
 */
export function decodedByteLength(base64) {
  if (typeof base64 !== 'string' || base64.length % 4 !== 0 || base64.length === 0) return Number.NaN
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) return Number.NaN
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length / 4) * 3 - padding
}

/**
 * Scroll positions of one deep-capture pass: viewport-height steps down the
 * document, always ending at its bottom, capped by the screen budget.
 * @param docHeightPx - the document's full scroll height in CSS pixels.
 * @param viewportHeightPx - the viewport height in CSS pixels; clamped to 200..4000.
 * @param maxScreens - the step budget; defaults to {@link DEEP_MAX_SCREENS}.
 * @returns the y positions to scroll through in order; empty for one-screen pages.
 */
export function deepScrollPlan(docHeightPx, viewportHeightPx, maxScreens = DEEP_MAX_SCREENS) {
  const doc = Math.max(1, Math.ceil(docHeightPx || 0))
  const viewport = Math.min(Math.max(Math.ceil(viewportHeightPx || 0), 200), 4000)
  const maxScroll = Math.max(0, doc - viewport)
  if (maxScroll === 0) return []
  const positions = []
  for (let y = viewport; y < maxScroll && positions.length < maxScreens; y += viewport) positions.push(y)
  const last = positions.at(-1)
  if (last === undefined || last < maxScroll) positions.push(maxScroll)
  return positions
}
