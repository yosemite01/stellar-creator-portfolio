'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RealtimeWebSocket, WSStatus } from '@/lib/websocket/index'
import { toast } from 'sonner'

export type Attachment = {
  name: string
  type: string
  size: number
  data: string // base64
}

export type ChatMessage = {
  id: string
  threadId: string
  senderId: string
  recipientId: string
  createdAt: string
  ciphertext: string
  iv: string
  plaintext?: string
  attachment?: Attachment | null
  status?: 'sent' | 'delivered' | 'read'
  readBy?: string[]
}

type SendMessageInput = {
  text: string
  file?: File | null
  threadId: string
  senderId: string
  recipientId: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const base64FromArrayBuffer = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))

const arrayBufferFromBase64 = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer

async function deriveKey(passphrase: string, threadId: string) {
  const salt = textEncoder.encode(`stellar-${threadId}`)
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptText(plaintext: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(plaintext))
  return { ciphertext: base64FromArrayBuffer(ciphertextBuffer), iv: base64FromArrayBuffer(iv.buffer) }
}

async function decryptText(ciphertext: string, iv: string, key: CryptoKey) {
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(arrayBufferFromBase64(iv)) },
    key,
    arrayBufferFromBase64(ciphertext)
  )
  return textDecoder.decode(plaintextBuffer)
}

// exported for unit testing
export const messageCrypto = { deriveKey, encryptText, decryptText }

export function useMessages(threadId: string, currentUserId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [status, setStatus] = useState<WSStatus>('connecting')
  const [passphrase, setPassphrase] = useState('')
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null)
  const socketRef = useRef<RealtimeWebSocket | null>(null)
  const pendingRead = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!passphrase) {
      setCryptoKey(null)
      return
    }
    deriveKey(passphrase, threadId)
      .then(setCryptoKey)
      .catch(() => setCryptoKey(null))
  }, [passphrase, threadId])

  const decryptMessages = useCallback(async (items: ChatMessage[]) => {
    if (!cryptoKey) {
      return items.map((msg) => ({ ...msg, plaintext: 'Encrypted message. Enter passphrase to decrypt.' }))
    }

    const decrypted = await Promise.all(
      items.map(async (msg) => {
        try {
          const plaintext = await decryptText(msg.ciphertext, msg.iv, cryptoKey)
          return { ...msg, plaintext }
        } catch (err) {
          console.warn('Failed to decrypt', err)
          return { ...msg, plaintext: 'Unable to decrypt with current passphrase' }
        }
      })
    )
    return decrypted
  }, [cryptoKey])

  // History over REST (survives restarts / multi-instance).
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/messages?threadId=${encodeURIComponent(threadId)}`)
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { messages?: ChatMessage[] }
        if (!Array.isArray(data.messages)) return
        const decrypted = await decryptMessages(data.messages)
        if (!cancelled) setMessages(decrypted)
      } catch (err) {
        console.warn('Failed to load message history', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [threadId, decryptMessages])

  // Live events on standalone realtime server (token from REST).
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    let socket: RealtimeWebSocket | null = null
    let unsubscribe: (() => void) | undefined

    void (async () => {
      try {
        const tokenRes = await fetch('/api/messages/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ threadId }),
        })
        if (!tokenRes.ok || cancelled) return
        const { token, wsUrl } = (await tokenRes.json()) as { token: string; wsUrl: string }
        if (!token || !wsUrl || cancelled) return

        socket = new RealtimeWebSocket(
          `${wsUrl}?threadId=${encodeURIComponent(threadId)}&token=${encodeURIComponent(token)}`,
          { onStatusChange: setStatus },
        )
        socketRef.current = socket

        unsubscribe = socket.subscribe(async (event) => {
          const payload = JSON.parse(event.data)
          if (payload.type === 'message') {
            const decrypted = await decryptMessages([payload.data])
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.data.id)) return prev
              return [...prev, ...decrypted]
            })
            if (payload.data.senderId !== currentUserId) toast.success('New message received')
          } else if (payload.type === 'typing') {
            setTypingUsers((prev) => {
              if (payload.userId === currentUserId) return prev
              const next = new Set(prev)
              next.add(payload.userId)
              setTimeout(
                () => setTypingUsers((list) => list.filter((id) => id !== payload.userId)),
                2000,
              )
              return Array.from(next)
            })
          } else if (payload.type === 'read-receipt') {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === payload.messageId
                  ? {
                      ...msg,
                      status: 'read',
                      readBy: Array.from(new Set([...(msg.readBy || []), payload.userId])),
                    }
                  : msg,
              ),
            )
          } else if (payload.type === 'moderated') {
            toast.warning(`Message ${payload.action} by admin`)
            if (payload.action === 'delete') {
              setMessages((prev) => prev.filter((m) => m.id !== payload.messageId))
            }
          }
        })
      } catch (err) {
        console.warn('Failed to connect messages websocket', err)
        setStatus('closed')
      }
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
      socket?.close()
      socketRef.current = null
    }
  }, [threadId, currentUserId, decryptMessages])

  const sendMessage = async ({ text, file, threadId: tId, senderId, recipientId }: SendMessageInput) => {
    const key = cryptoKey || (await deriveKey(passphrase || senderId, threadId))
    const encrypted = await encryptText(text, key)
    let attachment: Attachment | null = null

    if (file) {
      const buffer = await file.arrayBuffer()
      attachment = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: base64FromArrayBuffer(buffer),
      }
    }

    const id = crypto.randomUUID()
    const optimistic: ChatMessage = {
      id,
      threadId: tId,
      senderId,
      recipientId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      createdAt: new Date().toISOString(),
      plaintext: text,
      attachment,
      status: 'sent',
      readBy: [senderId],
    }
    setMessages((prev) => [...prev, optimistic])

    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        threadId: tId,
        recipientId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        attachment,
        metadata: { plainText: text.slice(0, 200) },
      }),
    })
    if (!res.ok) {
      toast.error('Failed to send message')
      setMessages((prev) => prev.filter((m) => m.id !== id))
    }
  }

  const sendTyping = () => {
    socketRef.current?.send({ type: 'typing', userId: currentUserId, threadId })
  }

  const markRead = (messageId: string) => {
    if (pendingRead.current.has(messageId)) return
    pendingRead.current.add(messageId)
    socketRef.current?.send({ type: 'read-receipt', messageId, userId: currentUserId })
  }

  const moderate = (messageId: string, action: 'delete' | 'flag', reason?: string) => {
    socketRef.current?.send({ type: 'moderate', messageId, action, moderatorId: currentUserId, reason })
  }

  const search = (q: string) => {
    const query = q.toLowerCase()
    return messages.filter((msg) => msg.plaintext?.toLowerCase().includes(query))
  }

  const connectionInfo = useMemo(
    () => ({ isConnected: status === 'open', status }),
    [status]
  )

  return {
    messages,
    typingUsers,
    status,
    connectionInfo,
    setPassphrase,
    sendMessage,
    sendTyping,
    markRead,
    moderate,
    search,
  }
}
