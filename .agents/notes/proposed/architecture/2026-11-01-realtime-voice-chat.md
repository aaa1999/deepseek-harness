# Agent Note: Realtime voice chat (spoken turns)

Status: proposed

English | [中文](2026-11-01-realtime-voice-chat.zh.md)

## Problem

While using the Web GUI, the user asked "Can you talk with me by voice?" and "I want realtime conversation", then chose "Realtime voice conversation (talking back and forth like a phone call or voice assistant)" and "Path B: build true realtime voice conversation directly". The existing voice input subsystem only covers speech → text: click the microphone, record, recognize the whole recording on Stop, insert the text into the composer draft, and let the user submit manually. There is no voice output (reading replies aloud), no continuous capture, no automatic endpointing, and no interruption, so a spoken back-and-forth conversation loop is impossible.

## Current state

Reusable existing assets:

- `packages/experimental/speech-to-text`: the `SpeechToText` service and provider registry; `SpeechProvider.transcribe(complete WAV) → Promise<Transcript>` is a one-shot, non-streaming interface.
- `packages/experimental/speech-to-text-sensevoice`: local SenseVoice recognition (sherpa-onnx `OfflineRecognizer` plus Silero `Vad` internal segmentation) in a managed child-process worker (loopback HTTP + random token auth + `{"port":N}` handshake), with a complete download/verify/prepare mechanism (`runtime.ts` Asset name/url/sha256/bytes, multi-origin probing, atomic publication, progress reporting).
- `packages/experimental/api-speech-to-text`: authenticated Remote; the browser uploads base64 PCM16 WAV in one request.
- `packages/experimental/client-ui-voice-input`: one-shot `MediaRecorder` capture plus waveform UI; `inputActions.insertText()` inserts into the draft without submitting.
- `packages/experimental/voice-input-bundle`: optional one-click bundle, disabled by default.
- `InputActions` (`packages/client/ui-conversation`) provides `insertText()` and `submit()`, so spoken text can be submitted automatically.
- `session-controller` `@Remote('cancel')` (`session.cancel({ sessionId })`, client `session.cancel()`) cancels the active Agent turn — the host-side hook for interruption.
- typert protocol: `@Remote({ mode: 'stream' })` supports host → client streaming; `wireStream.open(name, args, clientStream, peer, signal)` supports client → host streams (the audio uplink for phase 2).
- `sherpa-onnx-node@1.13.8` (already installed): `OfflineTts.generate()` / `generateAsync({ onProgress })` (offline TTS whose onProgress delivers streaming audio chunks), `Vad` (Silero), `OnlineRecognizer` (streaming ASR, for phase 2).

Missing pieces:

- Voice output (TTS) does not exist at all: no service, no provider, no Remote, no playback.
- Continuous capture and automatic endpointing: current capture is a one-shot `MediaRecorder` segment with no VAD-driven continuous acquisition.
- The spoken conversation loop: recognition results are not auto-submitted, replies are never read aloud, and there is no interruption semantics.

## Proposal

Two phases. Phase 1 closes the loop (already near-realtime in feel: finish a sentence, it is recognized and auto-submitted, the reply is read aloud, and the user can interrupt at any time); phase 2 upgrades to word-level streaming.

### Phase 1: closed loop (default goal)

1. **Continuous capture + energy VAD endpointing (browser)**: `getUserMedia` + `AudioContext` continuously capture 16 kHz mono PCM; RMS energy plus silence-duration thresholds decide speech start/end (reusing the idea of the existing `Recording.amplitude()`). Once a segment ends, that segment (with padding before and after) is sent for recognition in one request. No client → host streaming uplink yet.
2. **Recognition reuses SenseVoice**: each spoken segment calls the existing `speech.transcribe` Remote (one-shot base64). Recognition latency for 1–5 s segments is usually < 1 s; SenseVoice's internal Silero segments again precisely, so the browser energy VAD only needs to find the speaking region approximately.
3. **Auto-submit**: recognized text goes through `inputActions.insertText()` and then `inputActions.submit()` immediately. Recognition still writes no Session audio event; only the submitted plain text reaches the model.
4. **New TTS subsystem (mirroring the STT architecture)**:
   - `text-to-speech`: a `TextToSpeech` service and `SpeechSynthesizer` provider registry, `synthesize(text, options, signal) → WAV bytes`.
   - `text-to-speech-sherpaonnx`: a local sherpa-onnx `OfflineTts` provider whose default model is `vits-melo-tts-zh_en` (Chinese-English bilingual; GitHub Releases verified reachable, 167 MB archive), reusing the SenseVoice worker subprocess pattern and download/prepare mechanism (sources, verification, progress).
   - `api-text-to-speech`: authenticated Remote; `synthesize` returns base64 WAV.
   - Browser playback: `AudioContext.decodeAudioData` plays the returned WAV; the player owns an AbortController and stops immediately.
