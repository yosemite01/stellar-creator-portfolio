import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    releaseEscrow: vi.fn(),
  };
});

import { EscrowReleaseButton } from './escrow-release-button';
import { releaseEscrow } from '@/lib/api-client';
import { ApiClientError } from '@/lib/api-client';

const mockRelease = releaseEscrow as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EscrowReleaseButton', () => {
  it('renders the release button', () => {
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" />);
    expect(screen.getByTestId('release-button')).toBeTruthy();
    expect(screen.getByText('Release Funds')).toBeTruthy();
  });

  it('is disabled when disabled prop is true', () => {
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" disabled />);
    const btn = screen.getByTestId('release-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows submitting state while request is in flight', async () => {
    mockRelease.mockReturnValue(new Promise(() => {})); // never resolves
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => expect(screen.getByText(/releasing/i)).toBeTruthy());
    expect((screen.getByTestId('release-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows success state after successful release', async () => {
    mockRelease.mockResolvedValue({
      escrowId: '1',
      txHash: 'abc123txhash',
      operation: 'release',
      status: 'confirmed',
      timestamp: '2026-04-23T12:00:00Z',
    });
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => expect(screen.getByTestId('release-success')).toBeTruthy());
    expect(screen.getByText(/funds released successfully/i)).toBeTruthy();
  });

  it('shows explorer link after success', async () => {
    mockRelease.mockResolvedValue({
      escrowId: '1',
      txHash: 'abc123txhash',
      operation: 'release',
      status: 'confirmed',
      timestamp: '2026-04-23T12:00:00Z',
    });
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => screen.getByRole('link'));
    expect(screen.getByRole('link').getAttribute('href')).toContain('abc123txhash');
  });

  it('calls onReleased callback with txHash on success', async () => {
    const onReleased = vi.fn();
    mockRelease.mockResolvedValue({
      escrowId: '1',
      txHash: 'abc123txhash',
      operation: 'release',
      status: 'confirmed',
      timestamp: '2026-04-23T12:00:00Z',
    });
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" onReleased={onReleased} />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => expect(onReleased).toHaveBeenCalledWith('abc123txhash'));
  });

  it('shows API error message on failure', async () => {
    mockRelease.mockRejectedValue(
      new ApiClientError('UNAUTHORIZED', 'Unauthorized'),
    );
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/unauthorized/i);
  });

  it('shows generic error on unknown failure', async () => {
    mockRelease.mockRejectedValue(new Error('Network down'));
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="GPAYER123" />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/failed to release/i);
  });

  it('shows error when authorizerAddress is empty', async () => {
    render(<EscrowReleaseButton escrowId="1" authorizerAddress="" />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/wallet address required/i);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('calls releaseEscrow with correct escrowId and authorizerAddress', async () => {
    mockRelease.mockResolvedValue({
      escrowId: '42',
      txHash: 'xyz',
      operation: 'release',
      status: 'confirmed',
      timestamp: '2026-04-23T12:00:00Z',
    });
    render(<EscrowReleaseButton escrowId="42" authorizerAddress="GPAYER999" />);
    fireEvent.click(screen.getByTestId('release-button'));
    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith('42', 'GPAYER999'));
  });
});
