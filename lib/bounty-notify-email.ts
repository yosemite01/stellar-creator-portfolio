import { sendEmail } from '@/lib/email/mailer'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function getEmailForUserId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  })
  return u?.email ?? null
}

export async function sendApplicantReceivedEmail(params: {
  to: string
  name: string
  bountyTitle: string
}): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  await sendEmail({
    to: params.to,
    subject: `Application received — ${params.bountyTitle}`,
    template: 'bounty-notification',
    variables: {
      name: params.name,
      headline: 'Your proposal was submitted',
      bodyText: `We received your application for "${params.bountyTitle}". The client will review it and you will be notified when the status changes.`,
      actionUrl: `${appUrl}/dashboard/applications`,
      actionLabel: 'View my applications',
      footerNote: 'You can message the client from the application thread once they respond.',
    },
  })
}

export async function sendClientNewApplicationEmail(params: {
  to: string
  name: string
  bountyTitle: string
  applicantName: string
  bountyId: string
}): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  await sendEmail({
    to: params.to,
    subject: `New application for "${params.bountyTitle}"`,
    template: 'bounty-notification',
    variables: {
      name: params.name,
      headline: 'Someone applied to your bounty',
      bodyText: `${params.applicantName} submitted a proposal for "${params.bountyTitle}". Review applications in your dashboard.`,
      actionUrl: `${appUrl}/dashboard/bounties/${params.bountyId}`,
      actionLabel: 'Review applications',
      footerNote: 'Sign in to Stellar Creators to accept or reject proposals.',
    },
  })
}

export async function sendApplicantStatusEmail(params: {
  to: string
  name: string
  bountyTitle: string
  status: 'accepted' | 'rejected'
}): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const accepted = params.status === 'accepted'
  await sendEmail({
    to: params.to,
    subject: accepted
      ? `Accepted — ${params.bountyTitle}`
      : `Update on your application — ${params.bountyTitle}`,
    template: 'bounty-notification',
    variables: {
      name: params.name,
      headline: accepted ? 'Your application was accepted' : 'Your application was not selected',
      bodyText: accepted
        ? `Great news — the client accepted your proposal for "${params.bountyTitle}".`
        : `The client reviewed applications for "${params.bountyTitle}" and chose another freelancer this time.`,
      actionUrl: `${appUrl}/dashboard/applications`,
      actionLabel: 'View applications',
      footerNote: 'You can continue the conversation in your dashboard if messaging is enabled.',
    },
  })
}
