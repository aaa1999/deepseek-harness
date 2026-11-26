---
description: "在插件页启用推文面板。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tweet-bundle

[English](README.md) | 中文

## 概述

在应用内发布个人推文。在 Web 或桌面端插件页启用“推文”；出厂组合默认不启用。选一个已注册工作空间，然后以纯文本加单独排布图片的形式发帖，类似微博：截图直接粘进发布器，长文折叠为三行并可展开，事后可改文字，可在任意帖子下无数量上限地评论（评论列表默认折叠为最新三条，可展开），信息流最新在前、独立滚动。每条帖子、每条评论与每个图片字节都存在该工作空间的 `.dsh/tweet/` 目录里，信息流随工作空间走。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

打开插件页，在官方分组启用“推文”。面板从已注册工作空间列表填充选择器；选择器为空时先在工作区界面添加工作空间。接受的图片类型为 PNG、JPEG、WebP 与 GIF，发布器对文件选择器和剪贴板一视同仁。

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>维护者细节 — 点击展开</summary>

该 bundle 只挂一行，即面板包，其 Host 半提供完整的 `tweet` Remote；存储布局、排序与准入契约见[面板包](../client-ui-tweet/README.zh.md#understand-the-implementation)。

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this bundle only mounts the human panel and its Remote: no tool, prompt section, or Session event changes the model's request context.

#### KV Cache effect

None; enabling or disabling the bundle changes no request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 仅 owner 可用 — 见[面板包](../client-ui-tweet/README.zh.md#known-limitations-and-deferred-work)；其排序、保留与分页限制在此原样适用。

<a id="dev-note"></a>
### 开发备注

该 bundle 只挂一行是刻意的：其上一切都是面板包自己的缝，profile patch 只需替换一个目标，这里不驻留任何组合状态。
