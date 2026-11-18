---
description: "Profile layer that mounts the PDF reader trio plus the browser relay that files companion-extension page snapshots into the PDF shelf."
kind: "package-bundle"
---

# @deepseek-ai/dsh-web-capture-bundle

English | [中文](README.zh.md)

## Summary

Adds web capture to a `dsh --profile`: the PDF reader pair plus the browser relay in one layer. Install the layer into a Web profile and load the companion Chromium extension once; snapshots captured on any page then land in the PDF shelf and open in the reader with their source URL and date. The patch pins the same DeepSeek model routes as `dsh-pdf-reader-bundle`. No shipped profile includes this layer.

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

Run `dsh plugin --profile <name> add @deepseek-ai/dsh-web-capture-bundle` in a profile that runs the Web client, or point the command at a local checkout with a `file:` path. The dsh installation does not ship this bundle, so it does not appear in the plugin manager's optional list. Then load the companion extension from `dsh-client-ui-web-capture`'s `extension/` directory as described in [that package](../client-ui-web-capture/README.md#use-this-package).

### What you get

The three inserted rows provide the full capture path: the library service [`dsh-pdf-reader`](../pdf-reader/README.md) stores books under the harness home and streams treatments, the browser panel [`dsh-client-ui-pdf-reader`](../client-ui-pdf-reader/README.md) registers the PDF sidebar entry, and the relay [`dsh-client-ui-web-capture`](../client-ui-web-capture/README.md) files extension snapshots into that shelf. The patch selects `deepseek-official/deepseek-chat` for text treatments and `deepseek-official/deepseek-v4-flash-vision-exp` for screenshot questions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document with one `insert` list: the `pdf-reader` service row carrying the data root and both model pairs, the `pdf-reader-ui` browser row, and the `web-capture-ui` relay row. The row ids mirror `dsh-pdf-reader-bundle` so either bundle can be replaced by the other in one step, which is also why installing both conflicts. A later layer or the profile's own patch overrides any row by id and replaces its whole configuration. The package entry carries no runtime API.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: the three rows with their pinned configuration |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web capture relay](../client-ui-web-capture/README.md) — the relay and the companion extension.
- [PDF library service](../pdf-reader/README.md) — storage and treatment requests.
- [Browser reader panel](../client-ui-pdf-reader/README.md) — the sidebar surface.
- [PDF reader bundle](../pdf-reader-bundle/README.md) — the same reader rows without the relay.
- [Experimental package map](../README.md) — the surrounding package group.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the inserted rows: the library service owns every treatment request, the browser panel registers no model input, and the relay files snapshots without any model request.

#### KV Cache effect

The layer adds no request prefix; treatment requests and their routing belong to `dsh-pdf-reader`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The row ids mirror `dsh-pdf-reader-bundle`; install one or the other, never both, or the duplicate rows conflict.
- Capturing requires the companion Chromium extension loaded unpacked; the bundle cannot install or update it.
- The patch pins both model pairs to DeepSeek routes; clear `provider`/`model` and `shotProvider`/`shotModel` in a later layer to follow the profile default model.
- Storage stays at the `dshHomePath('pdf-reader')` directory the patch sets; moving it requires the reader's settings panel or a config override that restates the row.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
