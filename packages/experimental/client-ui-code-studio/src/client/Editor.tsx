/**
 * The Monaco editor surface: one model per open file, the active tab's model
 * attached, breakpoint glyphs toggled from the gutter, the paused line
 * highlighted, and Cmd/Ctrl+S saving the active file. Models are the source
 * of truth after creation; the controller mirrors their text.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type * as Monaco from 'monaco-editor'
import type { CodeStudio, StudioState } from './studio.ts'
import type { MonacoApi } from './monaco.ts'
import { modelUri, monacoLanguageOf, pathOfModelUri } from './monaco.ts'

/**
 * Render the active file's editor.
 * @param props - the panel controller, snapshot, and loaded editor API.
 * @returns the editor pane.
 */
export function EditorPane({ studio, state, monaco }: {
  readonly studio: CodeStudio
  readonly state: StudioState
  readonly monaco: MonacoApi
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null)
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorations = useRef<string[]>([])

  useEffect(() => {
    const element = host.current
    if (element === null) return
    const instance = monaco.editor.create(element, {
      automaticLayout: true,
      // The classic textarea input path; the EditContext surface still has
      // host quirks and buys nothing over it for a plain editor.
      editContext: false,
      glyphMargin: true,
      minimap: { enabled: false },
      wordBasedSuggestions: 'off',
      quickSuggestions: { other: true, comments: false, strings: true },
      fontSize: 13,
      scrollBeyondLastLine: false,
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs',
    })
    editor.current = instance
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = studio.getSnapshot().activeFile
      if (path !== null) void studio.saveFile(path)
    })
    const changes = instance.onDidChangeModelContent(() => {
      const model = instance.getModel()
      const path = model === null ? null : pathOfModelUri(model.uri)
      if (path !== null && model !== null) studio.editFile(path, model.getValue())
    })
    const clicks = instance.onMouseDown((event) => {
      const model = instance.getModel()
      const path = model === null ? null : pathOfModelUri(model.uri)
      if (path === null || event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      studio.toggleBreakpoint(path, event.target.position.lineNumber - 1)
    })
    return () => {
      decorations.current = []
      clicks.dispose()
      changes.dispose()
      instance.dispose()
      editor.current = null
    }
  }, [monaco, studio])

  // One model per open file; closed files lose theirs.
  useEffect(() => {
    const open = new Set(state.openFiles)
    for (const model of monaco.editor.getModels()) {
      const path = pathOfModelUri(model.uri)
      if (path !== null && !open.has(path)) model.dispose()
    }
    for (const path of state.openFiles) {
      if (monaco.editor.getModel(modelUri(monaco, path)) === null) {
        monaco.editor.createModel(state.fileTexts.get(path) ?? '', monacoLanguageOf(path), modelUri(monaco, path))
      }
    }
  }, [monaco, state.openFiles, state.fileTexts])

  // The active tab's model is what the editor shows.
  useEffect(() => {
    const instance = editor.current
    if (instance === null) return
    const path = state.activeFile
    const model = path === null ? null : monaco.editor.getModel(modelUri(monaco, path))
    if (instance.getModel() !== model) instance.setModel(model)
  }, [monaco, state.activeFile])

  // Breakpoint glyphs and the paused line ride on decorations.
  useEffect(() => {
    const path = state.activeFile
    if (path === null) return
    const model = monaco.editor.getModel(modelUri(monaco, path))
    if (model === null) {
      decorations.current = []
      return
    }
    const paused = state.debug.paused
    const frame = paused?.callFrames[paused.selectedFrame] ?? paused?.callFrames[0]
    const next: Monaco.editor.IModelDeltaDecoration[] = []
    for (const line of state.breakpoints.get(path) ?? []) {
      next.push({
        range: new monaco.Range(line + 1, 1, line + 1, 1),
        options: { isWholeLine: true, glyphMarginClassName: 'code-studio-breakpoint' },
      })
    }
    if (frame !== undefined && frame.path === path) {
      next.push({
        range: new monaco.Range(frame.line + 1, 1, frame.line + 1, 1),
        options: { isWholeLine: true, className: 'code-studio-paused-line' },
      })
    }
    decorations.current = model.deltaDecorations(decorations.current, next)
  }, [monaco, state.activeFile, state.breakpoints, state.debug.paused])

  return <div ref={host} className={state.activeFile === null ? 'code-studio-editor-empty' : 'code-studio-editor'} />
}

/** Editor API type re-exported for the page. */
export type { MonacoApi } from './monaco.ts'
