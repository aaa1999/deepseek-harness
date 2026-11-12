---
description: "从插件管理器启用实验性语音通话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-voice-chat-bundle

[English](README.md) | 中文

## 简介

这个可选 bundle 组合了语音识别（SenseVoice）、语音合成（vits-melo）、认证 Remote 与语音通话浏览器界面。随附的配置默认不启用它。

## 使用方法

在 Web 侧边栏的「插件」中启用「语音通话」。若模型需要准备，会弹出「前往安装」或「稍后」；打开 bundle 详情页下载并准备两组模型。准备完成后，点击模型选择器与发送之间的麦克风通话按钮。通话持续聆听：每句话识别后自动插入并提交，回复自动朗读，开口说话即打断朗读与当前回合。输入框下方的状态行显示当前阶段；点击停止结束通话。

## 已知限制

- 首次使用需要下载约 240 MB 的 SenseVoice 模型与约 170 MB 的 vits-melo 模型；准备过程中会显示磁盘与耗时说明。
- 浏览器端能量断句依赖较安静的环境；SenseVoice 内部的 Silero 会再次精确切分兜底。
- 不要与语音输入 bundle 同时启用：两者插入相同的 speech-to-text 行（配置一致，组合仍然有效）。
