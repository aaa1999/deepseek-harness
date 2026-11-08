/** Capture-planning arithmetic: paper geometry, chunk plans, and decoded sizes. */
import { describe, expect, it } from 'vitest'
import {
  A4_PAPER, CHUNK_CHARS, CSS_PX_PER_INCH, DEEP_MAX_SCREENS, MAX_PAPER_PX, TOTAL_CHUNK_LIMIT,
  chunkBase64, decodedByteLength, deepScrollPlan, longPaper, planChunks,
} from '../extension/shared/capture-params.js'

describe('longPaper', () => {
  it('sizes one page to the full document', () => {
    expect(longPaper(1440, 8000)).toEqual({ paperWidth: 15, paperHeight: 83.33 })
  })

  it('clamps both sides into Chromium\'s paper ceiling', () => {
    expect(longPaper(99999, 999999)).toEqual({ paperWidth: 200, paperHeight: 200 })
  })

  it('raises a floor under unreadable geometry', () => {
    const paper = longPaper(0, 0)
    expect(paper.paperWidth).toBeGreaterThan(0)
    expect(paper.paperHeight).toBeGreaterThan(0)
    expect(MAX_PAPER_PX / CSS_PX_PER_INCH).toBe(200)
  })

  it('rounds to print granularity so re-measures stay stable', () => {
    expect(longPaper(1000, 2001)).toEqual({ paperWidth: 10.42, paperHeight: 20.84 })
  })
})

describe('chunkBase64', () => {
  it('splits only on encoded-quantum boundaries and keeps ascending seqs', () => {
    const chunks = chunkBase64('AAECAwQFBgcICA==', 8)
    expect(chunks).toEqual([
      { seq: 0, data: 'AAECAwQF' },
      { seq: 1, data: 'BgcICA==' },
    ])
  })

  it('rejects sizes that are not positive multiples of four', () => {
    expect(() => chunkBase64('AAEC', 6)).toThrow(/multiple of 4/u)
    expect(() => chunkBase64('AAEC', 0)).toThrow(/multiple of 4/u)
  })

  it('rejects a body whose length is not a multiple of four', () => {
    expect(() => chunkBase64('AAE', 8)).toThrow(/multiple of 4/u)
  })

  it('keeps the default chunk size on a quantum boundary', () => {
    expect(CHUNK_CHARS % 4).toBe(0)
    expect(chunkBase64('AAEC', CHUNK_CHARS)).toEqual([{ seq: 0, data: 'AAEC' }])
  })
})

describe('planChunks', () => {
  it('plans one chunk for a short body', () => {
    expect(planChunks(8)).toEqual({ ok: true, totalChunks: 1 })
  })

  it('rounds up across the boundary and refuses beyond the relay ceiling', () => {
    expect(planChunks(CHUNK_CHARS + 1)).toEqual({ ok: true, totalChunks: 2 })
    expect(planChunks((TOTAL_CHUNK_LIMIT + 1) * CHUNK_CHARS)).toMatchObject({ ok: false, limit: TOTAL_CHUNK_LIMIT })
  })
})

describe('decodedByteLength', () => {
  it('counts padding exactly', () => {
    expect(decodedByteLength('AAEC')).toBe(3)
    expect(decodedByteLength('AAECAwQ=')).toBe(5)
    expect(decodedByteLength('AAECAw==')).toBe(4)
  })

  it('reads non-canonical bodies as NaN', () => {
    expect(decodedByteLength('AAE')).toBeNaN()
    expect(decodedByteLength('AA C')).toBeNaN()
    expect(decodedByteLength('')).toBeNaN()
    expect(decodedByteLength('a b!')).toBeNaN()
  })
})

describe('A4_PAPER', () => {
  it('carries ISO A4 portrait inches', () => {
    expect(A4_PAPER).toEqual({ paperWidth: 8.27, paperHeight: 11.69 })
  })
})

describe('deepScrollPlan', () => {
  it('returns nothing for a one-screen document', () => {
    expect(deepScrollPlan(800, 900)).toEqual([])
    expect(deepScrollPlan(0, 0)).toEqual([])
  })

  it('steps one viewport at a time and always ends at the bottom', () => {
    expect(deepScrollPlan(3000, 1000)).toEqual([1000, 2000])
    expect(deepScrollPlan(2500, 1000)).toEqual([1000, 1500])
  })

  it('caps the pass at the screen budget but still reaches the bottom', () => {
    const positions = deepScrollPlan(1_000_000, 1000)
    expect(positions).toHaveLength(DEEP_MAX_SCREENS + 1)
    expect(positions.at(-1)).toBe(999_000)
  })

  it('clamps an unreadable viewport to a sane step', () => {
    expect(deepScrollPlan(5000, 0)).toEqual(deepScrollPlan(5000, 200))
  })
})
