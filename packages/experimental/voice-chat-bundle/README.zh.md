---
description: "从插件管理器启用实验性语音通话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-voice-chat-bundle

[English](README.md) | 中文

## 概述

这个可选 Bundle 组合了语音识别（SenseVoice）、语音合成（vits-melo）、认证 Remote 与语音通话浏览器界面。随附的配置默认不启用它。

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

在 Web 侧边栏的「插件」中启用「语音通话」。若模型需要准备，会弹出「前往安装」或「稍后」；打开 Bundle 详情页下载并准备两组模型。准备完成后，点击模型选择器与发送之间的麦克风通话按钮。通话持续聆听：每句话识别后自动插入并提交，回复自动朗读，开口说话即打断朗读与当前回合。输入框下方的状态行显示当前阶段；点击停止结束通话。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>维护者说明</summary>

静态 `cordis.patch.yml` 插入七行：选定 `sensevoice-local` 的语音识别服务、使用 `dshHomePath` 缓存目录的 SenseVoice Provider、识别 Remote、选定 `vits-melo-local` 的语音合成服务、使用 `dshHomePath` 缓存目录的 sherpa-onnx Provider、合成 Remote，以及语音通话浏览器界面。可选 Bundle 的安装只让包可被管理，不会在默认配置中选中。每一行的行为由对应包拥有；Bundle 本身不添加代码。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

[语音通话子系统](../../../docs/subsystems/voice-chat.zh.md)

[管理可选插件](../../client/ui-plugin-manager/README.zh.md#use-this-package)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过组合出的语音通话界面；转写出的语音会作为普通用户消息自动提交。

#### KV Cache 影响

没有直接影响；提交的转写文本沿用会话的普通消息历史。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 首次使用需要下载约 240 MB 的 SenseVoice 模型与约 170 MB 的 vits-melo 模型；准备过程中会显示磁盘与耗时说明。
- 浏览器端能量断句依赖较安静的环境；SenseVoice 内部的 Silero 会再次精确切分兜底。
- 不要与语音输入 Bundle 同时启用：两者插入相同的 speech-to-text 行（配置一致，组合仍然有效）。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明</summary>

无。

</details>
