/** Canvas rendering with cancellation and page cleanup, shared by the reader page and the cover thumbnail. */
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'

/** The document operations the reader uses. */
export type PdfDocument = Pick<PDFDocumentProxy, 'numPages' | 'getPage' | 'getOutline' | 'getDestination' | 'getPageIndex' | 'getMetadata'>

/** Page geometry expressed in CSS pixels at the base 96/72 scale. */
export interface PdfPageSize {
  readonly width: number
  readonly height: number
}

/** Optional DOM text rendering that shares the canvas page's cleanup barrier. */
export type RenderPdfText = (page: PDFPageProxy, viewport: PageViewport) => {
  readonly promise: Promise<void>
  cancel(): void
}

/** The largest raster the renderer allocates for one page. */
const MAX_PAGE_PIXELS = 16_777_216

/**
 * Render one page into an exclusively owned canvas. Cancellation cannot write
 * dimensions after a delayed getPage; active render tasks are cancelled and
 * awaited before the page is cleaned up.
 * @param document - loaded pdfjs document.
 * @param pageNumber - 1-based page to render.
 * @param canvas - canvas owned by this render only.
 * @param signal - render lifetime.
 * @param pixelRatio - device pixel ratio multiplied by the settled zoom.
 * @param renderText - optional selectable text layer sharing this page and viewport.
 * @returns the page's CSS dimensions after rendering completes.
 */
export async function renderPdfPage(
  document: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  pixelRatio: number,
  renderText?: RenderPdfText,
): Promise<PdfPageSize> {
  signal.throwIfAborted()
  const page: PDFPageProxy = await document.getPage(pageNumber)
  try {
    signal.throwIfAborted()
    const viewport = page.getViewport({ scale: 96 / 72 })
    // Limit raster allocation without changing the page's display dimensions.
    const ratio = Math.min(pixelRatio, Math.sqrt(MAX_PAGE_PIXELS / (viewport.width * viewport.height)))
    canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
    canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
    const task = page.render({
      canvas,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    })
    let text: ReturnType<RenderPdfText> | undefined
    let cancelled = false
    const cancel = (): void => {
      if (cancelled) return
      cancelled = true
      task.cancel()
      text?.cancel()
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      text = renderText?.(page, viewport)
      if (signal.aborted) cancel()
      await Promise.all([task.promise, text?.promise])
      signal.throwIfAborted()
      return { width: viewport.width, height: viewport.height }
    } catch (error) {
      cancel()
      await Promise.allSettled([task.promise, text?.promise])
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  } finally {
    page.cleanup()
  }
}

/**
 * Render one page into a small canvas for a shelf thumbnail.
 * @param source - loaded pdfjs document.
 * @param pageNumber - 1-based page to render.
 * @param width - target raster width in pixels.
 * @param signal - render lifetime.
 * @returns the thumbnail canvas, or null when the page failed to render.
 */
export async function renderThumbnail(
  source: PdfDocument, pageNumber: number, width: number, signal: AbortSignal,
): Promise<HTMLCanvasElement | null> {
  signal.throwIfAborted()
  const page: PDFPageProxy = await source.getPage(pageNumber)
  try {
    signal.throwIfAborted()
    const base = page.getViewport({ scale: 96 / 72 })
    const scale = width / base.width
    const viewport = page.getViewport({ scale: (96 / 72) * scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    await page.render({ canvas, viewport }).promise
    signal.throwIfAborted()
    return canvas
  } catch {
    return null
  } finally {
    page.cleanup()
  }
}
