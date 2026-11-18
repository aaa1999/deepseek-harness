---
date: 2026-11-08
branch: dev
status: in progress
---

# PDF reader plugin · design plan

English | [中文](plan-20261108-pdf-reader.zh.md)

## 1. Goals and scope

Build a DSH composition bundle plugin `dsh-pdf-reader`: import PDF → bookshelf → single-page reading. The core is two annotation loops:

- **Text loop** (aligned with the epub plugin): select text in the text layer → right-click "Translate / Explain" → streams into the right pane → highlight persistence + highlight re-rendering in the body text
- **Screenshot loop** (new): a built-in screenshot tool drag-selects a region on the page → crops it into an image → sends it with a question to a vision model → streaming answer + persisted screenshot card
- **Model selection**: the text model and the screenshot model are specified separately; left empty they follow the default
- **Workspace**: importing copies into the plugin-managed directory (same as epub), and the storage directory can be specified in the panel settings

The v1 scope covers the bookshelf (import/delete/progress), single-page reading (TOC bookmarks, previous/next page, page jump, zoom, progress memory), selection translate/explain (streaming), screenshot region-select questioning (streaming), and annotation persistence and review. Out of scope for now: continuous scrolling, two-page tiling, annotation export, form filling, and annotation search (listed as upgrade paths).

## 2. Interaction design

### 2.1 Entry and layout

The entry matches epub: a new left-sidebar panel (`sidebar.panellist` + main slot, `PANEL_ID = 'pdfReader'`), with bookshelf / reading as the two internal view levels.

```text
┌─ 阅读视图（单页两栏）────────────────────────────────┐
│ ☰ 目录   书名 · 第 12/240 页   − 100% +   ✂截图   ⟳  │
├──────────────────────────────────┬──────────────────┤
│                                  │ 标注栏            │
│     单页 canvas 渲染              │ ┌──────────────┐ │
│     （上叠透明文本层供选词，        │ │ 划线卡片       │ │
│       已存划线 <mark> 高亮）       │ │ ▸翻译 ▸解释    │ │
│                                  │ ├──────────────┤ │
│   划词后右键：翻译 / 解释          │ │ 截图卡片       │ │
│                                  │ │ [缩略图]       │ │
│   ✂ → 十字框选 → 原位浮出         │ │ 问题 + 流式回答 │ │
│       提问框（Enter 发送）        │ └──────────────┘ │
├──────────────────────────────────┴──────────────────┤
│   ◀ 上一页    12 / 240 [跳页]    下一页 ▶    进度 5%  │
└──────────────────────────────────────────────────────┘
```

Interaction details:

- **Selection → right-click**: `ContextMenuTargetMap` gains the target family `pdfSelection` with the menu items "Translate" and "Explain", the same shape as epub.
- **Screenshot tool**: the toolbar ✂ button (shortcut S) enters region-select mode, the cursor turns into a crosshair, and a rectangle is dragged across the page; on release, a question box pops out in place — an input plus quick actions (explain the content / translate the text in the image / ask freely), Enter sends, Esc cancels. The crop is converted back to the page's original coordinates at the current zoom and outputs PNG at 2× devicePixelRatio.
- **Two annotation-pane card kinds**: text cards (source quote + translate/explain tabs streaming, as in epub) + screenshot cards (thumbnail + question + streaming answer + regenerate/copy/delete/jump back to that page).
- **Re-rendering**: text highlights get an underline-style weak highlight in the text layer; screenshot annotations show a count badge on the corresponding page's toolbar corner, and hovering a card smoothly jumps to that page.
- **Progress**: the page number auto-saves with debounce; the bookshelf shows progress, and opening a book resumes reading directly.
- Responsiveness and accessibility match epub: the annotation pane collapses into a drawer in a narrow panel, reduced-motion is respected, and everything is keyboard accessible.

### 2.2 Visual direction

