# PDF reader

English | [中文](pdf-reader.zh.md)

Experimental PDF reading keeps a library on the Host and reads it from the browser: the [Host service](../../packages/experimental/pdf-reader/README.md) owns storage and treatments, the [browser panel](../../packages/experimental/client-ui-pdf-reader/README.md) renders pages through PDF.js, and the [optional bundle](../../packages/experimental/pdf-reader-bundle/README.md) composes both.

## Library and reading

`list()` returns every readable book as a `BookRow` (`BookProgress` inside carries the saved 1-based page); `importBook()` validates the `%PDF-` header and size, then stores the original file under one directory per book. The browser fetches the stored bytes itself (`PdfBytes`), parses them with PDF.js, and reports the resolved structure back as a `MetaReport` — title, page count, and outline — together with a rendered cover thumbnail. Reads and writes of progress and annotations go through the same Remote namespace.

## Annotations and treatments

A `PdfAnnotation` is either a text highlight (`TextAnnotation` offsets into the page's plain-text stream, painted in a `HighlightColor`) or a screenshot question anchored to a page rectangle. Selected text is translated or explained through streamed `TreatChunk` responses driven by an `ExplainRequest`; a page region is asked about as an image through `AskImageRequest`, which requires a vision-capable model. Both answers stream back and persist with their annotation. Treatments run as separate model requests through the LLM service; the library, progress, and annotations work without any treatment model.

Covers and screenshot crops are served to the browser over two Host Fetch routes with sandboxed response headers; a crop is immutable per annotation id. The settings panel moves the library directory and chooses both model pairs at runtime through the profile's config-editor service.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpdfreadercontroller--pdfreadercontroller"></a>

### `ctx.pdfReaderController` — `PdfReaderController`

The browser-facing library service. Files, progress, and annotations live on the Host; the browser parses and renders with PDF.js and streams treatments.

```ts cordis-catalog
/**
 * List the library.
 * @returns every readable book as a shelf row, newest import first.
 */
@Remote async list(): Promise<BookRow[]>

/**
 * Import one PDF file.
 * @param fileName - the import's display name.
 * @param pdfBase64 - the file bytes as canonical base64.
 * @param source - the origin record a web capture files beside its PDF, or null.
 * @param signal - Client cancellation.
 * @returns the stored book as a shelf row; page structure reports on first open.
 */
@Remote async importBook(fileName: string, pdfBase64: string, source: ImportSource | null, signal: AbortSignal): Promise<BookRow>

/**
 * Delete one book with all its data.
 * @param bookId - the book to remove.
 */
@Remote async removeBook(bookId: string): Promise<void>

/**
 * The browser's first-open structure report: title, page count, and outline.
 * @param bookId - the book the browser opened.
 * @param report - the PDF.js-resolved structure.
 * @returns the stored book row.
 */
@Remote async saveBookMeta(bookId: string, report: MetaReport): Promise<BookRow>

/**
 * Store the browser-rendered first-page cover thumbnail.
 * @param bookId - the book the thumbnail belongs to.
 * @param pngBase64 - the thumbnail PNG as canonical base64.
 */
@Remote async saveCover(bookId: string, pngBase64: string): Promise<void>

/**
 * The complete stored bytes of one book, for the browser's PDF.js parse.
 * @param bookId - the book to read.
 * @returns the book's PDF bytes.
 */
@Remote async pdfBytes(bookId: string): Promise<PdfBytes>

/**
 * Save the reading position of one book.
 * @param bookId - the book being read.
 * @param progress - the 1-based page the reader last showed.
 */
@Remote async saveProgress(bookId: string, progress: BookProgress): Promise<void>

/**
 * The saved annotations of one book.
 * @param bookId - the book being read.
 * @returns every text highlight and screenshot question of the book.
 */
@Remote async annotations(bookId: string): Promise<PdfAnnotation[]>

/**
 * Persist one annotation, creating or replacing by id.
 * @param bookId - the book being read.
 * @param annotation - the complete annotation record.
 */
@Remote async saveAnnotation(bookId: string, annotation: PdfAnnotation): Promise<void>

/**
 * Delete one annotation with its stored screenshot crop.
 * @param bookId - the book being read.
 * @param annotationId - the annotation to remove.
 */
@Remote async deleteAnnotation(bookId: string, annotationId: string): Promise<void>

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
 * @returns every routable provider/model pair, vision-flagged, plus both selections.
 */
@Remote async treatmentModels(): Promise<TreatmentCatalog>

/**
 * Choose the model text treatments use.
 * @param provider - provider route; empty with an empty model follows the default.
 * @param model - model id under that provider; empty only with an empty provider.
 */
@Remote async setTreatmentModel(provider: string, model: string): Promise<void>

/**
 * Choose the model screenshot questions use; the pair must accept images.
 * @param provider - provider route; empty with an empty model follows the default.
 * @param model - model id under that provider; empty only with an empty provider.
 */
@Remote async setShotModel(provider: string, model: string): Promise<void>

/**
 * Treat one text selection with the LLM service, streaming text deltas.
 * @param request - the selection, its kind, and its page context.
 * @param signal - Client cancellation for the whole stream.
 * @returns an async iterator over the treatment chunks.
 * @yields one meta chunk, text deltas, then a done chunk.
 */
@Remote({ mode: 'stream' }) async *explain(request: ExplainRequest, signal: AbortSignal): AsyncIterable<TreatChunk>

/**
 * Answer one screenshot question, storing the crop and streaming text deltas.
 * @param request - the page region, its PNG, and the question.
 * @param signal - Client cancellation for the whole stream.
 * @returns an async iterator over the treatment chunks.
 * @yields one meta chunk, text deltas, then a done chunk carrying the crop URL.
 */
@Remote({ mode: 'stream' }) async *askImage(request: AskImageRequest, signal: AbortSignal): AsyncIterable<TreatChunk>

/**
 * Answer `GET ${COVER_PATH}?book=<id>` and `GET ${SHOT_PATH}?book=<id>&id=<annotation>` with one stored PNG.
 * @param request - the incoming GET request.
 * @param kind - which image route the request addressed.
 * @returns the PNG response, or a 400/404 error response.
 */
async serveImage(request: Request, kind: 'cover' | 'shot'): Promise<Response>
```

Source: [`packages/experimental/pdf-reader/src/index.ts`](../../packages/experimental/pdf-reader/src/index.ts)
<!-- END GENERATED cordis-surface -->
