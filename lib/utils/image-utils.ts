import type { ImageProps } from 'next/image';

export const defaultSizes = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw';

export interface ResponsiveSizeConfig {
  mobile?: string;
  tablet?: string;
  desktop?: string;
  largeDesktop?: string;
  fallback?: string;
}

export interface OptimizationOptions {
  index?: number;
  aboveFoldCount?: number;
  priority?: boolean;
  sizes?: string;
  preferAvif?: boolean;
}

const clampSizes = (value?: string, fallback?: string) => value?.trim() || fallback || '100vw';

export function buildSizes(config?: ResponsiveSizeConfig): ImageProps['sizes'] {
  if (!config) return defaultSizes;

  const mobile = clampSizes(config.mobile, '100vw');
  const tablet = clampSizes(config.tablet, mobile);
  const desktop = clampSizes(config.desktop, tablet);
  const largeDesktop = clampSizes(config.largeDesktop, desktop);
  const fallback = clampSizes(config.fallback, largeDesktop);

  return `
    (max-width: 640px) ${mobile},
    (max-width: 1024px) ${tablet},
    (max-width: 1440px) ${desktop},
    (min-width: 1441px) ${largeDesktop},
    ${fallback}
  `.replace(/\s+/g, ' ').trim();
}

export function preferredFormats(preferAvif = true): NonNullable<ImageProps['formats']> {
  return preferAvif ? ['image/avif', 'image/webp'] : ['image/webp'];
}

export function buildOptimizationProps({
  index,
  aboveFoldCount = 2,
  priority,
  sizes,
  preferAvif = true,
}: OptimizationOptions = {}) {
  const resolvedPriority = priority ?? (typeof index === 'number' ? index < aboveFoldCount : false);

  return {
    priority: resolvedPriority,
    loading: resolvedPriority ? 'eager' : 'lazy' as ImageProps['loading'],
    sizes: sizes || defaultSizes,
    formats: preferredFormats(preferAvif),
  } as const;
}

export function isLazyLoaded(loading?: ImageProps['loading']): boolean {
  return loading !== 'eager';
}
