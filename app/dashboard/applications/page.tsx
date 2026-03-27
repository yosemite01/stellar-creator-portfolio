'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { getBountyById } from '@/lib/creators-data'
import type {
  BountyApplicationRecord,
  ApplicationThreadMessage,
  TimelineEntry,
  BountyNotificationRecord,
} from '@/lib/bounty-service'
import { Loader2, Bell } from 'lucide-react'

export default function DashboardApplicationsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [applications, setApplications] = useState<BountyApplicationRecord[]>([])
  const [notifications, setNotifications] = useState<BountyNotificationRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ApplicationThreadMessage[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)

  const selected = applications.find((a) => a.id === selectedId) ?? null
  const selectedBounty = selected ? getBountyById(selected.bountyId) : undefined

  const loadAll = useCallback(async () => {
    const [aRes, nRes] = await Promise.all([
      fetch('/api/bounty-applications?applicant=me'),
      fetch('/api/bounty-notifications'),
    ])
    if (aRes.ok) {
      const data = await aRes.json()
      const apps = data.applications ?? []
      setApplications(apps)
      setSelectedId((prev) => prev ?? apps[0]?.id ?? null)
    }
    if (nRes.ok) {
      const data = await nRes.json()
      setNotifications(data.notifications ?? [])
    }
  }, [])

  const loadThread = useCallback(async (applicationId: string) => {
    const [mRes, tRes] = await Promise.all([
      fetch(`/api/bounty-applications/${applicationId}/messages`),
      fetch(`/api/bounty-applications/${applicationId}/timeline`),
    ])
    if (mRes.ok) {
      const m = await mRes.json()
      setMessages(m.messages ?? [])
    }
    if (tRes.ok) {
      const t = await tRes.json()
      setTimeline(t.timeline ?? [])
    }
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login')
  }, [status, router])

  useEffect(() => {
    if (status !== 'authenticated' || !session) return
    if (session.user.role !== 'CREATOR' && session.user.role !== 'ADMIN') {
      router.replace('/dashboard')
      return
    }
    void (async () => {
      setLoading(true)
      await loadAll()
      setLoading(false)
    })()
  }, [status, session, router, loadAll])

  useEffect(() => {
    if (selectedId) void loadThread(selectedId)
  }, [selectedId, loadThread])

  async function sendMessage() {
    if (!selectedId || !reply.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/bounty-applications/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      })
      if (res.ok) {
        setReply('')
        await loadThread(selectedId)
        await loadAll()
      }
    } finally {
      setSending(false)
    }
  }

  async function markRead(nid: string) {
    await fetch('/api/bounty-notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: nid }),
    })
    setNotifications((prev) => prev.map((n) => (n.id === nid ? { ...n, read: true } : n)))
  }

  if (status === 'loading' || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (session.user.role !== 'CREATOR' && session.user.role !== 'ADMIN') {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">My applications</h1>
            <p className="text-muted-foreground">
              Track proposal status, timeline, and messages with clients.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/bounties">Browse bounties</Link>
          </Button>
        </div>

        {notifications.filter((n) => !n.read).length > 0 && (
          <Card className="mb-6 border-primary/20">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Bell className="h-4 w-4" />
              <CardTitle className="text-base">Unread</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {notifications
                .filter((n) => !n.read)
                .map((n) => (
                  <div
                    key={n.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{n.title}</p>
                      <p className="text-muted-foreground">{n.body}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => void markRead(n.id)}>
                      Dismiss
                    </Button>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : applications.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No applications yet</CardTitle>
              <CardDescription>
                Submit a proposal from any open bounty to see it here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/bounties">Find bounties</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Applications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {applications.map((a) => {
                  const b = getBountyById(a.bountyId)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${
                        selectedId === a.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <p className="font-medium text-sm line-clamp-2">{b?.title ?? a.bountyId}</p>
                      <Badge variant="outline" className="mt-1 capitalize">
                        {a.status}
                      </Badge>
                    </button>
                  )
                })}
              </CardContent>
            </Card>

            {selected && selectedBounty && (
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{selectedBounty.title}</CardTitle>
                    <CardDescription>
                      Applied {new Date(selected.createdAt).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge className="capitalize">{selected.status}</Badge>
                      <span className="text-sm text-muted-foreground">
                        Offer: {selectedBounty.currency} {selected.proposedBudget.toLocaleString()} ·{' '}
                        {selected.timelineDays} days
                      </span>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-sm font-medium mb-1">Your proposal</p>
                      <p className="text-sm whitespace-pre-wrap border rounded-lg p-3 bg-muted/30">
                        {selected.proposal}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3 text-sm">
                      {timeline.map((t) => (
                        <li key={t.id} className="flex gap-3">
                          <span className="text-muted-foreground shrink-0 w-36">
                            {new Date(t.createdAt).toLocaleString()}
                          </span>
                          <span>
                            <span className="font-medium">{t.label}</span>
                            {t.detail ? (
                              <span className="text-muted-foreground"> — {t.detail}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Messages</CardTitle>
                    <CardDescription>Chat with the client about this application.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ScrollArea className="h-[220px] rounded-md border p-3">
                      <div className="space-y-3">
                        {messages.map((m) => (
                          <div key={m.id} className="text-sm">
                            <p className="font-medium">
                              {m.senderName}{' '}
                              <span className="text-muted-foreground font-normal">
                                {new Date(m.createdAt).toLocaleString()}
                              </span>
                            </p>
                            <p className="whitespace-pre-wrap mt-1">{m.body}</p>
                          </div>
                        ))}
                        {messages.length === 0 && (
                          <p className="text-muted-foreground text-sm">No messages yet.</p>
                        )}
                      </div>
                    </ScrollArea>
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Message the client…"
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        rows={3}
                      />
                      <Button
                        type="button"
                        className="self-end"
                        disabled={sending || !reply.trim()}
                        onClick={() => void sendMessage()}
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
