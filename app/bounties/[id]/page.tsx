import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getBountyById } from '@/lib/services/creators-data'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft } from 'lucide-react'
import { BountyDetailClient } from './bounty-detail-client'
import { BountyMetaRow } from './bounty-meta-client'

export function generateStaticParams() {
  return [
    { id: 'bounty-1' },
    { id: 'bounty-2' },
    { id: 'bounty-3' },
    { id: 'bounty-4' },
  ]
}

export default async function BountyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const bounty = getBountyById(id)
  if (!bounty) {
    notFound()
  }

  const difficultyClass: Record<string, string> = {
    beginner: 'badge-beginner',
    intermediate: 'badge-intermediate',
    advanced: 'badge-advanced',
    expert: 'badge-expert',
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Button variant="ghost" asChild className="mb-6 -ml-2">
            <Link href="/bounties">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All bounties
            </Link>
          </Button>

          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{bounty.category}</p>
              <h1 className="text-3xl font-bold text-balance">{bounty.title}</h1>
            </div>
            <Badge className={`capitalize ${difficultyClass[bounty.difficulty] ?? ''}`}>
              {bounty.difficulty}
            </Badge>
          </div>

          <BountyMetaRow
            currency={bounty.currency}
            budget={bounty.budget}
            deadlineMs={bounty.deadline.getTime()}
            status={bounty.status}
          />

          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {bounty.description}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <Card>
              <CardHeader>
                <CardTitle>Required skills</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {bounty.requiredSkills.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Deliverables</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground whitespace-pre-wrap">
                {bounty.deliverables}
              </CardContent>
            </Card>
          </div>

          <div className="mb-8">
            <h3 className="text-sm font-medium text-foreground mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {bounty.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          <Separator className="my-8" />

          <BountyDetailClient
            bountyId={bounty.id}
            bountyTitle={bounty.title}
            suggestedBudget={bounty.budget}
            status={bounty.status}
          />
        </div>
      </main>

      <Footer />
    </div>
  )
}
