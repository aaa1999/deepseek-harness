/**
 * Page plain-text offsets: mapping text-layer selections and saved highlights
 * onto one concatenated character stream per rendered page.
 *
 * A text annotation anchors by `[start, end)` offsets into the text-node
 * stream of the page's PDF.js text layer. The layer rebuilds identically on
 * every render of the same page, so offsets survive zoom changes; the saved
 * quote remains the fallback when a page revision moves the text.
 */

/** One text node's span in the page's concatenated stream. */
interface TextSpan { readonly node: Text; readonly start: number; readonly end: number }

/** The concatenated plain-text stream of one rendered page. */
export interface TextMap { readonly spans: readonly TextSpan[]; readonly total: number }

/** Highlight registry name for saved annotations inside the reading stage. */
const HIGHLIGHT_NAME = 'pdf-reader-note'

/** Narrow browser faces the CSS Custom Highlight API adds; absent engines skip highlights. */
interface HighlightConstructor { new (...ranges: Range[]): object }
type HighlightRegistry = { set(name: string, highlight: object): void; delete(name: string): boolean }

/** Map every text node under `root` into one offset-addressable stream. */
export function mapText(root: Element): TextMap {
  const spans: TextSpan[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let start = 0
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text
    const length = text.data.length
    if (length > 0) spans.push({ node: text, start, end: start + length })
    start += length
  }
  return { spans, total: start }
}

/** The global offset of one `(node, offsetWithinNode)` position. */
function offsetOf(map: TextMap, node: Node, offset: number): number | undefined {
  for (const span of map.spans) {
    if (span.node === node) return span.start + offset
  }
  return undefined
}

/** Resolve one `[start, end)` global offset pair into a DOM range, or null when it no longer lands. */
export function rangeOf(map: TextMap, start: number, end: number): Range | null {
  if (start < 0 || end <= start || end > map.total) return null
  let begin: { node: Text; offset: number } | undefined
  let finish: { node: Text; offset: number } | undefined
  for (const span of map.spans) {
    if (begin === undefined && start < span.end) begin = { node: span.node, offset: start - span.start }
    if (finish === undefined && end <= span.end) finish = { node: span.node, offset: end - span.start }
    if (begin !== undefined && finish !== undefined) break
  }
  if (begin === undefined || finish === undefined) return null
  const range = document.createRange()
  range.setStart(begin.node, begin.offset)
  range.setEnd(finish.node, finish.offset)
  return range
}

/** How much page text surrounds a selection in the prompt context window. */
const CONTEXT_WINDOW_CHARS = 800

/** A selection inside the page as offsets plus prompt context, or null outside it. */
export interface PageSelection {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly context: string
}

/** Clip the page stream to a window around one selection for prompt context. */
export function contextOf(map: TextMap, start: number, end: number): string {
  const pieces: string[] = []
  let cursor = 0
  for (const span of map.spans) {
    const from = Math.max(span.start, start - CONTEXT_WINDOW_CHARS)
    const to = Math.min(span.end, end + CONTEXT_WINDOW_CHARS)
    if (to > from) {
      if (from > cursor) pieces.push(' ')
      pieces.push(span.node.data.slice(from - span.start, to - span.start))
      cursor = to
    }
  }
  return pieces.join('').replace(/\s+/gu, ' ').trim().slice(0, 1600)
}

/** Capture the current selection as page offsets plus prompt context, or null outside it. */
export function captureSelection(container: HTMLElement, map: TextMap): PageSelection | null {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (range.collapsed || !container.contains(range.startContainer) || !container.contains(range.endContainer)) return null
  const start = offsetOf(map, range.startContainer, range.startOffset)
  const end = offsetOf(map, range.endContainer, range.endOffset)
  if (start === undefined || end === undefined || end <= start) return null
  return { start, end, text: range.toString(), context: contextOf(map, start, end) }
}

/** The engine-level `CSS` global, absent in some embedded DOMs (jsdom); never a throw. */
function cssHighlights(): HighlightRegistry | undefined {
  return (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights
}

/** Paint saved annotation ranges through the CSS Custom Highlight API. */
export function applyHighlights(ranges: readonly Range[]): void {
  const highlights = cssHighlights()
  const HighlightCtor = (globalThis as { Highlight?: HighlightConstructor }).Highlight
  if (highlights === undefined || HighlightCtor === undefined) return
  if (ranges.length === 0) { highlights.delete(HIGHLIGHT_NAME); return }
  highlights.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges))
}

/** Drop every painted annotation highlight. */
export function clearHighlights(): void {
  cssHighlights()?.delete(HIGHLIGHT_NAME)
}
