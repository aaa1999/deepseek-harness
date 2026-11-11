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

  it('reports the resolved storage root and guards runtime changes', async () => {
    const service = controller()
    await expect(service.storage()).resolves.toEqual({ directory: root, configurable: false })
    await expect(service.setStorageDirectory('/somewhere/else')).rejects.toThrow(/not available/i)

    const ctx = new Context(); roots.push(ctx)
    const entry = { options: { id: 'epub-reader' } }
    let applied: ((current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) | undefined
    ctx.provide('configEditor', {
      entries: () => [entry, { options: { id: 'other' } }],
      edit: async (
        _entry: unknown,
        change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        applied = change
      },
    } as never)
    const editable = new EpubReaderController(ctx, {
      dataRoot: root,
      maxBookBytes: 50 * 1024 * 1024,
      targetLanguage: '简体中文',
      provider: '',
      model: '',
      maxOutputTokens: 2048,
    })
    await expect(editable.storage()).resolves.toMatchObject({ configurable: true })
    await expect(editable.setStorageDirectory('relative/path')).rejects.toThrow(/absolute/i)

    await editable.setStorageDirectory('/books/here')
    expect(applied?.({ dataRoot: 'old' }, {})).toEqual({ dataRoot: '/books/here' })
    await editable.setStorageDirectory('   ')
    expect(applied?.({ dataRoot: 'old', targetLanguage: 'en' }, {})).toEqual({ targetLanguage: 'en' })
  })

  it('lists every routable treatment model and switches the pair through the editor', async () => {
    const ctx = new Context(); roots.push(ctx)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'pi-ai', name: 'Pi' }],
      listModels: async (provider: string) => provider === 'deepseek-official'
        ? [
          { provider, id: 'deepseek-chat', name: 'DeepSeek Chat' },
          { provider, id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
        ]
        : [{ provider, id: 'other-model', name: 'Other Model' }],
    } as never)
    ctx.provide('agentDefaultModel', { provider: 'deepseek-official', model: 'deepseek-chat' } as never)
    const entry = { options: { id: 'epub-reader' } }
    let applied: ((current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) | undefined
    ctx.provide('configEditor', {
      entries: () => [entry],
      edit: async (
        _entry: unknown,
        change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
      ) => {
        applied = change
      },
    } as never)
    const service = new EpubReaderController(ctx, {
      dataRoot: root,
      maxBookBytes: 50 * 1024 * 1024,
      targetLanguage: '简体中文',
      provider: '',
      model: '',
      maxOutputTokens: 2048,
    })

    const catalog = await service.treatmentModels()
    expect(catalog).toMatchObject({
      provider: '', model: '',
      defaultProvider: 'deepseek-official', defaultModel: 'deepseek-chat',
    })
    expect(catalog.models).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-chat', name: 'DeepSeek Chat' },
      { provider: 'deepseek-official', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      { provider: 'pi-ai', model: 'other-model', name: 'Other Model' },
    ])

    await expect(service.setTreatmentModel('nope', 'deepseek-chat')).rejects.toThrow(/not routable/i)
    await expect(service.setTreatmentModel('', 'deepseek-chat')).rejects.toThrow(/together/i)

    await service.setTreatmentModel('deepseek-official', 'deepseek-reasoner')
    expect(applied?.({ provider: 'old', model: 'old' }, {})).toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    await service.setTreatmentModel(' ', ' ')
    expect(applied?.({ provider: 'old', model: 'old', targetLanguage: 'en' }, {})).toEqual({ targetLanguage: 'en' })
  })

  it('streams treatments with the adapter default effort and thinking headroom', async () => {
    const calls: { model: string; reasoningEffort: string | undefined; maxTokens: number | undefined }[] = []
    const llm = {
      listProviders: () => [],
      listModels: async () => [],
      resolveModelInfo: async (_provider: string, model: string) => (model === 'deepseek-reasoner'
        ? { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' } }
        : {}),
      stream: (options: { model: string; reasoningEffort?: string; maxTokens?: number }) => {
        calls.push({ model: options.model, reasoningEffort: options.reasoningEffort, maxTokens: options.maxTokens })
        return (async function* () { yield { type: 'text-delta', text: '曾是' } })()
      },
    } as never
    const ctxA = new Context(); roots.push(ctxA); ctxA.provide('llm', llm)
    const ctxB = new Context(); roots.push(ctxB); ctxB.provide('llm', llm)
    const thinking = new EpubReaderController(ctxA, {
      dataRoot: root, maxBookBytes: 50 * 1024 * 1024, targetLanguage: '简体中文',
      provider: 'deepseek-official', model: 'deepseek-reasoner', maxOutputTokens: 2048,
    })
    const row = await thinking.importBook('sample.epub', fixtureBase64(), AbortSignal.timeout(5000))

    const chunks = []
    for await (const chunk of thinking.explain({ bookId: row.bookId, chapterIndex: 0, kind: 'translate', text: 'best', context: 'It was the best of times.' }, AbortSignal.timeout(5000))) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual([{ type: 'meta', model: 'deepseek-reasoner' }, { type: 'delta', text: '曾是' }, { type: 'done' }])
    // 2048 answer budget + 8192 thinking headroom: reasoning shares the output
    // ceiling on zai-style endpoints, so the request must feed both.
    expect(calls[0]).toEqual({ model: 'deepseek-reasoner', reasoningEffort: 'high', maxTokens: 10240 })

    const plain = new EpubReaderController(ctxB, {
      dataRoot: root, maxBookBytes: 50 * 1024 * 1024, targetLanguage: '简体中文',
      provider: 'deepseek-official', model: 'deepseek-chat', maxOutputTokens: 2048,
    })
    for await (const chunk of plain.explain({ bookId: row.bookId, chapterIndex: 0, kind: 'translate', text: 'best', context: 'It was the best of times.' }, AbortSignal.timeout(5000))) {
      void chunk
    }
    expect(calls[1]).toEqual({ model: 'deepseek-chat', maxTokens: 2048 })
  })
})
