'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { MatchCard, type MatchCardModel } from '@/components/match-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Sparkles, Bell, BarChart3 } from 'lucide-react'

type ApiMatch = {
  type: 'bounty' | 'creator'
  id: string
  title: string
  score: number
  reasons: string[]
  href: string
  budget?: number
  category?: string | null
  tags?: string[]
  discipline?: string | null
  skills?: string[]
  rating?: number
  completedProjects?: number
}

type MatchResponse = {
  strategy: string
  mode: 'FOR_CREATOR' | 'FOR_CLIENT'
  matches: ApiMatch[]
  message?: string
  contextBounty?: { id: string; title: string; budget: number; category: string | null }
}

function toCard(m: ApiMatch): MatchCardModel {
  if (m.type === 'bounty') {
    return {
      type: 'bounty',
      id: m.id,
      title: m.title,
      score: m.score,
      reasons: m.reasons,
      href: m.href,
      subtitle: m.category ?? undefined,
      meta: m.budget != null ? `Budget ~$${m.budget.toLocaleString()} · ${(m.tags ?? []).slice(0, 4).join(', ')}` : undefined,
    }
  }
  return {
    type: 'creator',
    id: m.id,
    title: m.title,
    score: m.score,
    reasons: m.reasons,
    href: m.href,
    subtitle: m.discipline ?? undefined,
    meta:
      m.rating != null
        ? `★ ${m.rating.toFixed(1)} · ${m.completedProjects ?? 0} projects · ${(m.skills ?? []).slice(0, 4).join(', ')}`
        : undefined,
  }
}

export default function MatchesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [data, setData] = useState<MatchResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [insights, setInsights] = useState<{ strategy: string; samples: number; helpfulRate: number | null }[] | null>(
    null,
  )
  const [digestBusy, setDigestBusy] = useState(false)

  const load = useCallback(async () => {
    if (status !== 'authenticated') return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/matching')
      const json = (await res.json()) as MatchResponse & { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not load matches')
        setData(null)
        return
      }
      setData(json)
    } catch {
      setError('Network error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login')
    }
  }, [status, router])

  useEffect(() => {
    if (status === 'authenticated') void load()
  }, [status, load])

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'ADMIN') return
    void (async () => {
      const res = await fetch('/api/matching?metrics=1')
      if (!res.ok) return
      const j = await res.json()
      setInsights(j.insights ?? null)
    })()
  }, [status, session?.user.role])

  const saveDigest = async () => {
    if (!data?.matches.length) return
    setDigestBusy(true)
    try {
      const lines = data.matches.slice(0, 5).map((m, i) => `${i + 1}. ${m.title} (${m.score}%)`)
      await fetch('/api/matching/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: [`Strategy: ${data.strategy}`, ...lines],
          relatedBountyId: data.contextBounty?.id,
        }),
      })
    } finally {
      setDigestBusy(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-6xl mx-auto px-4 py-10 space-y-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  if (!session) return null

  const role = session.user.role
  const eligible = role === 'CREATOR' || role === 'CLIENT' || role === 'ADMIN'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1">
        <section className="border-b border-border bg-muted/30 py-10 sm:py-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="h-8 w-8 text-primary shrink-0" aria-hidden />
                  For you
                </h1>
                <p className="text-muted-foreground mt-2 max-w-2xl">
                  Personalized bounty and creator suggestions from skill overlap, brief alignment, reputation, and budget
                  fit. Feedback trains future ranking experiments.
                </p>
              </div>
              {data ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    A/B: {data.strategy}
                  </Badge>
                  {eligible ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      disabled={!data.matches.length || digestBusy}
                      onClick={() => void saveDigest()}
                    >
                      <Bell className="h-4 w-4" aria-hidden />
                      Save digest
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {!eligible ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Switch to a creator or client account</EmptyTitle>
                <EmptyDescription>
                  Matching runs from your creator profile (open bounties) or your client bounties (recommended talent).
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-64 rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{error}</EmptyTitle>
                <EmptyDescription>
                  <Button type="button" variant="outline" onClick={() => void load()}>
                    Retry
                  </Button>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : data && data.matches.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No matches yet</EmptyTitle>
                <EmptyDescription>
                  {data.message ?? 'Add skills to your profile or post an open bounty, then check back.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : data ? (
            <>
              {data.contextBounty ? (
                <p className="text-sm text-muted-foreground mb-6">
                  Suggestions for{' '}
                  <span className="font-medium text-foreground">{data.contextBounty.title}</span> (~$
                  {data.contextBounty.budget.toLocaleString()})
                </p>
              ) : null}

              {session.user.role === 'ADMIN' && insights?.length ? (
                <div className="mb-8 rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm font-medium mb-3">
                    <BarChart3 className="h-4 w-4" aria-hidden />
                    Match feedback by strategy
                  </div>
                  <ul className="grid sm:grid-cols-3 gap-2 text-sm">
                    {insights.map((row) => (
                      <li key={row.strategy} className="rounded-md bg-muted/50 px-3 py-2">
                        <span className="font-mono text-xs">{row.strategy}</span>
                        <div className="text-muted-foreground">
                          n={row.samples}
                          {row.helpfulRate != null ? ` · ${row.helpfulRate}% helpful` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.matches.map((m) => (
                  <MatchCard
                    key={`${m.type}-${m.id}`}
                    match={toCard(m)}
                    strategy={data.strategy}
                    mode={data.mode}
                    contextId={data.contextBounty?.id ?? null}
                  />
                ))}
              </div>

              <p className="text-xs text-muted-foreground mt-8 max-w-3xl">
                Scores use public profile and bounty text only. For production ML, swap the scorer in{' '}
                <code className="rounded bg-muted px-1">lib/matching-engine.ts</code> for embeddings + vector search;
                keep the same API contract for A/B and feedback.
              </p>
            </>
          ) : null}

          <div className="mt-10 flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
            {role === 'CREATOR' || role === 'ADMIN' ? (
              <Button variant="outline" asChild>
                <Link href="/bounties">Browse bounties</Link>
              </Button>
            ) : null}
            {role === 'CLIENT' || role === 'ADMIN' ? (
              <Button variant="outline" asChild>
                <Link href="/creators">Browse creators</Link>
              </Button>
            ) : null}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
