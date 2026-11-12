// @vitest-environment jsdom
/** SessionNodeSection behavior: toggle, fork, rename, delete, workspace scoping, empty/error states, and the rail control. */

import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate, workspaceSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionNode, SessionNodeId } from '@deepseek-ai/dsh-session-node/client'
import { SessionNodeSection } from '../src/client/SessionNodeSection.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const CURRENT = brandString<SessionId>('session-current')

/** A registry-revision observable the section's hook share reads through React's subscription. */
function revisionSource() {
  let value = 0
  const listeners = new Set<() => void>()
  const getSnapshot = (): number => value
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  return {
    useNodeRevision: <T,>(selector: (value: number) => T): T =>
      selector(useSyncExternalStore(subscribe, getSnapshot)),
    bump: () => {
      value += 1
      for (const listener of [...listeners]) listener()
    },
  }
}

function node(id: string, title: string, workspaceId?: string): SessionNode {
  return {
    id: brandString<SessionNodeId>(id),
    sessionId: brandString<SessionId>('session-one'),
    atSeq: 2,
    ...(workspaceId === undefined ? {} : { workspaceId: brandString<WorkspaceId>(workspaceId) }),
    title,
    createdAt: 0,
  }
}

const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value })
const fail = (message: string): RemoteResult<never> => ({ ok: false, error: new RemoteError('gateway/internal', message, {}) })

/** Verbs over a mutable in-memory registry; mutations bump the revision like the plugin wrapper. */
function registry(initial: SessionNode[]) {
  let nodes = [...initial]
  const source = revisionSource()
  const verbs = {
    list: vi.fn(async (): Promise<RemoteResult<SessionNode[]>> => ok([...nodes])),
    fork: vi.fn(async (id: SessionNodeId): Promise<RemoteResult<{ sessionId: SessionId }>> => {
      if (nodes.every(entry => entry.id !== id)) return fail('node gone')
      return ok({ sessionId: brandString<SessionId>('session-child') })
    }),
    remove: vi.fn(async (id: SessionNodeId): Promise<RemoteResult<boolean>> => {
      nodes = nodes.filter(entry => entry.id !== id)
      source.bump()
      return ok(true)
    }),
    rename: vi.fn(async (id: SessionNodeId, title: string): Promise<RemoteResult<SessionNode>> => {
      nodes = nodes.map(entry => entry.id === id ? { ...entry, title } : entry)
      source.bump()
      return ok({ ...nodes.find(entry => entry.id === id)! })
    }),
  }
  return { verbs, source }
}

type SessionsSnapshot = Parameters<Parameters<GlobalStandardProps['useSessions']>[0]>[0]
type PanelInfoSnapshot = Parameters<Parameters<GlobalStandardProps['usePanelInfo']>[0]>[0]

/**
 * Root-scope workspace context: the main-view session's workspace, mirroring
 * the derivation the sidebar's own surfaces use. `currentSessionId` omitted
 * (or `panelActive`) models no open conversation.
 */
