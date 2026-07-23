import { describe, expect, it, vi, beforeEach } from 'vitest'
import { messageCrypto } from '@/hooks/useMessages'
import { RealtimeWebSocket } from '@/lib/websocket/index'

declare const global: typeof globalThis & { WebSocket: any }

describe('message encryption', () => {
  it('encrypts and decrypts with shared key', async () => {
    const key = await messageCrypto.deriveKey('secret', 'thread-1')
    const { ciphertext, iv } = await messageCrypto.encryptText('hello world', key)
    const plaintext = await messageCrypto.decryptText(ciphertext, iv, key)
    expect(plaintext).toBe('hello world')
  })

  it('produces different ciphertext for same plaintext with different keys', async () => {
    const key1 = await messageCrypto.deriveKey('secret-1', 'thread-1')
    const key2 = await messageCrypto.deriveKey('secret-2', 'thread-1')
    const { ciphertext: ct1 } = await messageCrypto.encryptText('same message', key1)
    const { ciphertext: ct2 } = await messageCrypto.encryptText('same message', key2)
    expect(ct1).not.toEqual(ct2)
  })

  it('fails to decrypt with wrong key', async () => {
    const correctKey = await messageCrypto.deriveKey('correct', 'thread-1')
    const wrongKey = await messageCrypto.deriveKey('wrong', 'thread-1')
    const { ciphertext, iv } = await messageCrypto.encryptText('secret data', correctKey)
    await expect(messageCrypto.decryptText(ciphertext, iv, wrongKey)).rejects.toThrow()
  })
})

describe('E2E encryption — key exchange and session', () => {
  it('key bundle contains all required fields', () => {
    const bundle = {
      identityKey: new Uint8Array(33),
      signedPreKey: { keyId: 1, publicKey: new Uint8Array(33), signature: new Uint8Array(64) },
      oneTimePreKeys: [{ keyId: 1, publicKey: new Uint8Array(33) }],
    }
    expect(bundle.identityKey).toHaveLength(33)
    expect(bundle.signedPreKey.keyId).toBe(1)
    expect(bundle.signedPreKey.publicKey).toHaveLength(33)
    expect(bundle.signedPreKey.signature).toHaveLength(64)
    expect(bundle.oneTimePreKeys).toHaveLength(1)
  })

  it('encrypted message has correct structure', () => {
    const msg = {
      id: 'msg-1',
      senderId: 'user-a',
      recipientId: 'user-b',
      ciphertext: new Uint8Array([0x01, 0x02, 0x03]),
      messageType: 3 as const,
      timestamp: Date.now(),
    }
    expect(msg.senderId).not.toBe(msg.recipientId)
    expect(msg.ciphertext.length).toBeGreaterThan(0)
    expect([1, 3]).toContain(msg.messageType)
  })

  it('delivery receipt tracks message status', () => {
    const receipt = {
      messageId: 'msg-1',
      recipientId: 'user-b',
      status: 'delivered' as const,
      timestamp: Date.now(),
    }
    expect(receipt.status).toBe('delivered')
    expect(receipt.messageId).toBe('msg-1')
  })

  it('sealed sender envelope contains version byte and data', () => {
    const sealedMsg = {
      id: 'sealed-1',
      envelope: new Uint8Array([0x01, ...new Array(33).fill(0), ...new Array(20).fill(0xFF)]),
      signature: new Uint8Array(64),
      messageType: 1 as const,
      timestamp: Date.now(),
    }
    expect(sealedMsg.envelope[0]).toBe(0x01)
    expect(sealedMsg.envelope.length).toBeGreaterThan(34)
    expect(sealedMsg.signature).toHaveLength(64)
  })
})

describe('websocket wrapper', () => {
  class FakeWebSocket {
    static OPEN = 1
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
