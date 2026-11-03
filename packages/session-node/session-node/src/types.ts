/**
 * Pure, host-safe types of the session-node domain.
 *
 * These types are free of host-side imports (cordis, dsh-agent, storage), so
 * a future client half can re-export them without pulling the host program
 * into the browser bundle.
 *
 * @module dsh-session-node/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies one saved session history node. */
export type SessionNodeId = Branded<'SessionNodeId'>

/**
 * One saved session history node: a fork source captured as a source session
 * plus an inclusive event-sequence boundary.
 */
export interface SessionNode {
  /** Stable node identity. */
  readonly id: SessionNodeId
  /** Source session the node was saved from. */
  readonly sessionId: SessionId
  /** Inclusive event seq boundary of the saved prefix. */
  readonly atSeq: number
  /** Workspace (project) id the source session belongs to, when resolved. */
  readonly workspaceId?: string
  /** Human label. */
  readonly title: string
  /** Optional free-form note. */
  readonly note?: string
  /** Epoch milliseconds at save time. */
  readonly createdAt: number
}

/** Input for saving a node. */
export interface SaveNodeInput {
  /** Source session to capture. */
  readonly sessionId: SessionId
  /** Human label; defaults to a timestamp-derived title. */
  readonly title?: string
  /** Exact inclusive boundary; defaults to the latest completed-turn prefix. */
  readonly atSeq?: number
  /** Optional free-form note. */
  readonly note?: string
}

/** Result of forking a new session from a saved node. */
export interface ForkNodeResult {
  /** The new (forked) session identity. */
  readonly sessionId: SessionId
}
