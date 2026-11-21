/**
 * The main tab strip: every open main view — Session Conversations and global
 * panels — as one switchable, closable row above the main panel. Manual
 * activation (arrows/Home/End move focus, Enter or Space selects), click
 * switches, the close button or a middle click closes. The manage control at
 * the strip's end offers a checked selection of tabs to close together or
 * every tab at once; while it is active the chips toggle their checkbox
 * instead of switching views. Nothing renders without an open view.
 */
import { useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChecklistOutlineRegular, IconCloseFillRegular, Menu, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry, StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { keyOf } from './main-tabs.ts'
import type { MainTab, MainTabsState } from './main-tabs.ts'
import css from './MainTabStrip.module.css'

/** Face ui-workspace's apply injects into the `shell.maintabs` registration. */
export interface MainTabStripInjected {
  readonly hooks: {
    /** Open tabs and the active view; bound by the renderer as `useMainTabs`. */
    readonly mainTabs: ObservableSnapshot<MainTabsState>
    /** Panel id to localized label; bound by the renderer as `usePanelLabels`. */
    readonly panelLabels: HostObservable<ReadonlyMap<string, string>>
  }
  /** Show one tab's view in the main panel. */
  readonly activate: (key: string) => void
  /** Close one tab, keeping its Session running. */
  readonly close: (key: string) => void
  /** Close a set of tabs at once, keeping their Sessions running. */
  readonly closeMany: (keys: readonly string[]) => void
}

/** Full composed props: standard global hooks, the locale seat, and the injected face. */
export type MainTabStripProps =
  & Pick<PropsRuntime<'shell.maintabs'>, 'useSessions' | 'useSessionStatus'>
  & PropsLocale<'workspace'>
  & InjectFace<MainTabStripInjected>

/**
 * Render the main tab strip.
 * @param props - navigation signals and intents from the MainTabsController.
 * @returns the strip, or nothing without an open view.
 */
export function MainTabStrip({
  useSessions,
  useSessionStatus,
  useMainTabs,
  usePanelLabels,
  activate,
  close,
  closeMany,
  t,
}: MainTabStripProps): ReactNode {
  const { tabs, activeKey } = useMainTabs(state => state)
  const byId = useSessions(state => state.byId)
  const status = useSessionStatus(snapshot => snapshot)
  const panelLabels = usePanelLabels(labels => labels)
  const chips = useRef(new Map<string, HTMLElement>())
  const [menuOpen, setMenuOpen] = useState(false)
  // The selection mode is interaction state: it lives here and resets when the
  // strip unmounts without open views.
  const [selecting, setSelecting] = useState(false)
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set())
  if (tabs.length === 0) return null

  const focusChip = (key: string): void => {
    chips.current.get(key)?.focus()
  }

  const toggleChecked = (key: string): void => {
    setChecked((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const exitSelecting = (): void => {
    setSelecting(false)
    setChecked(new Set())
    setMenuOpen(false)
  }

  const menuItems: readonly MenuEntry[] = selecting ? [
    {
      id: 'closeSelected', danger: true, disabled: checked.size === 0,
      label: t('tabs.closeSelected', { n: String(checked.size) }),
    },
    { id: 'cancelSelect', label: t('tabs.cancelSelect') },
  ] : [
    { id: 'select', label: t('tabs.selectMode') },
    { id: 'closeAll', danger: true, label: t('tabs.closeAll') },
  ]

  const onMenuSelect = (id: string): void => {
    if (id === 'select') {
      setSelecting(true)
      setChecked(new Set())
      setMenuOpen(false)
      return
    }
    if (id === 'closeSelected') {
      closeMany([...checked])
      exitSelecting()
      return
    }
    if (id === 'closeAll') {
      closeMany(tabs.map(keyOf))
      exitSelecting()
      return
    }
    exitSelecting()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number, key: string): void => {
    if (event.target !== event.currentTarget) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return
    const count = tabs.length
    const focus: MainTab | undefined = (() => {
      switch (event.key) {
        case 'ArrowLeft': return tabs[(index - 1 + count) % count]
        case 'ArrowRight': return tabs[(index + 1) % count]
        case 'Home': return tabs[0]
        case 'End': return tabs.at(-1)
        default: return undefined
      }
    })()
    if (focus !== undefined) {
      event.preventDefault()
      focusChip(keyOf(focus))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (selecting) toggleChecked(key)
      else activate(key)
    }
  }

  const titleOf = (tab: MainTab): string => {
    if (tab.kind === 'panel') return panelLabels.get(tab.panelId) ?? tab.panelId
    const summary = byId[tab.sessionId]
    return summary?.blank ? t('session.new') : summary?.title ?? t('session.untitled')
  }

  const attentionOf = (tab: MainTab): StateDotState | undefined => {
    if (tab.kind !== 'session') return undefined
    const current = status.get(tab.sessionId)
    if (byId[tab.sessionId]?.running === true || current?.running === true) return 'ongoing'
    if (current?.pendingInteraction !== undefined) return 'warning'
    return undefined
  }

  return (
    <div className={clsx(css.strip, selecting && css.selecting)} data-selecting={selecting || undefined}>
      <div className={css.tabs} role="tablist" aria-label={t('tabs.stripLabel')}>
        {tabs.map((tab, index) => {
          const key = keyOf(tab)
          const selected = key === activeKey
          const attention = attentionOf(tab)
          return (
            <div
              key={key}
              role="tab"
              aria-selected={selected}
              aria-label={titleOf(tab)}
              tabIndex={selected ? 0 : -1}
              className={clsx(css.tab, selected && css.tabActive)}
              ref={(element) => {
                if (element === null) chips.current.delete(key)
                else chips.current.set(key, element)
              }}
              onKeyDown={(event) => { onKeyDown(event, index, key) }}
              // Prevent the middle button's autoscroll or selection paste before release.
              onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
              onAuxClick={(event) => {
                if (selecting || event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
                if (event.buttons === 0) close(key)
              }}
              onClick={() => {
                if (selecting) toggleChecked(key)
                else activate(key)
              }}
            >
              {selecting && (
                <input
                  type="checkbox"
                  className={css.select}
                  tabIndex={-1}
                  checked={checked.has(key)}
                  aria-label={t('tabs.selectTab', { title: titleOf(tab) })}
                  // The input keeps its own click: stopping propagation here
                  // leaves the chip's onClick for the rest of the chip.
                  onClick={(event) => { event.stopPropagation() }}
                  onChange={() => { toggleChecked(key) }}
                />
              )}
              {attention !== undefined && <StateDot state={attention} size={10} />}
              <span className={css.title}>{titleOf(tab)}</span>
              {!selecting && (
                <button
                  type="button"
                  className={css.close}
                  aria-label={t('tabs.close', { title: titleOf(tab) })}
                  // A nested control stops its own press so the chip's click never fires.
                  onPointerDown={(event) => { event.stopPropagation() }}
                  onClick={(event) => {
                    event.stopPropagation()
                    close(key)
                  }}
                >
                  <IconCloseFillRegular size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <Menu
        open={menuOpen}
        onClose={() => { setMenuOpen(false) }}
        onSelect={onMenuSelect}
        items={menuItems}
        align="end"
        anchor={(
          <button
            type="button"
            className={css.manage}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('tabs.manage')}
            onClick={() => { setMenuOpen(open => !open) }}
          >
            <IconChecklistOutlineRegular size={16} />
          </button>
        )}
      />
    </div>
  )
}
