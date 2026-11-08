/**
 * The capture relay: reassembles chunked page-snapshot envelopes from the
 * companion browser extension and files the finished PDF into the reader
 * library through the mounted `pdfReader` Remote.
 *
 * The class is transport- and framework-free: the plugin entry wires
 * `window.postMessage` in, and tests drive {@link CaptureRelay.handle} with
 * plain envelope objects.
 *
 * @module @deepseek-ai/dsh-client-ui-web-capture/src/client/relay
 */

import type {} from '@deepseek-ai/dsh-pdf-reader'
import type { BookRow } from '@deepseek-ai/dsh-pdf-reader/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AckEnvelope, BeginEnvelope, CaptureMode, RelayError, RelayErrorCode, ReplyEnvelope, ResultEnvelope,
} from './protocol.ts'
import { ACK_SOURCE, RELAY_SOURCE } from './protocol.ts'

/** localStorage key holding this GUI's pairing token. */
export const TOKEN_STORAGE_KEY = 'dsh:web-capture:token'
/** PDF byte ceiling the relay enforces before asking the Host (mirrors the reader default). */
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024
/** Hard cap on one capture's chunk count, matching the extension's plan limit. */
export const MAX_CHUNKS = 2048
/** Longest title the relay files, mirroring the reader's shelf-row bound. */
const MAX_TITLE_CHARS = 300
/** Longest source URL the relay records. */
const MAX_URL_CHARS = 2000
/** Idle window between envelopes before an unfinished capture is dropped. */
const IDLE_TIMEOUT_MS = 60_000
/** Whole-capture budget for the Host import call. */
const IMPORT_BUDGET_MS = 120_000
/** Every capture id this relay accepts. */
const ID = /^[\w-]{1,64}$/u
/** Canonical base64, the only alphabet `importBook` decodes. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u

/** The library call the relay makes once a capture reassembles. */
export type ImportBook = (
  fileName: string,
  pdfBase64: string,
  source: { url: string; capturedAt: number } | null,
  signal: AbortSignal,
) => Promise<RemoteResult<BookRow>>

/** Constructor face of the relay; every member is injectable for tests. */
export interface CaptureRelayOptions {
  /** This GUI's pairing token; envelopes carrying anything else are refused. */
  readonly token: string
  /** PDF byte ceiling; defaults to {@link DEFAULT_MAX_BYTES}. */
  readonly maxBytes?: number
  /** The mounted Remote call that files one finished PDF. */
  readonly importBook: ImportBook
  /** Best-effort panel switch after a successful import. */
  readonly selectPanel: () => void
  /** Notified with the filed shelf row after a successful import. */
  readonly onImported?: (book: BookRow) => void
  /** Sink for every reply envelope (the plugin posts it into the page). */
  readonly send: (envelope: ReplyEnvelope) => void
  /** Import-signal factory; defaults to a 120 s `AbortSignal.timeout`. */
  readonly makeSignal?: () => AbortSignal
}

/** One capture being reassembled. */
interface Inflight {
  readonly begin: BeginEnvelope
  readonly chunks: Map<number, string>
  timer: ReturnType<typeof setTimeout>
}

/**
 * Reassembles extension captures into library imports. One instance lives for
 * the plugin's browser lifetime and answers strictly one capture at a time.
 */
export class CaptureRelay {
  private readonly token: string
  private readonly maxBytes: number
  private readonly importBook: ImportBook
  private readonly selectPanel: () => void
  private readonly onImported: ((book: BookRow) => void) | undefined
  private readonly send: (envelope: ReplyEnvelope) => void
  private readonly makeSignal: () => AbortSignal
  private readonly inflight = new Map<string, Inflight>()
  private disposed = false

  constructor(options: CaptureRelayOptions) {
    this.token = options.token
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.importBook = options.importBook
    this.selectPanel = options.selectPanel
    this.onImported = options.onImported
    this.send = options.send
    this.makeSignal = options.makeSignal ?? defaultSignal
  }

