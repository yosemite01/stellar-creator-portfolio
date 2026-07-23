import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { bounties, formatBudget } from '@/lib/services/creators-data'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { BountyMetaRow } from './bounty-meta-client'
import { BountyScopeEditor } from './bounty-scope-editor'
import { MilestoneTrackerClient } from './milestone-tracker-client'
import { BountyMilestoneProgress } from './bounty-milestone-progress'
import { Badge } from '@/components/ui/badge'
import { BountyShareButton } from './bounty-share-client'
import { BountyRealtimeClient } from './bounty-realtime-client'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const bounty = bounties.find((b) => b.id === id)

  if (!bounty) {
    return { title: 'Bounty Not Found' }
  }

  const budgetStr = formatBudget(bounty.budget, bounty.currency)
  return {
    title: `${bounty.title} — ${budgetStr}`,
    description: `${bounty.description.substring(0, 160)} Budget: ${budgetStr}. Category: ${bounty.category}.`,
    openGraph: {
      title: `${bounty.title} — ${budgetStr} | Stellar Creator Portfolio`,
      description: bounty.description.substring(0, 200),

    },
    twitter: {
      card: 'summary_large_image',
      title: `${bounty.title} — ${budgetStr} | Stellar Creator Portfolio`,
      description: bounty.description.substring(0, 200),
    },
  }
}

interface Props {
  params: Promise<{ id: string }>
}

export async function generateStaticParams() {
  return bounties.map((b) => ({ id: b.id }))
}

export default async function BountyDetailPage({ params }: Props) {
  const { id } = await params
  const bounty = bounties.find((b) => b.id === id)
  if (!bounty) notFound()

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <BountyRealtimeClient bountyId={bounty.id} />
      <Header />
      <main className="flex-grow container max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge variant="secondary">{bounty.category}</Badge>
            <Badge variant="outline">{bounty.difficulty}</Badge>
            {bounty.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight mb-2">{bounty.title}</h1>
            <BountyShareButton
              title={bounty.title}
              budget={bounty.budget}
              currency={bounty.currency}
              bountyId={bounty.id}
            />
          </div>
          <p className="text-muted-foreground">{bounty.description}</p>
        </div>

        {/* Meta row: budget / deadline / status */}
        <BountyMetaRow
          currency={bounty.currency}
          budget={bounty.budget}
          deadlineMs={bounty.deadline.getTime()}
          status={bounty.status}
        />

        {bounty.milestones && bounty.milestones.length > 0 && (
          <BountyMilestoneProgress
            milestones={bounty.milestones}
            currency={bounty.currency}
            escrowStatus={bounty.escrowStatus}
          />
        )}

        {/* Required skills */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-2">Required Skills</h2>
          <div className="flex flex-wrap gap-2">
            {bounty.requiredSkills.map((skill) => (
              <Badge key={skill} variant="secondary">
                {skill}
              </Badge>
            ))}
          </div>
        </div>

        {/* Milestone tracker – visible when bounty is in-progress and has milestones */}
        {bounty.status === 'in-progress' && bounty.milestones && bounty.milestones.length > 0 && (
          <div className="mb-8 rounded-lg border p-6">
            <MilestoneTrackerClient
              bountyId={bounty.id}
              initialMilestones={bounty.milestones}
              // Demo: toggle role via ?role=client in the URL; in production wire to session
              role="freelancer"
            />
          </div>
        )}

        {/* Collaborative scope editor */}
        <BountyScopeEditor
          bountyId={bounty.id}
          initialDeliverables={bounty.deliverables}
        />
      </main>
      <Footer />
    </div>
  )
}
