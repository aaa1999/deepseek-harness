---
description: "Code studio Host Remote: workspace files, confined runs, CDP debugging, and the editor language session."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-code-studio

English | [中文](README.zh.md)

## Summary

The Host half of the experimental code studio: a `codeStudio` Remote that lists, reads, and writes files of a registered workspace, runs an entry file in a sandbox-confined child process with streamed output, launches it under `node --inspect-brk` with CDP breakpoints, stepping, stack, and variables, and maintains one `typescript-language-server` session per open stream for completions, hover, and diagnostics. The browser half in this same package registers the panel. Enable it through the [code studio bundle](../code-studio-bundle/README.md); shipped profiles leave it disabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Every request names a registered workspace root and `/`-separated relative paths that must resolve inside it. Runs and debug children are confined by the sandbox's `workspace-write` policy rooted at the workspace; the language server is not confined, matching the deployment-supplied server rule of the `lsp-stdio` group. Configuration covers `runtimeCommand` (default `node`), `languageServerCommand` (default `typescript-language-server --stdio`), timeout and output caps, and the pause-reporting budgets.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Streams own their children: an aborted `run` kills its process, an aborted `debugStart` kills the child and closes the inspector WebSocket, and an aborted `langStart` terminates the server. Commands address a debug session by the id of its first `started` frame. Debug coordinates are zero-based and need no source maps because Node type stripping preserves line numbers; `--inspect-brk` holds the child until `Runtime.runIfWaitingForDebugger`, so the session installs its breakpoints first and the first stop is the entry line. The entry finishing prints Node's wait-for-disconnect notice, which the session answers by dropping the inspector so the child exits on its own. Console output travels as process stdout/stderr only; `Runtime.consoleAPICalled` is ignored so `console.log` is never delivered twice. The JSON-RPC client speaks whole-document sync (`Full`), so one `langSync` carries a file's complete text; the bundled server resolves through `createRequire` and runs on the current Node executable, so no PATH entry is needed.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel and its Remote serve the human editor only: they add no tool, prompt section, or Session event, and nothing here changes the model's request context.

#### KV Cache effect

None; every Remote stream serves the human panel only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Owner-only access — the panel installs under one `codeStudio/list` remote-access key; no resource-grant model exists for sharing a workspace's runs yet.
- Editor intelligence is server-shaped — completions, hover, and diagnostics cover what `typescript-language-server` reports for the workspace root; no `tsconfig` overrides are passed and no per-file exclusions are configured.
- Transform-only syntax — `enum` and namespace declarations are rejected by Node type stripping at run time; the editor reports them only after the server's diagnostics arrive.
- Windows debugger paths — `file://` matching in `setBreakpointByUrl` and path relativization are exercised on macOS and Linux only.

<a id="dev-note"></a>
### Dev Note

One discovery worth keeping: Node's `--inspect-brk` does not stop through a `Debugger.paused` event — the child waits for `Runtime.runIfWaitingForDebugger`, so the session installs its breakpoints first and releases the child itself, making the first stop the entry breakpoint.
