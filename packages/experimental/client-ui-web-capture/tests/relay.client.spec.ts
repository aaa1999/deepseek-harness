/** Relay flows over faked import/panel sinks: pairing, chunking, refusal mapping, and idle expiry. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ReplyEnvelope } from '../src/client/protocol.ts'
import { ACK_SOURCE } from '../src/client/protocol.ts'
import { CaptureRelay, type ImportBook } from '../src/client/relay.ts'

/** One in-flight capture's identity the fixtures reuse. */
const TOKEN = 'token-1'
const CAPTURE = 'cap-1'

/** Sink collecting every reply envelope the relay posts. */
function sink(): { sent: ReplyEnvelope[]; send: (envelope: ReplyEnvelope) => void } {
  const sent: ReplyEnvelope[] = []
  return { sent, send: (envelope) => { sent.push(envelope) } }
}

/** One Remote success the import fixtures reuse. */
function okImport(): {
  importBook: ImportBook
  calls: Array<{ name: string; base64: string; source: { url: string; capturedAt: number } | null }>
} {
  const calls: Array<{ name: string; base64: string; source: { url: string; capturedAt: number } | null }> = []
  const importBook: ImportBook = async (name, base64, source) => {
    calls.push({ name, base64, source })
    return { ok: true, value: { bookId: 'b1', title: name, pageCount: 5, outline: [], progress: { page: 1 }, coverUrl: null, importedAt: 1, source } }
  }
  return { importBook, calls }
}

/** One Remote failure the import fixtures reuse. */
function failImport(code: string): ImportBook {
  return async () => ({ ok: false, error: { code, message: 'library said no' } as RemoteFailure })
}

/** One capture's begin envelope. */
function begin(overrides: Record<string, unknown> = {}): unknown {
  return {
    source: 'dsh-web-capture', kind: 'begin', token: TOKEN, captureId: CAPTURE,
    title: '  A Page  ', url: 'https://example.com/a', mode: 'long',
    byteLength: 5, totalChunks: 2, ...overrides,
  }
}

/** One capture's chunk envelope. */
function chunk(seq: number, data: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    source: 'dsh-web-capture', kind: 'chunk', token: TOKEN, captureId: CAPTURE,
    seq, data, ...overrides,
  }
}

/** The last reply envelope, typed as a result for refusal assertions. */
function lastResult(sent: ReplyEnvelope[]) {
  const last = sent.at(-1)
  expect(last?.source).toBe(ACK_SOURCE)
  expect(last?.kind).toBe('result')
  return last as Extract<ReplyEnvelope, { kind: 'result' }>
}

let relay: CaptureRelay | undefined

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { relay?.dispose(); vi.useRealTimers() })

