---
description: "从插件页启用 TypeScript 代码工作台面板。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-code-studio-bundle

[English](README.md) | 中文

## 概述

在应用内编写、运行并调试 TypeScript。在 Web 或桌面端插件页启用代码工作台；随产品发布的 profile 默认不启用。选择一个已注册的工作区，编辑其中的 `.ts` 文件，享受来自 `typescript-language-server` 的补全、悬停与诊断，用 Cmd/Ctrl+S 保存，运行当前文件并查看流式输出，或用行断点、单步、调用栈与变量进行调试。运行与调试子进程受沙箱约束，可达范围为工作区写入。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

打开插件页，在官方分组中启用代码工作台。面板包自带 `typescript-language-server` 与 `typescript` 依赖，语言服务无需全局安装；在 `code-studio` 行覆盖 `languageServerCommand` 可指向其他服务器，覆盖 `runtimeCommand` 可用非 `node` 运行入口。运行或调试的入口是当前编辑器中的活动文件。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>Maintainer details — click to expand</summary>

bundle 只挂载面板包一行，其 Host 半部分提供完整的 `codeStudio` Remote；流、沙箱与调试器的契约见[面板包](../client-ui-code-studio/README.zh.md#understand-the-implementation)。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为此 bundle 只挂载人类面板及其 Remote：没有任何工具、提示词段落或 Session 事件改变模型的请求上下文。

#### KV Cache effect

无；启用或停用 bundle 不改变任何请求前缀。

-----

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 仅 owner 可用的面板 — 见[面板包](../client-ui-code-studio/README.zh.md#known-limitations-and-deferred-work)；其运行时、调试器与语言服务器限制在此原样适用。

<a id="dev-note"></a>
### 开发备注

bundle 刻意保持单行：其上的一切都是面板包自己的接缝，profile 补丁只需替换一个目标，这里不存放任何组合状态。
