/**
 * The three supporting panes of the code studio page: the workspace file
 * tree with its create-file affordances, the run output console, and the
 * debug stack-and-variables view.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { CodeStudioLocaleKey } from './locales.ts'
import type { CodeStudio, OutputLine, StudioState } from './studio.ts'

/** The inline naming row that creates one file in a directory. */
function CreateFileRow({ studio, directory, t, onDone }: {
  readonly studio: CodeStudio
  readonly directory: string
  readonly t: Translate<CodeStudioLocaleKey>
  readonly onDone: () => void
}): ReactNode {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const finish = (): void => {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed.includes('/')) {
      setError(t('files.nameInvalid'))
      return
    }
    void studio.createFile(directory, trimmed).then((created) => {
      if (created) onDone()
      else setError(t('files.exists'))
    })
  }
  return (
    <div className="code-studio-create">
      <input
        autoFocus
        className="code-studio-create-input"
        placeholder={t('files.namePlaceholder')}
        value={name}
        onChange={(event) => { setName(event.target.value); setError(null) }}
        onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') finish()
          if (event.key === 'Escape') onDone()
        }}
        onBlur={onDone}
      />
      {error === null ? null : <div className="code-studio-create-error">{error}</div>}
    </div>
  )
}

/** Recursive directory rows of the file tree. */
function DirectoryRows({ studio, state, t, creating, beginCreate, openMenu, path, depth }: {
  readonly studio: CodeStudio
  readonly state: StudioState
  readonly t: Translate<CodeStudioLocaleKey>
  readonly creating: string | null
  readonly beginCreate: (directory: string | null) => void
  readonly openMenu: (event: ReactMouseEvent, directory: string) => void
  readonly path: string
  readonly depth: number
}): ReactNode {
  if (!state.expanded.has(path)) return null
  const entries = state.listings.get(path)
  const creatingHere = creating === path
    ? <CreateFileRow key="create" studio={studio} directory={path} t={t} onDone={() => { beginCreate(null) }} />
    : null
  if (entries === undefined) {
    return <div className="code-studio-tree-note" style={{ paddingLeft: depth * 12 + 24 }}>…</div>
  }
  return [
    creatingHere,
    entries.length === 0 && !creatingHere
      ? <div key="empty" className="code-studio-tree-note" style={{ paddingLeft: depth * 12 + 24 }}>–</div>
      : null,
    entries.map((entry) => {
      const child = path === '' ? entry.name : `${path}/${entry.name}`
      if (entry.directory) {
        return [
          <button
            key={child}
            type="button"
            className="code-studio-tree-row"
            style={{ paddingLeft: depth * 12 + 12 }}
            onClick={() => { studio.toggleDirectory(child) }}
            onContextMenu={(event) => { openMenu(event, child) }}
          >
            <span aria-hidden>{state.expanded.has(child) ? '▾' : '▸'}</span> {entry.name}
          </button>,
          <DirectoryRows
            key={`${child}/`}
            studio={studio} state={state} t={t} creating={creating} beginCreate={beginCreate} openMenu={openMenu}
            path={child} depth={depth + 1}
          />,
        ]
      }
      return (
        <button
          key={child}
          type="button"
          className={`code-studio-tree-row code-studio-tree-file${state.activeFile === child ? ' code-studio-tree-active' : ''}`}
          style={{ paddingLeft: depth * 12 + 24 }}
          onClick={() => { void studio.openFile(child) }}
          onContextMenu={(event) => { openMenu(event, path) }}
        >
          {entry.name}
        </button>
      )
    }),
  ]
}

/**
 * The workspace file tree: the header's plus creates a file in the root, a
 * directory's context menu creates one inside it, and the name is typed into
 * an inline row above the listing.
 * @param props - the panel controller, snapshot, and translate function.
 * @returns the file pane.
 */
