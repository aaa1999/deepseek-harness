/** Screenshot geometry: stroke normalization, meaningfulness, and raster projection. */
import { describe, expect, it } from 'vitest'
import { MIN_STROKE_AREA, rasterCropOf, rectFromStroke, strokeIsMeaningful } from '../src/client/shot.ts'

const box = { width: 800, height: 600 }

describe('shot geometry', () => {
  it('normalizes a stroke into a clamped unit rect', () => {
    const rect = rectFromStroke({ x: 100, y: 50 }, { x: 300, y: 200 }, box)
    expect(rect).toEqual({ x: 0.125, y: 0.08333333333333333, width: 0.25, height: 0.25 })
  })

  it('accepts strokes drawn in either direction', () => {
    const forward = rectFromStroke({ x: 100, y: 50 }, { x: 300, y: 200 }, box)
    const backward = rectFromStroke({ x: 300, y: 200 }, { x: 100, y: 50 }, box)
    expect(forward).toEqual(backward)
  })

  it('clamps strokes that leave the page box', () => {
    const rect = rectFromStroke({ x: -50, y: -50 }, { x: 900, y: 700 }, box)
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('rejects strokes against boxes without extent', () => {
    expect(rectFromStroke({ x: 0, y: 0 }, { x: 10, y: 10 }, { width: 0, height: 0 })).toBeNull()
  })

  it('keeps only meaningful strokes', () => {
    const tiny = rectFromStroke({ x: 10, y: 10 }, { x: 14, y: 14 }, box)!
    expect(strokeIsMeaningful(tiny, box)).toBe(false)
    const real = rectFromStroke({ x: 10, y: 10 }, { x: 110, y: 110 }, box)!
    expect(strokeIsMeaningful(real, box)).toBe(true)
    expect(MIN_STROKE_AREA).toBeGreaterThan(0)
  })

  it('projects a unit rect onto the raster at display scale', () => {
    const raster = { width: 1600, height: 1200 }
    const crop = rasterCropOf({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, { raster, box })
    expect(crop).toEqual({ x: 400, y: 600, width: 800, height: 300 })
  })

  it('clamps crops that would cross the raster edge', () => {
    const crop = rasterCropOf({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 }, { raster: { width: 1000, height: 800 }, box })
    expect(crop).toEqual({ x: 900, y: 720, width: 100, height: 80 })
  })

  it('answers null for crops that project to nothing', () => {
    expect(rasterCropOf({ x: 1, y: 1, width: 0.5, height: 0.5 }, { raster: { width: 100, height: 100 }, box })).toBeNull()
    expect(rasterCropOf(
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { raster: { width: 100, height: 100 }, box: { width: 0, height: 0 } },
    )).toBeNull()
  })
})
