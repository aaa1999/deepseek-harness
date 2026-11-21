/**
 * One debug session: the entry file launched under `node --inspect-brk`
 * behind the workspace sandbox, a CDP connection to its inspector, and the
 * frame queue the Remote streams to the panel. Type-stripped sources keep
 * their line numbers, so wire lines equal editor lines with no source maps.
 *
 * Console output travels as process stdout/stderr only; `Runtime` console
 * events are ignored so `console.log` is never delivered twice.
 */

import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { CdpConnection } from './cdp.ts'
import type { AdmittedWorkspace } from './paths.ts'
import { displayPath } from './paths.ts'
import type { CodeCallFrame, CodeDebugCommand, CodeDebugFrame, CodeScope, CodeVariable } from './types.ts'

/** Service-configured limits of one debug session. */
export interface DebugLimits {
  readonly graceMs: number
  /** Call frames reported per pause. */
  readonly maxCallFrames: number
  /** Scopes reported per call frame; the global scope is never expanded. */
  readonly maxScopesPerFrame: number
  /** Variables reported per scope. */
  readonly maxVariablesPerScope: number
  /** Character cap of one variable preview. */
  readonly maxPreviewChars: number
  /** Deadline for collecting one pause's variables. */
  readonly pausedCollectTimeoutMs: number
}

/** Startup banner segment carrying the inspector WebSocket URL. */
const LISTENING_RE = /Debugger listening on (ws:\/\/\S+)/

/** One CDP `RemoteObject`, as far as previews read it. */
interface RemoteObject {
  readonly type?: string
  readonly value?: unknown
  readonly description?: string
  readonly objectId?: string
}

/**
 * Bounded frame queue between session callbacks and the Remote stream.
 * Pushes after `end` are dropped; the drain ends once the queue is empty and
 * ended, or the signal aborts.
 */
export class FrameQueue<Item> {
  private readonly items: Item[] = []
  private readonly waiters: Array<(settled: boolean) => void> = []
  private ended = false

  /** Queue one item for the next drain step. */
  push(item: Item): void {
    if (this.ended) return
    this.items.push(item)
    this.waiters.splice(0).forEach((waiter) => { waiter(true) })
  }

  /** End the queue; drain steps stop once empty. */
  end(): void {
    this.ended = true
    this.waiters.splice(0).forEach((waiter) => { waiter(true) })
  }

  /**
   * Yield queued items in order.
   * @param signal - stops the drain without ending the queue.
   */
  async *drain(signal: AbortSignal): AsyncGenerator<Item> {
    while (!signal.aborted) {
      while (this.items.length > 0) {
        yield this.items.shift() as Item
      }
      if (this.ended) return
      await new Promise<boolean>((resolve) => {
        // The abort may have landed while a yield held this drain; a listener
        // registered after that never fires, so check first.
        if (signal.aborted) {
          resolve(true)
          return
        }
        this.waiters.push(resolve)
        signal.addEventListener('abort', () => { resolve(true) }, { once: true })
      })
    }
  }
}

/**
 * One live debug session. Construction spawns the child, connects to its
 * inspector, enables the domains, installs the initial breakpoints, and leaves
 * the child stopped at its entry (the `--inspect-brk` pause) until a `resume`
 * command. Domain events become frames on {@link DebugSession.frames}.
 */
export class DebugSession {
  readonly frames = new FrameQueue<CodeDebugFrame>()
  private readonly scripts = new Map<string, string>()
  private readonly breakpointLines = new Map<string, { readonly path: string; readonly line: number }>()
  private readonly perPathBreakpoints = new Map<string, string[]>()
  private connection: CdpConnection | null = null
  private disposed: boolean = false

  private constructor(
    private readonly ctx: Context,
    private readonly limits: DebugLimits,
    private readonly workspace: AdmittedWorkspace,
    private readonly child: {
      terminate(): void
      readonly done: Promise<{ exitCode: number | null; signal: string | null }>
    },
  ) {}

