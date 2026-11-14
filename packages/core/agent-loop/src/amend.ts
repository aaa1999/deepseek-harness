/**
 * Durable admission shape for an amended user message: queued input whose
 * claim lands as a surface replacement of an earlier sent message's range.
 * The session-controller admits the amended text and resolved range; the
 * loop owns the landing at claim time.
 *
 * @module dsh-agent-loop/amend
 */

import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionSeq, SurfaceIntent, UserMessage } from '@deepseek-ai/dsh-session'

/** Source of a user message that revises an earlier sent message on the surface. */
export interface AmendMessageSource {
  readonly kind: 'amend'
  /**
   * Identity of the chain-root human message this revision replaces. A second
   * amendment of an amended message reports the same root as the first, so
   * clients correlate every revision with one message bubble.
   */
  readonly revises: MessageId
  /** First shadowed surface node seq: the revised message's own node. */
  readonly startSeq: SessionSeq
  /**
   * Last shadowed surface node seq at admission. Equals {@link startSeq} for a
   * paused-in-place revision; a rerun revision extends through the surface tail.
   */
  readonly endSeq: SessionSeq
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    amend: AmendMessageSource
  }
}

/**
 * Resolve the surface placement for one admitted input: an amend message
 * replaces its recorded range and cites every current node it shadows; every
 * other message appends.
 * @param session - session whose current surface supplies the shadowed nodes.
 * @param message - claimed input about to land as a `user/message` event.
 * @returns the append intent, or the replacement intent for amend input.
 * @throws when an amend range no longer names a current surface range.
 */
export function admittedSurfaceIntent(session: Session, message: UserMessage): SurfaceIntent<'user/message'> {
  if (message.source.kind !== 'amend') return { surfaceOp: 'append' }
  const { startSeq, endSeq } = message.source
  const nodes = session.surface.nodes
  const startIdx = nodes.indexOf(startSeq)
  const endIdx = startIdx === -1 ? -1 : nodes.indexOf(endSeq)
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    throw new Error(`amend range ${String(startSeq)}..${String(endSeq)} is not a current surface range`)
  }
  return {
    surfaceOp: { op: 'replace', startSeq, endSeq },
    sourceEventSeqs: [...nodes.slice(startIdx, endIdx + 1)],
  }
}
