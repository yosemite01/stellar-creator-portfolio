'use client'

import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BountyApplicationForm } from '@/components/forms/bounty-application-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { BountyApplicationRecord } from '@/lib/services/bounty-service'

export function BountyDetailClient({
  bountyId,
  bountyTitle,
  suggestedBudget,
  status,
}: {
  bountyId: string
  bountyTitle: string
  suggestedBudget: number
  status: string
}) {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [existing, setExisting] = useState<BountyApplicationRecord | null | undefined>(undefined)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    /* Fetch existing application when session is ready (async boundary). */
    if (authStatus !== 'authenticated' || !session?.user?.id) {
      queueMicrotask(() => setExisting(null))
      return
    }
    if (session.user.role === 'CLIENT') {
      queueMicrotask(() => setExisting(null))
      return
    }
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/bounty-applications?applicant=me')
      if (!res.ok || cancelled) return
      const data = await res.json()
      const mine = (data.applications as BountyApplicationRecord[]).find(
        (a) => a.bountyId === bountyId,
      )
      if (!cancelled) setExisting(mine ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [authStatus, session?.user?.id, session?.user?.role, bountyId])

  if (authStatus === 'loading') {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Apply</CardTitle>
          <CardDescription>Sign in as a creator to submit a proposal for this bounty.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/auth/login?callbackUrl=/bounties/${bountyId}`}>Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (session.user.role === 'CLIENT') {
    return (
      <Alert>
        <AlertTitle>Client account</AlertTitle>
        <AlertDescription>
          Switch to a creator account to apply, or review applications from your{' '}
          <Link href="/dashboard/bounties" className="underline font-medium">
            bounty dashboard
          </Link>
          .
        </AlertDescription>
      </Alert>
    )
  }

  if (status !== 'open') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Not accepting applications</AlertTitle>
        <AlertDescription>This bounty is {status}.</AlertDescription>
      </Alert>
    )
  }

  if (submitted) {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle>Application sent</CardTitle>
          <CardDescription>
            Your proposal for &ldquo;{bountyTitle}&rdquo; was submitted. Track status and messages from
            your dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link href="/dashboard/applications">View applications</Link>
          </Button>
          <Button variant="outline" onClick={() => router.refresh()}>
            Back to bounty
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (existing === undefined) {
    return <p className="text-muted-foreground text-sm">Checking existing applications…</p>
  }

  if (existing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You already applied</CardTitle>
          <CardDescription>
            Submitted {new Date(existing.createdAt).toLocaleString()} — status:{' '}
            <span className="capitalize font-medium text-foreground">{existing.status}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard/applications">Open application dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit your proposal</CardTitle>
        <CardDescription>
          Include timeline, budget, and how you will deliver the work. Minimum 50 characters.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BountyApplicationForm
          bountyId={bountyId}
          bountyTitle={bountyTitle}
          suggestedBudget={suggestedBudget}
          onSuccess={() => {
            setSubmitted(true)
          }}
        />
      </CardContent>
    </Card>
  )
}
