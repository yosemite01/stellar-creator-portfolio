'use client'

import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getBountyById } from '@/lib/services/creators-data'
import type {
  BountyApplicationRecord,
  ApplicationThreadMessage,
  TimelineEntry,
} from '@/lib/services/bounty-service'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export default function DashboardBountyDetailPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const id = typeof params?.id === 'string' ? params.id : ''
  const bounty = id ? getBountyById(id) : undefined

  const [applications, setApplications] = useState<BountyApplicationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ApplicationThreadMessage[]>([])
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  const selected = applications.find((a) => a.id === selectedId) ?? null

  const loadApplications = useCallback(async () => {
    if (!id) return
    const res = await fetch(`/api/bounty-applications?bounty_id=${encodeURIComponent(id)}`)
    if (!res.ok) return
    const data = await res.json()
    const apps: BountyApplicationRecord[] = data.applications ?? []
    setApplications(apps)
    setSelectedId((prev) => prev ?? apps[0]?.id ?? null)
  }, [id])

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
    setSelectedId(null)
    setApplications([])
  }, [id])

  useEffect(() => {
    if (status !== 'authenticated' || !session || !id) return
    if (session.user.role !== 'CLIENT' && session.user.role !== 'ADMIN') {
      router.replace('/dashboard')
      return
    }
    void (async () => {
      setLoading(true)
      await loadApplications()
      setLoading(false)
    })()
  }, [status, session, id, router, loadApplications])

  useEffect(() => {
    if (selectedId) void loadThread(selectedId)
  }, [selectedId, loadThread])

  if (status === 'loading' || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!bounty) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-muted-foreground mb-4">Bounty not found.</p>
          <Button asChild variant="outline">
            <Link href="/dashboard/bounties">Back</Link>
          </Button>
        </div>
      </div>
    )
  }

  async function setStatus(applicationId: string, next: 'accepted' | 'rejected') {
    const res = await fetch(`/api/bounty-applications/${applicationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    if (res.ok) await loadApplications()
  }

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
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Button variant="ghost" asChild className="mb-6 -ml-2">
          <Link href="/dashboard/bounties">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All bounties
          </Link>
        </Button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">{bounty.title}</h1>
          <p className="text-muted-foreground text-sm">
            {bounty.currency} {bounty.budget.toLocaleString()} ·{' '}
            <span className="capitalize">{bounty.status}</span>
          </p>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading applications…</p>
        ) : applications.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No applications yet</CardTitle>
              <CardDescription>Creators will appear here when they submit proposals.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Applicants</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {applications.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selectedId === a.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <p className="font-medium text-sm truncate">{a.applicantName}</p>
                    <Badge variant="outline" className="mt-1 capitalize">
                      {a.status}
                    </Badge>
                  </button>
                ))}
              </CardContent>
            </Card>

            {selected && (
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
                    <div>
                      <CardTitle>{selected.applicantName}</CardTitle>
                      <CardDescription>{selected.applicantEmail}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {selected.status === 'pending' && (
                        <>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="default">
                                Accept
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Accept this proposal?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The applicant will be notified by email. You can still message them
                                  in this thread.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void setStatus(selected.id, 'accepted')}>
                                  Accept
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="outline">
                                Reject
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Reject this application?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The freelancer will be notified. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void setStatus(selected.id, 'rejected')}>
                                  Reject
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Proposed budget</p>
                        <p className="font-semibold">
                          {bounty.currency} {selected.proposedBudget.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Timeline</p>
                        <p className="font-semibold">{selected.timelineDays} days</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-sm mb-1">Proposal</p>
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
                    <CardDescription>Discuss scope and next steps with the applicant.</CardDescription>
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
                        placeholder="Write a message…"
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
