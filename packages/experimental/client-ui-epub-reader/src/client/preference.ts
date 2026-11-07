/**
 * Browser-local reader preferences.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-epub-reader/client/preference
 */

/** localStorage key holding `on` or `off`; absent means the default `on`. */
const PAPER_KEY = 'epub-reader:paper'

/** Read the paper tint preference; on unless the reader explicitly turned it off. */
export function readPaperPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(PAPER_KEY) !== 'off'
  } catch {
    // Blocked storage (private mode, disabled) keeps the in-memory default.
    return true
  }
}

/** Persist the paper tint preference for the next reader session. */
export function writePaperPreference(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(PAPER_KEY, on ? 'on' : 'off')
  } catch {
    // Blocked storage only loses the choice across reloads.
  }
}

/** localStorage key holding `sans` (PingFang-led) or `serif`; absent means the default `sans`. */
const FONT_KEY = 'epub-reader:font'

/** Read the reading typeface preference; PingFang-led sans unless the reader chose the serif stack. */
export function readSansFontPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(FONT_KEY) !== 'serif'
  } catch {
    return true
  }
}

/** Persist the reading typeface preference for the next reader session. */
export function writeSansFontPreference(sans: boolean): void {
  try {
    globalThis.localStorage?.setItem(FONT_KEY, sans ? 'sans' : 'serif')
  } catch {
    // Blocked storage only loses the choice across reloads.
  }
}
