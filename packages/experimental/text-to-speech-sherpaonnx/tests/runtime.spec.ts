/** Archive download fallback across mirror URLs with pinned verification. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { downloadArchive, type RuntimeLock } from '../src/runtime.ts'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function body(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close() },
  })
}

function lock(content: string, mirror: string | undefined): RuntimeLock {
  const hash = createHash('sha256').update(content).digest('hex')
  const bytes = Buffer.byteLength(content)
  const asset = { name: 'archive.tar.bz2', url: 'https://github.com/up/release/archive.tar.bz2',
    sha256: hash, bytes }
  return { archive: mirror === undefined ? asset : { ...asset, url: mirror },
    model: { name: 'model.onnx', sha256: '', bytes: 0 },
    lexicon: { name: 'lexicon.txt', sha256: '', bytes: 0 },
    tokens: { name: 'tokens.txt', sha256: '', bytes: 0 } }
}

it('downloads from the pinned release URL and verifies the archive', async () => {
  const content = 'release archive'
  const pinned = lock(content, undefined)
  const root = await mkdtemp(join(tmpdir(), 'dsh-tts-runtime-'))
  roots.push(root)
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => new Response(body(content), { status: 200 }))
  const path = await downloadArchive(pinned, root, Config({ dataRoot: root, archiveUrls: [] }), new AbortController().signal)
  expect(await readFile(path, 'utf8')).toBe(content)
})

it('falls back to mirror URLs in order until one passes verification', async () => {
  const content = 'mirror bytes'
  const root = await mkdtemp(join(tmpdir(), 'dsh-tts-runtime-'))
  roots.push(root)
  const pinned = { ...lock(content, undefined), archive: { ...lock(content, undefined).archive } }
  const failing = 'https://mirror.example/fails.tar.bz2'
  const working = 'https://mirror.example/works.tar.bz2'
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => new Response('gateway error', { status: 502 }))
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => new Response(body(content), { status: 200 }))
  const path = await downloadArchive(pinned, root, Config({ dataRoot: root, archiveUrls: [failing, working] }),
    new AbortController().signal)
  expect(await readFile(path, 'utf8')).toBe(content)
})

it('rejects corrupted mirror content and keeps trying the next source', async () => {
  const content = 'expected bytes'
  const root = await mkdtemp(join(tmpdir(), 'dsh-tts-runtime-'))
  roots.push(root)
  const pinned = lock(content, undefined)
  const corrupted = 'https://mirror.example/corrupt.tar.bz2'
  const working = 'https://mirror.example/works.tar.bz2'
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => new Response(body('tampered content'), { status: 200 }))
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (target === working) return new Response(body(content), { status: 200 })
    return new Response('not found', { status: 404 })
  })
  const path = await downloadArchive(pinned, root, Config({ dataRoot: root, archiveUrls: [corrupted, working] }),
    new AbortController().signal)
  expect(await readFile(path, 'utf8')).toBe(content)
})

it('throws the last failure when every source fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tts-runtime-'))
  roots.push(root)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('down', { status: 503 }))
  await expect(downloadArchive(lock('x', undefined), root, Config({ dataRoot: root }), new AbortController().signal))
    .rejects.toThrow('Unable to prepare')
})

it('reuses a verified archive without fetching', async () => {
  const content = 'cached archive'
  const root = await mkdtemp(join(tmpdir(), 'dsh-tts-runtime-'))
  roots.push(root)
  const pinned = lock(content, undefined)
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => new Response(body(content), { status: 200 }))
  const archive = join(root, pinned.archive.name)
  const first = await downloadArchive(pinned, root, Config({ dataRoot: root }), new AbortController().signal)
  expect(first).toBe(archive)
  fetchSpy.mockImplementation(async () => { throw new Error('unexpected fetch after caching') })
  const second = await downloadArchive(pinned, root, Config({ dataRoot: root }), new AbortController().signal)
  expect(second).toBe(archive)
})
