// @vitest-environment jsdom
/**
 * Tweets controller state machine: workspace selection with persistence,
 * feed loading and error folding, composer staging (picker and clipboard),
 * publish/edit/delete flows, unlimited per-post comments with the
 * newest-three fold toggle, expansion state, and the Blob-URL image cache.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { fileToStagedImage, imagesFromClipboard, Tweets } from '../src/client/tweets.ts'
import type { TweetsRemoteFace } from '../src/client/tweets.ts'
import { en, zh } from '../src/client/locales.ts'
import type { Tweet, TweetComment, TweetCommentId, TweetId, TweetImagePayload } from '../src/types.ts'

const WS_ONE = brandString<WorkspaceId>('ws-one')
const WS_TWO = brandString<WorkspaceId>('ws-two')

/** Locale-aware renderer over the real dictionaries. */
function format(key: keyof typeof zh, params?: Record<string, unknown>): string {
  let text: string = en[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function failure<T>(message: string): RemoteResult<T> {
  return { ok: false, error: { code: 'tweet/corrupt-store', message } as never }
}

function post(id: string, overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: brandString<TweetId>(id),
    text: `text of ${id}`,
    images: [],
    comments: [],
    createdAt: 1_000,
    ...overrides,
  }
}

/** One appended comment with a distinct identity per call. */
let commentSerial = 0
function comment(text: string, createdAt = 5_000): TweetComment {
  commentSerial += 1
  return { id: brandString<TweetCommentId>(`comment-${String(commentSerial).padStart(4, '0')}`), text, createdAt }
}

/** A png file whose bytes decode through the staging path. */
function pngFile(name = 'shot.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])], name, { type: 'image/png' })
}

type RemoteHarness = {
  readonly remote: TweetsRemoteFace
  readonly listed: Tweet[]
  readonly calls: {
    readonly publish: unknown[]
    readonly edit: unknown[]
    readonly comments: { readonly id: string; readonly text: string }[]
    readonly removed: string[]
    readonly opened: string[]
  }
  failList: boolean
  failOpen: boolean
  failComment: boolean
  /** Workspace id a successful open reports; defaults to a fresh unlisted id. */
  openWorkspaceId: WorkspaceId
}

/** A remote double over one mutable feed. */
function fakeRemote(): RemoteHarness {
  const listed: Tweet[] = []
  const calls = {
    publish: [] as unknown[],
    edit: [] as unknown[],
    comments: [] as { id: string; text: string }[],
    removed: [] as string[],
    opened: [] as string[],
  }
  const harness: RemoteHarness = {
    listed,
    calls,
    failList: false,
    failOpen: false,
    failComment: false,
    openWorkspaceId: brandString<WorkspaceId>('ws-opened'),
    remote: {
      list: async () => harness.failList
        ? failure<Tweet[]>('feed broke')
        : ok([...listed]),
      open: async (request: { readonly path: string }) => {
        if (harness.failOpen) return failure('open broke')
        calls.opened.push(request.path)
        return ok({ workspaceId: harness.openWorkspaceId, path: request.path, title: 'opened' })
      },
      publish: async (request) => {
        calls.publish.push(request)
        const created = post(`tweet-created-${calls.publish.length}`, {
          text: request.text,
          createdAt: 2_000,
        })
        listed.unshift(created)
        return ok(created)
      },
      edit: async (request) => {
        calls.edit.push(request)
        const next = { ...listed.find(item => item.id === request.id)!, text: request.text, updatedAt: 3_000 }
        return ok(next)
      },
      comment: async (request) => {
        if (harness.failComment) return failure('comment broke')
        calls.comments.push({ id: request.id, text: request.text })
        const appended = comment(request.text.trim())
        const index = listed.findIndex(item => item.id === request.id)
        const next = { ...listed[index]!, comments: [...listed[index]!.comments, appended] }
        listed[index] = next
        return ok(next)
      },
      delete: async (_workspaceId, id) => {
        calls.removed.push(id)
        return ok(true)
      },
      image: async () => ok<TweetImagePayload>({ mediaType: 'image/png', data: btoa('object-bytes') }),
    },
  }
  return harness
}

/** Drain pending microtasks so fire-and-forget tasks settle. */
async function flush(): Promise<void> {
  for (let round = 0; round < 8; round += 1) await Promise.resolve()
}

let controller: Tweets | null = null

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  controller?.dispose()
  controller = null
  globalThis.localStorage.clear()
})

