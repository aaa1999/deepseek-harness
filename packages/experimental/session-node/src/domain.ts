/**
 * Host-side vocabulary of the session-node domain: the durable storage-domain
 * declaration plus the record/state zod schemas.
 *
 * Saved nodes are GLOBAL registry state (they outlive any one session), so they
 * persist through the storage domain form rather than through a session event
 * log. The domain keeps one `nodes` table keyed by {@link SessionNodeId} plus a
 * `order` global array (most-recently-saved first).
 *
 * @module @deepseek-ai/dsh-session-node
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionNodeId } from './types.ts'

const nodeIdSchema = z.string().transform(value => value as SessionNodeId)
const sessionIdSchema = z.string().transform(value => brandString<SessionId>(value))

/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceIdSchema = z.string().transform(value => brandString<WorkspaceId>(value))

/** Durable shape of one saved node record. */
export const sessionNodeRecord = z.object({
  sessionId: sessionIdSchema,
  atSeq: z.number().int().nonnegative(),
  workspaceId: workspaceIdSchema.optional(),
  title: z.string(),
  note: z.string().optional(),
  createdAt: z.number(),
})

/** One stored node record, inferred from {@link sessionNodeRecord}. */
export type SessionNodeRecord = z.infer<typeof sessionNodeRecord>

/** Durable registry state: the ordered list of node ids, newest first. */
export const sessionNodeDomainState = z.object({
  order: z.array(nodeIdSchema),
})

/** Durable registry state inferred from {@link sessionNodeDomainState}. */
export type SessionNodeDomainState = z.infer<typeof sessionNodeDomainState>

/**
 * The session-node domain spec. The registry opens this through
 * `ctx.storageDomain`; the spec object is the single source of the domain's
 * identity, version, and schemas.
 */
export const sessionNodeDomainSpec = defineDomain({
  name: 'session_nodes',
  version: 1,
  global: {
    schema: sessionNodeDomainState,
    initial: { order: [] },
  },
  tables: {
    nodes: domainTable<SessionNodeId, SessionNodeRecord>(sessionNodeRecord),
  },
})
