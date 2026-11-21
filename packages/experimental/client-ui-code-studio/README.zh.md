---
description: "代码工作台 Host Remote：工作区文件、受限运行、CDP 调试与编辑器语言服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-code-studio

[English](README.md) | 中文

## 概述

实验性代码工作台的 Host 半部分：一个 `codeStudio` Remote，列出、读取并写入已注册工作区的文件；在沙箱受限的子进程中运行入口文件并流式输出；用 `node --inspect-brk` 启动并接入 CDP 断点、单步、调用栈与变量；并为每条打开的流维护一个 `typescript-language-server` 会话，提供补全、悬停与诊断。浏览器半部分在本包内注册面板。通过[代码工作台 bundle](../code-studio-bundle/README.zh.md) 启用；随产品发布的 profile 默认不启用。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

每个请求都以已注册工作区为根，路径为 `/` 分隔的相对路径且必须解析在其内。运行与调试子进程由沙箱的 `workspace-write` 策略（以该工作区为根）约束；语言服务器不受沙箱约束，与 `lsp-stdio` 组“部署方提供语言服务器”的规则一致。配置项覆盖 `runtimeCommand`（默认 `node`）、`languageServerCommand`（默认 `typescript-language-server --stdio`）、超时与输出上限，以及暂停报告的预算。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>Maintainer details — click to expand</summary>

流拥有自己的子进程：`run` 被中止即杀掉进程，`debugStart` 被中止即杀掉子进程并关闭 inspector WebSocket，`langStart` 被中止即终止语言服务器。命令通过调试流首帧 `started` 携带的 id 寻址。调试坐标为零基且无需 source map，因为 Node 的类型擦除保留行号；`--inspect-brk` 让子进程等待 `Runtime.runIfWaitingForDebugger`，因此会话先安装断点再释放子进程，第一次停下就是入口行。入口执行完会打印 Node 的等待断开提示，会话以断开 inspector 应答，让子进程自行退出。控制台输出只走进程 stdout/stderr；忽略 `Runtime.consoleAPICalled`，`console.log` 不会重复投递。JSON-RPC 客户端使用整文档同步（`Full`），一条 `langSync` 携带文件完整文本；捆绑的语言服务器经 `createRequire` 解析并在当前 Node 可执行文件上运行，无需 PATH 条目。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为面板与其 Remote 只服务于人类编辑器：不添加工具、提示词段落或 Session 事件，也不改变模型的请求上下文。

#### KV Cache effect

无；每条 Remote 流只服务于人类面板。

-----

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 仅 owner 可用 — 面板挂在单一 `codeStudio/list` 远程访问键下；尚无共享工作区运行的资源授权模型。
- 编辑器智能随服务器形状 — 补全、悬停与诊断覆盖 `typescript-language-server` 对工作区根的报告；未传入 `tsconfig` 覆盖，也未配置按文件排除。
- 仅擦除型语法 — `enum` 与命名空间声明会在运行时被 Node 类型擦除拒绝；编辑器只能在服务器诊断到达后报告它们。
- Windows 调试器路径 — `setBreakpointByUrl` 的 `file://` 匹配与路径相对化只在 macOS 与 Linux 上验证过。

<a id="dev-note"></a>
### 开发备注

一个值得留存的发现：Node 的 `--inspect-brk` 并不通过 `Debugger.paused` 事件停下——子进程等待 `Runtime.runIfWaitingForDebugger`，因此会话先安装断点再自行释放子进程，使第一次停在入口断点。
