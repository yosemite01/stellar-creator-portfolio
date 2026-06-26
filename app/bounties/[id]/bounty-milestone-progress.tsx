'use client'

import { Progress } from '@/components/ui/progress'

export interface MilestonePhase {
  index: number
  description: string
  amount: number
  released: boolean
}

interface BountyMilestoneProgressProps {
  milestones: MilestonePhase[]
  currency: string
  escrowStatus?: 'active' | 'complete' | 'released'
}

export function BountyMilestoneProgress({
  milestones,
  currency,
  escrowStatus = 'active',
}: BountyMilestoneProgressProps) {
  if (milestones.length === 0) return null

  const totalAmount = milestones.reduce((sum, m) => sum + m.amount, 0)
  const releasedAmount = milestones
    .filter((m) => m.released)
    .reduce((sum, m) => sum + m.amount, 0)
  const progressPercent = totalAmount > 0 ? (releasedAmount / totalAmount) * 100 : 0
  const allReleased = milestones.every((m) => m.released)

  return (
    <section className="mb-8 rounded-lg border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Milestone Progress</h2>
        <span className="text-sm text-muted-foreground">
          {escrowStatus === 'complete' || allReleased ? 'Complete' : 'In Progress'}
        </span>
      </div>

      <div className="mb-2 flex justify-between text-sm">
        <span>
          {releasedAmount.toLocaleString()} / {totalAmount.toLocaleString()} {currency} released
        </span>
        <span>{Math.round(progressPercent)}%</span>
      </div>
      <Progress value={progressPercent} className="mb-6 h-3" />

      <ol className="space-y-3">
        {milestones.map((milestone) => (
          <li
            key={milestone.index}
            className="flex items-center justify-between rounded-md border px-4 py-3"
          >
            <div>
              <p className="font-medium">{milestone.description}</p>
              <p className="text-sm text-muted-foreground">
                Phase {milestone.index + 1} · {milestone.amount.toLocaleString()} {currency}
              </p>
            </div>
            <span
              className={
                milestone.released
                  ? 'text-sm font-medium text-green-600'
                  : 'text-sm text-muted-foreground'
              }
            >
              {milestone.released ? 'Released' : 'Pending'}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
