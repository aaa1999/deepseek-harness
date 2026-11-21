/**
 * Browser entry of the code studio: the locale dictionaries, the panel
 * controller over the Remote, and the main-tab page with its sidebar entry.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import remote from '@deepseek-ai/dsh-experimental-client-ui-code-studio/remote'
import { CodeStudioPanelIcon } from './CodeStudioPanelIcon.tsx'
import { CodeStudioPage } from './CodeStudioPage.tsx'
import { type CodeStudioLocaleKey, en, NS, zh } from './locales.ts'
import { CodeStudio } from './studio.ts'

/** Services required before the panel registers. */
export const inject = ['remote', 'slots', 'locale', 'remoteAccess', 'workspaces', 'uiWorkspace']

/** Main panel and navigation row id of the code studio page. */
export const CODE_STUDIO_PANEL = 'code-studio' as MainPanelId

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Code studio panel copy. */
    'codeStudio': CodeStudioLocaleKey
  }
}

/** Namespace and dictionaries of the panel copy. */
export { en, NS, zh }
export type { CodeStudioLocaleKey }

/** The panel controller, exported for tests of its state machine. */
export { CodeStudio }

/**
 * Mount the code studio Remote, then the page while the current Peer may read
 * workspaces. The controller runs in a scope that injects the Remote
 * namespace, which Cordis requires before `remote.codeStudio` is readable.
 * @param ctx - browser plugin context.
 * @returns the disposer that withdraws the page, then the Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'code-studio: dictionaries')
  const t = ctx.locale.bind(NS)
  let stopAccess: () => void = () => {}
  let disposeStudio: () => void = () => {}
  const scope = ctx.inject(
    ['remote.codeStudio', 'slots', 'locale', 'remoteAccess', 'workspaces', 'uiWorkspace'],
    (scoped: Context) => {
      const studio = new CodeStudio(scoped, (key, params) => t(key, params))
      disposeStudio = () => { studio.dispose() }
      stopAccess = scoped.remoteAccess.whenAccess('codeStudio/list', function* () {
        yield scoped.slots.inject('main', () => scoped.slots.register({
          name: 'main',
          key: CODE_STUDIO_PANEL,
          locale: NS,
          inject: () => ({
            studio,
            ctx: scoped,
            workspaces: scoped.workspaces.list,
            pickDirectory: () => scoped.uiWorkspace.pickDirectory(),
            createWorkspace: async (path: string) => (await scoped.workspaces.create({ path })).path,
          }),
        }, CodeStudioPage))
        yield scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({
          name: 'sidebar.panellist', id: CODE_STUDIO_PANEL, order: 35, locale: NS, label: () => t('panel.name'),
        }, CodeStudioPanelIcon))
      })
    },
  )
  try {
    await scope
  } catch (error) {
    await scope.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    stopAccess()
    disposeStudio()
    await scope.dispose()
    await unmountRemote()
  }
}
