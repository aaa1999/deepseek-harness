/** Realtime voice chat auto-submits each spoken segment and reads the reply aloud. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { SpeechInput, SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { SynthesisInput, SynthesisProviderId } from '@deepseek-ai/dsh-text-to-speech/types'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@deepseek-ai/dsh-text-to-speech'
import { fixtureUserPrompts, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-chat-bundle', import.meta.url))

/** MediaRecorder instances the page init script captures for stream driving. */
declare global {
  interface Window {
    __voiceChatRecorders?: MediaRecorder[]
  }
}

/** Encode mono float samples as a 48 kHz PCM16 WAV blob payload. */
function wave48k(level: number, seconds: number): string {
  const length = Math.floor(48000 * seconds)
  const bytes = new Uint8Array(44 + length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string): void => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 48000, true); view.setUint32(28, 96000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
  view.setUint32(40, length * 2, true)
  for (let i = 0; i < length; i++) {
    const value = Math.sin((i * Math.PI * 2 * 440) / 48000) * level
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return Buffer.from(bytes).toString('base64')
}

it('listens continuously, auto-submits the transcript, and reads the reply aloud', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-voice-chat-browser-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(scratch, { recursive: true, force: true }) }
    }
  })
  const overlay = join(scratch, 'voice-chat.patch.yml')
  await writeFile(overlay, '- id: speech-to-text-sensevoice\n  disabled: true\n- id: text-to-speech-sherpaonnx\n  disabled: true\n')
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
  const prefix = 'Use the bash tool to '
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }] },
    extraOverlayPath: overlay, replayFixture: fixture, compareReplaySession: false,
  })
  resources.scaffold = scaffold
  // Both local providers are disabled by the overlay; register deterministic doubles instead.
  const recognize = vi.fn(async (input: SpeechInput) => {
    expect(Buffer.from(input.audio).subarray(0, 4).toString()).toBe('RIFF')
    return { text: prompt.slice(prefix.length), audioSeconds: 1, inferenceSeconds: 0.1 }
  })
  await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Recorded recognizer', location: 'host-local', languages: ['auto'] },
      transcribe: recognize,
    }))
  } })
  const silentWave = wave48k(0, 0.1)
  const synthesize = vi.fn(async (_input: SynthesisInput) => ({
    audio: Buffer.from(silentWave, 'base64'), audioSeconds: 0.1, synthesisSeconds: 0.001,
  }))
  await scaffold.ctx.plugin({ inject: ['textToSpeech'], apply(ctx) {
    ctx.effect(() => ctx.textToSpeech.register({
      info: { id: 'vits-melo-local' as SynthesisProviderId, name: 'Mock synthesizer', location: 'host-local', languages: ['auto'] },
      synthesize,
    }))
  } })
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  })
  resources.browser = browser
  const page = await newEnglishPage(browser), tripwire = watchConsole(page)
  await page.addInitScript(() => {
    window.__voiceChatRecorders = []
    const Native = window.MediaRecorder
    window.MediaRecorder = class extends Native {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options)
        window.__voiceChatRecorders!.push(this)
      }
      override start(): void { Object.assign(this, { state: 'recording' }) }
      override stop(): void { Object.assign(this, { state: 'inactive' }) }
    }
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input]')
  await input.fill(prefix)
  const call = page.getByRole('button', { name: 'Voice call', exact: true })
  await call.click()
  // The blank-session hero has no composer dock, so the status row appears only
  // after the first auto-submit creates the Session; the recorder must exist first.
  const recorderCount = (): Promise<number> => page.evaluate(() => window.__voiceChatRecorders?.length ?? 0)
  await expect.poll(recorderCount, { timeout: 15_000 }).toBe(1)
  const status = page.locator('[data-voice-chat-phase]')
  const drive = async (payload: string, times: number): Promise<void> => {
    await page.evaluate(({ payload, times }) => {
      const recorder = window.__voiceChatRecorders?.at(-1)
      if (recorder === undefined) throw new Error('voice chat recorder is not active')
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      for (let i = 0; i < times; i++) {
        recorder.ondataavailable?.(new BlobEvent('dataavailable', { data: new Blob([bytes], { type: 'audio/wav' }) }))
      }
    }, { payload, times })
  }
  // Loud frames start speech; quiet frames end the segment and drive recognition.
  await drive(wave48k(0.5, 0.25), 2)
  await drive(wave48k(0, 0.25), 3)
  await expect.poll(() => recognize.mock.calls.length, { timeout: 30_000 }).toBe(1)
  // The transcript auto-submits; the replayed turn finishes; the reply reads aloud.
  await expect.poll(() => synthesize.mock.calls.length, { timeout: 30_000 }).toBe(1)
  await expect.poll(() => status.textContent(), { timeout: 30_000 }).toBe('Speak now')
  expect(tripwire.pageErrors).toEqual([])
  await call.click()
  await expect.poll(() => status.count()).toBe(0)
})
