# Voice chat

English | [中文](voice-chat.zh.md)

Realtime voice conversation composes the existing [voice input](voice-input.md) recognition chain with a new speech synthesis chain and a browser conversation loop. The user speaks continuously; each sentence is transcribed, inserted and submitted automatically; replies are read aloud; speech onset interrupts playback and the active turn.

## Synthesis chain

The [Text-to-Speech Service Definition](../../packages/experimental/text-to-speech/README.md) mirrors the speech-to-text registry: named `SpeechSynthesizer` providers register `SynthesisProviderInfo` (display name, processing location, accepted language hints, download origins), and `resolve()` pins one provider instance exactly as transcription does. `synthesize(text, signal)` runs the selected provider without Agent activation; missing providers and unsupported languages fail explicitly, with no fallback that could send text elsewhere.

The [vits-melo provider](../../packages/experimental/text-to-speech-sherpaonnx/README.md) loads sherpa-onnx `OfflineTts` in a managed child process with the same loopback HTTP plus per-process token protocol as the SenseVoice worker. The worker publishes readiness after model loading and serves one JSON request (`{ text, language }`) answering `{ audio: base64, audioSeconds, synthesisSeconds }`. Preparation downloads and verifies the pinned model, lexicon and tokens assets with the same Asset mechanism (name/url/sha256/bytes, multi-origin probing, atomic publication, progress reporting) and shares the `check → model → verify → load` step UI.

The [synthesis Remote](../../packages/experimental/api-text-to-speech/README.md) exposes `catalog`, `follow`, `configure`, `prepare`, `cancelPreparation` and `synthesize` under its own `speechSynthesis` namespace; it validates text limits before calling the provider. Synthesis calls never activate or submit to an Agent.

## Conversation loop

The [voice-chat UI](../../packages/experimental/client-ui-voice-chat/README.md) registers a call toggle in `conversation.input.right` and a status row in `conversation.composer.dock` (the `conversation.input.activity` single slot stays owned by voice input). One call runs a `VoiceChatSession` state machine: `off → ready → listening → transcribing → thinking → speaking → ready`.

- **Capture and endpointing (browser)**: `MediaRecorder` chunks at 250 ms frames feed an adaptive energy detector. Loud frames above the noise floor start speech, quiet frames end it; segments keep pre-roll and are resampled to 16 kHz PCM16 WAV. The completed segment goes through the existing `speech.transcribe` Remote.
- **Auto-submit**: recognized text is inserted with `inputActions.insertText()` and submitted with `inputActions.submit()`. A changed draft declines insertion and the call keeps listening. Recognition writes no Session audio event.
- **Read-aloud**: when the Session `running` flag falls, the newest non-interrupted assistant message (from the Session event window) is synthesized and played through an `AudioContext`. A per-session read cursor reads each message once; replies are truncated to the read budget.
- **Barge-in**: speech onset stops playback, aborts the outstanding synthesis and, while the Agent is still running, calls the scoped conversation `cancel()` so the next spoken message can submit.

Readiness observes both directions with one shared mirror: the call control is usable only while the selected recognizer and synthesizer report prepared (`ready`/`standby`/`waking`); otherwise the control opens the bundle setup.

## Bundle

The [voice-chat bundle](../../packages/experimental/voice-chat-bundle/README.md) composes the recognition chain, the synthesis chain and the conversation UI. It is optional and default-disabled, like voice input.

## Design rationale

The [realtime voice chat decision](../../.agents/notes/proposed/architecture/2026-11-01-realtime-voice-chat.md) explains the two-phase plan, the browser-side energy endpointing choice and the vits-melo model selection.
