/** MainTabsController behavior: projection from navigation signals, close intents, retention, persistence. */

import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ISessions, SessionListState, SessionReference, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session-status/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MainTabsController, keyOf } from '../src/client/main-tabs.ts'
import { UiWorkspaceService } from '../src/client/navigation.ts'
import { en, zh } from '../src/client/locales.ts'

const sid = (id: string): SessionId => brandString<SessionId>(id)
const panel = (id: string): MainPanelId => id as MainPanelId

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
    retainedBy: overrides.retainedBy ?? {},
  }
}

function sessionState(summaries: readonly SessionSummary[], phase: SessionListState['phase'] = 'ready'): SessionListState {
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
    phase,
    projectionsBySession: {},
  }
}

function workspaceState(
  items: WorkspaceView[] = [],
  archivedSessionIds: readonly SessionId[] = [],
  phase: WorkspaceSnapshot['phase'] = 'ready',
): WorkspaceSnapshot {
  return { items, archivedSessionIds, pinnedSessionIds: [], phase, state: phase === 'ready' ? 'idle' : 'loading', error: null }
}

class MutableSource<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  getSnapshot(): T {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  /** Notify without changing the snapshot, the way a republished equal value does. */
  notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

class FakeSessions implements ISessions {
  readonly list: MutableSource<SessionListState>
  readonly retained: { reference: SessionReference; release: ReturnType<typeof vi.fn<() => void>>; options: unknown }[] = []
  readonly retain = vi.fn<ISessions['retain']>((target, options) => {
    const release = vi.fn<() => void>()
    const sessionId = typeof target === 'string' ? target : target.childSessionId
    const binding = { sessionId } as SessionReference['binding']
    const reference: SessionReference = {
      sessionId, binding, ready: Promise.resolve(binding), release, [Symbol.dispose]: release,
    }
    this.retained.push({ reference, release, options })
    // The real Controller republishes the Session list synchronously on every
    // retain; replaying that notification keeps the projection's re-entrant
    // paths observable in this bench.
    this.list.notify()
    return reference
  })
  readonly subagentAddress = vi.fn<ISessions['subagentAddress']>()
  declare readonly create: ISessions['create']
  declare readonly fork: ISessions['fork']
  declare readonly refreshProjections: ISessions['refreshProjections']
  declare readonly binding: ISessions['binding']
  declare readonly using: ISessions['using']
  declare readonly retainInfo: ISessions['retainInfo']
  declare readonly searchResultLimit: ISessions['searchResultLimit']
  declare readonly refresh: ISessions['refresh']
  declare readonly search: ISessions['search']
  declare readonly scope: ISessions['scope']
  declare readonly scopeOf: ISessions['scopeOf']
  declare readonly sessionOf: ISessions['sessionOf']

  constructor(initial: SessionListState) {
    this.list = new MutableSource(initial)
  }

  releases(): number {
    return this.retained.filter(item => item.release.mock.calls.length > 0).length
  }
}

/** The `main`-ledger slice of the slot registry the controller reads. */
class FakeMainPanels {
  private readonly panels = new Set<string>()
  private readonly listeners = new Set<() => void>()

  entries(): { readonly options: { readonly key: string } }[] {
    return [...this.panels].map(key => ({ options: { key } }))
  }

  subscribe(_name: string, listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  registerPanel(key: string): () => void {
    this.panels.add(key)
    for (const listener of [...this.listeners]) listener()
    return () => {
      this.panels.delete(key)
      for (const listener of [...this.listeners]) listener()
    }
  }
}

class FakeWorkspaces implements IWorkspaces {
  readonly list: MutableSource<WorkspaceSnapshot>
  declare readonly create: IWorkspaces['create']
  declare readonly rename: IWorkspaces['rename']
  declare readonly delete: IWorkspaces['delete']
  declare readonly initializeDefault: IWorkspaces['initializeDefault']
  declare readonly insertBefore: IWorkspaces['insertBefore']
  declare readonly insertSessionBefore: IWorkspaces['insertSessionBefore']
  declare readonly archiveSession: IWorkspaces['archiveSession']
  declare readonly unarchiveSession: IWorkspaces['unarchiveSession']
  declare readonly pinSession: IWorkspaces['pinSession']
  declare readonly unpinSession: IWorkspaces['unpinSession']

