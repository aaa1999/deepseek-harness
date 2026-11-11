/**
 * The PDF reader Host service: library, pages, annotations, and LLM treatments.
 *
 * @module @deepseek-ai/dsh-pdf-reader
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute } from 'node:path'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-attachment'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defaultShotQuestion, MAX_QUESTION_CHARS, shotSystemPrompt, shotUserPrompt, systemPromptFor, userPromptFor, type PromptContext } from './prompts.ts'
import { HIGHLIGHT_COLORS } from './types.ts'
import { PdfStore, type StoredBookMeta } from './store.ts'
import type {
  AskImageRequest, BookProgress, BookRow, ExplainRequest, ImportSource,
  MetaReport, PdfAnnotation, PdfBytes, ShotRect, StorageMeta,
  TreatChunk, TreatmentCatalog, TreatmentModel,
} from './types.ts'

export type {
  AskImageRequest, BookProgress, BookRow, ExplainKind, ExplainRequest, ExplainResult, HighlightColor, ImportSource,
  MetaReport, PdfAnnotation, PdfBytes, ShotAnnotation, ShotRect, StorageMeta, TextAnnotation,
  TreatChunk, TreatmentCatalog, TreatmentModel,
} from './types.ts'
export { HIGHLIGHT_COLORS } from './types.ts'
export { PdfFormatError } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** PDF library Remote controller. */
    pdfReaderController: PdfReaderController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No book, page, or annotation carries that identity. */
    'pdf/not-found': { readonly subject: string }
    /** The imported file is not a usable PDF, or a stored record is malformed. */
    'pdf/bad-file': { readonly reason: string }
    /** The file or image exceeds the configured byte limit. */
    'pdf/too-large': { readonly maxBytes: number }
    /** A request value is missing or malformed. */
    'pdf/invalid-request': { readonly reason: string }
    /** No LLM provider and model resolve for text treatments. */
    'pdf/no-model': { readonly reason: string }
    /** The resolved screenshot model accepts no image input. */
    'pdf/no-vision-model': { readonly reason: string }
    /** A treatment stream failed. */
    'pdf/explain-failed': { readonly reason: string }
  }
}

/** Limits and preferences of the library service. */
export interface Config {
  /** Plugin data root; empty resolves beside the running profile. */
  dataRoot: string
  /** Maximum imported file size in bytes. */
  maxPdfBytes: number
  /** Human-readable target language used verbatim in prompts. */
  targetLanguage: string
  /** Provider override for text treatments; empty follows the profile default. */
  provider: string
  /** Model override for text treatments; empty follows the profile default. */
  model: string
  /** Provider override for screenshot questions; empty follows the profile default. */
  shotProvider: string
  /** Model override for screenshot questions; empty follows the profile default. */
  shotModel: string
  /** Answer token budget for one treatment; thinking models request it plus headroom. */
  maxOutputTokens: number
}

/** Thinking request controls one resolved treatment model carries. */
interface ThinkingControls {
  /** The reasoning effort to request, when the model declares any. */
  effort?: ReasoningEffortId
  /** Whether the requested effort actually thinks. */
  thinking: boolean
}

/** The Fetch route that serves one cover thumbnail. */
const COVER_PATH = '/api/pdf-reader/cover'
/** The Fetch route that serves one stored screenshot crop. */
const SHOT_PATH = '/api/pdf-reader/shot'

/** Build the Fetch-route URL of one cover thumbnail. */
function coverUrl(bookId: string): string {
  return `${COVER_PATH}?book=${encodeURIComponent(bookId)}`
}

/** Build the Fetch-route URL of one screenshot crop. */
function shotUrl(bookId: string, annotationId: string): string {
  return `${SHOT_PATH}?book=${encodeURIComponent(bookId)}&id=${encodeURIComponent(annotationId)}`
}

/** Longest source URL the origin record persists. */
const MAX_SOURCE_URL = 2000

