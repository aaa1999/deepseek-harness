/** Controlled browser audio devices for the continuous voice-chat capture. */
import { vi } from 'vitest'

/**
 * Install per-test audio devices; callers restore globals.
 * @returns device observations for the continuous capture path.
 */
export function voiceCaptureFixture() {
  const trackStop = vi.fn(), close = vi.fn(async () => {})
  const decoding = vi.fn(async (_data: ArrayBuffer) => ({ getChannelData: () => new Float32Array(512).fill(0.4) }))
  const rendering = vi.fn(async () => ({ getChannelData: () => new Float32Array(16000).fill(0.4) }))
  let dataHandler: ((event: { data: Blob }) => void) | undefined
  class Recorder {
    state = 'inactive'
    ondataavailable?: (event: { data: Blob }) => void
    onerror?: () => void
    constructor() { dataHandler = (event) => { this.ondataavailable?.(event) } }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
  }
  const track = new EventTarget()
  const audioTrack = Object.assign(track, { stop: trackStop, label: 'Fixture microphone',
    getSettings: (): MediaTrackSettings => ({ groupId: 'fixture-input' }) })
  const stream = { getTracks: () => [audioTrack], getAudioTracks: () => [audioTrack] }
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('AudioContext', function Audio() { return { state: 'running', close, decodeAudioData: decoding,
    createMediaStreamSource: () => ({ connect: vi.fn() }),
    createAnalyser: () => ({ fftSize: 256, getFloatTimeDomainData: (buffer: Float32Array) => { buffer.fill(0.25) } }),
    sampleRate: 48000,
  } })
  vi.stubGlobal('OfflineAudioContext', function Offline(_channels: number, _frames: number, _rate: number) {
    return { destination: {}, createBuffer: () => ({ copyToChannel: vi.fn() }),
      createBufferSource: () => ({ buffer: null, connect() {}, start() {} }), startRendering: rendering }
  })
  return { getUserMedia, stream, trackStop, close, decoding, rendering,
    chunk: (): void => { dataHandler?.({ data: new Blob(['audio']) }) } }
}
