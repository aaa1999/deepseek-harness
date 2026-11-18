---
date: 2026-11-07
branch: dev
status: completed
---

# EPUB reader plugin · design plan

English | [中文](plan-20261107-epub-reader.zh.md)

## 1. Goals and scope

Build a DSH composition bundle plugin `dsh-epub-reader`: import EPUB → bookshelf → immersive reading; books in the left pane, notes in the right pane. The core loop is **select text → right-click "Translate / Explain" → the result streams into the right pane and settles into a highlight note you can revisit**.

The v1 scope covers the bookshelf (import/delete/progress), chapter reading (table of contents, previous/next chapter, progress memory), selection translate/explain (streaming LLM output), and highlight persistence with highlight re-rendering in the body text. Out of scope for now: full book-CSS fidelity, two-page tiled pagination, TTS, and note export (listed as upgrade paths).

## 2. Interaction design

### 2.1 Entry and layout

The entry is a new panel in the left sidebar (a peer of Files / Plugins, registered into `sidebar.panellist`, wide-panel mode). The panel has two internal view levels:

```text
┌─ 书架 ──────────────────────────────────────────────┐
│  ＋导入 EPUB（点击/拖拽）                              │
│  ┌────┐ ┌────┐ ┌────┐                                 │
│  │封面 │ │封面 │ │封面 │   书名 · 作者 · 进度% · 继续读    │
│  └────┘ └────┘ └────┘                                 │
└──────────────────────────────────────────────────────┘

┌─ 阅读视图（两栏）─────────────────────────────────────┐
│ ☰ 目录   书名 / 章节名              ⟳ ⟶ 返回书架        │
├──────────────────────────────┬──────────────────────┤
│                              │ 笔记栏                │
│   正文阅读栏                  │ ┌──────────────────┐ │
│   （衬线字体，行长 ≤ 72 字符，   │ │ 原文引用          │ │
│     段落呼吸感，可调字号）       │ │ ▸ 翻译（流式…）    │ │
│                              │ │ ▸ 解释            │ │
│   划词后右键：                 │ └──────────────────┘ │
│   ┌───────────────┐          │ ┌──────────────────┐ │
│   │ 翻译    解释    │ ←菜单     │ │ 更早的划线…       │ │
│   └───────────────┘          │ └──────────────────┘ │
│                              │ 悬停卡片 → 正文滚动定位  │
├──────────────────────────────┴──────────────────────┤
│  ◀ 上一章   第 3 / 42 章   下一章 ▶      阅读进度 37%   │
└──────────────────────────────────────────────────────┘
```

Interaction details:

- **Selection → right-click**: integrate with the existing ui-context-menu by adding a target family `epubSelection` (via `ContextMenuTargetMap` declaration merge) with the menu items "Translate" and "Explain". The same selection can also pop up a lightweight floating button on mouse release (secondary path, v1.1).
- **Right-pane cards**: one highlight = one card, holding the source quote + a tab (Translate / Explain) + the streaming body + actions (regenerate, copy, delete, jump back to the source text). While generating, streaming increments are displayed; on failure, a retryable error row is shown.
- **Highlight re-rendering**: saved highlights render in the left pane as `<mark>` (an underline-style weak highlight that does not compete with reading); hovering a right-pane card smoothly scrolls the body text to the anchor and flashes it once.
- **Progress**: the chapter number plus the in-chapter scroll ratio are saved automatically (2s debounce); the bookshelf shows progress, and opening a book resumes reading directly.
- **Responsive**: when the panel is narrow, the notes pane collapses into a right-side overlay drawer and returns side by side at ≥768px; respects reduced-motion; keyboard accessible (TOC, menus, and card actions are all reachable by Tab/Enter).

### 2.2 Visual direction

The reader is a surface users look at for long stretches, so the visual strategy is **body content first, UI chrome receding**:

- The reading pane uses a serif font stack (`Songti SC / Noto Serif CJK / Georgia, serif`); UI chrome (toolbars, cards, TOC) keeps the host interface font and `--dsh` theme variables and follows dark mode; the body area additionally offers a "paper" reading-background toggle (off-white instead of pure white / dark instead of pure black, reducing long-reading fatigue).
- Right-pane cards are quiet note paper: no heavy shadows, a single radius level, separation by spacing instead of borders; a card with a generation in progress expresses "writing" through a thin top progress line, not a bouncing animation.
- Care is spent in exactly two places: the layout rhythm of the cover bookshelf, and the highlight color (the only accent color, shared by translate and explain to avoid noise).

