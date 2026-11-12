/**
 * Wire types shared by the EPUB reader Host service and its browser client.
 *
 * @module @deepseek-ai/dsh-epub-reader/types
 */

/** Which LLM treatment a selection receives. */
export type ExplainKind = 'translate' | 'explain'

/** Reading position inside one book: spine chapter plus the scrolled ratio of that chapter. */
export interface BookProgress {
  readonly chapterIndex: number
  /** Ratio of the chapter's scroll extent in `[0, 1]`. */
  readonly ratio: number
}

/** One library row as the browser bookshelf renders it. */
export interface BookRow {
  readonly bookId: string
  readonly title: string
  readonly author: string
  /** BCP-47 language the book declares, when it declares one. */
  readonly language: string
  /** Cover image through the resource Fetch route, when the book carries one. */
  readonly coverUrl: string | null
  readonly chapterCount: number
  readonly progress: BookProgress
  readonly importedAt: number
}

/** One table-of-contents entry resolved onto the spine order. */
export interface TocEntry {
  readonly title: string
  readonly chapterIndex: number
}

/** One sanitized chapter body, ready for the reading pane. */
export interface ChapterDoc {
  readonly bookId: string
  readonly chapterIndex: number
  readonly title: string
  /** Sanitized body HTML; resource references already point at the Fetch route. */
  readonly html: string
}

/** One finished LLM treatment attached to an annotation. */
export interface ExplainResult {
  readonly kind: ExplainKind
  readonly text: string
  readonly model: string
  readonly createdAt: number
}

/** One persisted highlight with its LLM results. */
export interface Annotation {
  readonly id: string
  readonly chapterIndex: number
  /** Selection start in the chapter's concatenated plain-text stream. */
  readonly start: number
  /** Selection end, exclusive. */
  readonly end: number
  readonly quote: string
  readonly createdAt: number
  readonly results: ExplainResult[]
}

/** Incremental chunk of one streamed explanation. */
export type ExplainChunk =
  | { readonly type: 'meta'; readonly model: string }
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'done' }

/** A selection the browser asks the Host to treat. */
export interface ExplainRequest {
  readonly bookId: string
  readonly chapterIndex: number
  readonly kind: ExplainKind
  /** The selected text itself. */
  readonly text: string
  /** Plain text of the paragraph containing the selection, for context. */
  readonly context: string
}

/** Where the library lives and whether this profile can move it at runtime. */
export interface StorageMeta {
  /** The resolved directory the library reads and writes today. */
  readonly directory: string
  /** Whether a runtime directory change is possible here. */
  readonly configurable: boolean
}

/** One routable model the treatment picker lists. */
export interface TreatmentModel {
  readonly provider: string
  readonly model: string
  /** Human-readable model name for the picker. */
  readonly name: string
}

/** The treatment model landscape: every routable pair plus the effective selection. */
export interface TreatmentCatalog {
  /** Configured override; empty pair means follow the profile default. */
  readonly provider: string
  readonly model: string
  /** The default pair the profile resolves when no override is set. */
  readonly defaultProvider: string
  readonly defaultModel: string
  /** Every routable provider/model pair, in adapter order. */
  readonly models: readonly TreatmentModel[]
}
