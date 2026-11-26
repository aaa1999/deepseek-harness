/**
 * Pure, host-safe wire types of the tweet panel: one personal post is
 * plain text plus separately laid out images, stored inside its Workspace.
 *
 * These types are free of host-side imports (cordis, node:fs), so the client
 * half re-exports them without pulling the host program into the browser
 * bundle.
 *
 * @module @deepseek-ai/dsh-client-ui-tweet/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Identifies one published tweet post. */
export type TweetId = Branded<'TweetId'>

/** Identifies one comment under a tweet post. */
export type TweetCommentId = Branded<'TweetCommentId'>

/** Raster image formats an tweet post accepts. */
export type TweetMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One stored image of a post: a content-addressed object inside the Workspace data directory. */
export interface TweetImageRef {
  /** Object file name inside `objects/`: `<sha256>.<ext>`. */
  readonly file: string
  /** Media type verified at publish time. */
  readonly mediaType: TweetMediaType
  /** Exact encoded byte length. */
  readonly bytes: number
  /** Optional display name stripped of local path information. */
  readonly name?: string
  /** Intrinsic pixel width, when the publisher measured it. */
  readonly width?: number
  /** Intrinsic pixel height, when the publisher measured it. */
  readonly height?: number
}

/** One comment under a published tweet post: plain text, appended in comment order. */
export interface TweetComment {
  /** Stable comment identity. */
  readonly id: TweetCommentId
  /** Comment text; trimmed and non-empty at submission. */
  readonly text: string
  /** Epoch milliseconds at comment time. */
  readonly createdAt: number
}

/** One published tweet post. */
export interface Tweet {
  /** Stable post identity. */
  readonly id: TweetId
  /** Post text; may be empty when the post carries images. */
  readonly text: string
  /** Post images, laid out separately from the text. */
  readonly images: readonly TweetImageRef[]
  /** Comments under this post, oldest first; there is no count limit. */
  readonly comments: readonly TweetComment[]
  /** Epoch milliseconds at publish time; the feed sorts newest first. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest text edit, when edited. */
  readonly updatedAt?: number
}

/** One image upload accompanying a publish request. */
export interface PublishImageInput {
  /** Declared media type. */
  readonly mediaType: TweetMediaType
  /** Canonical base64 encoding of the image bytes. */
  readonly data: string
  /** Optional display name; never interpreted as a path. */
  readonly name?: string
  /** Intrinsic pixel width, when the publisher measured it. */
  readonly width?: number
  /** Intrinsic pixel height, when the publisher measured it. */
  readonly height?: number
}

/** Publish request: the target Workspace plus the post's text and images. */
export interface PublishTweetRequest {
  /** Registered Workspace that owns the stored data. */
  readonly workspaceId: WorkspaceId
  /** Post text; trimmed, and rejected together with `images` when both are empty. */
  readonly text: string
  /** Post images in display order. */
  readonly images: readonly PublishImageInput[]
}

/** Open request: register one absolute folder as the Workspace this panel posts into. */
export interface TweetOpenRequest {
  /** Absolute folder path; must already exist. */
  readonly path: string
}

/** One registered Workspace as the panel selects it. */
export interface TweetWorkspace {
  /** Registered Workspace identity. */
  readonly workspaceId: WorkspaceId
  /** Canonical absolute folder path. */
  readonly path: string
  /** Display title; defaults to the folder name. */
  readonly title: string
}

/** Edit request: replaces the text of one post; images are immutable. */
export interface EditTweetRequest {
  /** Registered Workspace that owns the stored data. */
  readonly workspaceId: WorkspaceId
  /** Post identity. */
  readonly id: TweetId
  /** Replacement text; trimmed and rejected when it empties. */
  readonly text: string
}

/** Comment request: appends one comment under one post; comments have no count limit. */
export interface AddTweetCommentRequest {
  /** Registered Workspace that owns the stored data. */
  readonly workspaceId: WorkspaceId
  /** Post identity. */
  readonly id: TweetId
  /** Comment text; trimmed and rejected when it empties. */
  readonly text: string
}

/** Read request for one stored image object. */
export interface TweetImageRequest {
  /** Registered Workspace that owns the stored data. */
  readonly workspaceId: WorkspaceId
  /** Object file name from the post's {@link TweetImageRef}. */
  readonly file: string
}

/** Image bytes read back for display. */
export interface TweetImagePayload {
  /** Media type recorded at publish time. */
  readonly mediaType: TweetMediaType
  /** Canonical base64 encoding of the stored bytes. */
  readonly data: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The request names a Workspace id the registry does not know. */
    'tweet/unknown-workspace': { readonly workspaceId: string }
    /** The open request path is blank or not absolute. */
    'tweet/invalid-workspace-path': { readonly path: string }
    /** The registry refused to register the requested folder (missing or not a directory). */
    'tweet/workspace-open-failed': { readonly path: string; readonly reason: string }
    /** The request text and images are both empty, or the edit text empties. */
    'tweet/empty-post': Record<string, never>
    /** The request comment text is empty. */
    'tweet/empty-comment': Record<string, never>
    /** The request declares an image type outside the accepted set. */
    'tweet/unsupported-image-type': { readonly mediaType: string }
    /** The request names a post this Workspace's data directory does not hold. */
    'tweet/post-not-found': { readonly id: string }
    /** The request names an image object that is not a stored content-addressed name. */
    'tweet/invalid-object-name': { readonly file: string }
    /** The stored data directory holds a file that is not a valid tweet record. */
    'tweet/corrupt-store': { readonly path: string; readonly reason: string }
  }
}
