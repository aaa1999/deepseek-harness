# Agent Note: 实时语音对话（说话来回）

Status: proposed

[English](2026-11-01-realtime-voice-chat.md) | 中文

## 问题

用户在使用 Web GUI 时提出「你能用来和我语音对话吗？」「我想要实时对话」，并明确选择「实时语音对话（像打电话/语音助手那样说话来回）」「路径 B：直接做真·实时语音对话」。现有语音输入子系统只解决「说话 → 文字」：点麦克风录音、停止后整段识别、把文字插入输入框草稿、用户手动发送；没有语音输出（朗读）、没有持续拾音、没有自动断句、没有打断，无法形成说话来回的对话闭环。

## 现状盘点

可复用的已有资产：

- `packages/experimental/speech-to-text`：`SpeechToText` 服务与 provider 注册表；`SpeechProvider.transcribe(整段 WAV) → Promise<Transcript>` 是一次性非流式接口。
- `packages/experimental/speech-to-text-sensevoice`：本地 SenseVoice 识别（sherpa-onnx `OfflineRecognizer` + Silero `Vad` 内部分段），托管子进程 worker（loopback HTTP + 随机 token 认证 + `{"port":N}` 握手），带完整下载/验证/准备机制（`runtime.ts` 的 Asset name/url/sha256/bytes、多源探测、原子发布、进度上报）。
- `packages/experimental/api-speech-to-text`：认证 Remote，浏览器把 base64 PCM16 WAV 一次性上传。
- `packages/experimental/client-ui-voice-input`：`MediaRecorder` 整段录音 + 波形 UI，`inputActions.insertText()` 插入草稿，不自动提交。
- `packages/experimental/voice-input-bundle`：可选一键 bundle，默认禁用。
- `InputActions`（`packages/client/ui-conversation`）提供 `insertText()` 与 `submit()`，语音文本可自动提交。
- `session-controller` 的 `@Remote('cancel')`（`session.cancel({ sessionId })`，客户端 `session.cancel()`）可取消当前活动的 Agent turn —— 打断的宿主端接口。
- typert 协议：`@Remote({ mode: 'stream' })` 支持宿主→客户端流式；`wireStream.open(name, args, clientStream, peer, signal)` 支持客户端→宿主流（阶段 2 的音频上行通道）。
- `sherpa-onnx-node@1.13.8`（已安装）：`OfflineTts.generate()` / `generateAsync({ onProgress })`（离线 TTS，onProgress 提供流式音频块回调）、`Vad`（Silero）、`OnlineRecognizer`（流式 ASR，阶段 2 用）。

缺失的部分：

- 语音输出（TTS）完全不存在：无服务、无 provider、无 Remote、无播放。
- 持续拾音与自动断句：现有录音是一次性 `MediaRecorder` 段落，无 VAD 驱动的连续采集。
- 说话来回的交互循环：识别结果不自动提交，回复不朗读，无打断语义。

## 提案

分两阶段实现，阶段 1 打通闭环（体验已接近实时：说完一句，识别后自动提交，回复自动朗读，随时插话打断），阶段 2 升级为字级流式。

### 阶段 1：闭环（默认目标）

1. **持续拾音 + 能量 VAD 断句（浏览器端）**：`getUserMedia` + `AudioContext` 持续采集 16 kHz 单声道 PCM，用 RMS 能量 + 静音持续时长阈值判断语音开始/结束（复用现有 `Recording.amplitude()` 思路）。段结束后把该段（含前后 padding）一次性发送识别。不做客户端→宿主流式上行。
2. **识别复用现有 SenseVoice**：每个语音段调用现有 `speech.transcribe` Remote（base64 一次性）。识别延迟对 1–5 秒短段通常 <1 秒；SenseVoice 内部 Silero 会再次精确切分，浏览器端能量 VAD 只需「大概找到说话段」。
3. **自动提交**：识别文本 `inputActions.insertText()` 后立即 `inputActions.submit()`。识别本身仍不写 Session 音频事件，只有提交的普通文本进入模型。
4. **新建 TTS 子系统（镜像 STT 架构）**：
   - `text-to-speech`：`TextToSpeech` 服务 + `SpeechSynthesizer` provider 注册表，`synthesize(text, options, signal) → WAV bytes`。
   - `text-to-speech-sherpaonnx`：本地 sherpa-onnx `OfflineTts` provider，默认模型 `vits-melo-tts-zh_en`（中英双语，GitHub Releases 已验证可达，压缩包 167 MB），复用 SenseVoice 的 worker 子进程模式与下载/准备机制（下载源、校验、进度）。
   - `api-text-to-speech`：认证 Remote，`synthesize` 返回 base64 WAV。
   - 浏览器播放：`AudioContext.decodeAudioData` 播放返回的 WAV；播放器持有 AbortController，可立即停止。
