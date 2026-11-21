/** Open main-view tabs: the Sessions and global panels listed in the main tab strip. */

import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale service merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UiWorkspaceService } from './navigation.ts'

/** One open main view: a Session's Conversation or a global panel. */
export type MainTab =
  | { readonly kind: 'session'; readonly sessionId: SessionId }
  | { readonly kind: 'panel'; readonly panelId: MainPanelId }

/** Persisted open-tab state: the strip order and the view that was active. */
export interface MainTabsState {
  /** Open views in strip order, unique by {@link keyOf}. */
  readonly tabs: readonly MainTab[]
  /** {@link keyOf} of the active view, or undefined for the empty Conversation. */
  readonly activeKey: string | undefined
}

/**
 * Stable identity of one tab; also its persisted form and React key.
 * @param tab - the tab to identify.
 * @returns the `session:`- or `panel:`-prefixed key.
 */
export function keyOf(tab: MainTab): string {
  return tab.kind === 'session' ? `session:${tab.sessionId}` : `panel:${tab.panelId}`
}

/**
 * The open main-view tabs, projected from the live navigation signals.
 *
 * The controller keeps no independent selection: every Session open funnels
 * through {@link UiWorkspaceService} and every panel switch through
 * `ctx.layout.selectPanel`, so the tab list is reconciled from those signals —
 * the active view keeps a tab, an arriving view gains one, and closed,
 * archived, unlisted, or unregistered views leave. The intents `activate` and
 * `close` drive the same navigation primitives. Each background Session tab
 * holds one `tabs` reference without facets, so its history stays loaded
 * whatever the recent-view limit decides.
 */
export class MainTabsController {
  private readonly store = createSnapshotStore<MainTabsState>(
    { tabs: [], activeKey: undefined }, { persist: { name: 'dsh.mainTabs.v1' } },
  )
  private readonly held = new Map<SessionId, SessionReference>()
  private restored = false
  private stopped = false
  /** The tab state as a read-only observable, bound by the strip. */
  readonly state = this.store

  /**
   * @param ctx - Client root Context (layout and slots services).
   * @param service - the Workspace navigation service whose selection is one signal.
   * @param sessions - pure Session Controller owning the references.
   * @param workspaces - pure Workspace Controller naming archived Sessions.
   */
  constructor(
    private readonly ctx: Context,
    private readonly service: UiWorkspaceService,
    private readonly sessions: Pick<ISessions, 'list' | 'retain' | 'subagentAddress'>,
    private readonly workspaces: Pick<IWorkspaces, 'list'>,
  ) {}

  /**
   * Follow the navigation signals and retain background Session tabs.
   * @returns disposer that stops the projection and releases every held Session.
   */
  start(): () => void {
    const stops = [
      this.service.mainSelection.subscribe(this.reconcile),
      this.ctx.layout.panelInfo.subscribe(this.reconcile),
      this.sessions.list.subscribe(this.reconcile),
      this.workspaces.list.subscribe(this.reconcile),
      this.ctx.slots.subscribe('main', this.reconcile),
    ]
    this.reconcile()
    return () => {
      this.stopped = true
      for (const stop of stops) stop()
      for (const reference of [...this.held.values()]) reference.release()
      this.held.clear()
    }
  }

  /** Converge the tab list and the active pointer onto the navigation signals. */
  private readonly reconcile = (): void => {
    if (this.stopped) return
    const workspaces = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    if (workspaces.phase !== 'ready' || sessions.phase !== 'ready') return
    if (!this.restored) {
      this.restored = true
      this.restorePanelSelection()
    }
    const archived = workspaces.archivedSessionIds
    const registered = new Set(this.ctx.slots.entries('main')
      .flatMap(entry => entry.options.key === undefined ? [] : [entry.options.key]))
    const panelId = this.ctx.layout.panelInfo.getSnapshot().activePanelId
    const sessionId = this.service.mainSelection.getSnapshot().sessionId
    const active: MainTab | undefined = panelId !== null
      ? { kind: 'panel', panelId }
      : sessionId !== undefined ? { kind: 'session', sessionId } : undefined
    const previous = this.store.getSnapshot()
    let tabs = previous.tabs.filter(tab => tab.kind === 'session'
      ? sessions.byId[tab.sessionId] !== undefined && !archived.includes(tab.sessionId)
      : registered.has(tab.panelId))
    if (active !== undefined && !tabs.some(tab => keyOf(tab) === keyOf(active))) tabs = [...tabs, active]
    const activeKey = active === undefined ? undefined : keyOf(active)
    if (tabs !== previous.tabs || activeKey !== previous.activeKey) this.store.set({ tabs, activeKey })
    this.syncRetention()
  }