export function FilePane({ studio, state, t }: {
  readonly studio: CodeStudio
  readonly state: StudioState
  readonly t: Translate<CodeStudioLocaleKey>
}): ReactNode {
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number; readonly directory: string } | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // One open affordance: a dismissed menu or finished row clears the other.
  const beginCreate = (directory: string | null): void => {
    setMenu(null)
    setCreating(directory)
  }

  // The menu closes on outside pointer or Escape.
  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const openMenu = (event: ReactMouseEvent, directory: string): void => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, directory })
  }

  if (state.workspaceRoot === null) return null
  return (
    <div className="code-studio-files">
      <div className="code-studio-tree-head">
        <div className="code-studio-pane-title">{t('files.title')}</div>
        <button
          type="button"
          className="code-studio-tree-new"
          title={t('files.newFile')}
          onClick={() => { beginCreate('') }}
        >+</button>
      </div>
      <div className="code-studio-tree">
        <DirectoryRows
          studio={studio} state={state} t={t}
          creating={creating} beginCreate={beginCreate} openMenu={openMenu}
          path="" depth={0}
        />
      </div>
      {menu === null ? null : (
        <div ref={menuRef} className="code-studio-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            type="button"
            className="code-studio-menu-item"
            onClick={() => { beginCreate(menu.directory) }}
          >{t('files.newFile')}</button>
        </div>
      )}
    </div>
  )
}

/** One appended output block; auto-scrolls to the end while stuck to it. */
function OutputLines({ lines, empty }: { readonly lines: readonly OutputLine[]; readonly empty: string }): ReactNode {
  const scroller = useRef<HTMLDivElement | null>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const element = scroller.current
    if (element !== null && pinned.current) element.scrollTop = element.scrollHeight
  }, [lines])
  return (
    <div
      ref={scroller}
      className="code-studio-output"
      onScroll={() => {
        const element = scroller.current
        pinned.current = element !== null
          && element.scrollHeight - element.scrollTop - element.clientHeight < 24
      }}
    >
      {lines.length === 0 ? <div className="code-studio-output-empty">{empty}</div> : lines.map((line, index) => (
        <pre key={index} className={`code-studio-output-line code-studio-output-${line.stream}`}>{line.text}</pre>
      ))}
    </div>
  )
}

/**
 * The run output console.
 * @param props - the snapshot and translate function.
 * @returns the output pane.
 */
export function OutputPane({ state, t }: {
  readonly state: StudioState
  readonly t: Translate<CodeStudioLocaleKey>
}): ReactNode {
  return <OutputLines lines={state.run.lines} empty={t('output.empty')} />
}

/**
 * The debug console, stack, and variables view.
 * @param props - the panel controller, snapshot, and translate function.
 * @returns the debug pane.
 */
export function DebugPane({ studio, state, t }: {
  readonly studio: CodeStudio
  readonly state: StudioState
  readonly t: Translate<CodeStudioLocaleKey>
}): ReactNode {
  const paused = state.debug.paused
  const frame = paused?.callFrames[paused.selectedFrame] ?? paused?.callFrames[0]
  return (
    <div className="code-studio-debug">
      <OutputLines lines={state.debug.lines} empty={t('output.empty')} />
      <div className="code-studio-debug-side">
        <div className="code-studio-pane-title">{t('stack.title')}</div>
        {paused == null ? <div className="code-studio-tree-note">{t('stack.empty')}</div> : (
          <div className="code-studio-stack">
            {paused.callFrames.map((callFrame, index) => (
              <button
                key={index}
                type="button"
                className={`code-studio-stack-row${index === paused.selectedFrame ? ' code-studio-tree-active' : ''}`}
                onClick={() => {
                  studio.selectFrame(index)
                  void studio.openFile(callFrame.path)
                }}
              >
                <span className="code-studio-stack-name">{callFrame.functionName || t('debug.anonymousFunction')}</span>
                <span className="code-studio-stack-site">{callFrame.path}:{callFrame.line + 1}</span>
              </button>
            ))}
          </div>
        )}
        <div className="code-studio-pane-title">{t('variables.title')}</div>
        <div className="code-studio-variables">
          {frame == null ? <div className="code-studio-tree-note">{t('variables.empty')}</div> : (
            frame.scopes.map((scope, index) => (
              <div key={index} className="code-studio-scope">
                <div className="code-studio-scope-name">{scope.name}</div>
                {scope.variables.map(variable => (
                  <div key={variable.name} className="code-studio-variable">
                    <span className="code-studio-variable-name">{variable.name}</span>
                    <span className="code-studio-variable-value">{variable.value}</span>
                  </div>
                ))}
                {scope.truncated ? <div className="code-studio-tree-note">{t('variables.truncated')}</div> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
