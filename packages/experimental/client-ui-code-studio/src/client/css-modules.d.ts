/** CSS module names and stylesheet side-effect imports of the browser bundle. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'

/** The whole-file editor entry carries the stylesheet chain but no sibling types. */
declare module 'monaco-editor/esm/vs/editor/editor.main.js' {
  export * from 'monaco-editor/esm/vs/editor/editor.api'
}

declare module '@xterm/xterm' {
  interface Terminal {
    /** Internal renderer metrics; the fit addon reads the same fields. */
    readonly _core?: {
      readonly _renderService?: {
        readonly dimensions?: { readonly cssCellWidth?: number; readonly cssCellHeight?: number }
      }
    }
  }
}
