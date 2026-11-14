import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { admittedSurfaceIntent } from '../src/amend.ts'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('amend admission', () => {
  it('lands a claimed amend message as a surface replacement citing every shadowed node', async () => {
    const adapter = new MockAdapter([textResponse('first reply'), textResponse('second reply')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('amend-claim'), { provider: 'mock', model: 'mock' })

    send(agent, 'original')
    await agent.whenIdle()

    const events = agent.session.snapshotEvents()
    const original = events.find((event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message' && event.data.source.kind === 'user')
    if (original === undefined) throw new Error('original user/message missing')
    const nodesBefore = [...agent.session.surface.nodes]
    const startIdx = nodesBefore.indexOf(original.seq)
    if (startIdx === -1) throw new Error('original message is not a current surface node')

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'revised' }],
      source: {
        kind: 'amend',
        revises: original.data.id,
        startSeq: original.seq,
        endSeq: nodesBefore.at(-1) ?? original.seq,
      },
    }))
    await agent.whenIdle()

    const amend = agent.session.snapshotEvents().findLast((event): event is SessionEvent<'user/message'> =>
      event.type === 'user/message' && event.data.source.kind === 'amend')
    if (amend === undefined) throw new Error('amend user/message missing')
    const shadowed = nodesBefore.slice(startIdx)
    expect(amend.surfaceOp).toEqual({ op: 'replace', startSeq: original.seq, endSeq: shadowed.at(-1) })
    expect(amend.sourceEventSeqs).toEqual(shadowed)

    // The rerun request derives the revised message in place of the shadowed range.
    const request = adapter.requests.at(-1)
    if (request === undefined) throw new Error('rerun request missing')
    expect(request.messages.filter(message => message.role === 'user')).toHaveLength(1)
    const user = request.messages.find(message => message.role === 'user')
    expect(user?.content).toEqual([{ type: 'text', text: 'revised' }])
  })

  it('keeps ordinary input as an append in the same claim path', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('amend-plain'), { provider: 'mock', model: 'mock' })

    const message = createUserMessage({ content: [{ type: 'text', text: 'plain' }], source: { kind: 'user' } })
    expect(admittedSurfaceIntent(agent.session, message)).toEqual({ surfaceOp: 'append' })

    send(agent, 'plain')
    await agent.whenIdle()
    const appended = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    expect(appended?.surfaceOp).toBe('append')
  })

  it('rejects an amend range whose endpoints are in inverted surface order', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('amend-inverted'), { provider: 'mock', model: 'mock' })
    send(agent, 'original')
    await agent.whenIdle()

    const nodes = [...agent.session.surface.nodes]
    const [endSeq] = nodes
    const startSeq = nodes.at(-1)
    if (startSeq === undefined || endSeq === undefined || startSeq === endSeq) {
      throw new Error('surface needs at least two distinct nodes')
    }
    const message = createUserMessage({
      content: [{ type: 'text', text: 'inverted' }],
      source: { kind: 'amend', revises: 'msg-x' as MessageId, startSeq, endSeq },
    })
    expect(() => admittedSurfaceIntent(agent.session, message)).toThrow('is not a current surface range')
  })

  it('rejects an amend range that no longer names a current surface range', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('amend-stale'), { provider: 'mock', model: 'mock' })
    await agent.whenIdle()

    const message = createUserMessage({
      content: [{ type: 'text', text: 'stale' }],
      source: { kind: 'amend', revises: 'msg-stale' as MessageId, startSeq: SessionSeq(4), endSeq: SessionSeq(7) },
    })
    expect(() => admittedSurfaceIntent(agent.session, message)).toThrow('is not a current surface range')
  })
})
