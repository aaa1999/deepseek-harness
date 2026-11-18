---
description: "Host service that keeps an EPUB library, serves sanitized chapters to the browser, and streams selection treatments through the LLM service."
kind: "package-reference"
---

# @deepseek-ai/dsh-epub-reader

English | [中文](README.zh.md)

## Summary

Keep an EPUB library on the Host and read it from the browser. Import books, resume where you stopped, and keep highlights beside each book. Selected text can be translated or explained; answers stream back and persist with the highlight. Chapters reach the browser sanitized through a strict allowlist, with images and fonts served from the book itself. Treatments run as separate model requests through the LLM service. The browser half is `dsh-client-ui-epub-reader`, and `dsh-epub-reader-bundle` composes both.

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

Mount this service when a composition needs stored EPUBs that a browser panel renders and annotates. The browser panel [`dsh-client-ui-epub-reader`](../client-ui-epub-reader/README.md) mounts the Remote namespace this service publishes; [`dsh-epub-reader-bundle`](../epub-reader-bundle/README.md) composes both with a working model route. The library, progress, and annotations work without any treatment model; treatments additionally need a resolvable provider and model.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-epub-reader'
```

| Field | Default | Meaning |
|---|---|---|
| `dataRoot` | `''` | Library root; empty resolves beside the running profile (`<profile>/.epub-reader`, else `<home>/epub-reader`) |
| `maxBookBytes` | `50 MiB` | Largest imported archive; the ceiling is 256 MiB |
| `targetLanguage` | `简体中文` | Answer language name used verbatim in treatment prompts |
| `provider` / `model` | `''` | Treatment override; the empty pair follows the profile default model |
| `maxOutputTokens` | `2048` | Answer budget per treatment, from 64 to 131072; thinking models request it plus 8192 tokens of headroom |

The browser lists, imports, and removes books, reads the table of contents and sanitized chapter bodies, and saves reading positions and highlights. Selection treatments stream text deltas back. The settings panel can move the library directory and choose the treatment model at runtime through the profile's config-editor service; profiles without that service report the failure instead.

### Storage and resources

Books live under the resolved data root, one directory per book holding the original archive, its extracted content, parsed structure, progress, and highlights. Chapter images and fonts are served to the browser over one Host Fetch route with sandboxed response headers, restricted to the media types the sanitizer serves; book content is immutable per import.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller extends `TypertRemoteService` under the `epubReader` Remote namespace and declares typed `epub/*` failures for not-found, bad-file, size, request, model-resolution, and stream errors. Import decodes the archive, parses container, package document, and spine with `fast-xml-parser`, and extracts members with `fflate`; an archive that does not yield a usable structure fails with `epub/bad-file`.

Every chapter document is untrusted external content and passes a strict sanitizer before it reaches the browser: an allowlist of kept tags and attributes, removal of script, style, form, and media-control subtrees, dropping of references to resources the book does not carry, and rewriting of kept image references onto the resource Fetch route. Interior paths are resolved below the book's content directory with escape rejection.

Treatments call `ctx.llm.stream` directly. Model resolution takes the configured pair, else the profile default model. A thinking model is requested at the adapter's default reasoning effort, else the mildest supported level, and its output ceiling is raised by 8192 tokens because reasoning and the answer share one output limit on several OpenAI-compatible endpoints. Runtime storage and model changes patch the plugin's own config entry through the config-editor face mirrored locally.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Controller, config schema, resource route |
| [`src/epub.ts`](src/epub.ts) | Pure EPUB structure parsing over an in-memory file map |
| [`src/sanitize.ts`](src/sanitize.ts) | Chapter allowlist sanitizer and served media types |
| [`src/store.ts`](src/store.ts) | Durable per-book storage layout |
| [`src/prompts.ts`](src/prompts.ts) | Treatment prompt templates with clipping caps |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser Reading panel](../client-ui-epub-reader/README.md) — the panel that mounts this service.
- [EPUB reader bundle](../epub-reader-bundle/README.md) — the composed profile layer.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

### Selection treatments

#### What the model sees

Each `explain` call sends one separate request outside the agent conversation: a Chinese treatment prompt naming the book and chapter, then a user message holding the selected text clipped to `2000` characters with the surrounding paragraph clipped to `1500`. Translate asks for a faithful literary rendering into the configured `targetLanguage`; explain asks for a four-part reading covering meaning, grammar, usage, and background.

##### Translate prompt template

```markdown
你是一位忠于原作的文学翻译。读者正在阅读书名《书名》，章节「章节名」，会给你一段原文选段及其所在段落。
把选段翻译成目标语言：忠实原意，保留语气、修辞与人称；诗歌保留分行。
只输出译文本身，不要加注释、标题或原文重复。
```

#### Token effect

Selection and paragraph clipping bounds each request's input. The answer is capped by `maxOutputTokens` (default 2048); a thinking model requests that budget plus 8192 tokens of headroom, capped at 131072.

#### KV Cache effect

Each treatment is a standalone request that shares no prefix with agent-conversation requests. Nothing is cached deliberately; a repeated treatment kind reuses only the provider's own prefix caching over its short prompt.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Import requires a parseable EPUB whose container, package document, and spine resolve; anything else fails with `epub/bad-file` before extraction completes.
- The sanitizer keeps only allowlisted tags and attributes and serves only the declared image and font media types; scripts, styles, forms, and other embedded content never reach the browser.
- Treatments are text-only; there is no screenshot or image path.
- Prompt book-and-chapter lines are Chinese regardless of interface locale; `targetLanguage` names the answer language only.
- Runtime storage and model changes require the profile's config-editor service; profiles without it answer those calls with `epub/invalid-request`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
