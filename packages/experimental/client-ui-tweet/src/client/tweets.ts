/**
 * The tweet panel controller: one snapshot store the page renders with
 * `useSyncExternalStore`, the Remote calls behind it, staged-image handling
 * for the composer, and the Blob-URL cache that turns stored objects into
 * renderable previews.
 *
 * One Workspace is selected at a time and owns the whole feed. Posts keep the
 * Host's newest-first order; expanding a long post and editing are local UI
 * state that never reaches the store.
 */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { TWEET_MEDIA_TYPES } from '../records.ts'
import type {
  AddTweetCommentRequest,
  EditTweetRequest,
  Tweet,
  TweetId,
  TweetImagePayload,
  TweetImageRef,
  TweetMediaType,
  PublishTweetRequest,
  TweetWorkspace,
} from '../types.ts'
import type { TweetsLocaleKey } from './locales.ts'

/** Narrow Remote face the controller needs; the generated client satisfies it. */
export interface TweetsRemoteFace {
  list(workspaceId: WorkspaceId): Promise<RemoteResult<Tweet[]>>
  open(request: { readonly path: string }): Promise<RemoteResult<TweetWorkspace>>
  publish(request: PublishTweetRequest): Promise<RemoteResult<Tweet>>
  edit(request: EditTweetRequest): Promise<RemoteResult<Tweet>>
  comment(request: AddTweetCommentRequest): Promise<RemoteResult<Tweet>>
  delete(workspaceId: WorkspaceId, id: TweetId): Promise<RemoteResult<boolean>>
  image(request: { readonly workspaceId: WorkspaceId; readonly file: string }): Promise<RemoteResult<TweetImagePayload>>
}

/** One Workspace row the selector offers. */
export interface WorkspaceSummary {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly title: string
}

/** One composer-staged image awaiting publish. */
export interface StagedImage {
  /** Local staging identity. */
  readonly key: string
  readonly mediaType: TweetMediaType
  /** Canonical base64 of the image bytes. */
  readonly data: string
  readonly name?: string
  readonly width?: number
  readonly height?: number
  /** Object URL of the local file, revoked on removal, publish, or dispose. */
  readonly previewUrl: string
}

/** The whole panel snapshot; every field immutable, replaced on change. */
export interface TweetsState {
  readonly workspaceId: WorkspaceId | null
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly errorMessage: string | null
  readonly posts: readonly Tweet[]
  /** Object URL per stored image object name; content addressing makes names globally unique. */
  readonly imageUrls: ReadonlyMap<string, string>
  readonly draft: string
  readonly staged: readonly StagedImage[]
  readonly publishing: boolean
  readonly editingId: TweetId | null
  readonly editingText: string
  readonly expanded: ReadonlySet<TweetId>
  /** Comment drafts keyed by post identity; one draft per post, kept across refreshes. */
  readonly commentDrafts: ReadonlyMap<TweetId, string>
  /** Posts with a comment submission in flight. */
  readonly commenting: ReadonlySet<TweetId>
  /** Posts whose comment list shows every comment instead of the default newest three. */
  readonly commentExpanded: ReadonlySet<TweetId>
  /** Current value of the open-directory input. */
  readonly openPath: string
}

const INITIAL: TweetsState = {
  workspaceId: null,
  status: 'idle',
  errorMessage: null,
  posts: [],
  imageUrls: new Map(),
  draft: '',
  staged: [],
  publishing: false,
  editingId: null,
  editingText: '',
  expanded: new Set(),
  commentDrafts: new Map(),
  commenting: new Set(),
  commentExpanded: new Set(),
  openPath: '',
}

/** localStorage key of the last selected workspace. */
const WORKSPACE_STORAGE_KEY = 'dsh.tweet.workspace.v1'

/**
 * Extract the image files of one clipboard item list; text and non-image
 * entries pass through untouched.
 * @param items - clipboard items of a paste event.
 * @returns the image files the composer should stage.
 */
export function imagesFromClipboard(items: readonly {
  readonly kind: string
  readonly type: string
  getAsFile(): File | null
}[]): File[] {
  const files: File[] = []
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file !== null) files.push(file)
  }
  return files
}

/**
 * Read one local file into a staged image; non-accepted image types resolve `null`.
 * @param file - a picker or clipboard file.
 * @returns the staged image with its preview URL, or `null` when refused.
 */
