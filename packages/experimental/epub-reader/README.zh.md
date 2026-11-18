---
description: "Host 服务：保存 EPUB 书库，向浏览器提供净化后的章节，并通过 LLM 服务流式返回划词处理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-epub-reader

[English](README.md) | 中文

## 概述

在 Host 上保存 EPUB 书库，并从浏览器阅读。导入书籍、从上次位置继续，并为每本书保留划线。选中文字可翻译或解释；回答流式返回并随划线保存。章节经严格白名单净化后进入浏览器，图片和字体从书籍本身提供。处理请求通过 LLM 服务以独立模型请求发出。浏览器一半是 `dsh-client-ui-epub-reader`，`dsh-epub-reader-bundle` 负责组合两者。

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

需要在浏览器面板中渲染并标注本地 EPUB 时挂载此服务。浏览器面板 [`dsh-client-ui-epub-reader`](../client-ui-epub-reader/README.zh.md) 挂载本服务发布的 Remote 命名空间；[`dsh-epub-reader-bundle`](../epub-reader-bundle/README.zh.md) 以可用的模型路由组合两者。书库、进度和标注不需要任何处理模型；处理功能另需可解析的服务商和模型。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-epub-reader'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dataRoot` | `''` | 书库根目录；留空时解析到运行中的 profile 旁（`<profile>/.epub-reader`，否则 `<home>/epub-reader`） |
| `maxBookBytes` | `50 MiB` | 单个导入压缩包上限；最大可配 256 MiB |
| `targetLanguage` | `简体中文` | 处理提示词中逐字使用的回答语言名称 |
| `provider` / `model` | `''` | 处理覆盖；空值组合跟随 profile 默认模型 |
| `maxOutputTokens` | `2048` | 单次处理的回答预算，64 到 131072；思考模型额外请求 8192 Token 余量 |

浏览器列出、导入和删除书籍，读取目录和净化后的章节正文，并保存阅读位置和划线。划词处理以流式文本返回。设置面板可在运行时通过 profile 的配置编辑服务移动书库目录并选择处理模型；没有该服务的 profile 会返回失败。

### 存储与资源

书籍保存在解析出的数据根目录下，每本书一个目录，包含原始压缩包、解出的内容、解析出的结构、进度和划线。章节图片和字体通过一个 Host Fetch 路由以沙箱响应头提供给浏览器，仅限净化器允许的媒体类型；书籍内容在每次导入后不可变。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

控制器继承 `TypertRemoteService`，发布 `epubReader` Remote 命名空间，并为未找到、文件损坏、超限、请求、模型解析和流错误声明了 `epub/*` 类型化失败。导入解码压缩包，用 `fast-xml-parser` 解析 container、package 文档和 spine，用 `fflate` 解出成员；无法得到可用结构的压缩包以 `epub/bad-file` 失败。

每个章节文档都是不可信的外部内容，进入浏览器前经过严格净化：按白名单保留标签和属性，移除脚本、样式、表单和媒体控制子树，丢弃书籍未携带资源的引用，并把保留的图片引用改写到资源 Fetch 路由。内部路径解析限制在书籍内容目录之下并拒绝越界。

处理请求直接调用 `ctx.llm.stream`。模型解析先取配置的组合，否则取 profile 默认模型。思考模型按适配器默认推理力度请求，否则取支持的最低档，输出上限提高 8192 Token，因为在多个 OpenAI 兼容端点上推理与回答共享一个输出上限。运行时存储和模型变更通过本地镜像的配置编辑接口修改自身插件条目。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 控制器、配置模式、资源路由 |
| [`src/epub.ts`](src/epub.ts) | 基于内存文件映射的纯 EPUB 结构解析 |
| [`src/sanitize.ts`](src/sanitize.ts) | 章节白名单净化器与允许的媒体类型 |
| [`src/store.ts`](src/store.ts) | 每本书的持久存储布局 |
| [`src/prompts.ts`](src/prompts.ts) | 处理提示词模板及截断上限 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [浏览器读书面板](../client-ui-epub-reader/README.zh.md) — 挂载此服务的面板。
- [EPUB 阅读器 Bundle](../epub-reader-bundle/README.zh.md) — 组合出的 profile 层。
- [实验性包地图](../README.zh.md) — 所在的包分组。

-----

<a id="model-experience"></a>
## 模型体验

### 划词处理

#### 模型收到的内容

每次 `explain` 调用在智能体会话之外发送一个独立请求：一段以中文标明书名和章节的处理提示词，随后一条用户消息，携带截断到 `2000` 字符的选中文字和截断到 `1500` 字符的所在段落。翻译要求忠实译入配置的 `targetLanguage` 的文学译文；解释要求按释义、语法、用法、背景四部分讲解。

##### 翻译提示词模板

```markdown
你是一位忠于原作的文学翻译。读者正在阅读书名《书名》，章节「章节名」，会给你一段原文选段及其所在段落。
把选段翻译成目标语言：忠实原意，保留语气、修辞与人称；诗歌保留分行。
只输出译文本身，不要加注释、标题或原文重复。
```

#### Token 影响

选段与段落的截断约束了每次请求的输入。回答受 `maxOutputTokens`（默认 2048）限制；思考模型在该预算上额外请求 8192 Token 余量，上限 131072。

#### KV 缓存影响

每次处理都是独立请求，与智能体会话请求不共享前缀。没有刻意缓存；同类处理的重复仅依赖服务商自身对短提示词的前缀缓存。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 导入要求 container、package 文档和 spine 可解析的 EPUB；其余情况在解出前以 `epub/bad-file` 失败。
- 净化器只保留白名单标签和属性，只提供已声明的图片和字体媒体类型；脚本、样式、表单等其他嵌入内容不会到达浏览器。
- 处理仅限文字；没有截图或图片路径。
- 提示词的书章信息固定为中文，与界面语言无关；`targetLanguage` 只命名回答语言。
- 运行时修改存储和模型需要 profile 的配置编辑服务；没有该服务的 profile 对这些调用返回 `epub/invalid-request`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
