---
description: "具名实验性语音合成 Provider 及取消操作的所有权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech

[English](README.md) | 中文

## 概述

此服务定义通过 `ctx.textToSpeech` 选择具名语音合成器。消费者先把文本解析到一个 Provider 再执行，Provider 独立注册。合成把文本转换为 WAV 音频，从不激活或提交给 Agent。

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

通过[语音通话 Bundle](../voice-chat-bundle/README.zh.md)加载，或组合此服务、Provider 与消费者。`defaultProvider` 为必填项，选择确切的注册 id；Bundle 提供 `vits-melo-local`。`language` 提供省略的语言提示，默认为 `auto`。缺失或重复的 Provider 会明确报错。

提供方通过 `downloadSources` 公布准备阶段可用的源。`prepare(id, options)` 启动或加入 Provider 拥有的准备任务，`cancelPreparation(id)` 取消任务且不绑定浏览器连接。`configure(patch)` 通过 `settings` 服务持久化所选 Provider 和语言。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>维护者说明</summary>

`resolve()` 捕获 Provider 实例、文本和语言。`synthesize()` 拒绝已撤销或替换的注册。注册的清理函数先拒绝新请求，再取消已接收的请求并等待 Provider 完成；Provider 必须响应取消。服务不会回退到其他合成器或把文本发送到别处。

`defaultProvider` 与 `language` 是 volatile Config 字段：`configure()` 通过 `settings` 服务把传入的字段写入本插件的 profile 条目，运行中的实例无需重挂载即可读到更新值；保存覆盖值之前使用组合配置默认值。Settings 使用条目配置中的 id（`entry.options.id`）定位条目，不包含 Loader 的 Include 路径。没有 `settings` 或 profile 条目时 `configure()` 失败，并在保存前拒绝所选 Provider 不支持的语言。观察者通过完整 `SynthesisSnapshot` 接收 Provider 拥有的准备状态；关闭观察者不会取消准备。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

[语音通话子系统](../../../docs/subsystems/voice-chat.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为合成只消费调用方提供的文本，不添加模型请求或 Session 事件。

#### KV Cache 影响

没有直接影响；合成的音频不会进入模型请求。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 仅支持完整文本合成。服务没有流式合成或识别方法。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明</summary>

无。

</details>
