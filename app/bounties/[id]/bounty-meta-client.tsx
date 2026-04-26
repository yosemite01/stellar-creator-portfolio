'use client'

import { useEffect, useState } from 'react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Calendar, DollarSign, Zap } from 'lucide-react'

export function BountyMetaRow({
  currency,
  budget,
  deadlineMs,
  status,
}: {
  currency: string
  budget: number
  deadlineMs: number
  status: string
}) {
  const [daysLeft, setDaysLeft] = useState<number | null>(null)

  useEffect(() => {
    const update = () => {
      setDaysLeft(
        Math.max(0, Math.ceil((deadlineMs - Date.now()) / (1000 * 60 * 60 * 24))),
      )
    }
    update()
    const t = setInterval(update, 60_000)
    return () => clearInterval(t)
  }, [deadlineMs])

  return (
    <div className="grid sm:grid-cols-3 gap-4 mb-8">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1">
            <DollarSign className="h-4 w-4" /> Budget
          </CardDescription>
          <CardTitle className="text-2xl">
            {currency} {budget.toLocaleString()}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1">
            <Calendar className="h-4 w-4" /> Deadline
          </CardDescription>
          <CardTitle className="text-2xl">{daysLeft === null ? '—' : `${daysLeft} days`}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-1">
            <Zap className="h-4 w-4" /> Status
          </CardDescription>
          <CardTitle className="text-2xl capitalize">{status}</CardTitle>
        </CardHeader>
      </Card>
    </div>
  )
}
