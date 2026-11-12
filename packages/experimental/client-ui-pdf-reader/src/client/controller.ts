/** Reader state and Remote actions; one instance per browser plugin lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-pdf-reader/remote'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  BookRow, ExplainKind, HighlightColor, MetaReport, PdfAnnotation, ShotRect, TextAnnotation, TocEntry,
} from '@deepseek-ai/dsh-pdf-reader/types'
import type { PdfSelectionValue, ShotAsk } from './contract.ts'
import { readAnnotationColor, readReadingMode, writeAnnotationColor, writeReadingMode, type ReadingMode } from './preference.ts'

/** Copy one record without a key; dynamic `delete` stays out of the codebase. */
function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

/**
 * The context slice the controller reads; the full client Context satisfies it.
 * Tests construct this slice directly instead of a cast from a partial fake.
 */
export interface ReaderContext {
  /** The PDF reader Remote face. */
  remote: { pdfReader: Context['remote']['pdfReader'] }
}

/** One streamed text treatment the notes column renders; keyed by annotation id. */
export interface TextStream {
  readonly kind: ExplainKind
  /** When this treatment started; orders in-flight cards above saved ones. */
  readonly startedAt: number
  text: string
  model: string
  error: string | null
  saving: boolean
}

/** One streamed screenshot answer the notes column renders; keyed by annotation id. */
export interface ShotStream {
  readonly startedAt: number
  question: string
  text: string
  model: string
  error: string | null
  saving: boolean
  /** The Host crop URL the terminal chunk carried. */
  imageUrl: string
}

/** The book the reading column shows. */
export interface PageState {
  readonly bookId: string
  title: string
  pageCount: number
  /** 1-based page currently shown. */
  page: number
  outline: readonly TocEntry[]
  /** Display zoom factor over the base page size; 1 is 100%. */
  zoom: number
  /** Bytes are fetched and the browser document may open. */
  ready: boolean
  /** The first-open structure report has been sent for this book. */
  metaReported: boolean
  error: string | null
}

/** Snapshot the reader panel renders. */
export interface PdfReaderState {
  view: 'library' | 'reader'
  /** Reading presentation: scroll up and down a width-fit page, or flip height-fit pages. */
  mode: ReadingMode
  /** The marker pen's current color; new highlights and recolors paint with it. */
  penColor: HighlightColor
  library: { status: 'loading' | 'ready' | 'failed'; error: string }
  books: readonly BookRow[]
  importing: boolean
  /** Last import failure, shown beside the import button until cleared. */
  importError: string
  open: PageState | null
  annotations: readonly PdfAnnotation[]
  streams: Readonly<Record<string, TextStream>>
  shots: Readonly<Record<string, ShotStream>>
  /** Vision-capable models the ask popover lists; empty until first loaded. */
  shotCatalog: readonly { provider: string; model: string; name: string }[]
  /** The effective screenshot pair the empty popover choice follows, '' when none resolves. */
  shotEffective: string
  /** The storage-directory and model settings panel. */
  storage: StoragePanelState
}

/** The settings panel the library view swaps in for the shelf. */
export interface StoragePanelState {
  open: boolean
  /** The directory the Host resolved; the input starts from it. */
  directory: string
  configurable: boolean
  busy: boolean
  error: string
  saved: boolean
  /** Every routable model, plus both configured overrides and the default pair. */
  models: readonly { provider: string; model: string; name: string; vision: boolean }[]
  modelProvider: string
  modelId: string
  shotProvider: string
  shotModel: string
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
  readonly store: SnapshotStore<PdfReaderState> = createSnapshotStore<PdfReaderState>({
    view: 'library',
    mode: readReadingMode(),
    penColor: readAnnotationColor(),
    library: { status: 'loading', error: '' },
    books: [],
    importing: false,
    importError: '',
    open: null,
    annotations: [],
    streams: {},
    shots: {},
    shotCatalog: [],
    shotEffective: '',
    storage: {
      open: false, directory: '', configurable: false, busy: false, error: '', saved: false,
      models: [], modelProvider: '', modelId: '', shotProvider: '', shotModel: '',
      defaultProvider: '', defaultModel: '',
    },
  })

