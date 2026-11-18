# EPUB reader

English | [中文](epub-reader.zh.md)

Experimental EPUB reading keeps a library on the Host and reads it from the browser: the [Host service](../../packages/experimental/epub-reader/README.md) owns storage, sanitizing, and treatments, the [browser panel](../../packages/experimental/client-ui-epub-reader/README.md) renders chapters, and the [optional bundle](../../packages/experimental/epub-reader-bundle/README.md) composes both.

## Library and chapters

`list()` returns every readable book as a `BookRow` (`BookProgress` inside carries the saved chapter index and scroll ratio); `importBook()` decodes the archive, parses container, package document, and spine, and extracts members under one directory per book. A `TocEntry` names one outline destination; `chapter()` returns one sanitized `ChapterDoc` — the chapter's XHTML with its interior path. Chapter images and fonts are served from the book itself over one Host Fetch route, restricted to the media types the sanitizer serves.

Every chapter document is untrusted external content and passes a strict sanitizer before it reaches the browser: an allowlist of kept tags and attributes, removal of script, style, form, and media-control subtrees, dropping of references to resources the book does not carry, and rewriting of kept image references onto the resource Fetch route. Interior paths are resolved below the book's content directory with escape rejection.

## Highlights and treatments

An `Annotation` anchors one highlight by `[start, end)` offsets into the chapter's plain-text stream and carries its quote and saved results. Selected text is translated or explained through streamed responses (`ExplainChunk` deltas driven by an `ExplainRequest`); answers persist with the highlight. Treatments run as separate model requests through the LLM service; the library, progress, and highlights work without any treatment model. The settings panel moves the library directory and chooses the treatment model at runtime through the profile's config-editor service.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxepubreadercontroller--epubreadercontroller"></a>

### `ctx.epubReaderController` — `EpubReaderController`

The browser-facing library service. Books, progress, and annotations live on the Host; the browser renders sanitized chapters and streams treatments.

```ts cordis-catalog
/**
 * List the library.
 * @returns every readable book as a shelf row, newest import first.
 */
@Remote async list(): Promise<BookRow[]>

/**
 * Import one EPUB archive.
 * @param fileName - the import's display name.
 * @param archiveBase64 - the archive bytes as canonical base64.
 * @param signal - Client cancellation.
 * @returns the stored book as a shelf row.
 */
@Remote async importBook(fileName: string, archiveBase64: string, signal: AbortSignal): Promise<BookRow>

/**
 * Delete one book with all its data.
 * @param bookId - the book to remove.
 */
@Remote async removeBook(bookId: string): Promise<void>

/**
 * Where the library lives today.
 * @returns the resolved data root and whether this profile can move it.
 */
@Remote // oxlint-disable-next-line typescript/require-await -- the Remote face requires a Promise return; the metadata resolves without awaiting async storage(): Promise<StorageMeta>

/**
 * Move the library to another directory.
 * @param directory - an absolute path; empty restores the profile default.
 */
@Remote async setStorageDirectory(directory: string): Promise<void>

/**
 * The treatment model landscape.
 * @returns every routable provider/model pair plus the effective selection.
 */
@Remote async treatmentModels(): Promise<TreatmentCatalog>

/**
 * Choose the model treatments use.
 * @param provider - provider route; empty with an empty model follows the default.
 * @param model - model id under that provider; empty only with an empty provider.
 */
@Remote async setTreatmentModel(provider: string, model: string): Promise<void>

/**
 * The book's table of contents.
 * @param bookId - the book to read.
 * @returns TOC entries resolved onto chapter indexes.
 */
@Remote async toc(bookId: string): Promise<TocEntry[]>

/**
 * One sanitized chapter body.
 * @param bookId - the book to read.
 * @param chapterIndex - spine index of the chapter.
 * @returns the chapter with resource references on the Fetch route.
 */
@Remote async chapter(bookId: string, chapterIndex: number): Promise<ChapterDoc>

/**
 * Save the reading position of one book.
 * @param bookId - the book being read.
 * @param progress - chapter index and scrolled ratio.
 */
@Remote async saveProgress(bookId: string, progress: BookProgress): Promise<void>

/**
 * The saved highlights of one book.
 * @param bookId - the book being read.
 * @returns every annotation of the book.
 */
@Remote async annotations(bookId: string): Promise<Annotation[]>

/**
 * Persist one highlight, creating or replacing by id.
 * @param bookId - the book being read.
 * @param annotation - the complete annotation record.
 */
@Remote async saveAnnotation(bookId: string, annotation: Annotation): Promise<void>

/**
 * Delete one highlight.
 * @param bookId - the book being read.
 * @param annotationId - the annotation to remove.
 */
@Remote async deleteAnnotation(bookId: string, annotationId: string): Promise<void>

/**
 * Treat one selection with the LLM service, streaming text deltas.
 * @param request - the selection, its kind, and its paragraph context.
 * @param signal - Client cancellation for the whole stream.
 * @returns an async iterator over the explain chunks.
 * @yields one meta chunk, text deltas, then a done chunk.
 */
@Remote({ mode: 'stream' }) async *explain(request: ExplainRequest, signal: AbortSignal): AsyncIterable<ExplainChunk>

/**
 * Answer `GET ${RESOURCE_PATH}?book=<id>&path=<interior>` with one book resource.
 * @param request - the incoming GET request.
 * @returns the resource response, or a 400/404 error response.
 */
async serveResource(request: Request): Promise<Response>
```

Source: [`packages/experimental/epub-reader/src/index.ts`](../../packages/experimental/epub-reader/src/index.ts)
<!-- END GENERATED cordis-surface -->
