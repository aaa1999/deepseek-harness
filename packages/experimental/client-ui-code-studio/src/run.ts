/**
 * One run of a workspace entry file: a sandbox-confined child process whose
 * stdout and stderr stream to the Remote caller as frames until exit, with a
 * deadline that terminates the process and an output cap that stops text
 * delivery while the process keeps running.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { AdmittedWorkspace } from './paths.ts'
import type { CodeRunFrame } from './types.ts'

/** Service-configured limits of one run. */
export interface RunLimits {
  /** Runtime argv prefix ahead of the entry path, `['node']` by default. */
  readonly runtimeCommand: readonly string[]
  readonly defaultTimeoutMs: number
  readonly maxTimeoutMs: number
  /** Per-stream byte cap on delivered output text. */
  readonly maxOutputBytes: number
  readonly graceMs: number
}

/**
 * Run one entry file and stream its lifetime as frames.
 * @param ctx - Host context carrying the sandbox and subprocess services.
 * @param limits - service-configured caps.
 * @param workspace - admitted workspace root; the process runs confined to it.
 * @param entryAbsolute - host-absolute entry file path.
 * @param timeoutMs - caller deadline; clamped to {@link RunLimits.maxTimeoutMs}.
 * @param signal - ends the run: the child terminates and the stream stops.
 * @yields run frames in occurrence order.
 * @throws {RemoteError} `codeStudio/run-failed` when the runtime or sandbox is unavailable.
 */
export async function* runWorkspaceEntry(
  ctx: Context,
  limits: RunLimits,
  workspace: AdmittedWorkspace,
  entryAbsolute: string,
  timeoutMs: number | undefined,
  signal: AbortSignal,
): AsyncGenerator<CodeRunFrame> {
  const timeout = Math.min(timeoutMs ?? limits.defaultTimeoutMs, limits.maxTimeoutMs)
  signal.throwIfAborted()
  const runtime = limits.runtimeCommand
  const runtimeName = runtime[0]
  if (runtimeName === undefined) throw new RemoteError('codeStudio/run-failed', 'the runtime command is empty', {})
  let executable: string
  try {
    executable = await ctx.subprocess.resolveExecutable(runtimeName, undefined, signal)
  } catch (error) {
    throw new RemoteError('codeStudio/run-failed', `cannot resolve the runtime '${runtimeName}': ${String(error)}`, {})
  }
  const policy: SandboxExecutionPolicy = { mode: 'workspace-write', workspaceRoot: workspace.canonical }
  let argv = [executable, ...runtime.slice(1), entryAbsolute]
  if (policy.mode !== 'danger-full-access') {
    const sandbox = ctx.get('sandbox')
    if (sandbox === undefined) {
      throw new RemoteError('codeStudio/run-failed', 'running code requires a sandbox provider', {})
    }
    argv = (await sandbox.confine(argv, { ...policy, mode: policy.mode }, signal)).argv
  }
  signal.throwIfAborted()
  const handle = ctx.subprocess.spawn({
    argv,
    cwd: workspace.canonical,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: limits.graceMs,
    signal,
  })
  const stdout = handle.stdout
  const stderr = handle.stderr
  if (stdout === undefined || stderr === undefined) {
    handle.terminate()
    throw new RemoteError('codeStudio/run-failed', 'the subprocess provider gave the run no output pipes', {})
  }
  yield { kind: 'started', runtime: runtime.join(' ') }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    handle.terminate()
  }, timeout)
  const abort = (): void => { handle.terminate() }
  signal.addEventListener('abort', abort, { once: true })
  const done = handle.done.finally(() => {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  })
  const outText = deliverText(stdout, limits.maxOutputBytes)
  const errText = deliverText(stderr, limits.maxOutputBytes)
  let outEnded = false
  let errEnded = false
  for (;;) {
    const next = await Promise.race([
      ...(outEnded ? [] : [outText.next().then(result => ({ stream: 'stdout' as const, result }))]),
      ...(errEnded ? [] : [errText.next().then(result => ({ stream: 'stderr' as const, result }))]),
      done.then(value => ({ stream: 'exit' as const, value })),
    ])
    if (next.stream === 'exit') {
      void outText.return(undefined)
      void errText.return(undefined)
      yield { kind: 'exit', exitCode: next.value.exitCode, signal: next.value.signal, timedOut }
      return
    }
    // An ended stream leaves the race; polling a finished generator would spin.
    if (next.result.done) {
      if (next.stream === 'stdout') outEnded = true
      else errEnded = true
      continue
    }
    if (next.result.value !== null) yield { kind: next.stream, text: next.result.value }
  }
}

/**
 * Decode a child pipe into text chunks, capped in bytes. Past the cap the
 * stream keeps draining (the child must not block on a full pipe) but yields
 * only `null` placeholders the caller drops.
 * @param pipe - raw readable stdout or stderr.
 * @param maxBytes - inclusive byte cap on delivered text.
 * @returns an async iterator of decoded text, or `null` once capped.
 */
async function* deliverText(pipe: AsyncIterable<Uint8Array>, maxBytes: number): AsyncGenerator<string | null> {
  const decoder = new TextDecoder()
  let delivered = 0
  let capped = false
  for await (const chunk of pipe) {
    if (capped) {
      yield null
      continue
    }
    const text = decoder.decode(chunk, { stream: true })
    delivered += chunk.byteLength
    if (delivered > maxBytes) {
      capped = true
      yield `${text}\n[code-studio] output past ${maxBytes} bytes is dropped\n`
      continue
    }
    if (text.length > 0) yield text
  }
}
