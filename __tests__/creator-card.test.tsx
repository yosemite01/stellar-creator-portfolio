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

  it('has proper keyboard navigation and focus management', () => {
    render(<CreatorCard creator={creator} />);
    
    const card = screen.getByRole('button', { name: `View ${creator.name}'s portfolio` });
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('tabIndex', '0');
  });

  it('has proper aria labels for accessibility', () => {
    render(<CreatorCard creator={creator} />);
    
    const card = screen.getByRole('button', { name: `View ${creator.name}'s portfolio` });
    expect(card).toHaveAttribute('aria-label', `View ${creator.name}'s portfolio`);
  });

  it('has visible focus states for keyboard navigation', () => {
    render(<CreatorCard creator={creator} />);
    
    const card = screen.getByRole('button');
    expect(card).toHaveClass('focus-visible:ring-2');
  });

  it('checkbox has proper aria label', () => {
    render(<CreatorCard creator={creator} />);
    
    const checkbox = screen.getByRole('checkbox', { name: `Compare ${creator.name}` });
    expect(checkbox).toBeInTheDocument();
  });
});
