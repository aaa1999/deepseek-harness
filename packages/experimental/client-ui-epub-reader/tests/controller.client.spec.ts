/** Reader controller flows over a faked Remote face: library, streaming treatments, progress. */
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Registers the epub/* RemoteError codes the failure mocks carry.
import type {} from '@deepseek-ai/dsh-experimental-epub-reader'
import type { Annotation, BookRow, ChapterDoc, ExplainChunk, ExplainRequest, TocEntry } from '@deepseek-ai/dsh-experimental-epub-reader/types'
import { ReaderController } from '../src/client/controller.ts'
import type { EpubSelectionValue } from '../src/client/contract.ts'

/** One shelf row the library tests reuse. */
function bookRow(overrides: Partial<BookRow> = {}): BookRow {
  return {
    bookId: 'b1', title: 'Sample Book', author: 'A. Author', language: 'en',
    coverUrl: null, chapterCount: 2, progress: { chapterIndex: 0, ratio: 0 }, importedAt: 1,
    ...overrides,
  }
}

/** One captured selection the treatment tests reuse. */
const selection: EpubSelectionValue = {
  bookId: 'b1', chapterIndex: 0, start: 4, end: 10, text: 'was th', context: 'It was the best of times.',
}

/** The Remote face mock: every method a controller can call. */
function remoteFace() {
  return {
    list: vi.fn(async (): Promise<RemoteResult<BookRow[]>> => ({ ok: true, value: [bookRow()] })),
    importBook: vi.fn(async (name: string): Promise<RemoteResult<BookRow>> => ({ ok: true, value: bookRow({ title: name }) })),
    removeBook: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    toc: vi.fn(async (): Promise<RemoteResult<TocEntry[]>> => ({ ok: true, value: [{ title: 'One', chapterIndex: 0 }] })),
    chapter: vi.fn(async (): Promise<RemoteResult<ChapterDoc>> => ({
      ok: true, value: { bookId: 'b1', chapterIndex: 0, title: 'One', html: '<p>chapter body</p>' },
    })),
    annotations: vi.fn(async (): Promise<RemoteResult<Annotation[]>> => ({ ok: true, value: [] })),
    saveAnnotation: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    saveProgress: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    deleteAnnotation: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    storage: vi.fn(async (): Promise<RemoteResult<{ directory: string; configurable: boolean }>> => ({
      ok: true, value: { directory: '/Books/reader', configurable: true },
    })),
    setStorageDirectory: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    treatmentModels: vi.fn(async (): Promise<RemoteResult<{
      provider: string
      model: string
      defaultProvider: string
      defaultModel: string
      models: { provider: string; model: string; name: string }[]
    }>> => ({
      ok: true,
      value: {
        provider: '', model: '',
        defaultProvider: 'deepseek-official', defaultModel: 'deepseek-chat',
        models: [
          { provider: 'deepseek-official', model: 'deepseek-chat', name: 'DeepSeek Chat' },
          { provider: 'deepseek-official', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
        ],
      },
    })),
    setTreatmentModel: vi.fn(async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined })),
    explain: vi.fn((_request: ExplainRequest, _signal: AbortSignal): AsyncIterable<ExplainChunk> => {
      throw new Error('each test overrides explain')
    }),
  }
}

/** A controller over one fresh Remote mock; the fake Context carries only that face. */
function controller() {
  const remote = remoteFace()
  const reader = new ReaderController({ remote: { epubReader: remote } } as unknown as Context)
  return { reader, remote }
}

/** One saved annotation the state tests reuse. */
function savedAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1', chapterIndex: 0, start: 4, end: 10, quote: 'was th', createdAt: 5,
    results: [{ kind: 'translate', text: '曾是', model: 'test-model', createdAt: 6 }],
    ...overrides,
  }
}

