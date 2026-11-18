---
description: "浏览器读书面板：EPUB 书架、带划线的两栏阅读、流式笔记卡片与笔记收藏。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-epub-reader

[English](README.md) | 中文

## 概述

在 Harness 侧栏中阅读 EPUB 书籍。面板提供带封面和阅读进度的书架，并以两栏阅读器打开书籍：一侧是可调字号、纸面底色和衬线或无衬线字体的章节正文，另一侧是笔记。划选文字可翻译或解释；回答流式进入笔记卡片并保存为划线。收藏的引文和处理结果可归档进笔记面板。Host 书库服务 `dsh-epub-reader` 拥有存储和全部模型请求；`dsh-epub-reader-bundle` 负责组合两者。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

把 [`dsh-epub-reader-bundle`](../epub-reader-bundle/README.zh.md) 安装进 Web profile，侧栏即出现「阅读」入口。面板为实验性插件，在当前会话获准读取书库前不注册任何内容。

### 阅读与管理书籍

点击或拖拽导入；书架列出每本书的作者、章节数、封面和已存进度，并可确认后删除。阅读器一次显示一个净化后的章节：在章节间切换、从目录下拉选择目的地，并用缩放、纸面底色和衬线或无衬线开关调整正文。阅读位置按章节和滚动比例保存；纸面和字体选择按浏览器持久保存。

### 划线与处理选段

划选文字后，右键菜单提供翻译、解释和发送到笔记。翻译和解释把处理结果流式写入标注栏并保存在划线上；卡片可跳回正文位置、复制文字、重新生成或删除，悬停卡片可滚回划线处。发送到笔记把原始选段，或带有全部处理结果的已存卡片，通过笔记面板的同源 JSON API 归档到 dsh-notes。

### 设置存储与模型

书架的设置面板显示解析出的书库目录，并在 profile 允许时改为绝对路径；还可从可路由目录中选择处理模型。留空时跟随 profile 默认模型。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

浏览器入口挂载 `epubReader` Remote 命名空间，随后在 `epubReader/list` 的 Remote 访问有效期间注册侧栏入口、主面板和划选右键菜单目标。控制器为每个插件生命周期持有一个快照存储，并按阅读栏的滚动比例去抖保存进度。章节正文由 Host 预先净化；浏览器以阅读器自身的排版渲染，并把资源引用解析到 Host Fetch 路由。笔记收藏以普通相对 fetch 请求 `/plugins/dsh-notes/api`，任何失败都返回 `false`，因此笔记面板缺席时阅读不受影响。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器入口：Remote 挂载、面板与菜单注册 |
| [`src/client/controller.ts`](src/client/controller.ts) | 阅读状态存储与 Remote 动作 |
| [`src/client/ReaderView.tsx`](src/client/ReaderView.tsx) | 两栏阅读与划线渲染 |
| [`src/client/notes.ts`](src/client/notes.ts) | 笔记面板 JSON API 客户端 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [EPUB 书库服务](../epub-reader/README.zh.md) — 存储书籍并流式返回处理的 Host 一半。
- [EPUB 阅读器 Bundle](../epub-reader-bundle/README.zh.md) — 组合出的 profile 层。
- [实验性包地图](../README.zh.md) — 所在的包分组。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，通过 Host 书库服务：翻译和解释成为 `dsh-epub-reader` 拥有的独立模型请求，本面板不注册任何工具、提示词或会话事件。

#### KV 缓存影响

面板动作不添加请求前缀；每次处理请求及其模型路由都属于 Host 服务。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 发送到笔记依赖已安装的 dsh-notes 面板；缺席时收藏静默失败，不保留任何内容。
- 阅读器只渲染 Host 提供的净化章节；脚本、样式和未提供的媒体类型不会出现。
- 面板为实验性且仅限 Web 平台，每个存储字节都依赖 Host 服务；单独安装时什么都不渲染。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
