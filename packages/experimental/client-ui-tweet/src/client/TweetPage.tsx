/**
 * The tweet page: a fixed header with the Workspace selector and the
 * composer (text area and staged images as separate blocks), and the
 * scrolling feed below. Every post renders its plain-text block first, its
 * image grid as a separate block after it, and its comments — an unlimited,
 * oldest-first list with an input under every post, folded to the newest
 * three until expanded — below the meta row; long text folds to three lines
 * with an expand control, and the feed always shows the newest post first.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, ReactNode } from 'react'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { Tweet, TweetImageRef } from '../types.ts'
import type { Tweets, TweetsState, WorkspaceSummary } from './tweets.ts'
import { imagesFromClipboard } from './tweets.ts'
import css from './TweetPage.module.css'

/** What the page asks of its registration. */
export interface TweetsInjected {
  /** The panel controller, owned by the plugin lifetime. */
  readonly tweet: Tweets
  /** The Host's workspace list. */
  readonly workspaces: HostObservable<{ readonly items: readonly WorkspaceSummary[] }>
}

/** Full props of the tweet page. */
export type TweetPageProps = InjectFace<TweetsInjected> & PropsLocale<typeof NS>

/** Locale namespace of the panel, referenced by the props type. */
const NS = 'tweet'

/** Comments a post shows by default before expansion; the newest ones win. */
const COMMENT_WINDOW = 3

/**
 * Render the tweet panel.
 * @param props - the panel controller, the workspace source, and the bound translate function.
 * @returns the panel.
 */
