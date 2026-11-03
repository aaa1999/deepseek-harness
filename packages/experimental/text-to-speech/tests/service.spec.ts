/** Provider routing, cancellation, and fiber-owned registration lifetimes. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import TextToSpeech from '../src/index.ts'
import type { SpeechSynthesizer, SynthesisOutput, SynthesisPreparationState, SynthesisProviderId } from '../src/types.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const result: SynthesisOutput = { audio: new Uint8Array([1, 2]), audioSeconds: 1, synthesisSeconds: 0.1 }
const text = '你好'
const input = new AbortController().signal
function provider(id: string, synthesize: SpeechSynthesizer['synthesize'] = async () => result): SpeechSynthesizer {
  return { info: { id: id as SynthesisProviderId, name: id, location: 'host-local', languages: ['auto', 'zh', 'en'] }, synthesize }
}

/** Mount the service behind Loader with a settings stub that writes patches back into its live entry config. */
async function mounted(ctx: Context, config: object) {
  const live = await liveConfig(ctx, TextToSpeech, config)
  const writes: object[] = []
  ctx.provide('settings', { update: async (_entry: string, patch: Record<string, unknown>) => { writes.push(patch); await live.update(patch) } } as never)
  return { synthesis: ctx.get('textToSpeech')!, writes, live }
}

it('shares Host preparation across observers and does not cancel work when observation ends', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'vits-melo-local', language: 'auto' })
  await base
  try {
    const service = ctx.get('textToSpeech')!, id = 'local' as SynthesisProviderId
    let state: SynthesisPreparationState = { phase: 'unprepared' }, notify = (): void => {}
    const prepare = vi.fn(), cancel = vi.fn(async () => {}), unsubscribe = vi.fn()
    const remove = service.register({ ...provider(id), preparation: {
      snapshot: () => state, prepare, cancel, subscribe: (listener) => { notify = listener; return unsubscribe },
    } })
    const lifetime = new AbortController(), stream = service.follow(lifetime.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ providers: [{ id, preparation: { phase: 'unprepared' } }] })
    service.prepare(id)
    expect(prepare).toHaveBeenCalledOnce()
    service.prepare(id, { downloadSource: 'https://mirror.example' })
    expect(prepare).toHaveBeenLastCalledWith({ downloadSource: 'https://mirror.example' })
    const next = stream.next()
    state = { phase: 'downloading', resource: 'model', completedBytes: 638, totalBytes: 936 }; notify()
    expect((await next).value).toMatchObject({ providers: [{ preparation: state }] })
    lifetime.abort()
    expect((await stream.next()).done).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
    await service.cancelPreparation(id)
    expect(cancel).toHaveBeenCalledOnce()
    await remove()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(() => { service.prepare(id) }).toThrow('unavailable')
    await expect(service.cancelPreparation(id)).rejects.toThrow('unavailable')
    await expect(service.follow(lifetime.signal)[Symbol.asyncIterator]().next()).rejects.toThrow()
  } finally { await base.dispose() }
})

it('persists explicit provider and language changes through the profile and publishes them with readiness', async () => {
  const ctx = new Context()
  try {
    const { synthesis, writes } = await mounted(ctx, { defaultProvider: 'vits-melo-local', language: 'auto' })
    synthesis.register(provider('vits-melo-local')); synthesis.register(provider('cloud'))
    const stream = synthesis.follow(new AbortController().signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ selection: { providerId: 'vits-melo-local', language: 'auto' } })
    const next = stream.next()
    await synthesis.configure({ providerId: 'cloud' as SynthesisProviderId })
    expect((await next).value).toMatchObject({ selection: { providerId: 'cloud', language: 'auto' } })
    await synthesis.configure({ language: 'en' })
    expect(synthesis.snapshot().selection).toEqual({ providerId: 'cloud', language: 'en' })
    expect(synthesis.resolve({ text })).toMatchObject({ provider: { info: { id: 'cloud' } }, language: 'en' })
    expect(writes).toEqual([{ defaultProvider: 'cloud' }, { language: 'en' }])
    await expect(synthesis.configure({ providerId: 'missing' as SynthesisProviderId })).rejects.toThrow('unavailable')
    await expect(synthesis.configure({ language: '' })).rejects.toThrow()
    expect(synthesis.snapshot().selection).toEqual({ providerId: 'cloud', language: 'en' })
  } finally { await ctx.fiber.dispose() }
})

it('refuses to configure without the settings service or a profile entry', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'local', language: 'auto' })
    const synthesis = ctx.get('textToSpeech')!
    synthesis.register(provider('local'))
    await expect(synthesis.configure({ language: 'zh' })).rejects.toThrow('settings service')
    ctx.provide('settings', { update: vi.fn() } as never)
    await expect(synthesis.configure({ language: 'zh' })).rejects.toThrow('profile entry')
    expect(synthesis.snapshot().selection).toEqual({ providerId: 'local', language: 'auto' })
  } finally { await ctx.fiber.dispose() }
})

