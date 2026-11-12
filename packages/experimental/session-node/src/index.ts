/**
 * Same-profile session history-node domain: persist a session's history node
 * (a fork source: session + inclusive boundary) and fork a new session from it
 * later — under the same project (workspace).
 *
 * The service is a plain Cordis `Service` exposed as `ctx.sessionNodes`; the
 * accompanying `@deepseek-ai/dsh-session-node/commands` plugin turns it into the
 * `/save-node`, `/nodes`, `/fork-node`, `/rename-node`, and `/delete-node`
 * human commands.
 *
 * @module @deepseek-ai/dsh-session-node
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { sessionNodeDomainSpec } from './domain.ts'
import type { SessionNodeDomainState, SessionNodeRecord } from './domain.ts'
import { newSessionNodeId, SessionNodeError } from './runtime.ts'
import type { ForkNodeResult, SaveNodeInput, SessionNode, SessionNodeId } from './types.ts'

export type * from './types.ts'
export { SessionNodeError } from './runtime.ts'
export type { SessionNodeErrorCode } from './runtime.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionNodes: SessionNodeService
  }
}

/** Composition of one Agent: optional preset plus the model-selection setup. */
interface AgentComposition {
  readonly agentPreset?: string
  readonly setup: AgentSetup
}

/** Minimal structural view of the optional agent-preset service. */
interface AgentPresetsService {
  resolve(id?: string): Promise<{ id: string }>
  mount(ctx: Context, id?: string): Promise<unknown>
}


/** Validate a caller-supplied boundary seq, rethrowing as a domain error. */
function resolveAtSeq(value: number | undefined): SessionSeq | undefined {
  if (value === undefined) return undefined
  try {
    return SessionSeq(value)
  } catch {
    throw new SessionNodeError('atSeq must be a non-negative safe integer', 'SESSION_NODE_INVALID_INPUT')
  }
}

/**
 * Resolve the omitted-boundary default to the latest completed-turn prefix,
 * including standalone events before the next turn begins. Mirrors the
 * session-controller's fork default so a saved node is always a stable
 * between-turn position.
 */
function latestCompletedPrefixBoundary(events: readonly SessionEvent[]): SessionSeq | undefined {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append')) break
    boundary = next.seq
  }
  return SessionSeq(boundary)
}

/**
 * Global saved-node registry (`ctx.sessionNodes`). Startup opens the durable
 * storage domain and rebuilds the in-memory cache; all reads are synchronous
 * from that cache and every mutation persists through the domain write chain.
 *
 * The service is also the Remote owner: the `@Remote` methods below export the
 * `ctx.remote.sessionNodes` namespace for GUI clients, while the same methods
 * remain directly callable by host plugins (the `/save-node` command plugin
 * calls them in-process).
 */
export class SessionNodeService extends TypertRemoteService {
  static inject = ['storageDomain', 'agents', 'sessionQuery', 'workspaceRegistry']

  private table?: KvTable<SessionNodeId, SessionNodeRecord>
  private global?: DomainGlobal<SessionNodeDomainState>
  private readonly cache = new Map<SessionNodeId, SessionNode>()

