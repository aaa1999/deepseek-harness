---
description: "profile 层：挂载 PDF 书库服务与浏览器阅读面板，并附带可用的处理模型路由。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-pdf-reader-bundle

[English](README.md) | 中文

## 概述

为 `dsh --profile` 增加 PDF 阅读：Host 书库服务与浏览器面板成对安装。把此层装进 Web profile 后，侧栏出现 PDF 入口，导入、阅读、划线和截图提问开箱可用。补丁为文本处理和截图提问固定了 DeepSeek 路由，没有默认智能体模型也能流式返回；清空两组即跟随 profile 默认。所有随包 profile 均不包含此层。

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

在运行 Web 客户端的 profile 中执行 `dsh plugin --profile <name> add @deepseek-ai/dsh-pdf-reader-bundle`，或用 `file:` 路径指向本地检出目录。dsh 安装不随包携带此 Bundle，因此它不出现在插件管理页的可选列表中。

### 得到的能力

两个插入行提供的阅读界面：浏览器面板 [`dsh-client-ui-pdf-reader`](../client-ui-pdf-reader/README.zh.md) 注册侧栏入口，书库服务 [`dsh-pdf-reader`](../pdf-reader/README.zh.md) 在 harness 主目录（`<DSH_HOME>/pdf-reader`）下存储文档并流式返回每次处理。补丁为文本处理选择 `deepseek-official/deepseek-chat`，为截图提问选择 `deepseek-official/deepseek-v4-flash-vision-exp`。插件详情页的功能摘要见 `docs/DETAIL.zh.md`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Bundle 是一份静态补丁文档，只有一个 `insert` 列表：携带数据根目录和两组模型的 `pdf-reader` 服务行，以及 `pdf-reader-ui` 浏览器行。更上层的补丁或 profile 自身的补丁按 id 覆盖任一行并替换其完整配置，因此覆盖时需重述要保留的全部设置。`dshHomePath` 表达式在加载时解析存储目录。包入口不携带运行时 API。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Bundle 主体：两行及其固定配置 |
| [`src/index.ts`](src/index.ts) | 包入口；不携带运行时 API |
| `docs/DETAIL.zh.md` | 插件详情页展示的功能摘要 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [PDF 书库服务](../pdf-reader/README.zh.md) — 存储与处理请求。
- [浏览器阅读面板](../client-ui-pdf-reader/README.zh.md) — 侧栏界面。
- [网页快照 Bundle](../web-capture-bundle/README.zh.md) — 同样的行加上快照中继。
- [实验性包地图](../README.zh.md) — 所在的包分组。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，通过插入的行：书库服务拥有每次处理请求及其模型路由，浏览器面板不注册任何模型输入。

#### KV 缓存影响

此层不添加请求前缀；处理请求及其路由属于 `dsh-pdf-reader`。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 补丁把两组模型固定为 DeepSeek 路由；要在更上层清空 `provider`/`model` 和 `shotProvider`/`shotModel` 才会跟随 profile 默认模型。
- 行 id 与 `dsh-web-capture-bundle` 相同；二者只能安装其一，重复安装会产生行冲突。
- 存储保持在补丁设置的 `dshHomePath('pdf-reader')` 目录；移动它需要阅读器的设置面板或重述该行的配置覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
