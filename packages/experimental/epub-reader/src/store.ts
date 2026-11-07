/**
 * Durable EPUB library storage under one plugin-owned data directory.
 *
 * Layout below `<dataRoot>/books/<bookId>/`:
 * - `book.epub` — the original archive
 * - `content/<interior path>` — extracted members
 * - `meta.json` — parsed structure (`ParsedEpub` plus identity)
 * - `progress.json` — the last saved reading position
 * - `annotations.json` — the saved highlights with their results
 *
 * @module @deepseek-ai/dsh-experimental-epub-reader/store
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, posix, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'
import { EpubFormatError, parseEpub, type EpubFiles, type ParsedEpub } from './epub.ts'
import type { Annotation, BookProgress, TocEntry } from './types.ts'

/** The persisted description of one imported book. */
export interface StoredBookMeta extends ParsedEpub {
  readonly bookId: string
  readonly importedAt: number
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

/**
 * Join one interior path below its content root, rejecting escapes.
 * @param contentDir - the book's extracted content directory.
 * @param interiorPath - the requested book-interior path.
 * @returns the filesystem path, or null when the request escapes or is absolute.
 */
function joinInterior(contentDir: string, interiorPath: string): string | null {
  if (interiorPath === '' || interiorPath.startsWith('/') || interiorPath.includes('\\') || interiorPath.includes('\0')) return null
  const normalized = posix.normalize(interiorPath)
  if (normalized === '..' || normalized.startsWith('../')) return null
  const target = resolve(contentDir, normalized)
  if (target !== contentDir && !target.startsWith(contentDir + sep)) return null
  return target
}

/** The plugin's library storage. */
export class EpubStore {
  /** @param root - plugin data root, created on first write. */
  constructor(private readonly root: string) {}

  private booksDir(): string {
    return join(this.root, 'books')
  }

  private bookDir(bookId: string): string {
    return join(this.booksDir(), bookId)
  }

  private contentDir(bookId: string): string {
    return join(this.bookDir(bookId), 'content')
  }

  /** One book's stored metadata, or null when its record is unreadable. */
  async loadMeta(bookId: string): Promise<StoredBookMeta | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    return await readJson<StoredBookMeta | null>(join(this.bookDir(bookId), 'meta.json'), null)
  }

  /** Every readable book record. */
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
   * Unzip, parse, and persist one book.
   * @param bytes - the EPUB archive bytes.
   * @param fallbackTitle - import name used when the book declares no title.
   * @returns the stored metadata and the extracted file map.
   * @throws {EpubFormatError} when the archive is not a usable EPUB.
   */
  async importBook(bytes: Uint8Array, fallbackTitle: string): Promise<{ meta: StoredBookMeta; files: EpubFiles }> {
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(bytes)
    } catch (error) {
      throw new EpubFormatError(`not a readable ZIP archive (${error instanceof Error ? error.message : String(error)})`)
    }
    const files = new Map(Object.entries(entries))
    const parsed = parseEpub(files)
    const meta: StoredBookMeta = {
      ...parsed,
      title: parsed.title === 'Untitled' || parsed.title === '' ? fallbackTitle : parsed.title,
      bookId: randomUUID(),
      importedAt: Date.now(),
    }
    const bookDir = this.bookDir(meta.bookId)
    const contentDir = this.contentDir(meta.bookId)
    await mkdir(contentDir, { recursive: true })
    await writeFile(join(bookDir, 'book.epub'), bytes)
    for (const [path, data] of files) {
      if (path === '' || path.endsWith('/')) continue
      const target = joinInterior(contentDir, path)
      if (target === null) continue
      await mkdir(join(target, '..'), { recursive: true })
      await writeFile(target, data)
    }
    await writeJson(join(bookDir, 'meta.json'), meta)
    await writeJson(join(bookDir, 'progress.json'), { chapterIndex: 0, ratio: 0 } satisfies BookProgress)
    await writeJson(join(bookDir, 'annotations.json'), [] satisfies Annotation[])
    return { meta, files }
  }

  /** Delete one book and every stored byte of it. */
  async removeBook(bookId: string): Promise<void> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return
    await rm(this.bookDir(bookId), { recursive: true, force: true })
  }

  /** Raw XHTML text of one spine chapter, with its interior path. */
  async readChapter(bookId: string, chapterIndex: number): Promise<{ xhtml: string; path: string } | null> {
    const meta = await this.loadMeta(bookId)
    if (meta === null) return null
    const chapter = meta.chapters[chapterIndex]
    if (chapter === undefined) return null
    const target = joinInterior(this.contentDir(bookId), chapter.path)
    if (target === null) return null
    try {
      return { xhtml: await readFile(target, 'utf8'), path: chapter.path }
    } catch {
      return null
    }
  }

  /** One resource file's bytes, for the Fetch route. */
  async readResource(bookId: string, interiorPath: string): Promise<Uint8Array | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    const target = joinInterior(this.contentDir(bookId), interiorPath)
    if (target === null) return null
    try {
      return new Uint8Array(await readFile(target))
    } catch {
      return null
    }
  }

  /** The saved reading position. */
  async loadProgress(bookId: string): Promise<BookProgress | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    const progress = await readJson<BookProgress | null>(join(this.bookDir(bookId), 'progress.json'), null)
    return progress
  }

  /** Persist the reading position. */
  async saveProgress(bookId: string, progress: BookProgress): Promise<void> {
    const meta = await this.loadMeta(bookId)
    if (meta === null) return
    const chapterIndex = Math.min(Math.max(progress.chapterIndex, 0), Math.max(meta.chapters.length - 1, 0))
    await writeJson(join(this.bookDir(bookId), 'progress.json'), {
      chapterIndex,
      ratio: Math.min(Math.max(Number.isFinite(progress.ratio) ? progress.ratio : 0, 0), 1),
    })
  }

  /** The saved highlights of one book. */
  async loadAnnotations(bookId: string): Promise<Annotation[] | null> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return null
    return await readJson<Annotation[] | null>(join(this.bookDir(bookId), 'annotations.json'), null)
  }

  /** Persist the complete highlight list of one book. */
  async saveAnnotations(bookId: string, annotations: readonly Annotation[]): Promise<void> {
    if (!/^[\da-f-]{1,64}$/iu.test(bookId)) return
    await mkdir(this.bookDir(bookId), { recursive: true })
    await writeJson(join(this.bookDir(bookId), 'annotations.json'), annotations)
  }
}

/** Re-exported for callers that inspect store errors. */
export { EpubFormatError }

/** Structural TOC type re-export for meta consumers. */
export type { TocEntry }
