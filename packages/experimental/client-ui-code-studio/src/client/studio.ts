/**
 * The code studio's panel controller: one snapshot store the page renders
 * with `useSyncExternalStore`, plus the Remote stream lifetimes behind it.
 *
 * One workspace is active at a time. Selecting it opens one language session
 * whose diagnostics fold into the snapshot; runs and debug sessions are
 * mutually independent streams whose frames append as output lines. The
 * controller owns every AbortController: the page unmounting or the plugin
 * unloading stops all children.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-code-studio/remote'
import type {
  CodeCallFrame, CodeCompletionItem, CodeDebugCommand, CodeDebugFrame, CodeDiagnostic, CodeDirEntry, CodeRunFrame,
} from '../types.ts'
import type { CodeStudioLocaleKey } from './locales.ts'

/** One appended output line: which stream it came from and its text. */
export interface OutputLine {
  readonly stream: 'stdout' | 'stderr' | 'console' | 'system'
  readonly text: string
}

/** Language session state folded from its stream. */
export interface LanguageState {
  readonly status: 'off' | 'starting' | 'ready' | 'failed'
  readonly langId: string | null
  readonly message: string | null
}

/** Debug session state folded from its stream. */
export interface DebugState {
  readonly status: 'idle' | 'starting' | 'paused' | 'running'
  readonly debugId: string | null
  readonly lines: readonly OutputLine[]
  readonly paused: { readonly callFrames: readonly CodeCallFrame[]; readonly selectedFrame: number } | null
}

/** Run stream state. */
export interface RunState {
  readonly status: 'idle' | 'running'
  readonly lines: readonly OutputLine[]
  readonly summary: string | null
}

/** The whole panel snapshot; every field immutable, replaced on change. */
export interface StudioState {
  readonly workspaceRoot: string | null
  readonly language: LanguageState
  readonly listings: ReadonlyMap<string, readonly CodeDirEntry[]>
  readonly expanded: ReadonlySet<string>
  readonly openFiles: readonly string[]
  readonly activeFile: string | null
  readonly fileTexts: ReadonlyMap<string, string>
  readonly dirty: ReadonlySet<string>
  readonly diagnostics: ReadonlyMap<string, readonly CodeDiagnostic[]>
  readonly breakpoints: ReadonlyMap<string, ReadonlySet<number>>
  readonly run: RunState
  readonly debug: DebugState
  readonly bottomTab: 'output' | 'debug'
}

const INITIAL: StudioState = {
  workspaceRoot: null,
  language: { status: 'off', langId: null, message: null },
  listings: new Map(),
  expanded: new Set(),
  openFiles: [],
  activeFile: null,
  fileTexts: new Map(),
  dirty: new Set(),
  diagnostics: new Map(),
  breakpoints: new Map(),
  run: { status: 'idle', lines: [], summary: null },
  debug: { status: 'idle', debugId: null, lines: [], paused: null },
  bottomTab: 'output',
}

/** Cap on retained output lines per stream, so a chatty program cannot grow the page without bound. */
const MAX_LINES = 5_000

/**
 * The panel controller over one Remote face.
 *
 * Streams are consumed with `await` inside fire-and-forget tasks that end by
 * themselves on error or abort; each holds one AbortController whose lifetime
 * the controller tracks in a Set for `dispose`.
 */
export class CodeStudio {
  private state: StudioState = INITIAL
  private readonly listeners = new Set<() => void>()
  private readonly controllers = new Set<AbortController>()
  private readonly pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>()
  private runController: AbortController | null = null
  private debugController: AbortController | null = null
  private langController: AbortController | null = null
  private disposed: boolean = false

  /** Post-`await` disposed read: a getter defeats control-flow narrowing of the field. */
  private get closed(): boolean {
    return this.disposed
  }

  /**
   * @param ctx - browser plugin context carrying the Remote face.
   * @param format - locale-aware message renderer for system lines.
   */
  constructor(
    private readonly ctx: Context,
    private readonly format: (key: CodeStudioLocaleKey, params?: Record<string, unknown>) => string,
  ) {}

