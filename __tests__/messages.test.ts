import { describe, expect, it, vi, beforeEach } from 'vitest'
import { messageCrypto } from '@/hooks/useMessages'
import { RealtimeWebSocket } from '@/lib/websocket'

declare const global: typeof globalThis & { WebSocket: any }

describe('message encryption', () => {
  it('encrypts and decrypts with shared key', async () => {
    const key = await messageCrypto.deriveKey('secret', 'thread-1')
    const { ciphertext, iv } = await messageCrypto.encryptText('hello world', key)
    const plaintext = await messageCrypto.decryptText(ciphertext, iv, key)
    expect(plaintext).toBe('hello world')
  })
})

describe('websocket wrapper', () => {
  class FakeWebSocket {
    public readyState = 0
    public onopen: (() => void) | null = null
    public onmessage: ((event: { data: string }) => void) | null = null
    public onclose: (() => void) | null = null
    public onerror: (() => void) | null = null
    public sent: string[] = []
    constructor() {
      setTimeout(() => {
        this.readyState = 1
        this.onopen?.()
      }, 0)
    }
    send(data: string) {
      this.sent.push(data)
      this.onmessage?.({ data })
    }
    close() {
      this.readyState = 3
      this.onclose?.()
    }
  }

  beforeEach(() => {
    global.WebSocket = FakeWebSocket as any
  })

  it('notifies status changes and sends data', async () => {
    const statuses: string[] = []
    const socket = new RealtimeWebSocket('ws://example.com', { onStatusChange: (s) => statuses.push(s) })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(statuses).toContain('open')
    socket.send({ hello: 'world' })
    expect((socket as any).ws.sent[0]).toContain('hello')
    socket.close()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(statuses).toContain('closed')
  })
})