Continues epub's "body content first, UI chrome receding": the PDF page carries its own white ground, and the panel uses a neutral gray ground to set off the page shadow, producing the physical feel of "paper"; the annotation pane is quiet note paper; the global accent color goes to exactly one place — shared by the highlight color and the screenshot rectangle.

## 3. Overall architecture

A three-package structure, fully aligned with the epub-reader trio:

```text
pdf-reader（Host 半区，Node）
│  PdfReaderController（TypertRemoteService, namespace 'pdfReader'）
│   ├─ @Remote：导入(复制+校验)/列表/删书/取目录/进度/标注 CRUD
│   ├─ @Remote：pdfBytes(bookId) → Uint8Array（binary transfer）
│   ├─ @Remote({mode:'stream'}) explain()：文本翻译/解释（同 epub）
│   ├─ @Remote({mode:'stream'}) askImage()：截图+问题 → 图片入附件库 → vision 流式
│   └─ inject: ['llm']；存储 profile 下 .pdf-reader/books/<id>/
│
client-ui-pdf-reader（浏览器半区）
│  ├─ sidebar 面板 + main slot（书架/阅读）
│  ├─ pdf.js：owned Worker + canvas 渲染 + TextLayerBuilder 文本层
│  │        （复用仓库 ui-sidebar-documentpreview 已验证的 Worker 模式）
│  ├─ 选区 → ctx.contextMenus（pdfSelection）
│  ├─ 截图小工具：单页 canvas 框选 → 离屏 canvas 裁剪 → PNG bytes
│  └─ dsh.client.inject: ui-sidebar / ui-layout / ui-context-menu / locale / api-remotes
│
pdf-reader-bundle（组合包）
   └─ cordis.patch.yml：host 服务行 + client UI 行（含模型默认值）
```

Data flow:

- **Text**: select text in the text layer → right-click → `ctx.remote.pdfReader.explain()` → the Host assembles the prompt (the selection + page context + book title and page number) → `ctx.llm.stream` → streamed back → card rendering → `saveAnnotation` persists it.
- **Screenshot**: drag-select → crop to PNG → `ctx.remote.pdfReader.askImage()` (the bytes travel as a binary argument) → the Host runs `ctx.attachments.saveImage` → `ctx.llm.stream` (image block + question) → streamed back → screenshot card → persisted.

## 4. Key technical decisions

| # | Decision | Rationale and basis |
|---|---|---|
| 1 | **PDF parsing and rendering stay entirely in the browser** (pdfjs-dist 6.x); the Host only stores bytes | pdf.js is a browser library and its text layer natively supports selection; `ui-sidebar-documentpreview` has already validated the owned-Worker + TextLayerBuilder route, a mature in-repo reference |
| 2 | **Importing copies** into the plugin-managed directory, and the storage directory is settable in the panel | Confirmed to follow the epub-style import; reuses the existing EpubStore + `saveStorageSettings` conventions |
| 3 | **PDF bytes are delivered via Remote binary**, with no Fetch resource route (except first-page thumbnails) | The Typert protocol natively supports Uint8Array binary; the book already sits in the managed directory, so there is no path-traversal surface |
| 4 | **Single-page paging** | Confirmed; the render window is always one page, keeping memory under control; the screenshot region geometry stays within single-page coordinates, simple and reliable |
| 5 | **Text anchoring = page number + plain-text offset within the page** + a quote-hash fallback | The epub plain-text-offset scheme adapted per page; stable across zoom and re-rendering; a mismatch degrades to note-only, without re-location |
| 6 | **Screenshots go through `ctx.attachments.saveImage` → ImageBlock** | The repo's only supported image input path (an ImageBlock must hold an attachment reference); no raw base64 |
| 7 | **Two model configurations**: text `provider/model` + screenshot `shotProvider/shotModel` | Screenshots need vision; the model list is filtered by `inputModalities`; left empty they follow agentDefaultModel, and when images are unsupported an explicit error code is returned with guidance to the settings |
| 8 | **Guardrails**: ≤100MB, magic-bytes validation, explicit errors for encrypted/broken files; pages without a text layer point to the screenshot tool | Scanned PDFs are precisely the screenshot tool's core scenario |

