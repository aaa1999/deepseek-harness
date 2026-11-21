/**
 * The code studio page: a workspace picker and run/debug controls on top,
 * the file tree and editor in the middle, and the output or debug console
 * along the bottom. The editor loads lazily with the first selected file.
 */

import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { EditorPane } from './Editor.tsx'
import type { MonacoApi } from './monaco.ts'
import { loadMonaco, registerEditorServices } from './monaco.ts'
import { DebugPane, FilePane, OutputPane } from './panes.tsx'
import { TerminalPane } from './TerminalPane.tsx'
import './CodeStudio.css'
import type { CodeStudio } from './studio.ts'

/** One workspace row of the picker's source. */
interface WorkspaceSummary {
  readonly workspaceId: string
  readonly path: string
}

/** What the page asks of its registration. */
export interface CodeStudioInjected {
  /** The panel controller, owned by the plugin lifetime. */
  readonly studio: CodeStudio
  /** The Host's workspace list. */
  readonly workspaces: HostObservable<{ readonly items: readonly WorkspaceSummary[] }>
  /** Pick one directory with the system or in-app chooser; `null` cancels. */
  readonly pickDirectory: () => Promise<string | null>
  /** Register one directory as a Workspace, idempotently, and return its canonical path. */
  readonly createWorkspace: (path: string) => Promise<string>
}

/** Full props of the code studio page. */
export type CodeStudioPageProps = InjectFace<CodeStudioInjected> & PropsLocale<typeof NS> & { readonly ctx: Context }

/** Locale namespace of the panel, referenced by the props type. */
const NS = 'codeStudio'

/**
 * Render the code studio panel.
 * @param props - the panel controller, the workspace source, and the bound translate function.
 * @returns the panel.
 */
