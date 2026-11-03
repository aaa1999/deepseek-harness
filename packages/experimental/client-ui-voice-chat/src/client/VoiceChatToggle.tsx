/** Compact call toggle in the composer tool row. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconMicrophoneOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { providerUsable } from './readiness.ts'
import type { VoiceChatInjected } from './mount.ts'
import { NS } from './locales.ts'
import css from './VoiceChat.module.css'

export type VoiceChatToggleProps = Pick<PropsRuntime<'conversation.input.right'>, 'sessionId' | 'inputActions'>
  & PropsLocale<typeof NS> & InjectFace<VoiceChatInjected>

/**
 * One microphone-shaped call control. While the recognizer or synthesizer is
 * unprepared the control opens the bundle setup instead of starting capture.
 */
export function VoiceChatToggle({ sessionId, inputActions, begin, end, openSettings,
  useVoiceChat, useReadiness, t }: VoiceChatToggleProps) {
  const active = useVoiceChat(state => state.phase) !== 'off'
  const readiness = useReadiness(value => value)
  const usable = readiness.connected && providerUsable(readiness.speech) && providerUsable(readiness.synthesis)
  return <Tooltip label={t(usable ? 'call' : 'setup.trigger')} side="top" portal>
    <span className={css.toggleAnchor}>
      <Button className={css.toggle} size="sm" aria-pressed={active}
        aria-label={t(usable ? 'call' : 'setup.trigger')}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => {
          if (active) void end()
          else if (usable) void begin(inputActions, sessionId)
          else openSettings()
        }}>
        <IconMicrophoneOutlineRegular size={18} />
      </Button>
    </span>
  </Tooltip>
}
