/**
 * The EPUB reader Host service: library, chapters, annotations, and LLM treatments.
 *
 * @module @deepseek-ai/dsh-epub-reader
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute } from 'node:path'
import type {} from '@deepseek-ai/dsh-client-connection'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { systemPromptFor, userPromptFor, type PromptContext } from './prompts.ts'
import { RESOURCE_MEDIA_TYPES, sanitizeChapter } from './sanitize.ts'
import { EpubStore, type StoredBookMeta } from './store.ts'
import type { Annotation, BookRow, ChapterDoc, ExplainChunk, ExplainRequest, StorageMeta, TocEntry, TreatmentCatalog, TreatmentModel } from './types.ts'
import type { BookProgress } from './types.ts'

export type { Annotation, BookProgress, BookRow, ChapterDoc, ExplainChunk, ExplainKind, ExplainRequest, ExplainResult, StorageMeta, TocEntry, TreatmentCatalog, TreatmentModel } from './types.ts'
export { EpubFormatError } from './epub.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** EPUB library Remote controller. */
    epubReaderController: EpubReaderController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No book or chapter carries that identity. */
    'epub/not-found': { readonly subject: string }
    /** The imported archive is not a usable EPUB. */
    'epub/bad-file': { readonly reason: string }
    /** The archive exceeds the configured byte limit. */
    'epub/too-large': { readonly maxBytes: number }
    /** A request value is missing or malformed. */
    'epub/invalid-request': { readonly reason: string }
    /** No LLM provider and model resolve for treatments. */
    'epub/no-model': { readonly reason: string }
    /** A treatment stream failed. */
    'epub/explain-failed': { readonly reason: string }
  }
}

/** Limits and preferences of the library service. */
export interface Config {
  /** Plugin data root; empty resolves beside the running profile. */
  dataRoot: string
  /** Maximum imported archive size in bytes. */
  maxBookBytes: number
  /** Human-readable target language used verbatim in prompts. */
  targetLanguage: string
  /** Provider override for treatments; empty follows the profile default. */
  provider: string
  /** Model override for treatments; empty follows the profile default. */
  model: string
  /** Answer token budget for one treatment; thinking models request it plus headroom. */
  maxOutputTokens: number
}

/** The Fetch route that serves one book resource. */
const RESOURCE_PATH = '/api/epub-reader/resource'

/** Build the Fetch-route URL of one book resource. */
function resourceUrl(bookId: string, interiorPath: string): string {
  return `${RESOURCE_PATH}?book=${encodeURIComponent(bookId)}&path=${encodeURIComponent(interiorPath)}`
}

/** Every character class a stored annotation id may use. */
const ANNOTATION_ID = /^[\da-f-]{1,64}$/iu

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
 * The config-editor face, mirrored structurally so this package carries no
 * dependency on it; profiles without the service answer `undefined`.
 */
interface ConfigEditorFace {
  entries(): ReadonlyArray<{ options: { id: string } }>
  edit(
    entry: { options: { id: string } },
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/**
 * The browser-facing library service. Books, progress, and annotations live on
 * the Host; the browser renders sanitized chapters and streams treatments.
 */
export default class EpubReaderController extends TypertRemoteService {
  static inject = ['llm', 'typert']
  static Config: z<Config> = z.object({
    dataRoot: z.string().default(''),
    maxBookBytes: z.natural().max(256 * 1024 * 1024).default(50 * 1024 * 1024),
    targetLanguage: z.string().default('简体中文'),
    provider: z.string().default(''),
    model: z.string().default(''),
    maxOutputTokens: z.natural().min(64).max(MAX_OUTPUT_TOKENS).default(2048),
  })

  private readonly store: EpubStore

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'epubReaderController', { namespace: 'epubReader' })
    this.store = new EpubStore(this.resolveDataRoot())
    ctx.inject(['connection'], (scope: Context) => {
      scope.effect(() => scope.connection.fetch.register({
        path: RESOURCE_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => this.serveResource(request),
      }), 'epub-reader: resource route')
    })
  }

  /** Data root: the configured path, else beside the running profile. */
  private resolveDataRoot(): string {
    if (this.config.dataRoot !== '') return this.config.dataRoot
    const profile = this.ctx.get('profileContext') as { dir?: string; home?: string } | undefined
    if (profile?.dir !== undefined) return `${profile.dir}/.epub-reader`
    if (profile?.home !== undefined) return `${profile.home}/epub-reader`
    throw new Error('epub-reader: no dataRoot configured and no profile context available')
  }