  constructor(ctx: Context) {
    super(ctx, 'sessionNodes')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sessionNodeDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'session-node.domainClose')
    this.table = domain.table('nodes')
    this.global = domain.global
    this.rebuildCache()
  }

  /**
   * Save one history node of a session under its project (workspace).
   * @param input - source session, optional title/note, and optional exact boundary.
   * @returns the created node.
   */
  @Remote('save')
  async save(input: SaveNodeInput): Promise<SessionNode> {
    const title = input.title !== undefined && input.title.trim().length > 0
      ? input.title.trim()
      : `node-${Date.now()}`
    const requested = resolveAtSeq(input.atSeq)
    using observed = await this.observe(input.sessionId)
    const boundary = requested ?? latestCompletedPrefixBoundary(observed.events)
    if (boundary === undefined || observed.events[boundary]?.seq !== boundary) {
      throw new SessionNodeError(
        `session "${input.sessionId}" has no completed turn to save from`,
        'SESSION_NODE_INVALID_BOUNDARY',
      )
    }
    const workspaceId = (await this.workspaceFor(observed.header))?.id
    const id = newSessionNodeId()
    const record: SessionNodeRecord = {
      sessionId: input.sessionId,
      atSeq: boundary,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      title,
      ...(input.note === undefined ? {} : { note: input.note }),
      createdAt: Date.now(),
    }
    await this.requireTable().put(id, record)
    const state = this.requireGlobal().get()
    await this.requireGlobal().set({ order: [id, ...state.order.filter(existing => existing !== id)] })
    const node = this.toNode(id, record)
    this.cache.set(id, node)
    return node
  }

  /** List every saved node in durable order (most recently saved first). */
  @Remote('list')
  list(): SessionNode[] {
    const order = this.requireGlobal().get().order
    const result: SessionNode[] = []
    for (const id of order) {
      const node = this.cache.get(id)
      if (node !== undefined) result.push(node)
    }
    return result
  }

  /**
   * Delete one saved node. Idempotent: an unknown id resolves `false`.
   * The wire export is `delete`: `remove` is reserved by the client's
   * Remote namespace service.
   * @param id - node identity.
   * @returns `true` when a record was deleted.
   */
  @Remote('delete')
  async remove(id: SessionNodeId): Promise<boolean> {
    const removed = await this.requireTable().delete(id)
    if (removed) {
      const state = this.requireGlobal().get()
      await this.requireGlobal().set({ order: state.order.filter(existing => existing !== id) })
      this.cache.delete(id)
    }
    return removed
  }

  /**
   * Rename one saved node.
   * @param id - node identity.
   * @param title - new label; trimmed, and rejected when it empties.
   * @returns the updated node.
   */
  @Remote('rename')
  async rename(id: SessionNodeId, title: string): Promise<SessionNode> {
    const label = title.trim()
    if (label.length === 0) {
      throw new SessionNodeError('title must be a non-empty string', 'SESSION_NODE_INVALID_INPUT')
    }
    const next: SessionNodeRecord = { ...this.requireRecord(id), title: label }
    await this.requireTable().put(id, next)
    const node = this.toNode(id, next)
    this.cache.set(id, node)
    return node
  }

  /**
   * Fork a new session from a saved node, attached to the source's workspace
   * (project). The child inherits the saved prefix exactly, with synthetic
   * closers for any open turn at the boundary.
   * @param id - node identity.
   * @returns the new forked session identity.
   */
  @Remote('fork')
  async fork(id: SessionNodeId): Promise<ForkNodeResult> {
    const node = this.cache.get(id) ?? this.toNode(id, this.requireRecord(id))
    using observed = await this.observe(node.sessionId)
    const boundary = SessionSeq(node.atSeq)
    if (observed.events[boundary]?.seq !== boundary) {
      throw new SessionNodeError(
        `saved boundary ${boundary} no longer exists in session "${node.sessionId}"`,
        'SESSION_NODE_STALE',
      )
    }
    const seed = buildForkSeed(observed.events, boundary)
    const workspace = await this.workspaceFor(observed.header)
    const childId = brandString<SessionId>(`session-${randomUUID()}`)
    const composition = await this.composeAgent(observed.header.agentPreset)
    const agentOptions = this.agentOptions()
    try {
      await this.ctx.agents.create({
        sessionId: childId,
        seed,
        inheritedEventCount: SessionLogOffset(boundary + 1),
        meta: {
          ...(observed.header.cwd === undefined ? {} : { cwd: observed.header.cwd }),
          isSeeded: true,
          ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
        },
        ...(agentOptions === undefined ? {} : { agentOptions }),
        setup: composition.setup,
      })
    } catch (error) {
      throw new SessionNodeError(
        `failed to fork from node "${id}": ${error instanceof Error ? error.message : String(error)}`,
        'SESSION_NODE_FORK_FAILED',
      )
    }
    if (workspace !== undefined) {
      await workspace.attachSession(childId)
    }
    return { sessionId: childId }
  }

  /** Read one session cold-safe, translating not-found into a domain error. */
  private async observe(sessionId: SessionId): Promise<SessionObservation> {
    try {
      return await this.ctx.sessionQuery.observeSession(sessionId)
    } catch (error) {
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new SessionNodeError(`session "${sessionId}" not found`, 'SESSION_NODE_SESSION_NOT_FOUND')
      }
      throw new SessionNodeError(
        `failed to read session "${sessionId}": ${error instanceof Error ? error.message : String(error)}`,
        'SESSION_NODE_SESSION_UNAVAILABLE',
      )
    }
  }

  /** Resolve the workspace (project) owning a session, by account then cwd. */
  private async workspaceFor(header: SessionHeader): Promise<Workspace | undefined> {
    const direct = this.ctx.workspaceRegistry.list()
      .find(workspace => workspace.sessionIds.includes(header.id))
    if (direct !== undefined) return direct
    if (header.cwd === undefined) return undefined
    return this.ctx.workspaceRegistry.resolveByPath(header.cwd)
  }

  /** Compose an Agent from a preset id, mirroring the session-controller. */
  private async composeAgent(presetId: string | undefined): Promise<AgentComposition> {
    const presets = this.ctx.get('agentPresets') as AgentPresetsService | undefined
    if (presets === undefined) {
      return { setup: (agentCtx) => { installModelSelection(agentCtx) } }
    }
    const resolvedId = (await presets.resolve(presetId)).id
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx) => {
        installModelSelection(agentCtx)
        await presets.mount(agentCtx, resolvedId)
      },
    }
  }

  /** Resolve the deployment default model selection, read lazily at start. */
  private agentOptions(): AgentOptions | undefined {
    const defaults = this.ctx.get('agentDefaultModel')
    if (defaults === undefined) return undefined
    return {
      get provider() { return defaults.currentSelection().provider },
      get model() { return defaults.currentSelection().model },
      get reasoningEffort() { return defaults.currentSelection().reasoningEffort },
    }
  }

  private requireTable(): KvTable<SessionNodeId, SessionNodeRecord> {
    if (this.table === undefined) throw new Error('session-node domain is not ready')
    return this.table
  }

  private requireGlobal(): DomainGlobal<SessionNodeDomainState> {
    if (this.global === undefined) throw new Error('session-node domain is not ready')
    return this.global
  }

  private requireRecord(id: SessionNodeId): SessionNodeRecord {
    const record = this.requireTable().get(id)
    if (record === undefined) {
      throw new SessionNodeError(`node "${id}" not found`, 'SESSION_NODE_NOT_FOUND')
    }
    return record
  }

  private toNode(id: SessionNodeId, record: SessionNodeRecord): SessionNode {
    return {
      id,
      sessionId: record.sessionId,
      atSeq: record.atSeq,
      ...(record.workspaceId === undefined ? {} : { workspaceId: record.workspaceId }),
      title: record.title,
      ...(record.note === undefined ? {} : { note: record.note }),
      createdAt: record.createdAt,
    }
  }

  private rebuildCache(): void {
    this.cache.clear()
    for (const [id, record] of this.requireTable().entries()) {
      this.cache.set(id, this.toNode(id, record))
    }
  }
}

export default SessionNodeService
