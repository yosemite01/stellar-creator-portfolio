export type WSStatus = 'connecting' | 'open' | 'closed' | 'error'

type Listener = (data: MessageEvent) => void

type Options = {
  reconnect?: boolean
  maxRetries?: number
  onStatusChange?: (status: WSStatus) => void
  /**
   * Optional auth token. When provided it is appended to the connection URL
   * as a `token` query parameter so the server can authenticate the socket.
   */
  authToken?: string
}

export class RealtimeWebSocket {
  private url: string
  private ws: WebSocket | null = null
  private listeners: Set<Listener> = new Set()
  private retries = 0
  private reconnect: boolean
  private maxRetries: number
  private onStatusChange?: (status: WSStatus) => void
  private authToken?: string

  constructor(url: string, options: Options = {}) {
    this.url = url
    this.reconnect = options.reconnect ?? true
    this.maxRetries = options.maxRetries ?? 5
    this.onStatusChange = options.onStatusChange
    this.authToken = options.authToken
    this.connect()
  }

  public isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private buildUrl(): string {
    if (!this.authToken) return this.url
    try {
      const url = new URL(this.url)
      url.searchParams.set('token', this.authToken)
      return url.toString()
    } catch {
      return this.url
    }
  }

  private connect() {
    this.onStatusChange?.('connecting')
    this.ws = new WebSocket(this.buildUrl())

    this.ws.onopen = () => {
      this.retries = 0
      this.onStatusChange?.('open')
    }

    this.ws.onmessage = (event) => {
      this.listeners.forEach((listener) => listener(event))
    }

    this.ws.onclose = () => {
      this.onStatusChange?.('closed')
      if (this.reconnect && this.retries < this.maxRetries) {
        const delay = Math.min(1000 * 2 ** this.retries, 10000)
        this.retries += 1
        setTimeout(() => this.connect(), delay)
      }
    }

    this.ws.onerror = () => {
      this.onStatusChange?.('error')
    }
  }

  public send(data: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  public subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public close() {
    this.reconnect = false
    this.ws?.close()
  }
}

export interface WebSocketClientOptions {
  url: string
  reconnectAttempts?: number
  /** Kept for API compatibility; reconnects use exponential backoff. */
  reconnectDelay?: number
  onMessage?: (message: unknown) => void
  onError?: (error: Error) => void
  onConnectionChange?: (event: { status: 'connected' | 'disconnected' | 'error'; message?: string }) => void
}

export interface WebSocketClient {
  connect(): void
  disconnect(): void
  isConnected(): boolean
  send(data: unknown): void
}

/**
 * Lazily-connecting client used by `hooks/useWebSocket`. Messages are parsed
 * as JSON; non-JSON frames are passed through as strings.
 */
export function createWebSocketClient(options: WebSocketClientOptions): WebSocketClient {
  let socket: RealtimeWebSocket | null = null

  return {
    connect() {
      if (socket) return
      socket = new RealtimeWebSocket(options.url, {
        maxRetries: options.reconnectAttempts,
        onStatusChange: (status) => {
          if (status === 'open') options.onConnectionChange?.({ status: 'connected' })
          else if (status === 'closed') options.onConnectionChange?.({ status: 'disconnected' })
          else if (status === 'error') {
            options.onConnectionChange?.({ status: 'error' })
            options.onError?.(new Error('WebSocket error'))
          }
        },
      })
      socket.subscribe((event) => {
        let data: unknown = event.data
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data)
          } catch {
            // leave as a string
          }
        }
        options.onMessage?.(data)
      })
    },
    disconnect() {
      socket?.close()
      socket = null
    },
    isConnected() {
      return socket?.isOpen() ?? false
    },
    send(data) {
      socket?.send(data)
    },
  }
}
