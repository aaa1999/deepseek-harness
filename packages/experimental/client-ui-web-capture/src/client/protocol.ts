/**
 * Wire vocabulary of the web-capture relay: the envelopes the companion
 * extension posts into the DSH GUI page, and the replies the relay posts back.
 *
 * The transport is `window.postMessage` bridged by a content script the
 * extension registers on the GUI origin; every envelope crossing that bridge
 * carries {@link RELAY_SOURCE} or {@link ACK_SOURCE} so unrelated page
 * traffic is ignored on both sides.
 *
 * @module @deepseek-ai/dsh-client-ui-web-capture/src/client/protocol
 */

/** Window-message tag every extension→page envelope carries. */
export const RELAY_SOURCE = 'dsh-web-capture'
/** Window-message tag every page→extension reply carries. */
export const ACK_SOURCE = 'dsh-web-capture-ack'

/** The two snapshot page shapes the extension produces. */
export type CaptureMode = 'long' | 'a4'

/** The first envelope of one capture: everything about the PDF except its bytes. */
export interface BeginEnvelope {
  readonly source: typeof RELAY_SOURCE
  readonly kind: 'begin'
  readonly token: string
  readonly captureId: string
  readonly title: string
  readonly url: string
  readonly mode: CaptureMode
  readonly byteLength: number
  readonly totalChunks: number
  /** Capture time in epoch milliseconds; the relay stamps now when absent. */
  readonly capturedAt: number
}

/** One base64 fragment of the capture's PDF bytes; chunk 0 is sent after `begin`. */
export interface ChunkEnvelope {
  readonly source: typeof RELAY_SOURCE
  readonly kind: 'chunk'
  readonly token: string
  readonly captureId: string
  readonly seq: number
  readonly data: string
}

/** Every envelope the relay accepts. */
export type CaptureEnvelope = BeginEnvelope | ChunkEnvelope

/** Receipt of one accepted envelope; `begin` acknowledges with `seq: -1`. */
export interface AckEnvelope {
  readonly source: typeof ACK_SOURCE
  readonly kind: 'ack'
  readonly captureId: string
  readonly seq: number
}

/** The typed failure every relay refusal and import outcome carries. */
export interface RelayError {
  readonly code: RelayErrorCode
  readonly message: string
}

/** The terminal reply of one capture: the filed shelf row or the failure. */
export interface ResultEnvelope {
  readonly source: typeof ACK_SOURCE
  readonly kind: 'result'
  readonly captureId: string
  readonly ok: boolean
  readonly bookId?: string
  readonly title?: string
  readonly error?: RelayError
}

/** Every reply the relay posts back into the page. */
export type ReplyEnvelope = AckEnvelope | ResultEnvelope

/** Machine-readable failure codes the relay answers with; the extension maps them to copy. */
export type RelayErrorCode
  = 'bad-token'
  | 'bad-envelope'
  | 'busy'
  | 'too-large'
  | 'too-many-chunks'
  | 'unknown-capture'
  | 'bad-chunk'
  | 'timeout'
  | 'bad-file'
  | 'import-failed'
  | 'gui-error'
