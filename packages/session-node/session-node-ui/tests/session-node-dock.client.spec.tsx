// @vitest-environment jsdom
/** SessionNodeDock behavior: workspace-scoped chip menu, scoped selection and fork target, save, and empty state. */

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
import type { SessionNode, SessionNodeId } from 'dsh-session-node/client'
import { SessionNodeDock } from '../src/client/SessionNodeDock.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const DOCK = brandString<SessionId>('session-dock')

/** A registry-revision observable the dock's hook share reads through React's subscription. */
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
    sessionId: brandString<SessionId>('session-dock'),
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
    save: vi.fn(async (): Promise<RemoteResult<SessionNode>> => ok(nodes[0] ?? node('node-new', 'New'))),
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
  }
  return { verbs, source }
}

/** Workspaces feed: the dock session's owning workspace, or none. */
function useWorkspacesOf(workspaceId?: string): GlobalStandardProps['useWorkspaces'] {
  const snapshot = {
    ...workspaceSnapshot(),
    items: workspaceId === undefined
      ? []
      : [{
        workspaceId: brandString<WorkspaceId>(workspaceId),
        path: '/tmp/dock',
        title: 'Dock workspace',
        sessionIds: [DOCK],
        createdAt: '',
        updatedAt: '',
      }],
  }
  return selector => selector(snapshot)
}

// The dock reads only the session identity from the slot's runtime share.
function mount(verbs: ReturnType<typeof registry>['verbs'], source: ReturnType<typeof revisionSource>, useWorkspaces: GlobalStandardProps['useWorkspaces']) {
  return render(
    <SessionNodeDock
      t={t}
      sessionId={DOCK}
      save={verbs.save}
      list={verbs.list}
      fork={verbs.fork}
      remove={verbs.remove}
      useNodeRevision={source.useNodeRevision}
      useWorkspaces={useWorkspaces}
    />,
  )
}

afterEach(cleanup)

describe('SessionNodeDock', () => {
  it('scopes the chip to the dock session\'s workspace and forks the first scoped node', async () => {
    const { verbs, source } = registry([
      node('node-other', 'Theirs', 'ws-two'),
      node('node-mine', 'Mine', 'ws-one'),
    ])
    mount(verbs, source, useWorkspacesOf('ws-one'))
    // The scoped fallback picks Mine over the registry-first node of another workspace.
    const chip = await screen.findByRole('button', { name: 'Saved nodes' })
    await waitFor(() => { expect(chip.textContent).toContain('Mine') })
    expect(chip.textContent).not.toContain('Theirs')
    fireEvent.click(screen.getByRole('button', { name: 'Fork a new session from this node' }))
    await waitFor(() => { expect(verbs.fork).toHaveBeenCalledWith(brandString<SessionNodeId>('node-mine')) })
  })

  it('falls back to workspace-less nodes while the session belongs to no workspace', async () => {
    const { verbs, source } = registry([
      node('node-mine', 'Mine', 'ws-one'),
      node('node-loose', 'Loose'),
    ])
    mount(verbs, source, useWorkspacesOf(undefined))
    const chip = await screen.findByRole('button', { name: 'Saved nodes' })
    await waitFor(() => { expect(chip.textContent).toContain('Loose') })
    expect(chip.textContent).not.toContain('Mine')
    fireEvent.click(screen.getByRole('button', { name: 'Fork a new session from this node' }))
    await waitFor(() => { expect(verbs.fork).toHaveBeenCalledWith(brandString<SessionNodeId>('node-loose')) })
  })

  it('disables addressing while the scope holds no nodes and still saves', async () => {
    const { verbs, source } = registry([node('node-mine', 'Mine', 'ws-one')])
    mount(verbs, source, useWorkspacesOf('ws-two'))
    const chip = await screen.findByRole<HTMLButtonElement>('button', { name: 'Saved nodes' })
    await waitFor(() => { expect(chip.textContent).toContain('No nodes yet') })
    expect(chip.disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Fork a new session from this node' }).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fresh cut' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(verbs.save).toHaveBeenCalled() })
  })
})