beforeEach(() => { vi.useRealTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('loadLibrary', () => {
  it('publishes the shelf rows on success', async () => {
    const { reader } = controller()
    await reader.loadLibrary()
    const state = reader.store.getSnapshot()
    expect(state.library).toEqual({ status: 'ready', error: '' })
    expect(state.books.map(book => book.title)).toEqual(['Sample Book'])
  })

  it('keeps the failure message for the shelf to show', async () => {
    const { reader, remote } = controller()
    remote.list.mockResolvedValueOnce({ ok: false, error: new RemoteError('epub/not-found', 'shelf unreachable', { subject: 'book' }) })
    await reader.loadLibrary()
    expect(reader.store.getSnapshot().library).toEqual({ status: 'failed', error: 'shelf unreachable' })
  })
})

describe('importFiles', () => {
  it('imports only .epub files as base64 and refreshes the shelf', async () => {
    const { reader, remote } = controller()
    const epub = new File(['hello'], 'book.epub'), other = new File(['x'], 'cover.png')
    reader.importFiles([epub, other])
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().importing).toBe(false)
      expect(reader.store.getSnapshot().books).toHaveLength(1)
    })
    expect(remote.importBook).toHaveBeenCalledOnce()
    expect(remote.importBook).toHaveBeenCalledWith('book.epub', btoa('hello'))
  })

  it('records the import failure beside the import button', async () => {
    const { reader, remote } = controller()
    remote.importBook.mockResolvedValueOnce({ ok: false, error: new RemoteError('epub/too-large', 'too large', { maxBytes: 50 * 1024 * 1024 }) })
    reader.importFiles([new File(['hello'], 'book.epub')])
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().importError).toBe('too large')
      expect(reader.store.getSnapshot().importing).toBe(false)
    })
  })
})

describe('openBook', () => {
  it('loads the chapter, TOC, and annotations together', async () => {
    const { reader, remote } = controller()
    const existing = savedAnnotation()
    remote.annotations.mockResolvedValueOnce({ ok: true, value: [existing] })
    reader.store.set({ ...reader.store.getSnapshot(), books: [bookRow()] })
    reader.openBook('b1')
    expect(reader.store.getSnapshot().view).toBe('reader')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().open?.loading).toBe(false)
    })
    const open = reader.store.getSnapshot().open
    expect(open).toMatchObject({ chapterTitle: 'One', html: '<p>chapter body</p>', toc: [{ title: 'One', chapterIndex: 0 }] })
    expect(reader.store.getSnapshot().annotations).toEqual([existing])
    expect(remote.chapter).toHaveBeenCalledWith('b1', 0)
  })
})

describe('stepChapter', () => {
  /** The reader parked on the second chapter of the fixture book. */
  function readerOnSecondChapter() {
    const fixture = controller()
    fixture.reader.store.set({
      ...fixture.reader.store.getSnapshot(),
      books: [bookRow()],
      open: {
        bookId: 'b1', title: 'Sample Book', chapterCount: 2, chapterIndex: 1, chapterTitle: 'Two',
        html: '<p>second</p>', toc: [], loading: false, error: null, restoreRatio: 0,
      },
    })
    return fixture
  }

  it('pages back into the previous chapter at its end', async () => {
    const { reader } = readerOnSecondChapter()
    reader.stepChapter(-1, 1)
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().open?.chapterIndex).toBe(0)
    })
    expect(reader.store.getSnapshot().open?.restoreRatio).toBe(1)
  })

  it('ignores steps beyond the book', () => {
    const { reader } = readerOnSecondChapter()
    reader.stepChapter(1)
    expect(reader.store.getSnapshot().open?.chapterIndex).toBe(1)
    reader.store.set({ ...reader.store.getSnapshot(), open: { ...reader.store.getSnapshot().open!, chapterIndex: 0 } })
    reader.stepChapter(-1)
    expect(reader.store.getSnapshot().open?.chapterIndex).toBe(0)
  })
})

