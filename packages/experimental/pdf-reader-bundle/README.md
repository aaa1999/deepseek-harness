---
description: "Profile layer that mounts the PDF library service and the browser reader panel with a working treatment model route."
kind: "package-bundle"
---

# @deepseek-ai/dsh-pdf-reader-bundle

English | [中文](README.zh.md)

## Summary

Adds PDF reading to a `dsh --profile`: the Host library service and the browser panel together. Install the layer into a Web profile and the sidebar gains the PDF entry with import, reading, highlights, and screenshot questions working immediately. The patch pins DeepSeek routes for text treatments and screenshot questions, so the layer streams even without a default agent model; clearing both pairs follows the profile default. No shipped profile includes this layer.

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

Run `dsh plugin --profile <name> add @deepseek-ai/dsh-pdf-reader-bundle` in a profile that runs the Web client, or point the command at a local checkout with a `file:` path. The dsh installation does not ship this bundle, so it does not appear in the plugin manager's optional list.

### What you get

The reader surface the two inserted rows provide: the browser panel [`dsh-client-ui-pdf-reader`](../client-ui-pdf-reader/README.md) registers the sidebar entry, and the library service [`dsh-pdf-reader`](../pdf-reader/README.md) stores books under the harness home (`<DSH_HOME>/pdf-reader`) and streams every treatment. The patch selects `deepseek-official/deepseek-chat` for text treatments and `deepseek-official/deepseek-v4-flash-vision-exp` for screenshot questions. The plugin detail page carries the user-facing feature summary in `docs/DETAIL.en.md`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document with one `insert` list: the `pdf-reader` service row carrying the data root and both model pairs, and the `pdf-reader-ui` browser row. A later layer or the profile's own patch overrides either row by id and replaces its whole configuration, so an override restates every setting it keeps. The `dshHomePath` expression resolves the storage directory at load time. The package entry carries no runtime API.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: both rows with their pinned configuration |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| `docs/DETAIL.en.md` | Feature summary shown on the plugin detail page |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [PDF library service](../pdf-reader/README.md) — storage and treatment requests.
- [Browser reader panel](../client-ui-pdf-reader/README.md) — the sidebar surface.
- [Web capture bundle](../web-capture-bundle/README.md) — the same rows plus the snapshot relay.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the inserted rows: the library service owns every treatment request and its model routing, and the browser panel registers no model input.

#### KV Cache effect

The layer adds no request prefix; treatment requests and their routing belong to `dsh-pdf-reader`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The patch pins both model pairs to DeepSeek routes; clear `provider`/`model` and `shotProvider`/`shotModel` in a later layer to follow the profile default model.
- The row ids mirror `dsh-web-capture-bundle`; install one or the other, never both, or the duplicate rows conflict.
- Storage stays at the `dshHomePath('pdf-reader')` directory the patch sets; moving it requires the reader's settings panel or a config override that restates the row.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
