'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { applicationSubmitSchema } from '@/lib/validators'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2 } from 'lucide-react'

const schema = applicationSubmitSchema
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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      bounty_id: bountyId,
      proposed_budget: suggestedBudget,
      timeline: 14,
      proposal: '',
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null)
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
  })

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <input type="hidden" {...form.register('bounty_id')} />

      <div className="space-y-2">
        <Label htmlFor="proposed_budget">Proposed budget ({bountyTitle})</Label>
        <Input
          id="proposed_budget"
          type="number"
          min={1}
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
          max={3650}
          {...form.register('timeline', { valueAsNumber: true })}
        />
        {form.formState.errors.timeline && (
          <p className="text-sm text-destructive">{form.formState.errors.timeline.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="proposal">Proposal (min. 50 characters)</Label>
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

      <Button type="submit" disabled={form.formState.isSubmitting} className="w-full sm:w-auto">
        {form.formState.isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          'Submit application'
        )}
      </Button>
    </form>
  )
}