/** Largest answer budget one profile may configure for a treatment. */
const MAX_OUTPUT_TOKENS = 131072

/**
 * Output headroom one thinking model's request adds above the configured
 * answer budget. Reasoning and the answer share a single output ceiling on
 * several OpenAI-compatible endpoints (zai GLM included), so an unraised cap
 * lets the reasoning phase starve the answer — the "model returned no text"
 * failure this guards against.
 */
const THINKING_HEADROOM_TOKENS = 8192

/**
 * The origin record one import keeps, or null when the caller's record is
 * unusable: the URL must name an http(s) origin and the capture time must be a
 * sane epoch-millisecond stamp (absent or out-of-range stamps read as now).
 * @param source - the record the importer sent, if any.
 * @returns the persisted record, or null for file imports and junk input.
 */
function sanitizeSource(source: ImportSource | null): ImportSource | null {
  if (source === null || typeof source.url !== 'string') return null
  const url = source.url.trim().slice(0, MAX_SOURCE_URL)
  if (!/^https?:\/\/\S+$/iu.test(url)) return null
  const now = Date.now()
  const capturedAt = Number.isSafeInteger(source.capturedAt)
    && source.capturedAt > 0 && source.capturedAt <= now + 86_400_000
    ? source.capturedAt
    : now
  return { url, capturedAt }
}

/** Every character class a stored annotation or book id may use. */
const ID = /^[\da-f-]{1,64}$/iu

/** PNG magic bytes every uploaded cover and crop must start with. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const

/** The config-editor face, mirrored structurally so this package carries no
 * dependency on it; profiles without the service answer `undefined`. */
interface ConfigEditorFace {
  entries(): ReadonlyArray<{ options: { id: string } }>
  edit(
    entry: { options: { id: string } },
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/**
 * The browser-facing library service. Files, progress, and annotations live on
 * the Host; the browser parses and renders with PDF.js and streams treatments.
 */
export default class PdfReaderController extends TypertRemoteService {
  static inject = ['llm', 'typert', 'attachments']
  static Config: z<Config> = z.object({
    dataRoot: z.string().default(''),
    maxPdfBytes: z.natural().max(1024 * 1024 * 1024).default(100 * 1024 * 1024),
    targetLanguage: z.string().default('简体中文'),
    provider: z.string().default(''),
    model: z.string().default(''),
    shotProvider: z.string().default(''),
    shotModel: z.string().default(''),
    maxOutputTokens: z.natural().min(64).max(MAX_OUTPUT_TOKENS).default(2048),
  })

  private readonly store: PdfStore

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'pdfReaderController', { namespace: 'pdfReader' })
    this.store = new PdfStore(this.resolveDataRoot())
    ctx.inject(['connection'], (scope: Context) => {
      scope.effect(() => scope.connection.fetch.register({
        path: COVER_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => this.serveImage(request, 'cover'),
      }), 'pdf-reader: cover route')
      scope.effect(() => scope.connection.fetch.register({
        path: SHOT_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => this.serveImage(request, 'shot'),
      }), 'pdf-reader: shot route')
    })
  }

  /** Data root: the configured path, else beside the running profile. */
  private resolveDataRoot(): string {
    if (this.config.dataRoot !== '') return this.config.dataRoot
    const profile = this.ctx.get('profileContext') as { dir?: string; home?: string } | undefined
    if (profile?.dir !== undefined) return `${profile.dir}/.pdf-reader`
    if (profile?.home !== undefined) return `${profile.home}/pdf-reader`
    throw new Error('pdf-reader: no dataRoot configured and no profile context available')
  }

  /** One stored book as a browser row. */
  private async rowOf(meta: StoredBookMeta): Promise<BookRow> {
    const progress = await this.store.loadProgress(meta.bookId) ?? { page: 1 }
    return {
      bookId: meta.bookId,
      title: meta.title,
      pageCount: meta.pageCount,
      outline: [...meta.outline],
      progress,
      coverUrl: meta.hasCover ? coverUrl(meta.bookId) : null,
      importedAt: meta.importedAt,
      source: meta.source,
    }
  }