5. **打断（barge-in）**：VAD 检测到用户开始说话时：停止正在播放的音频；取消未完成的 TTS 请求；若 Agent turn 仍活跃则调用 `session.cancel()` 取消生成，让用户的新输入能立即提交。
6. **通话状态机（客户端）**：`idle → listening → transcribing → thinking → speaking → idle`；打断把任意状态拉回 `listening`。状态仅驱动 UI 与播放，不进入 Session。
7. **通话模式 UI**：输入框旁新增「通话」按钮（复用 `conversation.input.activity` slot），开启后持续拾音、显示状态（听/想/说）+ 波形，可随时关闭。挂载、取消、页面隐藏、Session 切换都释放麦克风。

### 阶段 2：字级流式（后续）

1. **流式 ASR**：宿主用 sherpa-onnx `OnlineRecognizer` + 流式 Zipformer 中文模型（新增模型下载资产），partial results 经 `@Remote({ mode: 'stream' })` 推给客户端。
2. **流式上行音频**：用 typert `wireStream` 建立客户端→宿主音频流，替换逐段 base64。
3. **流式 TTS**：`OfflineTts.generateAsync` 的 `onProgress` 音频块逐块传输、逐块播放，首字延迟更低。

## 关键设计决策

- **VAD 位置**：阶段 1 放浏览器端（能量 VAD，零新依赖、无需流式上行），SenseVoice 内部 Silero 精确切分兜底；阶段 2 随流式 ASR 迁到宿主端 Silero。
- **TTS 默认模型**：`vits-melo-tts-zh_en`（167 MB，中英混合，与 STT 的 zh/en 语言偏好对齐）。`kokoro-multi-lang-v1_0`（350 MB，音质更好）列为可配置替代；模型经配置可换（provider 模式）。
- **TTS 架构镜像 STT**：服务定义、本地 provider、Remote、bundle 分层与 STT 一致；下载/准备/进度机制直接复用同一模式，UI 复用 `plugins.bundle.config` / `plugins.bundle.activation` slot。
- **打断语义**：打断 = 停播 + 取消 TTS + 取消活跃 turn（默认）。不写 Session 事件，取消后用户语音识别完自动提交新消息。
- **进程隔离**：TTS 与 STT 各自独立 worker 子进程（沿用 loopback HTTP + token 模式），互不阻塞；idle 超时回收。
- **捆绑**：新建 `voice-chat-bundle`，语音输入 bundle 保持独立；两者共用模型缓存目录约定（`dataRoot/models`）。

## 包结构（新增，均在 `packages/experimental/`）

- `text-to-speech` — 服务定义与类型
- `text-to-speech-sherpaonnx` — 本地 sherpa-onnx TTS provider、worker、下载准备
- `api-text-to-speech` — 认证 Remote
- `client-ui-voice-chat` — 持续拾音、能量 VAD、播放器、通话状态机与 UI
- `voice-chat-bundle` — 组合 bundle（可选、默认禁用）

## 计划

1. `text-to-speech` 服务 + `text-to-speech-sherpaonnx` provider（worker 子进程、vits-melo 资产下载/校验/准备）+ `api-text-to-speech` Remote + 单测。
2. 浏览器持续拾音 + 能量 VAD 断句 + WAV 播放器。
3. 通话状态机：自动提交、打断（停播 + 取消 TTS + `session.cancel`）。
4. 通话 UI + `voice-chat-bundle` + 插件设置/准备引导。
5. e2e 测试（复用 voice-input 的脚手架模式，伪造麦克风流）与文档（subsystems + i18n）。
6. 阶段 2：流式 ASR / 流式上行 / 流式 TTS。

## 验收标准

- 开启通话模式后持续说话，VAD 自动断句，识别文本自动提交，无需点击发送。
- Agent 回复自动朗读；朗读中用户开口即被打断，且活跃 turn 被取消。
- 语音通话不产生 Session 音频事件；只有提交的识别文本进入模型。
- 模型未准备时引导下载并显示进度；取消、退出通话、切换 Session、页面隐藏都释放麦克风。
- 单测与 e2e 通过；语音输入既有行为不回归。

## 风险与未决

- 浏览器能量 VAD 对背景噪声敏感：采用自适应噪声门限，并依赖 SenseVoice 内部 Silero 兜底；极端噪声环境体验差，属阶段 2 宿主端 Silero 解决。
- TTS 模型 167 MB 首次下载耗时；sha256 与字节数需在实现时下载一次后固化进 `runtime/assets.json`。
- 自动提交与现有提交锁/审批流程的交互需要 e2e 验证（turn 活跃时提交排队或拒绝的语义）。
- Electron 桌面端麦克风权限已限定主窗口 audio；TTS 播放无需额外权限。
- 打断时取消活跃 turn 是产品语义选择（也可只停朗读不取消生成），先按默认「取消」实现并提供配置开关。
