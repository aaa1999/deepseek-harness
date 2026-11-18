---
description: "持续采集与朗读回复的实时语音通话界面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-chat

[English](README.md) | 中文

## 概述

此可选浏览器插件在输入框中添加通话按钮。通话期间麦克风保持开启：每个完整的语音段识别后自动提交，回复自动朗读，开口说话即打断朗读与当前回合。输入框下方的状态行显示当前阶段。

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

在「插件」中启用[语音通话 Bundle](../voice-chat-bundle/README.zh.md)。只有所选识别器与合成器都报告已就绪时通话按钮才可用；此前点击会打开 Bundle 安装引导。用该按钮开始通话，用「停止」结束。

每个语音段识别后插入草稿并作为普通消息提交。草稿已变化时拒绝插入，通话继续聆听。回合结束后，最新一条未被中断的助手消息会朗读一次，超过 500 字符的部分截断。再次开口会停止朗读并取消正在运行的回合，使下一句话可以提交。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>维护者说明</summary>

每次通话运行一个 `VoiceChatSession` 状态机，依次经过 `off → ready → listening → transcribing → thinking → speaking`。`MediaRecorder` 每 250 ms 输出一帧；自适应能量检测在跟踪的噪声底之上启停语音，保留前滚帧并将每段限制在 45 秒内；完成的语音段重采样为 16 kHz PCM16 WAV。插件自行挂载生成的语音识别与合成 Remote，不进入稳定 API Remote。一个可重连的就绪镜像同时服务两个方向，浏览器 `AudioContext` 播放拥有朗读音频。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

[语音通话子系统](../../../docs/subsystems/voice-chat.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过把每段转写文本经普通输入框提交；朗读的回复是已记录在日志中的助手文本。

#### KV Cache 影响

没有直接影响；转写文本沿用会话的普通消息历史。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 浏览器端能量断句依赖较安静的环境；每段语音上限 45 秒，每次合成朗读截断到 500 字符。没有唤醒词、流式字幕或提交前的转写编辑。
- 被中断的助手消息不会朗读；识别文本不经确认直接提交，可在会话记录中核对发送内容。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明</summary>

无。

</details>
