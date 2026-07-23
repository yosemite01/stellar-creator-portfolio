import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BountyApplicationForm } from '@/components/bounty-application-form';

describe('BountyApplicationForm Accessibility', () => {
  const mockProps = {
    bountyId: 'test-bounty-1',
    bountyTitle: 'Test Bounty',
    maxBudget: 1000,
    onSuccess: vi.fn(),
  };

  it('has proper form labels for all inputs', () => {
    render(<BountyApplicationForm {...mockProps} />);
    
    expect(screen.getByLabelText(/Proposed Budget/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Timeline/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your Proposal/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Portfolio Link/)).toBeInTheDocument();
  });

  it('has proper aria-required attributes for required fields', () => {
    render(<BountyApplicationForm {...mockProps} />);
    
    const budgetInput = screen.getByLabelText(/Proposed Budget/);
    const timelineInput = screen.getByLabelText(/Timeline/);
    const proposalInput = screen.getByLabelText(/Your Proposal/);
    
    expect(budgetInput).toHaveAttribute('aria-required', 'true');
    expect(timelineInput).toHaveAttribute('aria-required', 'true');
    expect(proposalInput).toHaveAttribute('aria-required', 'true');
  });

  it('has proper aria-invalid attributes when errors occur', () => {
    render(<BountyApplicationForm {...mockProps} />);
    
    const submitButton = screen.getByRole('button', { name: /Submit Application/ });
    fireEvent.click(submitButton);
    
    // After submission with invalid data, fields should have aria-invalid
    const proposalInput = screen.getByLabelText(/Your Proposal/);
    expect(proposalInput).toHaveAttribute('aria-invalid', 'true');
  });

  it('has proper error announcements with aria-live', () => {
    render(<BountyApplicationForm {...mockProps} />);
    
    const submitButton = screen.getByRole('button', { name: /Submit Application/ });
    fireEvent.click(submitButton);
    
    // Error messages should be announced
    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toBeInTheDocument();
  });

  it('has proper aria-describedby for error messages', () => {
    render(<BountyApplicationForm {...mockProps} />);
    
    const submitButton = screen.getByRole('button', { name: /Submit Application/ });
    fireEvent.click(submitButton);
    
    const proposalInput = screen.getByLabelText(/Your Proposal/);
    const errorId = proposalInput.getAttribute('aria-describedby');
    expect(errorId).toContain('error');
  });

  it('has proper aria-busy state during submission', () => {
    render(<BountyApplicationForm {...mockProps} />);
    
    const submitButton = screen.getByRole('button', { name: /Submit Application/ });
    expect(submitButton).not.toHaveAttribute('aria-busy', 'true');
  });

  it('has proper form label', () => {
    render(<BountyApplicationForm {...mockProps} />);
    
    const form = screen.getByRole('form');
    expect(form).toHaveAttribute('aria-label', 'Apply for bounty: Test Bounty');
  });
});
