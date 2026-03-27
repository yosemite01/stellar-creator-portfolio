/**
 * Email template engine + mailer
 * Uses Handlebars for template rendering and Nodemailer for delivery.
 *
 * Templates live in lib/email/templates/*.hbs
 * The base layout (base.hbs) wraps every template via the {{{content}}} partial.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import Handlebars, { type TemplateDelegate } from 'handlebars';
import fs from 'fs';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailTemplate = 'verify-email' | 'reset-password' | 'welcome' | 'bounty-notification';

interface BaseTemplateVars {
  subject: string;
  appUrl: string;
  year: number;
}

export interface VerifyEmailVars {
  name: string;
  verificationUrl: string;
}

export interface ResetPasswordVars {
  name: string;
  resetUrl: string;
}

export interface WelcomeVars {
  name: string;
  dashboardUrl: string;
  isCreator?: boolean;
}

export interface BountyNotificationVars {
  name: string;
  headline: string;
  bodyText: string;
  actionUrl?: string;
  actionLabel?: string;
  footerNote?: string;
}

type TemplateVarsMap = {
  'verify-email': VerifyEmailVars;
  'reset-password': ResetPasswordVars;
  welcome: WelcomeVars;
  'bounty-notification': BountyNotificationVars;
};

export interface SendEmailOptions<T extends EmailTemplate> {
  to: string;
  subject: string;
  template: T;
  variables: TemplateVarsMap[T];
}

// ─── Template cache ───────────────────────────────────────────────────────────

const templateCache = new Map<string, TemplateDelegate>();
const TEMPLATES_DIR = path.join(process.cwd(), 'lib', 'email', 'templates');

function loadTemplate(name: string): TemplateDelegate {
  if (templateCache.has(name)) return templateCache.get(name)!;

  const filePath = path.join(TEMPLATES_DIR, `${name}.hbs`);
  const source = fs.readFileSync(filePath, 'utf-8');
  const compiled = Handlebars.compile(source);
  templateCache.set(name, compiled);
  return compiled;
}

function renderTemplate(template: EmailTemplate, variables: Record<string, unknown>): string {
  const baseTemplate = loadTemplate('base');
  const contentTemplate = loadTemplate(template);

  // Render the inner content first
  const content = contentTemplate(variables);

  // Inject into the base layout
  return baseTemplate({
    ...variables,
    content,
    appUrl: process.env.NEXTAUTH_URL ?? 'http://localhost:3000',
    year: new Date().getFullYear(),
  });
}

// ─── Transport ────────────────────────────────────────────────────────────────

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const emailServer = process.env.EMAIL_SERVER;

  if (emailServer) {
    // Supports smtp://user:pass@host:port or smtps://...
    _transporter = nodemailer.createTransport(emailServer);
  } else {
    // Fallback: Ethereal test account for local dev (auto-creates a free account)
    // Logs preview URL to console so you can inspect emails without a real SMTP server
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: process.env.EMAIL_DEV_USER ?? '',
        pass: process.env.EMAIL_DEV_PASS ?? '',
      },
    });
  }

  return _transporter;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a template to HTML without sending — useful for previews or testing.
 */
export function renderEmail<T extends EmailTemplate>(
  template: T,
  variables: TemplateVarsMap[T] & { subject: string }
): string {
  return renderTemplate(template, variables as unknown as Record<string, unknown>);
}

/**
 * Send a templated email.
 *
 * @example
 * await sendEmail({
 *   to: 'user@example.com',
 *   subject: 'Verify your email',
 *   template: 'verify-email',
 *   variables: { name: 'Alice', verificationUrl: 'https://...' },
 * });
 */
export async function sendEmail<T extends EmailTemplate>(
  options: SendEmailOptions<T>
): Promise<void> {
  const { to, subject, template, variables } = options;

  const html = renderTemplate(template, {
    ...(variables as unknown as Record<string, unknown>),
    subject,
  });

  const transporter = getTransporter();

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? '"Stellar Creators" <noreply@stellar-creators.com>',
    to,
    subject,
    html,
  });

  // In development, log the Ethereal preview URL if available
  if (process.env.NODE_ENV !== 'production') {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[mailer] Preview email at: ${previewUrl}`);
    } else {
      console.log(`[mailer] Email sent: ${info.messageId}`);
    }
  }
}
