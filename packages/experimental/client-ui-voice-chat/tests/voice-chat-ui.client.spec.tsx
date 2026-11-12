// @vitest-environment jsdom
/** Call toggle and status row rendering and interactions. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-text-to-speech/types'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { VoiceChatToggle, type VoiceChatToggleProps } from '../src/client/VoiceChatToggle.tsx'
import { VoiceChatStatus, type VoiceChatStatusProps } from '../src/client/VoiceChatStatus.tsx'
import type { VoiceReadiness } from '../src/client/readiness.ts'
import type { VoiceChatState } from '../src/client/chat.ts'
import { zh } from '../src/client/locales.ts'

beforeEach(() => { vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const speechId = 'sensevoice-local' as SpeechProviderId
const synthesisId = 'vits-melo-local' as SynthesisProviderId
const sessionId = 'one' as SessionId
const inputActions: InputActions = {
  insertQuote: vi.fn(() => false),
  captureInsertion: vi.fn(() => ({ start: 0, end: 0, draftRev: 0 })),
  insertText: vi.fn(() => true),
  setDraft: vi.fn(),
  persistDraft: vi.fn(),
  addAttachments: vi.fn(() => false),
  removeAttachment: vi.fn(),
  pruneAttachments: vi.fn(),
  submit: vi.fn(),
}

function usableReadiness(usable = true) {
  return createSnapshotStore<VoiceReadiness>({ connected: true, error: null,
    speech: { providers: [{ id: speechId, name: 'SenseVoice', location: 'host-local', languages: ['auto', 'zh', 'en'],
      preparation: { phase: usable ? 'ready' : 'unprepared' } }], selection: { providerId: speechId, language: 'auto' },
    maxAudioBytes: 100, maxDurationSeconds: 120 },
    synthesis: { providers: [{ id: synthesisId, name: 'vits-melo', location: 'host-local', languages: ['auto', 'zh', 'en'],
      preparation: { phase: usable ? 'ready' : 'unprepared' } }], selection: { providerId: synthesisId, language: 'auto' },
    maxTextBytes: 8192, maxAudioBytes: 1024 },
  })
}

function toggleFixture(state: VoiceChatState, readiness = usableReadiness()) {
  const begin = vi.fn(async () => {}), end = vi.fn(async () => {}), openSettings = vi.fn()
  const retry = vi.fn(), noteRunning = vi.fn(), noteEntries = vi.fn(() => () => {}), updateLevel = vi.fn()
  const props: VoiceChatToggleProps = { sessionId, inputActions, begin, end, openSettings, retry, noteRunning, noteEntries, updateLevel,
    useVoiceChat: bindSnapshotSelector(createSnapshotStore(state)),
    useReadiness: bindSnapshotSelector(readiness),
    t: makeTranslate(zh, commonZh) }
  const view = render(<VoiceChatToggle {...props} />)
  return { props, begin, end, openSettings, retry, noteRunning, noteEntries, updateLevel, view }
}

function statusFixture(state: VoiceChatState, readiness = usableReadiness()) {
  const begin = vi.fn(async () => {}), end = vi.fn(async () => {}), openSettings = vi.fn()
  const retry = vi.fn(), noteRunning = vi.fn(), noteEntries = vi.fn(() => () => {}), updateLevel = vi.fn()
  const session = createSnapshotStore(sessionSnapshot(sessionId))
  const props: VoiceChatStatusProps = { sessionId,
    useSession: bindSnapshotSelector(session),
    useReadiness: bindSnapshotSelector(readiness),
    begin, end, openSettings, retry, noteRunning, noteEntries, updateLevel,
    useVoiceChat: bindSnapshotSelector(createSnapshotStore(state)),
    t: makeTranslate(zh, commonZh) }
  const view = render(<VoiceChatStatus {...props} />)
  return { props, begin, end, openSettings, retry, noteRunning, noteEntries, updateLevel, session, view }
}

it('starts a call when both providers are prepared', async () => {
  const b = toggleFixture({ phase: 'off', level: 0, lastTranscript: '', failure: '' })
  const button = screen.getByRole('button', { name: zh.call })
  fireEvent.click(button)
  await vi.waitFor(() => { expect(b.begin).toHaveBeenCalledWith(inputActions, sessionId) })
  expect(b.openSettings).not.toHaveBeenCalled()
  b.view.unmount()
})

it('opens the bundle setup when a provider is unprepared', () => {
  const b = toggleFixture({ phase: 'off', level: 0, lastTranscript: '', failure: '' }, usableReadiness(false))
  fireEvent.click(screen.getByRole('button', { name: zh['setup.trigger'] }))
  expect(b.openSettings).toHaveBeenCalledOnce()
  expect(b.begin).not.toHaveBeenCalled()
})

it('ends the active call from the pressed toggle', () => {
  const b = toggleFixture({ phase: 'ready', level: 0, lastTranscript: '', failure: '' })
  expect(screen.getByRole('button', { name: zh.call }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: zh.call }))
  expect(b.end).toHaveBeenCalledOnce()
})

it('hides the status row outside a call and shows the phase inside', () => {
  const off = statusFixture({ phase: 'off', level: 0, lastTranscript: '', failure: '' })
  expect(off.view.container.firstChild).toBeNull()
  off.view.unmount()
  const b = statusFixture({ phase: 'ready', level: 0.2, lastTranscript: '', failure: '' })
  expect(screen.getByRole('status').textContent).toBe(zh['phase.ready'])
  expect(b.noteRunning).toHaveBeenCalledWith(false)
  expect(b.noteEntries).toHaveBeenCalledWith(sessionId)
  fireEvent.click(screen.getByRole('button', { name: zh.end }))
  expect(b.end).toHaveBeenCalledOnce()
  b.view.unmount()
})

it('shows the failure with a retry control and forwards running changes', async () => {
  const b = statusFixture({ phase: 'failed', level: 0, lastTranscript: '', failure: 'offline synthesizer' })
  expect(screen.getByRole('status').textContent).toContain('offline synthesizer')
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  expect(b.retry).toHaveBeenCalledOnce()
  b.session.set({ ...sessionSnapshot(sessionId), running: true })
  await vi.waitFor(() => { expect(b.noteRunning).toHaveBeenLastCalledWith(true) })
  b.view.unmount()
})
