/**
 * Minimal stdio JSON-RPC 2.0 client for one language-server child process:
 * Content-Length framing on both pipes, pending-request matching, and
 * server-to-client notification dispatch. Only the surface the language
 * session needs; responses and notifications are untyped records interpreted
 * by {@link ./lang.ts} at its protocol boundary.
 */

import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/** One JSON-RPC message: a request, a reply, or a server notification. */
export type JsonRpcMessage = { readonly [key: string]: unknown }

/** Observer of server notifications and connection loss. */
export interface JsonRpcObserver {
  /** One server notification, such as `textDocument/publishDiagnostics`. */
  onNotification(method: string, params: unknown): void
  /** The connection failed or closed; no further delivery follows. */
  onClosed(reason: string): void
}

/** Cap of one inbound JSON-RPC message; larger frames fail the connection. */
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024

/**
 * Encode one framed message as UTF-8 bytes ready to write.
 * @param message - the message to frame.
 * @returns the Content-Length header followed by the JSON body.
 */
export function encodeMessage(message: JsonRpcMessage): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message))
  const header = new TextEncoder().encode(`Content-Length: ${body.byteLength}\r\n\r\n`)
  const framed = new Uint8Array(header.byteLength + body.byteLength)
  framed.set(header)
  framed.set(body, header.byteLength)
  return framed
}

/**
 * Parse complete messages out of an inbound byte stream.
 * @param chunks - raw stdout chunks of the server process.
 * @param deliver - called once per decoded message.
 * @throws {Error} when a header is malformed or a message exceeds {@link MAX_MESSAGE_BYTES}.
 */
export async function readMessages(
  chunks: AsyncIterable<Uint8Array>, deliver: (message: JsonRpcMessage) => void,
): Promise<void> {
  let buffer = new Uint8Array(0)
  const decoder = new TextDecoder()
  for await (const chunk of chunks) {
    const merged = new Uint8Array(buffer.byteLength + chunk.byteLength)
    merged.set(buffer)
    merged.set(chunk, buffer.byteLength)
    buffer = merged
    for (;;) {
      const headerEnd = indexOf(buffer, HEADER_SEPARATOR)
      if (headerEnd < 0) {
        if (buffer.byteLength > MAX_MESSAGE_BYTES) throw new Error('jsonrpc: header exceeds the message cap')
        break
      }
      const header = decoder.decode(buffer.subarray(0, headerEnd))
      const length = /^Content-Length: (\d+)\r?$/.exec(header.split('\r\n')[0] ?? '')
      if (length === null) throw new Error(`jsonrpc: malformed header '${header}'`)
      const bodyStart = headerEnd + HEADER_SEPARATOR.byteLength
      const bodyLength = Number(length[1])
      if (bodyLength > MAX_MESSAGE_BYTES) throw new Error('jsonrpc: message exceeds the message cap')
      if (buffer.byteLength < bodyStart + bodyLength) break
      const body = decoder.decode(buffer.subarray(bodyStart, bodyStart + bodyLength))
      buffer = buffer.subarray(bodyStart + bodyLength)
      deliver(JSON.parse(body) as JsonRpcMessage)
    }
  }
}

/** Byte sequence ending one JSON-RPC header. */
const HEADER_SEPARATOR = new Uint8Array([13, 10, 13, 10])

/** First index of `needle` in `haystack`, or `-1`. */
function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let at = 0; at <= haystack.byteLength - needle.byteLength; at++) {
    for (let i = 0; i < needle.byteLength; i++) {
      if (haystack[at + i] !== needle[i]) continue outer
    }
    return at
  }
  return -1
}

/**
 * One JSON-RPC connection over a spawned server's pipes. Writes are queued
 * serially; reads run until the pipe ends or framing fails. Pending requests
 * reject when the connection closes.
 */
export class JsonRpcConnection {
  private nextId = 0
  private readonly pending = new Map<number, { resolve(message: JsonRpcMessage): void; reject(error: Error): void }>()
  private writes: Promise<void> = Promise.resolve()
  private closed: string | null = null
  private readonly reads: Promise<void>

  /**
   * Start reading the handle's stdout; stderr is drained and discarded up to a
   * small cap so a chatty server cannot block.
   * @param handle - spawned language-server process.
   * @param observer - receives notifications and the closing reason.
   * @param maxStderrBytes - cap on retained stderr text used in close reasons.
   */
  constructor(
    private readonly handle: SubprocessHandle,
    private readonly observer: JsonRpcObserver,
    maxStderrBytes = 64 * 1024,
  ) {
    const stdout = handle.stdout
    const stderr = handle.stderr
    const stdin = handle.stdin
    if (stdout === undefined || stderr === undefined || stdin === undefined) {
      throw new Error('jsonrpc: the language server spawned without pipes')
    }
    let drained = ''
    stderr.on('data', (chunk: Uint8Array) => {
      if (drained.length < maxStderrBytes) drained += new TextDecoder().decode(chunk)
    })
    this.reads = readMessages(stdout, (message) =>{  this.receive(message) }).catch((error: unknown) => {
      this.close(drained.length > 0 ? `${String(error)}; server stderr: ${drained}` : String(error))
    })
  }

  /** Wait for the read loop to settle after the pipe ends. */
  async drained(): Promise<void> {
    await this.reads
  }

  /**
   * Send one request and await its reply.
   * @param method - request method.
   * @param params - request params.
   * @returns the reply's `result` field.
   * @throws {Error} with the reply's error message, or when the connection closed first.
   */
  request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (message) => {
          if ('error' in message) {
            const cause = (message.error as { message?: unknown } | undefined)?.message
            reject(new Error(`jsonrpc: ${method} failed: ${typeof cause === 'string' ? cause : 'unknown error'}`))
          } else {
            resolve(message.result)
          }
        },
        reject: (error) =>{  reject(error) },
      })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  /**
   * Send one notification; fire-and-forget with no reply.
   * @param method - the notification method name.
   * @param params - the notification parameters.
   */
  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private send(message: JsonRpcMessage): void {
    this.writes = this.writes
      .then(async () => {
        const framed = encodeMessage(message)
        const stdin = this.handle.stdin
        if (stdin === undefined) throw new Error('jsonrpc: the server stdin is closed')
        if (!stdin.write(framed)) await new Promise<void>(resolve => stdin.once('drain', () => { resolve() }))
      })
      .catch((error: unknown) => { this.close(String(error)) })
  }

  private receive(message: JsonRpcMessage): void {
    if (this.closed !== null) return
    if (typeof message.method === 'string' && message.id === undefined) {
      this.observer.onNotification(message.method, message.params)
      return
    }
    const id = message.id
    if (typeof id === 'number') {
      this.pending.get(id)?.resolve(message)
      this.pending.delete(id)
    }
  }

  private close(reason: string): void {
    if (this.closed !== null) return
    this.closed = reason
    for (const entry of this.pending.values()) entry.reject(new Error(`jsonrpc: connection closed: ${reason}`))
    this.pending.clear()
    this.observer.onClosed(reason)
  }
}
