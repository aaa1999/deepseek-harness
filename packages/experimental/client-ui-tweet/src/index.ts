/**
 * Host Remote of the tweet panel: a personal microblog of plain-text posts
 * with separately laid out images, stored inside one registered Workspace at
 * `.dsh/tweet/`. Every request names the Workspace that owns the data;
 * validation failures are typed Remote errors. A configured `workspacePath`
 * registers one folder as such a Workspace at startup.
 *
 * @module @deepseek-ai/dsh-client-ui-tweet
 */

import { Buffer } from 'node:buffer'
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { admitDataRoot } from './paths.ts'
import { TWEET_MEDIA_TYPES } from './records.ts'
import type { TweetRecord } from './records.ts'
import { createPost, deletePost, editPost, listPosts, readObject } from './store.ts'
import type { StoreImageInput } from './store.ts'
import type {
  EditTweetRequest,
  Tweet,
  TweetImagePayload,
  TweetImageRequest,
  PublishTweetRequest,
  TweetOpenRequest,
  TweetWorkspace,
} from './types.ts'

export type * from './types.ts'

/** Project one stored record onto the wire shape, stripping absent optional fields. */
function toTweet(record: TweetRecord): Tweet {
  return {
    id: record.id,
    text: record.text,
    images: record.images.map(image => ({
      file: image.file,
      mediaType: image.mediaType,
      bytes: image.bytes,
      ...(image.name === undefined ? {} : { name: image.name }),
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
    })),
    createdAt: record.createdAt,
    ...(record.updatedAt === undefined ? {} : { updatedAt: record.updatedAt }),
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote that serves the tweet panel of the GUI. */
    tweet: TweetController
  }
}

/** Configuration of the tweet panel. */
export interface Config {
  /** Absolute folder registered as a Workspace at startup; empty registers nothing, and the folder must exist. */
  workspacePath: string
}

/**
 * Serves the tweet panel. Each method admits the named Workspace, then
 * reads or mutates only that Workspace's data directory.
 */
export class TweetController extends TypertRemoteService {
  static inject = ['workspaceRegistry']

  static Config: z<Config> = z.object({ workspacePath: z.string().default('') })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'tweet')
    if (config.workspacePath !== '' && !isAbsolute(config.workspacePath)) {
      throw new Error('tweet: workspacePath must be an absolute directory path when set')
    }
  }

  /** Register the configured folder as a Workspace before the panel can select it; a missing folder fails startup loudly. */
  protected async [Service.init](): Promise<void> {
    if (this.config.workspacePath === '') return
    await this.ctx.workspaceRegistry.create(this.config.workspacePath)
  }

  /**
   * List the posts of one Workspace, newest first: `createdAt` descending,
   * same-millisecond posts in publish order.
   * @param workspaceId - Workspace whose posts to list.
   * @returns the posts in feed order.
   * @throws {RemoteError} `tweet/unknown-workspace` when the id is not registered; `tweet/corrupt-store` when the index is invalid.
   */
  @Remote('list')
  async list(workspaceId: WorkspaceId): Promise<Tweet[]> {
    const root = admitDataRoot(this.ctx.workspaceRegistry, workspaceId)
    return (await listPosts(root)).map(toTweet)
  }

  /**
   * Register one absolute folder as a Workspace (idempotent) and return it for
   * selection, so the panel can post into any existing directory.
   * @param request - absolute folder path.
   * @returns the registered Workspace view.
   * @throws {RemoteError} `tweet/invalid-workspace-path` when blank or relative;
   * `tweet/workspace-open-failed` when the registry rejects the folder.
   */
  @Remote('open')
  async open(request: TweetOpenRequest): Promise<TweetWorkspace> {
    const path = request.path.trim()
    if (path === '' || !isAbsolute(path)) {
      throw new RemoteError(
        'tweet/invalid-workspace-path',
        'a workspace path must be absolute',
        { path: request.path },
      )
    }
    try {
      const workspace = await this.ctx.workspaceRegistry.create(path)
      return { workspaceId: workspace.id, path: workspace.path, title: workspace.title }
    } catch (error) {
      throw new RemoteError(
        'tweet/workspace-open-failed',
        `opening '${path}' as a workspace failed`,
        { path, reason: String(error) },
      )
    }
  }

  /**
   * Publish one post: validate text and images, store the image bytes as
   * content-addressed objects, and write the post record with its publish time.
   * @param request - target Workspace, post text, and images in display order.
   * @returns the created post.
   * @throws {RemoteError} `tweet/unknown-workspace`, `tweet/empty-post`, or `tweet/unsupported-image-type`.
   */
  @Remote('publish')
  async publish(request: PublishTweetRequest): Promise<Tweet> {
    const root = admitDataRoot(this.ctx.workspaceRegistry, request.workspaceId)
    const text = request.text.trim()
    if (text.length === 0 && request.images.length === 0) {
      throw new RemoteError('tweet/empty-post', 'a post needs text or at least one image', {})
    }
    const images: StoreImageInput[] = request.images.map((image) => {
      if (!TWEET_MEDIA_TYPES.includes(image.mediaType)) {
        throw new RemoteError(
          'tweet/unsupported-image-type',
          `image type '${image.mediaType}' is not accepted`,
          { mediaType: image.mediaType },
        )
      }
      return {
        mediaType: image.mediaType,
        bytes: Buffer.from(image.data, 'base64'),
        ...(image.name === undefined ? {} : { name: image.name }),
        ...(image.width === undefined ? {} : { width: image.width }),
        ...(image.height === undefined ? {} : { height: image.height }),
      }
    })
    return toTweet(await createPost(root, { text, images, now: Date.now() }))
  }

  /**
   * Replace one post's text; images and feed position stay unchanged.
   * @param request - target Workspace, post identity, and replacement text.
   * @returns the updated post.
   * @throws {RemoteError} `tweet/unknown-workspace`, `tweet/empty-post`, or `tweet/post-not-found`.
   */
  @Remote('edit')
  async edit(request: EditTweetRequest): Promise<Tweet> {
    const root = admitDataRoot(this.ctx.workspaceRegistry, request.workspaceId)
    const text = request.text.trim()
    if (text.length === 0) {
      throw new RemoteError('tweet/empty-post', 'the edited text must not be empty', {})
    }
    return toTweet(await editPost(root, request.id, text, Date.now()))
  }

  /**
   * Delete one post. Idempotent: an unknown id resolves `false`.
   * @param workspaceId - Workspace whose post to delete.
   * @param id - post identity.
   * @returns whether a record was deleted.
   * @throws {RemoteError} `tweet/unknown-workspace`.
   */
  @Remote('delete')
  async remove(workspaceId: WorkspaceId, id: Tweet['id']): Promise<boolean> {
    const root = admitDataRoot(this.ctx.workspaceRegistry, workspaceId)
    return await deletePost(root, id)
  }

  /**
   * Read one stored image object for display.
   * @param request - target Workspace and object file name.
   * @returns the recorded media type and base64 bytes.
   * @throws {RemoteError} `tweet/unknown-workspace`, `tweet/invalid-object-name`, or `tweet/corrupt-store`.
   */
  @Remote('image')
  async image(request: TweetImageRequest): Promise<TweetImagePayload> {
    const root = admitDataRoot(this.ctx.workspaceRegistry, request.workspaceId)
    const { mediaType, bytes } = await readObject(root, request.file)
    return { mediaType, data: bytes.toString('base64') }
  }
}

export default TweetController
