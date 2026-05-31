/**
 * WebSocket endpoint for Yjs CRDT document synchronization.
 * Uses y-websocket's setupWSConnection to handle all Yjs protocol messages.
 */
import { type NextRequest } from 'next/server'

export const runtime = 'nodejs'

// Lazy-load to avoid issues during SSR/build
let setupWSConnection: (ws: WebSocket, req: Request, opts?: { docName?: string }) => void

async function getSetup() {
  if (!setupWSConnection) {
    const mod = await import('y-websocket/bin/utils.js')
    setupWSConnection = mod.setupWSConnection
  }
  return setupWSConnection
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const docName = searchParams.get('doc') ?? 'default'

  // Next.js App Router WebSocket upgrade
  // @ts-expect-error – Next.js exposes socket on the underlying request
  const { socket, response } = Reflect.get(req, 'socket')
    ? { socket: null, response: null }
    : await (req as unknown as { socket: unknown }).socket

  // Use the built-in WebSocket upgrade via Next.js
  const upgradeHeader = req.headers.get('upgrade')
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 })
  }

  try {
    // @ts-expect-error – Next.js internal
    const { socket: ws, response: wsResponse } = req[Symbol.for('NextInternalRequestContext')]?.upgradeWebSocket?.() ?? {}
    if (!ws) {
      return new Response('WebSocket upgrade failed', { status: 500 })
    }
    const setup = await getSetup()
    setup(ws as unknown as WebSocket, req as unknown as Request, { docName })
    return wsResponse
  } catch {
    return new Response('WebSocket not supported in this environment', { status: 501 })
  }
}
