/** Reader controller flows over a faked Remote face: library, pages, streams, shots, progress. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Registers the pdf/* RemoteError codes the failure mocks carry.
import type {} from '@deepseek-ai/dsh-pdf-reader'
import type {
  AskImageRequest, BookRow, ExplainRequest, MetaReport, PdfAnnotation, PdfBytes, TocEntry, TreatChunk,
} from '@deepseek-ai/dsh-pdf-reader/types'
import { ReaderController } from '../src/client/controller.ts'
import type { PdfSelectionValue } from '../src/client/contract.ts'

/** One shelf row the library tests reuse. */
function bookRow(overrides: Partial<BookRow> = {}): BookRow {
  return {
    bookId: 'b1', title: 'Sample Paper', pageCount: 3, outline: [],
    progress: { page: 1 }, coverUrl: null, importedAt: 1, source: null,
    ...overrides,
  }
}

/** One captured selection the treatment tests reuse. */
const selection: PdfSelectionValue = {
  bookId: 'b1', page: 2, start: 4, end: 10, text: 'was th', context: 'It was the best of times.',
}

/** The Remote face mock: every method a controller can call. */
function remoteFace() {
  const choice = { text: { provider: '', model: '' }, shot: { provider: '', model: '' } }
  return {
    list: vi.fn(async (): Promise<RemoteResult<BookRow[]>> => ({ ok: true, value: [bookRow()] })),
    importBook: vi.fn(async (name: string): Promise<RemoteResult<BookRow>> => ({
      ok: true, value: bookRow({ title: name, pageCount: 0 }),
    })),
    removeBook: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    saveBookMeta: vi.fn(async (_bookId: string, report: MetaReport): Promise<RemoteResult<BookRow>> => ({
      ok: true, value: bookRow({ title: report.title, pageCount: report.pageCount, outline: [...report.outline] }),
    })),
    saveCover: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    pdfBytes: vi.fn(async (): Promise<RemoteResult<PdfBytes>> => ({ ok: true, value: { data: new Uint8Array([37, 80, 68, 70]) } })),
    saveProgress: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    annotations: vi.fn(async (): Promise<RemoteResult<PdfAnnotation[]>> => ({ ok: true, value: [] })),
    saveAnnotation: vi.fn(async (_bookId: string, _annotation: PdfAnnotation): Promise<RemoteResult<void>> => ({
      ok: true, value: undefined,
    })),
    deleteAnnotation: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    storage: vi.fn(async (): Promise<RemoteResult<{ directory: string; configurable: boolean }>> => ({
      ok: true, value: { directory: '/Papers/reader', configurable: true },
    })),
    setStorageDirectory: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    treatmentModels: vi.fn(async (): Promise<RemoteResult<{
      provider: string
      model: string
      shotProvider: string
      shotModel: string
      defaultProvider: string
      defaultModel: string
      models: { provider: string; model: string; name: string; vision: boolean }[]
    }>> => ({
      ok: true,
      value: {
        provider: choice.text.provider, model: choice.text.model,
        shotProvider: choice.shot.provider, shotModel: choice.shot.model,
        defaultProvider: 'deepseek-official', defaultModel: 'deepseek-chat',
        models: [
          { provider: 'deepseek-official', model: 'deepseek-chat', name: 'DeepSeek Chat', vision: false },
          { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek Vision', vision: true },
        ],
      },
    })),
    setTreatmentModel: vi.fn(async (provider: string, model: string): Promise<RemoteResult<void>> => {
      choice.text = { provider, model }
      return { ok: true, value: undefined }
    }),
    setShotModel: vi.fn(async (provider: string, model: string): Promise<RemoteResult<void>> => {
      choice.shot = { provider, model }
      return { ok: true, value: undefined }
    }),
    explain: vi.fn((_request: ExplainRequest, _signal: AbortSignal): AsyncIterable<TreatChunk> => {
      throw new Error('each test overrides explain')
    }),
    askImage: vi.fn((_request: AskImageRequest, _signal: AbortSignal): AsyncIterable<TreatChunk> => {
      throw new Error('each test overrides askImage')
    }),
  }
}

/** A controller over one fresh Remote mock; the fake Context carries only that face. */
function controller() {
  const remote = remoteFace()
  const reader = new ReaderController({ remote: { pdfReader: remote } } as unknown as Context)
  return { reader, remote }
}

/** One saved text annotation the state tests reuse. */
function savedText(overrides: Partial<Extract<PdfAnnotation, { kind: 'text' }>> = {}): Extract<PdfAnnotation, { kind: 'text' }> {
  return {
    kind: 'text', id: 'a1', page: 2, start: 4, end: 10, quote: 'was th', createdAt: 5,
    results: [{ kind: 'translate', text: '曾是', model: 'test-model', createdAt: 6 }],
    ...overrides,
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('ReaderController', () => {
  it('loads the library and reports its failures', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    expect(reader.store.getSnapshot()).toMatchObject({ library: { status: 'ready' }, books: [bookRow()] })

    remote.list.mockResolvedValueOnce({ ok: false, error: new RemoteError('pdf/not-found', 'denied', { subject: 'book' }) })
    await reader.loadLibrary()
    expect(reader.store.getSnapshot().library).toMatchObject({ status: 'failed', error: 'denied' })
  })

  it('imports only PDF files and surfaces the first failure', async () => {
    const { reader, remote } = controller()
    reader.importFiles([new File(['x'], 'notes.txt'), new File(['%PDF-'], 'paper.pdf')])
    await vi.runAllTimersAsync()
    expect(remote.importBook).toHaveBeenCalledTimes(1)
    expect(remote.importBook.mock.calls[0]?.[0]).toBe('paper.pdf')

    remote.importBook.mockRejectedValueOnce(Object.assign(new Error('too large'), { }))
    reader.importFiles([new File(['%PDF-'], 'big.pdf')])
    await vi.runAllTimersAsync()
    expect(reader.store.getSnapshot().importError).toContain('too large')
  })

  it('opens a book, fetches bytes once, and clamps page turns into the report', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    expect(reader.store.getSnapshot().view).toBe('reader')
    await vi.runAllTimersAsync()
    expect(reader.store.getSnapshot().open).toMatchObject({ ready: true, page: 1, pageCount: 3, metaReported: true })

    reader.selectPage(99)
    expect(reader.store.getSnapshot().open?.page).toBe(3)
    reader.selectPage(0)
    expect(reader.store.getSnapshot().open?.page).toBe(1)
    reader.stepPage(1)
    expect(reader.store.getSnapshot().open?.page).toBe(2)
    reader.setZoom(9)
    expect(reader.store.getSnapshot().open?.zoom).toBe(3)

    reader.openBook('b1')
    await vi.runAllTimersAsync()
    expect(remote.pdfBytes).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2500)
    expect(remote.saveProgress).toHaveBeenCalledWith('b1', { page: 2 })
  })

  it('merges the first-open report into the open book and shelf', async () => {
    const { reader } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    const outline: TocEntry[] = [{ title: 'Intro', page: 1 }]
    await reader.reportMeta('b1', { title: 'A Real Title', pageCount: 42, outline })
    expect(reader.store.getSnapshot().open).toMatchObject({ title: 'A Real Title', pageCount: 42, metaReported: true })
    expect(reader.store.getSnapshot().books[0]).toMatchObject({ title: 'A Real Title', pageCount: 42 })
  })

  it('streams a text treatment and persists it as an annotation', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    remote.explain.mockImplementationOnce(async function* (): AsyncIterable<TreatChunk> {
      yield { type: 'meta', model: 'm1' }
      yield { type: 'delta', text: '曾是' }
      yield { type: 'delta', text: '这样' }
      yield { type: 'done' }
    })
    reader.treat(selection, 'translate')
    await vi.runAllTimersAsync()

    const saved = remote.saveAnnotation.mock.calls[0]?.[1] as Extract<PdfAnnotation, { kind: 'text' }>
    expect(saved).toMatchObject({ kind: 'text', page: 2, quote: 'was th', results: [{ kind: 'translate', text: '曾是这样', model: 'm1' }] })
    expect(reader.store.getSnapshot().annotations[0]?.id).toBe(saved.id)
    expect(reader.store.getSnapshot().streams[saved.id]).toBeUndefined()
  })

  it('annotates a selection as a plain marker highlight with the current pen color', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()

    reader.annotate(selection)
    await vi.runAllTimersAsync()

    const saved = remote.saveAnnotation.mock.calls[0]?.[1] as Extract<PdfAnnotation, { kind: 'text' }>
    expect(saved).toMatchObject({ kind: 'text', page: 2, quote: 'was th', color: 'yellow', results: [] })
    expect(remote.explain).not.toHaveBeenCalled()
    expect(reader.store.getSnapshot().annotations[0]?.id).toBe(saved.id)
  })

  it('repaints one annotation in another color and makes that color current', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    reader.store.set({ ...reader.store.getSnapshot(), annotations: [savedText()] })

    reader.setAnnotationColor(savedText().id, 'blue')
    await vi.runAllTimersAsync()

    const saved = remote.saveAnnotation.mock.calls[0]?.[1] as Extract<PdfAnnotation, { kind: 'text' }>
    expect(saved).toMatchObject({ id: savedText().id, color: 'blue' })
    expect(reader.store.getSnapshot().annotations[0]).toMatchObject({ id: savedText().id, color: 'blue' })
  })

  it('records a stream failure without saving', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    remote.explain.mockImplementationOnce(async function* (): AsyncIterable<TreatChunk> {
      yield { type: 'meta', model: 'm1' }
      throw new Error('model offline')
    })
    reader.treat(selection, 'explain')
    await vi.runAllTimersAsync()
    expect(remote.saveAnnotation).not.toHaveBeenCalled()
    expect(Object.values(reader.store.getSnapshot().streams)[0]).toMatchObject({ error: 'model offline' })
  })

  it('streams a screenshot answer and persists the crop URL the done chunk carried', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    remote.askImage.mockImplementationOnce(async function* (): AsyncIterable<TreatChunk> {
      yield { type: 'meta', model: 'vision-m' }
      yield { type: 'delta', text: '图中是' }
      yield { type: 'done', imageUrl: '/api/pdf-reader/shot?book=b1&id=s1' }
    })
    reader.askShot({ bookId: 'b1', page: 2, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.3 }, pngBase64: 'aGk=', question: '解释这块' })
    await vi.runAllTimersAsync()

    const ask = remote.askImage.mock.calls[0]?.[0] as { annotationId: string; question: string }
    expect(ask.annotationId).toMatch(/^[\da-f-]{36}$/iu)
    const saved = remote.saveAnnotation.mock.calls[0]?.[1] as Extract<PdfAnnotation, { kind: 'shot' }>
    expect(saved).toMatchObject({
      kind: 'shot', page: 2, imageUrl: '/api/pdf-reader/shot?book=b1&id=s1',
      question: '解释这块', answer: { text: '图中是', model: 'vision-m' },
    })
    expect(reader.store.getSnapshot().shots[saved.id]).toBeUndefined()
  })

  it('retries a saved text annotation against its stored quote', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    reader.store.set({ ...reader.store.getSnapshot(), annotations: [savedText()] })
    remote.explain.mockImplementationOnce(async function* (): AsyncIterable<TreatChunk> {
      yield { type: 'meta', model: 'm2' }
      yield { type: 'delta', text: '重新' }
      yield { type: 'done' }
    })
    reader.retryTextAnnotation('a1')
    await vi.runAllTimersAsync()
    const request = remote.explain.mock.calls[0]?.[0] as { text: string; kind: string }
    expect(request).toMatchObject({ text: 'was th', kind: 'translate' })
  })

  it('deletes an annotation locally and remotely', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    reader.store.set({ ...reader.store.getSnapshot(), annotations: [savedText()] })
    reader.deleteAnnotation('a1')
    expect(reader.store.getSnapshot().annotations).toEqual([])
    expect(remote.deleteAnnotation).toHaveBeenCalledWith('b1', 'a1')
  })

  it('opens settings, moves the directory, and reloads the shelf', async () => {
    const { reader, remote } = controller()
    reader.openStorageSettings()
    await vi.runAllTimersAsync()
    expect(reader.store.getSnapshot().storage).toMatchObject({
      open: true, directory: '/Papers/reader', configurable: true,
      modelProvider: '', shotProvider: '',
    })

    reader.saveShotModel('deepseek-official', 'deepseek-v4-flash-vision-exp')
    await vi.runAllTimersAsync()
    expect(remote.setShotModel).toHaveBeenCalledWith('deepseek-official', 'deepseek-v4-flash-vision-exp')
    expect(reader.store.getSnapshot().storage).toMatchObject({ shotProvider: 'deepseek-official', shotModel: 'deepseek-v4-flash-vision-exp' })

    reader.saveStorageSettings('/New/Papers')
    await vi.runAllTimersAsync()
    expect(remote.setStorageDirectory).toHaveBeenCalledWith('/New/Papers')
    expect(reader.store.getSnapshot().storage.open).toBe(false)
    // The reload the callback fires is this test's only shelf load.
    expect(remote.list.mock.calls.length).toBe(1)
    expect(reader.store.getSnapshot().library.status).toBe('ready')
  })

  it('aborts in-flight streams on dispose', async () => {
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.openBook('b1')
    await vi.runAllTimersAsync()
    let observed: AbortSignal | undefined
    let released: (() => void) | undefined
    remote.explain.mockImplementationOnce((_request: unknown, signal: AbortSignal): AsyncIterable<TreatChunk> => {
      observed = signal
      return (async function* () {
        yield { type: 'meta', model: 'm' }
        await new Promise<void>((resolve) => { released = resolve })
        yield { type: 'done' }
      })()
    })
    reader.treat(selection, 'translate')
    await vi.advanceTimersByTimeAsync(10)
    reader.dispose()
    expect(observed?.aborted).toBe(true)
    released?.()
    await vi.runAllTimersAsync()
  })
})
