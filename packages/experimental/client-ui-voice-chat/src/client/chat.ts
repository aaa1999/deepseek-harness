/** Voice-chat conversation state machine: listen, transcribe, submit, read aloud, barge-in. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ContinuousCapture } from './capture.ts'

/** Display phase of one voice-chat session. */
export type VoiceChatPhase = 'off' | 'ready' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'failed'

/** Shared UI state; level drives the waveform, transcript and failure are feedback only. */
export interface VoiceChatState {
  readonly phase: VoiceChatPhase
  readonly level: number
  readonly lastTranscript: string
  readonly failure: string
}

/** Operations the controller needs from the mounted environment. */
export interface VoiceChatDeps {
  /** Speak at most this many characters per synthesis call. */
  readonly maxReadChars: number
  /** Transcribe one completed speech segment (16 kHz PCM16 WAV bytes). */
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string>
  /** Insert the transcript into the draft and submit the message. @returns whether submission was attempted. */
  submit(text: string): boolean
  /** Synthesize one reply into PCM16 WAV bytes. */
  synthesize(text: string, signal: AbortSignal): Promise<Uint8Array>
  /** Play synthesized audio; settles when playback completes or is stopped. */
  play(audio: Uint8Array): Promise<void>
  /** Stop current playback immediately. */
  stopPlayback(): void
  /** Cancel the active Agent turn so a new spoken message can be submitted. */
  cancelTurn(): void
  /** Optional capture factory; tests substitute a fake microphone. */
  createCapture?(): VoiceCapture
}

/** Minimal capture face the conversation loop needs; the real one is {@link ContinuousCapture}. */
export interface VoiceCapture {
  start(onSegment: (wav: Uint8Array, seconds: number) => void, onSpeechStart: () => void, onError: (error: Error) => void): Promise<void>
  amplitude(): number
  dispose(): Promise<void>
}

/**
 * One voice-chat conversation. A call runs until {@link end}: continuous capture
 * feeds speech segments, transcripts auto-submit, replies are read aloud, and
 * speech onset interrupts playback and the active turn.
 */
export class VoiceChatSession {
  readonly state: SnapshotStore<VoiceChatState>
  private readonly lifetime = new AbortController()
  private readonly deps: VoiceChatDeps
  private active = false
  private generation = 0
  private synthesis: AbortController | undefined
  private lastRunning = false
  private readSeq = -1
  private latest: { seq: number; text: string } | undefined
  private capture: VoiceCapture | undefined
  private captureDisposed = Promise.resolve()

  constructor(deps: VoiceChatDeps, state: SnapshotStore<VoiceChatState> = createSnapshotStore<VoiceChatState>({ phase: 'off', level: 0, lastTranscript: '', failure: '' })) {
    this.deps = deps
    this.state = state
  }

  /** Current phase. */
  phase(): VoiceChatPhase { return this.state.getSnapshot().phase }

  private patch(patch: Partial<VoiceChatState>): void {
    this.state.set({ ...this.state.getSnapshot(), ...patch })
  }

  /**
   * Open the microphone and enter the conversation loop.
   * @returns after capture starts; failures surface through the failure state.
   */
  async begin(): Promise<void> {
    if (this.active) return
    this.active = true
    this.generation = 0
    this.readSeq = -1
    this.latest = undefined
    this.lastRunning = false
    const capture = this.deps.createCapture?.() ?? new ContinuousCapture()
    this.capture = capture
    this.patch({ phase: 'ready', lastTranscript: '', failure: '', level: 0 })
    try {
      await capture.start(
        (wav) => { this.segment(wav) },
        () => { this.speechStarted() },
        (error) => { this.fail(error) },
      )
    } catch (error) {
      await this.end()
      this.patch({ phase: 'failed', failure: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Close the microphone, stop playback, and reset the conversation. */
  async end(): Promise<void> {
    this.active = false
    this.generation++
    this.synthesis?.abort(new Error('Voice chat ended'))
    this.synthesis = undefined
    this.deps.stopPlayback()
    const capture = this.capture
    this.capture = undefined
    await (capture ? capture.dispose() : this.captureDisposed)
    this.patch({ phase: 'off', level: 0, lastTranscript: '', failure: '' })
  }

  /** Read the live microphone level for the waveform. */
  readLevel(): number { return this.capture?.amplitude() ?? 0 }

  /**
   * Speech onset: interrupt any reading, cancel the active turn when the Agent
   * is still generating, and enter the listening phase.
   */
  speechStarted(): void {
    if (!this.active) return
    const phase = this.phase()
    if (phase === 'speaking' || this.synthesis !== undefined) {
      this.synthesis?.abort(new Error('Interrupted by speech'))
      this.synthesis = undefined
      this.deps.stopPlayback()
    }
    if (this.lastRunning) this.deps.cancelTurn()
    this.patch({ phase: 'listening' })
  }

  /** One completed speech segment: transcribe it, then auto-submit the text. */
  segment(wav: Uint8Array): void {
    if (!this.active) return
    if (this.phase() === 'transcribing') return
    const run = ++this.generation
    this.patch({ phase: 'transcribing' })
    void this.deps.transcribe(wav, this.lifetime.signal).then((text) => {
      if (!this.active || run !== this.generation) return
      if (text.trim() === '') { if (this.phase() === 'transcribing') this.patch({ phase: 'ready' }); return }
      this.patch({ lastTranscript: text, phase: 'thinking' })
      try {
        if (!this.deps.submit(text)) { if (this.phase() === 'thinking') this.patch({ phase: 'ready' }); return }
      } catch (error) {
        this.fail(error)
      }
    }, (error: unknown) => {
      if (!this.active || run !== this.generation) return
      this.fail(error)
    })
  }

  /** Mirror the Session running flag so barge-in can cancel the active turn. */
  noteRunning(running: boolean): void {
    const wasRunning = this.lastRunning
    this.lastRunning = running
    if (!this.active) return
    if (running) {
      this.patch({ phase: 'thinking' })
      return
    }
    if (!wasRunning) return
    // The turn just finished: read the newest speakable assistant message once.
    const latest = this.latest
    if (latest !== undefined && latest.seq > this.readSeq) {
      this.readSeq = latest.seq
      void this.readAloud(latest.text)
    } else if (this.phase() === 'thinking') {
      this.patch({ phase: 'ready' })
    }
  }

  /** Accept the newest assistant message from the Session event window. */
  noteAssistantText(text: string, seq: number): void {
    if (this.latest === undefined || seq > this.latest.seq) this.latest = { seq, text }
  }

  private async readAloud(text: string): Promise<void> {
    if (!this.active) return
    const trimmed = text.slice(0, this.deps.maxReadChars)
    const abort = new AbortController()
    this.synthesis = abort
    this.patch({ phase: 'speaking' })
    try {
      const audio = await this.deps.synthesize(trimmed, abort.signal)
      if (this.phase() === 'off' || abort.signal.aborted) return
      this.synthesis = undefined
      await this.deps.play(audio)
      if (this.phase() === 'off') return
      if (this.phase() === 'speaking') this.patch({ phase: 'ready' })
    } catch (error) {
      if (this.phase() === 'off' || abort.signal.aborted) return
      this.fail(error)
    } finally {
      this.synthesis = undefined
    }
  }

  /** Dismiss a failure and resume listening. */
  retry(): void {
    if (!this.active) return
    this.patch({ phase: 'ready', failure: '' })
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.patch({ phase: 'failed', failure: message })
  }
}