  /** Current snapshot. */
  getSnapshot(): StudioState {
    return this.state
  }

  /** Subscribe to snapshot changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stop every stream and drop the state; the panel is gone. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    for (const timer of this.pendingSyncs.values()) clearTimeout(timer)
    this.pendingSyncs.clear()
    this.listeners.clear()
  }

  private update(patch: Partial<StudioState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** One controller per stream, registered for dispose and aborted when it ends. */
  private controller(): AbortController {
    const controller = new AbortController()
    this.controllers.add(controller)
    return controller
  }

  private release(controller: AbortController): void {
    this.controllers.delete(controller)
  }

  /**
   * Select the active workspace: stops the language session, resets listings
   * and files, and starts a fresh language session for the new root.
   * @param root - absolute workspace root path, or `null` to clear.
   */
  selectWorkspace(root: string | null): void {
    if (this.disposed || root === this.state.workspaceRoot) return
    for (const controller of [...this.controllers]) {
      // Language and child streams of the previous root do not carry over.
      controller.abort()
      this.release(controller)
    }
    this.runController = null
    this.debugController = null
    this.langController = null
    this.update({
      ...INITIAL,
      workspaceRoot: root,
      // The root starts expanded so the first listing shows without a click.
      expanded: root === null ? new Set() : new Set(['']),
      language: root === null ? INITIAL.language : { status: 'starting', langId: null, message: null },
    })
    if (root === null) return
    void this.openLanguage(root)
    void this.loadDirectory('')
  }

  /** List one directory level, folding it into the snapshot. */
  async loadDirectory(path: string): Promise<void> {
    const root = this.state.workspaceRoot
    if (root === null || this.disposed) return
    const result = await this.ctx.remote.codeStudio.list({ workspaceRoot: root, path })
    if (!result.ok || this.closed || this.state.workspaceRoot !== root) return
    this.update({ listings: new Map(this.state.listings).set(path, result.value) })
  }

  /**
   * Expand or collapse one directory; expanding loads its listing.
   * @param path - workspace-relative directory path.
   */
  toggleDirectory(path: string): void {
    const expanded = new Set(this.state.expanded)
    if (expanded.has(path)) {
      expanded.delete(path)
    } else {
      expanded.add(path)
      if (!this.state.listings.has(path)) void this.loadDirectory(path)
    }
    this.update({ expanded })
  }

  /**
   * Open one file: read it, add it to the tabs, and publish it to the language session.
   * @param path - workspace-relative file path.
   */
  async openFile(path: string): Promise<void> {
    const root = this.state.workspaceRoot
    if (root === null || this.disposed) return
    if (this.state.fileTexts.has(path)) {
      this.update({ activeFile: path })
      return
    }
    const file = await this.ctx.remote.codeStudio.read({ workspaceRoot: root, path })
    if (!file.ok || this.closed || this.state.workspaceRoot !== root) return
    const text = file.value?.text ?? ''
    const openFiles = [...this.state.openFiles]
    if (!openFiles.includes(path)) openFiles.push(path)
    this.update({ openFiles, activeFile: path, fileTexts: new Map(this.state.fileTexts).set(path, text) })
    if (file.value !== null) this.syncLanguage(path, text)
  }

  /** Close one file tab; the active tab moves to its neighbor. */
  closeFile(path: string): void {
    const openFiles = this.state.openFiles.filter(open => open !== path)
    const texts = new Map(this.state.fileTexts)
    texts.delete(path)
    const dirty = new Set(this.state.dirty)
    dirty.delete(path)
    const activeFile = this.state.activeFile === path ? openFiles.at(-1) ?? null : this.state.activeFile
    this.update({ openFiles, fileTexts: texts, dirty, activeFile })
    this.syncLanguage(path, null)
  }

  /** Make one open file the active tab. */
  setActiveFile(path: string): void {
    if (this.state.openFiles.includes(path)) this.update({ activeFile: path })
  }

