---
description: "Browser Reading panel: EPUB bookshelf, two-column reader with highlights, streaming note cards, and note capture."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-epub-reader

English | [中文](README.zh.md)

## Summary

Read EPUB books inside the Harness sidebar. The panel keeps a bookshelf with covers and reading progress, and opens books in a two-column reader: chapter prose with adjustable size, paper tint, and serif or sans-serif type on one side, notes on the other. Select text to translate or explain; answers stream into note cards and persist as highlights. Captured quotes and treatments can be filed into the Notes panel. The Host library service `dsh-epub-reader` owns storage and every model request; `dsh-epub-reader-bundle` composes the pair.

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

Install [`dsh-epub-reader-bundle`](../epub-reader-bundle/README.md) into a Web profile and the sidebar gains the Reading entry. The panel is experimental and registers nothing until the current session may read the library.

### Read and manage books

Import by click or drag; the shelf lists each book with its author, chapter count, cover, and saved progress, and removes books with confirmation. The reader shows one sanitized chapter at a time: step between chapters, pick a destination from the contents dropdown, and adjust the prose with zoom, a paper tint, and the serif or sans-serif toggle. The reading position is saved per chapter and scroll ratio; the paper and font choices persist per browser.

### Annotate and treat selections

Select text and the context menu offers Translate, Explain, and Send to notes. Translate and Explain stream a treatment into the notes column and save it on the highlight; cards can locate their text in the chapter, copy text, regenerate, or delete, and hovering a card scrolls back to its highlight. Send to notes files the raw selection, or a saved card with every treatment, into the dsh-notes panel through its same-origin JSON API.

### Set storage and models

The shelf's settings panel shows the resolved library directory and moves it to an absolute path when the profile allows, and picks the treatment model from the routable catalog. The empty selection follows the profile default model.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry mounts the `epubReader` Remote namespace, then registers the sidebar entry, the main panel, and the selection context-menu target while Remote access for `epubReader/list` holds. A controller owns one snapshot store per plugin lifetime and debounces progress saves from the reading column's scroll ratio. Chapter bodies arrive pre-sanitized from the Host; the browser renders them with the reader's own typography and resolves resource references against the Host Fetch route. The notes capture posts to `/plugins/dsh-notes/api` with plain relative fetches and resolves `false` on any failure, so the reader continues when that panel is absent.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser entry: Remote mount, panel and menu registration |
| [`src/client/controller.ts`](src/client/controller.ts) | Reader state store and Remote actions |
| [`src/client/ReaderView.tsx`](src/client/ReaderView.tsx) | Two-column reader and highlight rendering |
| [`src/client/notes.ts`](src/client/notes.ts) | Notes-panel JSON API client |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [EPUB library service](../epub-reader/README.md) — the Host half that stores books and streams treatments.
- [EPUB reader bundle](../epub-reader-bundle/README.md) — the composed profile layer.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host library service: Translate and Explain become separate model requests `dsh-epub-reader` owns, and this panel registers no tool, prompt, or Session event.

#### KV Cache effect

Panel actions add no request prefix; every treatment request and its model routing belong to the Host service.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Send to notes depends on the dsh-notes panel being installed; without it the capture fails silently and keeps nothing.
- The reader renders only the sanitized chapters the Host serves; scripts, styles, and unserved media types never appear.
- The panel is experimental and Web-platform only, and depends on the Host service for every stored byte; it renders nothing stand-alone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
