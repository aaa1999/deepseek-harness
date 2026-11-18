---
description: "浏览器 PDF 面板：书架、带划线的单页阅读、流式笔记卡片，以及由 Host 书库服务的截图提问。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pdf-reader

[English](README.md) | 中文

## 概述

在 Harness 侧栏中阅读 PDF。面板提供带封面和阅读进度的书架，并以单页阅读器打开文档，支持目录跳转、缩放和上下浏览或左右翻页。划选文字可翻译或解释，也可在页面上框选区域向具备视觉能力的模型提问；回答流式进入笔记卡片并保存为划线。Host 书库服务 `dsh-pdf-reader` 拥有存储和全部模型请求；`dsh-pdf-reader-bundle` 负责组合两者。

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

把 [`dsh-pdf-reader-bundle`](../pdf-reader-bundle/README.zh.md) 安装进 Web profile，侧栏即出现 PDF 入口。面板为实验性插件，在当前会话获准读取书库前不注册任何内容。

### 阅读与管理文档

点击或拖拽导入；书架列出每份文档的页数、封面、已存进度，并可确认后删除。网页快照导入的文档在标题下方显示快照日期。阅读器一次显示一页：翻页或跳页、从目录选择目的地、用按钮或 Ctrl/⌘ 加滚轮缩放，并在宽度自适应上下浏览与高度自适应左右翻页之间切换。阅读位置、阅读方式和笔颜色按浏览器持久保存。

### 划线与处理选段

划选文字后，右键菜单提供划线、翻译和解释。划线以五种颜色之一保存纯标记，不发起任何模型调用；笔颜色作用于新划线和已有划线的重新着色。翻译和解释把处理结果流式写入标注栏并保存在划线上；卡片可跳回原页、复制文字、重新生成或删除。页面没有可选文字时，提示会指向截图工具。

### 对截图区域提问

点击剪刀按钮或按 S，在页面上拖选区域（拖到边缘自动滚动，Esc 取消），输入问题或使用「解释这块 / 翻译图中文」快捷动作后发送。提问弹层列出具备视觉能力的模型和已配置的组合；回答流式写入卡片，保留已存截图和问题，可重新生成或删除。

### 设置存储与模型

书架的设置面板显示解析出的书库目录，并在 profile 允许时改为绝对路径；还可从可路由目录中选择处理模型和截图模型。两者留空时跟随 profile 默认模型；截图组合必须接受图片输入。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

浏览器入口挂载 `pdfReader` Remote 命名空间，随后在 `pdfReader/list` 的 Remote 访问有效期间注册侧栏入口、主面板和划选右键菜单目标。控制器为每个插件生命周期持有一个快照存储，并对进度保存做去抖。渲染由包内分块加载的 PDF.js 在独立 Worker 中完成；Worker 失败直接判为打开失败，不回退到主线程解析。首次打开向 Host 回报解析出的结构和渲染的封面。网页快照中继通过 `dsh-pdf-reader:open` 窗口事件落地导入结果。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器入口：Remote 挂载、面板与菜单注册 |
| [`src/client/controller.ts`](src/client/controller.ts) | 阅读状态存储与 Remote 动作 |
| [`src/client/ReaderView.tsx`](src/client/ReaderView.tsx) | 单页阅读、划线、截图框选 |
| [`src/client/pdf/runtime.ts`](src/client/pdf/runtime.ts) | PDF.js Worker 会话与清理 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [PDF 书库服务](../pdf-reader/README.zh.md) — 存储文档并流式返回处理的 Host 一半。
- [PDF 阅读器 Bundle](../pdf-reader-bundle/README.zh.md) — 组合出的 profile 层。
- [网页快照中继](../client-ui-web-capture/README.zh.md) — 把浏览器快照归档进此书架。
- [实验性包地图](../README.zh.md) — 所在的包分组。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，通过 Host 书库服务：翻译、解释和截图提问成为 `dsh-pdf-reader` 拥有的独立模型请求，本面板不注册任何工具、提示词或会话事件。

#### KV 缓存影响

面板动作不添加请求前缀；每次处理请求及其模型路由都属于 Host 服务。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 渲染依赖每个打开文档一个 PDF.js Worker；Worker 启动失败直接判为打开失败，没有主线程回退，加密 PDF 无法打开。
- 截图提问需要具备视觉能力的模型；提问弹层只列出带视觉标记的条目。
- 面板为实验性且仅限 Web 平台，每个存储字节都依赖 Host 服务；单独安装时什么都不渲染。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
