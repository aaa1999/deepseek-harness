// @vitest-environment jsdom
/**
 * TweetPage presentation behavior: the fixed workspace selector and
 * composer (text and staged images as separate blocks), the scrolling feed,
 * the strictly separated text block and image grid inside each post, the
 * unlimited oldest-first comment list with its input under every post and
 * its newest-three fold, the three-line fold with its expand control,
 * in-place editing, deletion with confirmation, clipboard paste, and the
 * lightbox.
 */

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { Tweets } from '../src/client/tweets.ts'
import type { TweetsRemoteFace } from '../src/client/tweets.ts'
import { TweetPage } from '../src/client/TweetPage.tsx'
import type { TweetPageProps } from '../src/client/TweetPage.tsx'
import { TweetPanelIcon } from '../src/client/TweetPanelIcon.tsx'
import type { Tweet, TweetComment, TweetCommentId, TweetId, TweetImagePayload } from '../src/types.ts'

const WS_ONE = brandString<WorkspaceId>('ws-one')
const WS_TWO = brandString<WorkspaceId>('ws-two')

/** Render copy as the dictionary key so assertions stay locale-neutral. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as TweetPageProps['t']

const WORKSPACES = [
  { workspaceId: WS_ONE, path: '/one', title: 'One' },
  { workspaceId: WS_TWO, path: '/two', title: '' },
]

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function post(id: string, overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: brandString<TweetId>(id),
    text: `text ${id}`,
    images: [],
    comments: [],
    createdAt: Date.now() - 10_000,
    ...overrides,
  }
}

/** One comment row with a distinct identity per call. */
let commentSerial = 0
function commentRow(text: string, createdAt = 4_000): TweetComment {
  commentSerial += 1
  return { id: brandString<TweetCommentId>(`comment-${String(commentSerial).padStart(4, '0')}`), text, createdAt }
}

const OBJECT_A = `${'1'.repeat(64)}.png`
const OBJECT_B = `${'2'.repeat(64)}.png`

/** A remote double whose feed and verbs the assertions observe. */
function fakeRemote(feed: Tweet[] = []): TweetsRemoteFace & {
  readonly published: string[]
  readonly commented: string[]
  readonly removed: string[]
  readonly opened: string[]
} {
  const double = {
    published: [] as string[],
    commented: [] as string[],
    removed: [] as string[],
    opened: [] as string[],
    async list() {
      return ok([...feed].sort((left, right) => right.createdAt - left.createdAt))
    },
    async open(request: { readonly path: string }) {
      double.opened.push(request.path)
      return ok({ workspaceId: WS_ONE, path: request.path, title: 'opened' })
    },
    async publish(request: { text: string }) {
      double.published.push(request.text)
      const created = post('tweet-created', { text: request.text })
      feed.unshift(created)
      return ok(created)
    },
    async edit(request: { id: TweetId; text: string }) {
      return ok({ ...feed.find(item => item.id === request.id)!, text: request.text, updatedAt: 4_000 })
    },
    async comment(request: { id: TweetId; text: string }) {
      double.commented.push(request.text)
      const index = feed.findIndex(item => item.id === request.id)
      const next = { ...feed[index]!, comments: [...feed[index]!.comments, commentRow(request.text.trim())] }
      feed[index] = next
      return ok(next)
    },
    async delete(_workspaceId: WorkspaceId, id: TweetId) {
      double.removed.push(id)
      feed.splice(feed.findIndex(item => item.id === id), 1)
      return ok(true)
    },
    async image(request: { file: string }) {
      return ok<TweetImagePayload>({ mediaType: 'image/png', data: btoa(`bytes-${request.file}`) })
    },
  }
  return double
}

/** One observable source over a fixed snapshot. */
function sourceOf<T>(snapshot: T): { getSnapshot(): T; subscribe(listener: () => void): () => void } {
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

/** Render the page over a fresh controller and feed. */
function mount(feed: Tweet[] = []) {
  const remote = fakeRemote(feed)
  const tweet = new Tweets(remote, t)
  const view = render(createElement(TweetPage, {
    tweet,
    workspaces: sourceOf({ items: WORKSPACES }),
    t,
  } as TweetPageProps))
  return { remote, tweet, view }
}

/** Drain pending microtasks inside act so async state settles. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) await Promise.resolve()
  })
}

/** Patch one element's box measurements so the fold detection sees overflow. */
function measureOverflow(element: Element | null, scrollHeight: number, clientHeight: number): void {
  expect(element).not.toBeNull()
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  globalThis.localStorage.clear()
})