describe('workspace selection', () => {
  it('keeps idle without workspaces and selects the first listed one', async () => {
    const { remote } = fakeRemote()
    controller = new Tweets(remote, format)
    controller.syncWorkspaces([])
    expect(controller.getSnapshot().workspaceId).toBeNull()
    controller.syncWorkspaces([
      { workspaceId: WS_ONE, path: '/one', title: 'One' },
      { workspaceId: WS_TWO, path: '/two', title: 'Two' },
    ])
    await flush()
    expect(controller.getSnapshot().workspaceId).toBe(WS_ONE)
    expect(controller.getSnapshot().status).toBe('ready')
    expect(globalThis.localStorage.getItem('dsh.tweet.workspace.v1')).toBe(WS_ONE)
  })

  it('prefers the persisted workspace while it stays listed', async () => {
    globalThis.localStorage.setItem('dsh.tweet.workspace.v1', WS_TWO)
    const { remote } = fakeRemote()
    controller = new Tweets(remote, format)
    controller.syncWorkspaces([
      { workspaceId: WS_ONE, path: '/one', title: 'One' },
      { workspaceId: WS_TWO, path: '/two', title: 'Two' },
    ])
    await flush()
    expect(controller.getSnapshot().workspaceId).toBe(WS_TWO)
  })

  it('falls back to the first row when the persisted workspace disappears', async () => {
    const { remote } = fakeRemote()
    controller = new Tweets(remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.selectWorkspace(WS_TWO)
    await flush()
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    expect(controller.getSnapshot().workspaceId).toBe(WS_ONE)
  })

  it('keeps the current selection while listed and clears it when none remain', async () => {
    const { remote } = fakeRemote()
    controller = new Tweets(remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.syncWorkspaces([
      { workspaceId: WS_ONE, path: '/one', title: 'One' },
      { workspaceId: WS_TWO, path: '/two', title: 'Two' },
    ])
    expect(controller.getSnapshot().workspaceId).toBe(WS_ONE)
    controller.syncWorkspaces([])
    expect(controller.getSnapshot().workspaceId).toBeNull()
    expect(controller.getSnapshot().status).toBe('idle')
  })

  it('survives a localStorage that refuses reads and writes', async () => {
    const native = globalThis.localStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied')
      },
    })
    try {
      const { remote } = fakeRemote()
      controller = new Tweets(remote, format)
      controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
      await flush()
      expect(controller.getSnapshot().workspaceId).toBe(WS_ONE)
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: native })
    }
  })

  it('opens a listed folder immediately and selects it', async () => {
    const harness = fakeRemote()
    harness.openWorkspaceId = WS_TWO
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([
      { workspaceId: WS_ONE, path: '/one', title: 'One' },
      { workspaceId: WS_TWO, path: '/two', title: 'Two' },
    ])
    await flush()
    controller.setOpenPath('  /two  ')
    await controller.openWorkspace()
    await flush()
    expect(harness.calls.opened).toEqual(['/two'])
    expect(controller.getSnapshot().workspaceId).toBe(WS_TWO)
    expect(controller.getSnapshot().openPath).toBe('')
    expect(globalThis.localStorage.getItem('dsh.tweet.workspace.v1')).toBe(WS_TWO)
  })

  it('selects a freshly opened workspace once the list carries it', async () => {
    const harness = fakeRemote()
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setOpenPath('/fresh')
    const opened = controller.openWorkspace()
    await flush()
    expect(controller.getSnapshot().workspaceId).toBe(WS_ONE)
    controller.syncWorkspaces([
      { workspaceId: WS_ONE, path: '/one', title: 'One' },
      { workspaceId: harness.openWorkspaceId, path: '/fresh', title: 'opened' },
    ])
    await opened
    await flush()
    expect(controller.getSnapshot().workspaceId).toBe(harness.openWorkspaceId)
    expect(controller.getSnapshot().status).toBe('ready')
  })

  it('folds an open failure and keeps the input', async () => {
    const harness = fakeRemote()
    harness.failOpen = true
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setOpenPath('/missing')
    await expect(controller.openWorkspace()).resolves.toBe(false)
    expect(controller.getSnapshot().errorMessage).toBe('The action failed: open broke')
    expect(controller.getSnapshot().openPath).toBe('/missing')
    expect(controller.getSnapshot().workspaceId).toBe(WS_ONE)
  })

  it('refuses to open an empty input', async () => {
    const harness = fakeRemote()
    controller = new Tweets(harness.remote, format)
    await expect(controller.openWorkspace()).resolves.toBe(false)
    expect(harness.calls.opened).toEqual([])
  })
})

