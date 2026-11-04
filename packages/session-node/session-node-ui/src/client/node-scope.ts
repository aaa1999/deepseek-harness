/**
 * Workspace scoping shared by every node-addressing surface: a surface shows
 * only the saved nodes of its workspace context, and nodes saved without a
 * resolved workspace belong to the workspace-less context alone.
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionNode } from 'dsh-session-node/client'

/**
 * Filter saved nodes to one workspace scope.
 * @param nodes - every saved node, in registry order.
 * @param workspaceId - workspace owning the surface's session context; `undefined` scopes to nodes saved without a resolved workspace.
 * @returns the nodes of that scope, in registry order.
 */
export function nodesInWorkspaceScope(
  nodes: readonly SessionNode[],
  workspaceId: WorkspaceId | undefined,
): SessionNode[] {
  return nodes.filter(node => node.workspaceId === workspaceId)
}
