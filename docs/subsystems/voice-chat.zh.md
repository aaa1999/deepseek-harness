# 语音通话

[English](voice-chat.md) | 中文

实时语音对话把既有的[语音输入](voice-input.zh.md)识别链与一条新的语音合成链、以及一个浏览器端会话循环组合起来：用户持续说话，每句话识别后自动插入并提交，回复自动朗读，开口说话即打断朗读与当前回合。

## 合成链

[语音合成服务定义](../../packages/experimental/text-to-speech/README.zh.md)镜像语音识别注册表：命名的 `SpeechSynthesizer` provider 注册 `SynthesisProviderInfo`（显示名、处理位置、接受的语言提示、下载源），`resolve()` 与转写一样固定一个 provider 实例。`synthesize(text, signal)` 运行所选 provider 而不激活 Agent；缺失的 provider 与不支持的语言显式失败，不存在把文字发往别处的回退。

[vits-melo provider](../../packages/experimental/text-to-speech-sherpaonnx/README.zh.md) 在受管子进程中加载 sherpa-onnx `OfflineTts`，使用与 SenseVoice worker 相同的 loopback HTTP + 进程内 token 协议。worker 在模型加载完成后发布就绪，处理 JSON 请求（`{ text, language }`），应答 `{ audio: base64, audioSeconds, synthesisSeconds }`。准备过程以同一套 Asset 机制（name/url/sha256/bytes、多源探测、原子发布、进度上报）下载并校验固定版本的模型、词典与词表资产，并共享 `check → model → verify → load` 的步骤界面。

[合成 Remote](../../packages/experimental/api-text-to-speech/README.zh.md) 在自己的 `speechSynthesis` 命名空间下暴露 `catalog`、`follow`、`configure`、`prepare`、`cancelPreparation` 与 `synthesize`；它在调用 provider 前校验文本限制。合成调用从不激活或提交给 Agent。

## 会话循环

[语音通话界面](../../packages/experimental/client-ui-voice-chat/README.zh.md) 在 `conversation.input.right` 注册通话按钮、在 `conversation.composer.dock` 注册状态行（`conversation.input.activity` 单槽仍归语音输入所有）。一次通话运行一个 `VoiceChatSession` 状态机：`off → ready → listening → transcribing → thinking → speaking → ready`。

- **采集与断句（浏览器）**：`MediaRecorder` 以 250 ms 帧输入自适应能量检测器。高于噪声地板的响帧开始语音，安静帧结束语音；语音段保留前置缓冲并重采样为 16 kHz PCM16 WAV。完成的语音段走既有 `speech.transcribe` Remote。
- **自动提交**：识别文本用 `inputActions.insertText()` 插入、用 `inputActions.submit()` 提交。草稿变化时拒绝插入，通话继续聆听。识别不写任何 Session 音频事件。
- **朗读**：Session 的 `running` 标志落下后，把事件窗口中最新的、未被中断的 assistant 消息合成并通过 `AudioContext` 播放。每次会话维护读取游标，每条消息只读一次；回复按朗读预算截断。
- **打断**：语音开始即停止播放、中止未完成的合成请求；若 Agent 仍在生成，则调用会话作用域的 conversation `cancel()`，让下一条语音消息可以提交。

就绪状态用一个共享镜像同时观察两个方向：只有所选识别器与合成器都报告已准备（`ready`/`standby`/`waking`）时通话按钮才可用；否则按钮打开 bundle 设置。

## Bundle

[语音通话 bundle](../../packages/experimental/voice-chat-bundle/README.zh.md) 组合识别链、合成链与会话界面。与语音输入一样，它是可选的、默认禁用。

## 设计依据

[实时语音对话决策](../../.agents/notes/proposed/architecture/2026-11-01-realtime-voice-chat.zh.md) 说明了两阶段计划、浏览器端能量断句的选择与 vits-melo 模型的选型。
