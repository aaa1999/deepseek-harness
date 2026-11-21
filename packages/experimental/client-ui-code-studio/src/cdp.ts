/**
 * Chrome DevTools Protocol client over one WebSocket to a Node inspector.
 * Sends method calls matched by id and dispatches domain events; used by the
 * debug session for the `Debugger` and `Runtime` domains. Protocol payloads
 * stay untyped records; {@link ./debug.ts} interprets them at its boundary.
 */

/** Minimal browser/Node WebSocket face this client needs. */
interface WebSocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((event: { readonly data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
}

/** Observer of CDP domain events and connection loss. */
export interface CdpObserver {
  /** One domain event, such as `Debugger.paused`. */
  onEvent(method: string, params: unknown): void
  /** The socket failed or closed; no further delivery follows. */
  onClosed(reason: string): void
}

/** Deadline for the inspector WebSocket to open, in milliseconds. */
export const CONNECT_TIMEOUT_MS = 10_000

/**
 * One open CDP connection.
 *
 * Event and reply delivery is ordered by arrival. `send` rejects only on
 * connection loss or when the reply carries a CDP error object; callers own
 * higher-level deadlines.
 */
export class CdpConnection {
  private nextId = 0
  private readonly pending = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>()
  private closed: string | null = null
  private readonly socket: WebSocketLike

  /**
   * Open the connection and wait for the socket to be ready.
   * @param url - `ws://` inspector URL from the child's startup banner.
   * @param observer - receives domain events and the closing reason.
   * @returns the open connection.
   * @throws {Error} when no WebSocket implementation exists, the deadline passes, or the socket errors.
   */
  static async open(url: string, observer: CdpObserver): Promise<CdpConnection> {
    if (!('WebSocket' in globalThis)) throw new Error('cdp: this runtime provides no WebSocket')
    const socket = new globalThis.WebSocket(url) as WebSocketLike
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.onopen = null
        reject(new Error(`cdp: the inspector at ${url} did not open within ${CONNECT_TIMEOUT_MS}ms`))
      }, CONNECT_TIMEOUT_MS)
      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = (event) => {
        clearTimeout(timer)
        reject(new Error(`cdp: the inspector at ${url} failed: ${String(event)}`))
      }
    })
    return new CdpConnection(socket, observer)
  }

  private constructor(socket: WebSocketLike, private readonly observer: CdpObserver) {
    this.socket = socket
    socket.onmessage = (event) => { this.receive(event.data) }
    socket.onerror = () => { this.close('socket error') }
    socket.onclose = () => { this.close('socket closed') }
  }

  /**
   * Call one CDP method.
   * @param method - full method name, such as `Debugger.resume`.
   * @param params - method params, omitted when none.
   * @returns the method's `result` object.
   * @throws {Error} the CDP error message, or the closing reason on connection loss.
   */
  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed !== null) return Promise.reject(new Error(`cdp: connection closed: ${this.closed}`))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) =>{  resolve(result) },
        reject: (error) =>{  reject(error) },
      })
      try {
        this.socket.send(JSON.stringify({ id, method, params: params ?? {} }))
      } catch (error) {
        this.pending.delete(id)
        reject(new Error(`cdp: sending ${method} failed: ${String(error)}`))
      }
    })
  }

  /** Close the socket; pending calls reject with the closing reason. */
  dispose(): void {
    this.close('disposed')
    try {
      this.socket.close()
    } catch {
      // A close after the socket ended is not an error worth reporting.
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string' || this.closed !== null) return
    let message: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { message?: unknown } }
    try {
      message = JSON.parse(data) as typeof message
    } catch {
      return
    }
    if (typeof message.method === 'string') {
      this.observer.onEvent(message.method, message.params)
      return
    }
    const id = message.id
    if (typeof id === 'number') {
      const entry = this.pending.get(id)
      if (entry === undefined) return
      this.pending.delete(id)
      if (message.error !== undefined) {
        const cause = message.error.message
        entry.reject(new Error(`cdp: call ${String(id)}: ${typeof cause === 'string' ? cause : 'error'}`))
      } else {
        entry.resolve(message.result)
      }
    }
  }

  private close(reason: string): void {
    if (this.closed !== null) return
    this.closed = reason
    for (const entry of this.pending.values()) entry.reject(new Error(`cdp: connection closed: ${reason}`))
    this.pending.clear()
    this.observer.onClosed(reason)
  }
}
