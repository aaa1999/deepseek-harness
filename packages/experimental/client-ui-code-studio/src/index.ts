/**
 * Host Remote of the code studio: workspace file reads, writes, and listings;
 * sandbox-confined runs of an entry file; CDP debug sessions; and one editor
 * language session per open stream. Every request names a registered
 * Workspace as its root and paths that must resolve inside it.
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DebugSession } from './debug.ts'
import type { DebugLimits } from './debug.ts'
import { LangSession } from './lang.ts'
import type { LangLimits } from './lang.ts'
import { admitFile, admitWorkspace } from './paths.ts'
import { runWorkspaceEntry } from './run.ts'
import { WorkspaceTerminal } from './terminal.ts'
import type { RunLimits } from './run.ts'
import type {
  CodeDebugCommandRequest,
  CodeDebugFrame,
  CodeDebugStartRequest,
  CodeDirEntry,
  CodeFileText,
  CodeFileWriteRequest,
  CodeLangCompleteRequest,
  CodeLangFrame,
  CodeLangHoverRequest,
  CodeLangStartRequest,
  CodeLangSyncRequest,
  CodeCompletionItem,
  CodeListRequest,
  CodeReadRequest,
  CodeRunFrame,
  CodeRunRequest,
  CodeTerminalFrame,
  CodeTerminalInputRequest,
  CodeTerminalResizeRequest,
  CodeTerminalStartRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote that serves the code studio panel of the GUI. */
    codeStudio: CodeStudioController
  }
}

/** Largest delay `setTimeout` accepts without overflowing its delay field. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Panel limits: run and debug budgets plus the language server invocation. */
interface Config {
  readonly runtimeCommand: string[]
  readonly languageServerCommand: string[]
  readonly defaultTimeoutMs: number
  readonly maxTimeoutMs: number
  readonly maxOutputBytes: number
  readonly graceMs: number
  readonly maxListEntries: number
  readonly maxCallFrames: number
  readonly maxScopesPerFrame: number
  readonly maxVariablesPerScope: number
  readonly maxPreviewChars: number
  readonly pausedCollectTimeoutMs: number
  readonly initializeTimeoutMs: number
  readonly completionTimeoutMs: number
  readonly hoverTimeoutMs: number
}

/**
 * Serves the code studio panel. Each stream method admits the workspace,
 * validates paths, and owns its child lifetime for exactly as long as the
 * Remote stream runs: an aborted run kills its process, an aborted debug
 * session kills its child and closes the inspector, and an aborted language
 * session terminates its server. Commands address a session by the id its
 * first frame carried.
 */
