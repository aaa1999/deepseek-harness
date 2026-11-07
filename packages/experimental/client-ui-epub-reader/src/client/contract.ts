/** Slot and menu faces shared by the EPUB reader client modules. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextMenuTarget, MenuPoint } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { ExplainKind } from '@deepseek-ai/dsh-experimental-epub-reader/types'
import type { EpubReaderState } from './controller.ts'

declare module '@deepseek-ai/dsh-client-ui-context-menu/client' {
  interface ContextMenuTargetMap {
    /** A text selection inside the EPUB reader's chapter body. */
    epubSelection: EpubSelectionValue
  }
}

/** One selection captured at gesture time, in chapter plain-text offsets. */
export interface EpubSelectionValue {
  readonly bookId: string
  readonly chapterIndex: number
  readonly start: number
  readonly end: number
  readonly text: string
  /** Plain text of the paragraph carrying the selection, for prompt context. */
  readonly context: string
}

/** The faces the reader components receive through Slot injection. */
export interface EpubReaderInjected {
  /** Reader state the panel renders through its `useReader` selector hook. */
  readonly hooks: { readonly reader: HostObservable<EpubReaderState> }
  importFiles(files: readonly File[]): void
  removeBook(bookId: string): void
  openBook(bookId: string): void
  closeBook(): void
  selectChapter(chapterIndex: number, restoreRatio?: number): void
  /** Step to the adjacent chapter; a ratio lands the reader mid-chapter (paging back uses the end). */
  stepChapter(delta: number, restoreRatio?: number): void
  /** Report the reading column's scrolled ratio; the controller debounces the save. */
  noteScroll(ratio: number): void
  treat(selection: EpubSelectionValue, kind: ExplainKind): void
  retryAnnotation(id: string): void
  deleteAnnotation(id: string): void
  /** Carry a live selection into the Notes panel as a plain-text note. */
  captureSelectionNote(selection: EpubSelectionValue): void
  /** Carry one saved card — quote plus treatments — into the Notes panel. */
  captureAnnotationNote(id: string): void
  /** Open the storage-directory settings panel on the shelf. */
  openStorageSettings(): void
  closeStorageSettings(): void
  /** Point the library at an absolute directory; empty restores the default. */
  saveStorageSettings(directory: string): void
  /** Choose the model treatments use; the empty pair follows the profile default. */
  saveTreatmentModel(provider: string, model: string): void
  /** Open the shared context-menu popup for one captured reader selection. */
  openMenu(target: ContextMenuTarget, point: MenuPoint): void
  copyText(text: string): void
}
