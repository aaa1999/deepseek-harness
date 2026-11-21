---
description: "Enable the TypeScript code studio panel from the Plugins page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-code-studio-bundle

English | [中文](README.zh.md)

## Summary

Write, run, and debug TypeScript inside the app. Enable Code studio on the Web or Desktop Plugins page; shipped profiles leave it disabled. Pick one of the registered workspaces, edit its `.ts` files with completions, hover, and diagnostics from `typescript-language-server`, save with Cmd/Ctrl+S, run the active file with streamed output, or debug it with line breakpoints, stepping, call stack, and variables. Runs and debug children are sandbox-confined with workspace-write reach.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Open Plugins and enable Code studio in the Official group. The panel package carries `typescript-language-server` and `typescript` as dependencies, so the language session works without a global install; override `languageServerCommand` in the `code-studio` row to point at another server, and `runtimeCommand` to run entries with something other than plain `node`. The entry of a run or debug launch is the active editor file.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The bundle mounts one row, the panel package, whose Host half provides the whole `codeStudio` Remote; see the [panel package](../client-ui-code-studio/README.md#understand-the-implementation) for the stream, sandbox, and debugger contracts.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this bundle only mounts the human panel and its Remote: no tool, prompt section, or Session event changes the model's request context.

#### KV Cache effect

None; enabling or disabling the bundle changes no request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Owner-only panel — see the [panel package](../client-ui-code-studio/README.md#known-limitations-and-deferred-work); its runtime, debugger, and language-server limits apply here unchanged.

<a id="dev-note"></a>
### Dev Note

The bundle stays one row on purpose: everything above it is the panel package's own seam, so profile patches replace one target and no composition state lives here.
