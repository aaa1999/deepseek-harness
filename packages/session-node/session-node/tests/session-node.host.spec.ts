/** SessionNodeService behavior over the durable domain: save, rename, remove, list, and workspace capture. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionId, SessionLogOffset, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import SessionNodeService from '../src/index.ts'
import { SessionNodeError } from '../src/runtime.ts'
import type { SessionNodeId } from '../src/types.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** One closed turn ending at seq 2: the smallest boundary a save can address. */
function closedTurnEvents(): readonly SessionEvent[] {
  return [
    { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
    { type: 'step/start', seq: SessionSeq(1), time: 0, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(2), time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

/** A cold observation stub: a header plus the events above, disposed as a no-op. */
function observation(sessionId: SessionId): SessionObservation {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 0,
    isSeeded: false,
  }
  const cut: SessionObservation = {
    source: 'prepared',
    header,
    inheritedEventCount: SessionLogOffset(0),
    events: closedTurnEvents(),
    cursor: SessionSeq(2),
    retain: () => cut,
    [Symbol.dispose]: () => {},
  }
  return cut
}

/**
 * Mount the service over an in-memory storage domain with stubbed peers.
 * @param workspaceRegistry - the registry face save consults for the session's workspace; defaults to resolving none.
 */
async function harness(
  workspaceRegistry: object = { list: () => [], resolveByPath: () => undefined },
): Promise<{ service: import('../src/index.ts').SessionNodeService; ctx: Context }> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('agents', {} as never)
  ctx.provide('sessionQuery', { observeSession: async (id: SessionId) => observation(id) } as never)
  ctx.provide('workspaceRegistry', workspaceRegistry as never)
  await ctx.plugin(SessionNodeService)
  return { service: ctx.sessionNodes, ctx }
}

type Service = import('../src/index.ts').SessionNodeService

/** Save one node of a fabricated session and return its identity. */
async function savedNode(service: Service, title: string) {
  return service.save({ sessionId: SessionId('session-spec'), title, atSeq: 2 })
}

describe('SessionNodeService', () => {
  it('captures the workspace owning the source session and projects it through list', async () => {
    const workspace = {
      id: WorkspaceId('ws-one'),
      sessionIds: [SessionId('session-spec')],
      attachSession: async () => {},
    }
    const { service } = await harness({ list: () => [workspace] })
    const node = await savedNode(service, 'cut')
    expect(node.workspaceId).toBe(WorkspaceId('ws-one'))
    expect(service.list()[0]?.workspaceId).toBe(WorkspaceId('ws-one'))
  })

  it('saves without a workspace while the registry resolves none', async () => {
    const { service } = await harness()
    const node = await savedNode(service, 'loose')
    expect(node.workspaceId).toBeUndefined()
  })

  it('renames a saved node and serves the new title from the cache', async () => {
    const { service } = await harness()
    const node = await savedNode(service, 'before')
    const renamed = await service.rename(node.id, '  after  ')
    expect(renamed.title).toBe('after')
    expect(renamed.id).toBe(node.id)
    expect(service.list().map(entry => entry.title)).toEqual(['after'])
  })

  it('rejects a rename of an unknown node with the domain not-found error', async () => {
    const { service } = await harness()
    await expect(service.rename('node-missing' as SessionNodeId, 'after'))
      .rejects.toMatchObject({ code: 'SESSION_NODE_NOT_FOUND' })
  })

  it('rejects a rename to a blank title as invalid input', async () => {
    const { service } = await harness()
    const node = await savedNode(service, 'before')
    await expect(service.rename(node.id, '   ')).rejects.toBeInstanceOf(SessionNodeError)
    expect(service.list()[0]?.title).toBe('before')
  })

  it('keeps the registry ordered and removes entries durably', async () => {
    const { service } = await harness()
    await savedNode(service, 'first')
    const second = await savedNode(service, 'second')
    expect(service.list().map(entry => entry.title)).toEqual(['second', 'first'])
    await expect(service.remove(second.id)).resolves.toBe(true)
    expect(service.list().map(entry => entry.title)).toEqual(['first'])
    await expect(service.remove(second.id)).resolves.toBe(false)
  })
})
