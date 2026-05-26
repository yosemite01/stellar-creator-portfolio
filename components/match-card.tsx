'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { ThumbsDown, ThumbsUp, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MatchCardModel {
  type: 'bounty' | 'creator'
  id: string
  title: string
  score: number
  reasons: string[]
  href: string
  subtitle?: string
  meta?: string
}

interface MatchCardProps {
  match: MatchCardModel
  strategy: string
  mode: 'FOR_CREATOR' | 'FOR_CLIENT'
  contextId?: string | null
  onFeedbackSent?: () => void
}

export function MatchCard({ match, strategy, mode, contextId, onFeedbackSent }: MatchCardProps) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'up' | 'down' | null>(null)

  const sendFeedback = async (helpful: boolean) => {
    if (done || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy,
          mode,
          contextId: contextId ?? null,
          matchId: match.id,
          score: match.score,
          helpful,
        }),
      })
      if (res.ok) {
        setDone(helpful ? 'up' : 'down')
        onFeedbackSent?.()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col h-full border-border/80 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground leading-snug line-clamp-2">{match.title}</h3>
            {match.subtitle ? (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{match.subtitle}</p>
            ) : null}
          </div>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {match.score}%
          </Badge>
        </div>
        {match.meta ? <p className="text-xs text-muted-foreground font-mono truncate">{match.meta}</p> : null}
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Why this match</p>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
          {match.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 pt-2 border-t border-border/60">
        <Button variant="outline" size="sm" className="w-full gap-2" asChild>
          <Link href={match.href}>
            Open
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
        <div className="flex gap-2 w-full">
          <Button
            type="button"
            variant={done === 'up' ? 'default' : 'secondary'}
            size="sm"
            className={cn('flex-1 gap-1', done && done !== 'up' && 'opacity-40')}
            disabled={busy || !!done}
            onClick={() => void sendFeedback(true)}
          >
            <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
            Helpful
          </Button>
          <Button
            type="button"
            variant={done === 'down' ? 'destructive' : 'secondary'}
            size="sm"
            className={cn('flex-1 gap-1', done && done !== 'down' && 'opacity-40')}
            disabled={busy || !!done}
            onClick={() => void sendFeedback(false)}
          >
            <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
            Not for me
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
