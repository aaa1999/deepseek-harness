/** TweetController behavior: publish, list order, edit, comments, delete, image reads, and workspace registration. */

import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId as WorkspaceIdType } from '@deepseek-ai/dsh-workspace/types'
import TweetController from '../src/index.ts'
import type { Tweet, TweetId } from '../src/types.ts'

const roots: Context[] = []
const workspaceDirs: string[] = []
const registryCreates: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(workspaceDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const WS_ONE = WorkspaceId('ws-one')
const WS_TWO = WorkspaceId('ws-two')
const WS_CONFIGURED = WorkspaceId('ws-configured')

/**
 * Mount the controller with one temp directory per registered workspace id and
 * one plugin config; the registry double records `create` calls and maps the
 * configured workspace id onto the created path.
 * @param ids - workspace ids to register, each over its own empty temp directory.
 * @param config - plugin config the controller mounts with.
 * @returns the mounted controller.
 */
async function mountController(ids: readonly WorkspaceIdType[], config: { workspacePath: string }): Promise<TweetController> {
  registryCreates.length = 0
  const byId = new Map<WorkspaceIdType, string>()
  for (const id of ids) {
    const dir = await mkdtemp(join(tmpdir(), 'tweet-spec-'))
    workspaceDirs.push(dir)
    byId.set(id, dir)
  }
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceIdType) => {
      const path = byId.get(id)
      return path === undefined ? undefined : { path }
    },
    create: async (path: string) => {
      if (!existsSync(path)) throw new Error(`no such directory: ${path}`)
      registryCreates.push(path)
      byId.set(WS_CONFIGURED, path)
      return { id: WS_CONFIGURED, path, title: 'configured' }
    },
  } as never)
  await ctx.plugin(TweetController, config)
  return ctx.tweet
}

/**
 * Mount the controller with the empty default config over one temp directory
 * per registered workspace id.
 * @param ids - workspace ids to register, each over its own empty temp directory.
 * @returns the mounted controller.
 */
async function harness(...ids: WorkspaceIdType[]): Promise<TweetController> {
  return await mountController(ids, { workspacePath: '' })
}

/** Deterministic image input: fixed bytes so every publish of it shares one digest. */
function imageInput(name?: string) {
  const bytes = Buffer.from('spec-image-bytes')
  return { mediaType: 'image/png' as const, data: bytes.toString('base64'), ...(name === undefined ? {} : { name }) }
}

/** The data root of the n-th temp workspace. */
function root(n: number): string {
  return join(workspaceDirs[n]!, '.dsh', 'tweet')
}

describe('TweetController.publish', () => {
  it('stores text-only posts inside the workspace data directory', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: '  first take  ', images: [] })
    expect(post.text).toBe('first take')
    expect(post.images).toEqual([])
    expect(await readdir(join(root(0), 'posts'))).toEqual([`${post.id}.json`])
    const index = JSON.parse(await readFile(join(root(0), 'index.json'), 'utf8')) as { order: string[] }
    expect(index.order).toEqual([post.id])
  })

  it('stores image bytes content-addressed and deduplicates repeats', async () => {
    const service = await harness(WS_ONE)
    const input = imageInput('shot.png')
    const first = await service.publish({ workspaceId: WS_ONE, text: '', images: [input] })
    const second = await service.publish({ workspaceId: WS_ONE, text: 'again', images: [imageInput()] })
    expect(await readdir(join(root(0), 'objects'))).toHaveLength(1)
    expect(first.images[0]).toMatchObject({ mediaType: 'image/png', bytes: Buffer.from('spec-image-bytes').byteLength, name: 'shot.png' })
    expect(second.images[0]?.name).toBeUndefined()
  })

  it('records measured dimensions when the publisher sends them', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({
      workspaceId: WS_ONE,
      text: 'sized',
      images: [{ ...imageInput(), width: 640, height: 480 }],
    })
    expect(post.images[0]).toMatchObject({ width: 640, height: 480 })
  })

  it('rejects an unknown workspace, an empty post, and an unsupported image type', async () => {
    const service = await harness(WS_ONE)
    await expect(service.publish({ workspaceId: WS_TWO, text: 'x', images: [] }))
      .rejects.toMatchObject({ code: 'tweet/unknown-workspace' })
    await expect(service.publish({ workspaceId: WS_ONE, text: '   ', images: [] }))
      .rejects.toMatchObject({ code: 'tweet/empty-post' })
    await expect(service.publish({
      workspaceId: WS_ONE,
      text: 'x',
      images: [{ mediaType: 'image/bmp' as never, data: imageInput().data }],
    })).rejects.toMatchObject({ code: 'tweet/unsupported-image-type' })
  })

  it('reports a typed failure when the workspace path cannot hold the store', async () => {
    const service = await harness(WS_ONE)
    await rm(workspaceDirs[0]!, { recursive: true })
    await writeFile(workspaceDirs[0]!, 'blocks the directory name')
    await expect(service.publish({ workspaceId: WS_ONE, text: 'x', images: [] }))
      .rejects.toMatchObject({ code: 'tweet/corrupt-store' })
  })
})