export class CodeStudioController extends TypertRemoteService {
  static inject = ['fs', 'subprocess', 'sandbox', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    runtimeCommand: z.array(z.string()).default(['node']),
    languageServerCommand: z.array(z.string()).default(['typescript-language-server', '--stdio']),
    defaultTimeoutMs: z.number().default(60_000),
    maxTimeoutMs: z.number().default(600_000),
    maxOutputBytes: z.number().default(1_048_576),
    graceMs: z.number().default(2_000),
    maxListEntries: z.number().default(500),
    maxCallFrames: z.number().default(20),
    maxScopesPerFrame: z.number().default(3),
    maxVariablesPerScope: z.number().default(50),
    maxPreviewChars: z.number().default(200),
    pausedCollectTimeoutMs: z.number().default(5_000),
    initializeTimeoutMs: z.number().default(20_000),
    completionTimeoutMs: z.number().default(10_000),
    hoverTimeoutMs: z.number().default(5_000),
  })

  private readonly config: Config
  private readonly debugs = new Map<string, DebugSession>()
  private readonly langs = new Map<string, LangSession>()
  private readonly terminals = new Map<string, WorkspaceTerminal>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'codeStudio')
    const resolved = config as Required<Config>
    for (const key of ['runtimeCommand', 'languageServerCommand'] as const) {
      if (resolved[key].length === 0 || resolved[key].some(part => part.trim() === '')) {
        throw new Error(`code-studio: ${key} must name a non-empty command`)
      }
    }
    for (const key of [
      'defaultTimeoutMs', 'maxTimeoutMs', 'maxOutputBytes', 'graceMs', 'maxListEntries', 'maxCallFrames',
      'maxScopesPerFrame', 'maxVariablesPerScope', 'maxPreviewChars', 'pausedCollectTimeoutMs', 'initializeTimeoutMs',
      'completionTimeoutMs', 'hoverTimeoutMs',
    ] as const) {
      const value = resolved[key]
      if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
        throw new Error(`code-studio: ${key} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
      }
    }
    if (resolved.defaultTimeoutMs > resolved.maxTimeoutMs) {
      throw new Error('code-studio: defaultTimeoutMs must not exceed maxTimeoutMs')
    }
    this.config = resolved
    ctx.effect(() => () => {
      for (const session of this.debugs.values()) session.dispose('service stopped')
      this.debugs.clear()
      for (const session of this.langs.values()) session.dispose()
      this.langs.clear()
      for (const terminal of this.terminals.values()) terminal.dispose()
      this.terminals.clear()
    }, 'code-studio: stop sessions')
  }

  private get runLimits(): RunLimits {
    return {
      runtimeCommand: this.config.runtimeCommand,
      defaultTimeoutMs: this.config.defaultTimeoutMs,
      maxTimeoutMs: this.config.maxTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      graceMs: this.config.graceMs,
    }
  }

  private get debugLimits(): DebugLimits {
    return {
      graceMs: this.config.graceMs,
      maxCallFrames: this.config.maxCallFrames,
      maxScopesPerFrame: this.config.maxScopesPerFrame,
      maxVariablesPerScope: this.config.maxVariablesPerScope,
      maxPreviewChars: this.config.maxPreviewChars,
      pausedCollectTimeoutMs: this.config.pausedCollectTimeoutMs,
    }
  }

  private get langLimits(): LangLimits {
    return {
      serverCommand: this.config.languageServerCommand,
      initializeTimeoutMs: this.config.initializeTimeoutMs,
      completionTimeoutMs: this.config.completionTimeoutMs,
      hoverTimeoutMs: this.config.hoverTimeoutMs,
    }
  }

  /**
   * List one workspace directory level.
   * @param request - root and directory path, empty for the root.
   * @returns entries capped at `maxListEntries`, name-sorted, directories first.
   */
  @Remote
  async list(request: CodeListRequest): Promise<readonly CodeDirEntry[]> {
    const workspace = await admitWorkspace(this.ctx, request.workspaceRoot)
    const directory = request.path === '' ? workspace : await admitFile(this.ctx, workspace, request.path)
    const entries = await this.ctx.fs.listDir(directory.target)
    return entries
      .slice(0, this.config.maxListEntries)
      .map(entry => ({
        path: joinWorkspacePath(request.path, entry.name),
        name: entry.name,
        directory: entry.type === 'directory',
      }))
      .sort((left, right) => compareEntries(left, right))
  }

  /**
   * Read one workspace file.
   * @param request - root and file path.
   * @returns the file's text, or `null` when it does not exist.
   */
  @Remote
  async read(request: CodeReadRequest): Promise<CodeFileText | null> {
    const workspace = await admitWorkspace(this.ctx, request.workspaceRoot)
    const file = await admitFile(this.ctx, workspace, request.path)
    if (await this.ctx.fs.stat(file.target) === undefined) return null
    return { path: request.path, text: await this.ctx.fs.readText(file.target) }
  }

  /**
   * Replace one workspace file's whole text, creating it when absent.
   * @param request - root, file path, and the complete new text.
   */
  @Remote
  async fileWrite(request: CodeFileWriteRequest): Promise<void> {
    const workspace = await admitWorkspace(this.ctx, request.workspaceRoot)
    const file = await admitFile(this.ctx, workspace, request.path)
    const policy: SandboxExecutionPolicy = { mode: 'workspace-write', workspaceRoot: workspace.canonical }
    await this.ctx.fs.writeText(file.target, request.text, undefined, undefined, policy)
  }

  /**
   * Run one entry file and stream its lifetime.
   * @param request - root, entry path, and optional deadline.
   * @param signal - kills the child and ends the stream.
   * @yields run frames in occurrence order.
   */
  @Remote({ mode: 'stream' })
  async *run(request: CodeRunRequest, signal: AbortSignal): AsyncIterable<CodeRunFrame> {
    const workspace = await admitWorkspace(this.ctx, request.workspaceRoot)
    const entry = await admitFile(this.ctx, workspace, request.entryPath)
    yield* runWorkspaceEntry(this.ctx, this.runLimits, workspace, entry.absolute, request.timeoutMs, signal)
  }

  /**
   * Launch one entry under the debugger and stream its frames. The child
   * stays stopped at its entry until a `resume` command.
   * @param request - root, entry path, and initial breakpoints.
   * @param signal - terminates the child and ends the stream.
   * @yields debug frames in occurrence order; the first is `started`.
   */
  @Remote({ mode: 'stream' })
  async *debugStart(request: CodeDebugStartRequest, signal: AbortSignal): AsyncIterable<CodeDebugFrame> {
    const workspace = await admitWorkspace(this.ctx, request.workspaceRoot)
    const entry = await admitFile(this.ctx, workspace, request.entryPath)
    const debugId = randomUUID()
    const session = await DebugSession.start(
      this.ctx, this.debugLimits, workspace, entry.absolute, debugId, request.breakpoints, signal,
    )
    this.debugs.set(debugId, session)
    try {
      yield* session.frames.drain(signal)
    } finally {
      this.debugs.delete(debugId)
      session.dispose('stream ended')
    }
  }

  /**
   * Send one command to a running debug session.
   * @param request - the session id from its `started` frame and the command.
   */
  @Remote
  async debugCommand(request: CodeDebugCommandRequest): Promise<void> {
    const session = this.debugs.get(request.debugId)
    if (session === undefined) {
      throw new RemoteError('codeStudio/unknown-debug-session', `no debug session '${request.debugId}'`, {})
    }
    await session.command(request.command)
  }

  /**
   * Open one editor language session and stream its diagnostics.
   * @param request - root the language server indexes.
   * @param signal - terminates the server and ends the stream.
   * @yields language frames; `started` on success, one `failed` frame instead when the server cannot start.
   */
  @Remote({ mode: 'stream' })
  async *langStart(request: CodeLangStartRequest, signal: AbortSignal): AsyncIterable<CodeLangFrame> {
    const workspace = await admitWorkspace(this.ctx, request.workspaceRoot)
    const langId = randomUUID()
    let session: LangSession
    try {
      session = await LangSession.start(this.ctx, this.langLimits, workspace, langId, signal)
    } catch (error) {
      yield { kind: 'failed', message: String(error) }
      return
    }
    this.langs.set(langId, session)
    try {
      yield* session.frames.drain(signal)
    } finally {
      this.langs.delete(langId)
      session.dispose()
    }
  }

  /**
   * Publish one file's whole text to a language session, or close it with `null`.
   * @param request - session id, file path, and text or `null`.
   */
  @Remote
  langSync(request: CodeLangSyncRequest): void {
    this.langSession(request.langId).sync(request.path, request.text)
  }

  /**
   * Request completions at one position.
   * @param request - session id, file path, and zero-based position.
   * @returns normalized completion items.
   */
  @Remote
  async langComplete(request: CodeLangCompleteRequest): Promise<readonly CodeCompletionItem[]> {
    return await this.langSession(request.langId).complete(request.path, request.line, request.character)
  }

  /**
   * Request hover text at one position.
   * @param request - session id, file path, and zero-based position.
   * @returns hover text, or `null` when the server has none.
   */
  @Remote
  async langHover(request: CodeLangHoverRequest): Promise<string | null> {
    return await this.langSession(request.langId).hover(request.path, request.line, request.character)
  }

  /**
   * Open one interactive shell in the workspace and stream its output.
   * @param request - root and the client view's initial dimensions.
   * @param signal - terminates the shell and ends the stream.
   * @yields terminal frames; the first is `started`.
   * @throws {RemoteError} `codeStudio/terminal-failed` when the shell cannot start.
   */
  @Remote({ mode: 'stream' })
  async *terminalStart(request: CodeTerminalStartRequest, signal: AbortSignal): AsyncIterable<CodeTerminalFrame> {
    const workspace = await admitWorkspace(this.ctx, request.workspaceRoot)
    const terminalId = randomUUID()
    const session = await WorkspaceTerminal.start(
      this.ctx, this.config.graceMs, workspace, terminalId, request.cols, request.rows, signal,
    )
    this.terminals.set(terminalId, session)
    try {
      yield* session.frames.drain(signal)
    } finally {
      this.terminals.delete(terminalId)
      session.dispose()
    }
  }

  /**
   * Deliver typed text to one terminal.
   * @param request - the session id from its `started` frame and the text.
   */
  @Remote
  async terminalInput(request: CodeTerminalInputRequest): Promise<void> {
    await this.terminalSession(request.terminalId).input(request.data)
  }

  /**
   * Change one terminal's dimensions.
   * @param request - the session id and the new dimensions.
   */
  @Remote
  async terminalResize(request: CodeTerminalResizeRequest): Promise<void> {
    await this.terminalSession(request.terminalId).resize(request.cols, request.rows)
  }

  private terminalSession(terminalId: string): WorkspaceTerminal {
    const session = this.terminals.get(terminalId)
    if (session === undefined) {
      throw new RemoteError('codeStudio/unknown-terminal-session', `no terminal '${terminalId}'`, {})
    }
    return session
  }

  private langSession(langId: string): LangSession {
    const session = this.langs.get(langId)
    if (session === undefined) {
      throw new RemoteError('codeStudio/unknown-language-session', `no language session '${langId}'`, {})
    }
    return session
  }
}

/** Join a directory path and one entry name into a workspace-relative path. */
function joinWorkspacePath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

/** Order directory entries before files, then by name. */
function compareEntries(left: CodeDirEntry, right: CodeDirEntry): number {
  if (left.directory !== right.directory) return left.directory ? -1 : 1
  return left.name.localeCompare(right.name)
}

export default CodeStudioController
