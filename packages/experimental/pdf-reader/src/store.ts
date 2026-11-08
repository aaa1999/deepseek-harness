/**
 * Durable PDF library storage under one plugin-owned data directory.
 *
 * Layout below `<dataRoot>/books/<bookId>/`:
 * - `book.pdf` — the original file as imported
 * - `meta.json` — identity plus the browser's first-open structure report
 * - `progress.json` — the last saved reading position
 * - `annotations.json` — text highlights and screenshot questions
 * - `cover.png` — the browser-rendered first-page thumbnail
 * - `shots/<annotationId>.png` — every stored screenshot crop
 *
 * @module @deepseek-ai/dsh-pdf-reader/store
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BookProgress, ImportSource, MetaReport, PdfAnnotation, TocEntry } from './types.ts'

/** The persisted description of one imported book. */
export interface StoredBookMeta {
  readonly bookId: string
  readonly title: string
  readonly pageCount: number
  readonly outline: readonly TocEntry[]
  readonly importedAt: number
  /** Where the file came from, when the importer knew one; file imports carry null. */
  readonly source: ImportSource | null
  /** Whether `cover.png` exists; the shelf falls back to a glyph until one does. */
  readonly hasCover: boolean
}

/** A PDF the store refuses: wrong magic, truncated, or not a PDF at all. */
export class PdfFormatError extends Error {
  override name = 'PdfFormatError'
}

