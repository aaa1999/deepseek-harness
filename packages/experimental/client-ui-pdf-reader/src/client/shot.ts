/**
 * The screenshot tool's geometry: pointer strokes onto normalized page
 * rectangles, and page-box crops out of the rendered raster.
 */

/** Region of one page a stroke captured, in fractions of the displayed page box. */
export interface StrokeRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A pointer stroke in page-box pixels. */
export interface StrokePoint {
  readonly x: number
  readonly y: number
}

/** The smallest stroke, in page-box pixels squared, that counts as a selection. */
export const MIN_STROKE_AREA = 400

/**
 * Normalize one pointer stroke into a clamped unit rect.
 * @param from - stroke origin in page-box pixels.
 * @param to - stroke end in page-box pixels.
 * @param box - the displayed page box the stroke lives in.
 * @returns the unit rect, or null when the box has no extent.
 */
export function rectFromStroke(from: StrokePoint, to: StrokePoint, box: { width: number; height: number }): StrokeRect | null {
  if (box.width <= 0 || box.height <= 0) return null
  const clamp = (value: number, extent: number): number => Math.min(1, Math.max(0, value / extent))
  const left = clamp(Math.min(from.x, to.x), box.width)
  const top = clamp(Math.min(from.y, to.y), box.height)
  const right = clamp(Math.max(from.x, to.x), box.width)
  const bottom = clamp(Math.max(from.y, to.y), box.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Whether one stroke rect is large enough to keep.
 * @param rect - the unit rect the stroke produced.
 * @param box - the displayed page box it was drawn on.
 */
export function strokeIsMeaningful(rect: StrokeRect, box: { width: number; height: number }): boolean {
  return rect.width * box.width * rect.height * box.height >= MIN_STROKE_AREA
}

/** The crop source a screenshot reads: a raster plus the box it is displayed in. */
export interface CropSource {
  readonly raster: { readonly width: number; readonly height: number }
  readonly box: { readonly width: number; readonly height: number }
}

/** One raster rectangle in whole pixels. */
export interface RasterCrop {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Project one unit rect onto the page raster.
 * @param rect - the unit rect within the displayed page box.
 * @param source - the raster and its displayed box.
 * @returns the whole-pixel crop, or null when it projects to nothing.
 */
export function rasterCropOf(rect: StrokeRect, source: CropSource): RasterCrop | null {
  if (source.box.width <= 0 || source.box.height <= 0) return null
  const scaleX = source.raster.width / source.box.width
  const scaleY = source.raster.height / source.box.height
  const x = Math.max(0, Math.round(rect.x * source.box.width * scaleX))
  const y = Math.max(0, Math.round(rect.y * source.box.height * scaleY))
  const width = Math.min(source.raster.width - x, Math.round(rect.width * source.box.width * scaleX))
  const height = Math.min(source.raster.height - y, Math.round(rect.height * source.box.height * scaleY))
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * Crop one canvas by a unit rect of its displayed box.
 * @param canvas - the rendered page raster, displayed at `box` size.
 * @param rect - the unit rect within the displayed box.
 * @param box - the displayed size of the canvas.
 * @returns the cropped canvas, or null when the rect projects to nothing.
 */
export function cropCanvas(canvas: HTMLCanvasElement, rect: StrokeRect, box: { width: number; height: number }): HTMLCanvasElement | null {
  const crop = rasterCropOf(rect, { raster: canvas, box })
  if (crop === null) return null
  const output = document.createElement('canvas')
  output.width = crop.width
  output.height = crop.height
  const context = output.getContext('2d')
  if (context === null) return null
  context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  return output
}

/**
 * Read one canvas as canonical base64 PNG.
 * @param canvas - the cropped image to encode.
 * @returns the base64 payload, or null when encoding failed.
 */
export async function canvasToBase64Png(canvas: HTMLCanvasElement): Promise<string | null> {
  try {
    const blob: Blob | null = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/png') })
    if (blob === null) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
    }
    return btoa(binary)
  } catch {
    return null
  }
}
