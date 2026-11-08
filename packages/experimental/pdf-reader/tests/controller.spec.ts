/** Controller flows over a real Context: library, meta reports, annotations, streams, guards. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PdfReaderController from '../src/index.ts'
import { base64Of, pdfFixture, pngFixture } from './fixture.ts'

const roots: Context[] = []
let root = ''

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pdf-reader-controller-')) })
afterEach(async () => {
  await Promise.all(roots.splice(0).map(context => context.fiber.dispose()))
  await rm(root, { recursive: true, force: true })
})

/** The config every test controller shares. */
function config(overrides: Partial<ConstructorParameters<typeof PdfReaderController>[1]> = {}) {
  return {
    dataRoot: root,
    maxPdfBytes: 100 * 1024 * 1024,
    targetLanguage: '简体中文',
    provider: '',
    model: '',
    shotProvider: '',
    shotModel: '',
    maxOutputTokens: 2048,
    ...overrides,
  }
}

/** A controller over the temporary data root. */
function controller(overrides: Partial<ConstructorParameters<typeof PdfReaderController>[1]> = {}): PdfReaderController {
  const ctx = new Context(); roots.push(ctx)
  return new PdfReaderController(ctx, config(overrides))
}

/** The fixture PDF as canonical base64, as the browser sends it. */
function pdfBase64(): string {
  return base64Of(pdfFixture())
}

