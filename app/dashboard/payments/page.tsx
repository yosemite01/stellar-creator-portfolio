'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { BountyEscrowPaymentForm } from '@/components/forms/payment-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getPremiumSubscriptionPriceId } from '@/lib/payments/payments-config'
import type { EscrowRecord } from '@/lib/payments/escrow-service'
import { ExternalLink, CreditCard, RefreshCw } from 'lucide-react'
import { Label } from '@/components/ui/label'

export default function DashboardPaymentsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [escrows, setEscrows] = useState<EscrowRecord[]>([])
  const [stripeConfigured, setStripeConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/payments', { credentials: 'include' })
      const data = (await res.json()) as {
        escrows?: EscrowRecord[]
        stripeConfigured?: boolean
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? 'Failed to load payments')
        return
      }
      setEscrows(data.escrows ?? [])
      setStripeConfigured(data.stripeConfigured ?? false)
    } catch {
      setError('Failed to load payments')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/login')
    }
  }, [status, router])

  useEffect(() => {
    if (status === 'authenticated') {
      void load()
    }
  }, [status, load])

  async function postPayment(body: object) {
    setError(null)
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      setError(data.error ?? 'Request failed')
      return
    }
    await load()
  }

  async function releaseEscrow(id: string) {
    setActionId(id)
    try {
      await postPayment({ type: 'escrow_release', escrowId: id })
    } finally {
      setActionId(null)
    }
  }

  async function refundEscrow(id: string) {
    setActionId(id)
    try {
      await postPayment({ type: 'escrow_refund', escrowId: id })
    } finally {
      setActionId(null)
    }
  }

  async function startSubscription() {
    const priceId = getPremiumSubscriptionPriceId()
    if (!priceId) {
      setError('Subscription price is not configured')
      return
    }
    setError(null)
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'subscription', priceId }),
    })
    const data = (await res.json().catch(() => ({}))) as { url?: string | null; error?: string }
    if (!res.ok || !data.url) {
      setError(data.error ?? 'Could not start checkout')
      return
    }
    window.location.href = data.url
  }

  if (status === 'loading' || (status === 'authenticated' && loading && escrows.length === 0 && !error)) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="mx-auto max-w-4xl px-4 py-8">
          <Skeleton className="mb-6 h-10 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  const role = session.user.role
  const isClient = role === 'CLIENT' || role === 'ADMIN'
  const premiumPriceId = getPremiumSubscriptionPriceId()

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Payments & escrow</h1>
            <p className="text-muted-foreground">
              Fund bounties, manage escrow, and view receipts. Card data is handled by the payment provider
              (PCI scope reduction).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {!stripeConfigured ? (
          <Card className="mb-8 border-amber-500/40 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-amber-700 dark:text-amber-400">Payments not configured</CardTitle>
              <CardDescription>
                Set <code className="rounded bg-muted px-1">STRIPE_SECRET_KEY</code> and{' '}
                <code className="rounded bg-muted px-1">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> for live
                processing. Escrow APIs remain available for development once keys are present.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {isClient ? (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Fund a bounty (escrow)
              </CardTitle>
              <CardDescription>
                Enter an amount to authorize funds. Money is captured when you release escrow after approving
                completed work.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Use a bounty id from{' '}
                <Link href="/bounties" className="underline">
                  bounties
                </Link>
                . Demo ids like <code className="rounded bg-muted px-1">bounty-1</code> work for testing.
              </p>
              <DashboardFundForm onFunded={() => void load()} />
            </CardContent>
          </Card>
        ) : null}

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Premium subscription</CardTitle>
            <CardDescription>
              Unlock premium marketplace features when a subscription price is configured.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            {premiumPriceId ? (
              <Button onClick={() => void startSubscription()}>Subscribe</Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_STRIPE_PRICE_PREMIUM_MONTHLY</code> to
                your Stripe Price id to enable checkout.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment history</CardTitle>
            <CardDescription>Escrow records and receipt links when available.</CardDescription>
          </CardHeader>
          <CardContent>
            {escrows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No escrow activity yet.</p>
            ) : (
              <ul className="space-y-4">
                {escrows.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
                        <Badge variant="secondary">{e.status}</Badge>
                      </div>
                      <p className="mt-1 text-sm">
                        Bounty <span className="font-medium">{e.bountyId}</span> ·{' '}
                        {(e.amountCents / 100).toFixed(2)} {e.currency.toUpperCase()} · Fee{' '}
                        {(e.platformFeeCents / 100).toFixed(2)}
                      </p>
                      {e.receiptUrl ? (
                        <a
                          href={e.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline"
                        >
                          Receipt <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                      {e.failureMessage ? (
                        <p className="mt-1 text-sm text-destructive">{e.failureMessage}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isClient && e.status === 'funded_authorized' ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void releaseEscrow(e.id)}
                            disabled={actionId === e.id}
                          >
                            Release & capture
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void refundEscrow(e.id)}
                            disabled={actionId === e.id}
                          >
                            Refund
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

function DashboardFundForm({ onFunded }: { onFunded: () => void }) {
  const [bountyId, setBountyId] = useState('bounty-1')
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="fund-bounty-id">Bounty ID</Label>
        <input
          id="fund-bounty-id"
          className="border-input bg-background mt-2 flex h-9 w-full max-w-md rounded-md border px-3 py-1 text-sm"
          value={bountyId}
          onChange={(e) => setBountyId(e.target.value)}
          placeholder="bounty id"
        />
      </div>
      <BountyEscrowPaymentForm bountyId={bountyId} defaultAmountDollars="50" onFunded={onFunded} />
    </div>
  )
}