## 3. Overall architecture

Everything goes through DSH's regular extension points; one package, two runtime halves:

```text
dsh-epub-reader（一个 bundle 包）
│
├─ index.ts ──────── Host 半区（Node）
│   ├─ EpubLibraryService（TypertRemoteService, namespace 'epubReader'）
│   │    ├─ @Remote 方法：导入/列表/删书/取章节/进度/划线 CRUD
│   │    ├─ @Remote({mode:'stream'}) explain()：翻译与解释
│   │    └─ exact Fetch route：/api/epub-reader/resource（图片/字体）
│   ├─ EPUB 解析：fflate 解压 + fast-xml-parser 读 OPF/spine/TOC
│   ├─ 存储：profile 数据目录（.epub-reader/books/<id>/…）
│   └─ inject: ['llm']，经 ctx.llm.stream 调模型
│
└─ client（浏览器半区，package.json 声明 dsh.client）
    ├─ 注册 sidebar.panellist 面板（书架 + 阅读视图）
    ├─ 章节渲染：净化后的 XHTML 注入受控容器 + 自带阅读排版样式
    ├─ 选区处理 → ctx.contextMenus（epubSelection target family）
    ├─ 调 ctx.remote.epubReader.*（api-remotes 生成的客户端面）
    └─ dsh.client.inject: ui-sidebar / ui-layout / ui-context-menu /
       ui-primitives / locale / api-remotes
```

Data flow: select text in the browser → context menu → the client calls `ctx.remote.epubReader.explain()` → the Host assembles the prompt (the selection + the surrounding paragraph context + book title and chapter) → `ctx.llm.stream` → the Remote stream pushes chunks back → the right-pane card renders the stream → on completion the client calls `saveAnnotation` to persist it.

## 4. Key technical decisions

| # | Decision | Rationale and basis |
|---|---|---|
| 1 | **EPUB parsing lives on the Host**; the client receives only sanitized chapter documents | Decompression/OPF/TOC parsing happens once in Node; no binaries enter the browser; `Uint8Array` can travel via binary Remote transfer, resource images via the exact Fetch route |
| 2 | **v1 custom rendering**: sanitized XHTML is injected into the main document container with the plugin's own reading typography, and **book CSS is not loaded** | Selection, Range anchoring, the context menu (`getTriggerProps`), and `<mark>` highlighting all work on native DOM, at the lowest integration cost; the language-learning scenario is mostly text books. Full book-CSS fidelity is deferred to v2 (sandboxed iframe + postMessage bridge) |
| 3 | **Sanitization uses an allowlist** (tags/attributes); the Host emits a sanitized document and the client runs DOMPurify over it again as a second layer | An EPUB is an arbitrary external file and must be treated as untrusted content |
| 4 | **Highlight anchoring = plain-text offset within the chapter** (the offset is computed over concatenated text nodes) + a text-hash fallback | An order of magnitude simpler than EPUB CF and sufficient for v1; remains stable across font-size changes and reflow; on mismatch, falls back to searching for the source text |
| 5 | **The LLM is reached only through `ctx.llm.stream`**, defaulting to `ctx.agentDefaultModel`; plugin config can override provider/model | This is the repo's explicitly documented and only supported call path; no private API key is introduced |
| 6 | **Translate/explain uses `@Remote({mode:'stream'})`** | Token-by-token streaming into the right pane matches the main-conversation experience; the client persists the result to storage when the stream ends |
| 7 | **Storage uses a plugin-managed directory under the profile directory** (`profileContext.dir` + `.epub-reader/`), with JSON metadata and the raw epub stored as separate files | Follows the existing convention of plugin-manager managing `.plugin-manager/` inside the profile; introduces no sqlite dependency |
| 8 | **The resource route carries guardrails**: the path must resolve inside the books directory (path-traversal defense), a Content-Type allowlist, `CSP: sandbox` + `nosniff` + private caching | Matches the security pattern of the plugin-manager detail-file route |

## 5. Data model and Remote API

