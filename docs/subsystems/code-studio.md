# Code studio

English | [中文](code-studio.zh.md)

The experimental code studio edits, runs, and debugs TypeScript inside the app: the [Host Remote](../../packages/experimental/client-ui-code-studio/README.md) owns workspace files, confined runs, CDP debugging, and the editor language session, the same package's browser half registers the panel as a main tab, and the [optional bundle](../../packages/experimental/code-studio-bundle/README.md) enables it from the Plugins page.

## Files and editing

Every request names a registered workspace root and `/`-separated relative paths that must resolve inside it. `list()` returns one directory level capped at `maxListEntries`; `read()` and `fileWrite()` read and replace one file's whole text. Each `langStart()` stream maintains one `typescript-language-server` session: `langSync()` publishes a file's current text or closes it with `null`, and the session answers `langComplete()` completions, `langHover()` hover, and diagnostics frames. The language server runs unconfined, matching the deployment-supplied server rule of the `lsp-stdio` group.

## Run, debug, and terminal

`run()` executes the active entry through `runtimeCommand` (default `node`) in a sandbox-confined child with workspace-write reach, streams output frames under byte and deadline caps, and kills the child on abort or timeout. `debugStart()` launches the entry under `node --inspect-brk`, installs line breakpoints, and streams CDP frames; `debugCommand()` resumes, steps, and moves the paused view, whose snapshots carry call frames, scopes, and variables under the configured budgets. `terminalStart()` opens an interactive shell in the workspace and streams PTY frames; `terminalInput()` and `terminalResize()` carry keystrokes and view dimensions. The studio talks only to its own Remote namespace and neither activates nor submits to an Agent.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcodestudio--codestudiocontroller"></a>

### `ctx.codeStudio` — `CodeStudioController`

Serves the code studio panel. Each stream method admits the workspace, validates paths, and owns its child lifetime for exactly as long as the Remote stream runs: an aborted run kills its process, an aborted debug session kills its child and closes the inspector, and an aborted language session terminates its server. Commands address a session by the id its first frame carried.

```ts cordis-catalog
/**
 * List one workspace directory level.
 * @param request - root and directory path, empty for the root.
 * @returns entries capped at `maxListEntries`, name-sorted, directories first.
 */
@Remote async list(request: CodeListRequest): Promise<readonly CodeDirEntry[]>

/**
 * Read one workspace file.
 * @param request - root and file path.
 * @returns the file's text, or `null` when it does not exist.
 */
@Remote async read(request: CodeReadRequest): Promise<CodeFileText | null>

/**
 * Replace one workspace file's whole text, creating it when absent.
 * @param request - root, file path, and the complete new text.
 */
@Remote async fileWrite(request: CodeFileWriteRequest): Promise<void>

/**
 * Run one entry file and stream its lifetime.
 * @param request - root, entry path, and optional deadline.
 * @param signal - kills the child and ends the stream.
 * @returns run frames in occurrence order.
 */
@Remote({ mode: 'stream' }) async *run(request: CodeRunRequest, signal: AbortSignal): AsyncIterable<CodeRunFrame>

/**
 * Launch one entry under the debugger and stream its frames. The child
 * stays stopped at its entry until a `resume` command.
 * @param request - root, entry path, and initial breakpoints.
 * @param signal - terminates the child and ends the stream.
 * @returns debug frames in occurrence order; the first is `started`.
 */
@Remote({ mode: 'stream' }) async *debugStart(request: CodeDebugStartRequest, signal: AbortSignal): AsyncIterable<CodeDebugFrame>

/**
 * Send one command to a running debug session.
 * @param request - the session id from its `started` frame and the command.
 */
@Remote async debugCommand(request: CodeDebugCommandRequest): Promise<void>

/**
 * Open one editor language session and stream its diagnostics.
 * @param request - root the language server indexes.
 * @param signal - terminates the server and ends the stream.
 * @returns language frames; `started` on success, one `failed` frame instead when the server cannot start.
 */
@Remote({ mode: 'stream' }) async *langStart(request: CodeLangStartRequest, signal: AbortSignal): AsyncIterable<CodeLangFrame>

/**
 * Publish one file's whole text to a language session, or close it with `null`.
 * @param request - session id, file path, and text or `null`.
 */
@Remote langSync(request: CodeLangSyncRequest): void

/**
 * Request completions at one position.
 * @param request - session id, file path, and zero-based position.
 * @returns normalized completion items.
 */
@Remote async langComplete(request: CodeLangCompleteRequest): Promise<readonly CodeCompletionItem[]>

/**
 * Request hover text at one position.
 * @param request - session id, file path, and zero-based position.
 * @returns hover text, or `null` when the server has none.
 */
@Remote async langHover(request: CodeLangHoverRequest): Promise<string | null>

/**
 * Open one interactive shell in the workspace and stream its output.
 * @param request - root and the client view's initial dimensions.
 * @param signal - terminates the shell and ends the stream.
 * @returns terminal frames; the first is `started`.
 * @throws {RemoteError} `codeStudio/terminal-failed` when the shell cannot start.
 */
@Remote({ mode: 'stream' }) async *terminalStart(request: CodeTerminalStartRequest, signal: AbortSignal): AsyncIterable<CodeTerminalFrame>

/**
 * Deliver typed text to one terminal.
 * @param request - the session id from its `started` frame and the text.
 */
@Remote async terminalInput(request: CodeTerminalInputRequest): Promise<void>

/**
 * Change one terminal's dimensions.
 * @param request - the session id and the new dimensions.
 */
@Remote async terminalResize(request: CodeTerminalResizeRequest): Promise<void>
```

Source: [`packages/experimental/client-ui-code-studio/src/index.ts`](../../packages/experimental/client-ui-code-studio/src/index.ts)
<!-- END GENERATED cordis-surface -->
