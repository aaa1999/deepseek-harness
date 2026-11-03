/** Deployment configuration for the managed local vits-melo synthesizer. */
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Local runtime, synthesis, and retention settings. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Absolute directory for verified ONNX models. */
  dataRoot: string
  /** Existing directory containing the selected ONNX model, lexicon and tokens; omission downloads verified files. */
  modelDirectory?: string | undefined
  /** Explicit Hugging Face-compatible origin; bypasses automatic selection and public fallback. */
  modelOrigin?: string | undefined
  /** Hugging Face-compatible origins compared before downloading each missing asset. */
  modelOrigins: string[]
  /** Deadline for concurrent HEAD probes, including redirects to the actual asset. */
  modelProbeTimeoutMs: number
  /** Explicit archive mirror URLs tried before the pinned release URL; useful where GitHub Releases is slow. */
  archiveUrls: string[]
  /** CPU intra-operation thread count. */
  threads: number
  /** Playback speed multiplier applied to synthesized audio. */
  speed: number
  /** VITS noise scale; higher adds prosody variance. */
  noiseScale: number
  /** VITS noise scale weight for duration prediction. */
  noiseScaleW: number
  /** VITS phoneme length scale; higher stretches pronunciation. */
  lengthScale: number
  /** Maximum accepted UTF-8 text bytes per synthesis request. */
  maxTextBytes: number
  /** Maximum synthesized WAV bytes returned by the private worker. */
  maxAudioBytes: number
  /** Deadline for runtime preparation and cold model loading. */
  prepareTimeoutMs: number
  /** Deadline for one synthesis after the worker is ready. */
  synthesisTimeoutMs: number
  /** Idle period before stopping the worker; zero keeps it warm. */
  idleTimeoutMs: number
  /** Maximum accepted running and waiting syntheses. */
  maxPending: number
  /** Managed process termination grace period. */
  graceMs: number
  /** Maximum retained worker diagnostic bytes. */
  maxLogBytes: number
  /** Maximum synthesis response bytes, including base64 audio. */
  maxResponseBytes: number
  /** Minimum interval between intermediate download progress notifications. */
  progressIntervalMs: number
}

/** Validate deployment-varying runtime choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('vits-melo-local'),
  dataRoot: z.string().min(1).required(),
  modelDirectory: z.union([z.string().min(1), z.const(undefined)]),
  modelOrigin: z.union([z.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/), z.const(undefined)]),
  modelOrigins: z.array(z.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/)).min(1)
    .default(['https://huggingface.co', 'https://hf-mirror.com']),
  modelProbeTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3000),
  archiveUrls: z.array(z.string().pattern(/^https?:\/\/\S+$/)).default([]),
  threads: z.natural().min(1).default(2),
  speed: z.number().min(0.1).max(5).default(1),
  noiseScale: z.number().min(0).max(2).default(0.667),
  noiseScaleW: z.number().min(0).max(2).default(0.8),
  lengthScale: z.number().min(0.1).max(3).default(1),
  maxTextBytes: z.natural().min(1).default(8192),
  maxAudioBytes: z.natural().min(44).default(16 * 1024 * 1024),
  prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
  synthesisTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(300_000),
  maxPending: z.natural().min(1).default(4),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  maxResponseBytes: z.natural().min(1).default(24 * 1024 * 1024),
  progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(100),
})
