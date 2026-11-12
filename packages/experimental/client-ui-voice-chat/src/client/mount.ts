/** Source-safe lifecycle for the optional voice-chat Remote pair and browser UI. */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import type {} from '@deepseek-ai/dsh-api-text-to-speech/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SpeechPlayer } from './player.ts'
import { VoiceChatSession, type VoiceChatState } from './chat.ts'
import { audioBase64, decodeBase64Audio } from './wave.ts'
import { latestAssistantText } from './assistant-text.ts'
import { observeReadiness, type VoiceReadiness } from './readiness.ts'
import { VoiceChatToggle } from './VoiceChatToggle.tsx'
import { VoiceChatStatus } from './VoiceChatStatus.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'

export const inject = ['remote', 'slots', 'locale', 'sessions']

/** Speak at most this many characters per synthesis call. */
const MAX_READ_CHARS = 500
/** Bundle opened from the setup guidance. */
const VOICE_CHAT_BUNDLE = '@deepseek-ai/dsh-voice-chat-bundle'

/** Actions injected into both voice-chat components. */
export interface VoiceChatInjected {
  begin(inputActions: InputActions, sessionId: SessionId): Promise<void>
  end(): Promise<void>
  retry(): void
  openSettings(): void
  noteRunning(running: boolean): void
  noteEntries(sessionId: SessionId): () => void
  updateLevel(): void
  hooks: {
    voiceChat: HostObservable<VoiceChatState>
    readiness: HostObservable<VoiceReadiness>
  }
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }))
  const readiness = observeReadiness(ctx)
  ctx.effect(() => readiness.dispose)
  const chatState = createSnapshotStore<VoiceChatState>({ phase: 'off', level: 0, lastTranscript: '', failure: '' })
  let current: VoiceChatSession | undefined
  let player: SpeechPlayer | undefined
  let currentSession: SessionId | undefined
  let disposed = false

  const cancelTurn = (): void => {
    const sessionId = currentSession
    if (sessionId === undefined) return
    const conversation = ctx.sessions.scope(sessionId)?.get('conversation')
    void conversation?.cancel().catch(() => undefined)
  }

  const end = async (): Promise<void> => {
    const session = current
    current = undefined
    currentSession = undefined
    const activePlayer = player
    player = undefined
    if (session) await session.end()
    await activePlayer?.dispose()
  }

  ctx.effect(() => async () => { disposed = true; await end() })

  const actions: VoiceChatInjected = {
    begin: async (inputActions, sessionId) => {
      if (disposed || current !== undefined) return
      currentSession = sessionId
      const activePlayer = new SpeechPlayer()
      player = activePlayer
      const session = new VoiceChatSession({
        maxReadChars: MAX_READ_CHARS,
        transcribe: async (wav, signal) => {
          const result = await ctx.remote.speech.transcribe({ audioBase64: audioBase64(wav) }, signal)
          if (!result.ok) throw result.error
          return result.value.text
        },
        submit: (text) => {
          if (!inputActions.insertText(text, inputActions.captureInsertion())) return false
          inputActions.submit()
          return true
        },
        synthesize: async (text, signal) => {
          const result = await ctx.remote.speechSynthesis.synthesize({ text }, signal)
          if (!result.ok) throw result.error
          return decodeBase64Audio(result.value.audioBase64)
        },
        play: async (audio) => { await activePlayer.play(audio) },
        stopPlayback: () => { activePlayer.stop() },
        cancelTurn,
      }, chatState)
      current = session
      await session.begin()
    },
    end,
    retry: () => { current?.retry() },
    openSettings: () => { ctx.get('pluginNavigation')?.openBundle(VOICE_CHAT_BUNDLE) },
    noteRunning: (running) => { current?.noteRunning(running) },
    noteEntries: (sessionId) => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return () => {}
      const feed = (): void => {
        const session = current
        if (session === undefined) return
        const latest = latestAssistantText(binding.eventSource.getSnapshot().entries)
        if (latest !== undefined) session.noteAssistantText(latest.text, latest.seq)
      }
      feed()
      return binding.eventSource.subscribe(feed)
    },
    updateLevel: () => {
      const session = current
      if (session === undefined) return
      chatState.set({ ...chatState.getSnapshot(), level: session.readLevel() })
    },
    hooks: { voiceChat: chatState, readiness: readiness.state },
  }
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'voice-chat', locale: NS, inject: () => actions,
  }, VoiceChatToggle))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'voice-chat-status', locale: NS, inject: () => actions,
  }, VoiceChatStatus))
}

/**
 * Mount this experimental namespace without adding it to stable API Remotes.
 * @param ctx - Client runtime owning the Remotes, dictionaries and slots.
 * @param speechContribution - generated speech recognition Remote definitions.
 * @param synthesisContribution - generated speech synthesis Remote definitions.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function mountVoiceChat(ctx: Context, speechContribution: TypertRemoteContribution,
  synthesisContribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeSpeech = await ctx.remote.$mount(speechContribution)
  const disposeSynthesis = await ctx.remote.$mount(synthesisContribution)
  const ui = ctx.inject(['remote.speech', 'remote.speechSynthesis', 'slots', 'locale', 'sessions'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeSpeech(); await disposeSynthesis(); throw error }
  return async () => { await ui.dispose(); await disposeSpeech(); await disposeSynthesis() }
}
