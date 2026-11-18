---
description: "Profile layer that mounts the EPUB library service and the browser Reading panel with a working treatment model route."
kind: "package-bundle"
---

# @deepseek-ai/dsh-epub-reader-bundle

English | [中文](README.zh.md)

## Summary

Adds EPUB reading to a `dsh --profile`: the Host library service and the browser Reading panel together. Install the layer into a Web profile and the sidebar gains the Reading entry with import, two-column reading, and highlight treatments working immediately. The patch pins a DeepSeek route for treatments, so the layer streams even without a default agent model; clearing the pair follows the profile default. No shipped profile includes this layer.

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

### Install into a profile

Run `dsh plugin --profile <name> add @deepseek-ai/dsh-epub-reader-bundle` in a profile that runs the Web client, or point the command at a local checkout with a `file:` path. The dsh installation does not ship this bundle, so it does not appear in the plugin manager's optional list.

### What you get

The reading surface the two inserted rows provide: the browser panel [`dsh-client-ui-epub-reader`](../client-ui-epub-reader/README.md) registers the sidebar entry, and the library service [`dsh-epub-reader`](../epub-reader/README.md) stores books under the harness home (`<DSH_HOME>/epub-reader`), sanitizes chapters, and streams every treatment. The patch selects `deepseek-official/deepseek-chat` for treatments. The plugin detail page carries the user-facing feature summary in `docs/DETAIL.en.md`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document with one `insert` list: the `epub-reader` service row carrying the data root and model pair, and the `epub-reader-ui` browser row. A later layer or the profile's own patch overrides either row by id and replaces its whole configuration, so an override restates every setting it keeps. The `dshHomePath` expression resolves the storage directory at load time. The package entry carries no runtime API.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: both rows with their pinned configuration |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| `docs/DETAIL.en.md` | Feature summary shown on the plugin detail page |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [EPUB library service](../epub-reader/README.md) — storage, sanitization, and treatment requests.
- [Browser Reading panel](../client-ui-epub-reader/README.md) — the sidebar surface.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the inserted rows: the library service owns every treatment request and its model routing, and the browser panel registers no model input.

#### KV Cache effect

The layer adds no request prefix; treatment requests and their routing belong to `dsh-epub-reader`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The patch pins the treatment pair to a DeepSeek route; clear `provider`/`model` in a later layer to follow the profile default model.
- Imported chapters reach the browser only through the service's sanitizer; content outside its allowlist never renders, by design.
- Storage stays at the `dshHomePath('epub-reader')` directory the patch sets; moving it requires the reader's settings panel or a config override that restates the row.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
