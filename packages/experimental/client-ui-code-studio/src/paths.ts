/**
 * Workspace admission and path checks shared by every code studio Remote
 * method: a request may only name a registered Workspace as its root, and
 * every file path must resolve strictly inside that root.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'

/** What an admitted request may address: the root target and its canonical path. */
export interface AdmittedWorkspace {
  /** Canonical root path as the registry stores it. */
  readonly canonical: string
  /** Resolved filesystem target of the root. */
  readonly target: FsTarget
}

/**
 * Admit one requested workspace root: it must be an absolute path whose
 * canonical form is exactly a registered Workspace.
 * @param ctx - Host context carrying the registry and filesystem services.
 * @param workspaceRoot - root path received on the wire.
 * @returns the admitted root.
 * @throws {RemoteError} `codeStudio/unknown-workspace` when no registered Workspace has that canonical path.
 */
export async function admitWorkspace(ctx: Context, workspaceRoot: string): Promise<AdmittedWorkspace> {
  const registered = ctx.get('workspaceRegistry')
  if (registered === undefined) {
    throw new RemoteError('codeStudio/unknown-workspace', 'the workspace registry is unavailable', {})
  }
  let canonical: string
  try {
    canonical = await realpathNormalize(workspaceRoot)
  } catch {
    throw new RemoteError('codeStudio/unknown-workspace', `workspace '${workspaceRoot}' does not resolve to a directory`, {})
  }
  const known = registered.list().some(workspace => workspace.path === canonical)
  if (!known) {
    throw new RemoteError('codeStudio/unknown-workspace', `'${workspaceRoot}' is not a registered workspace`, {})
  }
  return { canonical, target: await ctx.fs.resolve(canonical) }
}

/**
 * Resolve one workspace-relative request path and require it to stay inside the admitted root.
 * @param ctx - Host context carrying the filesystem service.
 * @param workspace - admitted root from {@link admitWorkspace}.
 * @param path - workspace-relative `/`-separated path received on the wire.
 * @returns the resolved target and its host-absolute path.
 * @throws {RemoteError} `codeStudio/path-outside-workspace` when the path escapes the root.
 */
export async function admitFile(
  ctx: Context, workspace: AdmittedWorkspace, path: string,
): Promise<{ readonly target: FsTarget; readonly absolute: string }> {
  if (path.startsWith('/') || path.includes('..')) {
    throw new RemoteError('codeStudio/path-outside-workspace', `'${path}' is not a relative workspace path`, { path })
  }
  const target = await ctx.fs.resolve(path, { cwd: workspace.canonical })
  if (!ctx.fs.contains(workspace.target, target)) {
    throw new RemoteError('codeStudio/path-outside-workspace', `'${path}' escapes the workspace root`, { path })
  }
  return { target, absolute: target.displayPath }
}

/**
 * Relate one host-absolute path back to the workspace: its workspace-relative
 * form when inside, otherwise the absolute path unchanged.
 * @param workspace - admitted root from {@link admitWorkspace}.
 * @param absolute - host-absolute path.
 * @returns the display path for wire frames.
 */
export function displayPath(workspace: AdmittedWorkspace, absolute: string): string {
  const root = workspace.canonical
  if (absolute === root) return ''
  if (absolute.startsWith(root.endsWith('/') ? root : `${root}/`)) return absolute.slice(root.length + 1)
  return absolute
}
