---
description: "运行在受管进程中的本地 vits-melo 语音合成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech-sherpaonnx

[English](README.md) | 中文

## 概述

此 Provider 基于 sherpa-onnx `OfflineTts` 与 vits-melo 模型在本地合成中文和英文语音，以 `vits-melo-local` 注册。首次使用会下载并校验固定版本的模型；之后的合成复用已加载的 worker 进程，直到空闲退出。合成在 Host 机器上运行。

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

通过[语音通话 Bundle](../voice-chat-bundle/README.zh.md)加载，或与语音合成服务定义及 `subprocess` 服务组合。`dataRoot` 为必填的绝对目录，存放校验过的模型文件；Bundle 在 DSH home 下提供一个目录。`modelDirectory` 指向已存在的绝对目录（含模型、词典和 tokens）并跳过下载；其内容由部署方自行负责。

准备阶段下载固定版本的发布归档：先尝试配置的 `archiveUrls` 镜像，再使用固定的 GitHub Releases 地址，每个候选都必须匹配固定的大小和 SHA-256 哈希。归档用平台自带 `tar` 解压，模型文件以原子方式发布。已校验的缓存无需再次下载即可恢复就绪。语言提示为 `auto`、`zh`、`en`；模型自动区分中文和英文。`threads`、`speed`、`noiseScale`、`noiseScaleW` 和 `lengthScale` 调整 CPU 用量与发音。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>维护者说明</summary>

推理运行在受管子进程中，经 loopback HTTP 加进程内 token 访问；worker 先在 stdout 上发布端口，之后每次合成服务一个 JSON 请求。激活时只检查磁盘缓存，不下载也不加载模型。首次合成唤醒 worker；`idleTimeoutMs`（默认 5 分钟）到期后停止进程，`maxPending`（默认 4）限制队列长度，卸载时等待已接受的任务完成。`maxTextBytes`、`maxAudioBytes`、`prepareTimeoutMs`、`synthesisTimeoutMs` 和 `graceMs` 约束输入、输出和进程生命周期。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

[语音通话子系统](../../../docs/subsystems/voice-chat.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本地合成只把调用方提供的文本转换为音频，不添加模型请求或 Session 事件。

#### KV Cache 影响

没有直接影响；合成的音频不会进入模型请求。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 仅支持 CPU。原生包覆盖 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64；其他平台在激活时报错。首次准备下载 167 MB 归档，内含 170 MB 模型、6.8 MB 词典和 tokens；安装估算为 400 MB 磁盘与内存、1 到 10 分钟。禁用插件不会删除模型缓存。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者说明</summary>

无。

</details>