  /** Handle one `message` event's data; unrelated traffic returns silently. */
  handle(data: unknown): void {
    if (typeof data !== 'object' || data === null) return
    const envelope = data as { source?: unknown; kind?: unknown }
    if (envelope.source !== RELAY_SOURCE) return
    if (envelope.kind === 'begin') this.onBegin(data as Record<string, unknown>)
    else if (envelope.kind === 'chunk') this.onChunk(data as Record<string, unknown>)
  }

  /** Drop every in-flight capture and stop answering; pending timers are cleared. */
  dispose(): void {
    this.disposed = true
    for (const capture of this.inflight.values()) clearTimeout(capture.timer)
    this.inflight.clear()
  }

  /** Validate and open one capture, or answer its refusal. */
  private onBegin(data: Record<string, unknown>): void {
    const captureId = stringOf(data.captureId)
    if (data.token !== this.token) {
      this.refuse(captureId, 'bad-token', 'The pairing token does not match this GUI')
      return
    }
    if (!ID.test(captureId)) {
      this.refuse(captureId, 'bad-envelope', 'The capture id is malformed')
      return
    }
    if (this.inflight.size > 0) {
      this.refuse(captureId, 'busy', 'Another capture is already in flight')
      return
    }
    const title = stringOf(data.title).trim().slice(0, MAX_TITLE_CHARS)
    const url = stringOf(data.url).slice(0, MAX_URL_CHARS)
    const byteLength = numberOr(data.byteLength, Number.NaN)
    const totalChunks = numberOr(data.totalChunks, Number.NaN)
    const mode: CaptureMode = data.mode === 'a4' ? 'a4' : 'long'
    if (title === '') {
      this.refuse(captureId, 'bad-envelope', 'The capture title is empty')
      return
    }
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > this.maxBytes) {
      this.refuse(
        captureId,
        byteLength > this.maxBytes ? 'too-large' : 'bad-envelope',
        `The capture declares ${byteLength} bytes; the ceiling is ${this.maxBytes}`,
      )
      return
    }
    if (!Number.isSafeInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
      this.refuse(
        captureId,
        totalChunks > MAX_CHUNKS ? 'too-many-chunks' : 'bad-envelope',
        `The capture declares ${totalChunks} chunks; 1..${MAX_CHUNKS} are accepted`,
      )
      return
    }
    const begin: BeginEnvelope = {
      source: RELAY_SOURCE, kind: 'begin', token: this.token,
      captureId, title, url, mode, byteLength, totalChunks,
      capturedAt: sanitizeCapturedAt(numberOr(data.capturedAt, Number.NaN)),
    }
    const capture: Inflight = {
      begin,
      chunks: new Map(),
      timer: setTimeout(() => { this.expire(captureId) }, IDLE_TIMEOUT_MS),
    }
    this.inflight.set(captureId, capture)
    this.send({ source: ACK_SOURCE, kind: 'ack', captureId, seq: -1 } satisfies AckEnvelope)
  }

  /** Accept one fragment; the completing fragment triggers the library import. */
  private onChunk(data: Record<string, unknown>): void {
    const captureId = stringOf(data.captureId)
    const seq = numberOr(data.seq, Number.NaN)
    if (data.token !== this.token) {
      this.refuse(captureId, 'bad-token', 'The pairing token does not match this GUI')
      return
    }
    const capture = this.inflight.get(captureId)
    if (capture === undefined) {
      this.refuse(captureId, 'unknown-capture', 'No capture with that id is in flight')
      return
    }
    const chunk = stringOf(data.data)
    if (!Number.isSafeInteger(seq) || seq < 0 || seq >= capture.begin.totalChunks || !BASE64.test(chunk)) {
      this.refuse(captureId, 'bad-chunk', 'The chunk seq or payload is malformed')
      return
    }
    if (capture.chunks.get(seq) !== undefined) {
      this.refuse(captureId, 'bad-chunk', `Chunk ${seq} was already received`)
      return
    }
    capture.chunks.set(seq, chunk)
    this.armIdle(capture)
    if (capture.chunks.size < capture.begin.totalChunks) {
      this.send({ source: ACK_SOURCE, kind: 'ack', captureId, seq } satisfies AckEnvelope)
      return
    }
    // The completing fragment is acknowledged by the import result, not an ack.
    const base64 = this.reassemble(capture)
    if (base64 === null) {
      this.close(captureId)
      this.refuse(captureId, 'bad-chunk', 'The reassembled payload is not canonical base64')
      return
    }
    const decoded = decodedByteLength(base64)
    if (decoded !== capture.begin.byteLength) {
      this.close(captureId)
      this.refuse(captureId, 'bad-chunk', `The reassembled payload is ${decoded} bytes; ${capture.begin.byteLength} were declared`)
      return
    }
    this.close(captureId)
    void this.import(captureId, capture.begin, base64)
  }

  /** Reassemble in seq order, validating the joined payload as one base64 body. */
  private reassemble(capture: Inflight): string | null {
    const parts: string[] = []
    for (let seq = 0; seq < capture.begin.totalChunks; seq += 1) {
      const part = capture.chunks.get(seq)
      if (part === undefined) return null
      parts.push(part)
    }
    const joined = parts.join('')
    return BASE64.test(joined) && joined.length % 4 === 0 ? joined : null
  }

  /** File one finished capture and answer its terminal reply. */
  private async import(captureId: string, begin: BeginEnvelope, base64: string): Promise<void> {
    let result: RemoteResult<BookRow>
    try {
      result = await this.importBook(begin.title, base64, { url: begin.url, capturedAt: begin.capturedAt }, this.makeSignal())
    } catch (error) {
      this.refuse(captureId, 'import-failed', error instanceof Error ? error.message : String(error))
      return
    }
    if (!result.ok) {
      const code: RelayErrorCode = result.error.code === 'pdf/too-large' ? 'too-large'
        : result.error.code === 'pdf/bad-file' ? 'bad-file'
          : 'import-failed'
      this.refuse(captureId, code, result.error.message)
      return
    }
    this.selectPanel()
    this.onImported?.(result.value)
    this.send({
      source: ACK_SOURCE, kind: 'result', captureId, ok: true,
      bookId: result.value.bookId, title: result.value.title,
    } satisfies ResultEnvelope)
  }

  /** Restart the idle timer one envelope keeps postponing. */
  private armIdle(capture: Inflight): void {
    clearTimeout(capture.timer)
    if (!this.disposed) capture.timer = setTimeout(() => { this.expire(capture.begin.captureId) }, IDLE_TIMEOUT_MS)
  }

  /** Answer one capture that never completed and forget it. */
  private expire(captureId: string): void {
    if (!this.inflight.has(captureId)) return
    this.close(captureId)
    this.refuse(captureId, 'timeout', 'The capture did not complete in time')
  }

  /** Forget one capture without answering. */
  private close(captureId: string): void {
    const capture = this.inflight.get(captureId)
    if (capture !== undefined) clearTimeout(capture.timer)
    this.inflight.delete(captureId)
  }

  /** Answer one capture with its typed failure. */
  private refuse(captureId: string, code: RelayErrorCode, message: string): void {
    const error: RelayError = { code, message }
    this.send({ source: ACK_SOURCE, kind: 'result', captureId, ok: false, error } satisfies ResultEnvelope)
  }
}

/** Read one envelope field as a string; anything else reads as empty. */
function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Read one envelope field as a finite number; anything else reads as the fallback. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** The capture time one record keeps: a sane epoch stamp, else now. */
function sanitizeCapturedAt(value: number): number {
  const now = Date.now()
  return Number.isSafeInteger(value) && value > 0 && value <= now + 86_400_000 ? value : now
}

/** Decoded byte count of one canonical base64 body; a malformed body reads as `NaN`. */
export function decodedByteLength(base64: string): number {
  if (!BASE64.test(base64) || base64.length % 4 !== 0) return Number.NaN
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length / 4) * 3 - padding
}

/** The default import signal: a 120 s timeout when the platform offers it. */
function defaultSignal(): AbortSignal {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(IMPORT_BUDGET_MS)
    : new AbortController().signal
}