export function CodeStudioPage({ studio, workspaces, pickDirectory, createWorkspace, ctx, t }: CodeStudioPageProps): ReactNode {
  const state = useSyncExternalStore(onChange => studio.subscribe(onChange), () => studio.getSnapshot())
  const listed = useSyncExternalStore(
    onChange => workspaces.subscribe(onChange),
    () => workspaces.getSnapshot(),
  )
  const [monaco, setMonaco] = useState<MonacoApi | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // A picked directory registers as a Workspace (idempotently), then opens; the
  // registry list refreshes through the workspaces observable.
  const openPickedDirectory = (): void => {
    setNotice(null)
    void (async () => {
      try {
        const picked = await pickDirectory()
        if (picked === null) return
        const canonical = await createWorkspace(picked)
        studio.selectWorkspace(canonical)
      } catch (error) {
        setNotice(t('workspace.addFailed', { message: error instanceof Error ? error.message : String(error) }))
      }
    })()
  }

  useEffect(() => {
    let withdrawn = false
    void loadMonaco().then((api) => {
      if (!withdrawn) setMonaco(api)
    })
    return () => { withdrawn = true }
  }, [])

  useEffect(() => {
    if (monaco === null) return
    return registerEditorServices(monaco, studio)
  }, [monaco, studio])

  useEffect(() => {
    // The first listed workspace opens automatically; later picks stay the user's.
    const first = listed.items[0]
    if (state.workspaceRoot === null && first !== undefined) studio.selectWorkspace(first.path)
  })

  const entry = state.activeFile
  const debugging = state.debug.status !== 'idle'

  return (
    <div className="code-studio">
      <header className="code-studio-bar">
        <select
          className="code-studio-workspace"
          value={state.workspaceRoot ?? ''}
          onChange={(event) => { studio.selectWorkspace(event.target.value === '' ? null : event.target.value) }}
        >
          {listed.items.length === 0 ? <option value="">{t('workspace.empty')}</option> : null}
          {listed.items.map(item => <option key={item.workspaceId} value={item.path}>{item.path}</option>)}
        </select>
        <button type="button" className="code-studio-button" onClick={openPickedDirectory}>{t('workspace.add')}</button>
        {notice === null ? null : <span className="code-studio-lang code-studio-lang-failed">{notice}</span>}
        <span className={`code-studio-lang code-studio-lang-${state.language.status}`}>
          {state.language.status === 'starting' ? t('lang.starting')
            : state.language.status === 'failed' ? t('lang.failed', { message: state.language.message ?? '' })
              : null}
        </span>
        <span className="code-studio-spacer" />
        {debugging ? (
          <>
            <button type="button" className="code-studio-button" disabled={state.debug.status !== 'paused'} onClick={() => { void studio.debugCommand({ kind: 'resume' }) }}>{t('debug.resume')}</button>
            <button type="button" className="code-studio-button" disabled={state.debug.status !== 'running'} onClick={() => { void studio.debugCommand({ kind: 'pause' }) }}>{t('debug.pause')}</button>
            <button type="button" className="code-studio-button" disabled={state.debug.status !== 'paused'} onClick={() => { void studio.debugCommand({ kind: 'stepOver' }) }}>{t('debug.stepOver')}</button>
            <button type="button" className="code-studio-button" disabled={state.debug.status !== 'paused'} onClick={() => { void studio.debugCommand({ kind: 'stepInto' }) }}>{t('debug.stepInto')}</button>
            <button type="button" className="code-studio-button" disabled={state.debug.status !== 'paused'} onClick={() => { void studio.debugCommand({ kind: 'stepOut' }) }}>{t('debug.stepOut')}</button>
            <button type="button" className="code-studio-button" onClick={() => { studio.stopDebug() }}>{t('debug.stop')}</button>
          </>
        ) : (
          <button
            type="button"
            className="code-studio-button"
            disabled={entry === null || state.run.status === 'running'}
            onClick={() => { if (entry !== null) studio.startRun(entry) }}
          >{state.run.status === 'running' ? t('run.running') : t('run.action')}</button>
        )}
        <button
          type="button"
          className="code-studio-button"
          disabled={entry === null || state.debug.status === 'starting' || state.debug.status === 'paused' || state.debug.status === 'running'}
          onClick={() => { if (entry !== null) studio.startDebug(entry) }}
        >{state.debug.status === 'starting' ? t('debug.starting') : t('debug.start')}</button>
        {state.run.status === 'running' && !debugging ? (
          <button type="button" className="code-studio-button" onClick={() => { studio.stopRun() }}>{t('run.stop')}</button>
        ) : null}
      </header>
      <div className="code-studio-main">
        <FilePane studio={studio} state={state} t={t} />
        <section className="code-studio-editor-area">
          {monaco === null || state.activeFile === null
            ? <div className="code-studio-editor-placeholder">{state.workspaceRoot === null ? t('workspace.noneSelected') : t('editor.noFile')}</div>
            : <EditorPane studio={studio} state={state} monaco={monaco} />}
        </section>
      </div>
      <footer className="code-studio-bottom">
        <div className="code-studio-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={state.bottomTab === 'output'}
            className={`code-studio-tab${state.bottomTab === 'output' ? ' code-studio-tab-active' : ''}`}
            onClick={() => { studio.setBottomTab('output') }}
          >{t('output.title')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={state.bottomTab === 'debug'}
            className={`code-studio-tab${state.bottomTab === 'debug' ? ' code-studio-tab-active' : ''}`}
            onClick={() => { studio.setBottomTab('debug') }}
          >{t('output.debugTitle')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={state.bottomTab === 'terminal'}
            className={`code-studio-tab${state.bottomTab === 'terminal' ? ' code-studio-tab-active' : ''}`}
            onClick={() => { studio.setBottomTab('terminal') }}
          >{t('output.terminalTitle')}</button>
        </div>
        {state.bottomTab === 'output'
          ? <OutputPane state={state} t={t} />
          : state.bottomTab === 'debug'
            ? <DebugPane studio={studio} state={state} t={t} />
            : state.workspaceRoot === null ? null : <TerminalPane ctx={ctx} root={state.workspaceRoot} t={t} />}
      </footer>
    </div>
  )
}

/** Translate function shape re-exported for the pane components. */
export type { Translate }
