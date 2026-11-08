/**
 * Type surface of {@link ./capture-params.js} — the plain-JS module the MV3
 * service worker also loads, so both worlds share one declaration.
 */

export const CSS_PX_PER_INCH: number
export const MAX_PAPER_INCHES: number
export const MAX_PAPER_PX: number
export const DEEP_MAX_SCREENS: number
export const CHUNK_CHARS: number
export const TOTAL_CHUNK_LIMIT: number
export const A4_PAPER: { paperWidth: number; paperHeight: number }

export function longPaper(scrollWidthPx: number, scrollHeightPx: number): { paperWidth: number; paperHeight: number }
export function chunkBase64(base64: string, chunkChars?: number): Array<{ seq: number; data: string }>
export type PlanChunksResult = { ok: true; totalChunks: number } | { ok: false; totalChunks: number; limit: number }
export function planChunks(base64Length: number, chunkChars?: number): PlanChunksResult
export function decodedByteLength(base64: string): number
export function deepScrollPlan(docHeightPx: number, viewportHeightPx: number, maxScreens?: number): number[]