## 5. Data model and Remote API

```ts
interface PdfBookRow { bookId: string; title: string; pageCount: number; coverUrl: string /* 首页缩略图 */; outline: { title: string; page: number }[]; progress: { page: number }; importedAt: string }
interface PdfTextAnnotation { id: string; bookId: string; page: number; start: number; end: number /* 页内文本偏移 */; quote: string; createdAt: string;
                           results: { kind: 'translate' | 'explain'; text: string; model: string; createdAt: string }[] }
interface PdfShotAnnotation { id: string; bookId: string; page: number; rect: { x: number; y: number; w: number; h: number } /* 页面归一坐标 */; imageUrl: string;
                           question: string; answer: { text: string; model: string; createdAt: string }; createdAt: string }
```

| Remote method | Form | Notes |
|---|---|---|
| `list()` / `importBook(name, bytes)` / `removeBook(id)` | unary | Importing copies and validates immediately; page count/TOC are extracted on the Host with lightweight parsing |
| `pdfBytes(bookId)` | unary·binary | The full PDF bytes for the browser's pdf.js |
| `saveProgress` / `listAnnotations` / `saveTextAnnotation` / `saveShotAnnotation` / `deleteAnnotation` | unary | Persistence |
| `explain(bookId, page, kind, text, signal)` | **stream** | meta / delta / done, as in epub |
| `askImage(bookId, page, rect, pngBytes, question, signal)` | **stream** | meta / delta / done |

Error codes: `pdf/not-found`, `pdf/bad-file`, `pdf/too-large`, `pdf/encrypted`, `pdf/no-text-layer`, `pdf/no-vision-model`, `pdf/explain-failed`.

## 6. Prompt design

- Translate/explain: reuse the epub templates (book title, page number, surrounding-context truncation protection, and the over-long-selection switch to the whole-paragraph strategy).
- Screenshot: the default question is "Explain the content of this PDF screenshot", the quick action "Translate the text in the image", with free-form questions supported; the prompt carries book-title/page-number metadata.

## 7. Plugin config

```yaml
dataRoot: ''
targetLanguage: 简体中文
provider / model: ''
shotProvider / shotModel: ''
maxPdfBytes: 100MB
maxSelectionChars: 2000
maxOutputTokens: 2048
```

## 8. Package structure and delivery

The three packages `pdf-reader` / `client-ui-pdf-reader` / `pdf-reader-bundle` align fully with the epub-reader trio in package structure, test layout (fixture parsing/anchoring/controller + client component tests, with the LLM behind a mock adapter), and packaged delivery (`dsh plugin add`).

## 9. Implementation stages

| Stage | Content | Output |
|---|---|---|
| M1 | Host: import-copy/storage/bytes/TOC Remote; client bookshelf, single-page pdf.js rendering, paging/zoom/page jump, progress memory | Books can be imported and read |
| M2 | Text-layer selection → right-click → streaming explain → annotation cards + highlight persistence and re-rendering | Text loop |
| M3 | Screenshot-tool region select + question box → streaming askImage → screenshot cards; model-selection UI (vision filtering); storage-directory settings, i18n, accessibility, test completion, packaging verification | Deliverable |

Risks and alternatives: scanned PDFs without a text layer (the screenshot path is the fallback — and precisely the selling point); oversized PDFs (the single-page window + lazy TOC parsing keep it controlled); the vision model being unavailable (explicit error code + settings guidance).

## Confirmed decisions (2026-11-08)

- Workspace: importing copies as in epub (the storage directory can be set in the panel settings).
- Reading mode: single-page paging.
- Screenshot default action: pop the question box first.
- Workspace: developed inside the DSH source repo (/Users/lwc/Desktop/code/github/deepseek-harness, dev branch).