describe('CaptureRelay', () => {
  it('reassembles chunks in seq order and files the finished PDF', async () => {
    const { sent, send } = sink()
    const { importBook, calls } = okImport()
    const selectPanel = vi.fn()
    const onImported = vi.fn()
    const capturedAt = 1_768_000_000_000
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel, onImported, send })
    relay.handle(begin({ capturedAt }))
    expect(sent).toEqual([{ source: ACK_SOURCE, kind: 'ack', captureId: CAPTURE, seq: -1 }])
    relay.handle(chunk(1, 'AwQ='))
    expect(sent.at(-1)).toEqual({ source: ACK_SOURCE, kind: 'ack', captureId: CAPTURE, seq: 1 })
    relay.handle(chunk(0, 'AAEC'))
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]?.name).toBe('A Page')
    expect(calls[0]?.base64).toBe('AAECAwQ=')
    expect(calls[0]?.source).toEqual({ url: 'https://example.com/a', capturedAt })
    expect(selectPanel).toHaveBeenCalledOnce()
    expect(onImported).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bookId: 'b1' }))
    expect(lastResult(sent)).toEqual({
      source: ACK_SOURCE, kind: 'result', captureId: CAPTURE, ok: true, bookId: 'b1', title: 'A Page',
    })
  })

  it('stamps now when the envelope carries no usable capture time', async () => {
    const { send } = sink()
    const { importBook, calls } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(begin({ capturedAt: Number.NaN, totalChunks: 1, byteLength: 3 }))
    relay.handle(chunk(0, 'AAEC'))
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]?.source?.capturedAt).toBeGreaterThan(Date.now() - 10_000)
  })

  it('refuses a capture whose token does not pair', () => {
    const { sent, send } = sink()
    const { importBook } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(begin({ token: 'other' }))
    expect(lastResult(sent).error?.code).toBe('bad-token')
    expect(sent).toHaveLength(1)
  })

  it('refuses a second capture while one is in flight', () => {
    const { sent, send } = sink()
    const { importBook } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(begin())
    relay.handle(begin({ captureId: 'cap-2' }))
    expect(lastResult(sent).error?.code).toBe('busy')
    expect(lastResult(sent).captureId).toBe('cap-2')
  })

  it('refuses an over-ceiling capture before any chunk ships', () => {
    const { sent, send } = sink()
    const { importBook } = okImport()
    relay = new CaptureRelay({ token: TOKEN, maxBytes: 10, importBook, selectPanel: () => {}, send })
    relay.handle(begin({ byteLength: 11 }))
    expect(lastResult(sent).error?.code).toBe('too-large')
  })

  it('refuses a chunk for a capture that never began', () => {
    const { sent, send } = sink()
    const { importBook } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(chunk(0, 'AAEC'))
    expect(lastResult(sent).error?.code).toBe('unknown-capture')
  })

  it('refuses a duplicate or out-of-range chunk', () => {
    const { sent, send } = sink()
    const { importBook } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(begin())
    relay.handle(chunk(0, 'AAEC'))
    relay.handle(chunk(0, 'AAEC'))
    expect(lastResult(sent).error?.code).toBe('bad-chunk')
    relay.handle(chunk(2, 'AAEC'))
    expect(lastResult(sent).error?.code).toBe('bad-chunk')
  })

  it('refuses a reassembly whose decoded size contradicts the declaration', async () => {
    const { sent, send } = sink()
    const { importBook, calls } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(begin({ byteLength: 6 }))
    relay.handle(chunk(0, 'AAEC'))
    relay.handle(chunk(1, 'AwQ='))
    await vi.waitFor(() => { expect(lastResult(sent).error?.code).toBe('bad-chunk') })
    expect(calls).toHaveLength(0)
  })

  it('maps library refusals to relay codes', async () => {
    for (const [code, expected] of [['pdf/too-large', 'too-large'], ['pdf/bad-file', 'bad-file'], ['pdf/other', 'import-failed']] as const) {
      const { sent, send } = sink()
      relay = new CaptureRelay({ token: TOKEN, importBook: failImport(code), selectPanel: () => {}, send })
      relay.handle(begin({ byteLength: 3, totalChunks: 1 }))
      relay.handle(chunk(0, 'AAEC'))
      await vi.waitFor(() => { expect(lastResult(sent).error?.code).toBe(expected) })
      relay.dispose()
    }
  })

  it('answers an import that throws as an import failure', async () => {
    const { sent, send } = sink()
    relay = new CaptureRelay({
      token: TOKEN,
      importBook: async () => { throw new Error('boom') },
      selectPanel: () => {},
      send,
    })
    relay.handle(begin({ byteLength: 3, totalChunks: 1 }))
    relay.handle(chunk(0, 'AAEC'))
    await vi.waitFor(() => { expect(lastResult(sent).error?.code).toBe('import-failed') })
  })

  it('expires an unfinished capture after the idle window', () => {
    const { sent, send } = sink()
    const { importBook } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(begin())
    vi.advanceTimersByTime(60_000)
    expect(lastResult(sent).error?.code).toBe('timeout')
    relay.handle(chunk(0, 'AAEC'))
    expect(lastResult(sent).error?.code).toBe('unknown-capture')
  })

  it('ignores traffic that is not a capture envelope', () => {
    const { sent, send } = sink()
    const { importBook } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(null)
    relay.handle({ source: 'other', kind: 'begin' })
    relay.handle('dsh-web-capture')
    expect(sent).toHaveLength(0)
  })

  it('slices and trims the filed title to the shelf bound', async () => {
    const { sent, send } = sink()
    const { importBook, calls } = okImport()
    relay = new CaptureRelay({ token: TOKEN, importBook, selectPanel: () => {}, send })
    relay.handle(begin({ title: `  ${'长'.repeat(400)}  `, byteLength: 3, totalChunks: 1 }))
    relay.handle(chunk(0, 'AAEC'))
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]?.name).toBe('长'.repeat(300))
    expect(lastResult(sent).ok).toBe(true)
  })
})
