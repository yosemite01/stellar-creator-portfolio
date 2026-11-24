import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreatorHeroSection } from '@/components/streaming/creator-hero-section';
import { creators } from '@/lib/services/creators-data';

vi.mock('next/navigation', () => ({
  notFound: () => undefined,
  useRouter: () => ({ back: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' })
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...rest }: any) => <img src={typeof src === 'string' ? src : src.src} alt={alt} {...rest} />,
}));

describe('CreatorHeroSection hero image', () => {
  const creator = creators[0];

  it('renders hero cover eagerly for above-the-fold content', async () => {
    // The section is an async server component: resolve it, then render the tree.
    render(await CreatorHeroSection({ id: creator.id }));

    const heroImage = screen.getByAltText(`${creator.name} cover image`);
    expect(heroImage).toBeInTheDocument();
    expect(heroImage.getAttribute('loading')).toBe('eager');
    expect(heroImage.getAttribute('sizes')).toContain('100vw');
  });

  it('renders deterministically across repeated renders (no hydration mismatch sources)', async () => {
    // Hydration mismatches arise when server and client render different markup.
    // Rendering the same server component twice must produce identical HTML so
    // that dates, random values, or window access cannot leak into the output.
    const first = render(await CreatorHeroSection({ id: creator.id }));
    const firstHtml = first.container.innerHTML;
    first.unmount();

    const second = render(await CreatorHeroSection({ id: creator.id }));
    const secondHtml = second.container.innerHTML;

    expect(secondHtml).toBe(firstHtml);
  });
});
