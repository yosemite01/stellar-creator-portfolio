/**
 * App-level email facade — templates, transactional send, and queued platform mail.
 */

export {
  renderEmail,
  sendEmail,
  deliverTemplatedEmail,
  deliverHtmlEmail,
  type EmailTemplate,
  type SendEmailOptions,
  type BountyNotificationVars,
  type WelcomeVars,
} from '@/lib/email/mailer'

export {
  submitQueuedEmail,
  processEmailQueue,
  getOrCreateUnsubscribeToken,
  canSendEmailCategory,
  type NotificationEmailCategory,
} from '@/lib/notifications'
