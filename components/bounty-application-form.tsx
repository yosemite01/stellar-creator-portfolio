'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { z } from 'zod';

const applicationSchema = z.object({
  proposedBudget: z.number().min(100, 'Budget must be at least $100'),
  timeline: z.number().min(1, 'Timeline must be at least 1 day'),
  proposal: z.string().min(50, 'Proposal must be at least 50 characters').max(2000),
  portfolio: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

type ApplicationFormData = z.infer<typeof applicationSchema>;

interface BountyApplicationFormProps {
  bountyId: string;
  bountyTitle: string;
  maxBudget: number;
  onSuccess?: () => void;
}

export function BountyApplicationForm({
  bountyId,
  bountyTitle,
  maxBudget,
  onSuccess,
}: BountyApplicationFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<ApplicationFormData>({
    proposedBudget: maxBudget * 0.8,
    timeline: 7,
    proposal: '',
    portfolio: '',
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    const numValue = type === 'number' ? parseFloat(value) : value;
    setFormData((prev) => ({
      ...prev,
      [name]: numValue,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const validated = applicationSchema.parse(formData);

      const response = await fetch('/api/bounties/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bountyId,
          ...validated,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit application');
      }

      setIsSubmitted(true);
      onSuccess?.();
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="bg-accent/20 border border-accent rounded-lg p-6 text-center">
        <CheckCircle size={48} className="text-accent mx-auto mb-4" />
        <h3 className="text-xl font-bold text-foreground mb-2">Application Submitted!</h3>
        <p className="text-muted-foreground mb-4">
          Your application for "{bountyTitle}" has been received. The bounty poster will review it soon.
        </p>
        <Button variant="outline" onClick={() => setIsSubmitted(false)}>
          Submit Another Application
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-destructive/20 border border-destructive rounded-lg p-4 flex gap-3">
          <AlertCircle className="text-destructive flex-shrink-0" size={20} />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Proposed Budget (USD)
        </label>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">$</span>
          <input
            type="number"
            name="proposedBudget"
            value={formData.proposedBudget}
            onChange={handleChange}
            min="100"
            max={maxBudget}
            step="100"
            className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground"
          />
          <span className="text-xs text-muted-foreground">
            Max: ${maxBudget}
          </span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Timeline (Days)
        </label>
        <input
          type="number"
          name="timeline"
          value={formData.timeline}
          onChange={handleChange}
          min="1"
          step="1"
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Your Proposal
        </label>
        <textarea
          name="proposal"
          value={formData.proposal}
          onChange={handleChange}
          placeholder="Explain why you're the right fit for this bounty..."
          rows={5}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Minimum 50 characters, maximum 2000
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Portfolio Link (Optional)
        </label>
        <input
          type="url"
          name="portfolio"
          value={formData.portfolio}
          onChange={handleChange}
          placeholder="https://your-portfolio.com"
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isLoading}
      >
        {isLoading && <Loader size={16} className="mr-2 animate-spin" />}
        {isLoading ? 'Submitting...' : 'Submit Application'}
      </Button>
    </form>
  );
}
