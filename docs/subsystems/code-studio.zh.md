# 代码工作台

[English](code-studio.md) | 中文

实验性代码工作台在应用内编辑、运行并调试 TypeScript：[Host Remote](../../packages/experimental/client-ui-code-studio/README.zh.md)负责工作区文件、受限运行、CDP 调试与编辑器语言会话，同包的浏览器半边把面板注册为主标签页，[可选 bundle](../../packages/experimental/code-studio-bundle/README.zh.md)从插件页启用它。

## 文件与编辑

每个请求都指明一个已注册的工作区根，以及必须解析在其内的 `/` 分隔相对路径。`list()` 返回单层目录，条目数受 `maxListEntries` 限制；`read()` 与 `fileWrite()` 读取并整体替换单个文件的文本。每条 `langStart()` 流维护一个 `typescript-language-server` 会话：`langSync()` 发布文件的当前文本，或以 `null` 关闭它；会话回答 `langComplete()` 补全、`langHover()` 悬停与诊断帧。语言服务器不加沙箱，遵循 `lsp-stdio` 组对部署方提供的服务器的规则。

## 运行、调试与终端

`run()` 经 `runtimeCommand`（默认 `node`）在沙箱受限、具有 workspace-write 权限的子进程中执行活动入口，在字节与超时上限内流出输出帧，并在中止或超时时终止子进程。`debugStart()` 以 `node --inspect-brk` 启动入口、装设行断点并流出 CDP 帧；`debugCommand()` 恢复、单步并移动暂停视图，其快照按配置预算携带调用帧、作用域与变量。`terminalStart()` 在工作区打开交互式 shell 并流出 PTY 帧；`terminalInput()` 与 `terminalResize()` 传递按键与视图尺寸。工作台只与自己的 Remote 命名空间通信，既不激活也不提交任何 Agent。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
