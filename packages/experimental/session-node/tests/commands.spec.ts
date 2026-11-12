/** `/rename-node` selection and title handling over a stubbed sessionNodes service. */

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId, type CommandDefinition, type CommandInvocation, type CommandResult } from '@deepseek-ai/dsh-commands'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionNode, SessionNodeId } from '../src/types.ts'
import * as commands from '../src/commands.ts'
import type { CommandsContext } from '../src/commands.ts'

/** One saved node fixture. */
function node(id: string, title: string): SessionNode {
  return {
    id: brandString<SessionNodeId>(id),
    sessionId: brandString<SessionId>('session-one'),
    atSeq: 2,
    title,
    createdAt: 0,
  }
}

/** A minimal invocation; the rename handler reads only the raw input. */
function invocation(rawInput: string): CommandInvocation {
  return {
    commandId: CommandId('command-run-spec'),
    agent: {} as Agent,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  }
}

/** Registered command handlers captured from a stubbed registry. */
function registeredHandlers(nodes: SessionNode[]) {
  const handlers = new Map<string, CommandDefinition['handler']>()
  const rename = vi.fn(async (id: SessionNodeId, title: string) => ({ ...nodes.find(entry => entry.id === id)!, title }))
  const ctx: CommandsContext = {
    commands: { register: vi.fn((definition: CommandDefinition): (() => void) => {
      handlers.set(definition.name, definition.handler)
      return () => {}
    }) },
    sessionNodes: {
      list: () => nodes,
      rename,
      save: async input => ({ ...nodes[0]!, sessionId: input.sessionId }),
      fork: async id => ({ sessionId: brandString<SessionId>(id) }),
      remove: async () => true,
    },
  }
  commands.apply(ctx)
  const invoke = (name: string, rawInput: string): CommandResult | Promise<CommandResult> => {
    const handler = handlers.get(name)
    if (handler === undefined) throw new Error(`command "${name}" not registered`)
    return handler(invocation(rawInput))
  }
  return { invoke, rename }
}

describe('/rename-node', () => {
  it('renames the node matched by title prefix', async () => {
    const { invoke, rename } = registeredHandlers([node('node-one', 'checkpoint')])
    const result = await invoke('rename-node', '  checkpoint  Release cut  ')
    expect(result).toEqual({ kind: 'success', text: 'Renamed node to "Release cut" (node-one).' })
    expect(rename).toHaveBeenCalledWith(brandString<SessionNodeId>('node-one'), 'Release cut')
  })

  it('reports no match instead of renaming', async () => {
    const { invoke, rename } = registeredHandlers([node('node-one', 'checkpoint')])
    const result = await invoke('rename-node', 'missing')
    expect(result).toEqual({ kind: 'error', text: 'No saved node matches "missing". Run /nodes to list nodes.' })
    expect(rename).not.toHaveBeenCalled()
  })

  it('rejects an empty new title with usage guidance', async () => {
    const { invoke, rename } = registeredHandlers([node('node-one', 'checkpoint')])
    const result = await invoke('rename-node', 'node-one')
    expect(result).toEqual({ kind: 'error', text: 'Usage: /rename-node <id-or-title> <new-title>' })
    expect(rename).not.toHaveBeenCalled()
  })
})
