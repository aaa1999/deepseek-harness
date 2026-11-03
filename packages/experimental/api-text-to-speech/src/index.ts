/** Authenticated, cancellation-aware Client access to the speech synthesis capability. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { SynthesisPreparationOptions, SynthesisProviderId, SynthesisSelectionPatch } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type { SynthesisCatalog, SynthesisRequest, SynthesizedAudio } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental speech synthesis Remote controller. */
    speechSynthesisController: SpeechSynthesisController
  }
}

/** Limits applied before calling a provider. */
export interface Config {
  /** Maximum accepted UTF-8 text bytes per request. */
  maxTextBytes: number
  /** Maximum synthesized WAV bytes returned to the Client. */
  maxAudioBytes: number
}

/** Synthesis calls never activate or submit to an Agent. */
export default class SpeechSynthesisController extends TypertRemoteService {
  static inject = ['textToSpeech', 'typert']
  static Config: z<Config> = z.object({
    maxTextBytes: z.natural().min(1).default(8192),
    maxAudioBytes: z.natural().min(44).default(16 * 1024 * 1024),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'speechSynthesisController', { namespace: 'speechSynthesis' })
  }

  /**
   * Read provider choices without preparing a synthesizer.
   * @returns available providers, resolved default, and synthesis limits.
   */
  @Remote
  catalog(): SynthesisCatalog {
    return { ...this.ctx.textToSpeech.snapshot(), ...this.config }
  }

  /**
   * Follow provider readiness independently of Session and preparation lifetimes.
   * @param signal - Client observation lifetime.
   * @returns initial and subsequent complete readiness snapshots.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<SynthesisCatalog> {
    for await (const snapshot of this.ctx.textToSpeech.follow(signal)) yield { ...snapshot, ...this.config }
  }

  /**
   * Persist the user's synthesis preferences.
   * @param patch - changed preference fields.
   * @returns after preferences are saved.
   */
  @Remote
  configure(patch: SynthesisSelectionPatch): Promise<void> { return this.ctx.textToSpeech.configure(patch) }

  /**
   * Start or join one Host-owned preparation task.
   * @param providerId - selected synthesizer.
   * @param options - task-local source selection validated by the provider.
   */
  @Remote
  prepare(providerId: SynthesisProviderId, options?: SynthesisPreparationOptions): void {
    this.ctx.textToSpeech.prepare(providerId, options)
  }

  /**
   * Explicitly cancel resource preparation.
   * @param providerId - selected synthesizer.
   * @returns after the preparation task settles.
   */
  @Remote
  cancelPreparation(providerId: SynthesisProviderId): Promise<void> { return this.ctx.textToSpeech.cancelPreparation(providerId) }

  /**
   * Validate and synthesize one text through the explicit provider selection.
   * @param request - text, provider id and language hint.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns final audio without adding a Session event.
   */
  @Remote
  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesizedAudio> {
    signal.throwIfAborted()
    const text = request.text
    if (text.length === 0) {
      throw new RemoteError('speech/invalid-text', 'Text must not be empty', { reason: 'empty' })
    }
    if (Buffer.byteLength(text, 'utf8') > this.config.maxTextBytes) {
      throw new RemoteError('speech/invalid-text', 'Text exceeds the configured byte limit', { reason: 'size' })
    }
    try {
      const spec = this.ctx.textToSpeech.resolve({ text,
        ...request.providerId === undefined ? {} : { providerId: request.providerId },
        ...request.language === undefined ? {} : { language: request.language },
      })
      const result = await this.ctx.textToSpeech.synthesize(spec, signal)
      return { audioBase64: Buffer.from(result.audio).toString('base64'), audioSeconds: result.audioSeconds,
        synthesisSeconds: result.synthesisSeconds }
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('speech/synthesis-failed', reason, { reason })
    }
  }
}
