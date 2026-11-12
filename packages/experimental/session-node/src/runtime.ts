/**
 * Runtime helpers shared by the service and the command plugin.
 *
 * Kept as its own module so both the host service bundle and the command
 * bundle import ONE copy of the error class and the id constructor (a single
 * `instanceof` identity across the two plugin rows).
 *
 * @module @deepseek-ai/dsh-session-node
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionNodeId } from './types.ts'

/** Mint a new session-node id. */
export function newSessionNodeId(): SessionNodeId {
  return brandString<SessionNodeId>(`node-${randomUUID()}`)
}

/** Stable error codes for rejected session-node operations. */
export type SessionNodeErrorCode =
  | 'SESSION_NODE_SESSION_NOT_FOUND'
  | 'SESSION_NODE_SESSION_UNAVAILABLE'
  | 'SESSION_NODE_INVALID_BOUNDARY'
  | 'SESSION_NODE_INVALID_INPUT'
  | 'SESSION_NODE_NOT_FOUND'
  | 'SESSION_NODE_STALE'
  | 'SESSION_NODE_FORK_FAILED'

/** Domain error for rejected session-node operations. */
export class SessionNodeError extends Error {
  readonly code: SessionNodeErrorCode

  constructor(message: string, code: SessionNodeErrorCode) {
    super(message)
    this.name = 'SessionNodeError'
    this.code = code
  }
}
