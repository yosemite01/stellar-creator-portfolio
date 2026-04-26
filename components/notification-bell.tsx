'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

type InAppNotification = {
  id: string
  title: string
  body: string
  read: boolean
  createdAt: string
  applicationId?: string
  bountyId?: string
}

const POLL_MS = 30_000

export function NotificationBell() {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InAppNotification[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (status !== 'authenticated') return
    setLoading(true)
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications ?? [])
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (status !== 'authenticated') return
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [status, load])

  async function markRead(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  async function markAllRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readAll: true }),
    })
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  if (status !== 'authenticated') return null

  const unread = items.filter((n) => !n.read).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('relative shrink-0', 'min-h-11 min-w-11 md:h-9 md:w-9 md:min-h-0 md:min-w-0')}
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,380px)] p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {items.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[min(60vh,320px)]">
          {loading && items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={cn(
                      'w-full px-3 py-3 text-left text-sm transition-colors hover:bg-muted/60',
                      !n.read && 'bg-muted/30',
                    )}
                    onClick={() => {
                      if (!n.read) void markRead(n.id)
                    }}
                  >
                    <div className="font-medium leading-snug">{n.title}</div>
                    <div className="mt-1 line-clamp-2 text-muted-foreground text-xs">{n.body}</div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t px-3 py-2">
          <Button variant="link" className="h-auto p-0 text-xs" asChild>
            <Link href="/dashboard/settings/notifications" onClick={() => setOpen(false)}>
              Email & notification settings
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
