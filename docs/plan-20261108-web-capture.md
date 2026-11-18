---
date: 2026-11-08
branch: dev
status: completed
---

# Web snapshot → PDF reader · design plan

English | [中文](plan-20261108-web-capture.zh.md)

The original request: "Could you build an extension that combines with the current PDF plugin: the extension sends a snapshot of an entire web page to the plugin's PDF reader for preview, and it needs to reproduce that page's layout and styles."

## 1. One-sentence goal

Build a Chrome extension: with one click on any web page, turn the full-page snapshot into a PDF that **reproduces the layout and styles**, automatically deliver it into DSH's pdf-reader bookshelf, and open the preview.

## 2. Think it through first: where the real difficulty lies

- **Zero cost on the import side**: the pdf-reader Host already has `importBook(fileName, pdfBase64)` (packages/experimental/pdf-reader/src/index.ts:191) with a default 100MB cap, returning a bookshelf row — **books enter the library without touching the Host**.
- **Difficulty one (fidelity)**: the browser's native "print to PDF" goes through the print media, and many sites' print CSS hides navigation and reflows layouts, so the printed output looks nothing like what was on screen. The browser must render under the **screen** media before producing the PDF.
- **Difficulty two (transport)**: the extension's origin is `chrome-extension://` and cannot POST DSH's `/api` directly — the connection layer's trust fence rejects all cross-origin browser requests (packages/client/connection/src/api-request-trust.ts:121: `sec-fetch-site: cross-site` is rejected outright; Origin must be same-origin). Changing the fence would mean changing a global security mechanism — vetoed; the correct path is to **relay through an already-open GUI page** (same-origin) that calls the existing Remote.

## 3. Overall architecture

```text
┌ 用户浏览器 ─────────────────────────────────────────────────────┐
│  目标网页 tab                  DSH GUI tab (127.0.0.1:3080)      │
│  ┌────────────────┐  PDF base64  ┌────────────────────────────┐ │
│  │ 快照扩展 MV3    │ ───────────▶ │ content-script 中继         │ │
│  │ CDP printToPDF │  tabs.send   │   ↕ window.postMessage     │ │
│  │ screen 媒体渲染 │  Message     │ client-ui-web-capture      │ │
│  └────────────────┘              │   (新客户端插件)            │ │
└──────────────────────────────────│   ↓ ctx.remote.pdfReader   │─┘
                                   │     .importBook()          │
                                   └────────────┬───────────────┘
                                                ↓ 既有 WS Remote 通道
        DSH Host pdf-reader 控制器 → 书架入库 → selectPanel('pdfReader') + 打开事件 → 预览
```

Components and change surface:

| Component | Nature | Notes |
|---|---|---|
| `web-capture-extension` | **new** | Chromium MV3 extension responsible for capture and PDF production |
| `client-ui-web-capture` | **new** | Client plugin: receives messages, validates the token, imports books, switches the panel |
| `client-ui-pdf-reader` | 2 small changes | Listens for the "open a given book" event; `importBook` takes an optional meta parameter (M1 can ship with zero changes) |
| `web-capture-bundle` | new composition bundle | cordis.patch.yml composing the plugins above, delivered via `dsh plugin add` |

## 4. How to capture so layout and styles are "reproduced"

The core chain (`chrome.debugger` CDP):

1. Attach to the target tab → `Emulation.setEmulatedMedia({media:'screen'})` — **the key step**: it makes the print engine render with screen CSS, preserving layout, colors, and fonts;
2. Inject patch CSS: `print-color-adjust: exact`; in long-page mode, convert `position:fixed/sticky` to static (avoiding duplication/occlusion across page breaks);
3. `Page.printToPDF`: `paperWidth` = viewport width (1440px → 15in, no reflow or re-wrapping), margin 0, `printBackground`, `generateTaggedPDF` — **the text layer is fully preserved, selectable and usable for selection translate/explain**, plugging straight into pdf-reader's two loops;
4. **Long-page single-page mode (default)**: `paperHeight` = the full page height, the whole page as one extra-long PDF with a 1:1 layout; the ceiling is about 200in ≈ 19200px, beyond which it automatically segments into multiple long pages;
5. Preprocessing (optional toggles): deep capture scrolls the page once first to trigger lazy loading; canvas is converted to `<img>` via `toDataURL`; video takes the current frame;
6. Detach → base64 in hand → send to the GUI tab.

