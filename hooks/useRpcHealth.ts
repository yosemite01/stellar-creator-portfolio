/**
 * Issue #880 — RPC endpoint health dashboard hook
 *
 * Polls `getPoolHealth` and `getRpcAttemptLog` at a configurable interval so
 * UI dashboards can display live RPC endpoint latency and recent submission
 * success/failure logs without setting up a separate WebSocket.
 */

'use client'

import { useState, useEffect, useCallback } from 'react'
import { getPoolHealth } from '@/lib/config/rpc-fallback'
import { getRpcAttemptLog, type RpcAttemptLog } from '@/lib/soroban/transaction-queue'
import type { NetworkName } from '@/lib/config/network'

export interface RpcEndpointHealth {
  url: string
  latencyMs: number
  /** Derived status based on latency. */
  status: 'healthy' | 'degraded' | 'unreachable'
}

export interface UseRpcHealthResult {
  endpoints: RpcEndpointHealth[]
  recentLogs: RpcAttemptLog[]
  lastUpdated: Date | null
  refresh: () => void
}

const DEGRADED_THRESHOLD_MS = 1_000
const UNREACHABLE_LATENCY = Infinity

function toStatus(latencyMs: number): RpcEndpointHealth['status'] {
  if (latencyMs === UNREACHABLE_LATENCY) return 'unreachable'
  if (latencyMs > DEGRADED_THRESHOLD_MS) return 'degraded'
  return 'healthy'
}

/**
 * @param network   The Stellar network to monitor (default 'mainnet').
 * @param pollMs    How often to refresh, in ms (default 15_000).
 * @param logLimit  How many recent RPC attempt logs to return (default 50).
 */
export function useRpcHealth(
  network: NetworkName = 'mainnet',
  pollMs = 15_000,
  logLimit = 50,
): UseRpcHealthResult {
  const [endpoints, setEndpoints] = useState<RpcEndpointHealth[]>([])
  const [recentLogs, setRecentLogs] = useState<RpcAttemptLog[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = useCallback(() => {
    const raw = getPoolHealth(network)
    setEndpoints(
      raw.map(({ url, latencyMs }) => ({ url, latencyMs, status: toStatus(latencyMs) })),
    )
    const allLogs = getRpcAttemptLog()
    setRecentLogs([...allLogs].reverse().slice(0, logLimit))
    setLastUpdated(new Date())
  }, [network, logLimit])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, pollMs)
    return () => clearInterval(id)
  }, [refresh, pollMs])

  return { endpoints, recentLogs, lastUpdated, refresh }
}
