---
description: "推文 Host Remote：个人微博式面板，帖子、图片与评论都存在所选工作区内。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-tweet

[English](README.md) | 中文

## 概述

实验性推文面板：以纯文本加单独排布图片的形式发布个人推文，类似微博，并可在任意帖子下无数量上限地评论。每个请求都指名一个已注册工作空间，全部数据——帖子记录（文字、图片、评论）与内容寻址的图片字节——都存在该工作空间的 `.dsh/tweet/` 里，信息流随目录走。帖子带发布时间，信息流最新在前，长文折叠为三行，发布器支持粘贴截图。通过 [tweet bundle](../tweet-bundle/README.zh.md) 启用；出厂组合默认不启用。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

每个请求都以 id 指名一个已注册工作空间；未知 id 会以 `tweet/unknown-workspace` 大声失败。发布需要文字或至少一张图片（否则 `tweet/empty-post`），接受 PNG、JPEG、WebP 与 GIF 图片。评论需要非空文字（否则 `tweet/empty-comment`），数量没有上限。面板提供工作空间选择器、带图片暂存与剪贴板粘贴的发布器、三行折叠带展开控制的长文、最新在前的滚动信息流、每帖之下无上限且最旧在前的评论列表（默认折叠为最新三条，可展开）与评论输入框、就地编辑文字，以及带确认的删除。没有配置项：图片准入只保留本面板自身的媒体类型白名单，字节按原样存储。

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>维护者细节 — 点击展开</summary>

存储按工作空间各占一个目录：`posts/<tweetId>.json` 帖子记录——文字、图片引用与该帖评论——`objects/<sha256>.<ext>` 图片字节、`index.json` 发布顺序。每次文件替换都是写临时文件再改名，同一数据根的每次变更都经由按根的 Promise 链，并发 Remote 调用不会交错写入。读取以目录为事实来源——两次写入之间崩溃导致 `index.json` 缺某帖时，该帖仍会列出——索引只用来按发布顺序拆 `createdAt` 同毫秒的平局。非法帖子文件跳过但保留在磁盘；非法索引会让读取以 `tweet/corrupt-store` 失败。文字与图片是记录里的独立字段，页面把它们渲染为独立区块，不存在混排路径。评论是记录里的又一个字段：追加一条就是原子地重写帖子记录，列表没有数量上限且保持最旧在前，删除帖子会连带删除其评论，没有该字段的旧记录按零条评论读取。

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the panel and its Remote serve the human publisher only: they add no tool, prompt section, or Session event, and nothing here changes the model's request context.

#### KV Cache effect

None; every Remote method serves the human panel only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 仅 owner 可用 — 面板挂在单一 `tweet/list` 远程访问键下；尚无共享工作空间信息流的资源授权模型。
- 单一排序 — 信息流总是按 `createdAt` 降序；没有升序、标签或搜索视图。
- 孤立图片对象 — 删除帖子会移除其记录，但保留已存对象供未来帖子复用；没有回收遍历。
- 无分页 — `list` 读取工作空间的全部记录；个人规模的信息流是设计出发点。
- 字节按原样存储 — 发布时图片既不解码也不归一化；损坏的上传在浏览器里渲染为破图。

<a id="dev-note"></a>
### 开发备注

一个值得留存的顺序决策：发布先写帖子记录、再前插索引条目，而读取以目录为事实来源——因此两次写入之间崩溃只会让帖子成为孤儿（仍会列出），而不是让索引指向一条从未落盘的记录。
