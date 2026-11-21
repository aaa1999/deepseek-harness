/**
 * Real-process smoke test of one run and one debug session against plain
 * `node` executing type-stripped `.ts` fixtures through the local provider
 * stack: the run stream must deliver stdout and a zero exit; the debug
 * session must pause on its entry breakpoint and finish after resume.
 *
 * Skips on hosts where the local provider stack is unavailable.
 */

import { realpathSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { expect, it, onTestFinished } from 'vitest'
import { DebugSession } from '../src/debug.ts'
import type { DebugLimits } from '../src/debug.ts'
import { runWorkspaceEntry } from '../src/run.ts'
import type { RunLimits } from '../src/run.ts'

/** Mount the local provider stack and return the context, or `null` when it is unavailable. */
async function localContext(): Promise<Context | null> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  try {
    if (!ctx.get('fs')) await ctx.plugin(FileSystem)
    if (!ctx.get('subprocess')) await ctx.plugin(Subprocess)
    if (!ctx.get('sandbox')) await ctx.plugin(Sandbox, {})
  } catch {
    return null
  }
  return ctx
}

/** One temporary workspace directory under the OS home, cleaned after the test. */
async function tempWorkspace(prefix: string): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(homedir(), `.${prefix}-`)))
  onTestFinished(async () => { await rm(dir, { recursive: true, force: true }) })
  return dir
}

it('streams stdout and a zero exit of a type-stripped entry', { timeout: 30_000 }, async (context) => {
  const ctx = await localContext()
  if (ctx === null) return context.skip()
  const dir = await tempWorkspace('code-studio-run')
  const entry = join(dir, 'entry.ts')
  await writeFile(entry, 'const note: string = "ran"\nconsole.log(note)\n')
  const limits: RunLimits = {
    runtimeCommand: ['node'],
    defaultTimeoutMs: 15_000,
    maxTimeoutMs: 15_000,
    maxOutputBytes: 65_536,
    graceMs: 1_000,
  }
  const frames: string[] = []
  const workspace = { canonical: dir, target: await ctx.fs.resolve(dir) }
  for await (const frame of runWorkspaceEntry(ctx, limits, workspace, entry, undefined, new AbortController().signal)) {
    frames.push(frame.kind)
    if (frame.kind === 'stdout') frames.push(frame.text.trimEnd())
    if (frame.kind === 'exit') {
      expect(frame.exitCode).toBe(0)
      expect(frame.timedOut).toBe(false)
    }
  }
  expect(frames).toContain('ran')
})

it('pauses on the entry breakpoint and finishes after resume', { timeout: 60_000 }, async (context) => {
  const ctx = await localContext()
  if (ctx === null) return context.skip()
  const dir = await tempWorkspace('code-studio-debug')
  const entry = join(dir, 'entry.ts')
  await writeFile(entry, 'const value: number = 21\nconsole.log(value * 2)\n')
  const limits: DebugLimits = {
    graceMs: 1_000,
    maxCallFrames: 5,
    maxScopesPerFrame: 3,
    maxVariablesPerScope: 20,
    maxPreviewChars: 200,
    pausedCollectTimeoutMs: 5_000,
  }
  const controller = new AbortController()
  const session = await DebugSession.start(
    ctx, limits, { canonical: dir, target: await ctx.fs.resolve(dir) }, entry, 'debug-1',
    [{ path: 'entry.ts', line: 0 }], controller.signal,
  )
  const seen: string[] = []
  let firstPause = true
  const drain = (async () => {
    for await (const frame of session.frames.drain(controller.signal)) {
      seen.push(frame.kind)
      if (frame.kind === 'paused' && firstPause) {
        firstPause = false
        expect(frame.callFrames.length).toBeGreaterThan(0)
        const top = frame.callFrames[0]
        expect(top?.path).toBe('entry.ts')
      }
    }
  })()
  await expect.poll(() => seen.includes('paused'), { timeout: 20_000 }).toBe(true)
  await session.command({ kind: 'resume' })
  await expect.poll(() => seen.includes('stdout'), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => seen.includes('exit'), { timeout: 10_000 }).toBe(true)
  controller.abort()
  await drain
})