  /**
   * Record one edit and debounce the language sync.
   * @param path - workspace-relative file path.
   * @param text - whole editor text after the edit.
   */
  editFile(path: string, text: string): void {
    const current = this.state.fileTexts.get(path)
    if (current === undefined || current === text) return
    this.update({
      fileTexts: new Map(this.state.fileTexts).set(path, text),
      dirty: new Set(this.state.dirty).add(path),
    })
    const earlier = this.pendingSyncs.get(path)
    if (earlier !== undefined) clearTimeout(earlier)
    this.pendingSyncs.set(path, setTimeout(() => {
      this.pendingSyncs.delete(path)
      this.syncLanguage(path, text)
    }, 300))
  }

  /**
   * Create one empty file in a workspace directory and open it.
   * @param directory - workspace-relative directory path, empty for the root.
   * @param name - file name inside `directory`.
   * @returns whether the file was created; false for a blank workspace, an
   * invalid name, an existing file, or a failed write.
   */
  async createFile(directory: string, name: string): Promise<boolean> {
    const root = this.state.workspaceRoot
    if (root === null || this.disposed) return false
    if (name.trim() === '' || name.includes('/')) return false
    const path = directory === '' ? name : `${directory}/${name}`
    const existing = await this.ctx.remote.codeStudio.read({ workspaceRoot: root, path })
    if (!existing.ok || existing.value !== null) return false
    const written = await this.ctx.remote.codeStudio.fileWrite({ workspaceRoot: root, path, text: '' })
    if (!written.ok || this.closed) return false
    await this.loadDirectory(directory)
    await this.openFile(path)
    return true
  }

  /**
   * Save one file to the workspace.
   * @param path - workspace-relative file path.
   * @returns whether the write succeeded.
   */
  async saveFile(path: string): Promise<boolean> {
    const root = this.state.workspaceRoot
    const text = this.state.fileTexts.get(path)
    if (root === null || text === undefined || this.disposed) return false
    try {
      const written = await this.ctx.remote.codeStudio.fileWrite({ workspaceRoot: root, path, text })
      if (!written.ok) return false
    } catch {
      return false
    }
    if (this.closed) return true
    const dirty = new Set(this.state.dirty)
    dirty.delete(path)
    this.update({ dirty })
    return true
  }

  /** Choose the bottom panel tab. */
  setBottomTab(tab: 'output' | 'debug'): void {
    this.update({ bottomTab: tab })
  }

  /** Drop all output lines of both streams. */
  clearOutput(): void {
    this.update({
      run: { ...this.state.run, lines: [], summary: null },
      debug: { ...this.state.debug, lines: [] },
    })
  }

  /**
   * Toggle one line breakpoint.
   * @param path - workspace-relative file path.
   * @param line - zero-based line.
   */
  toggleBreakpoint(path: string, line: number): void {
    const lines = new Set(this.state.breakpoints.get(path) ?? [])
    if (lines.has(line)) lines.delete(line)
    else lines.add(line)
    const breakpoints = new Map(this.state.breakpoints)
    if (lines.size === 0) breakpoints.delete(path)
    else breakpoints.set(path, lines)
    this.update({ breakpoints })
    if (this.state.debug.status === 'paused' || this.state.debug.status === 'running') {
      void this.debugCommand({ kind: 'setBreakpoints', path, lines: [...lines] })
    }
  }

  /**
   * Run the entry file, streaming its output until exit.
   * @param entryPath - workspace-relative entry file.
   */
  startRun(entryPath: string): void {
    const root = this.state.workspaceRoot
    if (root === null || this.disposed || this.state.run.status === 'running') return
    // The child runs the file on disk, so the editor's text is saved first;
    // an unsaved buffer otherwise runs stale bytes with no visible reason.
    void this.saveFile(entryPath).finally(() => { this.launchRun(root, entryPath) })
  }

