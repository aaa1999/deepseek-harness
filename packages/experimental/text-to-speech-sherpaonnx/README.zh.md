---
description: "本地 vits-melo ONNX 语音合成 provider。"
kind: "package-provider"
---

# @deepseek-ai/dsh-experimental-text-to-speech-sherpaonnx

[English](README.md) | 中文

基于 sherpa-onnx `OfflineTts` 与 vits-melo 中英模型的本地语音合成 provider。它运行在受管子进程中（loopback HTTP + 进程内 token），首次使用下载并校验固定版本的 ONNX 资产，之后复用已加载模型直到配置的空闲期限。

provider 以 `vits-melo-local` 注册，接受 `auto`、`zh`、`en` 语言提示（模型自动区分中英文）。
