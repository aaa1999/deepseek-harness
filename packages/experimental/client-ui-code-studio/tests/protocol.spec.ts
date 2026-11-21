/**
 * Unit tests of the code studio's protocol folds: JSON-RPC framing, CDP
 * previews, and the frame queue the streams drain. These cover the pure
 * translation layers; real-process behavior is smoke-tested in
 * `node-run.e2e.ts`.
 */

import { describe, expect, it } from 'vitest'
import { FrameQueue } from '../src/debug.ts'
import { encodeMessage, readMessages } from '../src/jsonrpc.ts'

/** Collect an async iterable into an array. */
async function collect<Item>(items: AsyncIterable<Item>): Promise<Item[]> {
  const collected: Item[] = []
  for await (const item of items) collected.push(item)
  return collected
}

/** One async chunk source from a static list. */
async function* chunksOf(chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks
}

describe('jsonrpc framing', () => {
  it('encodes a framed message', () => {
    const framed = encodeMessage({ jsonrpc: '2.0', method: 'x', params: 1 })
    const text = new TextDecoder().decode(framed)
    const body = '{"jsonrpc":"2.0","method":"x","params":1}'
    expect(text).toBe(`Content-Length: ${body.length}\r\n\r\n${body}`)
  })

  it('parses messages split across chunk boundaries', async () => {
    const first = encodeMessage({ id: 1, result: 'half' })
    const second = encodeMessage({ method: 'n', params: { a: 2 } })
    const split = [first.subarray(0, 7), first.subarray(7), second.subarray(0, 20), second.subarray(20)]
    const delivered: unknown[] = []
    await readMessages(chunksOf(split), (message) => { delivered.push(message) })
    expect(delivered).toEqual([
      { id: 1, result: 'half' },
      { method: 'n', params: { a: 2 } },
    ])
  })

  it('rejects a malformed header', async () => {
    await expect(readMessages(chunksOf([new TextEncoder().encode('Not-A-Header: 3\r\n\r\n{}')]), () => {})).rejects.toThrow('malformed header')
  })
})

describe('FrameQueue', () => {
  it('delivers pushed items in order and ends', async () => {
    const queue = new FrameQueue<number>()
    queue.push(1)
    queue.push(2)
    queue.end()
    expect(await collect(queue.drain(new AbortController().signal))).toEqual([1, 2])
  })

  it('drops pushes after end', async () => {
    const queue = new FrameQueue<number>()
    queue.push(1)
    queue.end()
    queue.push(2)
    expect(await collect(queue.drain(new AbortController().signal))).toEqual([1])
  })

  it('stops the drain on abort', async () => {
    const queue = new FrameQueue<number>()
    const controller = new AbortController()
    queue.push(1)
    const drained = collect(queue.drain(controller.signal))
    controller.abort()
    expect(await drained).toEqual([1])
  })
})
