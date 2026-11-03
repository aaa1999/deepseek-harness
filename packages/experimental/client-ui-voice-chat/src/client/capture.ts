/** Browser-owned continuous microphone capture with energy endpointing. */
import { encodeWave } from './wave.ts'

/** Capture failure whose message is localized by the caller. */
export class RecordingError extends Error {
  constructor(readonly kind: 'unavailable' | 'permission' | 'empty' | 'cancelled' | 'interrupted' | 'deviceMissing') { super(kind); this.name = 'RecordingError' }
}

/** Fixed capture cadence: MediaRecorder emits one chunk per frame. */
export const CAPTURE_FRAME_MS = 250

/** Energy endpointing thresholds, in frames of {@link CAPTURE_FRAME_MS}. */
export const ENDPOINT = {
  /** Consecutive loud frames that start speech. */
  onsetFrames: 2,
  /** Consecutive quiet frames that end speech. */
  endFrames: 3,
  /** Quiet frames kept ahead of a segment to restore its onset. */
  preRollFrames: 3,
  /** Hard segment cap that forces a cut during long speech. */
  maxFrames: 120,
} as const

const SAMPLE_RATE = 16000
const MIN_SEGMENT_SECONDS = 0.4
const MAX_SEGMENT_SECONDS = 45

/**
 * One continuous capture session. MediaRecorder chunks are decoded at the device
 * rate, scored for energy, and assembled into speech segments; each completed
 * segment is resampled to 16 kHz PCM16 WAV and reported through the callback.
 */
export class ContinuousCapture {
  private stream: MediaStream | undefined
  private recorder: MediaRecorder | undefined
  private context: AudioContext | undefined
  private analyser: AnalyserNode | undefined
  private levelBuffer = new Float32Array(256)
  private readonly lifetime = new AbortController()
  private disposal: Promise<void> | undefined
  private segment: Float32Array[] = []
  private segmentFrames = 0
  private preRoll: Float32Array[] = []
  private speaking = false
  private lowFrames = 0
  private highFrames = 0
  private noiseFloor = 0.01
  private noiseSamples = 0
  private decodedRate = 0
  private decoding: Promise<void> = Promise.resolve()

  constructor(private readonly deviceId = '') {}

