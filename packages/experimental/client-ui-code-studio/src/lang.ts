/**
 * One editor language session: a `typescript-language-server` child over
 * stdio JSON-RPC, whole-document synchronization, and the diagnostics,
 * completion, and hover surface the panel editor binds to. Documents are
 * synced in full (LSP `Full`), so one didChange carries the editor's text.
 */

import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { FrameQueue } from './debug.ts'
import { JsonRpcConnection } from './jsonrpc.ts'
import type { AdmittedWorkspace } from './paths.ts'
import type { CodeCompletionItem, CodeDiagnostic, CodeLangFrame } from './types.ts'

/** Service-configured limits of one language session. */
export interface LangLimits {
  /** Server argv; `typescript-language-server --stdio` by default. */
  readonly serverCommand: readonly string[]
  readonly initializeTimeoutMs: number
  readonly completionTimeoutMs: number
  readonly hoverTimeoutMs: number
}

/**
 * One live language session. Construction spawns the server, completes the
 * LSP initialize handshake, and republishes `textDocument/publishDiagnostics`
 * notifications as frames on {@link LangSession.frames}. Diagnostics for a
 * file always replace the previous frame's set. A server that dies mid-session
 * ends its frame queue with one `failed` frame.
 */
export class LangSession {
  readonly frames = new FrameQueue<CodeLangFrame>()
  private readonly versions = new Map<string, number>()
  private disposed: boolean = false

  private constructor(
    private readonly limits: LangLimits,
    private readonly workspace: AdmittedWorkspace,
    private readonly connection: JsonRpcConnection,
    private readonly terminate: () => void,
  ) {}

  /**
   * Spawn and initialize one language session.
   * @param ctx - Host context carrying the subprocess service.
   * @param limits - service-configured caps and server command.
   * @param workspace - admitted workspace root the server indexes.
   * @param langId - controller-assigned id the `started` frame carries.
   * @param signal - aborting terminates the server and ends the frame queue.
   * @returns the started session, whose first frame is `started`.
   * @throws {Error} when the server binary cannot be resolved or the initialize handshake fails.
   */
  static async start(
    ctx: Context,
    limits: LangLimits,
    workspace: AdmittedWorkspace,
    langId: string,
    signal: AbortSignal,
  ): Promise<LangSession> {
    signal.throwIfAborted()
    const handle = ctx.subprocess.spawn({
      argv: await languageServerArgv(ctx, limits, signal),
      cwd: workspace.canonical,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 2_000,
      signal,
    })
    const holder: { session?: LangSession } = {}
    const connection = new JsonRpcConnection(handle, {
      onNotification: (method, params) => { holder.session?.onNotification(method, params) },
      onClosed: (reason) => {
        holder.session?.frames.push({ kind: 'failed', message: `the language server stopped: ${reason}` })
        holder.session?.dispose()
      },
    })
    const session = new LangSession(limits, workspace, connection, () => { handle.terminate() })
    holder.session = session
    signal.addEventListener('abort', () => { session.dispose() }, { once: true })
    void handle.done.then(() => { session.dispose() })
    try {
      await withDeadline(
        connection.request('initialize', {
          processId: null,
          rootUri: pathToFileURL(workspace.canonical).href,
          capabilities: {
            textDocument: {
              publishDiagnostics: { relatedInformation: false },
              synchronization: { dynamicRegistration: false, didSave: false },
              completion: { dynamicRegistration: false, completionItem: { snippetSupport: false } },
              hover: { dynamicRegistration: false, contentFormat: ['plaintext', 'markdown'] },
            },
          },
        }),
        limits.initializeTimeoutMs,
        'initialize',
      )
    } catch (error) {
      handle.terminate()
      throw new Error(`the language server did not initialize: ${String(error)}`)
    }
    connection.notify('initialized', {})
    session.frames.push({ kind: 'started', langId })
    return session
  }

