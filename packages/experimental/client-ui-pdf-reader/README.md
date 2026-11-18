---
description: "Browser PDF panel: bookshelf, single-page reader with highlights, streaming note cards, and screenshot questions served by the Host library."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pdf-reader

English | [中文](README.zh.md)

## Summary

Read PDFs inside the Harness sidebar. The panel keeps a bookshelf with covers and reading progress, and opens books in a single-page reader with outline jumps, zoom, and scroll or flip modes. Select text to translate or explain, or drag a page region and ask a vision-capable model about the screenshot; answers stream into note cards and persist as highlights. The Host library service `dsh-pdf-reader` owns storage and every model request; `dsh-pdf-reader-bundle` composes the pair.

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

Install [`dsh-pdf-reader-bundle`](../pdf-reader-bundle/README.md) into a Web profile and the sidebar gains the PDF entry. The panel is experimental and registers nothing until the current session may read the library.

### Read and manage books

Import by click or drag; the shelf lists each document with its page count, cover, saved progress, and removal with confirmation. Web-capture imports show the snapshot date under the title. The reader shows one page at a time: step or jump pages, pick an outline destination, zoom with buttons or Ctrl/⌘ plus scroll, and switch between scrolling a width-fit page and flipping height-fit pages. Reading position, reading mode, and pen color persist per browser.

### Annotate and treat selections

Select text and the context menu offers Highlight, Translate, and Explain. Highlight stores a plain marker without any model call, in one of five colors; the pen color applies to new highlights and recolors saved ones. Translate and Explain stream a treatment into the notes column and save it on the highlight; cards can locate their page, copy text, regenerate, or delete. On pages without selectable text, the hint points to the screenshot tool.

### Ask about screenshot regions

Click the scissors button or press S, drag a region on the page (dragging to an edge auto-scrolls, Esc cancels), type a question or use the Explain and Translate-text quick actions, and send. The ask popover lists vision-capable models plus the configured pair; the answer streams into a card that keeps the stored crop, the question, and can be regenerated or deleted.

### Set storage and models

The shelf's settings panel shows the resolved library directory and moves it to an absolute path when the profile allows, and picks the treatment and screenshot models from the routable catalog. Both empty selections follow the profile default model; the screenshot pair must accept images.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry mounts the `pdfReader` Remote namespace, then registers the sidebar entry, the main panel, and the selection context-menu target while Remote access for `pdfReader/list` holds. A controller owns one snapshot store per plugin lifetime and debounces progress saves. Rendering runs on PDF.js in a dedicated Worker loaded from a package-local chunk; a Worker failure fails the open instead of falling back to main-thread parsing. The first open reports the resolved structure and a rendered cover to the Host. The web-capture relay lands its imports through the `dsh-pdf-reader:open` window event.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser entry: Remote mount, panel and menu registration |
| [`src/client/controller.ts`](src/client/controller.ts) | Reader state store and Remote actions |
| [`src/client/ReaderView.tsx`](src/client/ReaderView.tsx) | Single-page reader, highlights, screenshot capture |
| [`src/client/pdf/runtime.ts`](src/client/pdf/runtime.ts) | PDF.js Worker session and cleanup |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [PDF library service](../pdf-reader/README.md) — the Host half that stores books and streams treatments.
- [PDF reader bundle](../pdf-reader-bundle/README.md) — the composed profile layer.
- [Web capture relay](../client-ui-web-capture/README.md) — files browser snapshots into this shelf.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host library service: Translate, Explain, and screenshot asks become separate model requests `dsh-pdf-reader` owns, and this panel registers no tool, prompt, or Session event.

#### KV Cache effect

Panel actions add no request prefix; every treatment request and its model routing belong to the Host service.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Rendering runs on one PDF.js Worker per open document; a Worker startup failure fails that open with no main-thread fallback, and encrypted PDFs cannot be opened.
- Screenshot questions need a vision-capable model; the ask popover lists only vision-flagged entries.
- The panel is experimental and Web-platform only, and depends on the Host service for every stored byte; it renders nothing stand-alone.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
