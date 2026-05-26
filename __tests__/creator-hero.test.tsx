import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreatorProfilePage from '../app/creators/[id]/page';
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

describe('CreatorProfilePage hero image', () => {
  const creator = creators[0];

  it('renders hero cover eagerly for above-the-fold content', () => {
    render(<CreatorProfilePage params={{ id: creator.id }} />);

    const heroImage = screen.getByAltText(`${creator.name} cover image`);
    expect(heroImage).toBeInTheDocument();
    expect(heroImage.getAttribute('loading')).toBe('eager');
    expect(heroImage.getAttribute('sizes')).toContain('100vw');
  });
});
