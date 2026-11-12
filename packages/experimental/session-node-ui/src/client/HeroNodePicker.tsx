/**
 * HeroNodePicker: the New Session row chip that forks the staged session
 * from a saved node of the picked workspace. Picking a node in the menu is
 * the whole action: the fork opens the child session immediately. Nodes of
 * other workspaces never appear; nodes saved without a resolved workspace
 * appear only while the staged session has no workspace either.
 */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconBranchOutlineRegular, IconChevronDownOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionNode, SessionNodeId } from '@deepseek-ai/dsh-session-node/client'
import type { HeroNodePickerInjected } from './slots.ts'
import { nodesInWorkspaceScope } from './node-scope.ts'
import css from './SessionNodes.module.css'

/** Full props of the hero-options entry: runtime share, copy, and the list/fork verbs. */
export type HeroNodePickerProps = PropsRuntime<'conversation.hero.options'>
  & PropsLocale<'sessionNodes'>
  & InjectFace<HeroNodePickerInjected>
  & Pick<GlobalStandardProps, 'useWorkspaces'>

export function HeroNodePicker({ list, fork, t, sessionId, useWorkspaces }: HeroNodePickerProps) {
  const [nodes, setNodes] = useState<SessionNode[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workspaceId = useWorkspaces(state =>
    state.items.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId)

  useEffect(() => {
    void (async () => {
      const result = await list()
      if (!result.ok) { setError(result.error.message); return }
      setNodes(result.value)
    })()
  }, [list])

  if (nodes === null && error === null) return null
  const visible = nodesInWorkspaceScope(nodes ?? [], workspaceId)
  if (visible.length === 0) return null

  const pick = (nodeId: SessionNodeId): void => {
    setOpen(false)
    setBusy(true)
    setError(null)
    void fork(nodeId).then((result) => {
      setBusy(false)
      if (!result.ok) setError(result.error.message)
    })
  }

  return (
    <>
      <Menu
        open={open && !busy}
        onClose={() => { setOpen(false) }}
        items={visible.map(node => ({
          id: node.id,
          label: (
            <span className={css.item}>
              <span className={css.itemName}>{node.title}</span>
              <span className={css.itemDesc}>{new Date(node.createdAt).toLocaleString()}</span>
            </span>
          ),
        }))}
        onSelect={(id) => { pick(id as SessionNodeId) }}
        align="end"
        portal
        className={css.menuAnchor}
        anchor={(
          <button
            type="button"
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('hero.selectLabel')}
            disabled={busy}
            onClick={() => { setOpen(current => !current) }}
            data-session-node-hero-picker
          >
            <IconBranchOutlineRegular size={16} />
            <span className={css.seatLabel}>{t('hero.label')}</span>
            <IconChevronDownOutlineRegular size={14} />
          </button>
        )}
      />
      {error !== null && <span role="alert" className={css.dockError}>{error}</span>}
    </>
  )
}
