export type WSStatus = 'connecting' | 'open' | 'closed' | 'error'

type Listener = (data: MessageEvent) => void

type Options = {
  reconnect?: boolean
  maxRetries?: number
  onStatusChange?: (status: WSStatus) => void
}

export class RealtimeWebSocket {
  private url: string
  private ws: WebSocket | null = null
  private listeners: Set<Listener> = new Set()
  private retries = 0
  private reconnect: boolean
  private maxRetries: number
  private onStatusChange?: (status: WSStatus) => void

  constructor(url: string, options: Options = {}) {
    this.url = url
    this.reconnect = options.reconnect ?? true
    this.maxRetries = options.maxRetries ?? 5
    this.onStatusChange = options.onStatusChange
    this.connect()
  }

  private connect() {
    this.onStatusChange?.('connecting')
    this.ws = new WebSocket(this.url)

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
