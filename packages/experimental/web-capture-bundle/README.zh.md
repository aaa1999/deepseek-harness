---
description: "profile 层：挂载 PDF 阅读三件套，以及把配套扩展网页快照归档进 PDF 书架的浏览器中继。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-web-capture-bundle

[English](README.md) | 中文

## 概述

为 `dsh --profile` 增加网页快照：PDF 阅读两件套加浏览器中继，同装一层。把此层装进 Web profile 并一次性加载配套 Chromium 扩展后，在任意页面抓取的快照会落入 PDF 书架，携带来源 URL 和日期在阅读器中打开。补丁固定了与 `dsh-pdf-reader-bundle` 相同的 DeepSeek 模型路由。所有随包 profile 均不包含此层。

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

### 安装进 profile

在运行 Web 客户端的 profile 中执行 `dsh plugin --profile <name> add @deepseek-ai/dsh-web-capture-bundle`，或用 `file:` 路径指向本地检出目录。dsh 安装不随包携带此 Bundle，因此它不出现在插件管理页的可选列表中。随后按 [`dsh-client-ui-web-capture`](../client-ui-web-capture/README.zh.md#use-this-package) 的说明，以解压方式加载其 `extension/` 目录中的配套扩展。

### 得到的能力

三个插入行提供完整的快照链路：书库服务 [`dsh-pdf-reader`](../pdf-reader/README.zh.md) 在 harness 主目录下存储文档并流式返回处理，浏览器面板 [`dsh-client-ui-pdf-reader`](../client-ui-pdf-reader/README.zh.md) 注册 PDF 侧栏入口，中继 [`dsh-client-ui-web-capture`](../client-ui-web-capture/README.zh.md) 把扩展快照归档进该书架。补丁为文本处理选择 `deepseek-official/deepseek-chat`，为截图提问选择 `deepseek-official/deepseek-v4-flash-vision-exp`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Bundle 是一份静态补丁文档，只有一个 `insert` 列表：携带数据根目录和两组模型的 `pdf-reader` 服务行、`pdf-reader-ui` 浏览器行，以及 `web-capture-ui` 中继行。行 id 与 `dsh-pdf-reader-bundle` 一致，因此任一 Bundle 都能一步换成另一个，这也是两者不能同装的原因。更上层的补丁或 profile 自身的补丁按 id 覆盖任意行并替换其完整配置。包入口不携带运行时 API。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Bundle 主体：三行及其固定配置 |
| [`src/index.ts`](src/index.ts) | 包入口；不携带运行时 API |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [网页快照中继](../client-ui-web-capture/README.zh.md) — 中继与配套扩展。
- [PDF 书库服务](../pdf-reader/README.zh.md) — 存储与处理请求。
- [浏览器阅读面板](../client-ui-pdf-reader/README.zh.md) — 侧栏界面。
- [PDF 阅读器 Bundle](../pdf-reader-bundle/README.zh.md) — 不含中继的同样阅读行。
- [实验性包地图](../README.zh.md) — 所在的包分组。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，通过插入的行：书库服务拥有每次处理请求，浏览器面板不注册任何模型输入，中继归档快照不发起模型请求。

#### KV 缓存影响

此层不添加请求前缀；处理请求及其路由属于 `dsh-pdf-reader`。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 行 id 与 `dsh-pdf-reader-bundle` 相同；二者只能安装其一，重复安装会产生行冲突。
- 抓取需要以解压方式加载的配套 Chromium 扩展；Bundle 无法安装或更新它。
- 补丁把两组模型固定为 DeepSeek 路由；要在更上层清空 `provider`/`model` 和 `shotProvider`/`shotModel` 才会跟随 profile 默认模型。
- 存储保持在补丁设置的 `dshHomePath('pdf-reader')` 目录；移动它需要阅读器的设置面板或重述该行的配置覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
