/** Optional local vits-melo provider; activation performs no downloads or model loading. */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-text-to-speech'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-text-to-speech/types'
import { Config } from './config.ts'
import { TtsWorker } from './synthesizer.ts'

export { Config } from './config.ts'
export const name = 'experimental-text-to-speech-sherpaonnx'
export const inject = ['textToSpeech', 'subprocess']

/** Language hints the vits-melo model accepts; it auto-detects between Chinese and English. */
const languages = ['auto', 'zh', 'en']

/**
 * Register the local synthesizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: Context, config: Config): void {
  for (const path of [config.dataRoot, config.modelDirectory]) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`Synthesis paths must be absolute: ${path}`)
  }
  for (const origin of config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]) new URL(origin)
  const worker = new TtsWorker(ctx, config)
  const estimatedBytes = 400_000_000
  ctx.effect(() => {
    const unregister = ctx.textToSpeech.register({
      info: { id: config.providerId as SynthesisProviderId, name: 'vits-melo (zh/en)', location: 'host-local', languages,
        downloadSources: worker.downloadSources,
        setupEstimate: { recommendedDiskBytes: estimatedBytes, expectedMemoryBytes: estimatedBytes,
          minimumMinutes: 1, maximumMinutes: 10 } },
      preparation: worker,
      synthesize: async (input, signal) => await worker.synthesize(input, signal),
    })
    worker.inspect()
    return async () => {
      const removing = unregister()
      await worker.dispose()
      await removing
    }
  })
}
