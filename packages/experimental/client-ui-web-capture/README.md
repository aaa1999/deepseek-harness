---
description: "Browser relay and companion Chromium extension that file webpage snapshots into the PDF reader shelf."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-capture

English | [中文](README.zh.md)

## Summary

Turn any webpage into a PDF on the Harness shelf. The bundled Chromium extension captures the page with its screen appearance and a selectable text layer, and the browser relay files the snapshot into the PDF library and opens it there. Pairing needs no configuration: the relay keeps a token in the GUI page's localStorage, and the extension's content script injects it on the GUI origin. The Host library service `dsh-pdf-reader` stores the result; `dsh-web-capture-bundle` composes the whole set.

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

Install [`dsh-web-capture-bundle`](../web-capture-bundle/README.md) into a Web profile so the relay and the PDF reader run together, then load the companion extension once in Chrome: open `chrome://extensions`, enable Developer mode, and load the package's `extension/` directory unpacked. The relay is experimental and answers only while the PDF reader's Remote namespace is mounted.

### Capture a page

Click the extension icon, choose a long page or A4 paper and an optional width override, and capture. Deep capture is on by default and scrolls the page once to trigger lazy-loaded content before printing; canvas and video elements freeze to their current frame. The browser shows its debugging banner while the debugger is attached. On success the GUI switches to the PDF panel and opens the snapshot; the shelf card shows the snapshot date and keeps the source URL. Mode, width, deep capture, and the GUI address persist in the extension.

### How pairing works

The relay mints one random token in the GUI page's localStorage and keeps it across reloads. The extension's content script, registered only on `127.0.0.1` and `localhost` origins, relays capture envelopes between the extension and the GUI page and injects the token as they cross, so the token never leaves the GUI origin. Replies flow back the same way: one receipt per chunk and one terminal result.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry injects the mounted `remote.pdfReader` namespace and the layout service, then answers `window.postMessage` envelopes tagged `dsh-web-capture` for as long as the plugin runs. The `CaptureRelay` class is transport- and framework-free: it validates the typed begin and chunk envelopes, reassembles the base64 body, and files the finished PDF through `pdfReader.importBook` with the page URL and capture time as the origin record. It answers strictly one capture at a time and reports typed failure codes the extension maps to copy.

The extension's service worker performs the capture over the Chrome DevTools protocol: an optional device-metrics width override, a deep-scroll pass bounded to 40 screens, a media freeze that swaps canvas and video for PNG frames, emulated `screen` media, and `Page.printToPDF` with backgrounds, zero margins, and a tagged PDF output that preserves selectable text. Long mode prints one 1:1 page clamped to Chromium's 200-inch side, with taller content paginating onto further tall pages; A4 mode adds break-inside avoidance for media and tables. The base64 body is chunked and delivered with per-chunk receipts; pure planning lives in a shared module the package tests run under plain Node.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser entry: relay scope and message wiring |
| [`src/client/relay.ts`](src/client/relay.ts) | Capture reassembly and library import |
| [`src/client/protocol.ts`](src/client/protocol.ts) | Envelope vocabulary and failure codes |
| [`extension/background.js`](extension/background.js) | CDP capture, freeze, print, and delivery |
| [`extension/shared/capture-params.js`](extension/shared/capture-params.js) | Pure paper, chunking, and scroll planning |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web capture bundle](../web-capture-bundle/README.md) — the composed profile layer.
- [PDF library service](../pdf-reader/README.md) — where snapshots are stored.
- [Browser reader panel](../client-ui-pdf-reader/README.md) — the shelf that receives captures.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

None, as the relay only reassembles extension snapshots and files them into the PDF library; any later treatment request belongs to the Host reader service.

#### KV Cache effect

No effect; filing a snapshot writes storage, not a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The companion extension is Chromium-only (Manifest V3, Chrome 116 or newer); capture attaches the Chrome DevTools protocol debugger, so DevTools open on the target page blocks attachment and the browser shows its debugging banner during capture.
- Long-mode pages taller than Chromium's 200-inch paper side paginate onto several tall pages, and fixed-position elements can repeat across those pages.
- The relay answers one capture at a time, refuses captures over 100 MiB or 2048 chunks, and drops an unfinished capture after 60 idle seconds.
- The extension reaches only GUI origins on `127.0.0.1` and `localhost`; the relay has no path onto any other origin.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
