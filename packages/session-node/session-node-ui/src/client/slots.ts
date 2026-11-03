/**
 * Injected business faces of the session-node entries: the verbs the dock
 * strip, the per-turn save action, and the New Session picker render, each
 * returning the generated Remote result.
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

/** Action verbs carried into the dock strip by the registrant. */
export interface SessionNodeDockActions {
  /** Save the current session's latest completed node, or the given boundary. */
  save: SessionNodeSave
  /** List every saved node. */
  list: () => Promise<RemoteResult<SessionNode[]>>
  /**
   * Fork a new session from a saved node; the registrant opens the child
   * session after a successful fork.
   */
  fork: (nodeId: SessionNodeId) => Promise<RemoteResult<ForkNodeResult>>
  /** Delete a saved node. */
  remove: (nodeId: SessionNodeId) => Promise<RemoteResult<boolean>>
  /** Observables the renderer binds into selector hooks; see {@link SessionNodeDockInjected}. */
  hooks: {
    /**
     * Revision of the global node registry; the registrant bumps it after
     * every successful save or delete from any surface, so the dock can
     * refresh its list after a per-turn pin save.
     */
    nodeRevision: HostObservable<number>
  }
}

/** The injected face of the `conversation.input.dock` entry. */
export type SessionNodeDockInjected = SessionNodeDockActions

/** The injected face of the per-turn `conversation.chat.turnTail` save action. */
export interface SessionNodeTurnSaveInjected {
  /** Save the current session's node at an explicit boundary. */
  save: SessionNodeSave
}

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
