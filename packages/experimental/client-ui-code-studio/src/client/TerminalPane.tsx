/**
 * The workspace terminal: one xterm view over the code studio's PTY stream.
 * The shell follows the selected workspace root; typed text and resizes go
 * back through the Remote, and closing the panel or switching workspaces
 * tears the shell down with the stream.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { Context } from '@deepseek-ai/cordis'
import '@xterm/xterm/css/xterm.css'
import type { CodeStudioLocaleKey } from './locales.ts'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** Loaded xterm module face this pane uses. */
type XtermModule = typeof import('@xterm/xterm')

/** One xterm module load shared by every pane instance. */
let xtermPromise: Promise<XtermModule> | null = null

/** Load xterm once per page; a single dynamic import keeps the chunk self-contained. */
function loadXterm(): Promise<XtermModule> {
  xtermPromise ??= import('@xterm/xterm')
  return xtermPromise
}

/**
 * Render one interactive shell in the given workspace root.
 * @param props - the plugin context carrying the Remote, the canonical root, and the translate function.
 * @returns the terminal pane.
 */
export function TerminalPane({ ctx, root, t }: {
  readonly ctx: Context
  readonly root: string
  readonly t: Translate<CodeStudioLocaleKey>
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  // One terminal lifetime per (ctx, root): stream, view, input, and resizes
  // all live inside this effect and unwind together.
  useEffect(() => {
    let terminal: Terminal | undefined
    let input: ((data: string) => void) | undefined
    let resize: ((cols: number, rows: number) => void) | undefined
    let closed = false
    const controller = new AbortController()
    void (async () => {
      let xterm: XtermModule
      try {
        xterm = await loadXterm()
      } catch {
        setFailed('xterm failed to load')
        return
      }
      const element = host.current
      if (element === null || closed) return
      const remote = ctx.remote.codeStudio
      const view = new xterm.Terminal({ fontSize: 12, cursorBlink: true, theme: { background: '#1e1e1e' } })
      terminal = view
      view.open(element)
      // Character cell size drives the container-fit resize math.
      const cell = view._core?._renderService?.dimensions ?? undefined
      const charWidth = cell?.cssCellWidth ?? 8
      const charHeight = cell?.cssCellHeight ?? 17
      const fit = (): void => {
        const rect = element.getBoundingClientRect()
        const cols = Math.max(2, Math.floor(rect.width / charWidth) - 2)
        const rows = Math.max(2, Math.floor(rect.height / charHeight) - 1)
        if (view.cols !== cols || view.rows !== rows) view.resize(cols, rows)
      }
      fit()
      view.onData((data) => { input?.(data) })
      try {
        for await (const frame of remote.terminalStart({ workspaceRoot: root, cols: view.cols, rows: view.rows }, controller.signal)) {
          if (controller.signal.aborted) return
          if (frame.kind === 'started') {
            const id = frame.terminalId
            input = (data) => { void remote.terminalInput({ terminalId: id, data }) }
            resize = (cols, rows) => { void remote.terminalResize({ terminalId: id, cols, rows }) }
            setReady(true)
          } else if (frame.kind === 'output') {
            view.write(frame.text)
          } else {
            view.write(`\r\n\x1b[90m${t('output.terminalExited', { code: frame.exitCode ?? 'signal' })}\x1b[0m\r\n`)
            input = undefined
            resize = undefined
          }
        }
      } catch {
        // An aborted stream is the pane's own teardown; anything else ends the view.
        if (!controller.signal.aborted) setFailed(t('output.terminalFailed'))
      }
    })()
    const observer = new ResizeObserver(() => {
      fitInView()
      function fitInView(): void {
        // The fit reads the view the effect closure owns; defer until it exists.
        const rect = host.current?.getBoundingClientRect()
        if (rect === undefined) return
        fitTo(rect.width, rect.height)
      }
      function fitTo(width: number, height: number): void {
        const view = terminal
        if (view === undefined) return
        const cols = Math.max(2, Math.floor(width / charSize().width) - 2)
        const rows = Math.max(2, Math.floor(height / charSize().height) - 1)
        if (view.cols !== cols || view.rows !== rows) view.resize(cols, rows)
        resize?.(cols, rows)
      }
      function charSize(): { width: number; height: number } {
        const cell = view0()?._core?._renderService?.dimensions
        return { width: cell?.cssCellWidth ?? 8, height: cell?.cssCellHeight ?? 17 }
      }
      function view0(): Terminal | undefined {
        return terminal
      }
    })
    if (host.current !== null) observer.observe(host.current)
    return () => {
      closed = true
      controller.abort()
      observer.disconnect()
      terminal?.dispose()
    }
  }, [ctx, root, t])

  return (
    <div className="code-studio-terminal">
      <div ref={host} className="code-studio-terminal-host" />
      {failed === null ? null : <div className="code-studio-output-empty">{failed}</div>}
      {ready || failed !== null ? null : <div className="code-studio-output-empty">…</div>}
    </div>
  )
}