```ts
// 书
interface BookRow { bookId: string; title: string; author: string; language: string; coverPath?: string; chapterCount: number; progress: { chapterIndex: number; ratio: number }; importedAt: string }
// 章（净化后）
interface ChapterDoc { bookId: string; chapterIndex: number; title: string; html: string /* sanitized, 资源已改写为路由 URL */ }
// 划线
interface Annotation { id: string; bookId: string; chapterIndex: number; start: number; end: number /* 纯文本偏移 */; quote: string; createdAt: string;
                       results: { kind: 'translate' | 'explain'; text: string; model: string; createdAt: string }[] }
```

| Remote method | Form | Notes |
|---|---|---|
| `list()` / `importBook(name, bytes)` / `removeBook(id)` | unary | Importing parses immediately and extracts metadata; ≤100MB |
| `chapter(bookId, index)` | unary | Returns a sanitized ChapterDoc |
| `saveProgress` / `listAnnotations` / `saveAnnotation` / `deleteAnnotation` | unary | Persistence |
| `explain(bookId, chapterIndex, kind, text, signal)` | **stream** | Emits text increments chunk by chunk; the final chunk carries usage/model |

Error codes use the unified `RemoteError` code table: `epub/not-found`, `epub/bad-file`, `epub/too-large`, `epub/anchor-mismatch`, `epub/no-model`.

## 6. Prompt design (Host-side templates, configurable override)

- **Translate**: given the book title, the chapter, and the paragraph containing the source text (at most one paragraph of context on each side, with truncation protection), the instruction is "faithful literary translation, preserving tone and rhetoric, output only the translation". The target language defaults to Chinese and is configurable.
- **Explain**: same context; the output structure is "word/phrase senses → grammatical structure → usage and register → necessary cultural background", aimed at language learners and written in the target language.
- When the selection is over-long (>2000 characters), the prompt switches to a whole-paragraph translation strategy to prevent token blowup.

## 7. Plugin config (Schema)

```yaml
targetLanguage: zh      # 目标语言
provider / model: ''    # 留空跟随 agentDefaultModel
contextParagraphs: 1    # 送入 prompt 的前后段落
maxSelectionChars: 2000
paperMode: auto         # 纸面底色: auto | off
```

## 8. Package structure and development/delivery forms

```text
dsh-epub-reader/
├─ package.json          # dsh.bundle + dsh.client.inject + engines.dsh
├─ cordis.patch.yml      # 两行：host 服务行 + 浏览器行
├─ locale/zh.json en.json
├─ src/
│  ├─ host/  (service.ts, epub/parse.ts, sanitize.ts, store.ts, prompts.ts)
│  └─ client/ (index.ts, Library.tsx, Reader.tsx, NotesPanel.tsx, anchor.ts, store.ts)
└─ tests/ (fixture.epub 解析/净化/锚定单测 + client 组件测试)
```

- Development: from the checkout root, `pnpm dsh web --patch ./dsh-epub-reader/cordis.yml` starts on port 3080; combined with `pnpm run dev:web`, client-plugin edits hot-reload without a refresh.
- Delivery: `dsh plugin add ./dsh-epub-reader` (or publish to npm / install from GitHub); once installed into a profile, the panel takes effect globally.
- Testing: Host unit tests (fixture-book parsing, the sanitization allowlist, path-traversal attack cases, anchor re-location); the client uses `@deepseek-ai/dsh-client-test-runtime`; the LLM path uses a mock adapter.

## 9. Implementation stages

| Stage | Content | Output |
|---|---|---|
| M1 | Host: parsing/storage/Remote + the client bookshelf and reading views, progress memory | Books can be imported and read |
| M2 | Selection → context menu → streaming explain → right-pane cards + highlight persistence and re-rendering | Core loop |
| M3 | TOC drawer, paper mode, i18n, keyboard accessibility, test completion, packaging and install verification | Deliverable |

Risks and alternatives: heavily typeset books degrade visually under v1 custom rendering (the fallback is the v2 iframe bridge); plain-text-offset anchoring can mismatch when a large cross-paragraph selection reflows (hash + search fallback; a mismatched card degrades to note-only, without re-location).

## Confirmed decisions (2026-11-07)

- Workspace: developed inside the DSH source repo (/Users/lwc/Desktop/code/github/deepseek-harness, dev branch).
- v1 rendering: accepted "sanitize + own typography, without loading the book's own CSS".
- Entry: a new left-sidebar panel (a peer of Files/Plugins, globally available).
