/**
 * The workspace terminal: one xterm view over the code studio's PTY stream.
 * The shell follows the selected workspace root; typed text and resizes go
 * back through the Remote, and closing the panel or switching workspaces
 * tears the shell down with the stream.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Context } from '@deepseek-ai/cordis'
import '@xterm/xterm/css/xterm.css'
import type { CodeStudioLocaleKey } from './locales.ts'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

// xterm and its fit addon stay static imports: they are small, and extra
// dynamic imports would give the build shared chunks the module loader
// cannot resolve.

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
  const fitterRef = useRef<FitAddon | null>(null)
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
    const fit = (): void => {
      try {
        fitterRef.current?.fit()
      } catch {
        // A fit against a detached view is a no-op for the next observer pass.
      }
    }
    void (async () => {
      const holder = host.current
      if (holder === null || closed) return
      const remote = ctx.remote.codeStudio
      const view = new Terminal({ fontSize: 12, cursorBlink: true, theme: { background: '#1e1e1e' } })
      terminal = view
      const fitter = new FitAddon()
      fitterRef.current = fitter
      view.loadAddon(fitter)
      view.open(holder)
      fitter.fit()
      let id = ''
      input = (data) => { void remote.terminalInput({ terminalId: id, data }) }
      resize = (cols, rows) => { void remote.terminalResize({ terminalId: id, cols, rows }) }
      view.onData((data) => { input?.(data) })
      try {
        for await (const frame of remote.terminalStart({ workspaceRoot: root, cols: view.cols, rows: view.rows }, controller.signal)) {
          if (controller.signal.aborted) return
          if (frame.kind === 'started') {
            id = frame.terminalId
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
        // An aborted stream is this pane's own teardown; anything else ends the view.
        if (!controller.signal.aborted) setFailed(t('output.terminalFailed'))
      }
    })()
    const observer = new ResizeObserver(() => {
      fit()
      if (terminal !== undefined) resize?.(terminal.cols, terminal.rows)
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
