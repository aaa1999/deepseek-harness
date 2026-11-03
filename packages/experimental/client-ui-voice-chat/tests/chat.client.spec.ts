/** Conversation loop: auto-submit, read-aloud, barge-in and replay suppression. */
import { describe, expect, it, vi } from 'vitest'
import { VoiceChatSession, type VoiceCapture, type VoiceChatDeps } from '../src/client/chat.ts'

/** A fake microphone that exposes its callbacks to the test. */
function fakeCapture() {
  let onSegment: ((wav: Uint8Array, seconds: number) => void) | undefined
  let onSpeechStart: (() => void) | undefined
  const capture: VoiceCapture = {
    start: async (segment, start) => { onSegment = segment; onSpeechStart = start },
    amplitude: () => 0.2,
    dispose: async () => {},
  }
  return {
    capture,
    segment: (wav: Uint8Array): void => { onSegment?.(wav, 1) },
    speechStart: (): void => { onSpeechStart?.() },
  }
}

function deps(overrides: Partial<VoiceChatDeps> = {}) {
  return {
    maxReadChars: 100,
    transcribe: vi.fn(async () => '你好'),
    submit: vi.fn(() => true),
    synthesize: vi.fn(async () => new Uint8Array([1, 2])),
    play: vi.fn(async () => {}),
    stopPlayback: vi.fn(),
    cancelTurn: vi.fn(),
    ...overrides,
  } satisfies VoiceChatDeps
}

async function begun(d: VoiceChatDeps) {
  const mic = fakeCapture()
  const session = new VoiceChatSession({ ...d, createCapture: () => mic.capture })
  await session.begin()
  expect(session.phase()).toBe('ready')
  return { session, mic }
}

describe('voice chat loop', () => {
  it('listens, transcribes a segment and auto-submits the text', async () => {
    const d = deps()
    const { session } = await begun(d)
    session.speechStarted()
    expect(session.phase()).toBe('listening')
    session.segment(new Uint8Array(44))
    expect(session.phase()).toBe('transcribing')
    await vi.waitFor(() => { expect(session.phase()).toBe('thinking') })
    expect(d.transcribe).toHaveBeenCalledOnce()
    expect(d.submit).toHaveBeenCalledWith('你好')
    expect(session.state.getSnapshot().lastTranscript).toBe('你好')
    await session.end()
    expect(session.phase()).toBe('off')
  })

  it('ignores empty transcripts and stays ready', async () => {
    const d = deps({ transcribe: vi.fn(async () => '') })
    const { session } = await begun(d)
    session.speechStarted()
    session.segment(new Uint8Array(44))
    await vi.waitFor(() => { expect(session.phase()).toBe('ready') })
    expect(d.submit).not.toHaveBeenCalled()
    await session.end()
  })

  it('reads the newest assistant message once when the turn finishes', async () => {
    const d = deps()
    const { session } = await begun(d)
    session.noteRunning(true)
    expect(session.phase()).toBe('thinking')
    session.noteAssistantText('收到，请继续', 7)
    session.noteRunning(false)
    await vi.waitFor(() => { expect(session.phase()).toBe('speaking') })
    await vi.waitFor(() => { expect(session.phase()).toBe('ready') })
    expect(d.synthesize).toHaveBeenCalledWith('收到，请继续', expect.any(AbortSignal))
    expect(d.play).toHaveBeenCalledOnce()
    // A repeated finish with no newer message reads nothing again.
    session.noteRunning(true)
    session.noteRunning(false)
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(d.synthesize).toHaveBeenCalledOnce()
    await session.end()
  })

  it('truncates long replies to the read budget', async () => {
    const d = deps({ maxReadChars: 5 })
    const { session } = await begun(d)
    session.noteAssistantText('一二三四五六七八九', 3)
    session.noteRunning(true)
    session.noteRunning(false)
    await vi.waitFor(() => { expect(d.synthesize).toHaveBeenCalledWith('一二三四五', expect.any(AbortSignal)) })
    await vi.waitFor(() => { expect(session.phase()).toBe('ready') })
    await session.end()
  })

  it('interrupts playback and cancels the active turn when speech starts', async () => {
    let settle!: (audio: Uint8Array) => void
    const pending = new Promise<Uint8Array>((resolve) => { settle = resolve })
    const d = deps({ synthesize: vi.fn(() => pending) })
    const { session } = await begun(d)
    session.noteAssistantText('回复中', 4)
    session.noteRunning(true)
    session.noteRunning(false)
    await vi.waitFor(() => { expect(session.phase()).toBe('speaking') })
    // The user starts speaking while the Agent is still running.
    session.noteRunning(true)
    session.speechStarted()
    expect(session.phase()).toBe('listening')
    expect(d.stopPlayback).toHaveBeenCalled()
    expect(d.cancelTurn).toHaveBeenCalled()
    settle(new Uint8Array([9]))
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    // The aborted read never plays.
    expect(d.play).not.toHaveBeenCalled()
    await session.end()
  })

  it('keeps listening when submission was declined by a changed draft', async () => {
    const d = deps({ submit: vi.fn(() => false) })
    const { session } = await begun(d)
    session.segment(new Uint8Array(44))
    await vi.waitFor(() => { expect(session.phase()).toBe('ready') })
    expect(d.submit).toHaveBeenCalledOnce()
    await session.end()
  })

  it('reports transcription failures without leaving the call', async () => {
    const d = deps({ transcribe: vi.fn(async () => { throw new Error('offline recognizer') }) })
    const { session } = await begun(d)
    session.segment(new Uint8Array(44))
    await vi.waitFor(() => { expect(session.phase()).toBe('failed') })
    expect(session.state.getSnapshot().failure).toContain('offline recognizer')
    session.retry()
    expect(session.phase()).toBe('ready')
    await session.end()
  })
})