  /**
   * Publish one file's whole text, or close it with `null`.
   * @param path - workspace-relative file path.
   * @param text - whole file text, or `null` to close the document.
   */
  sync(path: string, text: string | null): void {
    if (this.disposed) return
    const uri = pathToFileURL(this.absolute(path)).href
    if (text === null) {
      this.versions.delete(path)
      this.connection.notify('textDocument/didClose', { textDocument: { uri } })
      return
    }
    const version = (this.versions.get(path) ?? 0) + 1
    this.versions.set(path, version)
    this.connection.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'typescript', version, text },
    })
  }

  /**
   * Request completions at one position.
   * @param path - workspace-relative file path.
   * @param line - zero-based line.
   * @param character - zero-based UTF-16 column.
   * @returns normalized completion items; empty on failure.
   */
  async complete(path: string, line: number, character: number): Promise<readonly CodeCompletionItem[]> {
    if (this.disposed) return []
    try {
      const reply = await withDeadline(
        this.connection.request('textDocument/completion', {
          textDocument: { uri: pathToFileURL(this.absolute(path)).href },
          position: { line, character },
        }),
        this.limits.completionTimeoutMs,
        'completion',
      ) as { items?: unknown } | unknown[] | null
      const items = Array.isArray(reply) ? reply : reply?.items
      if (!Array.isArray(items)) return []
      return items.map((item) => {
        const entry = item as {
          label?: unknown
          kind?: unknown
          detail?: unknown
          insertText?: unknown
          textEdit?: { newText?: unknown }
        }
        const label = typeof entry.label === 'string' ? entry.label : ''
        return {
          label,
          kind: typeof entry.kind === 'number' ? entry.kind : 1,
          detail: typeof entry.detail === 'string' ? entry.detail : null,
          insertText: typeof entry.textEdit?.newText === 'string' ? entry.textEdit.newText
            : typeof entry.insertText === 'string' ? entry.insertText
              : label,
        }
      })
    } catch {
      return []
    }
  }

  /**
   * Request hover text at one position.
   * @param path - workspace-relative file path.
   * @param line - zero-based line.
   * @param character - zero-based UTF-16 column.
   * @returns joined hover text, or `null` when the server has none.
   */
  async hover(path: string, line: number, character: number): Promise<string | null> {
    if (this.disposed) return null
    try {
      const reply = await withDeadline(
        this.connection.request('textDocument/hover', {
          textDocument: { uri: pathToFileURL(this.absolute(path)).href },
          position: { line, character },
        }),
        this.limits.hoverTimeoutMs,
        'hover',
      ) as { contents?: unknown } | null
      if (reply === null) return null
      const text = hoverText(reply.contents)
      return text === '' ? null : text
    } catch {
      return null
    }
  }

  /** Terminate the server and end the frame queue. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.terminate()
    this.frames.end()
  }

  /** Host-absolute path of one workspace-relative file. */
  private absolute(path: string): string {
    return resolvePath(this.workspace.canonical, path)
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== 'textDocument/publishDiagnostics') return
    const notice = params as { uri?: unknown; diagnostics?: unknown }
    if (typeof notice.uri !== 'string' || !Array.isArray(notice.diagnostics)) return
    const absolute = notice.uri.startsWith('file://') ? decodeURIComponent(new URL(notice.uri).pathname) : notice.uri
    const root = this.workspace.canonical
    const path = absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute
    const diagnostics: CodeDiagnostic[] = []
    for (const raw of notice.diagnostics) {
      const entry = raw as {
        severity?: unknown
        message?: unknown
        code?: unknown
        range?: { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } }
      }
      if (typeof entry.message !== 'string') continue
      diagnostics.push({
        line: numberOr(entry.range?.start?.line, 0),
        character: numberOr(entry.range?.start?.character, 0),
        endLine: numberOr(entry.range?.end?.line, 0),
        endCharacter: numberOr(entry.range?.end?.character, 0),
        severity: entry.severity === 1 ? 'error' : entry.severity === 2 ? 'warning' : 'info',
        message: entry.message,
        code: typeof entry.code === 'string' || typeof entry.code === 'number' ? String(entry.code) : null,
      })
    }
    this.frames.push({ kind: 'diagnostics', path, diagnostics })
  }
}

/** A number from an untrusted field, or the fallback. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** The `createRequire` of this module, resolving bundled servers against the installed package. */
const ownRequire = createRequire(import.meta.url)

/**
 * Resolve the language-server argv. The default command runs this package's
 * bundled `typescript-language-server` through the current Node executable, so
 * no PATH entry is needed; an explicit command resolves its first word on the
 * subprocess PATH instead.
 * @param ctx - Host context carrying the subprocess service.
 * @param limits - service-configured server command.
 * @param signal - aborts the PATH resolution.
 * @returns the argv to spawn.
 * @throws {Error} when the bundled server is not installed or the command cannot be resolved.
 */
async function languageServerArgv(
  ctx: Context, limits: LangLimits, signal: AbortSignal,
): Promise<readonly string[]> {
  const [name, ...rest] = limits.serverCommand
  if (name !== 'typescript-language-server') {
    return [await ctx.subprocess.resolveExecutable(name ?? '', undefined, signal), ...rest]
  }
  const manifest = ownRequire.resolve('typescript-language-server/package.json')
  const entry = resolvePath(dirname(manifest), 'lib', 'cli.mjs')
  const node = await ctx.subprocess.resolveExecutable('node', undefined, signal)
  return [node, entry, ...rest]
}

/** Flatten LSP hover contents into display text. */
function hoverText(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(hoverText).filter(text => text !== '').join('\n\n')
  if (typeof contents !== 'object' || contents === null) return ''
  const value = (contents as { value?: unknown }).value
  return typeof value === 'string' ? value : ''
}

/** Reject a promise that has not settled within `ms`. */
function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error(`${what} timed out after ${ms}ms`)) }, ms) }),
  ])
}
