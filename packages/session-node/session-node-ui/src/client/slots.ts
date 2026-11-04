/**
 * Injected business faces of the session-node entries: the verbs the sidebar
 * section, the dock strip, the per-turn save action, and the New Session
 * picker render, each returning the generated Remote result.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ForkNodeResult, SessionNode, SessionNodeId } from 'dsh-session-node/client'

/** The save verb shared by the dock (latest turn, optional title) and the per-turn action. */
export interface SessionNodeSave {
  /**
   * Save a node of the current session.
   * @param title - optional label; the caller-derived default when omitted.
   * @param atSeq - inclusive boundary seq; the latest completed-turn prefix when omitted.
   */
  (title?: string, atSeq?: number): Promise<RemoteResult<SessionNode>>
}

/** Registry verbs shared by every node-addressing surface; each returns the generated Remote result. */
export interface SessionNodeRegistryVerbs {
  /** List every saved node. */
  list: () => Promise<RemoteResult<SessionNode[]>>
  /**
   * Fork a new session from a saved node; the registrant opens the child
   * session after a successful fork.
   */
  fork: (nodeId: SessionNodeId) => Promise<RemoteResult<ForkNodeResult>>
  /** Delete one saved node. */
  remove: (nodeId: SessionNodeId) => Promise<RemoteResult<boolean>>
}

/** Action verbs carried into the dock strip by the registrant. */
export interface SessionNodeDockActions extends SessionNodeRegistryVerbs {
  /** Save the current session's latest completed node, or the given boundary. */
  save: SessionNodeSave
  /** Observables the renderer binds into selector hooks; see {@link SessionNodeSectionInjected}. */
  hooks: {
    /**
     * Revision of the global node registry; the registrant bumps it after
     * every successful save, rename, or delete from any surface, so every
     * registry surface refreshes after a change made elsewhere.
     */
    nodeRevision: HostObservable<number>
  }
}

/** The injected face of the per-turn `conversation.chat.turnTail` save action. */
export interface SessionNodeTurnSaveInjected {
  /** Save the current session's node at an explicit boundary. */
  save: SessionNodeSave
}

/** The injected face of the `sidebar.sections` saved-node manager block. */
export interface SessionNodeSectionInjected extends SessionNodeRegistryVerbs {
  /**
   * Rename one saved node.
   * @param nodeId - node identity.
   * @param title - new label; the service trims and rejects an empty one.
   */
  rename: (nodeId: SessionNodeId, title: string) => Promise<RemoteResult<SessionNode>>
  /** Observables the renderer binds into selector hooks; see {@link SessionNodeDockActions}. */
  hooks: SessionNodeDockActions['hooks']
}

/** The injected face of the `conversation.input.dock` entry. */
export type SessionNodeDockInjected = SessionNodeDockActions

/** The injected face of the `conversation.hero.options` New Session picker. */
export interface HeroNodePickerInjected {
  /** List every saved node; the picker filters to the current workspace. */
  list: () => Promise<RemoteResult<SessionNode[]>>
  /**
   * Fork a new session from a saved node; the registrant opens the child
   * session after a successful fork.
   */
  fork: (nodeId: SessionNodeId) => Promise<RemoteResult<ForkNodeResult>>
}
