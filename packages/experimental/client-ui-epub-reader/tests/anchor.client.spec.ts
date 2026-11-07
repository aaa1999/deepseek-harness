// @vitest-environment jsdom
/** Plain-text offset anchoring: mapping, range resolution, capture, highlight guards. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHighlights, captureSelection, clearHighlights, mapText, rangeOf } from '../src/client/anchor.ts'

let container: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  container = document.createElement('div')
  container.innerHTML = '<p id="first">It was <em>the best</em> of times.</p><p id="second">Second paragraph.</p>'
  document.body.append(container)
})

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  clearHighlights()
})

describe('mapText', () => {
  it('concatenates every text node into one offset-addressable stream', () => {
    const map = mapText(container)
    // 'It was ' + 'the best' + ' of times.' + 'Second paragraph.'
    expect(map.total).toBe('It was the best of times.Second paragraph.'.length)
    expect(map.spans.map(span => span.node.data)).toEqual(['It was ', 'the best', ' of times.', 'Second paragraph.'])
    expect(map.spans[1]).toMatchObject({ start: 7, end: 15 })
  })

  it('maps an empty container to an empty stream', () => {
    const empty = document.createElement('div')
    expect(mapText(empty)).toEqual({ spans: [], total: 0 })
  })
})

describe('rangeOf', () => {
  it('resolves offsets crossing text nodes back into a DOM range', () => {
    const map = mapText(container)
    const range = rangeOf(map, 10, 20)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe(' best of t')
  })

  it('resolves offsets inside one text node', () => {
    const map = mapText(container)
    expect(rangeOf(map, 0, 6)!.toString()).toBe('It was')
  })

  it('rejects inverted and out-of-bounds offsets', () => {
    const map = mapText(container)
    expect(rangeOf(map, 6, 6)).toBeNull()
    expect(rangeOf(map, 9, 3)).toBeNull()
    expect(rangeOf(map, -1, 3)).toBeNull()
    expect(rangeOf(map, 0, map.total + 1)).toBeNull()
  })
})

describe('captureSelection', () => {
  /** Select `[start, end)` in the chapter stream through a real DOM selection. */
  function select(start: number, end: number): void {
    const range = rangeOf(mapText(container), start, end)!
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  it('captures offsets, text, and the containing paragraph as context', () => {
    select(10, 20)
    const found = captureSelection(container, mapText(container))
    expect(found).toMatchObject({ start: 10, end: 20, text: ' best of t' })
    expect(found?.context).toBe('It was the best of times.')
  })

  it('returns null for a collapsed selection or one outside the container', () => {
    const collapsed = rangeOf(mapText(container), 10, 11)!
    collapsed.collapse(true)
    const collapsedSelection = document.getSelection()
    collapsedSelection?.removeAllRanges()
    collapsedSelection?.addRange(collapsed)
    expect(captureSelection(container, mapText(container))).toBeNull()

    const outside = document.createElement('p')
    outside.textContent = 'elsewhere'
    document.body.append(outside)
    const range = document.createRange()
    range.selectNodeContents(outside)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(captureSelection(container, mapText(container))).toBeNull()
  })
})

describe('applyHighlights', () => {
  it('no-ops safely where the CSS Custom Highlight API is absent', () => {
    expect(() => {
      applyHighlights([])
      applyHighlights([document.createRange()])
    }).not.toThrow()
  })

  it('registers ranges under the plugin highlight name and clears them again', () => {
    const set = vi.fn(), remove = vi.fn()
    const Highlight = class { constructor(readonly ranges: unknown[] = []) {} }
    const previousCSS = (globalThis as { CSS?: unknown }).CSS
    const previousHighlight = (globalThis as { Highlight?: unknown }).Highlight
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights: { set, delete: remove } } })
    Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: Highlight })

    try {
      const range = document.createRange()
      applyHighlights([range])
      expect(set).toHaveBeenCalledWith('epub-reader-note', expect.any(Highlight))
      applyHighlights([])
      expect(remove).toHaveBeenCalledWith('epub-reader-note')
      clearHighlights()
      expect(remove).toHaveBeenCalledTimes(2)
    } finally {
      for (const [name, previous] of [['CSS', previousCSS], ['Highlight', previousHighlight]] as const) {
        if (previous === undefined) Reflect.deleteProperty(globalThis, name)
        else Object.defineProperty(globalThis, name, { configurable: true, value: previous })
      }
    }
  })
})
