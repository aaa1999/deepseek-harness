/** Authenticated loopback transport for one serial native synthesizer. */
import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { SynthesisOutput } from '@deepseek-ai/dsh-text-to-speech/types'

/**
 * Bind an ephemeral loopback listener; model loading completes before readiness is published.
 * @param token - private per-process authentication secret.
 * @param maxTextBytes - maximum retained request bytes.
 * @param synthesize - synchronous synthesis owned by this process.
 * @returns the listening server and its dynamically assigned port.
 */
export async function startSynthesisServer(token: string, maxTextBytes: number,
  synthesize: (text: string) => SynthesisOutput): Promise<{ server: Server; port: number }> {
  const expected = Buffer.from(`Bearer ${token}`)
  const server = createServer((request, response) => {
    const reply = (status: number, value: object): void => {
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    }
    const authorization = Buffer.from(request.headers.authorization ?? '')
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      request.resume(); reply(401, { error: 'Unauthorized' }); return
    }
    const url = new URL(request.url as string, 'http://localhost')
    if (request.method !== 'POST' || url.pathname !== '/synthesize') {
      request.resume(); reply(404, { error: 'Unknown endpoint' }); return
    }
    const length = Number(request.headers['content-length'])
    if (!Number.isSafeInteger(length) || length < 2 || length > maxTextBytes + 64) {
      request.resume(); reply(413, { error: 'Invalid synthesis request size' }); return
    }
    void (async () => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          const bytes = chunk as Buffer
          chunks.push(bytes)
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (typeof body !== 'object' || body === null || !('text' in body) || !('language' in body)) {
          reply(400, { error: 'Invalid synthesis text' }); return
        }
        const { text, language } = body
        if (typeof text !== 'string' || typeof language !== 'string' || text.length === 0
          || Buffer.byteLength(text, 'utf8') > maxTextBytes) {
          reply(400, { error: 'Invalid synthesis text' }); return
        }
        const output = synthesize(text)
        reply(200, { audio: Buffer.from(output.audio).toString('base64'),
          audioSeconds: output.audioSeconds, synthesisSeconds: output.synthesisSeconds })
      } catch (error) {
        reply(500, { error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address() as { port: number }
  return { server, port: address.port }
}
