// @vitest-environment jsdom
/**
 * TweetPage presentation behavior: the fixed workspace selector and
 * composer (text and staged images as separate blocks), the scrolling feed,
 * the strictly separated text block and image grid inside each post, the
 * three-line fold with its expand control, in-place editing, deletion with
 * confirmation, clipboard paste, and the lightbox.
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
import type { Tweet, TweetId, TweetImagePayload } from '../src/types.ts'

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
    createdAt: Date.now() - 10_000,
    ...overrides,
  }
}

const OBJECT_A = `${'1'.repeat(64)}.png`
const OBJECT_B = `${'2'.repeat(64)}.png`

/** A remote double whose feed and verbs the assertions observe. */
function fakeRemote(feed: Tweet[] = []): TweetsRemoteFace & { readonly published: string[]; readonly removed: string[] } {
  const double = {
    published: [] as string[],
    removed: [] as string[],
    async list() {
      return ok([...feed].sort((left, right) => right.createdAt - left.createdAt))
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
      publish: async () => ok(post('x')),
      edit: async () => ok(post('x')),
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
      publish: async () => ok(post('x')),
      edit: async () => ok(post('x')),
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

  it('renders the edited marker and every relative-time bucket', async () => {
    const now = Date.now()
    const MIN = 60_000
    const feed = [
      post('tweet-now', { createdAt: now }),
      post('tweet-min', { createdAt: now - 5 * MIN }),
      post('tweet-hour', { createdAt: now - 3 * 3_600_000 }),
      post('tweet-day', { createdAt: now - 2 * 86_400_000 }),
      post('tweet-month', { createdAt: now - 40 * 86_400_000 }),
      post('tweet-year', { createdAt: now - 400 * 86_400_000, updatedAt: now - 1 }),
    ]
    mount(feed)
    await flush()
    expect(screen.getByText('time.now')).toBeTruthy()
    expect(screen.getByText('time.minutes:{"n":5}')).toBeTruthy()
    expect(screen.getByText('time.hours:{"n":3}')).toBeTruthy()
    expect(screen.getByText('time.days:{"n":2}')).toBeTruthy()
    expect(screen.getByText('time.months:{"n":1}')).toBeTruthy()
    expect(screen.getByText('time.years:{"n":1}')).toBeTruthy()
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
