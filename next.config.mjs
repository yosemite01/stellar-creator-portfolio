import { execSync } from 'child_process'

function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return process.env.NEXT_PUBLIC_BUILD_ID ?? 'unknown'
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    // Negotiated per request by the optimizer; AVIF first, WebP as fallback.
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: '*.supabase.co' },
      // GitHub avatars shown by the profile portfolio widget.
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
  // Use the git SHA as the Next.js build ID so every deployment is traceable
  // and two builds from the same commit produce identical BUILD_ID files.
  generateBuildId: async () => getGitSha(),
  env: {
    NEXT_PUBLIC_GIT_SHA: getGitSha(),
    NEXT_PUBLIC_BUILD_TIMESTAMP: new Date().toISOString(),
  },
  // Allow the reproducible build script to disable source maps for prod.
  ...(process.env.NEXT_DISABLE_SOURCEMAPS === '1' && {
    productionBrowserSourceMaps: false,
  }),
  // Security headers - applied to all routes
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'X-XSS-Protection',
          value: '1; mode=block',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
      ],
    },
  ],
}

export default nextConfig
