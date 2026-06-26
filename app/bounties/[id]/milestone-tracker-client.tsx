'use client'

import { useCallback, useEffect, useState } from 'react'
import { MilestoneTracker } from '@/components/MilestoneTracker'
import type { Milestone, MilestoneStatus } from '@/lib/creators-data'
import { Wifi, WifiOff } from 'lucide-react'

interface Props {
  bountyId: string
  initialMilestones: Milestone[]
  /** 'freelancer' | 'client' | undefined for demo; wire to session role in production */
  role?: 'freelancer' | 'client'
}

function applyMilestoneUpdate(
  milestones: Milestone[],
  milestoneId: string,
  patch: Partial<Milestone>
): Milestone[] {
  return milestones.map((m) => (m.id === milestoneId ? { ...m, ...patch } : m))
}

export function MilestoneTrackerClient({ bountyId, initialMilestones, role }: Props) {
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones)
  const [wsConnected, setWsConnected] = useState(false)

  // WebSocket for real-time milestone status updates
  useEffect(() => {
    // In production replace with your WS endpoint, e.g. process.env.NEXT_PUBLIC_WS_URL
    const wsUrl =
      typeof window !== 'undefined'
        ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/ws?bountyId=${bountyId}`
        : null

    if (!wsUrl) return

    let ws: WebSocket
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      try {
        ws = new WebSocket(wsUrl!)
        ws.onopen = () => setWsConnected(true)
        ws.onclose = () => {
          setWsConnected(false)
          // Reconnect after 5 s
          reconnectTimer = setTimeout(connect, 5000)
        }
        ws.onerror = () => ws.close()
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as {
              type: 'milestone_update'
              milestoneId: string
              status: MilestoneStatus
              comment?: { id: string; author: 'client' | 'freelancer'; text: string; createdAt: string }
            }
            if (msg.type === 'milestone_update') {
              setMilestones((prev) => {
                const updated = applyMilestoneUpdate(prev, msg.milestoneId, { status: msg.status })
                if (msg.comment) {
                  return updated.map((m) =>
                    m.id === msg.milestoneId
                      ? { ...m, comments: [...m.comments, msg.comment!] }
                      : m
                  )
                }
                return updated
              })
            }
          } catch {
            // ignore malformed messages
          }
        }
      } catch {
        // WS not available (e.g. static export) — silently skip
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [bountyId])

  const handleSubmit = useCallback((milestoneId: string) => {
    setMilestones((prev) =>
      applyMilestoneUpdate(prev, milestoneId, { status: 'in-review' })
    )
  }, [])

  const handleAccept = useCallback((milestoneId: string) => {
    setMilestones((prev) =>
      applyMilestoneUpdate(prev, milestoneId, { status: 'released' })
    )
  }, [])

  const handleReject = useCallback((milestoneId: string, comment: string) => {
    setMilestones((prev) =>
      prev.map((m) =>
        m.id === milestoneId
          ? {
              ...m,
              status: 'rejected' as MilestoneStatus,
              comments: [
                ...m.comments,
                {
                  id: crypto.randomUUID(),
                  author: 'client' as const,
                  text: comment,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : m
      )
    )
  }, [])

  const handleComment = useCallback((milestoneId: string, text: string) => {
    setMilestones((prev) =>
      prev.map((m) =>
        m.id === milestoneId
          ? {
              ...m,
              comments: [
                ...m.comments,
                {
                  id: crypto.randomUUID(),
                  author: (role ?? 'freelancer') as 'client' | 'freelancer',
                  text,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : m
      )
    )
  }, [role])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Milestones</h2>
        <span
          className={`flex items-center gap-1 text-xs ${wsConnected ? 'text-green-500' : 'text-muted-foreground'}`}
          title={wsConnected ? 'Real-time updates active' : 'Real-time updates unavailable'}
        >
          {wsConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {wsConnected ? 'Live' : 'Offline'}
        </span>
      </div>
      <MilestoneTracker
        milestones={milestones}
        role={role}
        onSubmit={handleSubmit}
        onAccept={handleAccept}
        onReject={handleReject}
        onComment={handleComment}
      />
    </div>
  )
}
