/**
 * Wire types of the code studio Remote: workspace-relative paths, run and
 * debug streams, and the editor language service. All line/column positions
 * are zero-based UTF-16, matching both LSP and the editor's coordinates.
 */

/** One directory entry of a `list` reply. */
export interface CodeDirEntry {
  /** Workspace-relative path with `/` separators. */
  readonly path: string
  /** Final path segment as the tree shows it. */
  readonly name: string
  /** Whether the entry is a directory. */
  readonly directory: boolean
}

/** `list` request: one directory level below `path` (empty for the root). */
export interface CodeListRequest {
  readonly workspaceRoot: string
  readonly path: string
}

/** `read` request for one file. */
export interface CodeReadRequest {
  readonly workspaceRoot: string
  readonly path: string
}

/** `read` reply for one existing file. */
export interface CodeFileText {
  readonly path: string
  readonly text: string
}

/** `fileWrite` request: replace one file's whole text. */
export interface CodeFileWriteRequest {
  readonly workspaceRoot: string
  readonly path: string
  readonly text: string
}

/** `run` request: execute one entry file in the workspace. */
export interface CodeRunRequest {
  readonly workspaceRoot: string
  /** Workspace-relative entry file to execute. */
  readonly entryPath: string
  /** Deadline in milliseconds; capped by the service config. */
  readonly timeoutMs?: number
}

/** One frame of a `run` stream, in occurrence order. */
export type CodeRunFrame =
  | { readonly kind: 'started'; readonly runtime: string }
  | { readonly kind: 'stdout'; readonly text: string }
  | { readonly kind: 'stderr'; readonly text: string }
  | {
    readonly kind: 'exit'
    readonly exitCode: number | null
    readonly signal: string | null
    readonly timedOut: boolean
  }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested root is not a registered Workspace. */
    'codeStudio/unknown-workspace': Record<string, never>
    /** A request path resolves outside the workspace root. */
    'codeStudio/path-outside-workspace': { readonly path: string }
    /** The runtime executable, the sandbox, or the spawn failed. */
    'codeStudio/run-failed': Record<string, never>
    /** Spawning, confinement, or the inspector handshake of a debug child failed. */
    'codeStudio/debug-failed': Record<string, never>
    /** A debugger protocol call failed on a live session. */
    'codeStudio/debug-command-failed': Record<string, never>
    /** No debug session has that id. */
    'codeStudio/unknown-debug-session': Record<string, never>
    /** No language session has that id. */
    'codeStudio/unknown-language-session': Record<string, never>
    /** No terminal has that id. */
    'codeStudio/unknown-terminal-session': Record<string, never>
    /** Spawning or confining the workspace shell failed. */
    'codeStudio/terminal-failed': Record<string, never>
  }
}

/** `debugStart` request: launch the entry under the debugger. */
export interface CodeDebugStartRequest {
  readonly workspaceRoot: string
  readonly entryPath: string
  /** Initial line breakpoints, zero-based. */
  readonly breakpoints: readonly { readonly path: string; readonly line: number }[]
}

/** Console severity of a `console` debug frame. */
export type CodeConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/** One variable of a paused scope, with a preview value already rendered. */
export interface CodeVariable {
  readonly name: string
  /** Rendered value preview; never the raw remote object handle. */
  readonly value: string
  /** Remote-object type name, when the debugger reported one. */
  readonly type: string | null
}

/** One scope of a paused call frame. */
export interface CodeScope {
  /** Scope name as the debugger reports it, such as `Local` or `Global`. */
  readonly name: string
  readonly variables: readonly CodeVariable[]
  readonly truncated: boolean
}

/** One call frame of a pause. */
export interface CodeCallFrame {
  /** Workspace-relative path, absolute when the frame is outside the workspace. */
  readonly path: string
  readonly line: number
  readonly column: number
  readonly functionName: string
  readonly scopes: readonly CodeScope[]
}

/** One frame of a `debugStart` stream, in occurrence order. */
export type CodeDebugFrame =
  | { readonly kind: 'started'; readonly debugId: string }
  | { readonly kind: 'console'; readonly level: CodeConsoleLevel; readonly text: string }
  | { readonly kind: 'paused'; readonly reason: string; readonly callFrames: readonly CodeCallFrame[] }
  | { readonly kind: 'resumed' }
  | { readonly kind: 'breakpoints'; readonly path: string; readonly states: readonly ('active' | 'pending')[] }
  | { readonly kind: 'stdout'; readonly text: string }
  | { readonly kind: 'stderr'; readonly text: string }
  | { readonly kind: 'exit'; readonly exitCode: number | null; readonly signal: string | null }

/** One debugger command addressed to a running debug stream. */
export type CodeDebugCommand =
  | { readonly kind: 'resume' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut' }
  | { readonly kind: 'setBreakpoints'; readonly path: string; readonly lines: readonly number[] }
  | { readonly kind: 'stop' }

/** `debugCommand` request. */
export interface CodeDebugCommandRequest {
  readonly debugId: string
  readonly command: CodeDebugCommand
}

/** `terminalStart` request: one interactive shell in the workspace. */
export interface CodeTerminalStartRequest {
  readonly workspaceRoot: string
  /** Initial column count the client's terminal view holds. */
  readonly cols: number
  /** Initial row count the client's terminal view holds. */
  readonly rows: number
}

/** One frame of a `terminalStart` stream, in delivery order. */
export type CodeTerminalFrame =
  | { readonly kind: 'started'; readonly terminalId: string }
  | { readonly kind: 'output'; readonly text: string }
  | { readonly kind: 'exit'; readonly exitCode: number | null; readonly signal: string | null }

/** `terminalInput` request: deliver typed text to one terminal. */
export interface CodeTerminalInputRequest {
  readonly terminalId: string
  readonly data: string
}

/** `terminalResize` request: new dimensions for one terminal. */
export interface CodeTerminalResizeRequest {
  readonly terminalId: string
  readonly cols: number
  readonly rows: number
}

/** `langStart` request: open one editor language session on a workspace. */
export interface CodeLangStartRequest {
  readonly workspaceRoot: string
}

/** One diagnostic of a `diagnostics` frame. */
export interface CodeDiagnostic {
  readonly line: number
  readonly character: number
  readonly endLine: number
  readonly endCharacter: number
  readonly severity: 'error' | 'warning' | 'info'
  readonly message: string
  /** TypeScript diagnostic code, when the server reported one. */
  readonly code: string | null
}

/** One frame of a `langStart` stream. */
export type CodeLangFrame =
  | { readonly kind: 'started'; readonly langId: string }
  | { readonly kind: 'diagnostics'; readonly path: string; readonly diagnostics: readonly CodeDiagnostic[] }
  | { readonly kind: 'failed'; readonly message: string }

/** `langSync` request: publish one file's whole text, or close it with `null`. */
export interface CodeLangSyncRequest {
  readonly langId: string
  readonly path: string
  readonly text: string | null
}

/** `langComplete` request at one zero-based position. */
export interface CodeLangCompleteRequest {
  readonly langId: string
  readonly path: string
  readonly line: number
  readonly character: number
}

/** One completion of a `langComplete` reply. */
export interface CodeCompletionItem {
  readonly label: string
  /** LSP `CompletionItemKind`, passed through. */
  readonly kind: number
  readonly detail: string | null
  /** Text to insert; the label when the server sent none. */
  readonly insertText: string
}

/** `langHover` request at one zero-based position. */
export interface CodeLangHoverRequest {
  readonly langId: string
  readonly path: string
  readonly line: number
  readonly character: number
}