  /** One stored book as a browser row. */
  private async rowOf(meta: StoredBookMeta): Promise<BookRow> {
    const progress = await this.store.loadProgress(meta.bookId) ?? { chapterIndex: 0, ratio: 0 }
    return {
      bookId: meta.bookId,
      title: meta.title,
      author: meta.author,
      language: meta.language,
      coverUrl: meta.coverPath === null ? null : resourceUrl(meta.bookId, meta.coverPath),
      chapterCount: meta.chapters.length,
      progress,
      importedAt: meta.importedAt,
    }
  }

  /** Metadata of one book, or the not-found failure. */
  private async metaOf(bookId: string): Promise<StoredBookMeta> {
    const meta = await this.store.loadMeta(bookId)
    if (meta === null) throw new RemoteError('epub/not-found', `No such book: ${bookId}`, { subject: 'book' })
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
   * Import one EPUB archive.
   * @param fileName - the import's display name.
   * @param archiveBase64 - the archive bytes as canonical base64.
   * @param signal - Client cancellation.
   * @returns the stored book as a shelf row.
   */
  @Remote
  async importBook(fileName: string, archiveBase64: string, signal: AbortSignal): Promise<BookRow> {
    signal.throwIfAborted()
    const trimmed = archiveBase64.replace(/\s+/gu, '')
    if (trimmed === '' || /[^A-Za-z0-9+/=]/u.test(trimmed)) {
      throw new RemoteError('epub/bad-file', 'The archive must be canonical base64', { reason: 'encoding' })
    }
    if (trimmed.length > Math.ceil(this.config.maxBookBytes / 3) * 4 + 4) {
      throw new RemoteError('epub/too-large', 'The archive exceeds the configured byte limit', { maxBytes: this.config.maxBookBytes })
    }
    const bytes = new Uint8Array(Buffer.from(trimmed, 'base64'))
    if (bytes.byteLength > this.config.maxBookBytes) {
      throw new RemoteError('epub/too-large', 'The archive exceeds the configured byte limit', { maxBytes: this.config.maxBookBytes })
    }
    let meta: StoredBookMeta
    try {
      ({ meta } = await this.store.importBook(bytes, fileName.replace(/\.epub$/iu, '')))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('epub/bad-file', reason, { reason })
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
    const editor = this.configEditor()
    if (editor === undefined) {
      throw new RemoteError('epub/invalid-request', 'Configuration editing is not available in this profile', { reason: 'config' })
    }
    const trimmed = directory.trim()
    if (trimmed !== '' && !isAbsolute(trimmed)) {
      throw new RemoteError('epub/invalid-request', 'The storage directory must be an absolute path', { reason: 'path' })
    }
    const entry = editor.entries().find(candidate => candidate.options.id === 'epub-reader')
    if (entry === undefined) {
      throw new RemoteError('epub/invalid-request', 'The reader entry is not addressable in this profile', { reason: 'entry' })
    }
    await editor.edit(entry, (current) => {
      const next = { ...current }
      if (trimmed === '') delete next.dataRoot
      else next.dataRoot = trimmed
      return next
    })
  }

  /** The profile's config editor when one runs here; absent editors block runtime changes. */
  private configEditor(): ConfigEditorFace | undefined {
    return this.ctx.get('configEditor') as ConfigEditorFace | undefined
  }

  /**
   * The treatment model landscape.
   * @returns every routable provider/model pair plus the effective selection.
   */
  @Remote
  async treatmentModels(): Promise<TreatmentCatalog> {
    const models: TreatmentModel[] = []
    for (const provider of this.ctx.llm.listProviders()) {
      for (const model of await this.ctx.llm.listModels(provider.id)) {
        models.push({ provider: provider.id, model: model.id, name: model.name })
      }
    }
    const fallback = this.ctx.get('agentDefaultModel') as { provider?: string; model?: string } | undefined
    return {
      provider: this.config.provider,
      model: this.config.model,
      defaultProvider: fallback?.provider ?? '',
      defaultModel: fallback?.model ?? '',
      models,
    }
  }

  /**
   * Choose the model treatments use.
   * @param provider - provider route; empty with an empty model follows the default.
   * @param model - model id under that provider; empty only with an empty provider.
   */
  @Remote
  async setTreatmentModel(provider: string, model: string): Promise<void> {
    const providerId = provider.trim(), modelId = model.trim()
    if (providerId === '' !== (modelId === '')) {
      throw new RemoteError('epub/invalid-request', 'Provider and model must be set or cleared together', { reason: 'pair' })
    }
    if (providerId !== '') {
      const routable = await this.treatmentModels()
      if (!routable.models.some(entry => entry.provider === providerId && entry.model === modelId)) {
        throw new RemoteError('epub/invalid-request', `Model "${providerId}/${modelId}" is not routable`, { reason: 'model' })
      }
    }
    const editor = this.configEditor()
    if (editor === undefined) {
      throw new RemoteError('epub/invalid-request', 'Configuration editing is not available in this profile', { reason: 'config' })
    }
    const entry = editor.entries().find(candidate => candidate.options.id === 'epub-reader')
    if (entry === undefined) {
      throw new RemoteError('epub/invalid-request', 'The reader entry is not addressable in this profile', { reason: 'entry' })
    }
    await editor.edit(entry, (current) => {
      const next = { ...current }
      if (providerId === '') {
        delete next.provider
        delete next.model
      }
      else {
        next.provider = providerId
        next.model = modelId
      }
      return next
    })
  }

  /**
   * The book's table of contents.
   * @param bookId - the book to read.
   * @returns TOC entries resolved onto chapter indexes.
   */
  @Remote
  async toc(bookId: string): Promise<TocEntry[]> {
    return [...(await this.metaOf(bookId)).toc]
  }

  /**
   * One sanitized chapter body.
   * @param bookId - the book to read.
   * @param chapterIndex - spine index of the chapter.
   * @returns the chapter with resource references on the Fetch route.
   */
  @Remote
  async chapter(bookId: string, chapterIndex: number): Promise<ChapterDoc> {
    const meta = await this.metaOf(bookId)
    const read = await this.store.readChapter(bookId, chapterIndex)
    if (read === null) throw new RemoteError('epub/not-found', `No chapter ${chapterIndex} of ${bookId}`, { subject: 'chapter' })
    return {
      bookId,
      chapterIndex,
      title: meta.chapters[chapterIndex]?.title ?? `第 ${chapterIndex + 1} 节`,
      html: sanitizeChapter(read.xhtml, read.path, path => resourceUrl(bookId, path)),
    }
  }

  /**
   * Save the reading position of one book.
   * @param bookId - the book being read.
   * @param progress - chapter index and scrolled ratio.
   */
  @Remote
  async saveProgress(bookId: string, progress: BookProgress): Promise<void> {
    await this.metaOf(bookId)
    await this.store.saveProgress(bookId, progress)
  }

  /**
   * The saved highlights of one book.
   * @param bookId - the book being read.
   * @returns every annotation of the book.
   */
  @Remote
  async annotations(bookId: string): Promise<Annotation[]> {
    await this.metaOf(bookId)
    return await this.store.loadAnnotations(bookId) ?? []
  }

  /**
   * Persist one highlight, creating or replacing by id.
   * @param bookId - the book being read.
   * @param annotation - the complete annotation record.
   */
  @Remote
  async saveAnnotation(bookId: string, annotation: Annotation): Promise<void> {
    const meta = await this.metaOf(bookId)
    if (!ANNOTATION_ID.test(annotation.id)) {
      throw new RemoteError('epub/invalid-request', 'Annotation id must be a short uuid', { reason: 'id' })
    }
    if (annotation.chapterIndex < 0 || annotation.chapterIndex >= meta.chapters.length) {
      throw new RemoteError('epub/invalid-request', 'Annotation chapter is out of range', { reason: 'chapterIndex' })
    }
    if (annotation.start < 0 || annotation.end <= annotation.start || annotation.end - annotation.start > 8000) {
      throw new RemoteError('epub/invalid-request', 'Annotation range is invalid', { reason: 'range' })
    }
    if (typeof annotation.quote !== 'string' || annotation.quote.length === 0) {
      throw new RemoteError('epub/invalid-request', 'Annotation quote is empty', { reason: 'quote' })
    }
    const current = await this.store.loadAnnotations(bookId) ?? []
    const next = [annotation, ...current.filter(row => row.id !== annotation.id)]
    await this.store.saveAnnotations(bookId, next)
  }

  /**
   * Delete one highlight.
   * @param bookId - the book being read.
   * @param annotationId - the annotation to remove.
   */
  @Remote
  async deleteAnnotation(bookId: string, annotationId: string): Promise<void> {
    await this.metaOf(bookId)
    const current = await this.store.loadAnnotations(bookId) ?? []
    await this.store.saveAnnotations(bookId, current.filter(row => row.id !== annotationId))
  }

  /**
   * Treat one selection with the LLM service, streaming text deltas.
   * @param request - the selection, its kind, and its paragraph context.
   * @param signal - Client cancellation for the whole stream.
   * @yields one meta chunk, text deltas, then a done chunk.
   */
  @Remote({ mode: 'stream' })
  async *explain(request: ExplainRequest, signal: AbortSignal): AsyncIterable<ExplainChunk> {
    signal.throwIfAborted()
    const text = request.text.trim()
    if (text === '') throw new RemoteError('epub/invalid-request', 'Selection text is empty', { reason: 'text' })
    const meta = await this.metaOf(request.bookId)
    const selection = this.resolveSelection()
    const capabilities = await this.modelCapabilities(selection.provider, selection.model)
    const context: PromptContext = {
      title: meta.title,
      chapterTitle: meta.chapters[request.chapterIndex]?.title ?? '',
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
      throw new RemoteError('epub/explain-failed', reason, { reason })
    }
    if (!emitted) throw new RemoteError('epub/explain-failed', 'The model returned no text', { reason: 'empty' })
    yield { type: 'done' }
  }

  /** Provider and model for treatments: configured pair, else the profile default. */
  private resolveSelection(): { provider: string; model: string } {
    if (this.config.provider !== '' && this.config.model !== '') {
      return { provider: this.config.provider, model: this.config.model }
    }
    const fallback = this.ctx.get('agentDefaultModel') as { provider?: string; model?: string } | undefined
    if (fallback !== undefined && fallback.provider !== undefined && fallback.model !== undefined
      && fallback.provider !== '' && fallback.model !== '') {
      return { provider: fallback.provider, model: fallback.model }
    }
    throw new RemoteError('epub/no-model', 'No treatment model configured and no profile default model available', { reason: 'no-selection' })
  }

  /**
   * One treatment model's thinking request controls: the reasoning effort a
   * treatment should request — the adapter's configured default, else the
   * mildest supported level — with whether that level actually thinks.
   * Unresolvable metadata answers no controls, leaving the request as before.
   * @param provider - provider route of the model.
   * @param model - model id under the provider.
   * @returns the effort to request, if any, and whether it thinks.
   */
  private async modelCapabilities(provider: string, model: string): Promise<{ effort?: ReasoningEffortId; thinking: boolean }> {
    try {
      const info = await this.ctx.llm.resolveModelInfo(provider, model)
      const effort = info.reasoning?.defaultEffort ?? info.reasoning?.efforts[0]?.id
      return effort === undefined
        ? { thinking: false }
        : { effort, thinking: effort !== ReasoningEffortId('off') }
    } catch {
      return { thinking: false }
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

  /** Answer `GET ${RESOURCE_PATH}?book=<id>&path=<interior>` with one book resource. */
  async serveResource(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams
    const bookId = params.get('book') ?? ''
    const interiorPath = params.get('path') ?? ''
    const extension = interiorPath.slice(interiorPath.lastIndexOf('.')).toLowerCase()
    const mediaType = RESOURCE_MEDIA_TYPES[extension]
    const empty = (status: number): Response => new Response(null, {
      status,
      headers: {
        'content-security-policy': 'sandbox',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    })
    if (mediaType === undefined || !/^[\da-f-]{1,64}$/iu.test(bookId)) return empty(404)
    const bytes = await this.store.readResource(bookId, interiorPath)
    if (bytes === null) return empty(404)
    // Book content is immutable per import; the revision lives in the book id.
    return new Response(new Blob([new Uint8Array(bytes)], { type: mediaType }), {
      headers: {
        'content-type': mediaType,
        'content-security-policy': 'sandbox',
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, max-age=86400',
      },
    })
  }
}