5. **Interruption (barge-in)**: when the VAD detects the user starting to speak: stop the playing audio; cancel the outstanding TTS request; if an Agent turn is still active, call `session.cancel()` so the user's new input can be submitted immediately.
6. **Conversation state machine (client)**: `idle → listening → transcribing → thinking → speaking → idle`; interruption pulls any state back to `listening`. State only drives UI and playback; nothing enters the Session.
7. **Voice-chat UI**: a new "call" button beside the composer (reusing the `conversation.input.activity` slot); while active it captures continuously, shows state (listening / thinking / speaking) plus waveform, and can be turned off at any time. Mount teardown, cancellation, page hide, and Session switch all release the microphone.

### Phase 2: word-level streaming (later)

1. **Streaming ASR**: the host uses sherpa-onnx `OnlineRecognizer` plus a streaming Zipformer Chinese model (new download assets); partial results are pushed to the client over `@Remote({ mode: 'stream' })`.
2. **Streaming uplink**: use typert `wireStream` for a client → host audio stream, replacing per-segment base64.
3. **Streaming TTS**: `OfflineTts.generateAsync` `onProgress` audio chunks are transferred and played incrementally for lower first-byte latency.

## Key design decisions

- **VAD location**: phase 1 keeps it in the browser (energy VAD, zero new dependencies, no streaming uplink), with SenseVoice's internal Silero as the precise fallback; phase 2 moves to host-side Silero together with streaming ASR.
- **Default TTS model**: `vits-melo-tts-zh_en` (167 MB, Chinese-English, aligned with the STT zh/en language preferences). `kokoro-multi-lang-v1_0` (350 MB, better quality) is a configurable alternative; models are replaceable through the provider pattern.
- **TTS mirrors the STT architecture**: service definition, local provider, Remote, and bundle layers match STT; the download/prepare/progress machinery is reused directly, and the UI reuses the `plugins.bundle.config` / `plugins.bundle.activation` slots.
- **Interruption semantics**: interruption = stop playback + cancel TTS + cancel the active turn (default). No Session event is written; after cancellation the user's recognized speech auto-submits the new message.
- **Process isolation**: TTS and STT each run in their own worker subprocess (same loopback HTTP + token pattern) so neither blocks the other; idle timeout reclaims them.
- **Bundling**: new `voice-chat-bundle`; the voice-input bundle stays independent; both share the model cache convention (`dataRoot/models`).

## Package layout (new, all under `packages/experimental/`)

- `text-to-speech` — service definition and types
- `text-to-speech-sherpaonnx` — local sherpa-onnx TTS provider, worker, download/prepare
- `api-text-to-speech` — authenticated Remote
- `client-ui-voice-chat` — continuous capture, energy VAD, player, conversation state machine and UI
- `voice-chat-bundle` — composition bundle (optional, disabled by default)

## Plan

1. `text-to-speech` service + `text-to-speech-sherpaonnx` provider (worker subprocess, vits-melo asset download/verify/prepare) + `api-text-to-speech` Remote + unit tests.
2. Browser continuous capture + energy VAD endpointing + WAV player.
3. Conversation state machine: auto-submit, interruption (stop playback + cancel TTS + `session.cancel`).
4. Voice-chat UI + `voice-chat-bundle` + plugin settings/preparation guidance.
5. e2e tests (reusing the voice-input scaffold pattern with a fake microphone stream) and docs (subsystems + i18n).
6. Phase 2: streaming ASR / streaming uplink / streaming TTS.

## Acceptance criteria

- With voice chat active the user keeps speaking, the VAD endpoints automatically, recognized text auto-submits, and no Send click is needed.
- Agent replies are read aloud automatically; if the user starts speaking during playback, playback stops and the active turn is cancelled.
- Voice chat writes no Session audio event; only the submitted recognized text reaches the model.
- Unprepared models trigger download guidance with progress; cancel, leaving voice chat, switching Sessions, and hiding the page all release the microphone.
- Unit and e2e tests pass; existing voice-input behavior does not regress.

## Risks and open questions

- Browser energy VAD is sensitive to background noise: use an adaptive noise floor and rely on SenseVoice's internal Silero as fallback; extreme noise is a phase 2 host-side Silero improvement.
- The 167 MB TTS model makes first use slow; its sha256 and byte count must be pinned into `runtime/assets.json` after one download during implementation.
- Auto-submit interaction with the existing submit lock and approval flow needs e2e verification (semantics of submitting while a turn is active).
- Electron desktop microphone permission is already restricted to primary-window audio; TTS playback needs no extra permission.
- Cancelling the active turn on interruption is a product choice (one could only stop reading and keep generating); implement the default as "cancel" and provide a config switch.
