/**
 * Standalone Yjs WebSocket collaboration server.
 * Run with: node --loader ts-node/esm server/collab.ts
 * Or in production: node server/collab.js
 *
 * Listens on WS_PORT (default 1234) and handles Yjs CRDT sync
 * for all document rooms identified by the URL path.
 */
import { WebSocketServer } from 'ws'
import { setupWSConnection } from 'y-websocket/bin/utils.js'

const PORT = parseInt(process.env.WS_PORT ?? '1234', 10)
const HOST = process.env.WS_HOST ?? 'localhost'

const wss = new WebSocketServer({ host: HOST, port: PORT })

wss.on('connection', (ws, req) => {
  // Extract doc name from URL path, e.g. /bounty-123 → 'bounty-123'
  const docName = (req.url ?? '/').replace(/^\//, '') || 'default'
  setupWSConnection(ws, req, { docName })
})

wss.on('listening', () => {
  console.log(`[collab] Yjs WebSocket server running on ws://${HOST}:${PORT}`)
})

wss.on('error', (err) => {
  console.error('[collab] WebSocket server error:', err)
})
