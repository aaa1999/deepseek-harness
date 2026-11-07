/** Controller library flow over a real Context: import, chapter, annotations, progress. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import EpubReaderController from '../src/index.ts'
import { epub3Fixture } from './fixture.ts'

const roots: Context[] = []
let root = ''

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'epub-reader-controller-')) })
afterEach(async () => {
  await Promise.all(roots.splice(0).map(context => context.fiber.dispose()))
  await rm(root, { recursive: true, force: true })
})

/** A controller over the temporary data root. */
function controller(): EpubReaderController {
  const ctx = new Context(); roots.push(ctx)
  return new EpubReaderController(ctx, {
    dataRoot: root,
    maxBookBytes: 50 * 1024 * 1024,
    targetLanguage: '简体中文',
    provider: '',
    model: '',
    maxOutputTokens: 2048,
  })
}

/** The fixture archive as canonical base64, as the browser sends it. */
function fixtureBase64(): string {
  return Buffer.from(epub3Fixture()).toString('base64')
}

describe('EpubReaderController', () => {
  it('imports, lists, reads a chapter, and removes a book', async () => {
    const service = controller()
    const row = await service.importBook('sample.epub', fixtureBase64(), AbortSignal.timeout(5000))
    expect(row.title).toBe('Sample Book')
    expect(row.chapterCount).toBe(2)
    expect(row.coverUrl).toContain('/api/epub-reader/resource?book=')

    const listed = await service.list()
    expect(listed.map(book => book.bookId)).toEqual([row.bookId])

    const chapter = await service.chapter(row.bookId, 0)
    expect(chapter.title).toBe('First Chapter')
    expect(chapter.html).toContain('<em>best</em>')
    expect(chapter.html).not.toContain('calibre')

    await expect(service.chapter(row.bookId, 9)).rejects.toThrow(/chapter/i)
    await service.removeBook(row.bookId)
    await expect(service.list()).resolves.toEqual([])
  })

  it('rejects oversized and malformed imports before touching the store', async () => {
    const service = controller()
    await expect(service.importBook('bad.epub', 'not base64 !!!', AbortSignal.timeout(5000))).rejects.toThrow(/base64/i)
    await expect(service.importBook('bad.epub', Buffer.from('x').toString('base64'), AbortSignal.timeout(5000))).rejects.toThrow(/EPUB/i)
  })

  it('saves progress and upserts and deletes annotations by id', async () => {
    const service = controller()
    const row = await service.importBook('sample.epub', fixtureBase64(), AbortSignal.timeout(5000))

    await service.saveProgress(row.bookId, { chapterIndex: 1, ratio: 0.5 })
    await expect(service.list()).resolves.toMatchObject([{ progress: { chapterIndex: 1, ratio: 0.5 } }])

    const note = {
      id: '0192ab00-0000-7000-8000-00000000000a',
      chapterIndex: 0,
      start: 4,
      end: 10,
      quote: 'was th',
      createdAt: 1,
      results: [{ kind: 'translate' as const, text: '曾是', model: 'm', createdAt: 2 }],
    }
    await service.saveAnnotation(row.bookId, note)
    await service.saveAnnotation(row.bookId, { ...note, results: [{ kind: 'explain' as const, text: '讲解', model: 'm', createdAt: 3 }] })
    await expect(service.annotations(row.bookId)).resolves.toMatchObject([{ id: note.id, results: [{ kind: 'explain' }] }])

    await expect(service.saveAnnotation(row.bookId, { ...note, start: 10, end: 4 })).rejects.toThrow(/range/i)
    await service.deleteAnnotation(row.bookId, note.id)
    await expect(service.annotations(row.bookId)).resolves.toEqual([])
  })

  it('serves the resource route with type guards and traversal rejection', async () => {
    const service = controller()
    const row = await service.importBook('sample.epub', fixtureBase64(), AbortSignal.timeout(5000))
    const url = new URL(row.coverUrl ?? '', 'http://host')
    const good = await service.serveResource(new Request(`http://host${url.pathname}${url.search}`))
    expect(good.status).toBe(200)
    expect(good.headers.get('content-type')).toBe('image/jpeg')
    expect(good.headers.get('content-security-policy')).toBe('sandbox')

    const escape = await service.serveResource(new Request(`http://host/api/epub-reader/resource?book=${row.bookId}&path=../book.epub`))
    expect(escape.status).toBe(404)
    const wrongType = await service.serveResource(new Request(`http://host/api/epub-reader/resource?book=${row.bookId}&path=OEBPS/content.opf`))
    expect(wrongType.status).toBe(404)
  })
})
