/**
 * Image Optimization Utilities
 * Provides helper functions and constants for optimized image loading
 */

export const IMAGE_SIZES = {
  thumbnail: 150,
  small: 300,
  medium: 600,
  large: 1200,
  full: 1920,
} as const;

export const IMAGE_RESPONSIVE_SIZES = {
  // Creator avatar in cards
  creatorAvatar: {
    sizes: '(max-width: 640px) 80px, (max-width: 1024px) 100px, 120px',
    width: 120,
    height: 120,
  },
  // Creator cover image
  creatorCover: {
    sizes: '(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 100vw',
    width: 1200,
    height: 400,
  },
  // Project thumbnail
  projectThumbnail: {
    sizes: '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw',
    width: 400,
    height: 300,
  },
  // Full project image
  projectFull: {
    sizes: '(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 100vw',
    width: 1200,
    height: 600,
  },
  // Logo/small icon
  logo: {
    sizes: '(max-width: 640px) 40px, 60px',
    width: 60,
    height: 60,
  },
} as const;

/**
 * Get optimized image config for Next.js Image component
 */
export function getImageConfig(type: keyof typeof IMAGE_RESPONSIVE_SIZES) {
  return IMAGE_RESPONSIVE_SIZES[type];
}

/**
 * Generate srcset for responsive images (if not using Next.js Image)
 */
export function generateSrcSet(imagePath: string, maxWidth: number = 1200): string {
  const sizes = [320, 640, 960, 1280, maxWidth].filter(s => s <= maxWidth);
  return sizes
    .map(size => `${imagePath}?w=${size} ${size}w`)
    .join(', ');
}

/**
 * Optimize image URL with Vercel Image Optimization (if using Vercel)
 */
export function optimizeImageUrl(
  imageUrl: string,
  {
    width,
    height,
    quality = 80,
    format = 'auto',
  }: {
    width?: number;
    height?: number;
    quality?: number;
    format?: 'webp' | 'avif' | 'auto';
  } = {}
): string {
  if (!imageUrl) return '';

  // If already a Vercel-optimized image, return as-is
  if (imageUrl.includes('/_next/image')) {
    return imageUrl;
  }

  // For external URLs, you could use Vercel's Image Optimization service
  // This is a placeholder for your image optimization service
  const params = new URLSearchParams();
  if (width) params.append('w', width.toString());
  if (height) params.append('h', height.toString());
  params.append('q', quality.toString());
  params.append('fm', format);

  // Return original URL if no optimization service is configured
  // In production, this would call your optimization service
  return imageUrl;
}

/**
 * Get blur placeholder (LQIP - Low Quality Image Placeholder)
 * In production, generate this at build time using plaiceholder or similar
 */
export function getBlurDataUrl(imagePath: string): string {
  // Placeholder - implement with actual LQIP generation
  return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect fill="%23f0f0f0" width="400" height="300"/%3E%3C/svg%3E';
}

/**
 * Validate if URL is an external image
 */
export function isExternalImage(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return !urlObj.hostname.includes('localhost') && !urlObj.hostname.includes(process.env.NEXT_PUBLIC_VERCEL_URL || '');
  } catch {
    return false;
  }
}

/**
 * Get image aspect ratio class for Tailwind
 */
export function getAspectRatioClass(width: number, height: number): string {
  const ratio = width / height;

  if (ratio === 1) return 'aspect-square';
  if (Math.abs(ratio - 16 / 9) < 0.1) return 'aspect-video';
  if (Math.abs(ratio - 4 / 3) < 0.1) return 'aspect-[4/3]';
  if (ratio > 1) return 'aspect-landscape';
  return 'aspect-portrait';
}

/**
 * Image optimization config for next.config.js
 */
export const NEXT_IMAGE_CONFIG = {
  // Enable automatic image optimization
  images: {
    // Remote patterns for external images
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    // Image formats to serve
    formats: ['image/avif', 'image/webp'],
    // Cache optimization images for 1 year
    minimumCacheTTL: 31536000,
    // Quality settings
    quality: 80,
    // Disable static imports if not used
    disableStaticImages: false,
  },
} as const;
