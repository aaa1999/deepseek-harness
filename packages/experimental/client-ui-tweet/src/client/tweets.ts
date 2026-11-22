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
  EditTweetRequest,
  Tweet,
  TweetId,
  TweetImagePayload,
  TweetImageRef,
  TweetMediaType,
  PublishTweetRequest,
} from '../types.ts'
import type { TweetsLocaleKey } from './locales.ts'

/** Narrow Remote face the controller needs; the generated client satisfies it. */
export interface TweetsRemoteFace {
  list(workspaceId: WorkspaceId): Promise<RemoteResult<Tweet[]>>
  publish(request: PublishTweetRequest): Promise<RemoteResult<Tweet>>
  edit(request: EditTweetRequest): Promise<RemoteResult<Tweet>>
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
   * fall back to the persisted one, then to the first listed Workspace.
   * @param items - the current Workspace rows.
   */
  syncWorkspaces(items: readonly WorkspaceSummary[]): void {
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