describe('TweetController.list', () => {
  it('lists newest first and breaks same-millisecond ties in publish order', async () => {
    const service = await harness(WS_ONE)
    const early = await service.publish({ workspaceId: WS_ONE, text: 'early', images: [] })
    const tiedFirst = await service.publish({ workspaceId: WS_ONE, text: 'tied-b', images: [] })
    const between = await service.publish({ workspaceId: WS_ONE, text: 'between', images: [] })
    const tiedAgain = await service.publish({ workspaceId: WS_ONE, text: 'tied-a', images: [] })
    const posts = await service.list(WS_ONE)
    expect(posts.map(post => post.text)).toEqual(['tied-a', 'between', 'tied-b', 'early'])
    expect(posts.map(post => post.id)).toEqual([tiedAgain.id, between.id, tiedFirst.id, early.id])
  })

  it('isolates workspaces and reports an unknown one', async () => {
    const service = await harness(WS_ONE, WS_TWO)
    await service.publish({ workspaceId: WS_ONE, text: 'one', images: [] })
    await service.publish({ workspaceId: WS_TWO, text: 'two', images: [] })
    expect((await service.list(WS_ONE)).map(post => post.text)).toEqual(['one'])
    expect((await service.list(WS_TWO)).map(post => post.text)).toEqual(['two'])
    await expect(service.list(WorkspaceId('ws-none'))).rejects.toMatchObject({ code: 'tweet/unknown-workspace' })
  })

  it('skips invalid post files, heals posts missing from the index, and fails on an invalid index', async () => {
    const service = await harness(WS_ONE)
    const kept = await service.publish({ workspaceId: WS_ONE, text: 'kept', images: [] })
    await writeFile(join(root(0), 'posts', 'tweet-00000000-0000-4000-8000-000000000000.json'), '{ not json')
    const orphan: Tweet = {
      ...kept,
      id: 'tweet-11111111-1111-4111-8111-111111111111' as TweetId,
      text: 'orphan',
      createdAt: kept.createdAt + 1,
    }
    await writeFile(join(root(0), 'posts', `${orphan.id}.json`), JSON.stringify(orphan))
    expect((await service.list(WS_ONE)).map(post => post.text)).toEqual(['orphan', 'kept'])
    await writeFile(join(root(0), 'index.json'), '{ "order": "nope" }')
    await expect(service.list(WS_ONE)).rejects.toMatchObject({ code: 'tweet/corrupt-store' })
  })

  it('breaks same-millisecond ties in index order', async () => {
    const service = await harness(WS_ONE)
    const first = await service.publish({ workspaceId: WS_ONE, text: 'same-ms-first', images: [] })
    const second = await service.publish({ workspaceId: WS_ONE, text: 'same-ms-second', images: [] })
    await writeFile(join(root(0), 'posts', `${first.id}.json`), JSON.stringify({ ...first, createdAt: second.createdAt }))
    expect((await service.list(WS_ONE)).map(post => post.text)).toEqual(['same-ms-second', 'same-ms-first'])
  })
})

