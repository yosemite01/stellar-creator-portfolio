/**
 * Standalone Yjs WebSocket collaboration server.
 * Run with: node --loader ts-node/esm server/collab.ts
 * Or in production: node server/collab.js
 *
 * Listens on WS_PORT (default 1234) and handles Yjs CRDT sync
 * for all document rooms identified by the URL path.
 *
 * Memory-leak mitigations:
 *  - Heartbeat ping/pong with configurable interval and deadline.
 *    Sockets that miss a pong are terminated, releasing all closures.
 *  - Per-connection idle timeout: connections that never send a message
 *    within IDLE_TIMEOUT_MS are forcibly closed.
 *  - Explicit tracking map so we can audit live connections and GC them.
 *  - SIGTERM / SIGINT handlers close the server cleanly so the process
 *    exits without leaking open handles.
 */
import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { setupWSConnection } from 'y-websocket/bin/utils.js'

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.WS_PORT ?? '1234', 10)
const HOST = process.env.WS_HOST ?? 'localhost'

/** How often to send a ping frame (ms). */
const HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.WS_HEARTBEAT_INTERVAL_MS ?? '30000',
  10,
)

/** How long to wait for a pong before terminating the socket (ms). */
const PONG_DEADLINE_MS = parseInt(
  process.env.WS_PONG_DEADLINE_MS ?? '10000',
  10,
)

/** Close sockets that have been idle (no message) for this long (ms). */
const IDLE_TIMEOUT_MS = parseInt(
  process.env.WS_IDLE_TIMEOUT_MS ?? '300000', // 5 min
  10,
)

// ── Connection state ──────────────────────────────────────────────────────────
interface ConnState {
  /** True while we are waiting for a pong reply. */
  awaitingPong: boolean
  /** Timer that fires if pong is not received in time. */
  pongDeadlineTimer: ReturnType<typeof setTimeout> | null
  /** Timer that fires when the connection has been idle too long. */
  idleTimer: ReturnType<typeof setTimeout> | null
  /** Timestamp of the last received message (any type). */
  lastActivity: number
}

/** Live connection registry – used for metrics and forced GC. */
const connections = new Map<WebSocket, ConnState>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearTimers(state: ConnState): void {
  if (state.pongDeadlineTimer !== null) {
    clearTimeout(state.pongDeadlineTimer)
    state.pongDeadlineTimer = null
  }
  if (state.idleTimer !== null) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }
}

function resetIdleTimer(ws: WebSocket, state: ConnState): void {
  if (state.idleTimer !== null) clearTimeout(state.idleTimer)
  state.lastActivity = Date.now()
  state.idleTimer = setTimeout(() => {
    console.warn(
      `[collab] Terminating idle connection (no activity for ${IDLE_TIMEOUT_MS}ms)`,
    )
    ws.terminate()
  }, IDLE_TIMEOUT_MS)
}

function terminateAndCleanup(ws: WebSocket): void {
  const state = connections.get(ws)
  if (state) {
    clearTimers(state)
    connections.delete(ws)
  }
  // terminate() is safe to call even if already closed
  ws.terminate()
}

// ── Server ────────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ host: HOST, port: PORT })

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const docName = (req.url ?? '/').replace(/^\//, '') || 'default'

  // Initialise per-connection state
  const state: ConnState = {
    awaitingPong: false,
    pongDeadlineTimer: null,
    idleTimer: null,
    lastActivity: Date.now(),
  }
  connections.set(ws, state)

  // Start idle timer immediately
  resetIdleTimer(ws, state)

  // ── Pong handler ────────────────────────────────────────────────────────────
  ws.on('pong', () => {
    const s = connections.get(ws)
    if (!s) return
    s.awaitingPong = false
    if (s.pongDeadlineTimer !== null) {
      clearTimeout(s.pongDeadlineTimer)
      s.pongDeadlineTimer = null
    }
    resetIdleTimer(ws, s)
  })

  // ── Message handler – reset idle timer on any data ──────────────────────────
  ws.on('message', () => {
    const s = connections.get(ws)
    if (s) resetIdleTimer(ws, s)
  })

  // ── Cleanup on close / error ─────────────────────────────────────────────────
  ws.on('close', () => {
    const s = connections.get(ws)
    if (s) {
      clearTimers(s)
      connections.delete(ws)
    }
  })

  ws.on('error', (err: Error) => {
    console.error('[collab] Socket error:', err.message)
    terminateAndCleanup(ws)
  })

  // Delegate CRDT sync to y-websocket
  setupWSConnection(ws, req, { docName })
})

// ── Heartbeat loop ────────────────────────────────────────────────────────────
const heartbeatInterval = setInterval(() => {
  for (const [ws, state] of connections) {
    if (ws.readyState !== WebSocket.OPEN) {
      terminateAndCleanup(ws)
      continue
    }

    if (state.awaitingPong) {
      // Previous ping was never answered – zombie connection
      console.warn('[collab] Terminating zombie connection (missed pong)')
      terminateAndCleanup(ws)
      continue
    }

    // Send ping and arm the deadline timer
    state.awaitingPong = true
    state.pongDeadlineTimer = setTimeout(() => {
      console.warn(
        `[collab] Pong deadline exceeded (${PONG_DEADLINE_MS}ms) – terminating`,
      )
      terminateAndCleanup(ws)
    }, PONG_DEADLINE_MS)

    ws.ping()
  }
}, HEARTBEAT_INTERVAL_MS)

// Prevent the interval from keeping the process alive after server close
heartbeatInterval.unref()

wss.on('listening', () => {
  console.log(
    `[collab] Yjs WebSocket server running on ws://${HOST}:${PORT}` +
      ` | heartbeat=${HEARTBEAT_INTERVAL_MS}ms` +
      ` | pong_deadline=${PONG_DEADLINE_MS}ms` +
      ` | idle_timeout=${IDLE_TIMEOUT_MS}ms`,
  )
})

wss.on('error', (err: Error) => {
  console.error('[collab] WebSocket server error:', err)
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal: string): void {
  console.log(`[collab] Received ${signal} – shutting down gracefully`)
  clearInterval(heartbeatInterval)

  // Terminate all open connections so their closures are released
  for (const [ws, state] of connections) {
    clearTimers(state)
    ws.terminate()
  }
  connections.clear()

  wss.close(() => {
    console.log('[collab] Server closed')
    process.exit(0)
  })

  // Force-exit if close takes too long
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
