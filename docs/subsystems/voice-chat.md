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

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxspeechsynthesiscontroller--speechsynthesiscontroller"></a>

### `ctx.speechSynthesisController` — `SpeechSynthesisController`

Synthesis calls never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Read provider choices without preparing a synthesizer.
 * @returns available providers, resolved default, and synthesis limits.
 */
@Remote catalog(): SynthesisCatalog

/**
 * Follow provider readiness independently of Session and preparation lifetimes.
 * @param signal - Client observation lifetime.
 * @returns initial and subsequent complete readiness snapshots.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<SynthesisCatalog>

/**
 * Persist the user's synthesis preferences.
 * @param patch - changed preference fields.
 * @returns after preferences are saved.
 */
@Remote configure(patch: SynthesisSelectionPatch): Promise<void>

/**
 * Start or join one Host-owned preparation task.
 * @param providerId - selected synthesizer.
 * @param options - task-local source selection validated by the provider.
 */
@Remote prepare(providerId: SynthesisProviderId, options?: SynthesisPreparationOptions): void

/**
 * Explicitly cancel resource preparation.
 * @param providerId - selected synthesizer.
 * @returns after the preparation task settles.
 */
@Remote cancelPreparation(providerId: SynthesisProviderId): Promise<void>

/**
 * Validate and synthesize one text through the explicit provider selection.
 * @param request - text, provider id and language hint.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns final audio without adding a Session event.
 */
@Remote async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesizedAudio>
```

Source: [`packages/experimental/api-text-to-speech/src/index.ts`](../../packages/experimental/api-text-to-speech/src/index.ts)

<a id="ctxtexttospeech--texttospeech"></a>

### `ctx.textToSpeech` — `TextToSpeech`

Registry shared by all synthesis consumers in one Host composition.

```ts cordis-catalog
/**
 * Register one synthesizer; duplicate ids fail without replacing the original.
 * @param provider - synthesizer owned by the contributing fiber.
 * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
 */
register(provider: SpeechSynthesizer): () => Promise<void>

/**
 * Read the current synthesizer roster.
 * @returns available provider facts in registration order.
 */
listProviders(): readonly SynthesisProviderInfo[]

/**
 * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
 * @param caller - observer lifetime, independent of any preparation task.
 * @returns an initial snapshot followed by the latest provider states.
 */
async *follow(caller: AbortSignal): AsyncIterable<SynthesisSnapshot>

/**
 * Read provider readiness and current user preferences together.
 * @returns one detached complete observation.
 */
snapshot(): SynthesisSnapshot

/**
 * Persist changed selection fields into this plugin's profile entry; the resulting language must be accepted by the selected provider.
 * @param patch - explicit provider or language changes.
 * @returns after the profile write and the live update it applies.
 */
async configure(patch: SynthesisSelectionPatch): Promise<void>

/**
 * Start or join provider-owned preparation.
 * @param id - exact registered provider identity.
 * @param options - task-local source selection validated by the provider.
 */
prepare(id: SynthesisProviderId, options?: SynthesisPreparationOptions): void

/**
 * Explicitly cancel provider preparation without tying it to a browser connection.
 * @param id - exact registered provider identity.
 * @returns after the preparation task settles.
 */
async cancelPreparation(id: SynthesisProviderId): Promise<void>

/**
 * Apply composition defaults and capture the selected provider. Missing providers and unsupported languages fail explicitly.
 * @param request - text and optional selection.
 * @returns provider-pinned input for synthesize().
 */
resolve(request: SynthesisRequest): SynthesisSpec

/**
 * Execute exactly the resolved provider; no fallback sends text elsewhere.
 * @param spec - resolved input; a withdrawn or replaced registration is rejected.
 * @param signal - caller cancellation.
 * @returns final audio after provider settlement.
 */
async synthesize(spec: SynthesisSpec, signal: AbortSignal): Promise<SynthesisOutput>
```

Source: [`packages/experimental/text-to-speech/src/index.ts`](../../packages/experimental/text-to-speech/src/index.ts)
<!-- END GENERATED cordis-surface -->
