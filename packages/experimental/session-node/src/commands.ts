/**
 * Human-facing commands over the global session-node domain:
 *
 * - `/save-node [title]` — save the current session's latest completed history
 *   node under its project.
 * - `/nodes` — list every saved node.
 * - `/fork-node <id-or-title>` — fork a new session from a saved node.
 * - `/rename-node <id-or-title> <new-title>` — rename a saved node.
 * - `/delete-node <id-or-title>` — delete a saved node.
 *
 * @module @deepseek-ai/dsh-session-node/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionNodeError } from './runtime.ts'
import type { SessionNode } from './types.ts'

export const name = 'command-session-node'
export const inject = ['commands', 'sessionNodes']

/**
 * The context slice the five commands read; the full Host Context satisfies it.
 * Tests construct this slice directly instead of a cast from a partial fake.
 */
export interface CommandsContext {
  /** Command registration into every composed command adapter. */
  commands: Pick<Context['commands'], 'register'>
  /** The session-node operations the commands drive. */
  sessionNodes: Pick<Context['sessionNodes'], 'save' | 'list' | 'fork' | 'rename' | 'remove'>
}

/** Match one node by exact id, id prefix, or case-insensitive title. */
function findNode(ctx: CommandsContext, query: string): SessionNode | undefined {
  const trimmed = query.trim()
  const nodes = ctx.sessionNodes.list()
  if (trimmed.length === 0) return undefined
  const byId = nodes.find(node => node.id === trimmed || node.id.startsWith(trimmed))
  if (byId !== undefined) return byId
  const lower = trimmed.toLowerCase()
  return nodes.find(node => node.title.toLowerCase() === lower || node.title.toLowerCase().includes(lower))
}

/** Render one node for direct UI output. */
function renderNode(node: SessionNode): string {
  return [
    `- ${node.id}`,
    `  title: ${node.title}`,
    `  source: ${node.sessionId} @ seq ${node.atSeq}`,
    ...(node.workspaceId === undefined ? [] : [`  project: ${node.workspaceId}`]),
    ...(node.note === undefined ? [] : [`  note: ${node.note}`]),
  ].join('\n')
}

/** Wrap a service operation, translating domain errors into UI errors. */
function execute(operation: () => CommandResult | Promise<CommandResult>): CommandResult | Promise<CommandResult> {
  try {
    const result = operation()
    if (result instanceof Promise) {
      return result.catch((error: unknown) => {
        if (error instanceof SessionNodeError) return { kind: 'error', text: error.message }
        throw error
      })
    }
    return result
  } catch (error: unknown) {
    if (error instanceof SessionNodeError) return { kind: 'error', text: error.message }
    throw error
  }
}

/** `/save-node [title]` — save the current session's node. */
function saveNode(ctx: CommandsContext, invocation: CommandInvocation): CommandResult | Promise<CommandResult> {
  const title = invocation.rawInput.trim()
  return execute(async () => {
    const node = await ctx.sessionNodes.save({
      sessionId: invocation.agent.id,
      ...(title.length === 0 ? {} : { title }),
    })
    return { kind: 'success', text: `Saved node:\n${renderNode(node)}\n\nFork it later with /fork-node ${node.id}.` }
  })
}

/** `/nodes` — list saved nodes. */
function listNodes(ctx: CommandsContext): CommandResult | Promise<CommandResult> {
  return execute(() => {
    const nodes = ctx.sessionNodes.list()
    if (nodes.length === 0) return { kind: 'success', text: 'No saved session nodes. Use /save-node [title] to save one.' }
    return { kind: 'success', text: nodes.map(renderNode).join('\n\n') }
  })
}

/** `/fork-node <id-or-title>` — fork a new session from a saved node. */
function forkNode(ctx: CommandsContext, invocation: CommandInvocation): CommandResult | Promise<CommandResult> {
  const node = findNode(ctx, invocation.rawInput)
  if (node === undefined) {
    return { kind: 'error', text: `No saved node matches "${invocation.rawInput.trim()}". Run /nodes to list nodes.` }
  }
  return execute(async () => {
    const { sessionId } = await ctx.sessionNodes.fork(node.id)
    return { kind: 'success', text: `Forked "${node.title}" into a new session:\n${sessionId}` }
  })
}

/** `/rename-node <id-or-title> <new-title>` — rename a saved node. */
function renameNode(ctx: CommandsContext, invocation: CommandInvocation): CommandResult | Promise<CommandResult> {
  const [selector, ...titleParts] = invocation.rawInput.trim().split(/\s+/)
  const title = titleParts.join(' ').trim()
  const node = selector === undefined ? undefined : findNode(ctx, selector)
  if (node === undefined) {
    return { kind: 'error', text: `No saved node matches "${invocation.rawInput.trim()}". Run /nodes to list nodes.` }
  }
  if (title.length === 0) {
    return { kind: 'error', text: 'Usage: /rename-node <id-or-title> <new-title>' }
  }
  return execute(async () => {
    const updated = await ctx.sessionNodes.rename(node.id, title)
    return { kind: 'success', text: `Renamed node to "${updated.title}" (${updated.id}).` }
  })
}

/** `/delete-node <id-or-title>` — delete a saved node. */
function deleteNode(ctx: CommandsContext, invocation: CommandInvocation): CommandResult | Promise<CommandResult> {
  const node = findNode(ctx, invocation.rawInput)
  if (node === undefined) {
    return { kind: 'error', text: `No saved node matches "${invocation.rawInput.trim()}". Run /nodes to list nodes.` }
  }
  return execute(async () => {
    await ctx.sessionNodes.remove(node.id)
    return { kind: 'success', text: `Deleted node "${node.title}" (${node.id}).` }
  })
}

/** Register the five human commands for every composed command adapter. */
export function apply(ctx: CommandsContext): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-session-node/save-node'),
    name: 'save-node',
    description: 'Save the current session history node under its project',
    input: { hint: '[title]' },
    handler: invocation => saveNode(ctx, invocation),
  })

  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-session-node/nodes'),
    name: 'nodes',
    description: 'List saved session history nodes',
    handler: () => listNodes(ctx),
  })

  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-session-node/fork-node'),
    name: 'fork-node',
    description: 'Fork a new session from a saved session history node',
    input: { hint: '<id-or-title>' },
    handler: invocation => forkNode(ctx, invocation),
  })

  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-session-node/rename-node'),
    name: 'rename-node',
    description: 'Rename a saved session history node',
    input: { hint: '<id-or-title> <new-title>' },
    handler: invocation => renameNode(ctx, invocation),
  })

  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-session-node/delete-node'),
    name: 'delete-node',
    description: 'Delete a saved session history node',
    input: { hint: '<id-or-title>' },
    handler: invocation => deleteNode(ctx, invocation),
  })
}
