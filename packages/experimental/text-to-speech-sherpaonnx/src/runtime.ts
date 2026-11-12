/** Verified runtime assets and managed command execution for local synthesis. */
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, readFileSync } from 'node:fs'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import type { SynthesisPreparationState } from '@deepseek-ai/dsh-text-to-speech/types'
import { timeoutOf } from '@deepseek-ai/dsh-timeout'
import { classifyDownloadFailure, SynthesisDownloadError } from './download-error.ts'

/** Release-pinned downloadable file. */
export interface Asset {
  readonly name: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
}

/** A verified file inside the downloadable archive; no standalone download URL exists. */
export interface InnerAsset {
  readonly name: string
  readonly sha256: string
  readonly bytes: number
}

export interface RuntimeLock {
  /** The upstream release archive containing every model file. */
  archive: Asset
  /** The three files the synthesizer loads, extracted from the archive. */
  model: InnerAsset
  lexicon: InnerAsset
  tokens: InnerAsset
}

/** Prepared model and process paths, private to the local provider. */
export interface RuntimePaths {
  readonly model: string
  readonly lexicon: string
  readonly tokens: string
  readonly worker: string
}

async function matchesAsset(path: string, asset: { sha256: string; bytes: number }, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Synthesis asset is not a regular file: ${path}`)
    if (info.size !== asset.bytes) return false
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer)
    return digest.digest('hex') === asset.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

function resolveRuntime(config: Config) {
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
  if (!supported.includes(`${process.platform}-${process.arch}`)) throw new Error(`Local synthesis is unavailable for ${process.platform}-${process.arch}`)
  const lock = JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as RuntimeLock
  const modelRoot = config.modelDirectory ?? join(config.dataRoot, 'models', 'vits-melo')
  const paths: RuntimePaths = {
    model: join(modelRoot, lock.model.name), lexicon: join(modelRoot, lock.lexicon.name),
    tokens: join(modelRoot, lock.tokens.name),
    /* v8 ignore next -- built worker resolution is exercised by real Node and Electron process smokes */
    worker: fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)),
  }
  return { lock, modelRoot, paths }
}

async function verifyRuntime(config: Config, paths: RuntimePaths, lock: RuntimeLock, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try { await Promise.all([paths.model, paths.lexicon, paths.tokens].map(path => access(path))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
  const verified = config.modelDirectory === undefined
    ? [[paths.model, lock.model], [paths.lexicon, lock.lexicon], [paths.tokens, lock.tokens]] as const
    : []
  for (const [path, asset] of verified) if (!await matchesAsset(path, asset, signal)) return false
  signal.throwIfAborted()
  return true
}

/**
 * Inspect existing models without downloading, writing files or starting the worker.
 * @param config - model paths and synthesis settings.
 * @param signal - provider cancellation or inspection deadline.
 * @returns cached paths when all files exist and managed assets match their pinned size and hash; otherwise undefined.
 */
export async function inspectRuntime(config: Config, signal: AbortSignal): Promise<RuntimePaths | undefined> {
  const { lock, paths } = resolveRuntime(config)
  return await verifyRuntime(config, paths, lock, signal) ? paths : undefined
}

/**
 * Download into a unique partial file, verify, then publish it atomically.
 * @param asset - pinned release identity.
 * @param root - provider-owned cache directory.
 * @param signal - preparation cancellation.
 * @param report - Host-owned progress publisher.
 * @returns verified local file path; failures carry localized-UI diagnostics through SynthesisDownloadError.
 */
export async function downloadAsset(asset: Asset, root: string, signal: AbortSignal,
  report: (state: SynthesisPreparationState) => void = () => {}): Promise<string> {
  signal.throwIfAborted()
  const destination = join(root, asset.name)
  const partial = `${destination}.${randomUUID()}.part`
  let source = new URL(asset.url).origin
  try {
    await mkdir(root, { recursive: true })
    if (await matchesAsset(destination, asset, signal)) return destination
    try {
      const response = await fetch(asset.url, { signal })
      source = new URL(response.url || asset.url).origin
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new SynthesisDownloadError({ resource: asset.name, source, reason: 'http', status: response.status })
      }
      const digest = createHash('sha256')
      let completedBytes = 0
      const publish = (): void => { report({ phase: 'downloading', resource: asset.name, completedBytes, totalBytes: asset.bytes }) }
      publish()
      const hashing = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        completedBytes += chunk.length
        if (completedBytes > asset.bytes) {
          callback(new SynthesisDownloadError({ resource: asset.name, source, reason: 'integrity' })); return
        }
        digest.update(chunk); publish(); callback(null, chunk)
      } })
      await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
      if (completedBytes !== asset.bytes || digest.digest('hex') !== asset.sha256) {
        throw new SynthesisDownloadError({ resource: asset.name, source, reason: 'integrity' })
      }
      signal.throwIfAborted()
      await rename(partial, destination)
      return destination
    } finally {
      await rm(partial, { force: true })
    }
  } catch (error) {
    const timedOut = timeoutOf(signal)
    if (signal.aborted && !timedOut || error instanceof SynthesisDownloadError) throw error
    throw new SynthesisDownloadError({ resource: asset.name, source,
      ...timedOut ? { reason: 'timeout' } : classifyDownloadFailure(error),
    }, { cause: error })
  }
}

/**
 * Extract the verified archive with the platform tar, which supports bzip2
 * on macOS, Linux and Windows 10+.
 * @param archive - verified archive path.
 * @param directory - existing extraction directory.
 * @param signal - preparation cancellation or deadline.
 */
async function extractArchive(archive: string, directory: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xjf', archive, '-C', directory], { stdio: 'ignore' })
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(new Error(`Unable to extract synthesis model: ${error.message}`, { cause: error }))
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (code === 0) resolve()
      else reject(new Error(`Synthesis model extraction failed with exit code ${String(code)}`))
    })
  })
}

/**
 * Download the pinned release archive, trying configured mirror URLs before
 * the pinned release URL; every candidate must pass the pinned size and hash.
 * @param lock - pinned archive and inner asset identities.
 * @param modelRoot - provider-owned cache directory.
 * @param config - mirror URL policy.
 * @param signal - preparation cancellation.
 * @param report - Host-owned progress publisher.
 * @returns the verified archive path.
 */
export async function downloadArchive(lock: RuntimeLock, modelRoot: string, config: Config, signal: AbortSignal,
  report: (state: SynthesisPreparationState) => void = () => {}): Promise<string> {
  const archive = join(modelRoot, lock.archive.name)
  if (await matchesAsset(archive, lock.archive, signal)) return archive
  const urls = [...new Set([...config.archiveUrls, lock.archive.url])]
  let last: unknown
  for (const [index, url] of urls.entries()) {
    try {
      return await downloadAsset({ ...lock.archive, url }, modelRoot, signal, report)
    } catch (error) {
      last = error
      if (signal.aborted || !(error instanceof SynthesisDownloadError) || error.download.reason === 'storage'
        || error.download.reason === 'unknown' || index === urls.length - 1) throw error
    }
  }
  throw last
}

/**
 * Download the pinned release archive and publish its model files atomically.
 * @param ctx - Host context owning the preparation task.
 * @param config - model paths and download source policy.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @returns verified model and worker paths.
 */
export async function prepareRuntime(_ctx: Context, config: Config, signal: AbortSignal,
  report: (state: SynthesisPreparationState) => void = () => {}): Promise<RuntimePaths> {
  const { lock, modelRoot, paths } = resolveRuntime(config)
  if (config.modelDirectory === undefined) {
    report({ phase: 'checking', step: 'model', startedAt: Date.now() })
    const archive = await downloadArchive(lock, modelRoot, config, signal, (state) => { report({ ...state, step: 'model' }) })
    if (!await verifyRuntime(config, paths, lock, signal)) {
      const extraction = join(modelRoot, `.extract-${randomUUID()}`)
      try {
        await mkdir(extraction, { recursive: true })
        await extractArchive(archive, extraction, signal)
        const member = join(extraction, 'vits-melo-tts-zh_en')
        for (const asset of [lock.model, lock.lexicon, lock.tokens]) {
          await rename(join(member, asset.name), join(modelRoot, asset.name))
        }
      } finally {
        await rm(extraction, { recursive: true, force: true })
      }
    }
  }
  report({ phase: 'checking', step: 'verify', startedAt: Date.now() })
  if (!await verifyRuntime(config, paths, lock, signal)) throw new Error('Synthesis model verification failed: missing or corrupted model files')
  return paths
}
