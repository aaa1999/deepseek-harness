/**
 * SessionNodeDock: the checkpoint strip above the composer card. The left
 * half names and saves the current session's node; the right half addresses
 * one saved node through a chip menu and forks or deletes it. State is the
 * global node registry (not a session projection), so every verb arrives
 * through the injected face bound to the current session.
 */

import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconPinOutlineRegular,
  IconTrashOutlineRegular, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionNode, SessionNodeId } from 'dsh-session-node/client'
import type { SessionNodeDockActions } from './slots.ts'
import css from './SessionNodes.module.css'

/** Full props of the dock entry: runtime share, copy, and injected verbs. */
export type SessionNodeDockProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'sessionNodes'>
  & InjectFace<SessionNodeDockActions>

export function SessionNodeDock({ save, list, fork, remove, useNodeRevision, t }: SessionNodeDockProps) {
  const [nodes, setNodes] = useState<SessionNode[]>([])
  const [selected, setSelected] = useState<SessionNodeId | null>(null)
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Registry revision: a per-turn pin save elsewhere in the tree bumps it.
  const revision = useNodeRevision(value => value)

  const refresh = useCallback(async () => {
    const result = await list()
    if (!result.ok) { setError(result.error.message); return }
    setNodes(result.value)
    setSelected(current => current !== null && result.value.some(node => node.id === current)
      ? current
      : result.value[0]?.id ?? null)
  }, [list])

  useEffect(() => { void refresh() }, [refresh, revision])

  const run = useCallback(async (action: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok && result.error !== undefined) setError(result.error.message)
    return result.ok
  }, [])

  const handleSave = useCallback(async () => {
    const trimmed = title.trim()
    const ok = await run(() => save(trimmed === '' ? undefined : trimmed))
    if (ok) setTitle('')
  }, [run, save, title])

  const handleFork = useCallback(async () => {
    if (selected === null) return
    await run(() => fork(selected))
  }, [run, fork, selected])

  const handleRemove = useCallback(async () => {
    if (selected === null) return
    const ok = await run(() => remove(selected))
    if (ok) setSelected(null)
  }, [run, remove, selected])

  const current = nodes.find(node => node.id === selected)

  return (
    <div className={css.dock} data-session-node-dock>
      <span className={css.dockMark} aria-hidden="true"><IconPinOutlineRegular size={16} /></span>
      <input
        className={css.dockTitle}
        value={title}
        onChange={event => setTitle(event.target.value)}
        placeholder={t('dock.titlePlaceholder')}
        aria-label={t('dock.titlePlaceholder')}
        disabled={busy}
      />
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void handleSave() }}>
        {t('dock.save')}
      </Button>
      <Menu
        open={open && !busy}
        onClose={() => { setOpen(false) }}
        items={nodes.map(node => ({
          id: node.id,
          label: (
            <span className={css.item}>
              <span className={css.itemName}>{node.title}</span>
              <span className={css.itemDesc}>{new Date(node.createdAt).toLocaleString()}</span>
            </span>
          ),
        }))}
        selectedId={selected ?? undefined}
        onSelect={(id) => { setSelected(id as SessionNodeId); setOpen(false) }}
        align="end"
        portal
        className={`${css.menuAnchor} ${css.dockAnchor}`}
        anchor={(
          <button
            type="button"
            className={`${css.seat} ${css.dockChip}`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('dock.nodesLabel')}
            disabled={busy || nodes.length === 0}
            onClick={() => { setOpen(current => !current) }}
          >
            <span className={css.seatLabel}>
              {current === undefined ? t('dock.none') : current.title}
            </span>
            <IconChevronDownOutlineRegular size={14} />
          </button>
        )}
      />
      <Tooltip label={t('dock.fork')} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={t('dock.fork')}
          disabled={busy || selected === null}
          onClick={() => { void handleFork() }}
        >
          <IconBranchOutlineRegular />
        </button>
      </Tooltip>
      <Tooltip label={t('dock.delete')} side="bottom">
        <button
          type="button"
          className={`${css.action} ${css.actionDanger}`}
          aria-label={t('dock.delete')}
          disabled={busy || selected === null}
          onClick={() => { void handleRemove() }}
        >
          <IconTrashOutlineRegular />
        </button>
      </Tooltip>
      {error !== null && <span role="alert" className={css.dockError}>{error}</span>}
    </div>
  )
}