  /** Metadata of one book, or the not-found failure. */
  private async metaOf(bookId: string): Promise<StoredBookMeta> {
    const meta = await this.store.loadMeta(bookId)
    if (meta === null) throw new RemoteError('pdf/not-found', `No such book: ${bookId}`, { subject: 'book' })
    return meta
  }

  /**
   * List the library.
   * @returns every readable book as a shelf row, newest import first.
   */
  @Remote
  async list(): Promise<BookRow[]> {
    return await Promise.all((await this.store.listBooks()).map(meta => this.rowOf(meta)))
  }

  /**
   * Import one PDF file.
   * @param fileName - the import's display name.
   * @param pdfBase64 - the file bytes as canonical base64.
   * @param source - the origin record a web capture files beside its PDF, or null.
   * @param signal - Client cancellation.
   * @returns the stored book as a shelf row; page structure reports on first open.
   */
  @Remote
  async importBook(fileName: string, pdfBase64: string, source: ImportSource | null, signal: AbortSignal): Promise<BookRow> {
    signal.throwIfAborted()
    const bytes = this.decodeBase64(pdfBase64, this.config.maxPdfBytes, 'file')
    let meta: StoredBookMeta
    try {
      meta = await this.store.importBook(bytes, fileName.replace(/\.pdf$/iu, '').trim(), sanitizeSource(source))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('pdf/bad-file', reason, { reason })
    }
    signal.throwIfAborted()
    return await this.rowOf(meta)
  }

  /**
   * Delete one book with all its data.
   * @param bookId - the book to remove.
   */
  @Remote
  async removeBook(bookId: string): Promise<void> {
    await this.metaOf(bookId)
    await this.store.removeBook(bookId)
  }