export async function fileToStagedImage(file: File): Promise<StagedImage | null> {
  const mediaType = TWEET_MEDIA_TYPES.find(type => type === file.type)
  if (mediaType === undefined) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  const bareName = file.name === '' ? undefined : file.name
  return {
    key: `staged-${randomUUID()}`,
    mediaType,
    data: btoa(binary),
    ...(bareName === undefined ? {} : { name: bareName }),
    previewUrl: URL.createObjectURL(file),
  }
}

/** Decode base64 payload bytes into a Blob-URL-ready buffer. */
function payloadBytes(payload: TweetImagePayload): Uint8Array<ArrayBuffer> {
  const binary = atob(payload.data)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * The panel controller over one Remote face.
 */
export class Tweets {
  private state: TweetsState = INITIAL
  private readonly listeners = new Set<() => void>()
  /** Bumped by {@link dispose}; an in-flight request of an earlier generation never writes state. */
  private generation = 0
  private disposed = false
  /** Latest Workspace rows {@link syncWorkspaces} saw, so an opened id can be checked immediately. */
  private listed: readonly WorkspaceSummary[] = []
  /** A freshly opened Workspace awaiting its first appearance in the Host list. */
  private pendingOpen: WorkspaceId | null = null

  /**
   * @param remote - the mounted tweet Remote face.
   * @param format - locale-aware message renderer for errors.
   */
  constructor(
    private readonly remote: TweetsRemoteFace,
    private readonly format: (key: TweetsLocaleKey, params?: Record<string, unknown>) => string,
  ) {}

  /**
   * Current snapshot.
   * @returns the state the page renders.
   */
  getSnapshot(): TweetsState {
    return this.state
  }

  /**
   * Subscribe to snapshot changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stop the controller and revoke every object URL it created. */
  dispose(): void {
    this.generation += 1
    this.disposed = true
    for (const url of this.state.imageUrls.values()) URL.revokeObjectURL(url)
    for (const image of this.state.staged) URL.revokeObjectURL(image.previewUrl)
    this.listeners.clear()
  }

  /**
   * Reconcile the selection with the Workspace list: keep the current choice,
   * fall back to the persisted one, then to the first listed Workspace. A
   * freshly opened Workspace takes the selection as soon as the list carries it.
   * @param items - the current Workspace rows.
   */
  syncWorkspaces(items: readonly WorkspaceSummary[]): void {
    this.listed = items
    if (this.pendingOpen !== null) {
      const pending = this.pendingOpen
      if (items.some(item => item.workspaceId === pending)) {
        this.pendingOpen = null
        if (this.state.workspaceId !== pending) this.selectWorkspace(pending)
        return
      }
    }
    const current = this.state.workspaceId
    const effective = current !== null && items.some(item => item.workspaceId === current)
      ? current
      : this.persistedSelection(items)
    if (effective === undefined) {
      if (this.state.workspaceId !== null) this.update({ workspaceId: null, status: 'idle', posts: [], errorMessage: null })
      return
    }
    if (effective === this.state.workspaceId) return
    this.selectWorkspace(effective)
  }

  /**
   * Select one Workspace and load its feed.
   * @param workspaceId - Workspace whose posts to show.
   */
  selectWorkspace(workspaceId: WorkspaceId): void {
    try {
      globalThis.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId)
    } catch (error) {
      // A private browsing mode that refuses storage keeps the selection per-mount.
      void error
    }
    this.update({ workspaceId, status: 'loading', errorMessage: null })
    void this.refresh()
  }

  /**
   * Replace the open-directory input text.
   * @param text - the current input value.
   */
  setOpenPath(text: string): void {
    this.update({ openPath: text })
  }

  /**
   * Open the input's folder as a Workspace: register it on the Host, then
   * select it once the Workspace list carries it (immediately when the
   * registry already held it).
   * @returns whether the registration succeeded; failures fold into `errorMessage`.
   */
  async openWorkspace(): Promise<boolean> {
    const path = this.state.openPath.trim()
    if (path === '') return false
    const result = await this.remote.open({ path })
    if (this.disposed) return result.ok
    if (!result.ok) {
      this.update({ errorMessage: this.format('action.failed', { message: result.error.message }) })
      return false
    }
    this.update({ openPath: '', errorMessage: null })
    if (this.listed.some(item => item.workspaceId === result.value.workspaceId)) {
      this.selectWorkspace(result.value.workspaceId)
    } else {
      this.pendingOpen = result.value.workspaceId
    }
    return true
  }

  /**
   * Reload the selected Workspace's feed.
   */
  async refresh(): Promise<void> {
    const workspaceId = this.state.workspaceId
    if (workspaceId === null) return
    const generation = this.generation
    const result = await this.remote.list(workspaceId)
    if (generation !== this.generation || this.state.workspaceId !== workspaceId) return
    if (!result.ok) {
      this.update({ status: 'error', errorMessage: this.format('feed.failed', { message: result.error.message }) })
      return
    }
    this.update({ status: 'ready', posts: result.value, errorMessage: null })
    this.loadImages(result.value)
  }

  /**
   * Replace the composer draft text.
   * @param text - the current draft.
   */
  setDraft(text: string): void {
    this.update({ draft: text })
  }

  /**
   * Stage local image files; refused files are skipped.
   * @param files - picker or clipboard files.
   */
  addStagedFiles(files: readonly File[]): void {
    void (async () => {
      const staged: StagedImage[] = []
      for (const file of files) {
        const image = await fileToStagedImage(file)
        if (image !== null) staged.push(image)
      }
      if (this.disposed || staged.length === 0) {
        for (const image of staged) URL.revokeObjectURL(image.previewUrl)
        return
      }
      this.update({ staged: [...this.state.staged, ...staged] })
    })()
  }

  /**
   * Unstage one staged image.
   * @param key - staging identity.
   */
  removeStaged(key: string): void {
    const image = this.state.staged.find(staged => staged.key === key)
    if (image === undefined) return
    URL.revokeObjectURL(image.previewUrl)
    this.update({ staged: this.state.staged.filter(staged => staged.key !== key) })
  }

  /**
   * Record the intrinsic pixel size a rendered preview measured. A renderer
   * that reports no decoded raster (natural size zero) keeps the size unset:
   * a zero would fail the record schema at the next read.
   * @param key - staging identity.
   * @param width - intrinsic width in pixels.
   * @param height - intrinsic height in pixels.
   */
  setStagedSize(key: string, width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.update({
      staged: this.state.staged.map(staged => staged.key === key
        ? { ...staged, width, height }
        : staged),
    })
  }

  /**
   * Publish the draft text plus staged images to the selected Workspace.
   */
  async publish(): Promise<void> {
    const { workspaceId, draft, staged, publishing } = this.state
    if (workspaceId === null || publishing) return
    if (draft.trim().length === 0 && staged.length === 0) return
    this.update({ publishing: true })
    const result = await this.remote.publish({
      workspaceId,
      text: draft,
      images: staged.map(image => ({
        mediaType: image.mediaType,
        data: image.data,
        ...(image.name === undefined ? {} : { name: image.name }),
        ...(image.width === undefined ? {} : { width: image.width }),
        ...(image.height === undefined ? {} : { height: image.height }),
      })),
    })
    if (this.disposed) return
    this.update({ publishing: false })
    if (!result.ok) {
      this.update({ errorMessage: this.format('action.failed', { message: result.error.message }) })
      return
    }
    for (const image of staged) URL.revokeObjectURL(image.previewUrl)
    this.update({ draft: '', staged: [], errorMessage: null, posts: [result.value, ...this.state.posts] })
    this.loadImages([result.value])
  }

  /**
   * Enter text-editing mode for one post.
   * @param post - the post to edit.
   */
  beginEdit(post: Tweet): void {
    this.update({ editingId: post.id, editingText: post.text })
  }

  /**
   * Replace the editing draft text.
   * @param text - the current editing draft.
   */
  setEditingText(text: string): void {
    this.update({ editingText: text })
  }

  /** Leave editing mode without writing. */
  cancelEdit(): void {
    this.update({ editingId: null, editingText: '' })
  }

  /**
   * Save the editing draft as the post's new text; feed position is unchanged.
   */
  async saveEdit(): Promise<void> {
    const { workspaceId, editingId, editingText } = this.state
    if (workspaceId === null || editingId === null) return
    if (editingText.trim().length === 0) return
    const result = await this.remote.edit({ workspaceId, id: editingId, text: editingText })
    if (this.disposed) return
    if (!result.ok) {
      this.update({ errorMessage: this.format('action.failed', { message: result.error.message }) })
      return
    }
    this.update({
      editingId: null,
      editingText: '',
      errorMessage: null,
      posts: this.state.posts.map(post => post.id === editingId ? result.value : post),
    })
  }

  /**
   * Replace one post's comment draft text.
   * @param id - post identity.
   * @param text - the current comment draft.
   */
  setCommentDraft(id: TweetId, text: string): void {
    const drafts = new Map(this.state.commentDrafts)
    if (text === '') drafts.delete(id)
    else drafts.set(id, text)
    this.update({ commentDrafts: drafts })
  }

  /**
   * Submit one post's comment draft: append it on the Host and swap in the
   * returned post. Comments are unlimited, so an empty draft is the only
   * local refusal; a second click while one submission runs is ignored.
   * @param id - post identity.
   */
  async submitComment(id: TweetId): Promise<void> {
    const { workspaceId, commentDrafts, commenting } = this.state
    const text = (commentDrafts.get(id) ?? '').trim()
    if (workspaceId === null || text.length === 0 || commenting.has(id)) return
    this.update({ commenting: new Set(commenting).add(id) })
    const result = await this.remote.comment({ workspaceId, id, text })
    if (this.disposed) return
    const busy = new Set(this.state.commenting)
    busy.delete(id)
    if (!result.ok) {
      this.update({ commenting: busy, errorMessage: this.format('action.failed', { message: result.error.message }) })
      return
    }
    const drafts = new Map(this.state.commentDrafts)
    // Clear the draft only when it still holds what was submitted: typing that
    // continued while the request ran survives.
    if ((drafts.get(id) ?? '').trim() === text) drafts.delete(id)
    this.update({
      commenting: busy,
      commentDrafts: drafts,
      errorMessage: null,
      posts: this.state.posts.map(post => post.id === id ? result.value : post),
    })
  }

  /**
   * Delete one post from the selected Workspace.
   * @param id - post identity.
   */
  async remove(id: TweetId): Promise<void> {
    const workspaceId = this.state.workspaceId
    if (workspaceId === null) return
    const result = await this.remote.delete(workspaceId, id)
    if (this.disposed) return
    if (!result.ok) {
      this.update({ errorMessage: this.format('action.failed', { message: result.error.message }) })
      return
    }
    this.update({ posts: this.state.posts.filter(post => post.id !== id) })
  }

  /**
   * Toggle one post's expanded (full-text) rendering.
   * @param id - post identity.
   */
  toggleExpanded(id: TweetId): void {
    const expanded = new Set(this.state.expanded)
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    this.update({ expanded })
  }

  /**
   * Toggle one post's comment list between the default newest-three window
   * and every comment.
   * @param id - post identity.
   */
  toggleCommentExpanded(id: TweetId): void {
    const expanded = new Set(this.state.commentExpanded)
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    this.update({ commentExpanded: expanded })
  }

  /**
   * Object URL of one stored image, when loaded.
   * @param image - the post image reference.
   * @returns the renderable URL, or `undefined` while loading.
   */
  imageUrl(image: TweetImageRef): string | undefined {
    return this.state.imageUrls.get(image.file)
  }

  /** Load Blob URLs for every image of the given posts that has none yet. */
  private loadImages(posts: readonly Tweet[]): void {
    const workspaceId = this.state.workspaceId
    if (workspaceId === null) return
    for (const post of posts) {
      for (const image of post.images) {
        if (this.state.imageUrls.has(image.file)) continue
        void (async () => {
          const result = await this.remote.image({ workspaceId, file: image.file })
          if (this.disposed || !result.ok) return
          if (this.state.imageUrls.has(image.file)) return
          const url = URL.createObjectURL(new Blob([payloadBytes(result.value)], { type: result.value.mediaType }))
          this.update({ imageUrls: new Map(this.state.imageUrls).set(image.file, url) })
        })()
      }
    }
  }

  /** The persisted workspace selection when it is still listed, else the first row. */
  private persistedSelection(items: readonly WorkspaceSummary[]): WorkspaceId | undefined {
    let stored: string | null = null
    try {
      stored = globalThis.localStorage.getItem(WORKSPACE_STORAGE_KEY)
    } catch (error) {
      // A storage refusal falls back to the first listed Workspace for this mount.
      void error
      stored = null
    }
    const persisted = items.find(item => item.workspaceId === stored)
    return (persisted ?? items[0])?.workspaceId
  }

  /** Merge a partial snapshot and notify every listener. */
  private update(partial: Partial<TweetsState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }
}
