import { NextRequest, NextResponse } from 'next/server'

type Attachment = {
  name: string
  type: string
  size: number
  data: string // base64 string
}

type MessagePayload = {
  id: string
  threadId: string
  senderId: string
  recipientId: string
  ciphertext: string
  iv: string
  createdAt: string
  attachment?: Attachment | null
  status?: 'sent' | 'delivered' | 'read'
  readBy?: string[]
  metadata?: Record<string, unknown>
}

type ServerState = {
  clients: Set<WebSocket>
  history: MessagePayload[]
}

const getState = (): ServerState => {
  const globalRef = globalThis as unknown as { __messageState?: ServerState }
  if (!globalRef.__messageState) {
    globalRef.__messageState = { clients: new Set<WebSocket>(), history: [] }
  }
  return globalRef.__messageState
}

const upgradeWebSocket = (request: Request) => {
  const denoUpgrade = (globalThis as any)?.Deno?.upgradeWebSocket
  if (denoUpgrade) {
    return denoUpgrade(request)
  }

  const anyRequest = request as any
  if (anyRequest?.webSocket) {
    const { webSocket } = anyRequest
    webSocket.accept()
    return { socket: webSocket as WebSocket, response: new Response(null, { status: 101 }) }
  }

  throw new Error('WebSocket upgrade is not supported in this runtime')
}

const broadcast = (data: unknown) => {
  const payload = JSON.stringify(data)
  const { clients } = getState()
  clients.forEach((socket) => {
    try {
      socket.send(payload)
    } catch (err) {
      console.error('Failed to send message to client', err)
      try {
        socket.close()
      } catch {
        // ignore
      }
      clients.delete(socket)
    }
  })
}

const handleMessageEvent = (socket: WebSocket, raw: string) => {
  const state = getState()
  try {
    const parsed = JSON.parse(raw) as { type: string; [key: string]: any }
    if (parsed.type === 'message') {
      const message: MessagePayload = {
        id: parsed.id || crypto.randomUUID(),
        threadId: parsed.threadId || 'general',
        senderId: parsed.senderId,
        recipientId: parsed.recipientId || 'all',
        ciphertext: parsed.ciphertext,
        iv: parsed.iv,
        createdAt: parsed.createdAt || new Date().toISOString(),
        attachment: parsed.attachment || null,
        status: 'sent',
        readBy: parsed.readBy || [parsed.senderId],
        metadata: parsed.metadata || {},
      }
      state.history.push(message)
      broadcast({ type: 'message', data: message })
    } else if (parsed.type === 'typing') {
      broadcast({ type: 'typing', userId: parsed.userId, threadId: parsed.threadId })
    } else if (parsed.type === 'read-receipt') {
      const { messageId, userId } = parsed
      state.history = state.history.map((msg) =>
        msg.id === messageId
          ? { ...msg, status: 'read', readBy: Array.from(new Set([...(msg.readBy || []), userId])) }
          : msg
      )
      broadcast({ type: 'read-receipt', messageId, userId })
    } else if (parsed.type === 'moderate') {
      const { messageId, action, moderatorId, reason } = parsed
      if (action === 'delete') {
        state.history = state.history.filter((m) => m.id !== messageId)
      }
      broadcast({ type: 'moderated', messageId, action, moderatorId, reason })
    } else if (parsed.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
    }
  } catch (err) {
    console.error('Invalid payload', err)
    socket.send(JSON.stringify({ type: 'error', message: 'Invalid payload' }))
  }
}

export async function GET(request: NextRequest) {
  const upgradeHeader = request.headers.get('upgrade')

  if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
    try {
      const { socket, response } = upgradeWebSocket(request)
      const state = getState()

      socket.addEventListener('open', () => {
        state.clients.add(socket)
        socket.send(
          JSON.stringify({ type: 'history', data: state.history.slice(-200) }) // cap initial history
        )
      })

      socket.addEventListener('message', (event: MessageEvent) => {
        const raw = typeof event.data === 'string' ? event.data : ''
        handleMessageEvent(socket, raw)
      })

      socket.addEventListener('close', () => {
        state.clients.delete(socket)
      })

      socket.addEventListener('error', () => {
        state.clients.delete(socket)
      })

      return response
    } catch (err) {
      console.error('WebSocket upgrade failed', err)
      return NextResponse.json({ error: 'WebSocket upgrade failed' }, { status: 400 })
    }
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.toLowerCase().trim()
  const threadId = searchParams.get('threadId') || undefined
  const state = getState()
  const filtered = state.history.filter((msg) => {
    const inThread = threadId ? msg.threadId === threadId : true
    if (!q) return inThread
    return inThread && (msg.metadata?.plainText as string | undefined)?.toLowerCase().includes(q)
  })

  return NextResponse.json({ messages: filtered })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const state = getState()
  const message: MessagePayload = {
    id: body.id || crypto.randomUUID(),
    threadId: body.threadId || 'general',
    senderId: body.senderId,
    recipientId: body.recipientId || 'all',
    ciphertext: body.ciphertext,
    iv: body.iv,
    createdAt: new Date().toISOString(),
    attachment: body.attachment || null,
    status: 'sent',
    readBy: [body.senderId],
    metadata: body.metadata || {},
  }
  state.history.push(message)
  broadcast({ type: 'message', data: message })
  return NextResponse.json({ ok: true, message })
}

export const dynamic = 'force-dynamic'
export const runtime = 'edge'
