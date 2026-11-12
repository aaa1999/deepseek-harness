/**
 * SessionNode surface plugin, browser half. Four entries over one generated
 * Remote: the sidebar saved-node manager (`sidebar.sections`), the per-turn
 * bookmark (`conversation.chat.turnTail`), the composer dock strip
 * (`conversation.input.dock`), and the New Session picker that forks the
 * staged session from a saved node of its workspace
 * (`conversation.hero.options`). Forking opens the child session through
 * `ctx.uiWorkspace`.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import sessionNodesRemote from '@deepseek-ai/dsh-session-node/remote'
import type { SessionNodeId } from '@deepseek-ai/dsh-session-node/client'
import { HeroNodePicker } from './HeroNodePicker.tsx'
import { SaveTurnNodeButton } from './SaveTurnNodeButton.tsx'
import { SessionNodeDock } from './SessionNodeDock.tsx'
import { SessionNodeSection } from './SessionNodeSection.tsx'
import { en, zh } from './locales.ts'
import type { SessionNodeSave } from './slots.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'sessionNodes'

/**
 * Minimal getSnapshot/subscribe revision counter for the dock's hooks
 * compartment; a full snapshot store would drag the zustand engine into the
 * bundle for one number.
 * @returns the observable plus its `bump` trigger.
 */
function createNodeRevision(): HostObservable<number> & { bump: () => void } {
  let value = 0
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    bump: () => {
      value += 1
      for (const fn of [...listeners]) fn()
    },
  }
}

export const inject = ['remote', 'slots', 'locale', 'uiWorkspace']

/**
 * Register the four surfaces in a scope that resolves the mounted
 * `remote.sessionNodes` namespace.
 * @param scope - scoped Context created after the namespace mounted.
 */
function registerSurfaces(scope: ClientContext): void {
  const nodes = scope.remote.sessionNodes
  const nodeRevision = createNodeRevision()
  scope.effect(() => scope.locale.register(NS, { zh, en }), 'session-node-ui: dictionaries')

  const saveFor = (sessionId: SessionId): SessionNodeSave => (title, atSeq) =>
    nodes.save({
      sessionId,
      ...(title === undefined ? {} : { title }),
      ...(atSeq === undefined ? {} : { atSeq }),
    }).then((result) => {
      if (result.ok) nodeRevision.bump()
      return result
    })

  const forkAndOpen = (nodeId: SessionNodeId) =>
    nodes.fork(nodeId).then((result) => {
      if (result.ok) scope.uiWorkspace.openSession(result.value.sessionId)
      return result
    })

  const removeAndBump = (nodeId: SessionNodeId) =>
    nodes.delete(nodeId).then((result) => {
      if (result.ok) nodeRevision.bump()
      return result
    })

  const renameAndBump = (nodeId: SessionNodeId, title: string) =>
    nodes.rename(nodeId, title).then((result) => {
      if (result.ok) nodeRevision.bump()
      return result
    })

  scope.slots.inject('sidebar.sections', () => scope.slots.register({
    name: 'sidebar.sections',
    id: 'session-nodes-section',
    order: 10,
    locale: NS,
    inject: () => ({
      list: () => nodes.list(),
      fork: forkAndOpen,
      remove: removeAndBump,
      rename: renameAndBump,
      hooks: { nodeRevision },
    }),
  }, SessionNodeSection))

  scope.slots.inject('conversation.chat.assistant-actions', () => scope.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'session-node-turn-save',
    locale: NS,
    inject: (sessionId): { save: SessionNodeSave } => ({ save: saveFor(sessionId) }),
  }, SaveTurnNodeButton))

  scope.slots.inject('conversation.hero.options', () => scope.slots.register({
    name: 'conversation.hero.options',
    id: 'session-node-new-from-node',
    order: 10,
    locale: NS,
    inject: () => ({
      list: () => nodes.list(),
      fork: forkAndOpen,
    }),
  }, HeroNodePicker))

  scope.slots.inject('conversation.input.dock', () => scope.slots.register({
    name: 'conversation.input.dock',
    id: 'session-nodes',
    order: 20,
    locale: NS,
    inject: sessionId => ({
      save: saveFor(sessionId),
      list: () => nodes.list(),
      fork: forkAndOpen,
      remove: removeAndBump,
      hooks: { nodeRevision },
    }),
  }, SessionNodeDock))
}

/**
 * Mount the generated Remote namespace, then the surfaces in a scope that may
 * resolve it.
 * @param ctx - client root context.
 * @returns disposer joining surface and Remote withdrawal.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(sessionNodesRemote)
  const surfaces = ctx.inject(['remote.sessionNodes', 'slots', 'locale', 'uiWorkspace'], registerSurfaces)
  try { await surfaces } catch (error) { await surfaces.dispose(); await disposeRemote(); throw error }
  return async () => { await surfaces.dispose(); await disposeRemote() }
}
