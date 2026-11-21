/**
 * Lazy Monaco loader and its editor bindings. Only the core editor plus the
 * TypeScript, JavaScript, and JSON tokenizers load — no language workers, so
 * the bundle stays out of the panel until the first file opens. Completions,
 * hover, and markers come from the code studio Remote through the panel
 * controller instead of Monaco's own language services.
 */

import type * as Monaco from 'monaco-editor'
import type { CodeDiagnostic } from '../types.ts'
import type { CodeStudio } from './studio.ts'

/** Shape of the loaded editor API this panel uses. */
export type MonacoApi = typeof Monaco

let monacoPromise: Promise<MonacoApi> | null = null

/**
 * Load the editor API once per page. The panel shares the single instance;
 * repeated callers await the same load.
 * @returns the Monaco editor namespace with TS/JS/JSON tokenizers registered.
 */
export function loadMonaco(): Promise<MonacoApi> {
  monacoPromise ??= (async () => {
    // editor.main pulls the whole editor core, its contributions, and their
    // stylesheet chain; editor.api alone ships no CSS, which leaves the editor
    // surface unable to take focus or input.
    // One dynamic import keeps the editor a single self-contained chunk:
    // extra dynamic imports of pieces the whole-file entry already carries
    // would make rolldown split a shared chunk the loader cannot resolve.
    return await import('monaco-editor/esm/vs/editor/editor.main.js')
  })()
  return monacoPromise
}

/**
 * Monaco language id of one workspace file path.
 * @param path - the workspace file path.
 * @returns the Monaco language id.
 */
export function monacoLanguageOf(path: string): string {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  return 'plaintext'
}

/** Model uri scheme of the panel's in-memory files. */
const URI_SCHEME = 'code-studio'

/**
 * Build one file's model uri.
 * @param monaco - the loaded editor API.
 * @param path - the workspace file path.
 * @returns the in-memory model uri.
 */
export function modelUri(monaco: MonacoApi, path: string): Monaco.Uri {
  return monaco.Uri.from({ scheme: URI_SCHEME, path: `/${path}` })
}

/**
 * The file path a panel model uri names, or `null` for anything else.
 * @param uri - the uri to decode.
 * @returns the workspace file path, or `null` for any other uri.
 */
export function pathOfModelUri(uri: { readonly scheme: string; readonly path: string }): string | null {
  return uri.scheme === URI_SCHEME && uri.path.startsWith('/') ? uri.path.slice(1) : null
}

/**
 * Register the panel's completion, hover, and marker bindings once. Markers
 * follow the controller's diagnostics snapshot; providers call back into the
 * controller's language session.
 * @param monaco - the loaded editor API.
 * @param studio - the panel controller.
 * @returns the dispose function withdrawing every registration.
 */
export function registerEditorServices(monaco: MonacoApi, studio: CodeStudio): () => void {
  const markers = (): void => {
    monaco.editor.getModels().forEach((model) => {
      const path = pathOfModelUri(model.uri)
      if (path === null) return
      monaco.editor.setModelMarkers(model, 'codeStudio', diagnosticsOf(studio, path, monaco))
    })
  }
  markers()
  const unsubscribe = studio.subscribe(markers)
  const completions = monaco.languages.registerCompletionItemProvider('typescript', {
    triggerCharacters: ['.', '"', '\'', '/', '@'],
    async provideCompletionItems(model, position) {
      const path = pathOfModelUri(model.uri)
      if (path === null) return { suggestions: [] }
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const items = await studio.complete(path, position.lineNumber - 1, position.column - 1)
      return {
        suggestions: items.map((item, index) => ({
          label: item.label,
          kind: completionKind(monaco, item.kind),
          insertText: item.insertText,
          range,
          sortText: String(index).padStart(4, '0'),
          ...(item.detail === null ? {} : { detail: item.detail }),
        })),
      }
    },
  })
  const hovers = monaco.languages.registerHoverProvider('typescript', {
    async provideHover(model, position) {
      const path = pathOfModelUri(model.uri)
      if (path === null) return null
      const text = await studio.hover(path, position.lineNumber - 1, position.column - 1)
      return text === null ? null : { contents: [{ value: text }] }
    },
  })
  return () => {
    unsubscribe()
    completions.dispose()
    hovers.dispose()
  }
}

/** Translate one snapshot's diagnostics into Monaco markers for one file. */
function diagnosticsOf(studio: CodeStudio, path: string, monaco: MonacoApi): Monaco.editor.IMarkerData[] {
  const diagnostics = studio.getSnapshot().diagnostics.get(path) ?? []
  return diagnostics.map((diagnostic: CodeDiagnostic) => ({
    startLineNumber: diagnostic.line + 1,
    startColumn: diagnostic.character + 1,
    endLineNumber: diagnostic.endLine + 1,
    endColumn: diagnostic.endCharacter + 1,
    message: diagnostic.code === null ? diagnostic.message : `${diagnostic.message} (${diagnostic.code})`,
    severity: diagnostic.severity === 'error'
      ? monaco.MarkerSeverity.Error
      : diagnostic.severity === 'warning'
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Info,
    source: 'code-studio',
  }))
}

/** Map one LSP completion kind onto Monaco's, falling back to text. */
function completionKind(monaco: MonacoApi, kind: number): Monaco.languages.CompletionItemKind {
  const values = Object.values(monaco.languages.CompletionItemKind) as number[]
  return values.includes(kind) ? kind : monaco.languages.CompletionItemKind.Text
}
