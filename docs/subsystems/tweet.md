# Tweet

English | [中文](tweet.zh.md)

Experimental personal microblog has two roles: the [panel package](../../packages/experimental/client-ui-tweet/README.md) owns the `ctx.tweet` Remote, the workspace-local store, and the browser page, and the [optional bundle](../../packages/experimental/tweet-bundle/README.md) mounts it from the Plugins page. Shipped profiles leave it disabled.

## Workspace-local store

Every request names one registered Workspace by id, and all data lives inside that Workspace at `.dsh/tweet/`: one JSON record per post — its text, image references, and comments — under `posts/`, content-addressed image bytes under `objects/` named `<sha256>.<ext>`, and `index.json` holding publish order. File replaces are write-temp-then-rename and mutations of one root serialize through a per-root chain, so concurrent Remote calls cannot interleave writes. Reads treat the directory as the source of truth — a post file missing from the index after a crash between the two publish writes still lists — while the index only breaks `createdAt` ties in publish order. Invalid post files are skipped and kept; an invalid index fails the read loudly.

## Posts, images, and comments

A post is plain text plus separately laid out images; the two are independent record fields and the page renders them as separate blocks, so no mixing path exists. `Tweet` carries the publish time and an optional edit time; the feed always lists `createdAt` descending, newest first, and an edit rewrites only the text without reordering. `PublishTweetRequest` accepts PNG, JPEG, WebP, and GIF images as base64 and stores the bytes as-is; identical bytes deduplicate onto one object. Image reads return the recorded media type and base64 bytes over the Remote.

Comments are one more field of the post record: `AddTweetCommentRequest` appends one comment — plain text with its own identity and time — by atomically rewriting the record, so a post's comment list is only ever whole. Comments have no count limit, list oldest first, and deleting the post removes them with it; a legacy record without the field reads as zero comments, and the field lands with the first append.

## Panel behavior

The browser page keeps the composer fixed — a text area and a staged-image strip as separate blocks, fed by the file picker or pasted clipboard images — above the scrolling feed. Below every post's meta row sits its comment list, oldest first, with an input that appends one more on Enter or button, unlimited in count; a post with more than three comments folds to the newest three until expanded. Long text folds to three lines with an expand control, deletion asks for inline confirmation, and the Workspace selector's choice persists in localStorage. Blob URLs cache loaded images per object name; disposal revokes them.

## Design rationale

The store keeps the directory as the source of truth and the index as a tiebreak because publish writes the record before the index entry: a crash between the two orphans a post (still listed) instead of hiding one behind an index entry whose record never landed.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtweet--tweetcontroller"></a>

### `ctx.tweet` — `TweetController`

Serves the tweet panel. Each method admits the named Workspace, then reads or mutates only that Workspace's data directory.

```ts cordis-catalog
/**
 * List the posts of one Workspace, newest first: `createdAt` descending,
 * same-millisecond posts in publish order.
 * @param workspaceId - Workspace whose posts to list.
 * @returns the posts in feed order.
 * @throws {RemoteError} `tweet/unknown-workspace` when the id is not registered; `tweet/corrupt-store` when the index is invalid.
 */
@Remote('list') async list(workspaceId: WorkspaceId): Promise<Tweet[]>

/**
 * Register one absolute folder as a Workspace (idempotent) and return it for
 * selection, so the panel can post into any existing directory.
 * @param request - absolute folder path.
 * @returns the registered Workspace view.
 * @throws {RemoteError} `tweet/invalid-workspace-path` when blank or relative;
 * `tweet/workspace-open-failed` when the registry rejects the folder.
 */
@Remote('open') async open(request: TweetOpenRequest): Promise<TweetWorkspace>

/**
 * Publish one post: validate text and images, store the image bytes as
 * content-addressed objects, and write the post record with its publish time.
 * @param request - target Workspace, post text, and images in display order.
 * @returns the created post.
 * @throws {RemoteError} `tweet/unknown-workspace`, `tweet/empty-post`, or `tweet/unsupported-image-type`.
 */
@Remote('publish') async publish(request: PublishTweetRequest): Promise<Tweet>

/**
 * Replace one post's text; images and feed position stay unchanged.
 * @param request - target Workspace, post identity, and replacement text.
 * @returns the updated post.
 * @throws {RemoteError} `tweet/unknown-workspace`, `tweet/empty-post`, or `tweet/post-not-found`.
 */
@Remote('edit') async edit(request: EditTweetRequest): Promise<Tweet>

/**
 * Append one comment under a post. Comments are unlimited: every accepted
 * request appends one more, oldest first, and deleting the post removes its
 * comments with it.
 * @param request - target Workspace, post identity, and comment text.
 * @returns the updated post with its comments.
 * @throws {RemoteError} `tweet/unknown-workspace`, `tweet/empty-comment`, or `tweet/post-not-found`.
 */
@Remote('comment') async comment(request: AddTweetCommentRequest): Promise<Tweet>

/**
 * Delete one post. Idempotent: an unknown id resolves `false`.
 * @param workspaceId - Workspace whose post to delete.
 * @param id - post identity.
 * @returns whether a record was deleted.
 * @throws {RemoteError} `tweet/unknown-workspace`.
 */
@Remote('delete') async remove(workspaceId: WorkspaceId, id: Tweet['id']): Promise<boolean>

/**
 * Read one stored image object for display.
 * @param request - target Workspace and object file name.
 * @returns the recorded media type and base64 bytes.
 * @throws {RemoteError} `tweet/unknown-workspace`, `tweet/invalid-object-name`, or `tweet/corrupt-store`.
 */
@Remote('image') async image(request: TweetImageRequest): Promise<TweetImagePayload>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/experimental/client-ui-tweet/src/index.ts`](../../packages/experimental/client-ui-tweet/src/index.ts)
<!-- END GENERATED cordis-surface -->