describe('PdfReaderController', () => {
  it('imports, lists, serves bytes, and removes a book', async () => {
    const service = controller()
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))
    expect(row.title).toBe('paper')
    expect(row.pageCount).toBe(0)
    expect(row.coverUrl).toBeNull()

    const listed = await service.list()
    expect(listed.map(book => book.bookId)).toEqual([row.bookId])

    const bytes = await service.pdfBytes(row.bookId)
    expect(bytes.data).toEqual(pdfFixture())

    await service.removeBook(row.bookId)
    await expect(service.list()).resolves.toEqual([])
    await expect(service.pdfBytes(row.bookId)).rejects.toThrow(/no such book/i)
  })

  it('rejects malformed and non-PDF imports before touching the store', async () => {
    const service = controller()
    await expect(service.importBook('bad.pdf', 'not base64 !!!', null, AbortSignal.timeout(5000))).rejects.toThrow(/base64/i)
    await expect(service.importBook('bad.pdf', base64Of(new TextEncoder().encode('plain text')), null, AbortSignal.timeout(5000))).rejects.toThrow(/PDF/i)
  })

  it('files a web-capture source beside the import and sanitizes junk to null', async () => {
    const service = controller()
    const capturedAt = Date.now()
    const row = await service.importBook('page.pdf', pdfBase64(), { url: 'https://example.com/a?b=1', capturedAt }, AbortSignal.timeout(5000))
    expect(row.source).toEqual({ url: 'https://example.com/a?b=1', capturedAt })
    const listed = await service.list()
    expect(listed[0]?.source).toEqual(row.source)

    const badUrl = await service.importBook('page.pdf', pdfBase64(), { url: 'javascript:alert(1)', capturedAt }, AbortSignal.timeout(5000))
    expect(badUrl.source).toBeNull()
    const stale = await service.importBook('page.pdf', pdfBase64(), { url: 'https://example.com/b', capturedAt: Number.NaN }, AbortSignal.timeout(5000))
    expect(stale.source?.url).toBe('https://example.com/b')
    // A dropped stamp fails the bound instead of comparing against undefined.
    const stamped = stale.source?.capturedAt ?? Number.NaN
    expect(Math.abs(stamped - Date.now())).toBeLessThan(5000)
  })

  it('accepts the first-open report and bounds its values', async () => {
    const service = controller()
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))

    const reported = await service.saveBookMeta(row.bookId, {
      title: 'A Real Title', pageCount: 42, outline: [{ title: 'Chapter One', page: 1 }, { title: 'Chapter Two', page: 20 }],
    })
    expect(reported).toMatchObject({ title: 'A Real Title', pageCount: 42 })
    expect(reported.outline).toHaveLength(2)

    await expect(service.saveBookMeta(row.bookId, { title: '', pageCount: 0, outline: [] })).rejects.toThrow(/page count/i)
    await expect(service.saveBookMeta(row.bookId, { title: '', pageCount: 10, outline: [{ title: 'x', page: 11 }] })).rejects.toThrow(/outline/i)
    await expect(service.saveBookMeta(row.bookId, { title: '', pageCount: 10, outline: [{ title: 'x', page: 0 }] })).rejects.toThrow(/outline/i)
  })

  it('stores a browser cover only when it is a bounded PNG', async () => {
    const service = controller()
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))

    await expect(service.saveCover(row.bookId, base64Of(new TextEncoder().encode('junk')))).rejects.toThrow(/PNG/i)
    await service.saveCover(row.bookId, base64Of(pngFixture()))
    const listed = await service.list()
    expect(listed[0]?.coverUrl).toContain('/api/pdf-reader/cover?book=')

    const url = new URL(listed[0]?.coverUrl ?? '', 'http://host')
    const served = await service.serveImage(new Request(`http://host${url.pathname}${url.search}`), 'cover')
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('content-security-policy')).toBe('sandbox')

    const missing = await service.serveImage(new Request(`http://host${url.pathname}?book=${row.bookId}..`), 'cover')
    expect(missing.status).toBe(404)
  })

  it('saves progress and upserts both annotation kinds by id', async () => {
    const service = controller()
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))
    await service.saveBookMeta(row.bookId, { title: '', pageCount: 10, outline: [] })

    await service.saveProgress(row.bookId, { page: 4 })
    await expect(service.list()).resolves.toMatchObject([{ progress: { page: 4 } }])
    await service.saveProgress(row.bookId, { page: 99 })
    await expect(service.list()).resolves.toMatchObject([{ progress: { page: 10 } }])

    const note = {
      kind: 'text' as const, id: '0192ab00-0000-7000-8000-00000000000a', page: 2,
      start: 4, end: 10, quote: 'was th', createdAt: 1,
      results: [{ kind: 'translate' as const, text: '曾是', model: 'm', createdAt: 2 }],
    }
    const shot = {
      kind: 'shot' as const, id: '0192ab00-0000-7000-8000-00000000000b', page: 3,
      rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.2 },
      imageUrl: '/api/pdf-reader/shot?book=b&id=x', question: '解释', createdAt: 3,
      answer: { text: '解释内容', model: 'm', createdAt: 4 },
    }
    await service.saveAnnotation(row.bookId, note)
    await service.saveAnnotation(row.bookId, shot)
    await expect(service.annotations(row.bookId)).resolves.toEqual([shot, note])

    await expect(service.saveAnnotation(row.bookId, { ...note, start: 10, end: 4 })).rejects.toThrow(/range/i)
    await expect(service.saveAnnotation(row.bookId, { ...shot, rect: { x: 0.9, y: 0, width: 0.5, height: 0.5 } })).rejects.toThrow(/rect/i)
    await expect(service.saveAnnotation(row.bookId, { ...shot, page: 11 })).rejects.toThrow(/page/i)

    await service.deleteAnnotation(row.bookId, shot.id)
    await expect(service.annotations(row.bookId)).resolves.toEqual([note])
  })

  it('streams a text treatment through the LLM service', async () => {
    const ctx = new Context(); roots.push(ctx)
    const calls: unknown[] = []
    ctx.provide('llm', {
      listProviders: () => [],
      listModels: async () => [],
      resolveModelInfo: async () => ({}),
      stream: (options: unknown) => {
        calls.push(options)
        return (async function* () { yield { type: 'text-delta', text: '曾是' } })()
      },
    } as never)
    ctx.provide('agentDefaultModel', { provider: 'deepseek-official', model: 'deepseek-chat' } as never)
    const service = new PdfReaderController(ctx, config())
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))

    const chunks = []
    for await (const chunk of service.explain({ bookId: row.bookId, page: 2, kind: 'translate', text: 'was', context: 'it was' }, AbortSignal.timeout(5000))) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual([{ type: 'meta', model: 'deepseek-chat' }, { type: 'delta', text: '曾是' }, { type: 'done' }])
    const call = calls[0] as { system: string; messages: { role: string }[] }
    expect(call.system).toContain('第 2 页')
    expect(call.messages[0]?.role).toBe('user')

    const refused = service.explain(
      { bookId: row.bookId, page: 2, kind: 'translate', text: '  ', context: '' },
      AbortSignal.timeout(5000),
    )
    await expect(refused[Symbol.asyncIterator]().next()).rejects.toThrow(/empty/i)
  })

  it('streams a screenshot answer through the attachment store and serves the crop', async () => {
    const ctx = new Context(); roots.push(ctx)
    const saved: { mediaType: string; bytes: number }[] = []
    const calls: { content: unknown[] }[] = []
    ctx.provide('attachments', {
      saveImage: async (input: { data: Uint8Array; mediaType: string }) => {
        saved.push({ mediaType: input.mediaType, bytes: input.data.byteLength })
        return { attachmentId: 'at1', mediaType: input.mediaType, bytes: input.data.byteLength, width: 10, height: 10 }
      },
    } as never)
    ctx.provide('llm', {
      listProviders: () => [],
      listModels: async () => [],
      resolveModelInfo: async (_provider: string, model: string) =>
        ({ inputModalities: model.includes('vision') ? ['text', 'image'] : ['text'] }),
      stream: (options: { messages: { content: unknown[] }[] }) => {
        calls.push({ content: options.messages[0]!.content })
        return (async function* () { yield { type: 'text-delta', text: '图中是' } })()
      },
    } as never)
    ctx.provide('agentDefaultModel', { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' } as never)
    const service = new PdfReaderController(ctx, config())
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))

    const chunks = []
    for await (const chunk of service.askImage({
      bookId: row.bookId, page: 1, rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
      annotationId: '0192ab00-0000-7000-8000-00000000000c',
      pngBase64: base64Of(pngFixture(48)), question: '解释这块',
    }, AbortSignal.timeout(5000))) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual([
      { type: 'meta', model: 'deepseek-v4-flash-vision-exp' },
      { type: 'delta', text: '图中是' },
      { type: 'done', imageUrl: expect.stringContaining('/api/pdf-reader/shot?book=') },
    ])
    expect(saved).toEqual([{ mediaType: 'image/png', bytes: 48 }])
    const blocks = calls[0]!.content as { type: string }[]
    expect(blocks.map(block => block.type)).toEqual(['image', 'text'])

    const url = new URL((chunks[2] as { imageUrl: string }).imageUrl, 'http://host')
    const served = await service.serveImage(new Request(`http://host${url.pathname}${url.search}`), 'shot')
    expect(served.status).toBe(200)
  })

  it('honors a per-ask model override and rejects a non-vision pick', async () => {
    const ctx = new Context(); roots.push(ctx)
    const streams: { model: string }[] = []
    ctx.provide('attachments', {
      saveImage: async (input: { data: Uint8Array }) =>
        ({ attachmentId: 'at1', mediaType: 'image/png', bytes: input.data.byteLength, width: 10, height: 10 }),
    } as never)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek Vision' },
      ],
      resolveModelInfo: async (_provider: string, model: string) =>
        ({ inputModalities: model.includes('vision') ? ['text', 'image'] : ['text'] }),
      stream: (options: { model: string }) => {
        streams.push({ model: options.model })
        return (async function* () { yield { type: 'text-delta', text: '好的' } })()
      },
    } as never)
    const service = new PdfReaderController(ctx, config())
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))
    const ask = {
      bookId: row.bookId, page: 1, rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
      annotationId: '0192ab00-0000-7000-8000-00000000000e',
      pngBase64: base64Of(pngFixture()), question: '解释',
    }

    for await (const chunk of service.askImage({ ...ask, provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' }, AbortSignal.timeout(5000))) {
      void chunk
    }
    expect(streams).toEqual([{ model: 'deepseek-v4-flash-vision-exp' }])

    const refused = service.askImage(
      { ...ask, provider: 'deepseek-official', model: 'deepseek-chat' },
      AbortSignal.timeout(5000),
    )
    await expect(refused[Symbol.asyncIterator]().next()).rejects.toThrow(/no image input/i)
  })

  it('refuses screenshot asks when the resolved model cannot see images', async () => {
    const ctx = new Context(); roots.push(ctx)
    ctx.provide('attachments', { saveImage: async () => { throw new Error('unreachable') } } as never)
    ctx.provide('llm', {
      listProviders: () => [],
      listModels: async () => [],
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      stream: () => { throw new Error('unreachable') },
    } as never)
    ctx.provide('agentDefaultModel', { provider: 'deepseek-official', model: 'deepseek-chat' } as never)
    const service = new PdfReaderController(ctx, config())
    const row = await service.importBook('paper.pdf', pdfBase64(), null, AbortSignal.timeout(5000))

    const refused = service.askImage({
      bookId: row.bookId, page: 1, rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
      annotationId: '0192ab00-0000-7000-8000-00000000000d',
      pngBase64: base64Of(pngFixture()), question: '',
    }, AbortSignal.timeout(5000))
    await expect(refused[Symbol.asyncIterator]().next()).rejects.toThrow(/no image input/i)
  })

  it('flags vision models in the catalog and guards the shot pair', async () => {
    const ctx = new Context(); roots.push(ctx)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
      listModels: async () => [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek Vision' },
      ],
      resolveModelInfo: async (_provider: string, model: string) =>
        ({ inputModalities: model.includes('vision') ? ['text', 'image'] : ['text'] }),
    } as never)
    ctx.provide('agentDefaultModel', { provider: 'deepseek-official', model: 'deepseek-chat' } as never)
    const entry = { options: { id: 'pdf-reader' } }
    let applied: ((current: Record<string, unknown>) => Record<string, unknown>) | undefined
    ctx.provide('configEditor', {
      entries: () => [entry],
      edit: async (_entry: unknown, change: (current: Record<string, unknown>) => Record<string, unknown>) => {
        applied = change as typeof applied
      },
    } as never)
    const service = new PdfReaderController(ctx, config())

    const catalog = await service.treatmentModels()
    expect(catalog.models).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-chat', name: 'DeepSeek Chat', vision: false },
      { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek Vision', vision: true },
    ])

    await expect(service.setShotModel('deepseek-official', 'deepseek-chat')).rejects.toThrow(/no image input/i)
    await expect(service.setShotModel('', 'deepseek-v4-flash-vision-exp')).rejects.toThrow(/together/i)
    await expect(service.setTreatmentModel('nope', 'x')).rejects.toThrow(/not routable/i)

    await service.setShotModel('deepseek-official', 'deepseek-v4-flash-vision-exp')
    expect(applied?.({ shotProvider: 'old', shotModel: 'old' })).toEqual({
      shotProvider: 'deepseek-official',
      shotModel: 'deepseek-v4-flash-vision-exp',
    })
    await service.setTreatmentModel('deepseek-official', 'deepseek-chat')
    expect(applied?.({ provider: 'old', model: 'old', targetLanguage: 'en' })).toEqual({
      provider: 'deepseek-official', model: 'deepseek-chat', targetLanguage: 'en',
    })
  })

  it('reports the resolved storage root and guards runtime changes', async () => {
    const service = controller()
    await expect(service.storage()).resolves.toEqual({ directory: root, configurable: false })
    await expect(service.setStorageDirectory('/somewhere/else')).rejects.toThrow(/not available/i)

    const ctx = new Context(); roots.push(ctx)
    const entry = { options: { id: 'pdf-reader' } }
    let applied: ((current: Record<string, unknown>) => Record<string, unknown>) | undefined
    ctx.provide('configEditor', {
      entries: () => [entry, { options: { id: 'other' } }],
      edit: async (_entry: unknown, change: (current: Record<string, unknown>) => Record<string, unknown>) => {
        applied = change as typeof applied
      },
    } as never)
    const editable = new PdfReaderController(ctx, config())
    await expect(editable.storage()).resolves.toMatchObject({ configurable: true })
    await expect(editable.setStorageDirectory('relative/path')).rejects.toThrow(/absolute/i)

    await editable.setStorageDirectory('/papers/here')
    expect(applied?.({ dataRoot: 'old' })).toEqual({ dataRoot: '/papers/here' })
    await editable.setStorageDirectory('   ')
    expect(applied?.({ dataRoot: 'old', targetLanguage: 'en' })).toEqual({ targetLanguage: 'en' })
  })
})
