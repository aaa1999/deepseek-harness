/** Expanded call status row under the composer while a voice chat is active. */
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconStopFillRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VoiceChatInjected } from './mount.ts'
import { NS, type VoiceChatKey } from './locales.ts'
import type { VoiceChatPhase } from './chat.ts'
import css from './VoiceChat.module.css'

export type VoiceChatStatusProps = Pick<PropsRuntime<'conversation.composer.dock'>, 'sessionId' | 'useSession'>
  & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>

const PHASE_KEYS: Record<Exclude<VoiceChatPhase, 'off' | 'failed'>, VoiceChatKey> = {
  ready: 'phase.ready', listening: 'phase.listening', transcribing: 'phase.transcribing',
  thinking: 'phase.thinking', speaking: 'phase.speaking',
}

/**
 * Status row shown only while a call runs: phase label, live level bar, failure
 * retry, and the End control. It feeds the Session running flag and the latest
 * assistant text into the conversation loop.
 */
export function VoiceChatStatus({ sessionId, useSession, end, retry, noteRunning, noteEntries, updateLevel,
  useVoiceChat, t }: VoiceChatStatusProps) {
  const phase = useVoiceChat(state => state.phase)
  const level = useVoiceChat(state => state.level)
  const failure = useVoiceChat(state => state.failure)
  const running = useSession(snapshot => snapshot.running)
  useEffect(() => { noteRunning(running) }, [noteRunning, running])
  useEffect(() => noteEntries(sessionId), [noteEntries, sessionId])
  useEffect(() => {
    const timer = setInterval(() => { updateLevel() }, 100)
    return () => { clearInterval(timer) }
  }, [updateLevel])
  useEffect(() => () => { void end() }, [sessionId])
  if (phase === 'off') return null
  const label = phase === 'failed' ? `${t('phase.failed')} ${failure}` : t(PHASE_KEYS[phase])
  return <div className={css.status} data-voice-chat-phase={phase}>
    <StateDot state={phase === 'failed' ? 'error' : 'ongoing'} />
    <span className={css.label} role="status" title={label}>{label}</span>
    <span className={css.levelTrack} aria-hidden="true">
      <span className={css.level} style={{ width: `${Math.min(100, Math.round(level * 300))}%` }} />
    </span>
    {phase === 'failed' && <Button className={css.inlineAction} size="sm" type="button" onClick={retry}>{t('retry')}</Button>}
    <Button className={css.roundButton} size="sm" type="button" aria-label={t('end')}
      onClick={() => { void end() }}><IconStopFillRegular size={14} /></Button>
  </div>
}