describe('treat', () => {
  it('streams deltas and persists the finished annotation', async () => {
    const { reader, remote } = controller()
    remote.explain.mockImplementationOnce((_request, _signal) => (async function* () {
      yield { type: 'meta', model: 'test-model' }
      yield { type: 'delta', text: '曾' }
      yield { type: 'delta', text: '是' }
      yield { type: 'done' }
    })())
    reader.treat(selection, 'translate', 'note-1')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().streams['note-1']).toBeUndefined()
    })
    const state = reader.store.getSnapshot()
    expect(state.annotations).toHaveLength(1)
    expect(state.annotations[0]).toMatchObject({
      id: 'note-1', start: 4, end: 10, quote: 'was th',
      results: [{ kind: 'translate', text: '曾是', model: 'test-model' }],
    })
    expect(remote.saveAnnotation).toHaveBeenCalledOnce()
  })

  it('keeps the failed stream on the card with its error', async () => {
    const { reader, remote } = controller()
    remote.explain.mockImplementationOnce((_request, _signal) => (async function* () {
      yield { type: 'meta', model: 'test-model' }
      yield { type: 'delta', text: 'partial' }
      throw new Error('provider unavailable')
    })())
    reader.treat(selection, 'explain', 'note-2')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().streams['note-2']?.error).toBe('provider unavailable')
    })
    expect(reader.store.getSnapshot().annotations).toHaveLength(0)
    expect(remote.saveAnnotation).not.toHaveBeenCalled()
  })

  it('re-runs a saved annotation against its stored quote under the same id', async () => {
    const { reader, remote } = controller()
    const existing = savedAnnotation({ id: 'note-3', results: [{ kind: 'translate', text: 'old', model: 'm', createdAt: 1 }] })
    reader.store.set({
      ...reader.store.getSnapshot(),
      books: [bookRow()],
      open: { bookId: 'b1', title: 'Sample Book', chapterCount: 2, chapterIndex: 0, chapterTitle: 'One', html: '<p>x</p>', toc: [], loading: false, error: null, restoreRatio: 0 },
      annotations: [existing],
    })
    remote.explain.mockImplementationOnce(() => (async function* () {
      yield { type: 'meta', model: 'test-model' }
      yield { type: 'delta', text: 'revised' }
      yield { type: 'done' }
    })())
    reader.retryAnnotation('note-3')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().streams['note-3']).toBeUndefined()
    })
    expect(reader.store.getSnapshot().annotations[0]?.results[0]?.text).toBe('revised')
  })

  it('aborts an in-flight stream at disposal without marking it failed', async () => {
    const { reader, remote } = controller()
    let observed: AbortSignal | undefined
    remote.explain.mockImplementationOnce((_request, signal) => {
      observed = signal
      return (async function* () {
        yield { type: 'meta', model: 'test-model' }
        await new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { reject(new Error('cancelled')) }) })
      })()
    })
    reader.treat(selection, 'translate', 'note-4')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().streams['note-4']?.model).toBe('test-model')
    })
    reader.dispose()
    expect(observed?.aborted).toBe(true)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(reader.store.getSnapshot().streams['note-4']?.error).toBeNull()
  })
})

describe('noteScroll', () => {
  it('debounces the progress save and keeps the latest ratio', async () => {
    vi.useFakeTimers()
    const { reader, remote } = controller()
    reader.store.set({
      ...reader.store.getSnapshot(),
      open: { bookId: 'b1', title: 'Sample Book', chapterCount: 2, chapterIndex: 0, chapterTitle: 'One', html: '<p>x</p>', toc: [], loading: false, error: null, restoreRatio: 0 },
    })
    reader.noteScroll(0.25)
    reader.noteScroll(0.5)
    expect(remote.saveProgress).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2100)
    expect(remote.saveProgress).toHaveBeenCalledExactlyOnceWith('b1', { chapterIndex: 0, ratio: 0.5 })
  })
})

describe('deleteAnnotation', () => {
  it('removes the card locally and on the Host', async () => {
    const { reader, remote } = controller()
    reader.store.set({
      ...reader.store.getSnapshot(),
      books: [bookRow()],
      open: { bookId: 'b1', title: 'Sample Book', chapterCount: 2, chapterIndex: 0, chapterTitle: 'One', html: '<p>x</p>', toc: [], loading: false, error: null, restoreRatio: 0 },
      annotations: [savedAnnotation()],
    })
    reader.deleteAnnotation('a1')
    const state = reader.store.getSnapshot()
    expect(state.annotations).toHaveLength(0)
    expect(remote.deleteAnnotation).toHaveBeenCalledWith('b1', 'a1')
  })
})

describe('note capture', () => {
  /** The reader parked on a chapter, with one saved translate/explain card. */
  function readerWithCard() {
    const fixture = controller()
    const card = savedAnnotation({
      results: [
        { kind: 'translate', text: '曾是', model: 'm', createdAt: 2 },
        { kind: 'explain', text: '讲解', model: 'm', createdAt: 3 },
      ],
    })
    fixture.reader.store.set({
      ...fixture.reader.store.getSnapshot(),
      books: [bookRow()],
      open: { bookId: 'b1', title: 'Sample Book', chapterCount: 2, chapterIndex: 0, chapterTitle: 'One', html: '<p>x</p>', toc: [], loading: false, error: null, restoreRatio: 0 },
      annotations: [card],
    })
    return fixture
  }

  it('carries a raw selection into the Notes panel titled by book and chapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })))
    const { reader } = readerWithCard()
    reader.captureSelectionNote(selection)
    await vi.waitFor(() => { expect(globalThis.fetch).toHaveBeenCalledOnce() })
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toBe('/plugins/dsh-notes/api/notes')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Sample Book · One', body: 'was th' })
  })

  it('carries one card as quote plus every treatment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })))
    const { reader } = readerWithCard()
    reader.captureAnnotationNote('a1')
    await vi.waitFor(() => { expect(globalThis.fetch).toHaveBeenCalledOnce() })
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({
      title: 'Sample Book · One',
      body: 'was th\n\n翻译：曾是\n\n解释：讲解',
    })
  })

  it('swallows capture failures without disturbing the reader', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network gone') }))
    const { reader } = readerWithCard()
    expect(() => { reader.captureAnnotationNote('a1') }).not.toThrow()
    await new Promise((resolve) => { setImmediate(resolve) })
  })
})