  /**
   * Acquire the selected microphone and begin continuous capture.
   * @param onSegment - receives each completed speech segment as WAV bytes.
   * @param onSpeechStart - fires when speech onset is detected, used for barge-in.
   * @param onError - receives device interruptions before resource release completes.
   * @returns after capture starts; a cancelled permission grant immediately releases its tracks.
   */
  async start(onSegment: (wav: Uint8Array, seconds: number) => void, onSpeechStart: () => void,
    onError: (error: RecordingError) => void): Promise<void> {
    if (typeof MediaRecorder === 'undefined') throw new RecordingError('unavailable')
    const devices = (navigator as Partial<Navigator>).mediaDevices
    if (!devices) throw new RecordingError('unavailable')
    let stream: MediaStream
    try {
      stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true,
        ...(this.deviceId === '' ? {} : { deviceId: { exact: this.deviceId } }) }, video: false })
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') throw new RecordingError('permission')
        if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') throw new RecordingError('deviceMissing')
      }
      throw error
    }
    if (this.lifetime.signal.aborted) { stream.getTracks().forEach((track) => { track.stop() }); throw new RecordingError('cancelled') }
    this.stream = stream
    try {
      this.context = new AudioContext()
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = this.levelBuffer.length
      this.context.createMediaStreamSource(stream).connect(this.analyser)
      for (const track of stream.getTracks()) track.addEventListener('ended', () => {
        this.interrupted(onError)
      }, { signal: this.lifetime.signal })
      this.recorder = new MediaRecorder(stream)
      this.recorder.ondataavailable = (event) => {
        if (this.lifetime.signal.aborted || event.data.size === 0) return
        this.accept(event.data, onSegment, onSpeechStart)
      }
      this.recorder.onerror = () => { this.interrupted(onError) }
      this.recorder.start(CAPTURE_FRAME_MS)
    } catch (error) { await this.dispose(); throw error }
  }

  /** Decode frames in arrival order; the device rate feeds endpointing and segment assembly. */
  private accept(blob: Blob, onSegment: (wav: Uint8Array, seconds: number) => void, onSpeechStart: () => void): void {
    const run = async (): Promise<void> => {
      if (this.lifetime.signal.aborted || !this.context) return
      const decoded = await this.context.decodeAudioData(await blob.arrayBuffer())
      if (this.aborted()) return
      this.decodedRate = decoded.sampleRate
      const samples = decoded.getChannelData(0)
      const rms = this.rmsOf(samples)
      const threshold = Math.max(0.015, this.noiseFloor * 3)
      if (!this.speaking) {
        if (rms < threshold) {
          this.noiseSamples++
          const weight = this.noiseSamples <= 8 ? 1 / Math.min(this.noiseSamples, 8) : 0.05
          this.noiseFloor = this.noiseFloor * (1 - weight) + rms * weight
        }
        this.preRoll.push(samples)
        if (this.preRoll.length > ENDPOINT.preRollFrames) this.preRoll.shift()
        if (rms >= threshold) {
          this.highFrames++
          if (this.highFrames >= ENDPOINT.onsetFrames) {
            this.speaking = true
            this.lowFrames = 0; this.highFrames = 0
            this.segment = [...this.preRoll]
            this.segmentFrames = this.segment.length
            this.preRoll = []
            try { onSpeechStart() } catch (_error) { /* callbacks must not break capture */ }
          }
        } else this.highFrames = 0
        return
      }
      this.segment.push(samples)
      this.segmentFrames++
      if (rms < threshold * 0.7) this.lowFrames++
      else this.lowFrames = 0
      if (this.lowFrames >= ENDPOINT.endFrames || this.segmentFrames >= ENDPOINT.maxFrames) {
        if (this.segmentFrames < ENDPOINT.maxFrames) this.speaking = false
        await this.finishSegment(onSegment)
        if (this.segmentFrames >= ENDPOINT.maxFrames) {
          // Hard cut: keep speaking and carry the tail into the next segment.
          this.speaking = this.lowFrames < ENDPOINT.endFrames
          this.lowFrames = 0
        }
      }
    }
    this.decoding = this.decoding.then(run, run)
  }

  /** Close the current segment: slide pre-roll from its tail, resample, and report it. */
  private async finishSegment(onSegment: (wav: Uint8Array, seconds: number) => void): Promise<void> {
    const segment = this.segment
    const frames = this.segmentFrames
    this.preRoll = segment.slice(Math.max(0, frames - ENDPOINT.preRollFrames))
    this.segment = []
    this.segmentFrames = 0
    this.lowFrames = 0
    const seconds = frames * CAPTURE_FRAME_MS / 1000
    if (seconds < MIN_SEGMENT_SECONDS || seconds > MAX_SEGMENT_SECONDS || !this.context) return
    const total = segment.reduce((sum, item) => sum + item.length, 0)
    const merged = new Float32Array(total)
    let offset = 0
    for (const chunk of segment) { merged.set(chunk, offset); offset += chunk.length }
    const offline = new OfflineAudioContext(1, Math.max(1600, Math.floor(seconds * SAMPLE_RATE)), SAMPLE_RATE)
    const source = offline.createBufferSource()
    const buffer = offline.createBuffer(1, merged.length, this.decodedRate || this.context.sampleRate)
    buffer.copyToChannel(merged, 0)
    source.buffer = buffer
    source.connect(offline.destination)
    source.start()
    const resampled = await offline.startRendering()
    if (this.lifetime.signal.aborted) return
    try { onSegment(encodeWave(resampled.getChannelData(0)), seconds) } catch (_error) { /* callbacks must not break capture */ }
  }

  private aborted(): boolean { return this.lifetime.signal.aborted }

  private rmsOf(samples: Float32Array): number {
    let sum = 0
    for (const sample of samples) sum += sample * sample
    return Math.sqrt(sum / samples.length)
  }

  private interrupted(onError: ((error: RecordingError) => void) | undefined): void {
    if (this.lifetime.signal.aborted) return
    void this.dispose().catch(() => undefined)
    try { onError?.(new RecordingError('interrupted')) } catch (error) {
      console.error('Voice chat recording error handler failed', error)
    }
  }

  /**
   * Read the live microphone signal.
   * @returns the measured RMS level, or zero outside capture.
   */
  amplitude(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.levelBuffer)
    let sum = 0
    for (const sample of this.levelBuffer) sum += sample * sample
    return Math.sqrt(sum / this.levelBuffer.length)
  }

  /**
   * Release this capture and invalidate pending permission grants.
   * @returns the shared release promise, including any AudioContext close failure.
   */
  dispose(): Promise<void> {
    if (!this.disposal) {
      const closing = Promise.withResolvers<void>()
      this.disposal = closing.promise
      void this.release().then(closing.resolve, closing.reject)
    }
    return this.disposal
  }

  private async release(): Promise<void> {
    this.lifetime.abort(new RecordingError('cancelled'))
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.stream?.getTracks().forEach((track) => { track.stop() })
    this.stream = undefined
    this.recorder = undefined
    const context = this.context
    this.context = undefined
    this.analyser = undefined
    this.segment = []; this.preRoll = []; this.segmentFrames = 0
    try { if (context && context.state !== 'closed') await context.close() } finally { await this.decoding.catch(() => undefined) }
  }
}
