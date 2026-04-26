'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { bounties } from '@/lib/services/creators-data'
import { Briefcase, ArrowRight } from 'lucide-react'

export default function DashboardBountiesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/auth/login')
  }, [status, router])

  useEffect(() => {
    if (status !== 'authenticated') return
    if (session?.user.role !== 'CLIENT' && session?.user.role !== 'ADMIN') {
      router.replace('/dashboard')
      return
    }
    void (async () => {
      const res = await fetch('/api/bounty-applications?counts=1')
      if (res.ok) {
        const data = await res.json()
        setCounts(data.counts ?? {})
      }
      setLoaded(true)
    })()
  }, [status, session?.user.role, router])

  if (status === 'loading' || !session) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Skeleton className="h-10 w-64 mb-8" />
          <Skeleton className="h-32" />
        </div>
      </div>
    )
  }

  if (session.user.role !== 'CLIENT' && session.user.role !== 'ADMIN') {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Your bounties</h1>
          <p className="text-muted-foreground">
            Review proposals, timelines, and messages for each open role.
          </p>
        </div>

        {!loaded ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-4">
            {bounties.map((b) => (
              <Card key={b.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">{b.title}</CardTitle>
                    <CardDescription>{b.category}</CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {counts[b.id] ?? 0} application{(counts[b.id] ?? 0) === 1 ? '' : 's'}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3 justify-between items-center">
                  <p className="text-sm text-muted-foreground">
                    Budget {b.currency} {b.budget.toLocaleString()} ·{' '}
                    <span className="capitalize">{b.status}</span>
                  </p>
                  <Button asChild size="sm">
                    <Link href={`/dashboard/bounties/${b.id}`}>
                      Manage applications
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-8 border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-4 w-4" />
              Public listing
            </CardTitle>
            <CardDescription>Browse all open bounties on the marketplace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/bounties">View bounties</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