/** Read a JSON file, returning the fallback when it is absent. */
async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Write one JSON file through a same-directory temporary file. */
async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`
  await writeFile(temporary, JSON.stringify(value), 'utf8')
  await rename(temporary, path)
}

/** The `%PDF-` header must sit within the first kilobyte of the file. */
const PDF_MAGIC_OFFSET = 1024

/** Whether the bytes begin with a PDF header. */
function hasPdfMagic(bytes: Uint8Array): boolean {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, PDF_MAGIC_OFFSET))
  return header.startsWith('%PDF-') || header.includes('%PDF-')
}

/** The plugin's library storage. */
export class PdfStore {
  /** @param root - plugin data root, created on first write. */
  constructor(private readonly root: string) {}

  private booksDir(): string {
    return join(this.root, 'books')
  }

  private bookDir(bookId: string): string {
    return join(this.booksDir(), bookId)
  }

  private shotsDir(bookId: string): string {
    return join(this.bookDir(bookId), 'shots')
  }

  /** One book's stored metadata, or null when its record is unreadable. */
  async loadMeta(bookId: string): Promise<StoredBookMeta | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    const meta = await readJson<StoredBookMeta | null>(join(this.bookDir(bookId), 'meta.json'), null)
    return meta
  }

  /** Every readable book record, newest import first. */
  async listBooks(): Promise<StoredBookMeta[]> {
    let entries
    try {
      entries = await readdir(this.booksDir(), { withFileTypes: true })
    } catch {
      return []
    }
    const books: StoredBookMeta[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const meta = await this.loadMeta(entry.name)
      if (meta !== null) books.push(meta)
    }
    return books.sort((left, right) => right.importedAt - left.importedAt)
  }

  /**
   * Persist one imported PDF.
   * @param bytes - the original file bytes; only the PDF magic is checked here,
   *   the browser's PDF.js parse reports structural failures on first open.
   * @param fallbackTitle - the import file name without its extension.
   * @returns the stored metadata.
   * @throws {PdfFormatError} when the bytes carry no PDF header.
   */
  /**
   * Store one imported PDF under a fresh identity.
   * @param bytes - the complete file bytes.
   * @param fallbackTitle - the import file name without its extension.
   * @param source - the origin record to persist beside it, or null for file imports.
   * @returns the stored metadata.
   * @throws {PdfFormatError} when the bytes carry no PDF header.
   */
  async importBook(bytes: Uint8Array, fallbackTitle: string, source: ImportSource | null = null): Promise<StoredBookMeta> {
    if (!hasPdfMagic(bytes)) throw new PdfFormatError('the file carries no %PDF- header')
    const derived = fallbackTitle.replace(/\.pdf$/iu, '').trim()
    const meta: StoredBookMeta = {
      bookId: randomUUID(),
      title: derived === '' ? 'Untitled' : derived,
      pageCount: 0,
      outline: [],
      importedAt: Date.now(),
      source,
      hasCover: false,
    }
    const bookDir = this.bookDir(meta.bookId)
    await mkdir(bookDir, { recursive: true })
    await writeFile(join(bookDir, 'book.pdf'), bytes)
    await writeJson(join(bookDir, 'meta.json'), meta)
    await writeJson(join(bookDir, 'progress.json'), { page: 1 } satisfies BookProgress)
    await writeJson(join(bookDir, 'annotations.json'), [] satisfies PdfAnnotation[])
    return meta
  }

  /** Merge the browser's first-open structure report into one book's record. */
  async saveMetaReport(bookId: string, report: MetaReport): Promise<StoredBookMeta> {
    const current = await this.loadMeta(bookId)
    if (current === null) throw new PdfFormatError(`no such book: ${bookId}`)
    const next: StoredBookMeta = {
      ...current,
      title: report.title === '' ? current.title : report.title,
      pageCount: report.pageCount,
      outline: [...report.outline],
    }
    await writeJson(join(this.bookDir(bookId), 'meta.json'), next)
    return next
  }

  /** Mark the stored cover thumbnail present after the browser uploaded one. */
  async noteCover(bookId: string): Promise<void> {
    const current = await this.loadMeta(bookId)
    if (current === null || current.hasCover) return
    await writeJson(join(this.bookDir(bookId), 'meta.json'), { ...current, hasCover: true })
  }

  /** Delete one book and every stored byte of it. */
  async removeBook(bookId: string): Promise<void> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return
    await rm(this.bookDir(bookId), { recursive: true, force: true })
  }

  /** The stored original bytes, for the browser's PDF.js parse. */
  async readPdf(bookId: string): Promise<Uint8Array | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    try {
      return new Uint8Array(await readFile(join(this.bookDir(bookId), 'book.pdf')))
    } catch {
      return null
    }
  }

  /** The stored cover thumbnail bytes, for the cover Fetch route. */
  async readCover(bookId: string): Promise<Uint8Array | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    try {
      return new Uint8Array(await readFile(join(this.bookDir(bookId), 'cover.png')))
    } catch {
      return null
    }
  }

  /** Persist the browser-rendered cover thumbnail. */
  async writeCover(bookId: string, png: Uint8Array): Promise<void> {
    await mkdir(this.bookDir(bookId), { recursive: true })
    await writeFile(join(this.bookDir(bookId), 'cover.png'), png)
    await this.noteCover(bookId)
  }

  /** One stored screenshot crop, for the shot Fetch route. */
  async readShot(bookId: string, annotationId: string): Promise<Uint8Array | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId) || !/^[\da-f-]{1,64}$/iu.test(annotationId)) return null
    try {
      return new Uint8Array(await readFile(join(this.shotsDir(bookId), `${annotationId}.png`)))
    } catch {
      return null
    }
  }

  /** Persist one screenshot crop under its annotation id. */
  async writeShot(bookId: string, annotationId: string, png: Uint8Array): Promise<void> {
    if (!/^[\da-f-]{1,64}$/iu.test(annotationId)) throw new PdfFormatError('screenshot id must be a short uuid')
    await mkdir(this.shotsDir(bookId), { recursive: true })
    await writeFile(join(this.shotsDir(bookId), `${annotationId}.png`), png)
  }

  /** Remove one screenshot crop with its annotation. */
  async removeShot(bookId: string, annotationId: string): Promise<void> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId) || !/^[\da-f-]{1,64}$/iu.test(annotationId)) return
    await rm(join(this.shotsDir(bookId), `${annotationId}.png`), { force: true })
  }

  /** The saved reading position. */
  async loadProgress(bookId: string): Promise<BookProgress | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    return await readJson<BookProgress | null>(join(this.bookDir(bookId), 'progress.json'), null)
  }

  /** Persist the reading position, clamped into the known page range. */
  async saveProgress(bookId: string, progress: BookProgress): Promise<void> {
    const meta = await this.loadMeta(bookId)
    if (meta === null) return
    const page = Math.min(Math.max(Math.trunc(progress.page) || 1, 1), Math.max(meta.pageCount, 1))
    await writeJson(join(this.bookDir(bookId), 'progress.json'), { page })
  }

  /** The saved annotations of one book. */
  async loadAnnotations(bookId: string): Promise<PdfAnnotation[] | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    return await readJson<PdfAnnotation[] | null>(join(this.bookDir(bookId), 'annotations.json'), null)
  }

  /** Persist the complete annotation list of one book. */
  async saveAnnotations(bookId: string, annotations: readonly PdfAnnotation[]): Promise<void> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return
    await mkdir(this.bookDir(bookId), { recursive: true })
    await writeJson(join(this.bookDir(bookId), 'annotations.json'), annotations)
  }
}
