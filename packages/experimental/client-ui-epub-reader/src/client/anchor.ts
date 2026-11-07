/**
 * Chapter plain-text offsets: mapping DOM selections and saved highlights
 * onto one concatenated character stream per rendered chapter.
 *
 * An annotation anchors by `[start, end)` offsets into the text-node stream
 * of the sanitized chapter body. Text-node offsets survive font-size changes
 * and reflow; the saved quote remains the fallback when a chapter revision
 * moves the text.
 */

/** One text node's span in the chapter's concatenated stream. */
interface TextSpan { readonly node: Text; readonly start: number; readonly end: number }

/** The concatenated plain-text stream of one rendered chapter body. */
export interface TextMap { readonly spans: readonly TextSpan[]; readonly total: number }

/** Highlight registry name for saved annotations inside the reading column. */
const HIGHLIGHT_NAME = 'epub-reader-note'

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

/** A selection inside `container` as chapter offsets plus prompt context, or null outside it. */
export interface ChapterSelection {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly context: string
}

/** Capture the current selection as chapter offsets plus prompt context, or null outside it. */
export function captureSelection(container: HTMLElement, map: TextMap): ChapterSelection | null {
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (range.collapsed || !container.contains(range.startContainer) || !container.contains(range.endContainer)) return null
  const start = offsetOf(map, range.startContainer, range.startOffset)
  const end = offsetOf(map, range.endContainer, range.endOffset)
  if (start === undefined || end === undefined || end <= start) return null
  let block: Node | null = range.startContainer
  while (block !== null && block !== container && !(block instanceof HTMLElement && isBlock(block))) block = block.parentNode
  return { start, end, text: range.toString(), context: (block ?? container).textContent?.slice(0, 2000) ?? '' }
}

/** Whether an element opens a block box for context capture. */
function isBlock(element: HTMLElement): boolean {
  return /^(p|div|blockquote|li|h[1-6]|pre|td|dd|dt)$/iu.test(element.tagName)
}

/** Paint saved annotation ranges through the CSS Custom Highlight API. */
export function applyHighlights(ranges: readonly Range[]): void {
  const highlights = (CSS as { highlights?: HighlightRegistry }).highlights
  const HighlightCtor = (globalThis as { Highlight?: HighlightConstructor }).Highlight
  if (highlights === undefined || HighlightCtor === undefined) return
  if (ranges.length === 0) { highlights.delete(HIGHLIGHT_NAME); return }
  highlights.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges))
}

/** Drop every painted annotation highlight. */
export function clearHighlights(): void {
  (CSS as { highlights?: HighlightRegistry }).highlights?.delete(HIGHLIGHT_NAME)
}
