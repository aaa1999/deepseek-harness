/** Durable storage: import roundtrip, traversal guards, progress and annotations. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EpubStore } from '../src/store.ts'
import type { Annotation } from '../src/types.ts'
import { epub3Fixture } from './fixture.ts'

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'epub-reader-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

/** One saved highlight for persistence checks. */
function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: '0192ab00-0000-7000-8000-000000000001',
    chapterIndex: 0,
    start: 4,
    end: 22,
    quote: 'It was the best of',
    createdAt: 1730000000000,
    results: [{ kind: 'translate', text: '那是最美好的时代', model: 'test-model', createdAt: 1730000001000 }],
    ...overrides,
  }
}

describe('EpubStore', () => {
  it('imports, lists, reads back, and removes a book', async () => {
    const store = new EpubStore(root)
    const { meta } = await store.importBook(epub3Fixture(), 'sample')
    expect(meta.title).toBe('Sample Book')
    expect((await store.listBooks()).map(book => book.bookId)).toEqual([meta.bookId])

    const chapter = await store.readChapter(meta.bookId, 0)
    expect(chapter?.path).toBe('OEBPS/text/ch1.xhtml')
    expect(chapter?.xhtml).toContain('<em>best</em> of times')

    expect(await store.readResource(meta.bookId, 'OEBPS/images/cover.jpg')).not.toBeNull()
    await store.removeBook(meta.bookId)
    expect(await store.listBooks()).toEqual([])
    expect(await store.readResource(meta.bookId, 'OEBPS/images/cover.jpg')).toBeNull()
  })

  it('clamps progress and roundtrips annotations by id', async () => {
    const store = new EpubStore(root)
    const { meta } = await store.importBook(epub3Fixture(), 'sample')

    await store.saveProgress(meta.bookId, { chapterIndex: 9, ratio: 2 })
    expect(await store.loadProgress(meta.bookId)).toEqual({ chapterIndex: 1, ratio: 1 })

    const first = annotation()
    await store.saveAnnotations(meta.bookId, [first])
    const replaced = annotation({ quote: 'revised', results: [{ kind: 'explain', text: '讲解', model: 'm', createdAt: 2 }] })
    await store.saveAnnotations(meta.bookId, [replaced, annotation({ id: '0192ab00-0000-7000-8000-000000000002' })])
    const saved = await store.loadAnnotations(meta.bookId)
    expect(saved?.map(row => row.id).sort()).toEqual([first.id, '0192ab00-0000-7000-8000-000000000002'].sort())
    expect(saved?.find(row => row.id === replaced.id)?.results[0]?.kind).toBe('explain')
  })

  it('rejects path escapes and malformed book ids', async () => {
    const store = new EpubStore(root)
    const { meta } = await store.importBook(epub3Fixture(), 'sample')
    for (const escape of ['../book.epub', 'OEBPS/../../book.epub', '/etc/passwd', '..\\mimetype']) {
      expect(await store.readResource(meta.bookId, escape)).toBeNull()
    }
    // A normalized path that lands back inside the book stays readable.
    expect(await store.readResource(meta.bookId, 'OEBPS/text/ch1.xhtml/../../nav.xhtml')).not.toBeNull()
    expect(await store.readResource('../other', 'mimetype')).toBeNull()
    expect(await store.loadMeta('not a uuid!')).toBeNull()
    expect(await store.loadAnnotations('x/../y')).toBeNull()
  })
})
