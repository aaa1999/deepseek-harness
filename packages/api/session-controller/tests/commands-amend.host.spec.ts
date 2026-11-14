import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, Inbox } from '@deepseek-ai/dsh-agent'
import { createSystemMessage, createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { createInboxStub, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionAmendCorrelation, SessionAmendRequest, SessionRequestId } from '../src/types.ts'
import { installSessionReadTestServices } from './test-remote.ts'

interface AmendHarness {
  ctx: Context
  controller: SessionCommandController
  agent: Agent
  inbox: Inbox
  followup: ReturnType<typeof vi.fn>
  pendingRemoteEvents: { event: string; agentId: SessionId }[]
}

/**
 * One live Agent over a Session whose surface holds a system head, one human
 * user message, and one context injection: an amendable target with a
 * non-human node after it.
 */
async function amendHarness(status: 'idle' | 'running', owned = false): Promise<AmendHarness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TypertRegistry)
  installSessionReadTestServices(ctx)
  const sessionId = SessionId('amend-session')
  const session = ctx.sessions.create(sessionId, {
    meta: {
      cwd: '/workspace',
      ...(owned ? { origin: 'subagent' as const, parentSession: SessionId('offline-parent') } : {}),
    },
  })
  session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('sys') }, { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'original' }],
    source: { kind: 'user', rpcId: 'req-original' as SessionRequestId },
  }), { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'reminder' }],
    source: { kind: 'runtime-context' },
  }), { surfaceOp: 'append' })
  const pendingRemoteEvents: { event: string; agentId: SessionId }[] = []
  ctx.provide('typertGateway', { getPendingRemoteEvents: () => pendingRemoteEvents } as never)
  const inbox = createInboxStub()
  const followup = vi.fn()
  const agent = {
    id: session.id,
    options: { provider: 'fixture', model: 'fixture-model' },
    whenIdle: vi.fn(() => Promise.resolve()),
    runMaintenance: async <T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> => job(new AbortController().signal),
    send: vi.fn(),
    inject: vi.fn(),
    session,
    model: unsupportedModel(),
    inbox,
    status,
    ctx,
    steer: vi.fn(),
    followup,
    cancel: vi.fn(),
  } satisfies Agent
  await ctx.agents.register(agent)
  ctx.provide('workspaceRegistry', { get: () => undefined, list: () => [] } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  const agents = new ApiSessionAgentController(ctx)
  vi.spyOn(agents, 'resolveAgent').mockImplementation(id => Promise.resolve({ agent: { ...agent, id } }))
  const controller = new SessionCommandController(ctx, agents, '/workspace')
  await controller.initialize()
  return { ctx, controller, agent, inbox, followup, pendingRemoteEvents }
}

const CORRELATION: SessionAmendCorrelation = { rpcId: 'req-amend' as SessionRequestId }

function amendRequest(agent: Agent, revises: MessageId, text = 'revised'): SessionAmendRequest {
  return {
    sessionId: agent.id,
    requestId: 'req-amend' as SessionRequestId,
    revises,
    content: [{ type: 'text', text }],
  }
}

/** The surface seq and message id of the Session's human user message. */
function humanTarget(agent: Agent): { seq: number; id: MessageId } {
  for (const seq of agent.session.surface.nodes) {
    const event = agent.session.eventAt(seq)
    if (event?.type === 'user/message' && event.data.source.kind === 'user') {
      return { seq, id: event.data.id }
    }
  }
  throw new Error('human user message missing from surface')
}

function contextTargetId(agent: Agent): MessageId {
  for (const seq of agent.session.surface.nodes) {
    const event = agent.session.eventAt(seq)
    if (event?.type === 'user/message' && event.data.source.kind === 'runtime-context') return event.data.id
  }
  throw new Error('runtime-context message missing from surface')
}

