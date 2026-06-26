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
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
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
}

export default nextConfig
