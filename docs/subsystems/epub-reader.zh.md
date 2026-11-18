# EPUB 阅读

[English](epub-reader.md) | 中文

实验性 EPUB 阅读在 Host 上保存书库并从浏览器阅读：[Host 服务](../../packages/experimental/epub-reader/README.zh.md)负责存储、净化与处理，[浏览器面板](../../packages/experimental/client-ui-epub-reader/README.zh.md)渲染章节，[可选 Bundle](../../packages/experimental/epub-reader-bundle/README.zh.md)组合两者。

## 书库与章节

`list()` 把每本可读的书作为一个 `BookRow` 返回（其中的 `BookProgress` 携带保存的章节序号与滚动比例）；`importBook()` 解码归档、解析 container、package 文档与 spine，并把成员解压到每书一个目录。`TocEntry` 命名一个大纲目的地；`chapter()` 返回净化后的 `ChapterDoc`——章节 XHTML 及其内部路径。章节图片与字体经一条 Host Fetch 路由从书籍本身提供，限定为净化器允许的媒体类型。

每个章节文档都是不可信的外部内容，到达浏览器前经过严格净化器：保留标签与属性的白名单、移除 script、style、form 与媒体控制子树、丢弃指向书籍未携带资源的引用，并把保留的图片引用改写到资源 Fetch 路由。内部路径解析限制在书籍内容目录之下并拒绝逃逸。

## 划线与处理

`Annotation` 以章节纯文本流的 `[start, end)` 偏移锚定一条划线，携带引文与已保存的结果。选中文字经流式响应翻译或解释（`ExplainRequest` 驱动的 `ExplainChunk` 增量）；回答随划线保存。处理请求通过 LLM 服务以独立模型请求发出；书库、进度与划线不依赖任何处理模型。设置面板在运行时通过 profile 的 config-editor 服务迁移书库目录并选择处理模型。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
