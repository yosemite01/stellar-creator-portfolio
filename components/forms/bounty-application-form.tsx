'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { bountyApplicationSchema } from '@/lib/validations/bounty-application'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, WifiOff, Clock } from 'lucide-react'
import { enqueueBountyApplication } from '@/lib/sw/offline-queue'

const schema = bountyApplicationSchema
type FormValues = z.infer<typeof schema>

export function BountyApplicationForm({
  bountyId,
  bountyTitle,
  suggestedBudget,
  onSuccess,
}: {
  bountyId: string
  bountyTitle: string
  suggestedBudget: number
  onSuccess?: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [queued, setQueued] = useState(false)

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      bounty_id: bountyId,
      proposed_budget: suggestedBudget,
      timeline: 14,
      proposal: '',
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
    setQueued(false)

    if (!isOnline) {
      await enqueueBountyApplication(values, bountyTitle)
      setQueued(true)
      return
    }

    try {
      const res = await fetch('/api/bounty-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(data.error || 'Failed to submit application')
        return
      }
      onSuccess?.()
    } catch {
      // Network failed mid-submit — queue it
      await enqueueBountyApplication(values, bountyTitle)
      setQueued(true)
    }
  })

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" {...form.register('bounty_id')} />

      {!isOnline && (
        <Alert>
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            You&apos;re offline. Your application will be saved and submitted automatically when you reconnect.
          </AlertDescription>
        </Alert>
      )}

      {queued && (
        <Alert>
          <Clock className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            Application queued — it will be submitted automatically once you&apos;re back online.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="proposed_budget">Proposed budget ({bountyTitle})</Label>
        <Input
          id="proposed_budget"
          type="number"
          min={1}
          max={1_000_000}
          step={1}
          {...form.register('proposed_budget', { valueAsNumber: true })}
        />
        {form.formState.errors.proposed_budget && (
          <p className="text-sm text-destructive">
            {form.formState.errors.proposed_budget.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="timeline">Timeline (days)</Label>
        <Input
          id="timeline"
          type="number"
          min={1}
          max={365}
          {...form.register('timeline', { valueAsNumber: true })}
        />
        {form.formState.errors.timeline && (
          <p className="text-sm text-destructive">{form.formState.errors.timeline.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="proposal">Proposal (min. 100 characters)</Label>
        <Textarea
          id="proposal"
          rows={10}
          placeholder="Describe your approach, relevant experience, and deliverables."
          className="min-h-[200px] resize-y font-mono text-sm"
          {...form.register('proposal')}
        />
        {form.formState.errors.proposal && (
          <p className="text-sm text-destructive">{form.formState.errors.proposal.message}</p>
        )}
      </div>

      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={!form.formState.isValid || form.formState.isSubmitting || queued} className="w-full sm:w-auto">
        {form.formState.isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            {isOnline ? 'Submitting…' : 'Saving offline…'}
          </>
        ) : queued ? (
          <>
            <Clock className="mr-2 h-4 w-4" aria-hidden="true" />
            Queued for submission
          </>
        ) : !isOnline ? (
          <>
            <WifiOff className="mr-2 h-4 w-4" aria-hidden="true" />
            Save for later
          </>
        ) : (
          'Submit application'
        )}
      </Button>
    </form>
  )
}