function scopeHooks({
  currentSessionId, panelActive = false, workspaceId,
}: { currentSessionId?: SessionId; panelActive?: boolean; workspaceId?: string } = {}) {
  const sessions: SessionsSnapshot = currentSessionId === undefined
    ? { ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }
    : {
      ids: [currentSessionId],
      byId: {
        [currentSessionId]: {
          id: currentSessionId,
          displayTitle: 'current',
          running: false,
          blank: false,
          updatedAt: 0,
          retainedBy: { mainView: 1 },
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    }
  const workspaces = {
    ...workspaceSnapshot(),
    items: currentSessionId === undefined || workspaceId === undefined
      ? []
      : [{
        workspaceId: brandString<WorkspaceId>(workspaceId),
        path: '/tmp/current',
        title: 'Current',
        sessionIds: [currentSessionId],
        createdAt: '',
        updatedAt: '',
      }],
  }
  const panelInfo: PanelInfoSnapshot = {
    activePanelId: panelActive ? brandString<NonNullable<PanelInfoSnapshot['activePanelId']>>('settings') : null,
  }
  const useSessions: GlobalStandardProps['useSessions'] = selector => selector(sessions)
  const useWorkspaces: GlobalStandardProps['useWorkspaces'] = selector => selector(workspaces)
  const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector(panelInfo)
  return { useSessions, useWorkspaces, usePanelInfo }
}

function mount(verbs: ReturnType<typeof registry>['verbs'], source: ReturnType<typeof revisionSource>, {
  wide = true,
  expandSidebar = vi.fn(() => {}),
  scope = scopeHooks(),
}: {
  wide?: boolean
  expandSidebar?: () => void
  scope?: ReturnType<typeof scopeHooks>
} = {}) {
  return {
    expandSidebar,
    view: render(
      <SessionNodeSection
        wide={wide}
        expandSidebar={expandSidebar}
        t={t}
        list={verbs.list}
        fork={verbs.fork}
        remove={verbs.remove}
        rename={verbs.rename}
        useNodeRevision={source.useNodeRevision}
        useSessions={scope.useSessions}
        useWorkspaces={scope.useWorkspaces}
        usePanelInfo={scope.usePanelInfo}
      />,
    ),
  }
}

afterEach(cleanup)

describe('SessionNodeSection', () => {
  it('expands the header to list every saved node and forks on a row click', async () => {
    const { verbs, source } = registry([node('node-one', 'First cut'), node('node-two', 'Second cut')])
    mount(verbs, source)
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    const first = await screen.findByRole('button', { name: 'First cut' })
    expect(screen.getByRole('button', { name: 'Second cut' })).toBeTruthy()
    fireEvent.click(first)
    await waitFor(() => { expect(verbs.fork).toHaveBeenCalledWith(brandString<SessionNodeId>('node-one')) })
  })

  it('scopes the list to the main-view session\'s workspace', async () => {
    const { verbs, source } = registry([
      node('node-other', 'Theirs', 'ws-two'),
      node('node-mine', 'Mine', 'ws-one'),
      node('node-loose', 'Loose'),
    ])
    mount(verbs, source, { scope: scopeHooks({ currentSessionId: CURRENT, workspaceId: 'ws-one' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    expect(await screen.findByRole('button', { name: 'Mine' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Theirs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Loose' })).toBeNull()
  })

  it('shows only workspace-less nodes while no session is open or a panel covers the conversation', async () => {
    const { verbs, source } = registry([
      node('node-mine', 'Mine', 'ws-one'),
      node('node-loose', 'Loose'),
    ])
    const noSession = mount(verbs, source, { scope: scopeHooks() })
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    expect(await screen.findByRole('button', { name: 'Loose' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mine' })).toBeNull()
    noSession.view.unmount()

    mount(verbs, source, { scope: scopeHooks({ currentSessionId: CURRENT, workspaceId: 'ws-one', panelActive: true }) })
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    expect(await screen.findByRole('button', { name: 'Loose' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mine' })).toBeNull()
  })

  it('renames a node through the inline editor', async () => {
    const { verbs, source } = registry([node('node-one', 'First cut')])
    mount(verbs, source)
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rename node' }))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Rename node' })
    fireEvent.change(editor, { target: { value: '  Release cut  ' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => { expect(verbs.rename).toHaveBeenCalledWith(brandString<SessionNodeId>('node-one'), 'Release cut') })
    // The revision bump refreshes the row to the new title.
    await screen.findByRole('button', { name: 'Release cut' })
  })

  it('cancels an empty rename draft without calling the service', async () => {
    const { verbs, source } = registry([node('node-one', 'First cut')])
    mount(verbs, source)
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rename node' }))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Rename node' })
    fireEvent.change(editor, { target: { value: '   ' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await screen.findByRole('button', { name: 'First cut' })
    expect(verbs.rename).not.toHaveBeenCalled()
  })

  it('deletes a node from its row action and drops it from the list', async () => {
    const { verbs, source } = registry([node('node-one', 'First cut'), node('node-two', 'Second cut')])
    mount(verbs, source)
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    // Row actions address their own row; the first row's delete removes node-one.
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete node' }))[0]!)
    await waitFor(() => { expect(verbs.remove).toHaveBeenCalledWith(brandString<SessionNodeId>('node-one')) })
    await screen.findByRole('button', { name: 'Second cut' })
    expect(screen.queryByRole('button', { name: 'First cut' })).toBeNull()
  })

  it('shows the empty hint while the registry has no nodes', async () => {
    const { verbs, source } = registry([])
    mount(verbs, source)
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    expect(await screen.findByText('No saved nodes yet')).toBeTruthy()
  })

  it('reports a failed registry read without blanking the section', async () => {
    const { verbs, source } = registry([])
    verbs.list.mockResolvedValueOnce(fail('registry offline'))
    mount(verbs, source)
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('registry offline')
    expect(screen.getByRole('button', { name: 'Saved nodes' })).toBeTruthy()
  })

  it('renders the rail control that requests sidebar expansion', () => {
    const { verbs, source } = registry([node('node-one', 'First cut')])
    const { expandSidebar } = mount(verbs, source, { wide: false })
    fireEvent.click(screen.getByRole('button', { name: 'Saved nodes' }))
    expect(expandSidebar).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'First cut' })).toBeNull()
  })
})