describe('TweetController.edit', () => {
  it('replaces text without reordering the feed', async () => {
    const service = await harness(WS_ONE)
    const older = await service.publish({ workspaceId: WS_ONE, text: 'older', images: [] })
    await service.publish({ workspaceId: WS_ONE, text: 'newer', images: [] })
    const edited = await service.edit({ workspaceId: WS_ONE, id: older.id, text: ' rewritten ' })
    expect(edited.text).toBe('rewritten')
    expect(edited.updatedAt).toBeTypeOf('number')
    const posts = await service.list(WS_ONE)
    expect(posts).toHaveLength(2)
    expect(posts[1]?.id).toBe(older.id)
    expect(posts[1]?.text).toBe('rewritten')
    expect(posts[1]?.updatedAt).toBe(edited.updatedAt)
  })

  it('rejects empty text, missing posts, and climbing ids', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'kept', images: [] })
    await expect(service.edit({ workspaceId: WS_ONE, id: post.id, text: '  ' }))
      .rejects.toMatchObject({ code: 'tweet/empty-post' })
    await expect(service.edit({
      workspaceId: WS_ONE,
      id: 'tweet-22222222-2222-4222-8222-222222222222' as TweetId,
      text: 'x',
    })).rejects.toMatchObject({ code: 'tweet/post-not-found' })
    await expect(service.edit({ workspaceId: WS_ONE, id: '../../etc/passwd' as TweetId, text: 'x' }))
      .rejects.toMatchObject({ code: 'tweet/invalid-object-name' })
  })
})

describe('TweetController.comment', () => {
  it('appends comments under one post in order with no count limit', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'opinion', images: [] })
    const first = await service.comment({ workspaceId: WS_ONE, id: post.id, text: '  first take  ' })
    expect(first.comments).toHaveLength(1)
    expect(first.comments[0]).toMatchObject({ text: 'first take' })
    expect(first.comments[0]?.id).toMatch(/^comment-[0-9a-f-]{36}$/)
    for (let index = 2; index <= 40; index += 1) {
      await service.comment({ workspaceId: WS_ONE, id: post.id, text: `reply ${index}` })
    }
    const updated = await service.comment({ workspaceId: WS_ONE, id: post.id, text: 'latest' })
    expect(updated.comments).toHaveLength(41)
    expect(updated.comments.map(comment => comment.text)).toEqual([
      'first take', ...Array.from({ length: 39 }, (_, i) => `reply ${i + 2}`), 'latest',
    ])
    const listed = await service.list(WS_ONE)
    expect(listed[0]?.comments).toHaveLength(41)
    const record = JSON.parse(await readFile(join(root(0), 'posts', `${post.id}.json`), 'utf8')) as { comments: unknown[] }
    expect(record.comments).toHaveLength(41)
  })

  it('keeps comments out of other posts and preserves them across an edit', async () => {
    const service = await harness(WS_ONE)
    const commented = await service.publish({ workspaceId: WS_ONE, text: 'commented', images: [] })
    const quiet = await service.publish({ workspaceId: WS_ONE, text: 'quiet', images: [] })
    await service.comment({ workspaceId: WS_ONE, id: commented.id, text: 'note' })
    const edited = await service.edit({ workspaceId: WS_ONE, id: commented.id, text: 'rewritten' })
    expect(edited.comments.map(comment => comment.text)).toEqual(['note'])
    const listed = await service.list(WS_ONE)
    expect(listed.find(item => item.id === quiet.id)?.comments).toEqual([])
    expect(listed.find(item => item.id === commented.id)?.comments).toHaveLength(1)
  })

  it('reads legacy records without a comments field as zero comments', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'legacy', images: [] })
    const legacy = { id: post.id, text: post.text, images: post.images, createdAt: post.createdAt }
    await writeFile(join(root(0), 'posts', `${post.id}.json`), `${JSON.stringify(legacy)}\n`)
    const listed = await service.list(WS_ONE)
    expect(listed[0]?.comments).toEqual([])
    const commented = await service.comment({ workspaceId: WS_ONE, id: post.id, text: 'revives' })
    expect(commented.comments.map(comment => comment.text)).toEqual(['revives'])
  })

  it('rejects an unknown workspace, an empty comment, and a missing post', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'kept', images: [] })
    await expect(service.comment({ workspaceId: WS_TWO, id: post.id, text: 'x' }))
      .rejects.toMatchObject({ code: 'tweet/unknown-workspace' })
    await expect(service.comment({ workspaceId: WS_ONE, id: post.id, text: '   ' }))
      .rejects.toMatchObject({ code: 'tweet/empty-comment' })
    await expect(service.comment({
      workspaceId: WS_ONE,
      id: 'tweet-33333333-3333-4333-8333-333333333333' as TweetId,
      text: 'x',
    })).rejects.toMatchObject({ code: 'tweet/post-not-found' })
  })
})

