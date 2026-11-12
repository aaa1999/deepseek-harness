/** Authenticated synthesis domain methods validate text before selecting a synthesizer. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import TextToSpeech from '@deepseek-ai/dsh-text-to-speech'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-text-to-speech/types'
import SpeechSynthesisController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })
const id = 'vits-melo-local' as SynthesisProviderId
const audio = Buffer.from('RIFF' + '\0'.repeat(40))
function fixture(maxTextBytes = 8192, maxAudioBytes = 64) {
  const ctx = new Context(); roots.push(ctx)
  const synthesis = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id, language: 'auto' }))
  const speak = vi.fn(async () => ({ audio: new Uint8Array(audio), audioSeconds: 1, synthesisSeconds: 0.1 }))
  synthesis.register({ info: { id, name: 'test', location: 'host-local', languages: ['auto', 'zh', 'en'] }, synthesize: speak })
  return { api: new SpeechSynthesisController(ctx, { maxTextBytes, maxAudioBytes }), speak }
}

it('lists limits without synthesis and forwards explicit provider and language', async () => {
  const { api, speak } = fixture()
  expect(api.catalog()).toMatchObject({ selection: { providerId: id }, maxTextBytes: 8192, providers: [{ id }] })
  expect(speak).not.toHaveBeenCalled()
  api.prepare(id)
  await api.cancelPreparation(id)
  const lifetime = new AbortController(), observation = api.follow(lifetime.signal)[Symbol.asyncIterator]()
  expect((await observation.next()).value).toMatchObject({ providers: [{ id, preparation: { phase: 'ready' } }] })
  lifetime.abort(); await observation.next()
  const out = await api.synthesize({ text: '你好', providerId: id, language: 'zh' }, new AbortController().signal)
  expect(out.audioBase64).toBe(audio.toString('base64'))
  expect(out.audioSeconds).toBe(1)
  expect(speak).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh' }), expect.any(AbortSignal))
  await api.synthesize({ text: 'hi' }, new AbortController().signal)
  expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'auto' }), expect.any(AbortSignal))
})

it('forwards an explicit download source to the registered preparation owner', async () => {
  const ctx = new Context(); roots.push(ctx)
  const synthesis = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id }))
  const prepare = vi.fn()
  synthesis.register({ info: { id, name: 'local', location: 'host-local', languages: ['auto'], downloadSources: ['https://hf-mirror.com'] },
    preparation: { snapshot: () => ({ phase: 'unprepared' }), subscribe: () => () => {}, prepare, cancel: async () => {} },
    synthesize: async () => ({ audio: new Uint8Array(), audioSeconds: 0, synthesisSeconds: 0 }),
  })
  const api = new SpeechSynthesisController(ctx, { maxTextBytes: 100, maxAudioBytes: 64 })
  expect(api.catalog().providers[0]?.downloadSources).toEqual(['https://hf-mirror.com'])
  api.prepare(id, { downloadSource: 'https://hf-mirror.com' })
  expect(prepare).toHaveBeenCalledWith({ downloadSource: 'https://hf-mirror.com' })
})

it('rejects empty and oversized text without synthesis', async () => {
  const { api, speak } = fixture(8, 64)
  await expect(api.synthesize({ text: '' }, new AbortController().signal)).rejects.toMatchObject({ code: 'speech/invalid-text' })
  await expect(api.synthesize({ text: 'x'.repeat(9) }, new AbortController().signal)).rejects.toMatchObject({ code: 'speech/invalid-text' })
  expect(speak).not.toHaveBeenCalled()
})

it('preserves cancellation and reports synthesizer failures', async () => {
  const { api, speak } = fixture()
  await expect(api.configure({ language: 'zh' })).rejects.toThrow('settings service')
  await expect(api.synthesize({ text: 'hi' }, AbortSignal.abort(new Error('cancel')))).rejects.toThrow('cancel')
  speak.mockRejectedValueOnce(new Error('offline'))
  await expect(api.synthesize({ text: 'hi' }, new AbortController().signal)).rejects.toMatchObject({ code: 'speech/synthesis-failed', message: 'offline' })
  speak.mockRejectedValueOnce('failed')
  await expect(api.synthesize({ text: 'hi' }, new AbortController().signal)).rejects.toMatchObject({ message: 'failed' })
})
