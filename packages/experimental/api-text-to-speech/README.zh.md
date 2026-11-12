---
description: "面向浏览器客户端的实验性语音合成认证接口。"
kind: "package-api"
---

# @deepseek-ai/dsh-api-text-to-speech

[English](README.md) | 中文

为浏览器客户端提供语音合成能力的认证 Remote：目录与就绪状态跟随、准备控制，以及返回规范 base64 WAV 的 `synthesize(text)`。它在调用 provider 前校验文本限制，且从不激活 Agent。
