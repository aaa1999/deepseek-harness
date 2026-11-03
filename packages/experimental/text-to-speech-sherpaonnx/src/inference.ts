/** CPU vits-melo synthesis confined to the synthesis process. */
import { createRequire } from 'node:module'
import type { SynthesisOutput } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type { Config } from './config.ts'

/** Verified files and validated synthesis settings sent by the Host. */
export interface InferenceConfig extends Config {
  readonly model: string
  readonly lexicon: string
  readonly tokens: string
}

interface Synthesizer {
  readonly sampleRate: number
  generate(request: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number }
}

interface Sherpa {
  OfflineTts: new (config: object) => Synthesizer
}

/**
 * Encode mono floating-point samples as a canonical PCM16 WAV buffer.
 * @param samples - synthesized samples at the model's native rate.
 * @param sampleRate - sample rate in Hz.
 * @returns complete little-endian WAV bytes.
 */
export function encodeWave(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string): void => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (const [i, sample] of samples.entries()) {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}

/**
 * Load one native vits-melo model; every call synthesizes synchronously in this dedicated process.
 * @param config - verified ONNX paths and explicit CPU/synthesis limits.
 * @returns synchronous synthesis confined to its dedicated process.
 */
export function createSynthesizer(config: InferenceConfig): (text: string) => SynthesisOutput {
  // sherpa-onnx-node publishes a CommonJS Node-API binding with JSDoc but no declarations.
  const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa
  const synthesizer = new sherpa.OfflineTts({
    model: { vits: { model: config.model, lexicon: config.lexicon, tokens: config.tokens,
      noiseScale: config.noiseScale, noiseScaleW: config.noiseScaleW, lengthScale: config.lengthScale } },
    numThreads: config.threads,
    provider: 'cpu',
    debug: 0,
  })
  return (text) => {
    const started = performance.now()
    const generated = synthesizer.generate({ text, sid: 0, speed: config.speed })
    const samples = generated.samples
    if (samples.length === 0) throw new Error('Synthesizer produced no audio')
    const audioSeconds = samples.length / generated.sampleRate
    return { audio: encodeWave(samples, generated.sampleRate), audioSeconds,
      synthesisSeconds: (performance.now() - started) / 1000 }
  }
}