  /**
   * Spawn and wire one debug session.
   * @param ctx - Host context carrying the subprocess and sandbox services.
   * @param limits - service-configured caps.
   * @param workspace - admitted workspace root; the child runs confined to it.
   * @param entryAbsolute - host-absolute entry file path.
   * @param debugId - controller-assigned id the `started` frame carries.
   * @param initialBreakpoints - line breakpoints to install before the first resume.
   * @param signal - aborting terminates the child and ends the frame queue.
   * @returns the started session; its first frame is `started`.
   * @throws {RemoteError} `codeStudio/debug-failed` when spawning, confinement, or the inspector handshake fails.
   */
  static async start(
    ctx: Context,
    limits: DebugLimits,
    workspace: AdmittedWorkspace,
    entryAbsolute: string,
    debugId: string,
    initialBreakpoints: readonly { readonly path: string; readonly line: number }[],
    signal: AbortSignal,
  ): Promise<DebugSession> {
    signal.throwIfAborted()
    const executable = await ctx.subprocess.resolveExecutable('node', undefined, signal).catch((error: unknown) => {
      throw new RemoteError('codeStudio/debug-failed', `cannot resolve node: ${String(error)}`, {})
    })
    const argv = (await ctx.sandbox.confine(
      [executable, '--inspect-brk=127.0.0.1:0', entryAbsolute],
      { mode: 'workspace-write', workspaceRoot: workspace.canonical },
      signal,
    )).argv
    signal.throwIfAborted()
    const handle = ctx.subprocess.spawn({
      argv,
      cwd: workspace.canonical,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: limits.graceMs,
      signal,
    })
    if (handle.stdout === undefined || handle.stderr === undefined) {
      handle.terminate()
      throw new RemoteError('codeStudio/debug-failed', 'the subprocess provider gave the debug child no output pipes', {})
    }
    const session = new DebugSession(ctx, limits, workspace, {
      terminate: () => { handle.terminate() },
      done: handle.done,
    })
    let resolveUrl: (url: string) => void = () => {}
    let rejectUrl: (error: Error) => void = () => {}
    const url = new Promise<string>((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject })
    const bannerTimer = setTimeout(() => { rejectUrl(new Error('the debugger did not report its inspector URL')) }, 15_000)
    signal.addEventListener('abort', () => { rejectUrl(new Error('debug start was cancelled')) }, { once: true })
    pumpText(handle.stderr, (text) => {
      const match = LISTENING_RE.exec(text)
      if (match !== null) {
        clearTimeout(bannerTimer)
        resolveUrl(match[1] as string)
        return
      }
      if (text.includes('Waiting for the debugger to disconnect')) {
        // The entry finished; Node holds the child open only while the
        // inspector stays connected, so dropping it lets the child exit.
        session.finish()
        return
      }
      if (!text.includes('Debugger attached') && !text.includes('For help')) session.frames.push({ kind: 'stderr', text })
    })
    pumpText(handle.stdout, (text) => { session.frames.push({ kind: 'stdout', text }) })
    void session.child.done.then((outcome) => {
      session.frames.push({ kind: 'exit', exitCode: outcome.exitCode, signal: outcome.signal })
      session.dispose('exited')
    })
    let inspector: CdpConnection
    try {
      inspector = await CdpConnection.open(await url, {
        onEvent: (method, params) => { void session.onEvent(method, params) },
        onClosed: () => { session.child.terminate() },
      })
    } catch (error) {
      clearTimeout(bannerTimer)
      handle.terminate()
      throw new RemoteError('codeStudio/debug-failed', String(error), {})
    }
    session.connection = inspector
    await inspector.send('Runtime.enable')
    await inspector.send('Debugger.enable')
    session.frames.push({ kind: 'started', debugId })
    for (const breakpoint of initialBreakpoints) {
      await session.applyBreakpoints(breakpoint.path, [breakpoint.line])
    }
    // --inspect-brk holds the child before its entry module loads; releasing
    // here runs it into the freshly installed breakpoints, so the first stop
    // is the entry line the panel asked to debug.
    await inspector.send('Runtime.runIfWaitingForDebugger')
    return session
  }

