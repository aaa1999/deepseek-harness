/**
 * SaveTurnNodeButton: the checkpoint pin in the assistant message's action
 * row, between copy and branch. One click saves the turn's inclusive
 * boundary as a node titled after the session's display title plus the turn
 * number; the glyph settles on a check for two seconds the way copy does.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCheckOutlineRegular, IconPinOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionNodeTurnSaveInjected } from './slots.ts'
import css from './SessionNodes.module.css'

/** Full props of the assistant-actions entry: message identity, copy, and the save verb. */
export type SaveTurnNodeButtonProps = PropsRuntime<'conversation.chat.assistant-actions'>
  & PropsLocale<'sessionNodes'>
  & InjectFace<SessionNodeTurnSaveInjected>

/** Auto label for one saved turn: the session's display title plus the turn number. */
export function turnNodeTitle(displayTitle: string, turn: number): string {
  return displayTitle === '' ? `#${turn}` : `${displayTitle} #${turn}`
}

export function SaveTurnNodeButton({ messageId, save, t, sessionId, useSessions, useChat, useAccess }: SaveTurnNodeButtonProps) {
  const [saved, setSaved] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => { if (flashTimer.current !== undefined) clearTimeout(flashTimer.current) }, [])

  // The action row addresses the closing assistant message; the save boundary
  // is the turn it settles: the turn/end seq when the location records one.
  const hit = useChat((snapshot) => {
    for (const [turnNumber, turn] of snapshot.timeline.turns) {
      const closing = turn.data.get('turn-tail')?.closing
      if (closing?.finalNode.messageId === messageId) {
        return { seq: turn.end?.seq ?? closing.finalNode.seq, turnNumber }
      }
    }
    return undefined
  })
  const displayTitle = useSessions(state => state.byId[sessionId]?.displayTitle ?? '')

  const handleClick = useCallback(() => {
    if (hit === undefined) return
    void (async () => {
      const result = await save(turnNodeTitle(displayTitle, hit.turnNumber), hit.seq)
      if (!result.ok) return
      setSaved(true)
      if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => { setSaved(false) }, 2000)
    })()
  }, [displayTitle, hit, save])

  if (hit === undefined || !useAccess('sessionNodes/save')) return null

  return (
    <Tooltip label={saved ? t('turn.saved') : t('turn.save')} side="bottom">
      <button
        type="button"
        className={css.action}
        onClick={handleClick}
        aria-label={saved ? t('turn.saved') : t('turn.save')}
        data-session-node-turn={hit.turnNumber}
      >
        {saved ? <IconCheckOutlineRegular /> : <IconPinOutlineRegular />}
      </button>
    </Tooltip>
  )
}
