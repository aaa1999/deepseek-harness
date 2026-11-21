// @vitest-environment jsdom
/** MainTabStrip rendering: visibility, titles, activation, close routes, and keyboard focus. */

import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { brandString } from '@deepseek-ai/dsh-brand'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session-status/client'
import { MainTabStrip } from '../src/client/MainTabStrip.tsx'
import type { MainTabStripProps } from '../src/client/MainTabStrip.tsx'
import { keyOf, type MainTab, type MainTabsState } from '../src/client/main-tabs.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { en } from '../src/client/locales.ts'

const sid = (id: string): SessionId => brandString<SessionId>(id)
const sessionTab = (id: string): MainTab => ({ kind: 'session', sessionId: sid(id) })
const panelTab = (id: string): MainTab => ({ kind: 'panel', panelId: id as MainPanelId })
const t = ((key: keyof typeof en, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as MainTabStripProps['t']

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id), displayTitle: id, running: false, blank: false, updatedAt: 0,
    ...overrides, retainedBy: overrides.retainedBy ?? {},
  }
}

interface MountOptions {
  readonly tabs: readonly MainTab[]
  readonly activeKey?: string
  readonly summaries?: readonly SessionSummary[]
  readonly status?: SessionStatusSnapshot
  readonly panelLabels?: ReadonlyMap<string, string>
}

function mountStrip(options: MountOptions) {
  const activate = vi.fn()
  const close = vi.fn()
  const closeMany = vi.fn()
  const tabsStore = createSnapshotStore<MainTabsState>({ tabs: options.tabs, activeKey: options.activeKey })
  const summaries = options.summaries ?? [
    summary('a', { title: 'Refactor plan' }),
    summary('blank-1', { blank: true }),
  ]
  const status = options.status ?? new Map()
  const labels = new Map(options.panelLabels ?? [])
  const utils = render(
    <MainTabStrip
      useMainTabs={bindSnapshotSelector(tabsStore)}
      usePanelLabels={bindSnapshotSelector(createSnapshotStore(labels))}
      useSessions={selector => selector({
        ids: summaries.map(item => item.id),
        byId: Object.fromEntries(summaries.map(item => [item.id, item])),
        phase: 'ready',
        projectionsBySession: {},
      })}
      useSessionStatus={selector => selector(status)}
      activate={activate}
      close={close}
      closeMany={closeMany}
      t={t}
    />,
  )
  return { ...utils, activate, close, closeMany, tabsStore }
}

afterEach(cleanup)

