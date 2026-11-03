---
description: "实验性语音合成服务。"
kind: "package-service"
---

# @deepseek-ai/dsh-experimental-text-to-speech

[English](README.md) | 中文

语音合成的服务定义：一个 provider 注册表，让一份 Host 组合可挂载多个可选择的合成器。`SpeechSynthesizer.synthesize(text, signal)` 把一段文字合成为规范的 PCM16 WAV 字节；准备、选择与取消机制与语音识别服务对称。合成从不激活或提交给 Agent。

组合行为见[语音通话子系统](../../../docs/subsystems/voice-chat.zh.md)。
