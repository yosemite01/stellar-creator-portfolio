import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock next/link so it renders a plain <a>
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
// Mock layout components to keep tests focused
vi.mock('@/components/header', () => ({ Header: () => <header data-testid="header" /> }));
vi.mock('@/components/footer', () => ({ Footer: () => <footer data-testid="footer" /> }));
// Mock API client so tests don't make real network calls
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    submitEscrowTransaction: vi.fn().mockResolvedValue({
      escrowId: 'test-escrow-1',
      txHash: 'abc123testHash',
      operation: 'deposit',
      status: 'confirmed',
      timestamp: '2026-04-23T12:00:00Z',
    }),
  };
});

import BountiesPage from './page';
import { bounties } from '@/lib/creators-data';

describe('BountiesPage', () => {
  it('renders all bounties by default', () => {
    render(<BountiesPage />);
    expect(screen.getByText(`Showing ${bounties.length} bounties`)).toBeTruthy();
  });

  it('filters by difficulty', () => {
    render(<BountiesPage />);
    fireEvent.click(screen.getByRole('button', { name: /^intermediate$/i }));
    const intermediate = bounties.filter((b) => b.difficulty === 'intermediate');
    expect(screen.getByText(`Showing ${intermediate.length} bounties`)).toBeTruthy();
  });

  it('filters by category', () => {
    render(<BountiesPage />);
    fireEvent.click(screen.getByRole('button', { name: /^UX Research$/i }));
    const ux = bounties.filter((b) => b.category === 'UX Research');
    expect(screen.getByText(`Showing ${ux.length} bounties`)).toBeTruthy();
  });

  it('shows empty state when no bounties match', () => {
    render(<BountiesPage />);
    fireEvent.click(screen.getByRole('button', { name: /^expert$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Technical Writing$/i }));
    expect(screen.getByText(/no bounties match/i)).toBeTruthy();
  });

  it('reset filters button restores all bounties', () => {
    render(<BountiesPage />);
    fireEvent.click(screen.getByRole('button', { name: /^expert$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Technical Writing$/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    expect(screen.getByText(`Showing ${bounties.length} bounties`)).toBeTruthy();
  });
});

describe('ApplyModal', () => {
  function openModal() {
    render(<BountiesPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /apply now/i })[0]);
  }

  it('opens modal when Apply Now is clicked', () => {
    openModal();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText(/proposed budget/i)).toBeTruthy();
    expect(screen.getByLabelText(/proposal/i)).toBeTruthy();
  });

  it('closes modal when X is clicked', () => {
    openModal();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes modal when backdrop is clicked', () => {
    openModal();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows error when proposal is empty on submit', () => {
    openModal();
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/proposal is required/i);
  });

  it('shows error when budget is zero', () => {
    openModal();
    fireEvent.change(screen.getByLabelText(/proposed budget/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/proposal/i), { target: { value: 'My proposal' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/budget must be positive/i);
  });

  it('shows submitting state and then success', async () => {
    vi.useFakeTimers();
    openModal();
    fireEvent.change(screen.getByLabelText(/stellar wallet address/i), { target: { value: 'GPAYER123STELLARADDRESS' } });
    fireEvent.change(screen.getByLabelText(/proposed budget/i), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText(/delivery timeline/i), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText(/proposal/i), { target: { value: 'My detailed proposal' } });

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(screen.getByText(/submitting/i)).toBeTruthy();

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const successEl = await waitFor(() => screen.getByTestId('apply-success'));
    expect(successEl).toBeTruthy();
    expect(screen.getByText(/application submitted/i)).toBeTruthy();
    expect(successEl.textContent).toMatch(/escrow/i);
  });

  it('pre-fills budget from bounty', () => {
    openModal();
    const input = screen.getByLabelText(/proposed budget/i) as HTMLInputElement;
    expect(Number(input.value)).toBe(bounties[0].budget);
  });

  it('shows escrow info banner', () => {
    openModal();
    expect(screen.getByText(/escrow-protected payment/i)).toBeTruthy();
  });
});
