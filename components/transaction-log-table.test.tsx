import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { TransactionLogTable, type TransactionLogEntry } from './transaction-log-table';

const base: TransactionLogEntry[] = [
  {
    escrowId: '1',
    txHash: 'abc123def456xyz789',
    operation: 'deposit',
    status: 'confirmed',
    timestamp: '2026-04-23T12:00:00Z',
    fee: 0.00001,
    feeToken: 'XLM',
  },
  {
    escrowId: '1',
    txHash: 'release789xyz000aaa',
    operation: 'release',
    status: 'pending',
    timestamp: '2026-04-23T13:00:00Z',
  },
  {
    escrowId: '2',
    txHash: 'refund000aaabbbccc',
    operation: 'refund',
    status: 'failed',
    timestamp: '2026-04-23T14:00:00Z',
    fee: 0.00001,
    feeToken: 'XLM',
  },
  {
    escrowId: '3',
    txHash: 'dispute111bbbcccddd',
    operation: 'dispute',
    status: 'pending',
    timestamp: '2026-04-23T15:00:00Z',
  },
];

describe('TransactionLogTable', () => {
  it('renders empty state when no transactions', () => {
    render(<TransactionLogTable transactions={[]} />);
    expect(screen.getByText(/no transactions yet/i)).toBeTruthy();
  });

  it('renders a row for each transaction', () => {
    render(<TransactionLogTable transactions={base} />);
    expect(screen.getAllByRole('row').length).toBe(base.length + 1); // +1 for header
  });

  it('renders operation labels correctly', () => {
    render(<TransactionLogTable transactions={base} />);
    expect(screen.getByText('Deposit')).toBeTruthy();
    expect(screen.getByText('Release')).toBeTruthy();
    expect(screen.getByText('Refund')).toBeTruthy();
    expect(screen.getByText('Dispute')).toBeTruthy();
  });

  it('renders truncated tx hash with explorer link', () => {
    render(<TransactionLogTable transactions={[base[0]]} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toContain(base[0].txHash);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders fee when provided', () => {
    render(<TransactionLogTable transactions={[base[0]]} />);
    expect(screen.getByText('0.00001 XLM')).toBeTruthy();
  });

  it('renders dash when fee is absent', () => {
    render(<TransactionLogTable transactions={[base[1]]} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders status text for each row', () => {
    render(<TransactionLogTable transactions={base} />);
    expect(screen.getAllByText('confirmed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('pending').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('uses custom explorerBase for links', () => {
    render(
      <TransactionLogTable
        transactions={[base[0]]}
        explorerBase="https://stellar.expert/explorer/mainnet/tx"
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toContain('mainnet');
  });

  it('renders escrow IDs', () => {
    render(<TransactionLogTable transactions={base} />);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});
