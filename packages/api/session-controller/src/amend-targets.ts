/**
 * Amend-target resolution over the complete durable Session: the ordered
 * surface node seqs plus every human-authored user message, so the amend
 * command reads projected state instead of synchronously scanning history.
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { brandNumber, brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'

/** One amendable message: its surface node and chain-root identity. */
export interface AmendTarget {
  /** Surface node seq of the message's current occurrence. */
  readonly seq: SessionSeq
  /** Chain-root human message identity a revision of this message reports. */
  readonly root: MessageId
}

/** Folded amend facts: ordered surface nodes and amendable messages by identity. */
export interface AmendTargetsState {
  /** Ordered surface node seqs, mirroring the surface fold transitions. */
  readonly nodes: readonly SessionSeq[]
  /** Human-authored user messages keyed by message identity (plain JSON for checkpoints). */
  readonly targets: Readonly<Record<string, AmendTarget>>
}

const seqSchema = z.number().int().nonnegative().transform(brandNumber<SessionSeq>)
const targetSchema = z.object({
  seq: seqSchema,
  root: z.string().transform(brandString<MessageId>),
}).readonly()
const stateSchema = z.object({
  nodes: z.array(seqSchema).readonly(),
  targets: z.record(z.string(), targetSchema).readonly(),
}).readonly()

/** Whether one event's source names a human-authored user message. */
function humanTargetOf(event: SessionEvent<'user/message'>): AmendTarget | undefined {
  const source = event.data.source
  if (source.kind === 'user') return { seq: event.seq, root: event.data.id }
  // A second amendment revises the first's message but reports the chain root.
  if (source.kind === 'amend') return { seq: event.seq, root: source.revises }
  return undefined
}

/** Whether one event type joins the ordered surface. */
function surfaceOpOf(event: SessionEvent): SessionEvent['surfaceOp'] | undefined {
  switch (event.type) {
    case 'system/message':
    case 'developer/message':
    case 'user/message':
    case 'assistant/message':
    case 'tool/result':
      return event.surfaceOp
    default:
      return undefined
  }
}

/**
 * Host-only amend-target projection. The node list follows the same
 * append/replace transitions as the canonical surface fold; a replacement
 * deletes every target whose node it shadowed and records its own occurrence.
 */
export const amendTargetsProjectionDefinition = {
  key: 'amendTargets',
  stateVersion: 1,
  stateSchema,
  init: (): AmendTargetsState => ({ nodes: [], targets: {} }),
  apply: (state: AmendTargetsState, event: SessionEvent): AmendTargetsState => {
    const op = surfaceOpOf(event)
    if (op === undefined) return state
    if (op === 'append') {
      if (event.type !== 'user/message') return { nodes: [...state.nodes, event.seq], targets: state.targets }
      const target = humanTargetOf(event)
      if (target === undefined) return { nodes: [...state.nodes, event.seq], targets: state.targets }
      return {
        nodes: [...state.nodes, event.seq],
        targets: { ...state.targets, [event.data.id]: target },
      }
    }
    const startIdx = state.nodes.indexOf(op.startSeq)
    const endIdx = state.nodes.indexOf(op.endSeq)
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
      throw new Error(`invalid surface replacement at seq ${event.seq}`)
    }
    const shadowed = new Set(state.nodes.slice(startIdx, endIdx + 1))
    const nodes = state.nodes.toSpliced(startIdx, endIdx - startIdx + 1, event.seq)
    let targets = state.targets
    for (const [id, target] of Object.entries(state.targets)) {
      if (!shadowed.has(target.seq)) continue
      const { [id]: _shadowed, ...rest } = targets
      targets = rest
    }
    if (event.type === 'user/message') {
      const target = humanTargetOf(event)
      if (target !== undefined) targets = { ...targets, [event.data.id]: target }
    }
    return { nodes, targets }
  },
} satisfies ProjectionDefinition<'amendTargets', AmendTargetsState>