  /**
   * The browser's first-open structure report: title, page count, and outline.
   * @param bookId - the book the browser opened.
   * @param report - the PDF.js-resolved structure.
   */
  @Remote
  async saveBookMeta(bookId: string, report: MetaReport): Promise<BookRow> {
    await this.metaOf(bookId)
    const pageCount = Math.trunc(report.pageCount)
    if (!Number.isFinite(pageCount) || pageCount < 1 || pageCount > 100_000) {
      throw new RemoteError('pdf/invalid-request', 'Page count is out of range', { reason: 'pageCount' })
    }
    if (!Array.isArray(report.outline) || report.outline.length > 2000) {
      throw new RemoteError('pdf/invalid-request', 'Outline is not a bounded entry list', { reason: 'outline' })
    }
    for (const entry of report.outline) {
      if (typeof entry?.title !== 'string' || entry.title.length > 300) {
        throw new RemoteError('pdf/invalid-request', 'Outline entry title is malformed', { reason: 'outline' })
      }
      if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > pageCount) {
        throw new RemoteError('pdf/invalid-request', 'Outline entry page is out of range', { reason: 'outline' })
      }
    }
    const title = typeof report.title === 'string' ? report.title.slice(0, 300) : ''
    const meta = await this.store.saveMetaReport(bookId, { title, pageCount, outline: report.outline })
    return await this.rowOf(meta)
  }

  /**
   * Store the browser-rendered first-page cover thumbnail.
   * @param bookId - the book the thumbnail belongs to.
   * @param pngBase64 - the thumbnail PNG as canonical base64.
   */
  @Remote
  async saveCover(bookId: string, pngBase64: string): Promise<void> {
    await this.metaOf(bookId)
    const bytes = this.decodeBase64(pngBase64, 4 * 1024 * 1024, 'cover')
    this.expectPng(bytes, 'cover')
    await this.store.writeCover(bookId, bytes)
  }

  /**
   * The complete stored bytes of one book, for the browser's PDF.js parse.
   * @param bookId - the book to read.
   */
  @Remote
  async pdfBytes(bookId: string): Promise<PdfBytes> {
    await this.metaOf(bookId)
    const data = await this.store.readPdf(bookId)
    if (data === null) throw new RemoteError('pdf/not-found', `No stored PDF for ${bookId}`, { subject: 'book' })
    return { data }
  }

  /**
   * Save the reading position of one book.
   * @param bookId - the book being read.
   * @param progress - the 1-based page the reader last showed.
   */
  @Remote
  async saveProgress(bookId: string, progress: BookProgress): Promise<void> {
    await this.metaOf(bookId)
    await this.store.saveProgress(bookId, progress)
  }

  /**
   * The saved annotations of one book.
   * @param bookId - the book being read.
   * @returns every text highlight and screenshot question of the book.
   */
  @Remote
  async annotations(bookId: string): Promise<PdfAnnotation[]> {
    await this.metaOf(bookId)
    return await this.store.loadAnnotations(bookId) ?? []
  }

  /**
   * Persist one annotation, creating or replacing by id.
   * @param bookId - the book being read.
   * @param annotation - the complete annotation record.
   */
  @Remote
  async saveAnnotation(bookId: string, annotation: PdfAnnotation): Promise<void> {
    const meta = await this.metaOf(bookId)
    if (!ID.test(annotation.id)) {
      throw new RemoteError('pdf/invalid-request', 'Annotation id must be a short uuid', { reason: 'id' })
    }
    const pageCount = Math.max(meta.pageCount, 1)
    if (!Number.isInteger(annotation.page) || annotation.page < 1 || annotation.page > pageCount) {
      throw new RemoteError('pdf/invalid-request', 'Annotation page is out of range', { reason: 'page' })
    }
    if (annotation.kind === 'text') {
      if (annotation.start < 0 || annotation.end <= annotation.start || annotation.end - annotation.start > 8000) {
        throw new RemoteError('pdf/invalid-request', 'Annotation range is invalid', { reason: 'range' })
      }
      if (typeof annotation.quote !== 'string' || annotation.quote.length === 0 || annotation.quote.length > 8000) {
        throw new RemoteError('pdf/invalid-request', 'Annotation quote is empty or too long', { reason: 'quote' })
      }
      if (annotation.color !== undefined && !HIGHLIGHT_COLORS.includes(annotation.color)) {
        throw new RemoteError('pdf/invalid-request', 'Annotation color is outside the palette', { reason: 'color' })
      }
    }
    else {
      this.expectRect(annotation.rect)
      if (typeof annotation.question !== 'string' || annotation.question.length > MAX_QUESTION_CHARS + 100) {
        throw new RemoteError('pdf/invalid-request', 'Annotation question is malformed', { reason: 'question' })
      }
      if (typeof annotation.imageUrl !== 'string' || annotation.imageUrl.length === 0 || annotation.imageUrl.length > 500) {
        throw new RemoteError('pdf/invalid-request', 'Annotation image URL is malformed', { reason: 'imageUrl' })
      }
    }
    const current = await this.store.loadAnnotations(bookId) ?? []
    const next: PdfAnnotation[] = [annotation, ...current.filter(row => row.id !== annotation.id)]
    await this.store.saveAnnotations(bookId, next)
  }

  /**
   * Delete one annotation with its stored screenshot crop.
   * @param bookId - the book being read.
   * @param annotationId - the annotation to remove.
   */
  @Remote
  async deleteAnnotation(bookId: string, annotationId: string): Promise<void> {
    await this.metaOf(bookId)
    const current = await this.store.loadAnnotations(bookId) ?? []
    const removing = current.find(row => row.id === annotationId)
    await this.store.saveAnnotations(bookId, current.filter(row => row.id !== annotationId))
    if (removing?.kind === 'shot') await this.store.removeShot(bookId, annotationId)
  }

  /**
   * Where the library lives today.
   * @returns the resolved data root and whether this profile can move it.
   */
  @Remote
  async storage(): Promise<StorageMeta> {
    return {
      directory: this.resolveDataRoot(),
      configurable: this.configEditor() !== undefined,
    }
  }

  /**
   * Move the library to another directory.
   * @param directory - an absolute path; empty restores the profile default.
   */
  @Remote
  async setStorageDirectory(directory: string): Promise<void> {
    const trimmed = directory.trim()
    await this.editConfig({ dataRoot: trimmed === '' ? undefined : this.expectAbsolutePath(trimmed) })
  }

  /**
   * The treatment model landscape.
   * @returns every routable provider/model pair, vision-flagged, plus both selections.
   */
  @Remote
  async treatmentModels(): Promise<TreatmentCatalog> {
    const models: TreatmentModel[] = []
    for (const provider of this.ctx.llm.listProviders()) {
      for (const model of await this.ctx.llm.listModels(provider.id)) {
        const { vision } = await this.modelCapabilities(provider.id, model.id)
        models.push({ provider: provider.id, model: model.id, name: model.name, vision })
      }
    }
    const fallback = this.ctx.get('agentDefaultModel') as { provider?: string; model?: string } | undefined
    return {
      provider: this.config.provider,
      model: this.config.model,
      shotProvider: this.config.shotProvider,
      shotModel: this.config.shotModel,
      defaultProvider: fallback?.provider ?? '',
      defaultModel: fallback?.model ?? '',
      models,
    }
  }

  /**
   * Choose the model text treatments use.
   * @param provider - provider route; empty with an empty model follows the default.
   * @param model - model id under that provider; empty only with an empty provider.
   */
  @Remote
  async setTreatmentModel(provider: string, model: string): Promise<void> {
    await this.editConfig(await this.modelConfigPatch(provider, model, false))
  }

  /**
   * Choose the model screenshot questions use; the pair must accept images.
   * @param provider - provider route; empty with an empty model follows the default.
   * @param model - model id under that provider; empty only with an empty provider.
   */
  @Remote
  async setShotModel(provider: string, model: string): Promise<void> {
    await this.editConfig(await this.modelConfigPatch(provider, model, true))
  }

  /**
   * Treat one text selection with the LLM service, streaming text deltas.
   * @param request - the selection, its kind, and its page context.
   * @param signal - Client cancellation for the whole stream.
   * @yields one meta chunk, text deltas, then a done chunk.
   */
  @Remote({ mode: 'stream' })
  async *explain(request: ExplainRequest, signal: AbortSignal): AsyncIterable<TreatChunk> {
    signal.throwIfAborted()
    const text = request.text.trim()
    if (text === '') throw new RemoteError('pdf/invalid-request', 'Selection text is empty', { reason: 'text' })
    const meta = await this.metaOf(request.bookId)
    const selection = this.resolveTextSelection()
    const capabilities = await this.modelCapabilities(selection.provider, selection.model)
    const context: PromptContext = {
      title: meta.title,
      pageLabel: `第 ${Math.max(1, request.page)} 页`,
      targetLanguage: this.config.targetLanguage,
    }
    yield { type: 'meta', model: selection.model }
    let emitted = false
    try {
      const stream = this.ctx.llm.stream({
        provider: selection.provider,
        model: selection.model,
        system: systemPromptFor(request.kind, context),
        messages: [{ role: 'user', content: [{ type: 'text', text: userPromptFor(request) }] }],
        maxTokens: this.treatmentMaxTokens(capabilities.thinking),
        ...capabilities.effort !== undefined ? { reasoningEffort: capabilities.effort } : {},
      })
      for await (const chunk of stream) {
        signal.throwIfAborted()
        if (chunk.type === 'text-delta' && chunk.text !== '') {
          emitted = true
          yield { type: 'delta', text: chunk.text }
        }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? new Error('cancelled')
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('pdf/explain-failed', reason, { reason })
    }
    if (!emitted) throw new RemoteError('pdf/explain-failed', 'The model returned no text', { reason: 'empty' })
    yield { type: 'done' }
  }

  /**
   * Answer one screenshot question, storing the crop and streaming text deltas.
   * @param request - the page region, its PNG, and the question.
   * @param signal - Client cancellation for the whole stream.
   * @yields one meta chunk, text deltas, then a done chunk carrying the crop URL.
   */
  @Remote({ mode: 'stream' })
  async *askImage(request: AskImageRequest, signal: AbortSignal): AsyncIterable<TreatChunk> {
    signal.throwIfAborted()
    if (!ID.test(request.annotationId)) {
      throw new RemoteError('pdf/invalid-request', 'Annotation id must be a short uuid', { reason: 'id' })
    }
    this.expectRect(request.rect)
    const meta = await this.metaOf(request.bookId)
    const png = this.decodeBase64(request.pngBase64, 8 * 1024 * 1024, 'crop')
    this.expectPng(png, 'crop')
    const selection = await this.resolveShotSelection(request)
    const context: PromptContext = {
      title: meta.title,
      pageLabel: `第 ${Math.max(1, request.page)} 页`,
      targetLanguage: this.config.targetLanguage,
    }
    const question = request.question.trim() === '' ? defaultShotQuestion(this.config.targetLanguage) : request.question.trim()
    const attachment = await this.ctx.attachments.saveImage({ data: png, mediaType: 'image/png', name: `${meta.title} p${request.page}` })
    await this.store.writeShot(request.bookId, request.annotationId, png)
    yield { type: 'meta', model: selection.model }
    let emitted = false
    try {
      const stream = this.ctx.llm.stream({
        provider: selection.provider,
        model: selection.model,
        system: shotSystemPrompt(context),
        messages: [{
          role: 'user',
          content: [
            { type: 'image', attachment },
            { type: 'text', text: shotUserPrompt({ ...request, question }) },
          ],
        }],
        maxTokens: this.treatmentMaxTokens(selection.thinking),
        ...selection.effort !== undefined ? { reasoningEffort: selection.effort } : {},
      })
      for await (const chunk of stream) {
        signal.throwIfAborted()
        if (chunk.type === 'text-delta' && chunk.text !== '') {
          emitted = true
          yield { type: 'delta', text: chunk.text }
        }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? new Error('cancelled')
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('pdf/explain-failed', reason, { reason })
    }
    if (!emitted) throw new RemoteError('pdf/explain-failed', 'The model returned no text', { reason: 'empty' })
    yield { type: 'done', imageUrl: shotUrl(request.bookId, request.annotationId) }
  }

  /** Provider and model for text treatments: configured pair, else the profile default. */
  private resolveTextSelection(): { provider: string; model: string } {
    if (this.config.provider !== '' && this.config.model !== '') {
      return { provider: this.config.provider, model: this.config.model }
    }
    return this.defaultSelection('pdf/no-model', 'No treatment model configured and no profile default model available')
  }

  /**
   * Provider and model for screenshots, with thinking request controls:
   * the per-ask pair, the configured pair, or the profile default; must
   * see images.
   */
  private async resolveShotSelection(request?: AskImageRequest): Promise<{ provider: string; model: string } & ThinkingControls> {
    const override = request?.provider !== undefined && request.model !== undefined
      && request.provider !== '' && request.model !== ''
      ? { provider: request.provider, model: request.model }
      : undefined
    const selection = override ?? (this.config.shotProvider !== '' && this.config.shotModel !== ''
      ? { provider: this.config.shotProvider, model: this.config.shotModel }
      : this.defaultSelection('pdf/no-vision-model', 'No screenshot model configured and no profile default model available'))
    const capabilities = await this.modelCapabilities(selection.provider, selection.model)
    if (!capabilities.vision) {
      throw new RemoteError('pdf/no-vision-model', `"${selection.provider}/${selection.model}" accepts no image input`, { reason: 'modality' })
    }
    return {
      ...selection,
      ...capabilities.effort !== undefined ? { effort: capabilities.effort } : {},
      thinking: capabilities.thinking,
    }
  }

  /** The profile default pair, or the named failure when none resolves. */
  private defaultSelection(code: 'pdf/no-model' | 'pdf/no-vision-model', reason: string): { provider: string; model: string } {
    const fallback = this.ctx.get('agentDefaultModel') as { provider?: string; model?: string } | undefined
    if (fallback !== undefined && fallback.provider !== undefined && fallback.model !== undefined
      && fallback.provider !== '' && fallback.model !== '') {
      return { provider: fallback.provider, model: fallback.model }
    }
    throw new RemoteError(code, reason, { reason: 'no-selection' })
  }

  /**
   * One treatment model's request-relevant capabilities: image input, and the
   * reasoning effort a treatment should request — the adapter's configured
   * default, else the mildest supported level — with whether that level
   * actually thinks. Unresolvable metadata answers no capabilities, which the
   * shot path reports as a non-vision model.
   * @param provider - provider route of the model.
   * @param model - model id under the provider.
   * @returns the vision flag and the thinking request controls.
   */
  private async modelCapabilities(provider: string, model: string): Promise<{ vision: boolean } & ThinkingControls> {
    try {
      const info = await this.ctx.llm.resolveModelInfo(provider, model)
      const effort = info.reasoning?.defaultEffort ?? info.reasoning?.efforts[0]?.id
      return {
        vision: info.inputModalities?.includes('image') === true,
        ...effort !== undefined
          ? { effort, thinking: effort !== ReasoningEffortId('off') }
          : { thinking: false },
      }
    } catch {
      return { vision: false, thinking: false }
    }
  }

  /**
   * The output ceiling one treatment requests: the configured answer budget,
   * plus thinking headroom when the requested effort actually thinks, capped
   * at the configurable maximum. Reasoning shares this ceiling with the answer
   * on zai-style endpoints, so an unraised budget lets reasoning starve the
   * answer into the "model returned no text" failure.
   * @param thinking - whether the request carries a thinking effort.
   * @returns the maxTokens value for the LLM request.
   */
  private treatmentMaxTokens(thinking: boolean): number {
    return thinking
      ? Math.min(this.config.maxOutputTokens + THINKING_HEADROOM_TOKENS, MAX_OUTPUT_TOKENS)
      : this.config.maxOutputTokens
  }

  /** Decode canonical base64 under one byte cap, answering the typed failure. */
  private decodeBase64(value: string, maxBytes: number, subject: string): Uint8Array {    const trimmed = value.replace(/\s+/gu, '')
    if (trimmed === '' || /[^A-Za-z0-9+/=]/u.test(trimmed)) {
      throw new RemoteError('pdf/bad-file', `The ${subject} must be canonical base64`, { reason: 'encoding' })
    }
    if (trimmed.length > Math.ceil(maxBytes / 3) * 4 + 4) {
      throw new RemoteError('pdf/too-large', `The ${subject} exceeds the configured byte limit`, { maxBytes })
    }
    const bytes = new Uint8Array(Buffer.from(trimmed, 'base64'))
    if (bytes.byteLength > maxBytes) {
      throw new RemoteError('pdf/too-large', `The ${subject} exceeds the configured byte limit`, { maxBytes })
    }
    return bytes
  }

  /** Require the PNG magic on one decoded upload. */
  private expectPng(bytes: Uint8Array, subject: string): void {
    if (bytes.byteLength < 8 || !PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
      throw new RemoteError('pdf/bad-file', `The ${subject} is not a PNG image`, { reason: 'png' })
    }
  }

  /** Require a rect inside the unit page box. */
  private expectRect(rect: ShotRect): void {
    const numbers = [rect?.x, rect?.y, rect?.width, rect?.height]
    if (numbers.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new RemoteError('pdf/invalid-request', 'Screenshot rect is malformed', { reason: 'rect' })
    }
    if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
      || rect.x + rect.width > 1.001 || rect.y + rect.height > 1.001
      || rect.width > 1 || rect.height > 1) {
      throw new RemoteError('pdf/invalid-request', 'Screenshot rect escapes the page box', { reason: 'rect' })
    }
  }

  /** The profile's config editor when one runs here; absent editors block runtime changes. */
  private configEditor(): ConfigEditorFace | undefined {
    return this.ctx.get('configEditor') as ConfigEditorFace | undefined
  }

  /** Require an absolute path for one storage move. */
  private expectAbsolutePath(directory: string): string {
    const trimmed = directory.trim()
    if (!isAbsolute(trimmed)) {
      throw new RemoteError('pdf/invalid-request', 'The storage directory must be an absolute path', { reason: 'path' })
    }
    return trimmed
  }

  /** Build the config patch one model pick writes, validating the pair first. */
  private async modelConfigPatch(provider: string, model: string, shot: boolean): Promise<Record<string, string | undefined>> {
    const providerId = provider.trim(), modelId = model.trim()
    if (providerId === '' !== (modelId === '')) {
      throw new RemoteError('pdf/invalid-request', 'Provider and model must be set or cleared together', { reason: 'pair' })
    }
    if (providerId !== '') {
      const catalog = await this.treatmentModels()
      const entry = catalog.models.find(row => row.provider === providerId && row.model === modelId)
      if (entry === undefined) {
        throw new RemoteError('pdf/invalid-request', `Model "${providerId}/${modelId}" is not routable`, { reason: 'model' })
      }
      if (shot && !entry.vision) {
        throw new RemoteError('pdf/invalid-request', `Model "${providerId}/${modelId}" accepts no image input`, { reason: 'vision' })
      }
    }
    return shot
      ? { shotProvider: providerId === '' ? undefined : providerId, shotModel: modelId === '' ? undefined : modelId }
      : { provider: providerId === '' ? undefined : providerId, model: modelId === '' ? undefined : modelId }
  }

  /** Apply one config patch through the profile's config editor. */
  private async editConfig(patch: Record<string, string | undefined>): Promise<void> {
    const editor = this.configEditor()
    if (editor === undefined) {
      throw new RemoteError('pdf/invalid-request', 'Configuration editing is not available in this profile', { reason: 'config' })
    }
    const entry = editor.entries().find(candidate => candidate.options.id === 'pdf-reader')
    if (entry === undefined) {
      throw new RemoteError('pdf/invalid-request', 'The reader entry is not addressable in this profile', { reason: 'entry' })
    }
    await editor.edit(entry, (current) => {
      // An undefined patch value drops the key; any other value replaces it.
      const dropped = new Set(Object.entries(patch).filter(([, value]) => value === undefined).map(([key]) => key))
      const next = Object.fromEntries(Object.entries(current).filter(([key]) => !dropped.has(key)))
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) next[key] = value
      }
      return next
    })
  }

  /** Answer `GET ${COVER_PATH}?book=<id>` and `GET ${SHOT_PATH}?book=<id>&id=<annotation>` with one stored PNG. */
  async serveImage(request: Request, kind: 'cover' | 'shot'): Promise<Response> {
    const params = new URL(request.url).searchParams
    const bookId = params.get('book') ?? ''
    const annotationId = params.get('id') ?? ''
    const empty = (status: number): Response => new Response(null, {
      status,
      headers: {
        'content-security-policy': 'sandbox',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    })
    if (!ID.test(bookId) || (kind === 'shot' && !ID.test(annotationId))) return empty(404)
    const bytes = kind === 'cover'
      ? await this.store.readCover(bookId)
      : await this.store.readShot(bookId, annotationId)
    if (bytes === null) return empty(404)
    // Crops are immutable per annotation id; the id changes on regeneration.
    return new Response(new Blob([new Uint8Array(bytes)], { type: 'image/png' }), {
      headers: {
        'content-type': 'image/png',
        'content-security-policy': 'sandbox',
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=86400',
      },
    })
  }
}