describe('feed loading', () => {
  it('folds a failed list into the localized error message', async () => {
    const harness = fakeRemote()
    controller = new Tweets(harness.remote, format)
    harness.failList = true
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    expect(controller.getSnapshot().status).toBe('error')
    expect(controller.getSnapshot().errorMessage).toBe('Loading failed: feed broke')
  })

  it('ignores a refresh that resolves after dispose', async () => {
    let resolveList: (value: RemoteResult<Tweet[]>) => void = () => {}
    const paused = {
      ...fakeRemote().remote,
      list: () => new Promise<RemoteResult<Tweet[]>>((resolve) => { resolveList = resolve }),
    }
    controller = new Tweets(paused, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    controller.dispose()
    resolveList(ok([post('tweet-late')]))
    await flush()
    expect(controller.getSnapshot().posts).toEqual([])
  })

  it('ignores a late refresh after the selection moved on', async () => {
    const harness = fakeRemote()
    controller = new Tweets(harness.remote, format)
    harness.failList = true
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    harness.failList = false
    controller.selectWorkspace(WS_TWO)
    await flush()
    expect(controller.getSnapshot().workspaceId).toBe(WS_TWO)
    expect(controller.getSnapshot().status).toBe('ready')
  })
})

describe('composer staging', () => {
  it('extracts clipboard image files and skips everything else', () => {
    const image = pngFile()
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
      { kind: 'file', type: 'text/csv', getAsFile: () => new File(['a'], 'a.csv', { type: 'text/csv' }) },
    ]
    expect(imagesFromClipboard(items)).toEqual([image])
  })

  it('stages accepted image files with previews and drops other types', async () => {
    const { remote } = fakeRemote()
    controller = new Tweets(remote, format)
    controller.addStagedFiles([pngFile(), new File(['<svg/>'], 'v.svg', { type: 'image/svg+xml' })])
    await flush()
    const staged = controller.getSnapshot().staged
    expect(staged).toHaveLength(1)
    expect(staged[0]?.mediaType).toBe('image/png')
    expect(staged[0]?.name).toBe('shot.png')
    expect(staged[0]?.previewUrl).toMatch(/^blob:/)
    controller.setStagedSize(staged[0]!.key, 320, 200)
    expect(controller.getSnapshot().staged[0]).toMatchObject({ width: 320, height: 200 })
    controller.removeStaged(staged[0]!.key)
    expect(controller.getSnapshot().staged).toEqual([])
  })

  it('drops staging when the controller is disposed mid-read', async () => {
    const { remote } = fakeRemote()
    controller = new Tweets(remote, format)
    controller.addStagedFiles([pngFile()])
    controller.dispose()
    await flush()
    expect(controller.getSnapshot().staged).toEqual([])
  })
})