  private launchRun(root: string, entryPath: string): void {
    if (this.disposed || this.state.run.status === 'running' || this.state.workspaceRoot !== root) return
    const controller = this.controller()
    this.runController = controller
    this.update({ run: { status: 'running', lines: [], summary: null }, bottomTab: 'output' })
    void (async () => {
      try {
        for await (const frame of this.ctx.remote.codeStudio.run(
          { workspaceRoot: root, entryPath }, controller.signal,
        )) {
          if (controller.signal.aborted) return
          this.consumeRun(frame)
        }
      } catch {
        // An aborted run is an expected end; failures already arrived as frames.
      } finally {
        this.release(controller)
        if (this.runController === controller) this.runController = null
        if (!controller.signal.aborted && this.state.run.status === 'running') {
          this.update({ run: { ...this.state.run, status: 'idle' } })
        }
      }
    })()
  }

  /** Stop the running program. */
  stopRun(): void {
    this.runController?.abort()
  }

  /**
   * Launch the entry under the debugger with the current breakpoints.
   * @param entryPath - workspace-relative entry file.
   */
  startDebug(entryPath: string): void {
    const root = this.state.workspaceRoot
    if (root === null || this.disposed || this.state.debug.status === 'paused' || this.state.debug.status === 'running') return
    // Same disk rule as a run: debug what the editor shows, not stale bytes.
    void this.saveFile(entryPath).finally(() => { this.launchDebug(root, entryPath) })
  }

  private launchDebug(root: string, entryPath: string): void {
    if (this.disposed || this.state.workspaceRoot !== root
      || this.state.debug.status === 'paused' || this.state.debug.status === 'running') return
    const breakpoints = [...this.state.breakpoints.entries()].flatMap(([path, lines]) =>
      [...lines].map(line => ({ path, line })))
    const controller = this.controller()
    this.debugController = controller
    this.update({ debug: { status: 'starting', debugId: null, lines: [], paused: null }, bottomTab: 'debug' })
    void (async () => {
      try {
        for await (const frame of this.ctx.remote.codeStudio.debugStart(
          { workspaceRoot: root, entryPath, breakpoints }, controller.signal,
        )) {
          if (controller.signal.aborted) return
          this.consumeDebug(frame)
        }
      } catch (error) {
        this.update({
          debug: {
            ...this.state.debug,
            status: 'idle',
            debugId: null,
            lines: append(this.state.debug.lines, { stream: 'system', text: this.format('debug.failed', { message: String(error) }) }),
          },
        })
      } finally {
        this.release(controller)
        if (this.debugController === controller) this.debugController = null
        if (!controller.signal.aborted && this.state.debug.status !== 'idle') {
          this.update({ debug: { ...this.state.debug, status: 'idle', debugId: null, paused: null } })
        }
      }
    })()
  }

  /** Stop the debug session and its child. */
  stopDebug(): void {
    const debugId = this.state.debug.debugId
    if (debugId !== null) void this.debugCommand({ kind: 'stop' })
    this.debugController?.abort()
    this.update({ debug: { status: 'idle', debugId: null, lines: this.state.debug.lines, paused: null } })
  }

  /**
   * Send one debugger command to the active session.
   * @param command - the command.
   */
  async debugCommand(command: CodeDebugCommand): Promise<void> {
    const debugId = this.state.debug.debugId
    if (debugId === null) return
    try {
      await this.ctx.remote.codeStudio.debugCommand({ debugId, command })
    } catch {
      // A dead session reports itself through its stream.
    }
  }

  /** Choose one paused stack frame for the variables view. */
  selectFrame(index: number): void {
    const paused = this.state.debug.paused
    if (paused === null || index < 0 || index >= paused.callFrames.length) return
    this.update({ debug: { ...this.state.debug, paused: { ...paused, selectedFrame: index } } })
  }

  /**
   * Completions at one position of an open file.
   * @param path - workspace-relative file path.
   * @param line - zero-based line.
   * @param character - zero-based UTF-16 column.
   * @returns completion items, empty when no session is ready.
   */
  async complete(path: string, line: number, character: number): Promise<readonly CodeCompletionItem[]> {
    const { langId } = this.state.language
    if (langId === null) return []
    try {
      const result = await this.ctx.remote.codeStudio.langComplete({ langId, path, line, character })
      return result.ok ? result.value : []
    } catch {
      return []
    }
  }

