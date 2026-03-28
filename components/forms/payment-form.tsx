'use client'

import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { StripeElementsOptions } from '@stripe/stripe-js'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  bountyId: string
  defaultAmountDollars?: string
  /** Used by Stripe when a payment method requires a redirect. */
  returnUrl?: string
  onFunded?: (escrowId: string) => void
}

function EscrowCheckoutForm({
  returnUrl,
  onSuccess,
}: {
  returnUrl: string
  onSuccess: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    })
    if (err) {
      setError(err.message ?? 'Payment failed')
      setBusy(false)
      return
    }
    onSuccess()
    setBusy(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={!stripe || busy}>
        {busy ? 'Processing…' : 'Pay and authorize escrow'}
      </Button>
    </form>
  )
}

export function BountyEscrowPaymentForm({
  bountyId,
  defaultAmountDollars = '',
  returnUrl,
  onFunded,
}: Props) {
  const [amount, setAmount] = useState(defaultAmountDollars)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [publishableKey, setPublishableKey] = useState<string | null>(null)
  const [escrowId, setEscrowId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'input' | 'pay' | 'done'>('input')
  const [message, setMessage] = useState<string | null>(null)

  const stripePromise = useMemo(() => {
    if (!publishableKey) return null
    return loadStripe(publishableKey)
  }, [publishableKey])

  const resolvedReturnUrl =
    returnUrl ?? (typeof window !== 'undefined' ? window.location.href : '')

  async function createIntent() {
    const dollars = parseFloat(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setMessage('Enter a valid amount')
      return
    }
    const amountCents = Math.round(dollars * 100)
    setMessage(null)
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        type: 'bounty_escrow',
        bountyId,
        amountCents,
        currency: 'usd',
      }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      clientSecret?: string
      publishableKey?: string | null
      escrowId?: string
    }
    if (!res.ok) {
      setMessage(data.error ?? 'Could not start payment')
      return
    }
    if (!data.clientSecret || !data.publishableKey) {
      setMessage('Payment provider returned an incomplete response')
      return
    }
    setClientSecret(data.clientSecret)
    setPublishableKey(data.publishableKey)
    setEscrowId(data.escrowId ?? null)
    setPhase('pay')
  }

  if (phase === 'done') {
    return (
      <p className="text-sm text-muted-foreground">
        Payment authorized. Funds are held in escrow until you release them after work is approved.
      </p>
    )
  }

  if (phase === 'pay' && clientSecret && stripePromise) {
    const options: StripeElementsOptions = {
      clientSecret,
      appearance: { theme: 'stripe' },
    }
    return (
      <Elements stripe={stripePromise} options={options}>
        <EscrowCheckoutForm
          returnUrl={resolvedReturnUrl}
          onSuccess={() => {
            setPhase('done')
            if (escrowId) onFunded?.(escrowId)
          }}
        />
      </Elements>
    )
  }

  return (
    <div className="max-w-md space-y-4">
      <div>
        <Label htmlFor="escrow-amount">Amount (USD)</Label>
        <Input
          id="escrow-amount"
          type="number"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <Button type="button" onClick={createIntent}>
        Continue to secure payment
      </Button>
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  )
}
