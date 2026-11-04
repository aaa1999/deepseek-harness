/**
 * SessionNodeSection: the saved-node manager block in the sidebar's sections
 * strip, between the global panel rows and the workspace browser. The header
 * row toggles the registry list; clicking a row forks a new session from that
 * node, and the row's hover actions rename it (an inline editor, saved on
 * Enter) or delete it. Rail state renders the section glyph as one expand
 * control. The list scopes to the current (main-view) session's workspace:
 * nodes of other workspaces never appear, and nodes saved without a resolved
 * workspace appear only while no session is open or a global panel covers
 * the conversation.
 */

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { GlobalStandardProps, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconEditOutlineRegular, IconPinOutlineRegular, IconTrashOutlineRegular,
  IconTriangleRightFillRegular, InlineEditor, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionNode, SessionNodeId } from 'dsh-session-node/client'
import type { SessionNodeSectionInjected } from './slots.ts'
import { nodesInWorkspaceScope } from './node-scope.ts'
import css from './SessionNodes.module.css'

/** Owner share of the `sidebar.sections` hole: the sidebar's column state. */
interface SectionOwnerProps {
  /** Wide renders the full block; rail renders the expand control. */
  wide: boolean
  /** Ensure the sidebar is visible; safe to call while already expanded. */
  expandSidebar: () => void
}

/** Full props of the sidebar sections entry: column state, copy, and the registry verbs. */
export type SessionNodeSectionProps = SectionOwnerProps
  & PropsLocale<'sessionNodes'>
  & InjectFace<SessionNodeSectionInjected>
  & Pick<GlobalStandardProps, 'useSessions' | 'useWorkspaces' | 'usePanelInfo'>

export function SessionNodeSection({
  wide, expandSidebar, list, rename, fork, remove, useNodeRevision, t,
  useSessions, useWorkspaces, usePanelInfo,
}: SessionNodeSectionProps) {
  const [nodes, setNodes] = useState<SessionNode[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState<{ id: SessionNodeId; draft: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Registry revision: a save, rename, or delete elsewhere in the tree bumps it.
  const revision = useNodeRevision(value => value)
  // Workspace context: the main-view session's workspace, undefined while a
  // global panel is open or nothing is retained — which scopes the list to
  // workspace-less nodes alone.
  const panelActive = usePanelInfo(info => info.activePanelId !== null)
  const currentSessionId = useSessions(state => panelActive
    ? undefined
    : Object.values(state.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id)
  const workspaceId = useWorkspaces(state => currentSessionId === undefined
    ? undefined
    : state.items.find(workspace => workspace.sessionIds.includes(currentSessionId))?.workspaceId)
  const visible = nodesInWorkspaceScope(nodes ?? [], workspaceId)

  const refresh = useCallback(async () => {
    const result = await list()
    if (!result.ok) { setError(result.error.message); return }
    setError(null)
    setNodes(result.value)
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

  const handleRename = useCallback(async () => {
    if (editing === null) return
    const title = editing.draft.trim()
    if (title.length === 0) { setEditing(null); return }
    const ok = await run(() => rename(editing.id, title))
    if (ok) setEditing(null)
  }, [editing, rename, run])

  const handleRemove = useCallback(async (id: SessionNodeId) => {
    await run(() => remove(id))
  }, [remove, run])

  const handleFork = useCallback(async (id: SessionNodeId) => {
    await run(() => fork(id))
  }, [fork, run])

  const title = t('section.title')

  if (!wide) {
    return (
      <Tooltip label={title} portal>
        <button
          type="button"
          className={css.sectionRailButton}
          aria-label={title}
          onClick={() => { expandSidebar() }}
          data-session-node-section
        >
          <IconPinOutlineRegular size={18} />
        </button>
      </Tooltip>
    )
  }

  return (
    <div className={css.section} data-session-node-section>
      <button
        type="button"
        className={css.sectionHeader}
        aria-expanded={expanded}
        onClick={() => { setExpanded(current => !current) }}
      >
        <IconTriangleRightFillRegular className={clsx(css.sectionArrow, expanded && css.sectionArrowOpen)} />
        <span className={css.sectionMark} aria-hidden="true"><IconPinOutlineRegular size={16} /></span>
        <span className={css.sectionTitle}>{title}</span>
      </button>
      {expanded && (
        <div className={css.sectionList}>
          {error !== null && <span role="alert" className={css.sectionError}>{error}</span>}
          {nodes !== null && visible.length === 0 && error === null && (
            <div className={css.sectionEmpty}>{t('section.empty')}</div>
          )}
          {visible.map(node => (
            editing?.id === node.id ? (
              <InlineEditor
                key={node.id}
                value={editing.draft}
                label={t('section.rename')}
                onChange={(draft) => { setEditing({ id: node.id, draft }) }}
                onSave={() => { void handleRename() }}
                onCancel={() => { setEditing(null) }}
                className={clsx(css.sectionEditor)}
              />
            ) : (
              <div key={node.id} className={css.sectionRow} data-node-id={node.id}>
                <Tooltip label={t('section.fork')} side="bottom" delayMs={500}>
                  <button
                    type="button"
                    className={css.sectionRowOpen}
                    disabled={busy}
                    aria-label={node.title}
                    onClick={() => { void handleFork(node.id) }}
                  >
                    <span className={css.sectionRowTitle}>{node.title}</span>
                  </button>
                </Tooltip>
                <span className={css.sectionRowActions}>
                  <Tooltip label={t('section.rename')} side="bottom">
                    <button
                      type="button"
                      className={css.sectionAction}
                      aria-label={t('section.rename')}
                      disabled={busy}
                      onClick={() => { setEditing({ id: node.id, draft: node.title }) }}
                    >
                      <IconEditOutlineRegular />
                    </button>
                  </Tooltip>
                  <Tooltip label={t('section.delete')} side="bottom">
                    <button
                      type="button"
                      className={clsx(css.sectionAction, css.sectionActionDanger)}
                      aria-label={t('section.delete')}
                      disabled={busy}
                      onClick={() => { void handleRemove(node.id) }}
                    >
                      <IconTrashOutlineRegular />
                    </button>
                  </Tooltip>
                </span>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}