  /**
   * Apply one debugger command.
   * @param command - command addressed to this session.
   * @throws {RemoteError} `codeStudio/debug-command-failed` when the protocol call fails.
   */
  async command(command: CodeDebugCommand): Promise<void> {
    const connection = this.connection
    if (connection === null || this.disposed) return
    try {
      switch (command.kind) {
        case 'resume':
          await connection.send('Debugger.resume')
          return
        case 'pause':
          await connection.send('Debugger.pause')
          return
        case 'stepOver':
          await connection.send('Debugger.stepOver')
          return
        case 'stepInto':
          await connection.send('Debugger.stepInto')
          return
        case 'stepOut':
          await connection.send('Debugger.stepOut')
          return
        case 'stop':
          this.child.terminate()
          return
        case 'setBreakpoints':
          await this.applyBreakpoints(command.path, command.lines)
          return
      }
    } catch (error) {
      throw new RemoteError('codeStudio/debug-command-failed', String(error), {})
    }
  }

  /** The entry finished running; drop the inspector so the child can exit, with termination as the backstop. */
  finish(): void {
    if (this.disposed) return
    this.disposed = true
    this.connection?.dispose()
    setTimeout(() => { this.child.terminate() }, 2_000)
    void this.child.done.finally(() => { this.frames.end() })
  }

  /** Terminate the child and close the connection; the queue ends with the exit frame. */
  dispose(reason: string): void {
    if (this.disposed) return
    this.disposed = true
    this.connection?.dispose()
    this.child.terminate()
    void this.child.done.finally(() => { this.frames.end() })
    this.ctx.logger.info(`code-studio: debug session ended: ${reason}`)
  }

  private async onEvent(method: string, params: unknown): Promise<void> {
    if (method === 'Debugger.scriptParsed') {
      const parsed = params as { scriptId?: unknown; url?: unknown }
      if (typeof parsed.scriptId === 'string' && typeof parsed.url === 'string') this.scripts.set(parsed.scriptId, parsed.url)
      return
    }
    if (method === 'Debugger.paused') {
      await this.collectPaused(params as Record<string, unknown>)
      return
    }
    if (method === 'Debugger.resumed') {
      this.frames.push({ kind: 'resumed' })
      return
    }
    if (method === 'Debugger.breakpointResolved') {
      const resolved = params as { breakpointId?: unknown; location?: { scriptId?: unknown; lineNumber?: unknown } }
      const id = typeof resolved.breakpointId === 'string' ? resolved.breakpointId : undefined
      const entry = id === undefined ? undefined : this.breakpointLines.get(id)
      if (entry !== undefined) {
        const lines = [...(this.perPathBreakpoints.get(entry.path) ?? [])]
          .map(breakpointId => this.breakpointLines.get(breakpointId))
          .filter((line): line is { path: string; line: number } => line !== undefined)
        const states = lines.map(() => 'active' as const)
        this.frames.push({ kind: 'breakpoints', path: entry.path, states })
      }
      return
    }
    if (method === 'Runtime.exceptionThrown') {
      const details = (params as { exceptionDetails?: { text?: unknown; exception?: RemoteObject } }).exceptionDetails
      const exception = details?.exception
      const detailText = typeof details?.text === 'string' ? details.text : 'exception'
      const text = `${detailText}${exception?.description === undefined ? '' : `: ${exception.description}`}`
      this.frames.push({ kind: 'console', level: 'error', text: `${text}\n` })
    }
  }

  private async collectPaused(params: Record<string, unknown>): Promise<void> {
    const connection = this.connection
    if (connection === null) return
    const rawFrames = Array.isArray(params.callFrames) ? params.callFrames as Record<string, unknown>[] : []
    const selected = rawFrames.slice(0, this.limits.maxCallFrames)
    const callFrames = await Promise.race([
      Promise.all(selected.map(async frame => await this.callFrame(connection, frame))),
      new Promise<CodeCallFrame[]>((resolve) => {
        setTimeout(() => { resolve(selected.map(frame => this.callFrameSkeleton(frame))) }, this.limits.pausedCollectTimeoutMs)
      }),
    ])
    this.frames.push({
      kind: 'paused',
      reason: typeof params.reason === 'string' ? params.reason : '',
      callFrames,
    })
  }

