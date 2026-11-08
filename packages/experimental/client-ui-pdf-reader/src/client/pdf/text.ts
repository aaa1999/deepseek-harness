/** PDF.js's viewer owns selection boundaries and copy normalization; the overlay follows its canvas. */
// The official viewer resolves its version-matched engine through pdfjsLib.
import 'pdfjs-dist'
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { RenderPdfText } from './document.ts'

/**
 * Create a selectable overlay in a component-owned host.
 * @param host - absolutely positioned overlay matching the base-scale page box.
 * @returns renderer that attaches the layer to `host` once its text is laid out;
 *   a cancelled layer is never attached, and cancellation also releases its DOM.
 */
export function pdfTextRenderer(host: HTMLDivElement): RenderPdfText {
  return (page, viewport) => {
    let cancelled = false
    // PDF.js measures each text item against document styles; spans appended to a detached layer do not invalidate them.
    const layer = new TextLayerBuilder({ pdfPage: page, onAppend: () => {
      // A cancellation after the text finishes but before this callback cannot stop the builder's continuation.
      if (cancelled) layer.cancel()
      else host.append(container)
    } })
    const container = layer.div
    container.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
    container.style.setProperty('--scale-round-x', '1px')
    container.style.setProperty('--scale-round-y', '1px')
    return {
      // PDF.js 6 declares images as required, but its viewer also renders text-only layers without it.
      promise: layer.render({ viewport } as Parameters<TextLayerBuilder['render']>[0]),
      cancel() {
        cancelled = true
        // Also releases the builder's shared selection listener after the last page leaves.
        layer.cancel()
        container.remove()
      },
    }
  }
}

/** Build the outline destinations of one document onto 1-based pages. */
export async function outlinePages(document: {
  getOutline(): Promise<readonly { title: string; dest: unknown; items: readonly unknown[] }[] | null>
  getDestination(dest: string): Promise<unknown[] | null>
  getPageIndex(ref: unknown): Promise<number>
}): Promise<{ title: string; page: number }[]> {
  const flat: { title: string; dest: unknown }[] = []
  const walk = (items: readonly { title: string; dest: unknown; items: readonly unknown[] }[]): void => {
    for (const item of items) {
      flat.push({ title: item.title, dest: item.dest })
      if (Array.isArray(item.items)) walk(item.items as typeof items)
    }
  }
  const outline = await document.getOutline()
  if (outline !== null) walk(outline)
  const entries: { title: string; page: number }[] = []
  for (const item of flat.slice(0, 2000)) {
    const page = await pageOfDestination(document, item.dest)
    if (page !== null) entries.push({ title: item.title.slice(0, 300), page })
  }
  return entries
}

/** Resolve one outline destination onto its 1-based page, or null when it does not land. */
async function pageOfDestination(document: {
  getDestination(dest: string): Promise<unknown[] | null>
  getPageIndex(ref: unknown): Promise<number>
}, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await document.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    return await document.getPageIndex(explicit[0]).then(index => index + 1)
  } catch {
    return null
  }
}