  constructor(initial: WorkspaceSnapshot) {
    this.list = new MutableSource(initial)
  }
}

interface BenchOptions {
  readonly persisted?: string
  readonly sessions?: SessionListState
  readonly workspaces?: WorkspaceSnapshot
}

async function bench(options: BenchOptions = {}) {
  const backing = new Map<string, string>(options.persisted === undefined ? [] : [['dsh.mainTabs.v1', options.persisted]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, value) },
    removeItem: (key: string) => { backing.delete(key) },
  })
  const ctx = new Context()
  contexts.push(ctx)
  const slots = new FakeMainPanels()
  ctx.provide('slots', slots as never)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.effect(() => locale.register('workspace', { en, zh }))
  ctx.provide('locale', locale)
  const panelInfo = createSnapshotStore<{ activePanelId: MainPanelId | null }>({ activePanelId: null })
  const layout = new LayoutController({
    selectPanel: (panelId) => { panelInfo.set({ activePanelId: panelId }) },
    retainMainPanels: vi.fn(), setSidebar: vi.fn(), toggleSidebar: vi.fn(), setViewportWidth: vi.fn(),
    setRightbar: vi.fn(), openRightbar: vi.fn(), closeRightbar: vi.fn(),
  }, id => slots.entries().some(entry => entry.options.key === id), panelInfo)
  ctx.provide('layout', layout)
  ctx.effect(() => () => { layout.dispose() })
  const sessions = new FakeSessions(options.sessions ?? sessionState([summary('a'), summary('b'), summary('c')]))
  const workspaces = new FakeWorkspaces(options.workspaces ?? workspaceState())
  const status = new MutableSource<SessionStatusSnapshot>(new Map())
  ctx.provide('uiSession', { sessionStatus: status } as never)
  const service = new UiWorkspaceService(
    ctx, { pick: vi.fn(), list: vi.fn(), createDirectory: vi.fn() }, workspaces, sessions,
    { pinSessionOrder: vi.fn() }, vi.fn(), createSnapshotStore<number | undefined>(10),
  )
  const controller = new MainTabsController(ctx, service, sessions, workspaces)
  ctx.effect(() => controller.start(), 'main-tabs spec')
  return { backing, controller, layout, panelInfo, service, sessions, slots, workspaces, ctx }
}

const readySessions = (): SessionListState => sessionState([summary('a'), summary('b'), summary('c')])

