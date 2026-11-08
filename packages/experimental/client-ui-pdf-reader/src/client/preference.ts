/**
 * Browser-local reading preferences.
 *
 * @module @deepseek-ai/dsh-client-ui-pdf-reader/client/preference
 */

/** How the reading pane presents one page: vertical scrolling or height-fit page flipping. */
export type ReadingMode = 'scroll' | 'flip'

/** localStorage key holding `scroll` or `flip`; absent means the default `scroll`. */
const MODE_KEY = 'pdf-reader:mode'

/** Read the reading-mode preference; scroll unless the reader explicitly chose flip. */
export function readReadingMode(): ReadingMode {
  try {
    return globalThis.localStorage?.getItem(MODE_KEY) === 'flip' ? 'flip' : 'scroll'
  } catch {
    // Blocked storage (private mode, disabled) keeps the in-memory default.
    return 'scroll'
  }
}

/** Persist the reading-mode preference for the next reader session. */
export function writeReadingMode(mode: ReadingMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, mode)
  } catch {
    // Blocked storage only loses the choice across reloads.
  }
}
