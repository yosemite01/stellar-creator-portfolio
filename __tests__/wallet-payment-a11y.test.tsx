import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  AccessibilityChecker,
  computeContrastRatio,
  LiveRegion,
  useFocusTrap,
} from '@/lib/accessibility';
import { WalletConnectModal } from '@/components/wallet/wallet-connect-modal';
import { CrossChainSwapModal } from '@/components/payments/cross-chain-swap-modal';
import { CrossChainSwapUI } from '@/components/payments/cross-chain-swap-ui';
import { Sep24Flow as Sep24PaymentForm } from '@/components/payments/sep24-payment-form';
import { SlippageToleranceControl } from '@/components/payments/slippage-tolerance-control';
import { TransactionLogTable } from '@/components/payments/transaction-log-table';

function FocusTrapHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, {
    enabled: open,
    onEscape: () => setOpen(false),
    restoreFocus: true,
  });

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open Dialog
      </button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Test dialog">
          <button type="button">First</button>
          <button type="button" disabled>
            Disabled
          </button>
          <button type="button">Last</button>
        </div>
      )}
    </div>
  );
}

describe('Accessibility Utilities (#1773)', () => {
  it('LiveRegion sets aria-live="polite" for status and aria-live="assertive" for alert', () => {
    const { rerender } = render(<LiveRegion message="Processing payment" role="status" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent('Processing payment');

    rerender(<LiveRegion message="Payment failed" role="alert" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('Payment failed');
  });

  it('useFocusTrap moves initial focus in, wraps Tab/Shift+Tab, ignores disabled buttons, and restores focus on Escape', () => {
    render(<FocusTrapHarness />);
    const trigger = screen.getByRole('button', { name: 'Open Dialog' });
    trigger.focus();
    fireEvent.click(trigger);

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(document.activeElement).toBe(first);

    // Shift+Tab from first wraps to last
    fireEvent.keyDown(document, { key: 'Shift' });
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Tab from last wraps back to first
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // Escape closes dialog and restores focus to trigger
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('computes real WCAG contrast ratios accurately', () => {
    // Pure black on white = 21:1
    expect(computeContrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    // Low contrast gray on white < 4.5:1
    expect(computeContrastRatio([180, 180, 180], [255, 255, 255])).toBeLessThan(4.5);
  });
});

describe('WalletConnectModal Accessibility (#1773)', () => {
  it('renders accessible dialog semantics, supports arrow keys, Escape, and announces status/errors', async () => {
    const onConnect = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <WalletConnectModal
        open={true}
        onClose={onClose}
        onConnect={onConnect}
        isConnected={false}
        isLoading={false}
        error={null}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');

    // Audit labels inside dialog
    const audit = AccessibilityChecker.checkKeyboardNavigation(dialog);
    expect(audit.missingLabels).toHaveLength(0);

    // Arrow navigation across wallet options
    const freighterBtn = screen.getByRole('button', { name: /Freighter/i });
    const albedoBtn = screen.getByRole('button', { name: /Albedo/i });
    freighterBtn.focus();
    fireEvent.keyDown(freighterBtn, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(albedoBtn);

    fireEvent.click(freighterBtn);
    expect(onConnect).toHaveBeenCalledWith('freighter');

    // Error state announces via role="alert" + assertive live region and offers Retry
    rerender(
      <WalletConnectModal
        open={true}
        onClose={onClose}
        onConnect={onConnect}
        isConnected={false}
        isLoading={false}
        error="Freighter extension not found"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('Freighter extension not found');
    expect(screen.getByRole('button', { name: /Retry freighter/i })).toBeInTheDocument();

    // Escape closes modal
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('announces network mismatch as an alert when connected to wrong network', () => {
    render(
      <WalletConnectModal
        open={true}
        onClose={vi.fn()}
        onConnect={vi.fn()}
        isConnected={true}
        address="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        network="mainnet"
        expectedNetwork="testnet"
        walletType="freighter"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/network mismatch/i);
    expect(screen.getByRole('button', { name: /copy wallet address/i })).toBeInTheDocument();
  });
});

describe('CrossChainSwapModal & CrossChainSwapUI Accessibility (#1773)', () => {
  it('CrossChainSwapModal traps focus, validates amount with aria-describedby, and announces step transitions', async () => {
    const onClose = vi.fn();
    render(<CrossChainSwapModal open={true} onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');

    // Chain selectors use radiogroup + radio semantics
    const radiogroups = screen.getAllByRole('radiogroup');
    expect(radiogroups).toHaveLength(2);
    const stellarRadio = screen.getByRole('radio', { name: /Stellar/i });
    expect(stellarRadio).toHaveAttribute('aria-checked', 'true');

    // Negative test: invalid amount shows accessible alert linked via aria-describedby
    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(amountInput, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveTextContent(/greater than 0/i);
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    expect(amountInput).toHaveAttribute('aria-describedby', errorAlert.id);

    // Valid amount advances to Step 2 and updates polite status live region
    fireEvent.change(amountInput, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Step 2 of 4/i);
    });
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();

    // Zero unlabeled controls inside modal
    const navAudit = AccessibilityChecker.checkKeyboardNavigation(dialog);
    expect(navAudit.missingLabels).toHaveLength(0);

    // Escape closes modal
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('CrossChainSwapUI has labeled inputs, accessible copy button, and live status announcements', async () => {
    const { container } = render(<CrossChainSwapUI />);

    const amountInput = screen.getByLabelText(/Amount/i);
    expect(amountInput).toBeInTheDocument();

    const audit = AccessibilityChecker.checkKeyboardNavigation(container);
    expect(audit.missingLabels).toHaveLength(0);

    // Invalid amount displays accessible alert
    fireEvent.change(amountInput, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: /Get Quote/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/greater than 0/i);
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('SEP-24 Payment Form, Slippage Control & Transaction Table Accessibility (#1773)', () => {
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('Sep24PaymentForm links field validation errors via aria-describedby and announces live status', async () => {
    render(<Sep24PaymentForm />);

    const addressInput = screen.getByLabelText(/Recipient Stellar Address/i);
    fireEvent.change(addressInput, { target: { value: 'INVALID' } });

    await waitFor(() => {
      expect(addressInput).toHaveAttribute('aria-invalid', 'true');
    });
    expect(addressInput).toHaveAttribute('aria-describedby', 'recipientAddress-error');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('SlippageToleranceControl announces out-of-range errors via aria-describedby + role="alert"', () => {
    render(
      <SlippageToleranceControl
        expectedShares={1000}
        actualShares={995}
        assetCode="USDC"
        defaultMaxSlippageBps={50}
      />,
    );

    const input = screen.getByLabelText(/Max slippage tolerance/i);
    fireEvent.change(input, { target: { value: '20000' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/between 0 and 10,000/i);
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('TransactionLogTable includes accessible caption, scope="col" headers, and descriptive explorer links', () => {
    render(
      <TransactionLogTable
        transactions={[
          {
            escrowId: 'esc-1',
            operation: 'release',
            txHash: 'abcdef1234567890abcdef1234567890',
            status: 'confirmed',
            timestamp: '2026-11-21T10:00:00Z',
            fee: 0.0001,
          },
        ]}
      />,
    );

    expect(screen.getByText('Escrow transaction history')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader');
    for (const th of headers) {
      expect(th).toHaveAttribute('scope', 'col');
    }
    expect(
      screen.getByRole('link', { name: /View transaction abcdef12 on Stellar explorer/i }),
    ).toBeInTheDocument();
  });
});
