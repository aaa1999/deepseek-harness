# 推文

[English](tweet.md) | 中文

实验性个人微博有两个角色：[面板包](../../packages/experimental/client-ui-tweet/README.zh.md)拥有 `ctx.tweet` Remote、工作空间本地存储与浏览器页面，[可选 bundle](../../packages/experimental/tweet-bundle/README.zh.md)把它从插件页挂载进来。出厂组合默认不启用。

## 工作空间本地存储

每个请求都以 id 指名一个已注册工作空间，全部数据存在该工作空间的 `.dsh/tweet/` 里：`posts/` 下每帖一个 JSON 记录（文字、图片引用与该帖评论）、`objects/` 下按 `<sha256>.<ext>` 内容寻址的图片字节、`index.json` 保存发布顺序。文件替换都是写临时文件再改名，同一数据根的变更经由按根的链串行，并发 Remote 调用不会交错写入。读取以目录为事实来源——发布两次写入之间崩溃导致索引缺某帖时，该帖仍会列出——索引只按发布顺序拆 `createdAt` 同毫秒的平局。非法帖子文件跳过并保留；非法索引让读取大声失败。

## 帖子、图片与评论

一条帖子是纯文本加单独排布的图片；两者是记录里的独立字段，页面把它们渲染为独立区块，不存在混排路径。`Tweet` 携带发布时间与可选的编辑时间；信息流总是按 `createdAt` 降序、最新在前，编辑只重写文字而不重排。`PublishTweetRequest` 接受 PNG、JPEG、WebP 与 GIF 的 base64 图片并按原样存储字节；相同字节去重到同一个对象。图片读取经 Remote 返回记录的媒体类型与 base64 字节。

评论是帖子记录里的又一个字段：`AddTweetCommentRequest` 追加一条评论——纯文本，带自己的 id 与时间——方式是原子地重写整条记录，因此一条帖子的评论列表只会整存整取。评论没有数量上限，按最旧在前排列，删除帖子会连带删除其评论；没有该字段的旧记录按零条评论读取，字段随第一次追加落盘。

## 面板行为

浏览器页面把发布器固定在顶部——文字输入区与暂存图片条是两个独立区块，图片来自文件选择器或剪贴板粘贴——下方是滚动信息流。每条帖子信息行之下是它的评论列表，最旧在前，输入框回车或按钮即追加一条，数量无上限；评论超过三条的帖子默认折叠为最新三条，可展开。长文折叠为三行并可展开，删除就地确认，工作空间选择器的选择持久化在 localStorage。已加载图片按对象名缓存 Blob URL；销毁时全部回收。

## 设计理由

存储以目录为事实来源、索引只作 tiebreak，是因为发布先写记录再写索引条目：两次写入之间崩溃只会让帖子成为孤儿（仍会列出），而不是让索引指向一条从未落盘的记录。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [WorkspaceId](workspace.zh.md)

Source: [`packages/experimental/client-ui-tweet/src/index.ts`](../../packages/experimental/client-ui-tweet/src/index.ts)
<!-- END GENERATED cordis-surface -->
