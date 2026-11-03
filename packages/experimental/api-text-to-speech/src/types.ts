/** JSON-safe inputs and results of the experimental speech synthesis Remote namespace. */
import type { SynthesisProviderId, SynthesisSnapshot } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Text validation or intake limits prevented synthesis. */
    'speech/invalid-text': { readonly reason: string }
    /** The selected provider rejected synthesis. */
    'speech/synthesis-failed': { readonly reason: string }
  }
}

/** Text submitted for synthesis, separate from Session admission. */
export interface SynthesisRequest {
  readonly text: string
  readonly providerId?: SynthesisProviderId
  readonly language?: string
}

/** Current provider choices and synthesis limits. */
export interface SynthesisCatalog extends SynthesisSnapshot {
  readonly maxTextBytes: number
  readonly maxAudioBytes: number
}

/** Final synthesized audio transferred as canonical base64. */
export interface SynthesizedAudio {
  readonly audioBase64: string
  readonly audioSeconds: number
  readonly synthesisSeconds: number
}