export function TweetPage({ tweet, workspaces, t }: TweetPageProps): ReactNode {
  const state = useSyncExternalStore(tweet.subscribe, () => tweet.getSnapshot())
  const listed = useSyncExternalStore(
    onChange => workspaces.subscribe(onChange),
    () => workspaces.getSnapshot(),
  )
  const picker = useRef<HTMLInputElement | null>(null)
  const [openRow, setOpenRow] = useState(false)

  useEffect(() => {
    tweet.syncWorkspaces(listed.items)
  })

  const canPublish = state.draft.trim().length > 0 || state.staged.length > 0
  const selection = listed.items.find(item => item.workspaceId === state.workspaceId)

  const onPaste = (event: ReactClipboardEvent<HTMLElement>): void => {
    const files = imagesFromClipboard(Array.from(event.clipboardData.items))
    if (files.length > 0) tweet.addStagedFiles(files)
  }

  const submitOpen = (): void => {
    void tweet.openWorkspace().then((success) => { if (success) setOpenRow(false) })
  }

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <select
          className={css.select}
          aria-label={t('workspace.select')}
          value={state.workspaceId ?? ''}
          onChange={(event) => {
            const next = listed.items.find(item => item.workspaceId === event.target.value)
            if (next !== undefined) tweet.selectWorkspace(next.workspaceId)
          }}
        >
          {listed.items.length === 0 ? <option value="">{t('workspace.empty')}</option> : null}
          {listed.items.map(item => (
            <option key={item.workspaceId} value={item.workspaceId}>{item.title === '' ? item.path : item.title}</option>
          ))}
        </select>
        <button
          type="button"
          className={css.action}
          aria-label={t('workspace.open')}
          title={t('workspace.open')}
          onClick={() => { setOpenRow(current => !current) }}
        >+</button>
      </header>
      {openRow
        ? (
          <div className={css.openRow}>
            <input
              className={css.openInput}
              placeholder={t('workspace.openPlaceholder')}
              value={state.openPath}
              onChange={(event) => { tweet.setOpenPath(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') submitOpen() }}
            />
            <button
              type="button"
              className={css.action}
              disabled={state.openPath.trim().length === 0}
              onClick={submitOpen}
            >{t('workspace.openConfirm')}</button>
          </div>
        )
        : null}
      <section className={css.composer} onPaste={onPaste}>
        <textarea
          className={css.textarea}
          placeholder={t('composer.placeholder')}
          value={state.draft}
          rows={3}
          onChange={(event) => { tweet.setDraft(event.target.value) }}
        />
        <div className={css.stagedRow}>
          {state.staged.map(image => (
            <span key={image.key} className={css.stagedItem}>
              <img
                className={css.stagedImage}
                src={image.previewUrl}
                alt={image.name ?? ''}
                onLoad={(event) => {
                  tweet.setStagedSize(image.key, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
                }}
              />
              <button
                type="button"
                className={css.stagedRemove}
                aria-label={t('composer.removeImage')}
                onClick={() => { tweet.removeStaged(image.key) }}
              >×</button>
            </span>
          ))}
          <button type="button" className={css.addImages} onClick={() => { picker.current?.click() }}>
            {t('composer.addImages')}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(event) => {
              tweet.addStagedFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <span className={css.spacer} />
          <button
            type="button"
            className={css.publish}
            disabled={!canPublish || state.publishing}
            onClick={() => { void tweet.publish() }}
          >{state.publishing ? t('composer.publishing') : t('composer.publish')}</button>
        </div>
      </section>
      <div className={css.feed}>
        {selection === undefined ? <p className={css.notice}>{t('workspace.noneSelected')}</p>
          : state.status === 'loading' ? <p className={css.notice}>{t('feed.loading')}</p>
            : state.status === 'error' ? <p className={css.notice}>{state.errorMessage}</p>
              : state.posts.length === 0 ? <p className={css.notice}>{t('feed.empty')}</p>
                : state.posts.map(post => (
                  <PostCard key={post.id} post={post} tweet={tweet} state={state} t={t} />
                ))}
        {state.status === 'ready' && state.errorMessage !== null
          ? <p className={css.notice}>{state.errorMessage}</p>
          : null}
      </div>
    </div>
  )
}

/** One feed post: the text block, then the separate image grid, then the meta row. */
function PostCard({ post, tweet, state, t }: {
  readonly post: Tweet
  readonly tweet: Tweets
  readonly state: TweetsState
  readonly t: TranslateNS<typeof NS>
}): ReactNode {
  const [confirming, setConfirming] = useState(false)
  const editing = state.editingId === post.id
  return (
    <article className={css.post}>
      {editing
        ? (
          <div className={css.editBlock}>
            <textarea
              className={css.editArea}
              placeholder={t('post.editPlaceholder')}
              value={state.editingText}
              rows={3}
              onChange={(event) => { tweet.setEditingText(event.target.value) }}
            />
            <div className={css.actions}>
              <button
                type="button"
                className={css.action}
                disabled={state.editingText.trim().length === 0}
                onClick={() => { void tweet.saveEdit() }}
              >{t('post.save')}</button>
              <button type="button" className={css.action} onClick={() => { tweet.cancelEdit() }}>
                {t('post.cancel')}
              </button>
            </div>
          </div>
        )
        : post.text !== '' ? <PostText post={post} tweet={tweet} expanded={state.expanded.has(post.id)} t={t} /> : null}
      {post.images.length > 0 ? <PostImages post={post} tweet={tweet} t={t} /> : null}
      <footer className={css.meta}>
        <PostTime at={post.createdAt} edited={post.updatedAt} t={t} />
        <span className={css.spacer} />
        <div className={css.actions}>
          {confirming
            ? (
              <>
                <button type="button" className={css.action} onClick={() => { void tweet.remove(post.id) }}>
                  {t('post.deleteConfirm')}
                </button>
                <button type="button" className={css.action} onClick={() => { setConfirming(false) }}>
                  {t('post.cancel')}
                </button>
              </>
            )
            : (
              <>
                <button type="button" className={css.action} onClick={() => { tweet.beginEdit(post) }}>
                  {t('post.edit')}
                </button>
                <button type="button" className={css.action} onClick={() => { setConfirming(true) }}>
                  {t('post.delete')}
                </button>
              </>
            )}
        </div>
      </footer>
      <PostComments post={post} tweet={tweet} state={state} t={t} />
    </article>
  )
}

/** One post's comments: the folded window (newest three) or the whole list, then the input. */
function PostComments({ post, tweet, state, t }: {
  readonly post: Tweet
  readonly tweet: Tweets
  readonly state: TweetsState
  readonly t: TranslateNS<typeof NS>
}): ReactNode {
  const draft = state.commentDrafts.get(post.id) ?? ''
  const busy = state.commenting.has(post.id)
  const expanded = state.commentExpanded.has(post.id)
  const shown = expanded || post.comments.length <= COMMENT_WINDOW
    ? post.comments
    : post.comments.slice(-COMMENT_WINDOW)
  return (
    <section className={css.comments} aria-label={t('comment.section')}>
      {shown.map(comment => (
        <div key={comment.id} className={css.commentRow}>
          <p className={css.commentText}>{comment.text}</p>
          <time className={css.commentTime} dateTime={new Date(comment.createdAt).toISOString()}>
            {absoluteClock(comment.createdAt, t)}
          </time>
        </div>
      ))}
      {post.comments.length > COMMENT_WINDOW
        ? (
          <button
            type="button"
            className={css.commentToggle}
            onClick={() => { tweet.toggleCommentExpanded(post.id) }}
          >{expanded ? t('comment.collapse') : t('comment.expand', { count: post.comments.length })}</button>
        )
        : null}
      <div className={css.commentForm}>
        <input
          className={css.commentInput}
          placeholder={t('comment.placeholder')}
          value={draft}
          onChange={(event) => { tweet.setCommentDraft(post.id, event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') { void tweet.submitComment(post.id) } }}
        />
        <button
          type="button"
          className={css.commentSubmit}
          disabled={draft.trim().length === 0 || busy}
          onClick={() => { void tweet.submitComment(post.id) }}
        >{t('comment.submit')}</button>
      </div>
    </section>
  )
}

/** The plain-text block: at most three lines unless expanded, with an expand control when folded. */
function PostText({ post, tweet, expanded, t }: {
  readonly post: Tweet
  readonly tweet: Tweets
  readonly expanded: boolean
  readonly t: TranslateNS<typeof NS>
}): ReactNode {
  const text = useRef<HTMLParagraphElement | null>(null)
  const [foldable, setFoldable] = useState(false)

  useEffect(() => {
    const element = text.current
    if (element === null || expanded) {
      setFoldable(false)
      return
    }
    setFoldable(element.scrollHeight > element.clientHeight + 1)
  })

  return (
    <div className={css.textBlock}>
      <p ref={text} className={expanded ? css.text : css.clamp}>{post.text}</p>
      {expanded || foldable
        ? (
          <button
            type="button"
            className={css.toggle}
            onClick={() => { tweet.toggleExpanded(post.id) }}
          >{expanded ? t('post.collapse') : t('post.expand')}</button>
        )
        : null}
    </div>
  )
}

/** The separate image grid: one large image alone, tiles when several, lightbox on click. */
function PostImages({ post, tweet, t }: {
  readonly post: Tweet
  readonly tweet: Tweets
  readonly t: TranslateNS<typeof NS>
}): ReactNode {
  const [open, setOpen] = useState<TweetImageRef | null>(null)
  const openUrl = open === null ? null : tweet.imageUrl(open) ?? null
  return (
    <div className={post.images.length === 1 ? css.singleImage : css.images}>
      {post.images.map((image) => {
        const url = tweet.imageUrl(image)
        return (
          <button
            key={image.file}
            type="button"
            className={css.tile}
            onClick={() => { if (url !== undefined) setOpen(image) }}
          >
            {url === undefined
              ? <span className={css.tileLoading} aria-label={t('image.loading')} />
              : <img className={css.tileImage} src={url} alt={image.name ?? ''} />}
          </button>
        )
      })}
      {openUrl !== null
        ? (
          <ImageLightbox
            src={openUrl}
            alt={open?.name ?? ''}
            labels={{ dialog: t('image.dialog'), close: t('image.close') }}
            onClose={() => { setOpen(null) }}
          />
        )
        : null}
    </div>
  )
}

/** Zero-pad one clock component to two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Visible local timestamp of one post: same calendar day → `HH:mm`; earlier
 * this year → the `time.clock.md` date template + clock; other years → the
 * `time.clock.ymd` template + clock. The date templates arrive through the
 * panel's locale seat, so the label follows the app locale, never the browser.
 * @param at - epoch milliseconds from the post's `createdAt`/`updatedAt`.
 * @param t - translate seat supplying the `time.clock.md` / `time.clock.ymd` templates.
 * @param now - reference instant for the day/year cut; defaults to the wall clock.
 * @returns date-aware clock string, 24-hour zero-padded time.
 */
function absoluteClock(at: number, t: TranslateNS<typeof NS>, now: number = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) {
    return clock
  }
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  const md = d.getFullYear() === n.getFullYear() ? t('time.clock.md', params) : t('time.clock.ymd', params)
  return `${md} ${clock}`
}

/** Trailing-time props: the dated instant, the edit instant, and the translator. */
interface PostTimeProps {
  readonly at: number
  readonly edited: number | undefined
  readonly t: TranslateNS<typeof NS>
}

/** The trailing time label: the explicit local timestamp, then the edit marker. */
function PostTime({ at, edited, t }: PostTimeProps): ReactNode {
  return (
    <time className={css.time} dateTime={new Date(at).toISOString()}>
      {absoluteClock(at, t)}
      {edited === undefined ? null : <span className={css.edited}> · {t('post.edited')}</span>}
    </time>
  )
}
