import { describe, expect, it } from 'vitest';
import {
  buildOptimizationProps,
  buildSizes,
  defaultSizes,
  isLazyLoaded,
  preferredFormats,
} from '@/lib/utils/image-utils';

describe('image-utils', () => {
  it('buildSizes returns responsive string with fallbacks', () => {
    const sizes = buildSizes({ mobile: '90vw', tablet: '60vw', desktop: '40vw', largeDesktop: '30vw', fallback: '25vw' });
    expect(sizes.includes('90vw')).toBe(true);
    expect(sizes.includes('60vw')).toBe(true);
    expect(sizes.includes('40vw')).toBe(true);
    expect(sizes.includes('30vw')).toBe(true);
    expect(sizes.trim().endsWith('25vw')).toBe(true);
  });

  it('buildSizes falls back to defaultSizes when not provided', () => {
    expect(buildSizes()).toBe(defaultSizes);
  });

  it('preferredFormats returns avif and webp by default', () => {
    expect(preferredFormats()).toEqual(['image/avif', 'image/webp']);
    expect(preferredFormats(false)).toEqual(['image/webp']);
  });

  it('buildOptimizationProps sets eager for above-the-fold indexes', () => {
    const eagerProps = buildOptimizationProps({ index: 0 });
    expect(eagerProps.priority).toBe(true);
    expect(eagerProps.loading).toBe('eager');

    const lazyProps = buildOptimizationProps({ index: 3 });
    expect(lazyProps.priority).toBe(false);
    expect(isLazyLoaded(lazyProps.loading)).toBe(true);
  });

  it('isLazyLoaded treats undefined as lazy', () => {
    expect(isLazyLoaded()).toBe(true);
  });
});
