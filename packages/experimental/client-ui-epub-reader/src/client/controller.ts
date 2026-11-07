/** Reader state and Remote actions; one instance per browser plugin lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-epub-reader/remote'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  Annotation, BookRow, ExplainKind, TocEntry,
} from '@deepseek-ai/dsh-experimental-epub-reader/types'
import type { EpubSelectionValue } from './contract.ts'
import { saveNote } from './notes.ts'

/** Copy one record without a key; dynamic `delete` stays out of the codebase. */
function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

/** The note title one capture carries: the book, and the chapter when one is named. */
function noteTitle(bookTitle: string, chapterTitle: string): string {
  return chapterTitle === '' ? bookTitle : `${bookTitle} · ${chapterTitle}`
}

/** One streamed treatment the notes column renders; keyed by annotation id. */
export interface NoteStream {
  readonly kind: ExplainKind
  /** When this treatment started; orders in-flight cards above saved ones. */
  readonly startedAt: number
  text: string
  model: string
  error: string | null
  saving: boolean
}

/** The chapter the reading column shows. */
export interface ChapterState {
  readonly bookId: string
  readonly title: string
  readonly chapterCount: number
  chapterIndex: number
  chapterTitle: string
  html: string
  readonly toc: readonly TocEntry[]
  loading: boolean
  error: string | null
  /** Scroll ratio to restore once this chapter's body has rendered. */
  restoreRatio: number
}

/** Snapshot the reader panel renders. */
export interface EpubReaderState {
  view: 'library' | 'reader'
  library: { status: 'loading' | 'ready' | 'failed'; error: string }
  books: readonly BookRow[]
  importing: boolean
  /** Last import failure, shown beside the import button until cleared. */
  importError: string
  open: ChapterState | null
  annotations: readonly Annotation[]
  streams: Readonly<Record<string, NoteStream>>
  /** The storage-directory settings panel. */
  storage: StoragePanelState
}

/** The storage settings panel the library view swaps in for the shelf. */
export interface StoragePanelState {
  open: boolean
  /** The directory the Host resolved; the input starts from it. */
  directory: string
  configurable: boolean
  busy: boolean
  error: string
  saved: boolean
  /** Every routable treatment model, plus the configured override and the default pair. */
  models: readonly { provider: string; model: string; name: string }[]
  modelProvider: string
  modelId: string
  defaultProvider: string
  defaultModel: string
}

/** Debounce window for one reading-position save. */
const PROGRESS_DEBOUNCE_MS = 2000

/** Grace for the Host's config re-apply before the shelf reloads. */
const STORAGE_REFRESH_MS = 900

/** Read one file's bytes as canonical base64 for `importBook`. */
async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** A message safe to show for any thrown or returned Remote failure. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Own the library and the open book: every Remote call, the streamed
 * treatments, and the debounced progress save pass through here.
 */
export class ReaderController {
  readonly store: SnapshotStore<EpubReaderState> = createSnapshotStore<EpubReaderState>({
    view: 'library',
    library: { status: 'loading', error: '' },
    books: [],
    importing: false,
    importError: '',
    open: null,
    annotations: [],
    streams: {},
    storage: {
      open: false, directory: '', configurable: false, busy: false, error: '', saved: false,
      models: [], modelProvider: '', modelId: '', defaultProvider: '', defaultModel: '',
    },
  })