it('ends waiting observers and rejects registration after service disposal', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'vits-melo-local', language: 'auto' })
  await base
  const service = ctx.get('textToSpeech')!, stream = service.follow(new AbortController().signal)[Symbol.asyncIterator]()
  await stream.next()
  const waiting = stream.next()
  await base.dispose()
  expect((await waiting).done).toBe(true)
  expect(() => service.register(provider('late'))).toThrow('disposed')
})

describe('synthesis providers', () => {
  it('resolves composition defaults and explicit provider choices without fallback', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', language: 'zh' })
    await base
    const service = ctx.get('textToSpeech')!
    const a = provider('local'), b = provider('cloud')
    const removeA = service.register(a), removeB = service.register(b)
    expect(service.listProviders()).toEqual([a.info, b.info])
    const spec = service.resolve({ text })
    expect(spec).toEqual({ text, language: 'zh', provider: a })
    expect(service.resolve({ text, providerId: b.info.id, language: 'en' })).toEqual({ text, language: 'en', provider: b })
    expect(await service.synthesize(spec, input)).toEqual(result)
    expect(() => service.register(a)).toThrow('already registered')
    expect(() => service.resolve({ text, providerId: 'missing' as SynthesisProviderId })).toThrow('unavailable')
    await removeA(); await removeA()
    await expect(service.synthesize(spec, input)).rejects.toThrow('no longer registered')
    await removeB(); await base.dispose()
  })

  it('withdraws a provider before joining accepted work and keeps a replacement registration', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', language: 'auto' })
    await base
    const service = ctx.get('textToSpeech')!
    let enter!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const p = provider('local', async (_value, signal) => {
      enter()
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return result
    })
    const remove = service.register(p)
    const operation = service.synthesize(service.resolve({ text }), input)
    const rejection = expect(operation).rejects.toThrow('unloaded')
    await entered
    const removing = remove()
    expect(service.listProviders()).toEqual([])
    const next = provider('local')
    const removeNext = service.register(next)
    await removing; await rejection; await remove()
    expect(service.listProviders()).toEqual([next.info])
    await removeNext(); await base.dispose()
  })

  it('rejects pre-aborted and withdrawn queued work before the synthesizer starts', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', language: 'auto' })
    await base
    const service = ctx.get('textToSpeech')!
    let calls = 0
    const remove = service.register(provider('local', async () => { calls++; return result }))
    const spec = service.resolve({ text })
    await expect(service.synthesize(spec, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    const run = service.synthesize(spec, input)
    const rejected = expect(run).rejects.toThrow('unloaded')
    await remove(); await rejected
    expect(calls).toBe(0)
    await base.dispose()
  })

  it('removes a registration with its contributing fiber', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'vits-melo-local', language: 'auto' })
    await base
    const fiber = ctx.inject(['textToSpeech'], (owner) => {
      owner.effect(() => owner.textToSpeech.register(provider('vits-melo-local')))
    })
    await fiber
    expect(ctx.get('textToSpeech')!.listProviders()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.get('textToSpeech')!.listProviders()).toEqual([])
    await base.dispose()
  })
})

it('rejects unsupported language selections before persistence or synthesis', async () => {
  const ctx = new Context()
  try {
    const { synthesis, writes } = await mounted(ctx, { defaultProvider: 'local', language: 'auto' })
    const synthesize = vi.fn(async () => result)
    synthesis.register(provider('local', synthesize))
    const cloud = provider('cloud', synthesize)
    synthesis.register({ ...cloud, info: { ...cloud.info, languages: ['fr'] } })
    await expect(synthesis.configure({ language: 'fr' })).rejects.toThrow('does not support language')
    await expect(synthesis.configure({ providerId: cloud.info.id })).rejects.toThrow('does not support language')
    expect(writes).toEqual([])
    expect(() => synthesis.resolve({ text, language: 'fr' })).toThrow('does not support language')
    expect(synthesize).not.toHaveBeenCalled()
    await synthesis.configure({ providerId: cloud.info.id, language: 'fr' })
    expect(synthesis.resolve({ text })).toMatchObject({ provider: { info: { id: 'cloud', languages: ['fr'] } }, language: 'fr' })
  } finally { await ctx.fiber.dispose() }
})

it('requires the composition to choose its default provider', () => {
  expect(() => z.resolve({}, TextToSpeech.Config, {})).toThrow()
  const resolved = TextToSpeech.Config({ defaultProvider: 'custom', language: 'auto' })
  expect([resolved.defaultProvider.get(), resolved.language.get()]).toEqual(['custom', 'auto'])
})
