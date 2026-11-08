/**
 * Browser entry for the web-capture relay: publishes this GUI's pairing token
 * and files companion-extension page snapshots into the PDF shelf as they
 * arrive over `window.postMessage`.
 *
 * The `pdfReader` Remote namespace is mounted by client-ui-pdf-reader (the
 * bundle ships both); this plugin only injects `remote.pdfReader`, so a
 * second `$mount` can never disturb the reader's own registration.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-pdf-reader/remote'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { CaptureRelay, TOKEN_STORAGE_KEY } from './relay.ts'

/**
 * The PDF reader's main-panel key, mirroring client-ui-pdf-reader's `PANEL_ID`.
 * The literal stays local so this package never pulls the reader's client
 * bundle; the reader's `OPEN_BOOK_EVENT` listener is the shared contract.
 */
export const PDF_READER_PANEL_ID = 'pdfReader' as MainPanelId

/** The window CustomEvent that lands one shelf row in the reader (`dsh-pdf-reader:open`). */
export const OPEN_BOOK_EVENT = 'dsh-pdf-reader:open'

/** Services the entry itself needs; the relay scope adds the mounted Remote namespace. */
export const inject = ['remote', 'layout']

/** This GUI's pairing token, minted once and kept across reloads. */
function ensureToken(): string {
  const held = window.localStorage.getItem(TOKEN_STORAGE_KEY)
  if (held !== null && held !== '') return held
  const token = randomUUID()
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  return token
}

/**
 * Activate the web-capture relay: wait on the `pdfReader` Remote namespace
 * client-ui-pdf-reader mounts, then answer extension captures on this page
 * for as long as the current Peer may write the library.
 * @param ctx - Client Context carrying the declared `inject` services.
 * @returns disposer removing the listener and the relay scope.
 */
export function apply(ctx: ClientContext): (() => Promise<void>) | (() => void) {
  const ui = ctx.inject(['remote.pdfReader', 'layout'], (scope: ClientContext) => {
    const relay = new CaptureRelay({
      token: ensureToken(),
      importBook: (fileName, pdfBase64, source, signal) => scope.remote.pdfReader.importBook(fileName, pdfBase64, source, signal),
      selectPanel: () => {
        // Best effort: without the reader panel installed the shelf itself stays the feedback.
        try { scope.layout.selectPanel(PDF_READER_PANEL_ID) } catch { /* panel not registered */ }
      },
      onImported: (book) => { window.dispatchEvent(new CustomEvent(OPEN_BOOK_EVENT, { detail: { bookId: book.bookId } })) },
      send: (envelope) => { window.postMessage(envelope, window.location.origin) },
    })
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window) return
      relay.handle(event.data)
    }
    window.addEventListener('message', onMessage)
    scope.effect(() => () => {
      window.removeEventListener('message', onMessage)
      relay.dispose()
    }, 'client-ui-web-capture: relay')
  })
  return () => { void ui.dispose() }
}
