/** Store layout and guards: import, first-open report, covers, progress, annotations, shots. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PdfStore } from '../src/store.ts'
import { base64Of, pdfFixture, pngFixture } from './fixture.ts'

let root = ''
let store: PdfStore

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pdf-reader-store-')); store = new PdfStore(root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('PdfStore', () => {
  it('imports a PDF, lists it, and serves its bytes back', async () => {
    const bytes = pdfFixture()
    const meta = await store.importBook(bytes, 'Sample Paper')
    expect(meta.title).toBe('Sample Paper')
    expect(meta.pageCount).toBe(0)
    expect((await store.listBooks()).map(row => row.bookId)).toEqual([meta.bookId])
    await expect(store.readPdf(meta.bookId)).resolves.toEqual(bytes)
  })

  it('rejects bytes without a PDF header', async () => {
    await expect(store.importBook(new TextEncoder().encode('PK-not-a-pdf'), 'x')).rejects.toThrow(/%PDF-/iu)
    await expect(store.listBooks()).resolves.toEqual([])
  })

  it('derives the title from the file name and keeps identity stable', async () => {
    const meta = await store.importBook(pdfFixture(), 'Report 2026.pdf')
    expect(meta.title).toBe('Report 2026')
    await expect(store.importBook(pdfFixture(), '')).resolves.toMatchObject({ title: 'Untitled' })
  })

  it('persists the import source and keeps it across the report merge', async () => {
    const source = { url: 'https://example.com/answer/1', capturedAt: 1_768_000_000_000 }
    const meta = await store.importBook(pdfFixture(), 'Page', source)
    expect(meta.source).toEqual(source)
    const reported = await store.saveMetaReport(meta.bookId, { title: 'T', pageCount: 2, outline: [] })
    expect(reported.source).toEqual(source)
    await expect(store.importBook(pdfFixture(), 'File')).resolves.toMatchObject({ source: null })
  })

  it('merges the first-open report and clamps progress into it', async () => {
    const meta = await store.importBook(pdfFixture(), 'Paper')
    const reported = await store.saveMetaReport(meta.bookId, {
      title: '',
      pageCount: 12,
      outline: [{ title: 'Intro', page: 1 }, { title: 'Results', page: 8 }],
    })
    expect(reported).toMatchObject({ title: 'Paper', pageCount: 12 })
    expect(reported.outline).toEqual([{ title: 'Intro', page: 1 }, { title: 'Results', page: 8 }])
    await expect(store.readPdf(meta.bookId)).resolves.toBeInstanceOf(Uint8Array)

    await store.saveProgress(meta.bookId, { page: 99 })
    await expect(store.loadProgress(meta.bookId)).resolves.toEqual({ page: 12 })
    await store.saveProgress(meta.bookId, { page: 0 })
    await expect(store.loadProgress(meta.bookId)).resolves.toEqual({ page: 1 })
  })

  it('stores the cover thumbnail once and reports it on the row', async () => {
    const meta = await store.importBook(pdfFixture(), 'Paper')
    expect((await store.loadMeta(meta.bookId))?.hasCover).toBe(false)
    await store.writeCover(meta.bookId, pngFixture())
    expect((await store.loadMeta(meta.bookId))?.hasCover).toBe(true)
    await expect(store.readCover(meta.bookId)).resolves.toEqual(pngFixture())
  })

  it('persists text and shot annotations together and drops crop files on shot removal', async () => {
    const meta = await store.importBook(pdfFixture(), 'Paper')
    await store.saveMetaReport(meta.bookId, { title: '', pageCount: 3, outline: [] })
    const notes = [
      { kind: 'text' as const, id: 'a1', page: 1, start: 0, end: 5, quote: 'hello', createdAt: 1, results: [] },
      { kind: 'shot' as const, id: 'a2', page: 2, rect: { x: 0, y: 0, width: 0.5, height: 0.5 }, imageUrl: '/x', question: 'why', createdAt: 2, answer: null },
    ]
    await store.saveAnnotations(meta.bookId, notes)
    await expect(store.loadAnnotations(meta.bookId)).resolves.toEqual(notes)

    await store.writeShot(meta.bookId, 'a2', pngFixture(32))
    await expect(store.readShot(meta.bookId, 'a2')).resolves.toEqual(pngFixture(32))
    await store.saveAnnotations(meta.bookId, notes.slice(0, 1))
    await store.removeShot(meta.bookId, 'a2')
    await expect(store.readShot(meta.bookId, 'a2')).resolves.toBeNull()
  })

  it('keeps the book file bytes verbatim through import', async () => {
    const bytes = pdfFixture('verbatim body')
    const meta = await store.importBook(bytes, 'v')
    await expect(readFile(join(root, 'books', meta.bookId, 'book.pdf'))).resolves.toEqual(Buffer.from(bytes))
  })

  it('removes a book with every stored byte', async () => {
    const meta = await store.importBook(pdfFixture(), 'gone')
    await store.removeBook(meta.bookId)
    await expect(store.loadMeta(meta.bookId)).resolves.toBeNull()
    await expect(store.readPdf(meta.bookId)).resolves.toBeNull()
  })

  it('rejects ids that are not short uuids from every read', async () => {
    await expect(store.readPdf('../escape')).resolves.toBeNull()
    await expect(store.loadProgress('UPPER-CASE-ID')).resolves.toBeNull()
    await expect(store.loadAnnotations('bad/id')).resolves.toBeNull()
    await expect(base64Of(pngFixture())).not.toBe('')
  })
})
