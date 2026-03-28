import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreatorCard } from '@/components/cards/creator-card';
import { creators } from '@/lib/services/creators-data';

type RouterMock = { push: ReturnType<typeof vi.fn> };

vi.mock('next/navigation', () => {
  const router: RouterMock = { push: vi.fn() };
  return {
    useRouter: () => router,
  };
});

vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...rest }: any) => <img src={typeof src === 'string' ? src : src.src} alt={alt} {...rest} />,
}));

describe('CreatorCard', () => {
  const creator = creators[0];

  it('renders optimized image with responsive sizes and lazy loading', () => {
    render(<CreatorCard creator={creator} />);

    const image = screen.getByAltText(`${creator.name} cover image`) as HTMLImageElement;
    expect(image).toBeInTheDocument();
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('sizes')).toContain('100vw');
  });
});