describe('TweetPage', () => {
  it('shows the empty-workspace notice and selector placeholder when no workspace is listed', () => {
    const tweet = new Tweets(fakeRemote(), t)
    render(createElement(TweetPage, {
      tweet,
      workspaces: sourceOf({ items: [] }),
      t,
    }))
    expect(screen.getByText('workspace.empty')).toBeTruthy()
    expect(screen.getByText('workspace.noneSelected')).toBeTruthy()
  })

  it('loads the selected workspace feed and shows the empty state', async () => {
    const { view } = mount()
    await flush()
    expect(screen.queryByText('feed.loading')).toBeNull()
    expect(screen.getByText('feed.empty')).toBeTruthy()
    expect((view.container.querySelector('select') as HTMLSelectElement).value).toBe(WS_ONE)
    const options = view.container.querySelectorAll('option')
    expect(options[0]?.textContent).toBe('One')
    expect(options[1]?.textContent).toBe('/two')
  })

  it('switches the workspace from the selector', async () => {
    const tweet = new Tweets(fakeRemote(), t)
    const view = render(createElement(TweetPage, {
      tweet,
      workspaces: sourceOf({ items: WORKSPACES }),
      t,
    }))
    await flush()
    fireEvent.change(view.container.querySelector('select')!, { target: { value: WS_TWO } })
    await flush()
    expect(tweet.getSnapshot().workspaceId).toBe(WS_TWO)
    expect(globalThis.localStorage.getItem('dsh.tweet.workspace.v1')).toBe(WS_TWO)
  })

  it('folds a list failure into the notice row', async () => {
    const tweet = new Tweets({
      list: async () => ({ ok: false, error: { message: 'nope' } as never }),
      open: async () => ok({ workspaceId: WS_ONE, path: '/one', title: 'One' }),
      publish: async () => ok(post('x')),
      edit: async () => ok(post('x')),
      comment: async () => ok(post('x')),
      delete: async () => ok(true),
      image: async () => ok<TweetImagePayload>({ mediaType: 'image/png', data: '' }),
    }, t)
    render(createElement(TweetPage, {
      tweet,
      workspaces: sourceOf({ items: WORKSPACES }),
      t,
    }))
    await flush()
    expect(screen.getByText('feed.failed:{"message":"nope"}')).toBeTruthy()
  })

  it('renders posts newest first with text and images in separate blocks', async () => {
    const feed = [
      post('tweet-old', { text: 'older take', createdAt: Date.now() - 60_000 }),
      post('tweet-new', {
        text: 'newer take',
        createdAt: Date.now() - 5_000,
        images: [
          { file: OBJECT_A, mediaType: 'image/png', bytes: 10, name: 'a.png' },
          { file: OBJECT_B, mediaType: 'image/png', bytes: 10 },
        ],
      }),
    ]
    const { view } = mount(feed)
    await flush()
    const cards = view.container.querySelectorAll('article')
    expect(cards).toHaveLength(2)
    const newer = within(cards[0] as HTMLElement)
    expect(newer.getByText('newer take')).toBeTruthy()
    expect(newer.getByAltText('a.png')).toBeTruthy()
    expect(cards[0]!.querySelectorAll('img')).toHaveLength(2)
    expect(within(cards[1] as HTMLElement).getByText('older take')).toBeTruthy()
    expect(cards[1]!.querySelector('img')).toBeNull()
  })

  it('marks the single image with its own layout and shows a placeholder until its URL loads', async () => {
    const tweet = new Tweets({
      list: async () => ok([post('tweet-shot', {
        images: [{ file: OBJECT_A, mediaType: 'image/png', bytes: 10 }],
      })]),
      open: async () => ok({ workspaceId: WS_ONE, path: '/one', title: 'One' }),
      publish: async () => ok(post('x')),
      edit: async () => ok(post('x')),
      comment: async () => ok(post('x')),
      delete: async () => ok(true),
      image: async () => new Promise(() => {}),
    }, t)
    const view = render(createElement(TweetPage, {
      tweet,
      workspaces: sourceOf({ items: WORKSPACES }),
      t,
    }))
    await flush()
    const card = view.container.querySelector('article')!
    expect(card.querySelector('[aria-label="image.loading"]')).toBeTruthy()
  })

  it('opens a typed working directory from the header and collapses the row', async () => {
    const { remote } = mount()
    await flush()
    fireEvent.click(screen.getByLabelText('workspace.open'))
    const input = screen.getByPlaceholderText('workspace.openPlaceholder')
    fireEvent.change(input, { target: { value: '  /Users/you/Desktop/notes  ' } })
    fireEvent.click(screen.getByText('workspace.openConfirm'))
    await flush()
    expect(remote.opened).toEqual(['/Users/you/Desktop/notes'])
    expect(screen.queryByPlaceholderText('workspace.openPlaceholder')).toBeNull()
  })

  it('renders the explicit local timestamp of every post and the edited marker', async () => {
    const n = new Date()
    // Deterministic instants for the three visible buckets; the same-day one stays on
    // today's calendar, the same-year one avoids today, January runs use December.
    const sameDay = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 34).getTime()
    const sameYear = n.getMonth() === 0
      ? new Date(n.getFullYear(), 11, 30, 5, 6).getTime()
      : new Date(n.getFullYear(), 0, 2, 3, 4).getTime()
    const otherYear = new Date(n.getFullYear() - 1, 5, 10, 7, 8).getTime()
    const clockOf = (time: number): string => {
      const d = new Date(time)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const dateKeyOf = (prefix: 'time.clock.md' | 'time.clock.ymd', time: number): string => {
      const d = new Date(time)
      return `${prefix}:${JSON.stringify({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })}`
    }
    const feed = [
      post('tweet-today', { createdAt: sameDay }),
      post('tweet-year', { createdAt: sameYear, updatedAt: sameYear + 1000 }),
      post('tweet-old', { createdAt: otherYear }),
    ]
    mount(feed)
    await flush()
    expect(screen.getByText(clockOf(sameDay))).toBeTruthy()
    expect(screen.getByText(`${dateKeyOf('time.clock.md', sameYear)} ${clockOf(sameYear)}`)).toBeTruthy()
    expect(screen.getByText(`${dateKeyOf('time.clock.ymd', otherYear)} ${clockOf(otherYear)}`)).toBeTruthy()
    expect(screen.getByText('post.edited', { exact: false })).toBeTruthy()
  })

  it('publishes the draft through the composer', async () => {
    const { remote, view } = mount()
    await flush()
    const publish = screen.getByText('composer.publish').closest('button')!
    expect(publish.disabled).toBe(true)
    fireEvent.change(view.container.querySelector('textarea')!, { target: { value: 'hello feed' } })
    expect(publish.disabled).toBe(false)
    fireEvent.click(publish)
    await flush()
    expect(remote.published).toEqual(['hello feed'])
    expect(screen.getByText('hello feed')).toBeTruthy()
  })

  it('stages picker files, shows previews, and removes them again', async () => {
    const { tweet, view } = mount()
    await flush()
    const input = view.container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => {
      fireEvent.change(input)
      for (let round = 0; round < 8; round += 1) await Promise.resolve()
    })
    const preview = view.container.querySelector('img[alt="shot.png"]') as HTMLImageElement
    expect(preview).toBeTruthy()
    fireEvent.load(preview)
    expect(tweet.getSnapshot().staged[0]?.width).toBeUndefined()
    fireEvent.click(screen.getByLabelText('composer.removeImage'))
    expect(view.container.querySelector('img[alt="shot.png"]')).toBeNull()
  })

  it('opens the picker from the add-images button', async () => {
    const { view } = mount()
    await flush()
    const input = view.container.querySelector('input[type=file]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByText('composer.addImages'))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('stages pasted clipboard images and ignores text pastes', async () => {
    const { tweet, view } = mount()
    await flush()
    const section = view.container.querySelector('textarea')!.closest('section')!
    const image = new File([new Uint8Array([9])], 'p.png', { type: 'image/png' })
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ]
    fireEvent.paste(section, { clipboardData: { items } })
    await flush()
    expect(tweet.getSnapshot().staged).toHaveLength(1)
    fireEvent.paste(section, { clipboardData: { items: items.slice(0, 1) } })
    await flush()
    expect(tweet.getSnapshot().staged).toHaveLength(1)
  })

  it('folds long text to three lines and expands and collapses it again', async () => {
    const feed = [post('tweet-long', { text: 'a'.repeat(400) })]
    const { view } = mount(feed)
    await flush()
    const card = view.container.querySelector('article')!
    expect(card.querySelector('p')!.className).toContain('clamp')
    expect(screen.queryByText('post.expand')).toBeNull()
    measureOverflow(card.querySelector('p'), 200, 50)
    fireEvent.change(view.container.querySelector('textarea')!, { target: { value: 'trigger' } })
    await flush()
    fireEvent.click(screen.getByText('post.expand'))
    expect(view.container.querySelector('article')!.querySelector('p')!.className).not.toContain('clamp')
    fireEvent.click(screen.getByText('post.collapse'))
    expect(view.container.querySelector('article')!.querySelector('p')!.className).toContain('clamp')
  })

  it('edits text in place and cancels out of it', async () => {
    const feed = [post('tweet-editable')]
    const { view } = mount(feed)
    await flush()
    const card = view.container.querySelector('article')!
    fireEvent.click(within(card).getByText('post.edit'))
    const editor = card.querySelector('textarea') as HTMLTextAreaElement
    expect(editor.value).toBe('text tweet-editable')
    fireEvent.change(editor, { target: { value: 'rewritten' } })
    const save = within(card).getByText('post.save').closest('button')!
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await flush()
    expect(within(view.container.querySelector('article')!).getByText('rewritten')).toBeTruthy()
    fireEvent.click(within(view.container.querySelector('article')!).getByText('post.edit'))
    fireEvent.change(view.container.querySelector('article')!.querySelector('textarea')!, { target: { value: '' } })
    expect((within(view.container.querySelector('article')!).getByText('post.save').closest('button') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(view.container.querySelector('article')!).getByText('post.cancel'))
    expect(view.container.querySelector('article')!.querySelector('textarea')).toBeNull()
  })

  it('renders comments under a post and appends submitted ones unlimited', async () => {
    const commented = post('tweet-commented', {
      comments: [commentRow('already here', Date.now() - 5_000)],
    })
    const { remote, view } = mount([commented])
    await flush()
    const card = view.container.querySelector('article')!
    expect(within(card).getByText('already here')).toBeTruthy()
    expect(within(card).getByLabelText('comment.section')).toBeTruthy()
    const input = within(card).getByPlaceholderText('comment.placeholder') as HTMLInputElement
    const submit = within(card).getByText('comment.submit').closest('button')!
    expect(submit.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'fresh note' } })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await flush()
    const updated = view.container.querySelector('article')!
    expect(within(updated).getByText('fresh note')).toBeTruthy()
    expect(within(updated).getByPlaceholderText<HTMLInputElement>('comment.placeholder').value).toBe('')
    const again = within(updated).getByPlaceholderText('comment.placeholder')
    fireEvent.change(again, { target: { value: 'one more' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    await flush()
    expect(remote.commented).toEqual(['fresh note', 'one more'])
    expect(within(view.container.querySelector('article')!).getByText('one more')).toBeTruthy()
  })

  it('folds a long comment list to the newest three until expanded', async () => {
    const many = post('tweet-many-comments', {
      comments: [1, 2, 3, 4, 5].map(index => commentRow(`note ${index}`)),
    })
    const { view } = mount([many])
    await flush()
    const card = view.container.querySelector('article')!
    expect(within(card).queryByText('note 1')).toBeNull()
    expect(within(card).queryByText('note 2')).toBeNull()
    expect(within(card).getByText('note 3')).toBeTruthy()
    expect(within(card).getByText('note 4')).toBeTruthy()
    expect(within(card).getByText('note 5')).toBeTruthy()
    fireEvent.click(within(card).getByText('comment.expand:{"count":5}'))
    await flush()
    const opened = view.container.querySelector('article')!
    expect(within(opened).getByText('note 1')).toBeTruthy()
    expect(within(opened).getByText('note 2')).toBeTruthy()
    fireEvent.click(within(opened).getByText('comment.collapse'))
    await flush()
    const folded = view.container.querySelector('article')!
    expect(within(folded).queryByText('note 1')).toBeNull()
    expect(within(folded).getByText('note 5')).toBeTruthy()
  })

  it('shows every comment without a fold control when there are three or fewer', async () => {
    const few = post('tweet-few-comments', {
      comments: [1, 2, 3].map(index => commentRow(`note ${index}`)),
    })
    const { view } = mount([few])
    await flush()
    const card = view.container.querySelector('article')!
    expect(within(card).queryByText(/^comment\.expand/)).toBeNull()
    for (const index of [1, 2, 3]) expect(within(card).getByText(`note ${index}`)).toBeTruthy()
  })

  it('deletes a post after inline confirmation', async () => {
    const target = post('tweet-doomed')
    const { remote, view } = mount([target])
    await flush()
    const card = view.container.querySelector('article')!
    fireEvent.click(within(card).getByText('post.delete'))
    fireEvent.click(within(card).getByText('post.deleteConfirm'))
    await flush()
    expect(remote.removed).toEqual([target.id])
    expect(view.container.querySelector('article')).toBeNull()
  })

  it('keeps a post when deletion is cancelled', async () => {
    const target = post('tweet-kept')
    const { view } = mount([target])
    await flush()
    const card = view.container.querySelector('article')!
    fireEvent.click(within(card).getByText('post.delete'))
    fireEvent.click(within(card).getByText('post.cancel'))
    expect(view.container.querySelector('article')).toBeTruthy()
    expect(within(view.container.querySelector('article')!).getByText('post.delete')).toBeTruthy()
  })

  it('shows a loaded image and opens and closes the lightbox', async () => {
    const feed = [post('tweet-shot', {
      images: [{ file: OBJECT_A, mediaType: 'image/png', bytes: 10, name: 'zoom.png' }],
    })]
    const { view } = mount(feed)
    await flush()
    const card = view.container.querySelector('article')!
    const tile = within(card).getByAltText('zoom.png').closest('button')!
    fireEvent.click(tile)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    fireEvent.click(within(dialog).getByLabelText('image.close'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the sidebar glyph at the requested size', () => {
    const view = render(createElement(TweetPanelIcon, { size: 18 } as never))
    expect(view.container.firstElementChild).toBeTruthy()
  })
})
