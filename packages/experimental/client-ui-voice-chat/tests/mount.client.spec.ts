/** The optional voice-chat namespace joins Client plugin disposal and both Remotes. */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { mountVoiceChat, inject, type VoiceChatInjected } from '../src/client/mount.ts'
import { apply as hostApply } from '../src/index.ts'
import { VoiceChatToggle } from '../src/client/VoiceChatToggle.tsx'
import { VoiceChatStatus } from '../src/client/VoiceChatStatus.tsx'
import { voiceCaptureFixture } from './capture-fixture.client.ts'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const REMOTE: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-api-speech-to-text', descriptors: [] }
const SYNTHESIS: TypertRemoteContribution = { package: '@deepseek-ai/dsh-experimental-api-text-to-speech', descriptors: [] }

vi.mock('../src/client/readiness.ts', () => ({ observeReadiness: () => ({
  state: createSnapshotStore({ speech: null, synthesis: null, connected: true, error: null }), dispose: async () => {},
}) }))

function assertVoiceActions(value: Record<string, unknown>): asserts value is Record<string, unknown> & VoiceChatInjected {
  assert(typeof value.begin === 'function')
  assert(typeof value.end === 'function')
  assert(typeof value.retry === 'function')
  assert(typeof value.openSettings === 'function')
  assert(typeof value.noteRunning === 'function')
  assert(typeof value.noteEntries === 'function')
  assert(typeof value.updateLevel === 'function')
  assert(typeof value.hooks === 'object' && value.hooks !== null)
}

const inputActions = {
  insertText: (text: string, span: unknown) => { void text; void span; return true },
  captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
  submit: () => {},
} as unknown as InputActions

async function fixture(fail = false, navigation = true) {
  const ctx = new Context(), unmountSpeech = vi.fn(async () => {}), unmountSynthesis = vi.fn(async () => {})
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      return contribution === REMOTE ? unmountSpeech : unmountSynthesis
    }
  }
  new Remote()
  const openBundle = vi.fn()
  if (navigation) ctx.provide('pluginNavigation', { openBundle })
  ctx.provide('remote.speech', { transcribe: vi.fn(async () => ({ ok: true, value: { text: '' } })) })
  ctx.provide('remote.speechSynthesis', { synthesize: vi.fn(async () => ({ ok: true, value: { audioBase64: '' } })) })
  ctx.provide('sessions', { binding: vi.fn(() => undefined), scope: vi.fn(() => undefined) })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'conversation.input.right': { kind: 'list', scope: 'session' },
    'conversation.composer.dock': { kind: 'list', scope: 'session' },
  } } as never,
  () => null)
  if (fail) vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot failed') })
  return { ctx, unmountSpeech, unmountSynthesis, openBundle }
}

it('registers both slots with the shared injected actions', async () => {
  hostApply()
  const b = await fixture()
  try {
    await b.ctx.plugin({ inject: [...inject], apply: ctx => mountVoiceChat(ctx, REMOTE, SYNTHESIS) })
    const toggle = b.ctx.slots.entries('conversation.input.right').find(item => item.component === VoiceChatToggle)
    const status = b.ctx.slots.entries('conversation.composer.dock').find(item => item.component === VoiceChatStatus)
    expect(toggle).toMatchObject({ locale: 'voice-chat', options: { id: 'voice-chat' } })
    expect(status).toMatchObject({ locale: 'voice-chat', options: { id: 'voice-chat-status' } })
    const actions = toggle!.inject!()
    assertVoiceActions(actions)
    expect(status!.inject!().hooks).toBe(actions.hooks)
    expect(() => { actions.openSettings() }).not.toThrow()
    actions.openSettings()
    expect(b.openBundle).toHaveBeenCalledWith('@deepseek-ai/dsh-experimental-voice-chat-bundle')
  } finally { await b.ctx.fiber.dispose() }
})

it('opens a call, forwards feedback, and releases the microphone on end', async () => {
  hostApply()
  const audio = voiceCaptureFixture()
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountVoiceChat(ctx, REMOTE, SYNTHESIS) })
    await fiber
    const actions = b.ctx.slots.entries('conversation.input.right').find(item => item.component === VoiceChatToggle)!.inject!()
    assertVoiceActions(actions)
    expect(actions.hooks.voiceChat.getSnapshot().phase).toBe('off')
    await actions.begin(inputActions, 'session-1' as SessionId)
    expect(actions.hooks.voiceChat.getSnapshot().phase).toBe('ready')
    expect(audio.getUserMedia).toHaveBeenCalled()
    // Feedback and level updates forward while no session is bound.
    actions.noteRunning(true)
    actions.noteRunning(false)
    actions.retry()
    actions.updateLevel()
    expect(actions.noteEntries('missing' as SessionId)).toBeTypeOf('function')
    await actions.end()
    expect(actions.hooks.voiceChat.getSnapshot().phase).toBe('off')
    expect(audio.trackStop).toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
    try { await b.ctx.fiber.dispose() } catch { /* already disposed */ }
  }
})

it('withdraws its Remotes and slots on disposal', async () => {
  hostApply()
  const b = await fixture()
  try {
    const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountVoiceChat(ctx, REMOTE, SYNTHESIS) })
    await fiber
    await fiber.dispose()
    expect(b.ctx.slots.entries('conversation.input.right')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.composer.dock')).toHaveLength(0)
    expect(b.unmountSpeech).toHaveBeenCalledOnce()
    expect(b.unmountSynthesis).toHaveBeenCalledOnce()
  } finally { await b.ctx.fiber.dispose() }
})

it('rolls back both Remote contributions when the slot registration fails', async () => {
  const b = await fixture(true)
  try {
    await expect(mountVoiceChat(b.ctx, REMOTE, SYNTHESIS)).rejects.toThrow('slot failed')
    expect(b.unmountSpeech).toHaveBeenCalledOnce()
    expect(b.unmountSynthesis).toHaveBeenCalledOnce()
  } finally { await b.ctx.fiber.dispose() }
})
