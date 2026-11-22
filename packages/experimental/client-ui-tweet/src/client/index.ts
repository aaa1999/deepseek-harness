/**
 * Browser entry of the tweet panel: the locale dictionaries, the panel
 * controller over the Remote, and the main-tab page with its sidebar entry.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import remote from '@deepseek-ai/dsh-client-ui-tweet/remote'
import { TweetPanelIcon } from './TweetPanelIcon.tsx'
import { TweetPage } from './TweetPage.tsx'
import { type TweetsLocaleKey, en, NS, zh } from './locales.ts'
import { Tweets } from './tweets.ts'

/** Services required before the panel registers. */
export const inject = ['remote', 'slots', 'locale', 'remoteAccess', 'workspaces']

/** Main panel and navigation row id of the tweet page. */
export const TWEET_PANEL = 'tweet' as MainPanelId

/** Namespace and dictionaries of the panel copy. */
export { en, NS, zh }
export type { TweetsLocaleKey }

/** The panel controller, exported for tests of its state machine. */
export { Tweets }

/**
 * Mount the tweet Remote, then the page while the current Peer may read
 * the workspace-bound feed. The controller runs in a scope that injects the
 * Remote namespace, which Cordis requires before `remote.tweet` is
 * readable.
 * @param ctx - browser plugin context.
 * @returns the disposer that withdraws the page, then the Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(remote)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'tweet: dictionaries')
  const t = ctx.locale.bind(NS)
  let stopAccess: () => void = () => {}
  let disposeTweets: () => void = () => {}
  const scope = ctx.inject(
    ['remote.tweet', 'slots', 'locale', 'remoteAccess', 'workspaces'],
    (scoped: Context) => {
      const tweet = new Tweets(scoped.remote.tweet, (key, params) => t(key, params))
      disposeTweets = () => { tweet.dispose() }
      stopAccess = scoped.remoteAccess.whenAccess('tweet/list', function* () {
        yield scoped.slots.inject('main', () => scoped.slots.register({
          name: 'main',
          key: TWEET_PANEL,
          locale: NS,
          inject: () => ({
            tweet,
            workspaces: scoped.workspaces.list,
          }),
        }, TweetPage))
        yield scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({
          name: 'sidebar.panellist', id: TWEET_PANEL, order: 36, locale: NS, label: () => t('panel.name'),
        }, TweetPanelIcon))
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
    disposeTweets()
    await scope.dispose()
    await unmountRemote()
  }
}
