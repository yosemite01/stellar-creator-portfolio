/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Image optimization enabled (unoptimized removed).
    // Add remote hostnames your <Image> components load from, e.g.:
    // remotePatterns: [{ protocol: 'https', hostname: 'cdn.example.com' }],
    remotePatterns: [],
  },
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
