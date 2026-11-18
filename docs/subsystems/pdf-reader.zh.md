# PDF 阅读

[English](pdf-reader.md) | 中文

实验性 PDF 阅读在 Host 上保存书库并从浏览器阅读：[Host 服务](../../packages/experimental/pdf-reader/README.zh.md)负责存储与处理，[浏览器面板](../../packages/experimental/client-ui-pdf-reader/README.zh.md)用 PDF.js 渲染页面，[可选 Bundle](../../packages/experimental/pdf-reader-bundle/README.zh.md)组合两者。

## 书库与阅读

`list()` 把每本可读的书作为一个 `BookRow` 返回（其中的 `BookProgress` 携带保存的 1 起始页码）；`importBook()` 校验 `%PDF-` 头与大小后，把原始文件存入每书一个目录。浏览器自行取回存储字节（`PdfBytes`），用 PDF.js 解析，并把解析出的结构——标题、页数、大纲——作为 `MetaReport` 回报，同时上传渲染出的封面缩略图。进度与标注的读写走同一个 Remote 命名空间。

## 标注与处理

`PdfAnnotation` 或是文本划线（`TextAnnotation` 以页纯文本流的偏移定位，用某种 `HighlightColor` 着色），或是锚定在页面矩形上的截图提问。选中文字经 `ExplainRequest` 驱动的 `TreatChunk` 流式响应翻译或解释；页面区域经 `AskImageRequest` 作为图片提问，要求支持视觉输入的模型。两类回答都流式返回并随标注保存。处理请求通过 LLM 服务以独立模型请求发出；书库、进度与标注不依赖任何处理模型。

封面与截图裁块经两条 Host Fetch 路由以沙箱化响应头提供给浏览器；每个标注 id 的裁块不可变。设置面板在运行时通过 profile 的 config-editor 服务迁移书库目录并选择两对模型。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