describe('Session amend command', () => {
  it('queues an idle amendment over the surface tail and re-runs from it', async () => {
    const { ctx, controller, agent, followup, inbox } = await amendHarness('idle')
    try {
      const target = humanTarget(agent)
      await controller.amend(amendRequest(agent, target.id), CORRELATION)
      expect(followup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        content: [{ type: 'text', text: 'revised' }],
        source: {
          kind: 'amend',
          revises: target.id,
          startSeq: target.seq,
          endSeq: agent.session.surface.nodes.at(-1),
          rpcId: CORRELATION.rpcId,
        },
      }))
      expect(inbox.nextTurn).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })

  it('lands a paused amendment on the target node in place', async () => {
    const { ctx, controller, agent, pendingRemoteEvents } = await amendHarness('running')
    try {
      pendingRemoteEvents.push({ event: 'approval/request', agentId: agent.id })
      const before = SessionSeq(agent.session.seq)
      const target = humanTarget(agent)
      await controller.amend(amendRequest(agent, target.id), CORRELATION)
      const appended = agent.session.eventAt(before)
      if (appended?.type !== 'user/message') throw new Error('amend user/message missing')
      expect(appended.surfaceOp).toEqual({ op: 'replace', startSeq: target.seq, endSeq: target.seq })
      expect(appended.sourceEventSeqs).toEqual([target.seq])
      expect(appended.data.content).toEqual([{ type: 'text', text: 'revised' }])
      expect(appended.data.source.kind).toBe('amend')
      // The replacement node replaces the target's position on the surface.
      expect(agent.session.surface.nodes).not.toContain(target.seq)
      expect(agent.session.surface.nodes).toContain(before)
    } finally { await ctx.fiber.dispose() }
  })

  it('repeats one accepted paused amendment as a no-op for the same request identity', async () => {
    const { ctx, controller, agent, pendingRemoteEvents } = await amendHarness('running')
    try {
      pendingRemoteEvents.push({ event: 'approval/request', agentId: agent.id })
      const target = humanTarget(agent)
      await controller.amend(amendRequest(agent, target.id), CORRELATION)
      const settled = agent.session.seq
      await controller.amend(amendRequest(agent, target.id), CORRELATION)
      expect(agent.session.seq).toBe(settled)
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects an amendment while the Agent runs without pending human input', async () => {
    const { ctx, controller, agent } = await amendHarness('running')
    try {
      const target = humanTarget(agent)
      await expect(controller.amend(amendRequest(agent, target.id), CORRELATION))
        .rejects.toMatchObject({ code: 'session/agent-busy', details: { reason: 'AGENT_RUNNING' } })
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects an idle re-run while queue input is pending', async () => {
    const { ctx, controller, agent, inbox } = await amendHarness('idle')
    try {
      inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } }))
      const target = humanTarget(agent)
      await expect(controller.amend(amendRequest(agent, target.id), CORRELATION))
        .rejects.toMatchObject({ code: 'session/agent-busy', details: { reason: 'PENDING_QUEUE_INPUT' } })
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects a Session owned by subagent routing', async () => {
    const { ctx, controller, agent } = await amendHarness('idle', true)
    try {
      const target = humanTarget(agent)
      await expect(controller.amend(amendRequest(agent, target.id), CORRELATION))
        .rejects.toMatchObject({ code: 'session/agent-busy', details: { reason: 'use subagent delivery for this child session' } })
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects non-human and unknown targets', async () => {
    const { ctx, controller, agent } = await amendHarness('idle')
    try {
      await expect(controller.amend(amendRequest(agent, contextTargetId(agent)), CORRELATION))
        .rejects.toMatchObject({ code: 'session/amend-unavailable' })
      await expect(controller.amend(amendRequest(agent, MessageId('msg-missing')), CORRELATION))
        .rejects.toMatchObject({ code: 'session/amend-unavailable' })
    } finally { await ctx.fiber.dispose() }
  })

  it('reports the chain root when a second amendment revises the first', async () => {
    const { ctx, controller, agent, pendingRemoteEvents } = await amendHarness('running')
    try {
      pendingRemoteEvents.push({ event: 'approval/request', agentId: agent.id })
      const target = humanTarget(agent)
      await controller.amend(amendRequest(agent, target.id, 'first revision'), CORRELATION)
      const first = agent.session.eventAt(SessionSeq(agent.session.seq - 1))
      if (first?.type !== 'user/message') throw new Error('first amend missing')
      // The client addresses the amended bubble by the amendment's message id.
      await controller.amend(amendRequest(agent, first.data.id, 'second revision'), CORRELATION)
      const second = agent.session.eventAt(SessionSeq(agent.session.seq - 1))
      if (second?.type !== 'user/message') throw new Error('second amend missing')
      expect(second.data.source.kind).toBe('amend')
      if (second.data.source.kind !== 'amend') throw new Error('unreachable')
      expect(second.data.source.revises).toBe(target.id)
    } finally { await ctx.fiber.dispose() }
  })
})