  /**
   * Re-select the persisted active panel once the lists are ready. A persisted
   * active Session restores through the main selection itself; selecting the
   * panel supersedes that restoration, which is safe: the panel needs no open
   * Session, and its Session tabs re-open on demand.
   */
  private restorePanelSelection(): void {
    const { tabs, activeKey } = this.store.getSnapshot()
    const active = tabs.find(tab => keyOf(tab) === activeKey)
    if (active?.kind !== 'panel') return
    if (!this.ctx.slots.entries('main').some(entry => entry.options.key === active.panelId)) return
    this.ctx.layout.selectPanel(active.panelId)
  }

  /** Hold exactly one `tabs` reference per background Session tab, retaining before releasing. */
  private syncRetention(): void {
    const current = this.service.mainSelection.getSnapshot().sessionId
    const wanted = new Set(this.store.getSnapshot().tabs.flatMap(tab =>
      tab.kind !== 'session' || tab.sessionId === current ? [] : [tab.sessionId]))
    for (const sessionId of wanted) {
      if (this.held.has(sessionId)) continue
      const target = this.sessions.subagentAddress(sessionId) ?? sessionId
      try {
        this.held.set(sessionId, this.sessions.retain(target, { source: 'tabs' }))
      } catch (error: unknown) {
        // The tab cannot hold its Session; the view stays reachable through the sidebar.
        console.warn('main tab Session retention failed:', error)
        this.dropSessionTab(sessionId)
      }
    }
    for (const [sessionId, reference] of [...this.held]) {
      if (wanted.has(sessionId)) continue
      this.held.delete(sessionId)
      reference.release()
    }
  }

  private dropSessionTab(sessionId: SessionId): void {
    const previous = this.store.getSnapshot()
    const tabs = previous.tabs.filter(tab => !(tab.kind === 'session' && tab.sessionId === sessionId))
    if (tabs !== previous.tabs) this.store.set({ tabs, activeKey: previous.activeKey })
  }

  /**
   * Show one tab's view in the main panel.
   * @param key - {@link keyOf} identity of the tab to activate.
   */
  activate(key: string): void {
    const tab = this.store.getSnapshot().tabs.find(tab => keyOf(tab) === key)
    if (tab === undefined) return
    if (tab.kind === 'panel') {
      this.ctx.layout.selectPanel(tab.panelId)
      return
    }
    const showing = this.ctx.layout.panelInfo.getSnapshot().activePanelId === null
      && this.service.mainSelection.getSnapshot().sessionId === tab.sessionId
    if (!showing) this.service.openSession(tab.sessionId)
  }

  /**
   * Close one tab; its Session keeps running. Closing the active view selects a
   * neighbour, and closing the last tab empties the Conversation view.
   * @param key - {@link keyOf} identity of the tab to close.
   */
  close(key: string): void {
    const previous = this.store.getSnapshot()
    const index = previous.tabs.findIndex(tab => keyOf(tab) === key)
    if (index === -1) return
    const neighbour = previous.tabs[index + 1] ?? previous.tabs[index - 1]
    const tabs = previous.tabs.filter((_, i) => i !== index)
    const activeKey = previous.activeKey === key
      ? neighbour === undefined ? undefined : keyOf(neighbour)
      : previous.activeKey
    this.store.set({ tabs, activeKey })
    if (previous.activeKey === key) {
      if (neighbour === undefined) this.service.closeMainView()
      else this.activate(keyOf(neighbour))
    }
    this.syncRetention()
  }
}

/**
 * Project the `sidebar.panellist` ledger as panel-id labels in the active locale.
 * @param ctx - plugin context whose slot registry and locale the projection follows.
 * @returns panel id to label; a panel without a sidebar row keeps no entry.
 */
export function panelLabelSource(ctx: Context): HostObservable<ReadonlyMap<string, string>> {
  let version = -1
  let revision = -1
  let labels = new Map<string, string>()
  return {
    getSnapshot: () => {
      const next = ctx.slots.getVersion('sidebar.panellist')
      const current = ctx.locale.getSnapshot().revision
      if (next !== version || current !== revision) {
        version = next
        revision = current
        labels = new Map(ctx.slots.entries('sidebar.panellist').flatMap((entry) => {
          const id = entry.options.id
          return id === undefined ? [] : [[id, resolveSlotLabel(entry.options.label) ?? id] as const]
        }))
      }
      return labels
    },
    subscribe: (listener) => {
      const offs = [ctx.slots.subscribe('sidebar.panellist', listener), ctx.locale.subscribe(listener)]
      return () => { for (const off of offs) off() }
    },
  }
}