  private readonly aborts = new Set<AbortController>()
  private progress: { bookId: string; chapterIndex: number; ratio: number } | null = null
  private progressTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly ctx: Context) {}

  /** Reload the shelf; called on access grant and after imports and removals. */
  async loadLibrary(): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), library: { status: 'loading', error: '' } })
    try {
      const result = await this.ctx.remote.epubReader.list()
      if (!result.ok) throw result.error
      this.store.set({
        ...this.store.getSnapshot(),
        library: { status: 'ready', error: '' },
        books: result.value,
      })
    } catch (error) {
      this.store.set({ ...this.store.getSnapshot(), library: { status: 'failed', error: errorText(error) } })
    }
  }

  /** Import every EPUB of a picked file list, then refresh the shelf. */
  importFiles(files: readonly File[]): void {
    const accepted = files.filter(file => /\.epub$/iu.test(file.name))
    if (accepted.length === 0) return
    const run = (async () => {
      this.store.set({ ...this.store.getSnapshot(), importing: true, importError: '' })
      try {
        for (const file of accepted) {
          const result = await this.ctx.remote.epubReader.importBook(file.name, await fileBase64(file))
          if (!result.ok) throw result.error
        }
        await this.loadLibrary()
      } catch (error) {
        this.store.set({ ...this.store.getSnapshot(), importError: errorText(error) })
      } finally {
        this.store.set({ ...this.store.getSnapshot(), importing: false })
      }
    })()
    void run
  }

  /** Remove one book; the shelf refresh keeps the remaining rows in order. */
  removeBook(bookId: string): void {
    const run = (async () => {
      const result = await this.ctx.remote.epubReader.removeBook(bookId)
      if (!result.ok) throw result.error
      if (this.store.getSnapshot().open?.bookId === bookId) this.closeBook()
      await this.loadLibrary()
    })()
    void run.catch(() => { /* the shelf reload reports removal failures */ })
  }

  /** Open a book at its saved chapter and ratio. */
  openBook(bookId: string): void {
    const book = this.store.getSnapshot().books.find(row => row.bookId === bookId)
    if (book === undefined) return
    this.store.set({ ...this.store.getSnapshot(), view: 'reader' })
    void this.loadChapter(bookId, book.progress.chapterIndex, book.progress.ratio)
  }

  /** Leave the reader and flush the pending progress save. */
  closeBook(): void {
    this.flushProgress()
    this.store.set({ ...this.store.getSnapshot(), view: 'library', open: null, annotations: [], streams: {} })
  }

  /** Jump to one chapter from the picker. */
  selectChapter(chapterIndex: number, restoreRatio = 0): void {
    const open = this.store.getSnapshot().open
    if (open === null || chapterIndex === open.chapterIndex) return
    this.flushProgress()
    void this.loadChapter(open.bookId, chapterIndex, restoreRatio)
  }

  /**
   * Step to the adjacent chapter.
   * @param delta - chapter step, normally `1` or `-1`.
   * @param restoreRatio - scroll ratio to land at inside the target chapter.
   */
  stepChapter(delta: number, restoreRatio = 0): void {
    const open = this.store.getSnapshot().open
    if (open === null) return
    const next = open.chapterIndex + delta
    if (next < 0 || next >= open.chapterCount) return
    this.selectChapter(next, restoreRatio)
  }

  /** Record the reading column's ratio; the Host save follows the debounce. */
  noteScroll(ratio: number): void {
    const open = this.store.getSnapshot().open
    if (open === null) return
    this.progress = { bookId: open.bookId, chapterIndex: open.chapterIndex, ratio }
    clearTimeout(this.progressTimer)
    this.progressTimer = setTimeout(() => { this.flushProgress() }, PROGRESS_DEBOUNCE_MS)
  }

  /** Stream one treatment of a captured selection and persist it as an annotation. */
  treat(selection: EpubSelectionValue, kind: ExplainKind, reuseId?: string): void {
    const id = reuseId ?? randomUUID()
    const abort = new AbortController()
    this.aborts.add(abort)
    this.setStream(id, { kind, startedAt: Date.now(), text: '', model: '', error: null, saving: false })
    const run = (async () => {
      let text = ''
      let model = ''
      try {
        const stream = this.ctx.remote.epubReader.explain({
          bookId: selection.bookId,
          chapterIndex: selection.chapterIndex,
          kind,
          text: selection.text,
          context: selection.context,
        }, abort.signal)
        let done = false
        for await (const chunk of stream) {
          if (chunk.type === 'meta') model = chunk.model
          else if (chunk.type === 'delta') text += chunk.text
          else done = true
          this.setStream(id, streamEntry => ({ ...streamEntry, text, model }))
        }
        if (!done || text === '') throw new Error('The treatment stream ended without text')
        this.setStream(id, streamEntry => ({ ...streamEntry, text, model, saving: true }))
        const annotation: Annotation = {
          id,
          chapterIndex: selection.chapterIndex,
          start: selection.start,
          end: selection.end,
          quote: selection.text,
          createdAt: Date.now(),
          results: [{ kind, text, model, createdAt: Date.now() }],
        }
        const saved = await this.ctx.remote.epubReader.saveAnnotation(selection.bookId, annotation)
        if (!saved.ok) throw saved.error
        const state = this.store.getSnapshot()
        this.store.set({
          ...state,
          streams: withoutKey(state.streams, id),
          annotations: [annotation, ...state.annotations.filter(row => row.id !== id)],
        })
      } catch (error) {
        if (!abort.signal.aborted) this.setStream(id, streamEntry => ({ ...streamEntry, error: errorText(error) }))
      } finally {
        this.aborts.delete(abort)
      }
    })()
    void run
  }

  /** Re-run the first treatment of a saved annotation against its stored quote. */
  retryAnnotation(id: string): void {
    const annotation = this.store.getSnapshot().annotations.find(row => row.id === id)
    if (annotation === undefined) return
    const kind = annotation.results[0]?.kind ?? 'translate'
    this.treat({
      bookId: this.store.getSnapshot().open?.bookId ?? '',
      chapterIndex: annotation.chapterIndex,
      start: annotation.start,
      end: annotation.end,
      text: annotation.quote,
      context: '',
    }, kind, id)
  }

  /** Delete one saved annotation and its card. */
  deleteAnnotation(id: string): void {
    const state = this.store.getSnapshot()
    const bookId = state.open?.bookId
    if (bookId === undefined) return
    this.store.set({
      ...state,
      streams: withoutKey(state.streams, id),
      annotations: state.annotations.filter(row => row.id !== id),
    })
    void this.ctx.remote.epubReader.deleteAnnotation(bookId, id)
  }

  /** Carry one captured selection into the Notes panel; the note body is the raw text. */
  captureSelectionNote(selection: EpubSelectionValue): void {
    const open = this.store.getSnapshot().open
    void saveNote({
      title: open === null ? '' : noteTitle(open.title, open.chapterTitle),
      body: selection.text,
    })
  }

  /** Carry one annotation card — quote plus every treatment — into the Notes panel. */
  captureAnnotationNote(id: string): void {
    const state = this.store.getSnapshot()
    const annotation = state.annotations.find(row => row.id === id)
    if (annotation === undefined) return
    const open = state.open
    const sections = [annotation.quote, ...annotation.results.map(result =>
      `${result.kind === 'translate' ? '翻译' : '解释'}：${result.text}`)]
    void saveNote({
      title: open === null ? '' : noteTitle(open.title, open.chapterTitle),
      body: sections.join('\n\n'),
    })
  }

  /** Open the storage settings panel and load the directory and model catalog. */
  openStorageSettings(): void {
    this.setStorage({ open: true, busy: true, error: '', saved: false })
    const run = (async () => {
      const [stored, treatments] = await Promise.all([
        this.ctx.remote.epubReader.storage(),
        this.ctx.remote.epubReader.treatmentModels(),
      ])
      if (!stored.ok) throw stored.error
      if (!treatments.ok) throw treatments.error
      this.setStorage({
        directory: stored.value.directory,
        configurable: stored.value.configurable,
        models: treatments.value.models,
        modelProvider: treatments.value.provider,
        modelId: treatments.value.model,
        defaultProvider: treatments.value.defaultProvider,
        defaultModel: treatments.value.defaultModel,
        busy: false,
      })
    })()
    void run.catch((error) => { this.setStorage({ busy: false, error: errorText(error) }) })
  }

  /** Close the storage settings panel without changing anything. */
  closeStorageSettings(): void {
    this.setStorage({ open: false, error: '', saved: false })
  }

  /** Point the library at a new directory; empty restores the profile default. */
  saveStorageSettings(directory: string): void {
    this.setStorage({ busy: true, error: '', saved: false })
    const run = (async () => {
      const result = await this.ctx.remote.epubReader.setStorageDirectory(directory)
      if (!result.ok) throw result.error
      this.setStorage({ busy: false, saved: true })
      // The Host re-applies with the new root; give it a beat, then refresh the shelf.
      setTimeout(() => {
        this.setStorage({ open: false, saved: false })
        void this.loadLibrary()
      }, STORAGE_REFRESH_MS)
    })()
    void run.catch((error) => { this.setStorage({ busy: false, error: errorText(error) }) })
  }

  /** Choose the model treatments use; the empty pair follows the profile default. */
  saveTreatmentModel(provider: string, model: string): void {
    this.setStorage({ busy: true, error: '', saved: false })
    const run = (async () => {
      const result = await this.ctx.remote.epubReader.setTreatmentModel(provider, model)
      if (!result.ok) throw result.error
      this.setStorage({ modelProvider: provider, modelId: model, busy: false, saved: true })
      // The Host re-applies its config; re-read the catalog once it settles.
      setTimeout(() => {
        this.setStorage({ saved: false })
        void this.refreshTreatmentModels()
      }, STORAGE_REFRESH_MS)
    })()
    void run.catch((error) => { this.setStorage({ busy: false, error: errorText(error) }) })
  }

  /** Re-read the treatment catalog into the open panel. */
  private async refreshTreatmentModels(): Promise<void> {
    const result = await this.ctx.remote.epubReader.treatmentModels()
    if (!result.ok) return
    this.setStorage({
      models: result.value.models,
      modelProvider: result.value.provider,
      modelId: result.value.model,
      defaultProvider: result.value.defaultProvider,
      defaultModel: result.value.defaultModel,
    })
  }

  /** Merge one patch into the storage panel slice. */
  private setStorage(patch: Partial<StoragePanelState>): void {
    const state = this.store.getSnapshot()
    this.store.set({ ...state, storage: { ...state.storage, ...patch } })
  }

  /** Abort in-flight treatments and the pending progress save; called once at plugin teardown. */
  dispose(): void {
    for (const abort of this.aborts) abort.abort()
    this.aborts.clear()
    clearTimeout(this.progressTimer)
    this.flushProgress()
  }

  /** Send the recorded reading position once, if one is pending. */
  private flushProgress(): void {
    clearTimeout(this.progressTimer)
    const pending = this.progress
    this.progress = null
    if (pending === null) return
    void this.ctx.remote.epubReader.saveProgress(pending.bookId, {
      chapterIndex: pending.chapterIndex,
      ratio: pending.ratio,
    })
  }

  /** Fetch one chapter plus the book's annotations and publish them. */
  private async loadChapter(bookId: string, chapterIndex: number, restoreRatio: number): Promise<void> {
    const state = this.store.getSnapshot()
    const book = state.books.find(row => row.bookId === bookId)
    this.store.set({
      ...state,
      annotations: [],
      streams: {},
      open: {
        bookId,
        title: book?.title ?? '',
        chapterCount: book?.chapterCount ?? 0,
        chapterIndex,
        chapterTitle: '',
        html: '',
        toc: [],
        loading: true,
        error: null,
        restoreRatio,
      },
    })
    try {
      const [chapterResult, tocResult, notesResult] = await Promise.all([
        this.ctx.remote.epubReader.chapter(bookId, chapterIndex),
        this.ctx.remote.epubReader.toc(bookId),
        this.ctx.remote.epubReader.annotations(bookId),
      ])
      if (!chapterResult.ok) throw chapterResult.error
      const current = this.store.getSnapshot()
      if (current.open?.bookId !== bookId) return
      this.store.set({
        ...current,
        open: {
          ...current.open,
          chapterTitle: chapterResult.value.title,
          html: chapterResult.value.html,
          toc: tocResult.ok ? tocResult.value : [],
          loading: false,
        },
        annotations: notesResult.ok ? notesResult.value : [],
      })
    } catch (error) {
      const current = this.store.getSnapshot()
      if (current.open?.bookId !== bookId) return
      this.store.set({ ...current, open: { ...current.open, loading: false, error: errorText(error) } })
    }
  }

  /** Merge one stream entry into the snapshot under its annotation id. */
  private setStream(id: string, update: NoteStream | ((entry: NoteStream) => NoteStream)): void {
    const state = this.store.getSnapshot()
    const current = state.streams[id] ?? { kind: 'translate', startedAt: Date.now(), text: '', model: '', error: null, saving: false }
    const next = typeof update === 'function' ? update(current) : update
    this.store.set({ ...state, streams: { ...state.streams, [id]: next } })
  }
}
