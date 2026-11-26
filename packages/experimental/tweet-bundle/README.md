---
description: "Enable the tweet panel from the Plugins page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tweet-bundle

English | [中文](README.zh.md)

## Summary

Publish personal takes inside the app. Enable Tweet on the Web or Desktop Plugins page; shipped profiles leave it disabled. Pick one of the registered workspaces, then post plain text with separately laid out images, Weibo style: paste screenshots straight into the composer, fold long text to three lines with an expand control, edit the wording later, comment under any post without a count limit (comment lists fold to the newest three until expanded), and scroll the newest-first feed. Every post, comment, and image byte lives in that workspace's `.dsh/tweet/` directory, so the feed travels with the workspace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open Plugins and enable Tweet in the Official group. The panel reads the registered workspace list for its selector; add workspaces on the workspaces surface first when the selector is empty. Accepted image types are PNG, JPEG, WebP, and GIF, and the composer takes files from the picker or the clipboard alike.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The bundle mounts one row, the panel package, whose Host half provides the whole `tweet` Remote; see the [panel package](../client-ui-tweet/README.md#understand-the-implementation) for the store layout, ordering, and admission contracts.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this bundle only mounts the human panel and its Remote: no tool, prompt section, or Session event changes the model's request context.

#### KV Cache effect

None; enabling or disabling the bundle changes no request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Owner-only panel — see the [panel package](../client-ui-tweet/README.md#known-limitations-and-deferred-work); its sorting, retention, and pagination limits apply here unchanged.

<a id="dev-note"></a>
### Dev Note

The bundle stays one row on purpose: everything above it is the panel package's own seam, so profile patches replace one target and no composition state lives here.
