/** Slot and menu faces shared by the PDF reader client modules. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextMenuTarget, MenuPoint } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { ExplainKind, HighlightColor, ShotRect } from '@deepseek-ai/dsh-pdf-reader/types'
import type { PdfReaderState } from './controller.ts'

/**
 * The marker palette in toolbar order, mirroring the Host's `HIGHLIGHT_COLORS`
 * validator. Cross-plugin value imports are forbidden in client bundles, so
 * the tuple lives on both sides of the wire.
 */
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const satisfies readonly HighlightColor[]

/** Marker fill of each palette color, shared by the reading highlights and every palette dot. */
export const COLOR_FILL: Record<HighlightColor, string> = {
  yellow: '#ffe066',
  green: '#8ce99a',
  blue: '#74c0fc',
  pink: '#faa2c1',
  purple: '#d0bfff',
}

declare module '@deepseek-ai/dsh-client-ui-context-menu/client' {
  interface ContextMenuTargetMap {
    /** A text selection inside the PDF reader's page text layer. */
    pdfSelection: PdfSelectionValue
  }
}

/** One selection captured at gesture time, in page plain-text offsets. */
export interface PdfSelectionValue {
  readonly bookId: string
  readonly page: number
  readonly start: number
  readonly end: number
  readonly text: string
  /** Page text around the selection, for prompt context. */
  readonly context: string
}

/** One screenshot ask the controller streams and persists. */
export interface ShotAsk {
  readonly bookId: string
  readonly page: number
  readonly rect: ShotRect
  /** The cropped PNG as canonical base64. */
  readonly pngBase64: string
  readonly question: string
  /** Per-ask model override; both fields together replace the configured shot pair. */
  readonly provider?: string
  readonly model?: string
}

/** The faces the reader components receive through Slot injection. */
export interface PdfReaderInjected {
  /** Reader state the panel renders through its `useReader` selector hook. */
  readonly hooks: { readonly reader: HostObservable<PdfReaderState> }
  /** Document lifecycle the reading view drives; thin wraps over Remote calls. */
  readonly documents: {
    /** The stored bytes of one book, fetched once per plugin lifetime. */
    readBytes(bookId: string): Promise<Uint8Array | null>
    /** Merge the browser's first-open structure report into the book and shelf. */
    reportMeta(bookId: string, report: { title: string; pageCount: number; outline: readonly { title: string; page: number }[] }): void
    /** Store the browser-rendered cover thumbnail; repeats are cheap no-ops. */
    saveCover(bookId: string, pngBase64: string): void
    /** Load the open book's annotations into the reader state. */
    loadAnnotations(): void
  }
  importFiles(files: readonly File[]): void
  removeBook(bookId: string): void
  openBook(bookId: string): void
  closeBook(): void
  /** Turn to one 1-based page. */
  selectPage(page: number): void
  stepPage(delta: number): void
  /** Set the display zoom factor over the base page size. */
  setZoom(zoom: number): void
  /** Choose the reading presentation: `scroll` pans a width-fit page, `flip` steps height-fit pages. */
  setReadingMode(mode: 'scroll' | 'flip'): void
  /** Choose the marker pen's color; new highlights and recolors paint with it. */
  setPenColor(color: HighlightColor): void
  treat(selection: PdfSelectionValue, kind: ExplainKind): void
  /** Persist one selection as a plain marker highlight, with no model treatment. */
  annotate(selection: PdfSelectionValue): void
  /** Repaint one saved text annotation in another marker color, and make that color current. */
  setAnnotationColor(id: string, color: HighlightColor): void
  /** Ask one fresh screenshot question. */
  askShot(ask: ShotAsk): void
  /** Load the vision-capable models the ask popover lists. */
  loadShotCatalog(): void
  retryTextAnnotation(id: string): void
  /** Re-ask one saved screenshot; the caller supplies a fresh crop of the same rect. */
  retryShotAnnotation(id: string, fresh: { pngBase64: string; question: string }): void
  deleteAnnotation(id: string): void
  /** Open the storage-directory and model settings panel on the shelf. */
  openStorageSettings(): void
  closeStorageSettings(): void
  /** Point the library at an absolute directory; empty restores the default. */
  saveStorageSettings(directory: string): void
  /** Choose the model text treatments use; the empty pair follows the default. */
  saveTreatmentModel(provider: string, model: string): void
  /** Choose the model screenshots use; the empty pair follows the default. */
  saveShotModel(provider: string, model: string): void
  /** Open the shared context-menu popup for one captured reader selection. */
  openMenu(target: ContextMenuTarget, point: MenuPoint): void
  copyText(text: string): void
}
