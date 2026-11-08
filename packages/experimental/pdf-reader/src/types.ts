/**
 * Wire types shared by the PDF reader Host service and its browser client.
 *
 * @module @deepseek-ai/dsh-pdf-reader/types
 */

/** Which LLM treatment a text selection receives. */
export type ExplainKind = 'translate' | 'explain'

/** Reading position inside one book: the 1-based page the reader last showed. */
export interface BookProgress {
  readonly page: number
}

/** One outline destination resolved onto a 1-based page. */
export interface TocEntry {
  readonly title: string
  readonly page: number
}

/** One shelf row as the browser bookshelf renders it. */
export interface BookRow {
  readonly bookId: string
  readonly title: string
  /** Page count as the browser's PDF.js parse reported it; 0 until the first open. */
  readonly pageCount: number
  readonly outline: readonly TocEntry[]
  readonly progress: BookProgress
  /** First-page thumbnail through the cover Fetch route, once the browser rendered one. */
  readonly coverUrl: string | null
  readonly importedAt: number
  /** Where the file came from, when the importer knew one; file imports carry null. */
  readonly source: ImportSource | null
}

/** The origin record a web capture files beside its PDF. */
export interface ImportSource {
  /** The page URL the snapshot was captured from. */
  readonly url: string
  /** Capture time in epoch milliseconds. */
  readonly capturedAt: number
}

/** The browser's first-open report: the structure PDF.js resolved on the client. */
export interface MetaReport {
  readonly title: string
  readonly pageCount: number
  readonly outline: readonly TocEntry[]
}

/** Complete PDF bytes for one browser-side PDF.js parse. */
export interface PdfBytes {
  readonly data: Uint8Array
}

/** One finished LLM treatment attached to a text annotation. */
export interface ExplainResult {
  readonly kind: ExplainKind
  readonly text: string
  readonly model: string
  readonly createdAt: number
}

/** Region of one page a screenshot captured, in fractions of the displayed page box. */
export interface ShotRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One persisted text highlight with its LLM results. */
export interface TextAnnotation {
  readonly kind: 'text'
  readonly id: string
  /** 1-based page carrying the selection. */
  readonly page: number
  /** Selection start in the page's concatenated plain-text stream. */
  readonly start: number
  /** Selection end, exclusive. */
  readonly end: number
  readonly quote: string
  readonly createdAt: number
  readonly results: ExplainResult[]
}

/** One persisted screenshot question with its streamed answer. */
export interface ShotAnnotation {
  readonly kind: 'shot'
  readonly id: string
  readonly page: number
  readonly rect: ShotRect
  /** Host Fetch-route URL of the stored screenshot PNG. */
  readonly imageUrl: string
  readonly question: string
  readonly createdAt: number
  readonly answer: { readonly text: string; readonly model: string; readonly createdAt: number } | null
}

/** Every annotation kind one book carries. */
export type PdfAnnotation = TextAnnotation | ShotAnnotation

/** Incremental chunk of one streamed treatment or screenshot answer. */
export type TreatChunk =
  | { readonly type: 'meta'; readonly model: string }
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'done'; readonly imageUrl?: string }

/** A text selection the browser asks the Host to treat. */
export interface ExplainRequest {
  readonly bookId: string
  readonly page: number
  readonly kind: ExplainKind
  /** The selected text itself. */
  readonly text: string
  /** Plain text surrounding the selection on the page, for prompt context. */
  readonly context: string
}

/** A screenshot region the browser asks the Host about. */
export interface AskImageRequest {
  readonly bookId: string
  readonly page: number
  readonly rect: ShotRect
  /** Annotation id the crop is stored under; the client generates it. */
  readonly annotationId: string
  /** The cropped PNG as canonical base64. */
  readonly pngBase64: string
  readonly question: string
  /** Per-ask model override; both fields together replace the configured shot pair. */
  readonly provider?: string
  readonly model?: string
}

/** Where the library lives and whether this profile can move it at runtime. */
export interface StorageMeta {
  /** The resolved directory the library reads and writes today. */
  readonly directory: string
  /** Whether a runtime directory change is possible here. */
  readonly configurable: boolean
}

/** One routable model the treatment pickers list. */
export interface TreatmentModel {
  readonly provider: string
  readonly model: string
  /** Human-readable model name for the picker. */
  readonly name: string
  /** Whether the model accepts image input, which the screenshot tool requires. */
  readonly vision: boolean
}

/** The treatment model landscape: every routable pair plus the effective selections. */
export interface TreatmentCatalog {
  /** Configured text-treatment override; empty pair means follow the profile default. */
  readonly provider: string
  readonly model: string
  /** Configured screenshot override; empty pair means follow the profile default. */
  readonly shotProvider: string
  readonly shotModel: string
  /** The default pair the profile resolves when no override is set. */
  readonly defaultProvider: string
  readonly defaultModel: string
  /** Every routable provider/model pair, in adapter order. */
  readonly models: readonly TreatmentModel[]
}