describe('MainTabsController', () => {
  it('keeps one tab per opened Session and activates the newest', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    expect(b.controller.state.getSnapshot()).toEqual({ tabs: [{ kind: 'session', sessionId: sid('a') }], activeKey: `session:${sid('a')}` })
    b.service.openSession(sid('b'))
    const state = b.controller.state.getSnapshot()
    expect(state.tabs.map(keyOf)).toEqual([`session:${sid('a')}`, `session:${sid('b')}`])
    expect(state.activeKey).toBe(`session:${sid('b')}`)
  })

  it('holds a tabs reference for each background Session tab only', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    b.service.openSession(sid('b'))
    const tabRetains = b.sessions.retained.filter(item => (item.options as { source: string }).source === 'tabs')
    expect(tabRetains.map(item => item.reference.sessionId)).toEqual([sid('a')])
    b.service.openSession(sid('a'))
    b.controller.close(`session:${sid('b')}`)
    const held = b.sessions.retained.filter(item =>
      (item.options as { source: string }).source === 'tabs' && item.release.mock.calls.length === 0)
    expect(held.map(item => item.reference.sessionId)).toEqual([])
  })

  it('activating an existing tab reopens its Session without reordering', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    b.service.openSession(sid('b'))
    b.controller.activate(`session:${sid('a')}`)
    const state = b.controller.state.getSnapshot()
    expect(state.activeKey).toBe(`session:${sid('a')}`)
    expect(state.tabs.map(keyOf)).toEqual([`session:${sid('a')}`, `session:${sid('b')}`])
    expect(b.service.mainSelection.getSnapshot().sessionId).toBe(sid('a'))
  })

  it('closing the active tab selects its right neighbour, or the left one at the end', async () => {
    const b = await bench()
    for (const id of ['a', 'b', 'c']) b.service.openSession(sid(id))
    b.controller.activate(`session:${sid('a')}`)
    b.controller.close(`session:${sid('a')}`)
    expect(b.controller.state.getSnapshot().activeKey).toBe(`session:${sid('b')}`)
    expect(b.service.mainSelection.getSnapshot().sessionId).toBe(sid('b'))
    b.controller.activate(`session:${sid('c')}`)
    b.controller.close(`session:${sid('c')}`)
    expect(b.controller.state.getSnapshot().activeKey).toBe(`session:${sid('b')}`)
  })

  it('closing the last tab empties the main view', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    b.controller.close(`session:${sid('a')}`)
    expect(b.controller.state.getSnapshot()).toEqual({ tabs: [], activeKey: undefined })
    expect(b.service.mainSelection.getSnapshot()).toEqual({})
  })

  it('closing a background tab keeps the active view and releases its reference', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    b.service.openSession(sid('b'))
    b.controller.close(`session:${sid('a')}`)
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toEqual([`session:${sid('b')}`])
    expect(b.service.mainSelection.getSnapshot().sessionId).toBe(sid('b'))
    expect(b.sessions.releases()).toBeGreaterThan(0)
  })

  it('drops the tab of an archived Session', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    b.service.openSession(sid('b'))
    b.workspaces.list.set(workspaceState([], [sid('a')]))
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toEqual([`session:${sid('b')}`])
  })

  it('appends and reactivates panel tabs, and prunes unregistered panels', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    const plugins = panel('plugins')
    const disposePanel = b.slots.registerPanel('plugins')
    b.layout.selectPanel(plugins)
    expect(b.controller.state.getSnapshot().tabs.map(keyOf))
      .toEqual([`session:${sid('a')}`, 'panel:plugins'])
    expect(b.controller.state.getSnapshot().activeKey).toBe('panel:plugins')
    // Returning to the Session keeps the panel tab open in the background.
    b.controller.activate(`session:${sid('a')}`)
    expect(b.controller.state.getSnapshot().activeKey).toBe(`session:${sid('a')}`)
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toContain('panel:plugins')
    disposePanel()
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toEqual([`session:${sid('a')}`])
  })

  it('restores persisted tabs, background retention, and an active panel selection', async () => {
    const persisted = JSON.stringify({
      tabs: [{ kind: 'session', sessionId: sid('a') }, { kind: 'panel', panelId: 'plugins' }],
      activeKey: 'panel:plugins',
    })
    const b = await bench({
      persisted,
      sessions: sessionState([summary('a'), summary('b'), summary('c')], 'pending'),
      workspaces: workspaceState([], [], 'pending'),
    })
    const disposePanel = b.slots.registerPanel('plugins')
    // Lists arrive ready after the panel registration; the restore step follows them.
    b.sessions.list.set(readySessions())
    b.workspaces.list.set(workspaceState())
    expect(b.controller.state.getSnapshot().tabs.map(keyOf))
      .toEqual([`session:${sid('a')}`, 'panel:plugins'])
    expect(b.panelInfo.getSnapshot().activePanelId).toBe(panel('plugins'))
    const held = b.sessions.retained.filter(item =>
      (item.options as { source: string }).source === 'tabs' && item.release.mock.calls.length === 0)
    expect(held.map(item => item.reference.sessionId)).toEqual([sid('a')])
    disposePanel()
  })

  it('keeps nothing while the lists are not ready', async () => {
    const b = await bench({
      sessions: sessionState([summary('a')], 'pending'),
      workspaces: workspaceState([], [], 'pending'),
    })
    b.service.openSession(sid('a'))
    expect(b.controller.state.getSnapshot().tabs).toEqual([])
    b.sessions.list.set(readySessions())
    b.workspaces.list.set(workspaceState())
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toEqual([`session:${sid('a')}`])
  })

  it('closeMany keeps the survivors in order and the untouched active view', async () => {
    const b = await bench()
    for (const id of ['a', 'b', 'c']) b.service.openSession(sid(id))
    b.controller.closeMany([`session:${sid('a')}`])
    expect(b.controller.state.getSnapshot().tabs.map(keyOf))
      .toEqual([`session:${sid('b')}`, `session:${sid('c')}`])
    expect(b.controller.state.getSnapshot().activeKey).toBe(`session:${sid('c')}`)
    expect(b.service.mainSelection.getSnapshot().sessionId).toBe(sid('c'))
  })

  it('closeMany closing the active view activates the first survivor', async () => {
    const b = await bench()
    for (const id of ['a', 'b', 'c']) b.service.openSession(sid(id))
    b.controller.closeMany([`session:${sid('a')}`, `session:${sid('c')}`])
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toEqual([`session:${sid('b')}`])
    expect(b.controller.state.getSnapshot().activeKey).toBe(`session:${sid('b')}`)
    expect(b.service.mainSelection.getSnapshot().sessionId).toBe(sid('b'))
  })

  it('closeMany closing every tab empties the main view', async () => {
    const b = await bench()
    for (const id of ['a', 'b']) b.service.openSession(sid(id))
    b.controller.closeMany([`session:${sid('a')}`, `session:${sid('b')}`])
    expect(b.controller.state.getSnapshot()).toEqual({ tabs: [], activeKey: undefined })
    expect(b.service.mainSelection.getSnapshot()).toEqual({})
  })

  it('closeMany releases the closed background tabs only', async () => {
    const b = await bench()
    for (const id of ['a', 'b', 'c']) b.service.openSession(sid(id))
    const released = (): readonly string[] => b.sessions.retained
      .filter(item => (item.options as { source: string }).source === 'tabs' && item.release.mock.calls.length > 0)
      .map(item => item.reference.sessionId)
    b.controller.closeMany([`session:${sid('a')}`])
    expect(released()).toEqual([sid('a')])
    const held = b.sessions.retained
      .filter(item => (item.options as { source: string }).source === 'tabs' && item.release.mock.calls.length === 0)
      .map(item => item.reference.sessionId)
    expect(held).toEqual([sid('b')])
  })

  it('closeMany ignores keys that name no open tab', async () => {
    const b = await bench()
    b.service.openSession(sid('a'))
    b.service.openSession(sid('b'))
    const before = b.controller.state.getSnapshot()
    b.controller.closeMany(['panel:none', 'session:missing'])
    expect(b.controller.state.getSnapshot()).toBe(before)
  })

  it('keeps the closed active view closed while its successor opens through a publishing list', async () => {
    const b = await bench()
    for (const id of ['a', 'b', 'c']) b.service.openSession(sid(id))
    // The active view (c) is closed with a surviving neighbour; the successor's
    // synchronous list publication must not append c back as an arriving view.
    b.controller.closeMany([`session:${sid('a')}`, `session:${sid('c')}`])
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toEqual([`session:${sid('b')}`])
    expect(b.controller.state.getSnapshot().activeKey).toBe(`session:${sid('b')}`)
    b.controller.close(`session:${sid('b')}`)
    expect(b.controller.state.getSnapshot()).toEqual({ tabs: [], activeKey: undefined })
  })

  it('drops a Session tab whose reference cannot be held', async () => {
    const b = await bench()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const retain = b.sessions.retain.getMockImplementation()
    let thrown = false
    b.sessions.retain.mockImplementation((target, options) => {
      if (!thrown && options?.source === 'tabs') {
        thrown = true
        throw new Error('unretainable')
      }
      return retain?.(target, options) as SessionReference
    })
    b.service.openSession(sid('a'))
    b.service.openSession(sid('b'))
    expect(b.controller.state.getSnapshot().tabs.map(keyOf)).toEqual([`session:${sid('b')}`])
    expect(warn).toHaveBeenCalledOnce()
  })
})
