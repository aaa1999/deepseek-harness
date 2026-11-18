---
description: "Host service that keeps a PDF library, serves books and annotations to the browser, and streams selection or screenshot treatments through the LLM service."
kind: "package-reference"
---

# @deepseek-ai/dsh-pdf-reader

English | [中文](README.zh.md)

## Summary

Keep a PDF library on the Host and read it from the browser. Import files, resume where you stopped, and keep text highlights and screenshot questions beside each book. Selected text can be translated or explained, and a page region can be asked about as an image; answers stream back and persist with their selections. Treatments run as separate model requests through the LLM service. The browser half is `dsh-client-ui-pdf-reader`, and `dsh-pdf-reader-bundle` composes both.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service when a composition needs stored PDFs that a browser panel renders and annotates. The browser panel [`dsh-client-ui-pdf-reader`](../client-ui-pdf-reader/README.md) mounts the Remote namespace this service publishes; [`dsh-pdf-reader-bundle`](../pdf-reader-bundle/README.md) composes both with a working model route. The library, progress, and annotations work without any treatment model; treatments additionally need a resolvable provider and model.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-pdf-reader'
```

| Field | Default | Meaning |
|---|---|---|
| `dataRoot` | `''` | Library root; empty resolves beside the running profile (`<profile>/.pdf-reader`, else `<home>/pdf-reader`) |
| `maxPdfBytes` | `100 MiB` | Largest imported file; the ceiling is 1 GiB |
| `targetLanguage` | `简体中文` | Answer language name used verbatim in treatment prompts |
| `provider` / `model` | `''` | Text-treatment override; the empty pair follows the profile default model |
| `shotProvider` / `shotModel` | `''` | Screenshot-question override; the model must accept image input |
| `maxOutputTokens` | `2048` | Answer budget per treatment, from 64 to 131072; thinking models request it plus 8192 tokens of headroom |

The browser lists, imports, and removes books, reads the stored bytes for its own PDF.js parse, reports the resolved structure and a rendered cover after the first open, and saves reading positions and annotations. Selection treatments and screenshot questions stream text deltas back. The settings panel can move the library directory and choose both model pairs at runtime through the profile's config-editor service; profiles without that service report the failure instead.

### Storage and images

Books live under the resolved data root, one directory per book holding the original file, metadata, progress, annotations, the cover thumbnail, and every stored screenshot crop. Covers and crops are served to the browser over two Host Fetch routes with sandboxed response headers; a crop is immutable per annotation id and changes identity when regenerated.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller extends `TypertRemoteService` under the `pdfReader` Remote namespace and declares typed `pdf/*` failures for not-found, bad-file, size, request, model-resolution, and stream errors. Imports validate the `%PDF-` header and size before the store writes anything; structure beyond that is reported by the browser's first-open parse.

Treatments call `ctx.llm.stream` directly. Model resolution takes the configured pair, else the profile default model; screenshot questions require a vision-capable model and fail with `pdf/no-vision-model` otherwise. A thinking model is requested at the adapter's default reasoning effort, else the mildest supported level, and its output ceiling is raised by 8192 tokens because reasoning and the answer share one output limit on several OpenAI-compatible endpoints. Screenshot crops are stored through the attachment service before entering the request as image content.

Runtime storage and model changes are config edits: the service patches its own plugin entry through the config-editor face it mirrors locally, so no dependency on that package is carried.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Controller, config schema, Fetch routes |
| [`src/store.ts`](src/store.ts) | Durable per-book storage layout |
| [`src/prompts.ts`](src/prompts.ts) | Treatment and screenshot prompt templates with clipping caps |
| [`src/types.ts`](src/types.ts) | Wire types shared with the browser client |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser reader panel](../client-ui-pdf-reader/README.md) — the panel that mounts this service.
- [PDF reader bundle](../pdf-reader-bundle/README.md) — the composed profile layer.
- [Web capture relay](../client-ui-web-capture/README.md) — files browser snapshots into this library.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

### Selection treatments

#### What the model sees

Each `explain` call sends one separate request outside the agent conversation: a Chinese treatment prompt naming the book and page, then a user message holding the selected text clipped to `2000` characters with optional page context clipped to `1500`. Translate asks for a faithful rendering into the configured `targetLanguage`; explain asks for a four-part reading covering meaning, structure, usage, and background.

##### Translate prompt template

```markdown
你是一位忠于原作的翻译。读者正在阅读书名《书名》，第 12 页的 PDF，会给你一段选中的原文及其上下文。
把选段翻译成目标语言：忠实原意，保留语气、修辞与人称；术语按文档领域惯用译法。
只输出译文本身，不要加注释、标题或原文重复。
```

#### Token effect

Selection and context clipping bounds each request's input. The answer is capped by `maxOutputTokens` (default 2048); a thinking model requests that budget plus 8192 tokens of headroom, capped at 131072.

#### KV Cache effect

Each treatment is a standalone request that shares no prefix with agent-conversation requests. Nothing is cached deliberately; a repeated treatment kind reuses only the provider's own prefix caching over its short prompt.

### Screenshot questions

#### What the model sees

Each `askImage` call sends one separate request: the cropped page region as a PNG image input, stored through the attachment service, plus a question clipped to `2000` characters. An empty question asks the model to explain the crop in the configured `targetLanguage`. The resolved model must accept image input; a non-vision selection fails with `pdf/no-vision-model` before any request is sent.

##### Screenshot prompt template

```markdown
你是读者的 PDF 阅读助手。读者正在阅读书名《书名》，第 12 页，从页面上截取了一块区域发给你，并附有一个问题。
读取截图中的文字与图形，用目标语言回答问题。截图里是外文时，翻译要完整准确；问题开放时，解释要具体、贴合这页内容。
```

#### Token effect

Each request carries the crop's image tokens plus the clipped question; the answer budget and thinking headroom follow the text-treatment rules.

#### KV Cache effect

Crops and questions differ per ask, so requests share no deliberate prefix, and nothing reuses the agent conversation's prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Import validates only the `%PDF-` header; structural damage surfaces when the browser first opens the file, and encrypted PDFs remain unreadable.
- Selection treatments need selectable text; scanned pages without a text layer support only screenshot questions.
- Prompt book-and-page lines and page labels are Chinese regardless of interface locale; `targetLanguage` names the answer language only.
- Runtime storage and model changes require the profile's config-editor service; profiles without it answer those calls with `pdf/invalid-request`.
- Uploaded covers are capped at 4 MiB and crops at 8 MiB of PNG, independently of `maxPdfBytes`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
