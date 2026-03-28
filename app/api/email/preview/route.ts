import { NextRequest, NextResponse } from 'next/server'
import { renderEmail, type EmailTemplate } from '@/lib/email/mailer'
import { serverConfig } from '@/lib/config'

const PREVIEW_TEMPLATES: EmailTemplate[] = [
  'welcome',
  'bounty-notification',
  'application-status',
  'bounty-update',
  'verify-email',
  'reset-password',
]

/** Dev-only HTML preview of built-in templates (open in browser). */
export async function GET(request: NextRequest) {
  if (serverConfig.app.nodeEnv === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const template = request.nextUrl.searchParams.get('template') as EmailTemplate | null
  if (!template || !PREVIEW_TEMPLATES.includes(template)) {
    return NextResponse.json(
      { error: 'Invalid template', allowed: PREVIEW_TEMPLATES },
      { status: 400 },
    )
  }

  const appUrl = serverConfig.auth.nextAuthUrl
  const samples: Record<EmailTemplate, Record<string, unknown>> = {
    welcome: {
      subject: 'Welcome to Stellar Creators',
      name: 'Alex',
      dashboardUrl: `${appUrl}/dashboard`,
      isCreator: true,
      unsubscribeUrl: `${appUrl}/api/notifications/unsubscribe?token=demo`,
    },
    'bounty-notification': {
      subject: 'Bounty update',
      name: 'Alex',
      headline: 'New activity',
      bodyText: 'This is sample body text for preview.',
      actionUrl: `${appUrl}/bounties`,
      actionLabel: 'View bounties',
      footerNote: 'Preview only.',
      unsubscribeUrl: `${appUrl}/api/notifications/unsubscribe?token=demo`,
    },
    'application-status': {
      subject: 'Application update',
      name: 'Alex',
      headline: 'Your application was accepted',
      bodyText: 'Great news — the client accepted your proposal.',
      actionUrl: `${appUrl}/dashboard/applications`,
      actionLabel: 'Open dashboard',
      footerNote: 'Preview only.',
      unsubscribeUrl: `${appUrl}/api/notifications/unsubscribe?token=demo`,
    },
    'bounty-update': {
      subject: 'New application',
      name: 'Jordan',
      headline: 'Someone applied to your bounty',
      bodyText: 'A creator submitted a proposal for your open bounty.',
      actionUrl: `${appUrl}/dashboard/bounties`,
      actionLabel: 'Review',
      footerNote: 'Preview only.',
      unsubscribeUrl: `${appUrl}/api/notifications/unsubscribe?token=demo`,
    },
    'verify-email': {
      subject: 'Verify your email',
      name: 'Alex',
      verificationUrl: `${appUrl}/auth/verify?token=demo`,
    },
    'reset-password': {
      subject: 'Reset password',
      name: 'Alex',
      resetUrl: `${appUrl}/auth/reset?token=demo`,
    },
  }

  const html = renderEmail(template, samples[template] as never)
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
