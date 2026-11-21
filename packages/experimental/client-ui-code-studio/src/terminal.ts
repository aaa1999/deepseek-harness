/**
 * One interactive shell in a workspace: a sandbox-confined PTY whose output
 * streams to the Remote caller as text frames, with typed input and resize
 * addressed by the id of the stream's first `started` frame.
 */

import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { FrameQueue } from './debug.ts'
import type { AdmittedWorkspace } from './paths.ts'
import type { CodeTerminalFrame } from './types.ts'

/** The terminal type advertised to the child through `TERM`. */
const TERMINAL_TYPE = 'xterm-256color'

/**
 * One live workspace terminal. Construction spawns the shell; the frame queue
 * carries the whole PTY output stream until the shell exits or the stream
 * aborts, which terminates the shell.
 */
export class WorkspaceTerminal {
  /** Terminal frames of this session; shell exit ends it with the exit frame. */
  readonly frames = new FrameQueue<CodeTerminalFrame>()
  private disposed = false

  private constructor(
    private readonly deliver: (data: string) => Promise<void>,
    private readonly resizeTo: (cols: number, rows: number) => Promise<void>,
    private readonly terminate: () => void,
    done: Promise<{ exitCode: number | null; signal: string | null }>,
  ) {
    void done.then((outcome) => {
      this.frames.push({ kind: 'exit', exitCode: outcome.exitCode, signal: outcome.signal })
      this.dispose()
    }).catch(() => {
      this.frames.push({ kind: 'exit', exitCode: null, signal: null })
      this.dispose()
    })
  }

  /**
   * Spawn one workspace shell.
   * @param ctx - Host context carrying the subprocess and sandbox services.
   * @param graceMs - TERM-to-KILL cleanup grace.
   * @param workspace - admitted workspace root; the shell runs confined to it.
   * @param terminalId - controller-assigned id the `started` frame carries.
   * @param cols - initial column count.
   * @param rows - initial row count.
   * @param signal - aborting terminates the shell and ends the frame queue.
   * @returns the started terminal; its first frame is `started`.
   * @throws {RemoteError} `codeStudio/terminal-failed` when the shell cannot be resolved, confined, or spawned.
   */
  static async start(
    ctx: Context,
    graceMs: number,
    workspace: AdmittedWorkspace,
    terminalId: string,
    cols: number,
    rows: number,
    signal: AbortSignal,
  ): Promise<WorkspaceTerminal> {
    signal.throwIfAborted()
    const environment = await ctx.subprocess.terminalEnvironment(signal)
    const shell = environment.defaultShell
    if (shell === undefined) {
      throw new RemoteError('codeStudio/terminal-failed', 'the subprocess provider named no default shell', {})
    }
    const argv = (await ctx.sandbox.confine(
      [shell],
      { mode: 'workspace-write', workspaceRoot: workspace.canonical },
      signal,
    )).argv
    const handle = await ctx.subprocess.spawnTerminal({
      argv,
      cwd: workspace.canonical,
      cols: Math.max(1, Math.floor(cols)),
      rows: Math.max(1, Math.floor(rows)),
      terminalType: TERMINAL_TYPE,
      graceMs,
      signal,
    })
    const terminal = new WorkspaceTerminal(
      data => handle.write(data),
      (cols, rows) => handle.resize(cols, rows),
      () => { handle.terminate() },
      handle.done,
    )
    signal.addEventListener('abort', () => { terminal.dispose() }, { once: true })
    const decoder = new TextDecoder()
    handle.output.on('data', (chunk: Uint8Array) => {
      const text = decoder.decode(chunk, { stream: true })
      if (text.length > 0) terminal.frames.push({ kind: 'output', text })
    })
    handle.output.on('end', () => { decoder.decode() })
    terminal.frames.push({ kind: 'started', terminalId })
    return terminal
  }

  /**
   * Deliver typed text to the shell.
   * @param data - text without implicit newline conversion.
   */
  async input(data: string): Promise<void> {
    if (this.disposed) return
    await this.deliver(data)
  }

  /**
   * Change the terminal dimensions.
   * @param cols - positive column count.
   * @param rows - positive row count.
   */
  async resize(cols: number, rows: number): Promise<void> {
    if (this.disposed) return
    await this.resizeTo(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)))
  }

  /** Terminate the shell and end the frame queue with the exit frame. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.terminate()
    this.frames.end()
  }
}
