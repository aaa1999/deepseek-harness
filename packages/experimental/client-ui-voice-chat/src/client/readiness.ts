/** One reconnecting Host readiness mirror for speech recognition and synthesis. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SynthesisCatalog } from '@deepseek-ai/dsh-api-text-to-speech/types'
import type {} from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import type {} from '@deepseek-ai/dsh-api-text-to-speech/remote'

/** Complete provider state for both directions, with a separate transport failure. */
export interface VoiceReadiness {
  readonly speech: SpeechCatalog | null
  readonly synthesis: SynthesisCatalog | null
  readonly connected: boolean
  readonly error: string | null
}

/** Resolved usability of one named provider side. */
export function providerUsable(catalog: {
  providers: readonly { id: unknown; preparation: { phase: string } }[]
  selection: { providerId: unknown }
} | null): boolean {
  if (catalog === null) return false
  const provider = catalog.providers.find(item => item.id === catalog.selection.providerId)
  if (provider === undefined) return false
  return provider.preparation.phase === 'ready' || provider.preparation.phase === 'standby' || provider.preparation.phase === 'waking'
}

/**
 * Subscribe once per Client plugin, independent of rendered pages and Sessions.
 * @param ctx - mounted speech Remote owner.
 * @returns shared readiness snapshot and joined observation cleanup.
 */
export function observeReadiness(ctx: Context): { state: SnapshotStore<VoiceReadiness>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<VoiceReadiness>({ speech: null, synthesis: null, connected: false, error: null })
  let disposed = false
  const isDisposed = (): boolean => disposed
  const fail = (error: unknown): void => {
    state.set({ ...state.getSnapshot(), connected: false, error: error instanceof Error ? error.message : String(error) })
  }
  const speechStream = ctx.remote.$stream<SpeechCatalog>({
    name: 'Speech recognition readiness', open: signal => ctx.remote.speech.follow(signal),
    ended: () => new RemoteStreamCarrierError('Speech readiness stream ended'), carrierFailed: fail,
  })
  const synthesisStream = ctx.remote.$stream<SynthesisCatalog>({
    name: 'Speech synthesis readiness', open: signal => ctx.remote.speechSynthesis.follow(signal),
    ended: () => new RemoteStreamCarrierError('Synthesis readiness stream ended'), carrierFailed: fail,
  })
  const observing = (async () => {
    try {
      for await (const item of speechStream) {
        state.set({ ...state.getSnapshot(), speech: item.value, connected: true, error: null })
        item.accept()
      }
    } catch (error) { if (!isDisposed()) fail(error) }
  })()
  const observingSynthesis = (async () => {
    try {
      for await (const item of synthesisStream) {
        state.set({ ...state.getSnapshot(), synthesis: item.value, connected: true, error: null })
        item.accept()
      }
    } catch (error) { if (!isDisposed()) fail(error) }
  })()
  return { state, dispose: async () => {
    disposed = true
    await Promise.all([speechStream.dispose(), synthesisStream.dispose()])
    await Promise.all([observing, observingSynthesis])
  } }
}