describe('publish, edit, and delete', () => {
  it('publishes the draft plus staged images and prepends the result', async () => {
    const harness = fakeRemote()
    harness.listed.push(post('tweet-existing'))
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setDraft('fresh take')
    controller.addStagedFiles([pngFile('pic.png')])
    await flush()
    controller.setStagedSize(controller.getSnapshot().staged[0]!.key, 10, 10)
    await controller.publish()
    const request = harness.calls.publish[0] as { text: string; images: { mediaType: string; name: string; width: number }[] }
    expect(request.text).toBe('fresh take')
    expect(request.images[0]).toMatchObject({ mediaType: 'image/png', name: 'pic.png', width: 10 })
    expect(controller.getSnapshot().posts[0]?.text).toBe('fresh take')
    expect(controller.getSnapshot().draft).toBe('')
    expect(controller.getSnapshot().staged).toEqual([])
  })

  it('refuses to publish an empty draft without images', async () => {
    const harness = fakeRemote()
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    await controller.publish()
    expect(harness.calls.publish).toEqual([])
  })

  it('folds a failed publish into the localized error message', async () => {
    const broken = {
      ...fakeRemote().remote,
      list: async () => ok<Tweet[]>([]),
      publish: async () => failure<Tweet>('denied'),
    }
    controller = new Tweets(broken, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setDraft('nope')
    await controller.publish()
    expect(controller.getSnapshot().errorMessage).toBe('The action failed: denied')
  })

  it('edits text in place without touching the feed order', async () => {
    const harness = fakeRemote()
    const target = post('tweet-target', { createdAt: 1 })
    const newer = post('tweet-newer', { createdAt: 2 })
    harness.listed.push(newer, target)
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.beginEdit(target)
    controller.setEditingText('rewritten')
    await controller.saveEdit()
    const state = controller.getSnapshot()
    expect(state.editingId).toBeNull()
    expect(state.posts.map(item => item.id)).toEqual([newer.id, target.id])
    expect(state.posts[1]).toMatchObject({ text: 'rewritten', updatedAt: 3_000 })
  })

  it('ignores empty edits and folds failures', async () => {
    const harness = fakeRemote()
    const target = post('tweet-target')
    harness.listed.push(target)
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.beginEdit(target)
    controller.setEditingText('   ')
    await controller.saveEdit()
    expect(harness.calls.edit).toEqual([])
    controller.cancelEdit()
    expect(controller.getSnapshot().editingId).toBeNull()
    const broken = {
      ...fakeRemote().remote,
      list: async () => ok<Tweet[]>([target]),
      edit: async () => failure<Tweet>('denied'),
    }
    const second = new Tweets(broken, format)
    try {
      second.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
      await flush()
      second.beginEdit(target)
      second.setEditingText('x')
      await second.saveEdit()
      expect(second.getSnapshot().errorMessage).toBe('The action failed: denied')
    } finally {
      second.dispose()
    }
  })

  it('deletes a post and folds failures', async () => {
    const harness = fakeRemote()
    const target = post('tweet-target')
    harness.listed.push(target)
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    await controller.remove(target.id)
    expect(controller.getSnapshot().posts).toEqual([])
    const broken = {
      ...fakeRemote().remote,
      list: async () => ok<Tweet[]>([target]),
      delete: async () => failure<boolean>('denied'),
    }
    const second = new Tweets(broken, format)
    try {
      second.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
      await flush()
      await second.remove(target.id)
      expect(second.getSnapshot().errorMessage).toBe('The action failed: denied')
    } finally {
      second.dispose()
    }
  })

  it('ignores edit, save, and remove without a selection', async () => {
    const harness = fakeRemote()
    controller = new Tweets(harness.remote, format)
    controller.setEditingText('x')
    await controller.saveEdit()
    await controller.remove(brandString<TweetId>('tweet-none'))
    expect(harness.calls.edit).toEqual([])
    expect(harness.calls.removed).toEqual([])
  })
})

describe('comments', () => {
  it('submits drafted comments under a post, unlimited, and clears the draft', async () => {
    const harness = fakeRemote()
    const target = post('tweet-target')
    harness.listed.push(target)
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setCommentDraft(target.id, '  first note  ')
    await controller.submitComment(target.id)
    controller.setCommentDraft(target.id, 'second note')
    await controller.submitComment(target.id)
    expect(harness.calls.comments).toEqual([
      { id: target.id, text: 'first note' },
      { id: target.id, text: 'second note' },
    ])
    const state = controller.getSnapshot()
    expect(state.posts[0]?.comments.map(item => item.text)).toEqual(['first note', 'second note'])
    expect(state.posts[0]?.comments[0]?.id).toMatch(/^comment-/)
    expect(state.commentDrafts.get(target.id)).toBeUndefined()
    expect(state.commenting.has(target.id)).toBe(false)
  })

  it('ignores an empty or missing draft and a submit without a selection', async () => {
    const harness = fakeRemote()
    const target = post('tweet-target')
    harness.listed.push(target)
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setCommentDraft(target.id, '   ')
    await controller.submitComment(target.id)
    expect(harness.calls.comments).toEqual([])
    const draftless = new Tweets(harness.remote, format)
    try {
      draftless.setCommentDraft(target.id, 'no selection')
      await draftless.submitComment(target.id)
      expect(harness.calls.comments).toEqual([])
    } finally {
      draftless.dispose()
    }
  })

  it('folds a failed comment into the localized error message', async () => {
    const harness = fakeRemote()
    const target = post('tweet-target')
    harness.listed.push(target)
    harness.failComment = true
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setCommentDraft(target.id, 'doomed')
    await controller.submitComment(target.id)
    const state = controller.getSnapshot()
    expect(state.errorMessage).toBe('The action failed: comment broke')
    expect(state.commentDrafts.get(target.id)).toBe('doomed')
    expect(state.commenting.has(target.id)).toBe(false)
  })

  it('ignores a second submit while one is in flight', async () => {
    let resolveComment: (value: RemoteResult<Tweet>) => void = () => {}
    const target = post('tweet-target')
    const seeded = fakeRemote()
    seeded.listed.push(target)
    const paused = {
      ...seeded.remote,
      comment: () => new Promise<RemoteResult<Tweet>>((resolve) => { resolveComment = resolve }),
    }
    controller = new Tweets(paused, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.setCommentDraft(target.id, 'slow')
    void controller.submitComment(target.id)
    await flush()
    expect(controller.getSnapshot().commenting.has(target.id)).toBe(true)
    await controller.submitComment(target.id)
    resolveComment(ok({ ...target, comments: [comment('slow')] }))
    await flush()
    expect(controller.getSnapshot().commenting.has(target.id)).toBe(false)
    expect(controller.getSnapshot().posts[0]?.comments.map(item => item.text)).toEqual(['slow'])
  })
})

describe('image cache and expansion', () => {
  it('loads object URLs for every listed image once', async () => {
    const harness = fakeRemote()
    const image = { file: `${'a'.repeat(64)}.png`, mediaType: 'image/png' as const, bytes: 12 }
    harness.listed.push(post('tweet-shot', { images: [image] }))
    controller = new Tweets(harness.remote, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    expect(controller.getSnapshot().imageUrls.get(image.file)).toMatch(/^blob:/)
    expect(controller.imageUrl(image)).toMatch(/^blob:/)
    controller.dispose()
  })

  it('drops an image load that resolves after dispose', async () => {
    let resolveImage: (value: RemoteResult<TweetImagePayload>) => void = () => {}
    const image = { file: `${'b'.repeat(64)}.png`, mediaType: 'image/png' as const, bytes: 12 }
    const seeded = fakeRemote()
    seeded.listed.push(post('tweet-shot', { images: [image] }))
    const paused = {
      ...seeded.remote,
      image: () => new Promise<RemoteResult<TweetImagePayload>>((resolve) => { resolveImage = resolve }),
    }
    controller = new Tweets(paused, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    controller.dispose()
    resolveImage(ok({ mediaType: 'image/png', data: btoa('late') }))
    await flush()
    expect(controller.getSnapshot().imageUrls.get(image.file)).toBeUndefined()
  })

  it('keeps the feed unchanged when an image load fails', async () => {
    const image = { file: `${'c'.repeat(64)}.png`, mediaType: 'image/png' as const, bytes: 12 }
    const seeded = fakeRemote()
    seeded.listed.push(post('tweet-shot', { images: [image] }))
    const failing = {
      ...seeded.remote,
      image: async () => failure<TweetImagePayload>('object gone'),
    }
    controller = new Tweets(failing, format)
    controller.syncWorkspaces([{ workspaceId: WS_ONE, path: '/one', title: 'One' }])
    await flush()
    expect(controller.getSnapshot().imageUrls.get(image.file)).toBeUndefined()
    expect(controller.getSnapshot().status).toBe('ready')
  })

  it('toggles per-post expansion', async () => {
    const harness = fakeRemote()
    const target = post('tweet-target')
    harness.listed.push(target)
    controller = new Tweets(harness.remote, format)
    controller.toggleExpanded(target.id)
    expect(controller.getSnapshot().expanded.has(target.id)).toBe(true)
    controller.toggleExpanded(target.id)
    expect(controller.getSnapshot().expanded.has(target.id)).toBe(false)
  })

  it('toggles per-post comment expansion independently of text expansion', () => {
    const harness = fakeRemote()
    const target = post('tweet-target')
    controller = new Tweets(harness.remote, format)
    controller.toggleCommentExpanded(target.id)
    expect(controller.getSnapshot().commentExpanded.has(target.id)).toBe(true)
    expect(controller.getSnapshot().expanded.has(target.id)).toBe(false)
    controller.toggleCommentExpanded(target.id)
    expect(controller.getSnapshot().commentExpanded.has(target.id)).toBe(false)
  })

  it('reads staged files into base64 with dimensions unknown until measured', async () => {
    const staged = await fileToStagedImage(pngFile('only.png'))
    expect(staged?.data).toBe(btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d)))
    expect(await fileToStagedImage(new File(['x'], 'x.txt', { type: 'text/plain' }))).toBeNull()
    URL.revokeObjectURL(staged!.previewUrl)
  })
})

describe('listener wiring', () => {
  it('notifies subscribers on state change and stops after unsubscribe', async () => {
    const { remote } = fakeRemote()
    controller = new Tweets(remote, format)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    controller.setDraft('hello')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    controller.setDraft('again')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