describe('storage settings', () => {
  it('opens the panel with the resolved directory', async () => {
    const { reader, remote } = controller()
    reader.openStorageSettings()
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.directory).toBe('/Books/reader')
    })
    expect(reader.store.getSnapshot().storage).toMatchObject({ open: true, configurable: true, busy: false })
    expect(remote.storage).toHaveBeenCalledOnce()
  })

  it('saves, waits for the Host re-apply, closes, and reloads the shelf', async () => {
    vi.useFakeTimers()
    const { reader, remote } = controller()
    await reader.loadLibrary()
    reader.saveStorageSettings('/Books/elsewhere')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.saved).toBe(true)
    })
    expect(remote.setStorageDirectory).toHaveBeenCalledWith('/Books/elsewhere')
    await vi.advanceTimersByTimeAsync(1000)
    const storage = reader.store.getSnapshot().storage
    expect(storage.open).toBe(false)
    expect(storage.saved).toBe(false)
    expect(remote.list).toHaveBeenCalledTimes(2)
  })

  it('keeps the panel open with the failure message', async () => {
    const { reader, remote } = controller()
    reader.openStorageSettings()
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.open).toBe(true)
    })
    remote.setStorageDirectory.mockResolvedValueOnce({ ok: false, error: new RemoteError('epub/invalid-request', 'The storage directory must be an absolute path', { reason: 'path' }) })
    reader.saveStorageSettings('relative')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.error).toBe('The storage directory must be an absolute path')
    })
    expect(reader.store.getSnapshot().storage).toMatchObject({ open: true, busy: false, saved: false })
  })

  it('loads the model catalog with the panel', async () => {
    const { reader } = controller()
    reader.openStorageSettings()
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.models).toHaveLength(2)
    })
    const storage = reader.store.getSnapshot().storage
    expect(storage.modelProvider).toBe('')
    expect(storage.defaultModel).toBe('deepseek-chat')
  })

  it('switches the treatment model and re-reads the catalog after the re-apply', async () => {
    vi.useFakeTimers()
    const { reader, remote } = controller()
    reader.openStorageSettings()
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.models).toHaveLength(2)
    })
    remote.treatmentModels.mockResolvedValueOnce({
      ok: true,
      value: {
        provider: 'deepseek-official', model: 'deepseek-reasoner',
        defaultProvider: 'deepseek-official', defaultModel: 'deepseek-chat',
        models: [
          { provider: 'deepseek-official', model: 'deepseek-chat', name: 'DeepSeek Chat' },
          { provider: 'deepseek-official', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
        ],
      },
    })
    reader.saveTreatmentModel('deepseek-official', 'deepseek-reasoner')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.saved).toBe(true)
    })
    expect(remote.setTreatmentModel).toHaveBeenCalledWith('deepseek-official', 'deepseek-reasoner')
    await vi.advanceTimersByTimeAsync(1000)
    expect(reader.store.getSnapshot().storage).toMatchObject({
      modelProvider: 'deepseek-official', modelId: 'deepseek-reasoner', saved: false,
    })
    expect(remote.treatmentModels).toHaveBeenCalledTimes(2)
  })

  it('keeps the model failure on the panel', async () => {
    const { reader, remote } = controller()
    reader.openStorageSettings()
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.open).toBe(true)
    })
    remote.setTreatmentModel.mockResolvedValueOnce({ ok: false, error: new RemoteError('epub/invalid-request', 'Model "x/y" is not routable', { reason: 'model' }) })
    reader.saveTreatmentModel('x', 'y')
    await vi.waitFor(() => {
      expect(reader.store.getSnapshot().storage.error).toBe('Model "x/y" is not routable')
    })
    expect(reader.store.getSnapshot().storage.modelProvider).toBe('')
  })
})