  private readonly aborts = new Set<AbortController>()
  private readonly bytes = new Map<string, Uint8Array>()
  private readonly covers = new Set<string>()
  private progress: { bookId: string; page: number } | null = null
  private progressTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly ctx: ReaderContext) {}

  /** Reload the shelf; called on access grant and after imports and removals. */
  async loadLibrary(): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), library: { status: 'loading', error: '' } })
    try {
      const result = await this.ctx.remote.pdfReader.list()
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

  /** Import every PDF of a picked file list, then refresh the shelf. */
  importFiles(files: readonly File[]): void {
    const accepted = files.filter(file => /\.pdf$/iu.test(file.name))
    if (accepted.length === 0) return
    const run = (async () => {
      this.store.set({ ...this.store.getSnapshot(), importing: true, importError: '' })
      try {
        for (const file of accepted) {
          const result = await this.ctx.remote.pdfReader.importBook(file.name, await fileBase64(file), null, new AbortController().signal)
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
      const result = await this.ctx.remote.pdfReader.removeBook(bookId)
      if (!result.ok) throw result.error
      this.bytes.delete(bookId)
      if (this.store.getSnapshot().open?.bookId === bookId) this.closeBook()
      await this.loadLibrary()
    })()
    void run.catch(() => { /* the shelf reload reports removal failures */ })
  }

  /** The stored bytes of one book, fetched once per plugin lifetime. */
  async readBytes(bookId: string): Promise<Uint8Array | null> {
    const cached = this.bytes.get(bookId)
    if (cached !== undefined) return cached
    const result = await this.ctx.remote.pdfReader.pdfBytes(bookId)
    if (!result.ok) throw result.error
    this.bytes.set(bookId, result.value.data)
    return result.value.data
  }

  /** Open a book at its saved page; bytes fetch and readiness follow. */
  openBook(bookId: string): void {
    const book = this.store.getSnapshot().books.find(row => row.bookId === bookId)
    if (book === undefined) return
    this.store.set({
      ...this.store.getSnapshot(),
      view: 'reader',
      annotations: [],
      streams: {},
      shots: {},
      open: {
        bookId,
        title: book.title,
        pageCount: book.pageCount,
        page: Math.max(1, book.progress.page),
        outline: [...book.outline],
        zoom: 1,
        ready: false,
        metaReported: book.pageCount > 0,
        error: null,
      },
    })
    const run = (async () => {
      try {
        await this.readBytes(bookId)
        const current = this.store.getSnapshot()
        if (current.open?.bookId !== bookId) return
        this.store.set({ ...current, open: { ...current.open, ready: true } })
      } catch (error) {
        const current = this.store.getSnapshot()
        if (current.open?.bookId !== bookId) return
        this.store.set({ ...current, open: { ...current.open, ready: false, error: errorText(error) } })
      }
    })()
    void run
  }

  /** Leave the reader and flush the pending progress save. */
  closeBook(): void {
    this.flushProgress()
    this.store.set({ ...this.store.getSnapshot(), view: 'library', open: null, annotations: [], streams: {}, shots: {} })
  }

  /** Load one book's annotations into the reader. */
  async loadAnnotations(): Promise<void> {
    const open = this.store.getSnapshot().open
    if (open === null) return
    const result = await this.ctx.remote.pdfReader.annotations(open.bookId)
    if (!result.ok) return
    const current = this.store.getSnapshot()
    if (current.open?.bookId !== open.bookId) return
    this.store.set({ ...current, annotations: result.value })
  }

  /** Turn to one page, flushing the pending progress save. */
  selectPage(page: number): void {
    const open = this.store.getSnapshot().open
    if (open === null) return
    const next = Math.min(Math.max(Math.trunc(page) || 1, 1), Math.max(open.pageCount, 1))
    if (next === open.page) return
    this.flushProgress()
    this.store.set({ ...this.store.getSnapshot(), open: { ...open, page: next } })
    this.noteProgress()
  }

  /** Step to the adjacent page. */
  stepPage(delta: number): void {
    const open = this.store.getSnapshot().open
    if (open === null) return
    this.selectPage(open.page + delta)
  }

  /** Set the display zoom factor. */
  setZoom(zoom: number): void {
    const open = this.store.getSnapshot().open
    if (open === null) return
    const next = Math.min(Math.max(zoom, 0.5), 3)
    if (next === open.zoom) return
    this.store.set({ ...this.store.getSnapshot(), open: { ...open, zoom: next } })
  }

  /** Choose the reading presentation; the choice persists across sessions. */
  setReadingMode(mode: ReadingMode): void {
    writeReadingMode(mode)
    this.store.set({ ...this.store.getSnapshot(), mode })
  }

  /** Choose the marker pen's color; the choice persists and new highlights paint with it. */
  setPenColor(color: HighlightColor): void {
    writeAnnotationColor(color)
    this.store.set({ ...this.store.getSnapshot(), penColor: color })
  }

  /** Merge the browser's first-open structure report into the open book and shelf. */
  async reportMeta(bookId: string, report: MetaReport): Promise<void> {
    const result = await this.ctx.remote.pdfReader.saveBookMeta(bookId, report)
    if (!result.ok) return
    const state = this.store.getSnapshot()
    const books = state.books.map(row => row.bookId === bookId ? result.value : row)
    const open = state.open?.bookId === bookId
      ? {
        ...state.open, title: result.value.title, pageCount: result.value.pageCount,
        outline: [...result.value.outline], metaReported: true,
      }
      : state.open
    this.store.set({ ...state, books, open })
  }

  /** Store the browser-rendered cover thumbnail and refresh its shelf row. */
  async saveCover(bookId: string, pngBase64: string): Promise<void> {
    if (this.covers.has(bookId)) return
    this.covers.add(bookId)
    const result = await this.ctx.remote.pdfReader.saveCover(bookId, pngBase64)
    if (!result.ok) {
      this.covers.delete(bookId)
      return
    }
    await this.loadLibrary()
  }

  /** Record the shown page; the Host save follows the debounce. */
  noteProgress(): void {
    const open = this.store.getSnapshot().open
    if (open === null) return
    this.progress = { bookId: open.bookId, page: open.page }
    clearTimeout(this.progressTimer)
    this.progressTimer = setTimeout(() => { this.flushProgress() }, PROGRESS_DEBOUNCE_MS)
  }

  /** Load the vision-capable models the ask popover lists; repeats refresh in place. */
  async loadShotCatalog(): Promise<void> {
    try {
      const result = await this.ctx.remote.pdfReader.treatmentModels()
      if (!result.ok) return
      const pair = result.value.shotProvider !== '' && result.value.shotModel !== ''
        ? { provider: result.value.shotProvider, model: result.value.shotModel }
        : result.value.defaultProvider !== '' && result.value.defaultModel !== ''
          ? { provider: result.value.defaultProvider, model: result.value.defaultModel }
          : undefined
      const named = pair === undefined
        ? undefined
        : result.value.models.find(row => row.provider === pair.provider && row.model === pair.model)
      this.store.set({
        ...this.store.getSnapshot(),
        shotCatalog: result.value.models.filter(entry => entry.vision)
          .map(({ provider, model, name }) => ({ provider, model, name })),
        shotEffective: pair === undefined ? '' : `${pair.provider} · ${named?.name ?? pair.model}`,
      })
    } catch { /* the popover falls back to the configured pair */ }
  }

  /** Stream one treatment of a captured selection and persist it as an annotation. */
  treat(selection: PdfSelectionValue, kind: ExplainKind, reuseId?: string): void {
    const id = reuseId ?? randomUUID()
    const abort = new AbortController()
    this.aborts.add(abort)
    this.setTextStream(id, { kind, startedAt: Date.now(), text: '', model: '', error: null, saving: false })
    const run = (async () => {
      let text = ''
      let model = ''
      try {
        const stream = this.ctx.remote.pdfReader.explain({
          bookId: selection.bookId,
          page: selection.page,
          kind,
          text: selection.text,
          context: selection.context,
        }, abort.signal)
        let done = false
        for await (const chunk of stream) {
          if (chunk.type === 'meta') model = chunk.model
          else if (chunk.type === 'delta') text += chunk.text
          else done = true
          this.setTextStream(id, streamEntry => ({ ...streamEntry, text, model }))
        }
        if (!done || text === '') throw new Error('The treatment stream ended without text')
        this.setTextStream(id, streamEntry => ({ ...streamEntry, text, model, saving: true }))
        const annotation = {
          kind: 'text' as const,
          id,
          page: selection.page,
          start: selection.start,
          end: selection.end,
          quote: selection.text,
          color: this.store.getSnapshot().penColor,
          createdAt: Date.now(),
          results: [{ kind, text, model, createdAt: Date.now() }],
        }
        const saved = await this.ctx.remote.pdfReader.saveAnnotation(selection.bookId, annotation)
        if (!saved.ok) throw saved.error
        const state = this.store.getSnapshot()
        this.store.set({
          ...state,
          streams: withoutKey(state.streams, id),
          annotations: [annotation, ...state.annotations.filter(row => row.id !== id)],
        })
      } catch (error) {
        if (!abort.signal.aborted) this.setTextStream(id, streamEntry => ({ ...streamEntry, error: errorText(error) }))
      } finally {
        this.aborts.delete(abort)
      }
    })()
    void run
  }

  /** Persist one selection as a plain marker highlight, with no model treatment. */
  annotate(selection: PdfSelectionValue): void {
    const annotation: TextAnnotation = {
      kind: 'text',
      id: randomUUID(),
      page: selection.page,
      start: selection.start,
      end: selection.end,
      quote: selection.text,
      color: this.store.getSnapshot().penColor,
      createdAt: Date.now(),
      results: [],
    }
    const run = (async () => {
      const saved = await this.ctx.remote.pdfReader.saveAnnotation(selection.bookId, annotation)
      if (!saved.ok) throw saved.error
      const state = this.store.getSnapshot()
      this.store.set({ ...state, annotations: [annotation, ...state.annotations.filter(row => row.id !== annotation.id)] })
    })()
    void run.catch(() => { /* a failed plain highlight simply never lands */ })
  }

  /** Repaint one saved text annotation in another marker color, and make that color current. */
  setAnnotationColor(annotationId: string, color: HighlightColor): void {
    const state = this.store.getSnapshot()
    const bookId = state.open?.bookId
    const current = state.annotations.find(row => row.id === annotationId)
    if (bookId === undefined || current === undefined || current.kind !== 'text') return
    const next: TextAnnotation = { ...current, color }
    const run = (async () => {
      const saved = await this.ctx.remote.pdfReader.saveAnnotation(bookId, next)
      if (!saved.ok) throw saved.error
      writeAnnotationColor(color)
      const fresh = this.store.getSnapshot()
      this.store.set({
        ...fresh,
        penColor: color,
        annotations: fresh.annotations.map(row => row.id === annotationId ? next : row),
      })
    })()
    void run.catch(() => { /* a failed repaint keeps the previous color */ })
  }

  /** Re-run the first treatment of a saved text annotation against its stored quote. */
  retryTextAnnotation(id: string): void {
    const state = this.store.getSnapshot()
    const annotation = state.annotations.find((row): row is Extract<PdfAnnotation, { kind: 'text' }> =>
      row.kind === 'text' && row.id === id)
    if (annotation === undefined) return
    const kind = annotation.results[0]?.kind ?? 'translate'
    this.treat({
      bookId: state.open?.bookId ?? '',
      page: annotation.page,
      start: annotation.start,
      end: annotation.end,
      text: annotation.quote,
      context: '',
    }, kind, id)
  }

  /** Ask one screenshot question and persist it as a shot annotation. */
  askShot(ask: ShotAsk, reuseId?: string): void {
    const id = reuseId ?? randomUUID()
    const abort = new AbortController()
    this.aborts.add(abort)
    this.setShotStream(id, { startedAt: Date.now(), question: ask.question, text: '', model: '', error: null, saving: false, imageUrl: '' })
    const run = (async () => {
      let text = ''
      let model = ''
      let imageUrl = ''
      try {
        const stream = this.ctx.remote.pdfReader.askImage({
          bookId: ask.bookId,
          page: ask.page,
          rect: ask.rect,
          annotationId: id,
          pngBase64: ask.pngBase64,
          question: ask.question,
          ...(ask.provider !== undefined && ask.model !== undefined ? { provider: ask.provider, model: ask.model } : {}),
        }, abort.signal)
        let done = false
        for await (const chunk of stream) {
          if (chunk.type === 'meta') model = chunk.model
          else if (chunk.type === 'delta') text += chunk.text
          else {
            done = true
            imageUrl = chunk.imageUrl ?? ''
          }
          this.setShotStream(id, streamEntry => ({ ...streamEntry, text, model, imageUrl: imageUrl || streamEntry.imageUrl }))
        }
        if (!done || text === '') throw new Error('The answer stream ended without text')
        this.setShotStream(id, streamEntry => ({ ...streamEntry, text, model, saving: true }))
        const annotation = {
          kind: 'shot' as const,
          id,
          page: ask.page,
          rect: ask.rect,
          imageUrl: imageUrl === '' ? (this.store.getSnapshot().shots[id]?.imageUrl ?? '') : imageUrl,
          question: ask.question,
          createdAt: Date.now(),
          answer: { text, model, createdAt: Date.now() },
        }
        const saved = await this.ctx.remote.pdfReader.saveAnnotation(ask.bookId, annotation)
        if (!saved.ok) throw saved.error
        const state = this.store.getSnapshot()
        this.store.set({
          ...state,
          shots: withoutKey(state.shots, id),
          annotations: [annotation, ...state.annotations.filter(row => row.id !== id)],
        })
      } catch (error) {
        if (!abort.signal.aborted) this.setShotStream(id, streamEntry => ({ ...streamEntry, error: errorText(error) }))
      } finally {
        this.aborts.delete(abort)
      }
    })()
    void run
  }

  /** Re-ask one saved shot annotation; the caller supplies a fresh crop of the same rect. */
  retryShotAnnotation(id: string, fresh: Omit<ShotAsk, 'page' | 'rect' | 'bookId'>, page: number, rect: ShotRect): void {
    const open = this.store.getSnapshot().open
    if (open === null) return
    this.askShot({ ...fresh, bookId: open.bookId, page, rect }, id)
  }

  /** Delete one saved annotation and its card. */
  deleteAnnotation(id: string): void {
    const state = this.store.getSnapshot()
    const bookId = state.open?.bookId
    if (bookId === undefined) return
    this.store.set({
      ...state,
      streams: withoutKey(state.streams, id),
      shots: withoutKey(state.shots, id),
      annotations: state.annotations.filter(row => row.id !== id),
    })
    void this.ctx.remote.pdfReader.deleteAnnotation(bookId, id)
  }

  /** Open the settings panel and load the directory and model catalog. */
  openStorageSettings(): void {
    this.setStorage({ open: true, busy: true, error: '', saved: false })
    const run = (async () => {
      const [stored, treatments] = await Promise.all([
        this.ctx.remote.pdfReader.storage(),
        this.ctx.remote.pdfReader.treatmentModels(),
      ])
      if (!stored.ok) throw stored.error
      if (!treatments.ok) throw treatments.error
      this.setStorage({
        directory: stored.value.directory,
        configurable: stored.value.configurable,
        models: treatments.value.models,
        modelProvider: treatments.value.provider,
        modelId: treatments.value.model,
        shotProvider: treatments.value.shotProvider,
        shotModel: treatments.value.shotModel,
        defaultProvider: treatments.value.defaultProvider,
        defaultModel: treatments.value.defaultModel,
        busy: false,
      })
    })()
    void run.catch((error) => { this.setStorage({ busy: false, error: errorText(error) }) })
  }

  /** Close the settings panel without changing anything. */
  closeStorageSettings(): void {
    this.setStorage({ open: false, error: '', saved: false })
  }

  /** Point the library at a new directory; empty restores the profile default. */
  saveStorageSettings(directory: string): void {
    this.setStorage({ busy: true, error: '', saved: false })
    const run = (async () => {
      const result = await this.ctx.remote.pdfReader.setStorageDirectory(directory)
      if (!result.ok) throw result.error
      this.setStorage({ busy: false, saved: true })
      // The Host re-applies with the new root; give it a beat, then refresh the shelf.
      setTimeout(() => {
        this.setStorage({ open: false, saved: false })
        this.bytes.clear()
        void this.loadLibrary()
      }, STORAGE_REFRESH_MS)
    })()
    void run.catch((error) => { this.setStorage({ busy: false, error: errorText(error) }) })
  }

  /** Choose the model text treatments use; the empty pair follows the profile default. */
  saveTreatmentModel(provider: string, model: string): void {
    this.saveModelChoice(() => this.ctx.remote.pdfReader.setTreatmentModel(provider, model), () => {
      this.setStorage({ modelProvider: provider, modelId: model })
    })
  }

  /** Choose the model screenshots use; the empty pair follows the profile default. */
  saveShotModel(provider: string, model: string): void {
    this.saveModelChoice(() => this.ctx.remote.pdfReader.setShotModel(provider, model), () => {
      this.setStorage({ shotProvider: provider, shotModel: model })
    })
  }

  /** Run one model pick through the busy/saved/settings-refresh cycle. */
  private saveModelChoice(call: () => Promise<{ ok: boolean; error?: unknown }>, apply: () => void): void {
    this.setStorage({ busy: true, error: '', saved: false })
    const run = (async () => {
      const result = await call()
      if (!result.ok) throw result.error
      apply()
      this.setStorage({ busy: false, saved: true })
      // The Host re-applies its config; re-read the catalog once it settles.
      setTimeout(() => {
        this.setStorage({ saved: false })
        void this.refreshTreatmentModels()
      }, STORAGE_REFRESH_MS)
    })()
    void run.catch((error) => { this.setStorage({ busy: false, error: errorText(error) }) })
  }

  /** Re-read the treatment catalog into the open panel and the ask popover. */
  private async refreshTreatmentModels(): Promise<void> {
    const result = await this.ctx.remote.pdfReader.treatmentModels()
    if (!result.ok) return
    this.setStorage({
      models: result.value.models,
      modelProvider: result.value.provider,
      modelId: result.value.model,
      shotProvider: result.value.shotProvider,
      shotModel: result.value.shotModel,
      defaultProvider: result.value.defaultProvider,
      defaultModel: result.value.defaultModel,
    })
    await this.loadShotCatalog()
  }

  /** Merge one patch into the storage panel slice. */
  private setStorage(patch: Partial<StoragePanelState>): void {
    const state = this.store.getSnapshot()
    this.store.set({ ...state, storage: { ...state.storage, ...patch } })
  }

  /** Abort in-flight streams and the pending progress save; called once at plugin teardown. */
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
    void this.ctx.remote.pdfReader.saveProgress(pending.bookId, { page: pending.page })
  }

  /** Merge one text stream entry into the snapshot under its annotation id. */
  private setTextStream(id: string, update: TextStream | ((entry: TextStream) => TextStream)): void {
    const state = this.store.getSnapshot()
    const current = state.streams[id] ?? { kind: 'translate' as const, startedAt: Date.now(), text: '', model: '', error: null, saving: false }
    const next = typeof update === 'function' ? update(current) : update
    this.store.set({ ...state, streams: { ...state.streams, [id]: next } })
  }

  /** Merge one shot stream entry into the snapshot under its annotation id. */
  private setShotStream(id: string, update: ShotStream | ((entry: ShotStream) => ShotStream)): void {
    const state = this.store.getSnapshot()
    const current = state.shots[id] ?? { startedAt: Date.now(), question: '', text: '', model: '', error: null, saving: false, imageUrl: '' }
    const next = typeof update === 'function' ? update(current) : update
    this.store.set({ ...state, shots: { ...state.shots, [id]: next } })
  }
}
