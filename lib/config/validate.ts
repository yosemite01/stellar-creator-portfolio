import { serverEnvSchema, clientEnvSchema } from './env'

export function validateConfig(): void {
  const serverResult = serverEnvSchema.safeParse(process.env)
  const clientResult = clientEnvSchema.safeParse(process.env)

  const errors: string[] = []

  if (!serverResult.success) {
    for (const issue of serverResult.error.issues) {
      errors.push(`  ${issue.path.join('.')}: ${issue.message}`)
    }
  }

  if (!clientResult.success) {
    for (const issue of clientResult.error.issues) {
      errors.push(`  ${issue.path.join('.')}: ${issue.message}`)
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[config] Invalid environment variables:\n${errors.join('\n')}\n\nSee .env.example for reference.`,
    )
  }

  // Log subsystem status — safe to access .data after the error check above
  const env = serverResult.data!
  const clientEnv = clientResult.data!
  const subsystems = [
    ['Stripe', !!env.STRIPE_SECRET_KEY],
    ['Redis', !!env.REDIS_URL],
    ['S3 Storage', !!env.S3_BUCKET],
    ['Email (SMTP)', !!env.EMAIL_SERVER],
    ['Plausible Analytics', !!clientEnv.NEXT_PUBLIC_PLAUSIBLE_DOMAIN && clientEnv.NEXT_PUBLIC_PLAUSIBLE_DOMAIN !== 'example.com'],
    ['Stellar', !!env.STELLAR_RPC_URL],
  ] as const

  for (const [name, configured] of subsystems) {
    console.info(`[config] ${name}: ${configured ? 'configured' : 'not configured'}`)
  }
}
