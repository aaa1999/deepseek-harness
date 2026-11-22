/**
 * Workspace admission of the tweet store: every request names a registered
 * Workspace by id, and all data lives under that Workspace's
 * `.dsh/tweet/` directory, addressed only through names this module admits.
 */

import { join } from 'node:path'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { OBJECT_NAME_PATTERN } from './records.ts'

/** The registry face the admission needs; the real `ctx.workspaceRegistry` satisfies it. */
export interface WorkspaceLookup {
  /** Registry read of one Workspace entity. */
  get(id: WorkspaceId): { readonly path: string } | undefined
}

/** Directory segments of the data root inside a Workspace. */
const DATA_SEGMENTS = ['.dsh', 'tweet'] as const

/**
 * Admit one requested Workspace and return its tweet data root.
 * @param registry - workspace registry carrying registered entities.
 * @param workspaceId - Workspace id received on the wire.
 * @returns the absolute data root `<workspace>/.dsh/tweet`.
 * @throws {RemoteError} `tweet/unknown-workspace` when the registry holds no such Workspace.
 */
export function admitDataRoot(registry: WorkspaceLookup, workspaceId: WorkspaceId): string {
  const workspace = registry.get(workspaceId)
  if (workspace === undefined) {
    throw new RemoteError(
      'tweet/unknown-workspace',
      `no registered workspace has id '${workspaceId}'`,
      { workspaceId },
    )
  }
  return join(workspace.path, ...DATA_SEGMENTS)
}

/**
 * Resolve one data-root-relative POSIX path and require it to stay inside the
 * root: every stored name is a validated single segment, so rejecting
 * absolute paths and `..` segments is what keeps the join inside the root.
 * @param root - admitted data root from {@link admitDataRoot}.
 * @param relative - `/`-separated relative path.
 * @returns the host-absolute path.
 * @throws {RemoteError} `tweet/invalid-object-name` when the path is not relative or climbs with `..`.
 */
export function admitDataFile(root: string, relative: string): string {
  if (relative.startsWith('/') || relative.split('/').includes('..')) {
    throw new RemoteError(
      'tweet/invalid-object-name',
      `'${relative}' is not a relative data path`,
      { file: relative },
    )
  }
  return join(root, relative)
}

/**
 * Validate one wire-supplied object name against the content-addressed pattern.
 * @param file - object file name from an {@link TweetImageRef}.
 * @returns the unchanged name.
 * @throws {RemoteError} `tweet/invalid-object-name` when the name is not `<sha256>.<ext>`.
 */
export function admitObjectName(file: string): string {
  if (!OBJECT_NAME_PATTERN.test(file)) {
    throw new RemoteError(
      'tweet/invalid-object-name',
      `'${file}' is not a stored object name`,
      { file },
    )
  }
  return file
}
