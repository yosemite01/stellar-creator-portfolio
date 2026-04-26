import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewForm } from '../components/review-form';
import * as apiClient from '../lib/api-client';

const defaultProps = {
  bountyId: 'b-1',
  creatorId: 'c-1',
  creatorName: 'Alex Chen',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ReviewForm rendering', () => {
  it('renders the form with creator name', () => {
    render(<ReviewForm {...defaultProps} />);
    expect(screen.getByText(/Alex Chen/)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: /submit a review/i })).toBeInTheDocument();
  });

  it('renders all required fields', () => {
    render(<ReviewForm {...defaultProps} />);
    expect(screen.getByRole('radiogroup', { name: /star rating/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/feedback/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
  });

  it('renders 5 star buttons', () => {
    render(<ReviewForm {...defaultProps} />);
    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
  });

  it('renders submit button', () => {
    render(<ReviewForm {...defaultProps} />);
    expect(screen.getByRole('button', { name: /submit review/i })).toBeInTheDocument();
  });
});

describe('ReviewForm star picker', () => {
  it('marks clicked star as checked', async () => {
    render(<ReviewForm {...defaultProps} />);
    const star3 = screen.getByRole('radio', { name: /3 stars/i });
    await userEvent.click(star3);
    expect(star3).toHaveAttribute('aria-checked', 'true');
  });

  it('only one star is checked at a time', async () => {
    render(<ReviewForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('radio', { name: /2 stars/i }));
    await userEvent.click(screen.getByRole('radio', { name: /4 stars/i }));
    expect(screen.getByRole('radio', { name: /4 stars/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /2 stars/i })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('ReviewForm validation', () => {
  it('shows rating error when submitting without a star', async () => {
    render(<ReviewForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    expect(await screen.findByText(/rating must be between/i)).toBeInTheDocument();
  });

  it('shows title error when title is empty', async () => {
    render(<ReviewForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('radio', { name: /5 stars/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
  });

  it('shows feedback error when body is empty', async () => {
    render(<ReviewForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('radio', { name: /5 stars/i }));
    await userEvent.type(screen.getByLabelText(/title/i), 'Great');
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    expect(await screen.findByText(/feedback is required/i)).toBeInTheDocument();
  });

  it('shows reviewer name error when name is empty', async () => {
    render(<ReviewForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('radio', { name: /5 stars/i }));
    await userEvent.type(screen.getByLabelText(/title/i), 'Great');
    await userEvent.type(screen.getByLabelText(/feedback/i), 'Excellent work overall.');
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    expect(await screen.findByText(/your name is required/i)).toBeInTheDocument();
  });

  it('does not call submitReview when validation fails', async () => {
    const spy = vi.spyOn(apiClient, 'submitReview');
    render(<ReviewForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ReviewForm submission', () => {
  async function fillAndSubmit() {
    await userEvent.click(screen.getByRole('radio', { name: /5 stars/i }));
    await userEvent.type(screen.getByLabelText(/title/i), 'Excellent work');
    await userEvent.type(screen.getByLabelText(/feedback/i), 'Delivered on time and exceeded expectations.');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Jane D.');
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }));
  }

  it('calls submitReview with correct payload', async () => {
    const spy = vi.spyOn(apiClient, 'submitReview').mockResolvedValue({ reviewId: 'r-1' });
    render(<ReviewForm {...defaultProps} />);
    await fillAndSubmit();
    await waitFor(() => expect(spy).toHaveBeenCalledOnce());
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        bountyId: 'b-1',
        creatorId: 'c-1',
        rating: 5,
        title: 'Excellent work',
        reviewerName: 'Jane D.',
      }),
    );
  });

  it('shows success state after submission', async () => {
    vi.spyOn(apiClient, 'submitReview').mockResolvedValue({ reviewId: 'r-1' });
    render(<ReviewForm {...defaultProps} />);
    await fillAndSubmit();
    expect(await screen.findByText(/review submitted/i)).toBeInTheDocument();
  });

  it('calls onSuccess callback after submission', async () => {
    vi.spyOn(apiClient, 'submitReview').mockResolvedValue({ reviewId: 'r-1' });
    const onSuccess = vi.fn();
    render(<ReviewForm {...defaultProps} onSuccess={onSuccess} />);
    await fillAndSubmit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it('disables submit button while submitting', async () => {
    vi.spyOn(apiClient, 'submitReview').mockImplementation(
      () => new Promise((res) => setTimeout(() => res({ reviewId: 'r-1' }), 200)),
    );
    render(<ReviewForm {...defaultProps} />);
    await userEvent.click(screen.getByRole('radio', { name: /5 stars/i }));
    await userEvent.type(screen.getByLabelText(/title/i), 'Great');
    await userEvent.type(screen.getByLabelText(/feedback/i), 'Excellent.');
    await userEvent.type(screen.getByLabelText(/your name/i), 'Jane');
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));
    expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled();
  });

  it('shows API error message on failure', async () => {
    vi.spyOn(apiClient, 'submitReview').mockRejectedValue(
      new apiClient.ApiClientError('INTERNAL_SERVER_ERROR', 'Server error'),
    );
    render(<ReviewForm {...defaultProps} />);
    await fillAndSubmit();
    expect(await screen.findByText(/server error/i)).toBeInTheDocument();
  });

  it('shows generic error for non-ApiClientError failures', async () => {
    vi.spyOn(apiClient, 'submitReview').mockRejectedValue(new Error('Network'));
    render(<ReviewForm {...defaultProps} />);
    await fillAndSubmit();
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});

describe('ReviewForm character counter', () => {
  it('shows character count for body', async () => {
    render(<ReviewForm {...defaultProps} />);
    await userEvent.type(screen.getByLabelText(/feedback/i), 'Hello');
    expect(screen.getByText('5/1000')).toBeInTheDocument();
  });
});
