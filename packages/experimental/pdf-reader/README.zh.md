---
description: "Host 服务：保存 PDF 书库，向浏览器提供文档与标注，并通过 LLM 服务流式返回划词与截图处理结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-pdf-reader

[English](README.md) | 中文

## 概述

在 Host 上保存 PDF 书库，并从浏览器阅读。导入文件、从上次位置继续，并为每本书保留划线标注和截图提问。选中文字可翻译或解释，页面区域可作为图片提问；回答流式返回并随标注保存。处理请求通过 LLM 服务以独立模型请求发出。浏览器一半是 `dsh-client-ui-pdf-reader`，`dsh-pdf-reader-bundle` 负责组合两者。

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

需要在浏览器面板中渲染并标注本地 PDF 时挂载此服务。浏览器面板 [`dsh-client-ui-pdf-reader`](../client-ui-pdf-reader/README.zh.md) 挂载本服务发布的 Remote 命名空间；[`dsh-pdf-reader-bundle`](../pdf-reader-bundle/README.zh.md) 以可用的模型路由组合两者。书库、进度和标注不需要任何处理模型；处理功能另需可解析的服务商和模型。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-pdf-reader'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dataRoot` | `''` | 书库根目录；留空时解析到运行中的 profile 旁（`<profile>/.pdf-reader`，否则 `<home>/pdf-reader`） |
| `maxPdfBytes` | `100 MiB` | 单个导入文件上限；最大可配 1 GiB |
| `targetLanguage` | `简体中文` | 处理提示词中逐字使用的回答语言名称 |
| `provider` / `model` | `''` | 文本处理覆盖；空值组合跟随 profile 默认模型 |
| `shotProvider` / `shotModel` | `''` | 截图提问覆盖；模型必须接受图片输入 |
| `maxOutputTokens` | `2048` | 单次处理的回答预算，64 到 131072；思考模型额外请求 8192 Token 余量 |

浏览器列出、导入和删除文档，读取存储字节自行交给 PDF.js 解析，首次打开后回传解析出的结构和渲染的封面，并保存阅读进度和标注。划词处理与截图提问以流式文本返回。设置面板可在运行时通过 profile 的配置编辑服务移动书库目录并选择两组模型；没有该服务的 profile 会返回失败。

### 存储与图片

文档保存在解析出的数据根目录下，每本书一个目录，包含原始文件、元数据、进度、标注、封面缩略图和全部已存截图。封面和截图通过两个 Host Fetch 路由以沙箱响应头提供给浏览器；截图按标注 id 不可变，重新生成时更换身份。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

控制器继承 `TypertRemoteService`，发布 `pdfReader` Remote 命名空间，并为未找到、文件损坏、超限、请求、模型解析和流错误声明了 `pdf/*` 类型化失败。导入在写入前校验 `%PDF-` 头和大小；此外的结构问题由浏览器首次打开时的解析报告。

处理请求直接调用 `ctx.llm.stream`。模型解析先取配置的组合，否则取 profile 默认模型；截图提问要求模型具备视觉能力，否则以 `pdf/no-vision-model` 失败。思考模型按适配器默认推理力度请求，否则取支持的最低档，输出上限提高 8192 Token，因为在多个 OpenAI 兼容端点上推理与回答共享一个输出上限。截图先经过附件服务存储，再作为图片内容进入请求。

运行时存储和模型变更是配置编辑：服务通过本地镜像的配置编辑接口修改自身插件条目，因此不携带对该包的依赖。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 控制器、配置模式、Fetch 路由 |
| [`src/store.ts`](src/store.ts) | 每本书的持久存储布局 |
| [`src/prompts.ts`](src/prompts.ts) | 处理与截图提示词模板及截断上限 |
| [`src/types.ts`](src/types.ts) | 与浏览器客户端共享的线上类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [浏览器阅读面板](../client-ui-pdf-reader/README.zh.md) — 挂载此服务的面板。
- [PDF 阅读器 Bundle](../pdf-reader-bundle/README.zh.md) — 组合出的 profile 层。
- [网页快照中继](../client-ui-web-capture/README.zh.md) — 把浏览器快照归档进此书库。
- [实验性包地图](../README.zh.md) — 所在的包分组。

-----

<a id="model-experience"></a>
## 模型体验

### 划词处理

#### 模型收到的内容

每次 `explain` 调用在智能体会话之外发送一个独立请求：一段以中文标明书名和页码的处理提示词，随后一条用户消息，携带截断到 `2000` 字符的选中文字和可选的截断到 `1500` 字符的页面上下文。翻译要求忠实译入配置的 `targetLanguage`；解释要求按释义、结构、用法、背景四部分讲解。

##### 翻译提示词模板

```markdown
你是一位忠于原作的翻译。读者正在阅读书名《书名》，第 12 页的 PDF，会给你一段选中的原文及其上下文。
把选段翻译成目标语言：忠实原意，保留语气、修辞与人称；术语按文档领域惯用译法。
只输出译文本身，不要加注释、标题或原文重复。
```

#### Token 影响

选段与上下文的截断约束了每次请求的输入。回答受 `maxOutputTokens`（默认 2048）限制；思考模型在该预算上额外请求 8192 Token 余量，上限 131072。

#### KV 缓存影响

每次处理都是独立请求，与智能体会话请求不共享前缀。没有刻意缓存；同类处理的重复仅依赖服务商自身对短提示词的前缀缓存。

### 截图提问

#### 模型收到的内容

每次 `askImage` 调用发送一个独立请求：作为 PNG 图片输入的页面裁剪区域（先经附件服务存储），加上截断到 `2000` 字符的问题。问题为空时要求模型用配置的 `targetLanguage` 解释截图。解析出的模型必须接受图片输入；不具备视觉能力的选择会在发出请求前以 `pdf/no-vision-model` 失败。

##### 截图提示词模板

```markdown
你是读者的 PDF 阅读助手。读者正在阅读书名《书名》，第 12 页，从页面上截取了一块区域发给你，并附有一个问题。
读取截图中的文字与图形，用目标语言回答问题。截图里是外文时，翻译要完整准确；问题开放时，解释要具体、贴合这页内容。
```

#### Token 影响

每次请求携带截图的图片 Token 和截断后的问题；回答预算与思考余量遵循文本处理规则。

#### KV 缓存影响

每次提问的裁剪和问题都不同，请求没有刻意共享的前缀，也不复用智能体会话的前缀。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 导入只校验 `%PDF-` 头；结构损坏在浏览器首次打开时才暴露，加密 PDF 暂无法阅读。
- 划词处理需要可选中的文字；没有文字层的扫描页只能使用截图提问。
- 提示词的书页信息固定为中文，与界面语言无关；`targetLanguage` 只命名回答语言。
- 运行时修改存储和模型需要 profile 的配置编辑服务；没有该服务的 profile 对这些调用返回 `pdf/invalid-request`。
- 封面上传限制为 4 MiB、截图为 8 MiB 的 PNG，与 `maxPdfBytes` 相互独立。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
