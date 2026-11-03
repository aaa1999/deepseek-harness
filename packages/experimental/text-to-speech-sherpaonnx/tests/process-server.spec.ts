/** Authenticated loopback protocol for one serial synthesizer. */
import { afterEach, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { startSynthesisServer } from '../src/process-server.ts'

const servers: { server: Server; port: number }[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(({ server }) => new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })))
})

async function served(token = 'a'.repeat(64), maxTextBytes = 1024) {
  const synthesize = (text: string) => {
    const audio = Buffer.from(`RIFF${text}`)
    return { audio: new Uint8Array(audio), audioSeconds: 1, synthesisSeconds: 0.1 }
  }
  const entry = await startSynthesisServer(token, maxTextBytes, synthesize)
  servers.push(entry)
  return entry
}

it('answers a valid synthesis with canonical base64 audio and timings', async () => {
  const { port } = await served()
  const response = await fetch(`http://127.0.0.1:${port}/synthesize`, {
    method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好', language: 'zh' }),
  })
  expect(response.status).toBe(200)
  const value = await response.json() as { audio: string; audioSeconds: number; synthesisSeconds: number }
  expect(Buffer.from(value.audio, 'base64').toString('utf8')).toBe('RIFF你好')
  expect(value.audioSeconds).toBe(1)
  expect(value.synthesisSeconds).toBe(0.1)
})

it('rejects missing tokens and unknown endpoints', async () => {
  const { port } = await served()
  const base = `http://127.0.0.1:${port}`
  expect((await fetch(`${base}/synthesize`, { method: 'POST', body: '{}' })).status).toBe(401)
  expect((await fetch(`${base}/missing`, {
    method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}` },
  })).status).toBe(404)
})

it('rejects malformed JSON and invalid text fields with 400', async () => {
  const { port } = await served()
  const base = `http://127.0.0.1:${port}`
  const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
  for (const body of ['{}', '{"text":1,"language":"auto"}', '{"text":"","language":"auto"}', '{"text":"x"}']) {
    const response = await fetch(`${base}/synthesize`, { method: 'POST', headers, body })
    expect(response.status).toBe(400)
  }
})

it('surfaces worker failures as 500 responses', async () => {
  const entry = await startSynthesisServer('b'.repeat(64), 1024, () => { throw new Error('model offline') })
  servers.push(entry)
  const response = await fetch(`http://127.0.0.1:${entry.port}/synthesize`, {
    method: 'POST', headers: { authorization: `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x', language: 'auto' }),
  })
  expect(response.status).toBe(500)
  expect(await response.json() as { error: string }).toEqual({ error: 'model offline' })
})