describe('MainTabStrip', () => {
  it('renders a single open view as one tab', () => {
    mountStrip({ tabs: [sessionTab('a')] })
    const strip = screen.getByRole('tablist')
    expect(within(strip).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Refactor plan'])
  })

  it('renders nothing without open views', () => {
    const { container } = mountStrip({ tabs: [] })
    expect(container.firstElementChild).toBeNull()
  })

  it('lists session titles, blank titles, and panel labels', () => {
    mountStrip({
      tabs: [
        sessionTab('a'),
        sessionTab('blank-1'),
        panelTab('plugins'),
        panelTab('unknown'),
      ],
      panelLabels: new Map([['plugins', 'Plugins']]),
    })
    const strip = screen.getByRole('tablist')
    expect(within(strip).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Refactor plan', 'New Session', 'Plugins', 'unknown',
    ])
  })

  it('marks the active tab and activates another on click', () => {
    const tabs = [sessionTab('a'), panelTab('plugins')]
    const { activate } = mountStrip({
      tabs,
      activeKey: keyOf(tabs[0]!),
      panelLabels: new Map([['plugins', 'Plugins']]),
    })
    const first = screen.getAllByRole('tab')[0]!
    const second = screen.getAllByRole('tab')[1]!
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(second.getAttribute('aria-selected')).toBe('false')
    expect(second.tabIndex).toBe(-1)
    fireEvent.click(second)
    expect(activate).toHaveBeenCalledWith('panel:plugins')
  })

  it('closes through the close button and a middle click, without activating', () => {
    const tabs = [sessionTab('a'), sessionTab('b')]
    const { activate, close } = mountStrip({ tabs, activeKey: keyOf(tabs[0]!), summaries: [summary('a', { title: 'One' }), summary('b', { title: 'Two' })] })
    const first = screen.getAllByRole('tab')[0]!
    fireEvent.click(within(first).getByRole('button', { name: 'Close "One"' }))
    expect(close).toHaveBeenCalledWith(`session:${sid('a')}`)
    expect(activate).not.toHaveBeenCalled()
    fireEvent.mouseDown(first, { button: 1 })
    fireEvent(first, new MouseEvent('auxclick', { button: 1, bubbles: true }))
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('moves focus with arrow keys and activates with Enter', () => {
    const tabs = [sessionTab('a'), sessionTab('b'), sessionTab('c')]
    const { activate } = mountStrip({
      tabs, activeKey: keyOf(tabs[0]!),
      summaries: [summary('a', { title: 'One' }), summary('b', { title: 'Two' }), summary('c', { title: 'Three' })],
    })
    const first = screen.getAllByRole('tab')[0]!
    const second = screen.getAllByRole('tab')[1]!
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'Enter' })
    expect(activate).toHaveBeenCalledWith(`session:${sid('b')}`)
    fireEvent.keyDown(second, { key: 'Home' })
    expect(document.activeElement).toBe(first)
  })

  it('shows the running state on its session tab', () => {
    const tabs = [sessionTab('a'), sessionTab('b')]
    mountStrip({
      tabs, activeKey: keyOf(tabs[0]!),
      summaries: [summary('a', { title: 'One' }), summary('b', { title: 'Two', running: true })],
    })
    const second = screen.getAllByRole('tab')[1]!
    expect(second.querySelector('[data-state="ongoing"]')).not.toBeNull()
    const first = screen.getAllByRole('tab')[0]!
    expect(first.querySelector('[data-state]')).toBeNull()
  })

  it('enters the selection mode from the manage menu and toggles chips instead of switching', () => {
    const tabs = [sessionTab('a'), sessionTab('b')]
    const summaries = [summary('a', { title: 'One' }), summary('b', { title: 'Two' })]
    const { activate } = mountStrip({ tabs, activeKey: keyOf(tabs[0]!), summaries })
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Manage tabs' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close multiple' }))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Close "One"' })).toBeNull()
    fireEvent.click(checkboxes[1]!)
    expect((checkboxes[1]! as HTMLInputElement).checked).toBe(true)
    // A chip click toggles its checkbox rather than activating the view.
    fireEvent.click(screen.getAllByRole('tab')[0]!)
    expect((checkboxes[0]! as HTMLInputElement).checked).toBe(true)
    expect(activate).not.toHaveBeenCalled()
  })

  it('closes the checked selection through the manage menu and leaves the mode', () => {
    const tabs = [sessionTab('a'), sessionTab('b'), sessionTab('c')]
    const summaries = [summary('a', { title: 'One' }), summary('b', { title: 'Two' }), summary('c', { title: 'Three' })]
    const { activate, closeMany } = mountStrip({ tabs, activeKey: keyOf(tabs[1]!), summaries })
    fireEvent.click(screen.getByRole('button', { name: 'Manage tabs' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close multiple' }))
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]!)
    fireEvent.click(checkboxes[2]!)
    fireEvent.click(screen.getByRole('button', { name: 'Manage tabs' }))
    const closeSelected = screen.getByRole('menuitem', { name: 'Close selected (2)' })
    expect(closeSelected.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(closeSelected)
    expect(closeMany).toHaveBeenCalledWith([`session:${sid('a')}`, `session:${sid('c')}`])
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(activate).not.toHaveBeenCalled()
  })

  it('offers closing every tab from the manage menu', () => {
    const tabs = [sessionTab('a'), sessionTab('b')]
    const summaries = [summary('a', { title: 'One' }), summary('b', { title: 'Two' })]
    const { closeMany } = mountStrip({ tabs, activeKey: keyOf(tabs[0]!), summaries })
    fireEvent.click(screen.getByRole('button', { name: 'Manage tabs' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all' }))
    expect(closeMany).toHaveBeenCalledWith([`session:${sid('a')}`, `session:${sid('b')}`])
  })

  it('exits the selection mode from the manage menu without closing anything', () => {
    const tabs = [sessionTab('a'), sessionTab('b')]
    const summaries = [summary('a', { title: 'One' }), summary('b', { title: 'Two' })]
    const { closeMany } = mountStrip({ tabs, activeKey: keyOf(tabs[0]!), summaries })
    fireEvent.click(screen.getByRole('button', { name: 'Manage tabs' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close multiple' }))
    fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Manage tabs' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exit selection' }))
    expect(closeMany).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
