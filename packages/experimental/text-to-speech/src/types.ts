/** Provider-neutral speech synthesis inputs and registration metadata. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Configured identity of one synthesis provider. */
export type SynthesisProviderId = Branded<'SynthesisProviderId'>

/** Provider-specific planning estimates, not measured progress or guaranteed resource limits. */
export interface SynthesisSetupEstimate {
  readonly recommendedDiskBytes: number
  readonly expectedMemoryBytes: number
  readonly minimumMinutes: number
  readonly maximumMinutes: number
}

/** Public provider facts; credentials and filesystem paths are excluded. */
export interface SynthesisProviderInfo {
  readonly id: SynthesisProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  /** Accepted language hints, including automatic detection when supported. */
  readonly languages: readonly string[]
  readonly setupEstimate?: SynthesisSetupEstimate
  /** Origins offered for an explicit preparation download; omitted or empty when no choice applies. */
  readonly downloadSources?: readonly string[]
}

/** Ordered resource-preparation operations understood by the synthesis UI. Providers omit operations they do not need. */
export type SynthesisPreparationStepKind = 'check' | 'model' | 'verify' | 'load'

/** One Host-owned operation; only its running state has a live elapsed clock. */
export interface SynthesisPreparationStep {
  readonly kind: SynthesisPreparationStepKind
  readonly status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'
  readonly startedAt?: number
}

/** Safe download diagnostics for localized preparation guidance; URLs omit credentials and query strings. */
export interface SynthesisDownloadFailure {
  readonly resource: string
  readonly source: string
  readonly reason: 'network' | 'dns' | 'timeout' | 'certificate' | 'http' | 'integrity' | 'storage' | 'unknown'
  readonly code?: string
  readonly status?: number
}

/** Host-owned preparation state; byte totals describe downloads, never estimated installation percentages. */
export type SynthesisPreparationState = (
  | { readonly phase: 'unprepared' | 'ready' | 'standby' | 'cancelled' }
  | { readonly phase: 'downloading'; readonly resource: string; readonly completedBytes: number; readonly totalBytes?: number }
  | { readonly phase: 'checking' | 'loading' | 'waking' | 'cancelling'; readonly startedAt: number }
  | { readonly phase: 'failed'; readonly message: string; readonly download?: SynthesisDownloadFailure }
) & {
  readonly step?: SynthesisPreparationStepKind
  readonly steps?: readonly SynthesisPreparationStep[]
}

/** Provider facts and its current resource readiness; independent of plugin activation. */
export interface SynthesisProviderView extends SynthesisProviderInfo {
  readonly preparation: SynthesisPreparationState
}

/** Host-persisted default selection captured when a synthesis starts. */
export interface SynthesisSelection {
  readonly providerId: SynthesisProviderId
  readonly language: string
}

/** User intent updates only the preference fields explicitly changed. */
export interface SynthesisSelectionPatch {
  readonly providerId?: SynthesisProviderId
  readonly language?: string
}

/** One consistent provider roster and default-selection observation. */
export interface SynthesisSnapshot {
  readonly providers: readonly SynthesisProviderView[]
  readonly selection: SynthesisSelection
}

/** Download choice for one preparation task; omission keeps the provider's configured selection policy. */
export interface SynthesisPreparationOptions {
  /** One advertised origin; providers reject unavailable sources and use a manual choice without fallback. */
  readonly downloadSource?: string
}

/** Optional resource preparation controls. Providers without them are immediately usable. */
export interface SynthesisPreparation {
  /** @returns the latest Host-owned state. */
  snapshot(): SynthesisPreparationState
  /** @param listener - state invalidation callback. @returns subscription disposer. */
  subscribe(listener: () => void): () => void
  /**
   * Start or join the current preparation task; page and transport lifetimes do not own it.
   * @param options - task-local download selection; providers reject changing the source of active work.
   */
  prepare(options?: SynthesisPreparationOptions): void
  /** Cancel preparation. @returns after its resources settle. */
  cancel(): Promise<void>
}

/** Complete text to speak and an explicit language hint. */
export interface SynthesisInput {
  readonly text: string
  readonly language: string
}

/** Final synthesized audio; an empty buffer means nothing was produced. */
export interface SynthesisOutput {
  /** Canonical little-endian PCM16 WAV bytes. */
  readonly audio: Uint8Array
  readonly audioSeconds: number
  readonly synthesisSeconds: number
}

/** One replaceable synthesizer. It owns preparation, execution, and cancellation. */
export interface SpeechSynthesizer {
  readonly info: SynthesisProviderInfo
  readonly preparation?: SynthesisPreparation
  /**
   * Synthesize one text into WAV audio without submitting an Agent message.
   * @param input - text and language hint, borrowed until settlement.
   * @param signal - caller or registration cancellation; rejection follows resource cleanup.
   * @returns final audio and measured durations.
   */
  synthesize(input: SynthesisInput, signal: AbortSignal): Promise<SynthesisOutput>
}

/** Caller selection before composition defaults are resolved. */
export interface SynthesisRequest {
  readonly text: string
  readonly providerId?: SynthesisProviderId
  readonly language?: string
}

/** Resolved selection pins the exact registered provider, including its lifetime. */
export interface SynthesisSpec extends SynthesisInput {
  readonly provider: SpeechSynthesizer
}