  /**
   * Hover text at one position of an open file.
   * @param path - workspace-relative file path.
   * @param line - zero-based line.
   * @param character - zero-based UTF-16 column.
   * @returns hover text, or `null`.
   */
  async hover(path: string, line: number, character: number): Promise<string | null> {
    const { langId } = this.state.language
    if (langId === null) return null
    try {
      const result = await this.ctx.remote.codeStudio.langHover({ langId, path, line, character })
      return result.ok ? result.value : null
    } catch {
      return null
    }
  }

  private consumeRun(frame: CodeRunFrame): void {
    const run = this.state.run
    switch (frame.kind) {
      case 'started':
        this.update({ run: { ...run, lines: append(run.lines, { stream: 'system', text: `$ ${frame.runtime}` }) } })
        return
      case 'stdout':
      case 'stderr':
        this.update({ run: { ...run, lines: append(run.lines, { stream: frame.kind, text: frame.text }) } })
        return
      case 'exit': {
        const summary = frame.timedOut
          ? this.format('run.timeout')
          : frame.exitCode === null
            ? this.format('run.exitSignal', { signal: frame.signal ?? '' })
            : this.format('run.exit', { code: frame.exitCode })
        this.update({ run: { status: 'idle', lines: append(run.lines, { stream: 'system', text: summary }), summary } })
      }
    }
  }

  private consumeDebug(frame: CodeDebugFrame): void {
    const debug = this.state.debug
    switch (frame.kind) {
      case 'started':
        this.update({ debug: { ...debug, status: 'running', debugId: frame.debugId } })
        return
      case 'console':
        this.update({ debug: { ...debug, lines: append(debug.lines, { stream: 'console', text: frame.text }) } })
        return
      case 'stdout':
      case 'stderr':
        this.update({ debug: { ...debug, lines: append(debug.lines, { stream: frame.kind, text: frame.text }) } })
        return
      case 'paused':
        this.update({ debug: { ...debug, status: 'paused', paused: { callFrames: frame.callFrames, selectedFrame: 0 } } })
        return
      case 'resumed':
        this.update({ debug: { ...debug, status: 'running', paused: null } })
        return
      case 'breakpoints':
      case 'exit':
        if (frame.kind === 'exit') {
          this.update({
            debug: {
              ...debug,
              status: 'idle',
              debugId: null,
              paused: null,
              lines: append(debug.lines, { stream: 'system', text: this.format('run.exit', { code: frame.exitCode ?? 'signal' }) }),
            },
          })
        }
    }
  }

  private syncLanguage(path: string, text: string | null): void {
    const { langId } = this.state.language
    if (langId === null) return
    try {
      void this.ctx.remote.codeStudio.langSync({ langId, path, text })
    } catch {
      // A dead language session reports itself through its stream.
    }
  }

  private async openLanguage(root: string): Promise<void> {
    const controller = this.controller()
    this.langController = controller
    try {
      for await (const frame of this.ctx.remote.codeStudio.langStart({ workspaceRoot: root }, controller.signal)) {
        if (controller.signal.aborted) return
        if (frame.kind === 'started') {
          this.update({ language: { status: 'ready', langId: frame.langId, message: null } })
          // The fresh session knows no documents; publish every open file.
          for (const path of this.state.openFiles) {
            const text = this.state.fileTexts.get(path)
            if (text !== undefined) this.syncLanguage(path, text)
          }
        } else if (frame.kind === 'failed') {
          this.update({ language: { status: 'failed', langId: null, message: frame.message } })
          return
        } else {
          const diagnostics = new Map(this.state.diagnostics)
          diagnostics.set(frame.path, frame.diagnostics)
          this.update({ diagnostics })
        }
      }
    } catch {
      // The aborted session is the expected end of the stream.
    } finally {
      this.release(controller)
      if (this.langController === controller) this.langController = null
    }
  }
}

/** Append with the shared cap, dropping from the front. */
function append(lines: readonly OutputLine[], line: OutputLine): readonly OutputLine[] {
  const next = [...lines, line]
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
}