  private callFrameSkeleton(frame: Record<string, unknown>): CodeCallFrame {
    const location = frame.location as { scriptId?: unknown; lineNumber?: unknown; columnNumber?: unknown } | undefined
    const url = location !== undefined && typeof location.scriptId === 'string' ? this.scripts.get(location.scriptId) ?? '' : ''
    const absolute = url.startsWith('file://') ? fileUrlToAbsolutePath(url) : url
    return {
      path: displayPath(this.workspace, absolute),
      line: typeof location?.lineNumber === 'number' ? location.lineNumber : 0,
      column: typeof location?.columnNumber === 'number' ? location.columnNumber : 0,
      functionName: typeof frame.functionName === 'string' ? frame.functionName : '',
      scopes: [],
    }
  }

  private async callFrame(connection: CdpConnection, frame: Record<string, unknown>): Promise<CodeCallFrame> {
    const skeleton = this.callFrameSkeleton(frame)
    const scopes = Array.isArray(frame.scopeChain) ? frame.scopeChain as Record<string, unknown>[] : []
    const expanded: CodeScope[] = []
    for (const scope of scopes) {
      if (expanded.length >= this.limits.maxScopesPerFrame) break
      if (scope.type === 'global') continue
      const object = scope.object as RemoteObject | undefined
      if (object?.objectId === undefined) continue
      try {
        const properties = await connection.send('Runtime.getProperties', {
          objectId: object.objectId,
          ownProperties: true,
          generatePreview: false,
        }) as { result?: Array<{ name?: unknown; value?: RemoteObject }> }
        const variables: CodeVariable[] = []
        let truncated = false
        for (const property of properties.result ?? []) {
          if (variables.length >= this.limits.maxVariablesPerScope) {
            truncated = true
            break
          }
          const value = property.value
          variables.push({
            name: typeof property.name === 'string' ? property.name : '',
            value: value === undefined ? 'undefined' : preview(value, this.limits.maxPreviewChars),
            type: typeof value?.type === 'string' ? value.type : null,
          })
        }
        expanded.push({ name: typeof scope.type === 'string' ? scope.type : '', variables, truncated })
      } catch {
        // A scope that fails to expand must not lose the rest of the pause.
      }
    }
    return { ...skeleton, scopes: expanded }
  }

  private async applyBreakpoints(path: string, lines: readonly number[]): Promise<void> {
    const connection = this.connection
    if (connection === null || this.disposed) return
    for (const id of this.perPathBreakpoints.get(path) ?? []) {
      this.breakpointLines.delete(id)
      await connection.send('Debugger.removeBreakpoint', { breakpointId: id }).catch(() => {})
    }
    this.perPathBreakpoints.set(path, [])
    const target = await this.ctx.fs.resolve(path, { cwd: this.workspace.canonical })
    const url = pathToFileURL(target.displayPath).href
    const states: ('active' | 'pending')[] = []
    for (const line of lines) {
      const reply = await connection.send('Debugger.setBreakpointByUrl', {
        lineNumber: line,
        columnNumber: 0,
        url,
      }) as { breakpointId?: unknown; actualLocation?: unknown }
      if (typeof reply.breakpointId === 'string') {
        this.perPathBreakpoints.get(path)?.push(reply.breakpointId)
        this.breakpointLines.set(reply.breakpointId, { path, line })
        states.push(reply.actualLocation === undefined ? 'pending' : 'active')
      }
    }
    this.frames.push({ kind: 'breakpoints', path, states })
  }
}

/** Decode and forward one child pipe as text lines until it ends. */
function pumpText(pipe: AsyncIterable<Uint8Array>, deliver: (text: string) => void): void {
  const decoder = new TextDecoder()
  void (async () => {
    for await (const chunk of pipe) {
      const text = decoder.decode(chunk, { stream: true })
      if (text.length > 0) deliver(text)
    }
  })().catch(() => {})
}

/** Render one CDP value as a short preview string. */
function preview(value: RemoteObject, maxChars: number): string {
  const text = value.type === 'string' && typeof value.value === 'string'
    ? JSON.stringify(value.value)
    : value.description ?? String(value.value)
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/** Convert a `file://` URL to a host absolute path. */
function fileUrlToAbsolutePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
