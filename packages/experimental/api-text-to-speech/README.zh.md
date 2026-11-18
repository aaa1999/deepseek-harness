---
description: "面向浏览器客户端的实验性语音合成认证接口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-text-to-speech

[English](README.md) | 中文

## 概述

此 Remote 通过 `ctx.speechSynthesisController` 向已认证的浏览器客户端提供语音合成能力。客户端可读取 Provider 目录、跟随就绪状态、保存偏好、控制准备任务，并在配置的限制内把文本合成为 base64 WAV。调用从不激活或提交给 Agent。

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

与语音合成服务定义和 Typert 组合使用。`maxTextBytes` 与 `maxAudioBytes` 限制接受的文本和返回的音频。启用后，浏览器界面挂载此包生成的 `/remote` 贡献。

空文本和超限文本以 `speech/invalid-text` 失败；Provider 失败以 `speech/synthesis-failed` 呈现。`prepare(providerId, { downloadSource })` 为 Provider 转发一个公布的下载源；省略时沿用其配置策略。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>维护者说明</summary>

`catalog()` 与 `follow()` 把服务快照与配置限制合并，一次订阅即可同时获得 Provider、选择和上限。`synthesize()` 先校验文本，再经服务解析执行，返回规范 base64 WAV 及音频与合成时长。Remote 信号或贡献卸载带来的取消会传播到 Provider。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

[语音通话子系统](../../../docs/subsystems/voice-chat.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为合成只传输调用方提供的文本，不添加模型请求或 Session 事件。

#### KV Cache 影响

没有直接影响；合成的音频不会进入模型请求。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 不提供流式协议或持久的合成历史。Base64 增加传输开销；文本和音频受配置限制约束。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明</summary>

无。

</details>
