/**
 * Next.js middleware for environment validation
 * Runs on application startup to validate critical configuration
 */

import { validateEnvironment, logEnvironmentConfig } from '@/lib/env-validation'

// Validate environment on startup
try {
  validateEnvironment()
  logEnvironmentConfig()
} catch (error) {
  console.error('Failed to start application due to environment validation errors')
  process.exit(1)
}

// Middleware function (required by Next.js even if empty)
export function middleware() {
  // Validation happens at module load time above
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