**Why not the alternatives** (trade-offs):

| Alternative | Rejection reason |
|---|---|
| Screenshot stitching → image PDF | Pixel-faithful but without a text layer, so selection translate/explain is dead, and the file is larger — kept only as the fallback when debugger permission is denied |
| html2canvas re-composition | Poor CSS compatibility; complex pages reliably break |
| The extension POSTs /api directly | Rejected by the trust fence (see §2); a global security mechanism should not be changed for it |
| The Host fetches the HTML and renders it itself | No login state, and dynamic content does not render; "extension capture" natively carries the user's session — the root reason for choosing a browser extension (Zhihu pages behind login are the typical scenario) |

## 5. Transport and security

- Relay chain: extension SW → `chrome.tabs.sendMessage` → the GUI page's content script → `window.postMessage` (convention: `source:'dsh-web-capture'`) → the plugin listener; replies travel back the same way.
- **Automatic pairing**: on startup the plugin generates a random token into localStorage; the content script, being same-origin, can read it and passes it to the extension with each message; messages without a token are always rejected — zero user configuration.
- Guardrails: bytes ≤ `maxPdfBytes` (over the limit returns an explicit error); messages >2MB are chunked and reassembled; if the GUI is not open, the extension opens a GUI tab automatically (configurable).
- Residual risk, stated plainly: a script inside the GUI page could in theory forge a message; the impact ceiling is "adding a PDF to your own bookshelf", with no code-execution surface; the token + size limits backstop it.

## 6. Import and preview interplay

- `importBook(title, base64)` → `BookRow`; on success, `ctx.layout.selectPanel('pdfReader')` (packages/client/ui-layout/src/client/service.ts:36), with the bookshelf newest-first;
- M2: `window` dispatches a `dsh-pdf-reader:open {bookId}` custom event, which client-ui-pdf-reader listens for and then enters the reading view directly (about 3 lines of change);
- Source marking: M2 adds an optional third parameter `meta {sourceUrl, capturedAt}` to `importBook`; the bookshelf subtitle shows "from the web · date", backward compatibly.

## 7. Implementation stages (final: dual mode in M1 / extension entry only / Chromium family)

Final adjustments:

1. **Dual mode enters M1**: the extension popup offers a "long page / A4" toggle (long page by default, the last choice remembered).
   - Long page: paperHeight = the full page height, 1:1 layout, >200in auto-segments;
   - A4: screen media + A4 pagination, injecting `break-inside: avoid`-style patches to reduce images/code blocks being cut.
2. **Scope narrowed**: only the browser-extension entry; no Host-side direct URL capture (if ever needed, a separate project along the Playwright route).
3. **Chromium family**: MV3 + `chrome.debugger` (CDP); no Safari/Firefox adaptation; the screenshot-stitching fallback mode is listed as a distant alternative, out of scope this time.

| Stage | Content | Output |
|---|---|---|
| M1 | Extension: long-page + A4 dual-mode capture, popup options (mode/capture width); the relay chain + automatic token pairing; the `client-ui-web-capture` plugin → `importBook` → switch the panel with the bookshelf on top; vitest (protocol/token/size guardrails) | End-to-end usable |
| M2 | Open-to-read interplay (the `dsh-pdf-reader:open` event, about 3 lines in client-ui-pdf-reader); source meta (sourceUrl/capturedAt, bookshelf subtitle); deep-capture scrolling (lazy loading), canvas/video frame replacement; error codes, i18n, accessibility, packaged `dsh plugin add` verification | Deliverable |

## 8. Edge cases

1. Pages over 200in long → automatic long-page segmentation; 2. DevTools open conflicts with debugger attach → explicit error; 3. Pages behind login → the extension side natively carries the session; 4. Cross-origin canvas taint → image conversion fails, keep a placeholder and warn; 5. Repeated captures → duplicate imports allowed, deduplication listed for later; 6. 100MB cap → an explicit error message.

## 9. Verification criteria

Hands-on comparison across three page classes (a Zhihu logged-in answer page / an MDN-style documentation page / a heavily dynamic SPA): layout, fonts, colors, and image positions checked manually, plus a PDF text layer that is selectable and translatable by selection; client-plugin vitest covers the protocol, the token, chunking, and size guardrails.
