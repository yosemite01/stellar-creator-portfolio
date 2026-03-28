/**
 * Email template engine + mailer
 * Uses Handlebars for template rendering. Delivery: Resend (RESEND_API_KEY) or Nodemailer (EMAIL_SERVER / Ethereal).
 *
 * Templates live in lib/email/templates/*.hbs
 */

import nodemailer, { type Transporter } from 'nodemailer'
import Handlebars, { type TemplateDelegate } from 'handlebars'
import fs from 'fs'
import path from 'path'
import { serverConfig } from '@/lib/config'

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailTemplate =
  | 'verify-email'
  | 'reset-password'
  | 'welcome'
  | 'bounty-notification'
  | 'application-status'
  | 'bounty-update'

export interface VerifyEmailVars {
  name: string
  verificationUrl: string
}

export interface ResetPasswordVars {
  name: string
  resetUrl: string
}

export interface WelcomeVars {
  name: string
  dashboardUrl: string
  isCreator?: boolean
}

export interface BountyNotificationVars {
  name: string
  headline: string
  bodyText: string
  actionUrl?: string
  actionLabel?: string
  footerNote?: string
  unsubscribeUrl?: string
}

type TemplateVarsMap = {
  'verify-email': VerifyEmailVars
  'reset-password': ResetPasswordVars
  welcome: WelcomeVars
  'bounty-notification': BountyNotificationVars
  'application-status': BountyNotificationVars
  'bounty-update': BountyNotificationVars
}

export interface SendEmailOptions<T extends EmailTemplate> {
  to: string
  subject: string
  template: T
  variables: TemplateVarsMap[T]
  /** Shown in base layout footer when set */
  unsubscribeUrl?: string
}

// ─── Template cache ───────────────────────────────────────────────────────────

const templateCache = new Map<string, TemplateDelegate>()
const TEMPLATES_DIR = path.join(process.cwd(), 'lib', 'email', 'templates')

function contentFileForTemplate(template: EmailTemplate): string {
  if (template === 'application-status' || template === 'bounty-update') {
    return 'bounty-notification'
  }
  return template
}

function loadTemplate(fileBaseName: string): TemplateDelegate {
  if (templateCache.has(fileBaseName)) return templateCache.get(fileBaseName)!

  const filePath = path.join(TEMPLATES_DIR, `${fileBaseName}.hbs`)
  const source = fs.readFileSync(filePath, 'utf-8')
  const compiled = Handlebars.compile(source)
  templateCache.set(fileBaseName, compiled)
  return compiled
}

function renderTemplate(template: EmailTemplate, variables: Record<string, unknown>): string {
  const baseTemplate = loadTemplate('base')
  const innerName = contentFileForTemplate(template)
  const contentTemplate = loadTemplate(innerName)

  const content = contentTemplate(variables)

  return baseTemplate({
    ...variables,
    content,
    appUrl: serverConfig.auth.nextAuthUrl,
    year: new Date().getFullYear(),
  })
}

// ─── Transport ────────────────────────────────────────────────────────────────

let _transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (_transporter) return _transporter

  const { server: emailServer, devUser, devPass } = serverConfig.email

  if (emailServer) {
    _transporter = nodemailer.createTransport(emailServer)
  } else {
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: devUser ?? '',
        pass: devPass ?? '',
      },
    })
  }

  return _transporter
}

const DEFAULT_FROM = '"Stellar Creators" <noreply@stellar-creators.com>'

// ─── Delivery ─────────────────────────────────────────────────────────────────

export async function deliverHtmlEmail(params: {
  to: string
  subject: string
  html: string
}): Promise<{ provider: string; messageId?: string }> {
  const from = serverConfig.email.from ?? DEFAULT_FROM

  if (serverConfig.email.resendApiKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverConfig.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    })
    const data = (await res.json()) as { id?: string; message?: string }
    if (!res.ok) {
      throw new Error(data.message ?? `Resend error ${res.status}`)
    }
    if (serverConfig.app.nodeEnv !== 'production') {
      console.log(`[mailer] Resend id: ${data.id ?? 'unknown'}`)
    }
    return { provider: 'resend', messageId: data.id }
  }

  const transporter = getTransporter()
  const info = await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  })

  if (serverConfig.app.nodeEnv !== 'production') {
    const previewUrl = nodemailer.getTestMessageUrl(info)
    if (previewUrl) {
      console.log(`[mailer] Preview email at: ${previewUrl}`)
    } else {
      console.log(`[mailer] Email sent: ${info.messageId}`)
    }
  }

  return { provider: 'nodemailer', messageId: info.messageId }
}

export async function deliverTemplatedEmail(params: {
  to: string
  subject: string
  template: EmailTemplate
  variables: Record<string, unknown>
  unsubscribeUrl?: string
}): Promise<{ provider: string; messageId?: string }> {
  const vars: Record<string, unknown> = {
    ...params.variables,
    subject: params.subject,
  }
  if (params.unsubscribeUrl) {
    vars.unsubscribeUrl = params.unsubscribeUrl
  }
  const html = renderTemplate(params.template, vars)
  return deliverHtmlEmail({
    to: params.to,
    subject: params.subject,
    html,
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function renderEmail<T extends EmailTemplate>(
  template: T,
  variables: TemplateVarsMap[T] & { subject: string; unsubscribeUrl?: string },
): string {
  return renderTemplate(template, variables as unknown as Record<string, unknown>)
}

export async function sendEmail<T extends EmailTemplate>(
  options: SendEmailOptions<T>,
): Promise<{ provider: string; messageId?: string }> {
  const { to, subject, template, variables, unsubscribeUrl } = options

  const vars: Record<string, unknown> = {
    ...(variables as unknown as Record<string, unknown>),
    subject,
  }
  if (unsubscribeUrl) vars.unsubscribeUrl = unsubscribeUrl

  const html = renderTemplate(template, vars)
  return deliverHtmlEmail({ to, subject, html })
}