describe('TweetController.remove', () => {
  it('deletes once and stays idempotent', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'gone soon', images: [] })
    expect(await service.remove(WS_ONE, post.id)).toBe(true)
    expect(await service.list(WS_ONE)).toEqual([])
    expect(await service.remove(WS_ONE, post.id)).toBe(false)
  })

  it('reports a typed failure when unlinking under the posts path fails', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'blocked', images: [] })
    await rm(join(root(0), 'posts'), { recursive: true })
    await writeFile(join(root(0), 'posts'), 'blocks the directory name')
    await expect(service.remove(WS_ONE, post.id)).rejects.toMatchObject({ code: 'tweet/corrupt-store' })
  })
})

describe('TweetController.image', () => {
  it('reads stored bytes back as base64 with the recorded media type', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'shot', images: [imageInput('shot.png')] })
    const payload = await service.image({ workspaceId: WS_ONE, file: post.images[0]!.file })
    expect(payload.mediaType).toBe('image/png')
    expect(payload.data).toBe(imageInput().data)
  })

  it('rejects names that are not stored objects and reports missing objects', async () => {
    const service = await harness(WS_ONE)
    const post = await service.publish({ workspaceId: WS_ONE, text: 'shot', images: [imageInput()] })
    await expect(service.image({ workspaceId: WS_ONE, file: 'zzz.exe' }))
      .rejects.toMatchObject({ code: 'tweet/invalid-object-name' })
    await expect(service.image({ workspaceId: WS_ONE, file: `${'0'.repeat(64)}.png` }))
      .rejects.toMatchObject({ code: 'tweet/corrupt-store' })
    await rm(join(root(0), 'objects', post.images[0]!.file))
    await expect(service.image({ workspaceId: WS_ONE, file: post.images[0]!.file }))
      .rejects.toMatchObject({ code: 'tweet/corrupt-store' })
  })
})

describe('TweetController workspace registration', () => {
  it('registers no workspace with the empty default config', async () => {
    await harness(WS_ONE)
    expect(registryCreates).toEqual([])
  })

  it('registers the configured absolute folder once and serves posts through it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweet-spec-cfg-'))
    workspaceDirs.push(dir)
    const service = await mountController([], { workspacePath: dir })
    expect(registryCreates).toEqual([dir])
    const post = await service.publish({ workspaceId: WS_CONFIGURED, text: 'configured take', images: [] })
    expect(post.text).toBe('configured take')
    expect(await readdir(join(dir, '.dsh', 'tweet', 'posts'))).toEqual([`${post.id}.json`])
  })

  it('rejects a non-absolute workspacePath loudly at construction', async () => {
    const ctx = new Context()
    roots.push(ctx)
    ctx.provide('workspaceRegistry', { get: () => undefined } as never)
    await expect(ctx.plugin(TweetController, { workspacePath: 'relative/dir' }))
      .rejects.toThrow('tweet: workspacePath must be an absolute directory path when set')
  })
})

describe('TweetController.open', () => {
  it('registers an absolute folder and returns its view for selection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweet-spec-open-'))
    workspaceDirs.push(dir)
    const service = await harness(WS_ONE)
    const view = await service.open({ path: dir })
    expect(view).toMatchObject({ workspaceId: WS_CONFIGURED, path: dir })
    expect(registryCreates).toEqual([dir])
    const post = await service.publish({ workspaceId: WS_CONFIGURED, text: 'opened take', images: [] })
    expect(await readdir(join(dir, '.dsh', 'tweet', 'posts'))).toEqual([`${post.id}.json`])
  })

  it('rejects a blank or relative path with a typed error', async () => {
    const service = await harness(WS_ONE)
    await expect(service.open({ path: 'relative/dir' })).rejects.toMatchObject({ code: 'tweet/invalid-workspace-path' })
    await expect(service.open({ path: '  ' })).rejects.toMatchObject({ code: 'tweet/invalid-workspace-path' })
    expect(registryCreates).toEqual([])
  })

  it('folds a registry refusal into a typed open failure', async () => {
    const service = await harness(WS_ONE)
    await expect(service.open({ path: '/definitely/not/a/directory' }))
      .rejects.toMatchObject({ code: 'tweet/workspace-open-failed' })
  })
})
