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
type FieldErrors = Partial<Record<keyof ApplicationFormData, string>>;

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
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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
    setFormData((prev) => ({ ...prev, [name]: numValue }));
    // Clear per-field error on change so assistive technology is informed.
    if (fieldErrors[name as keyof ApplicationFormData]) {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setIsLoading(true);

    try {
      const validated = applicationSchema.parse(formData);
      setFieldErrors({});

      const response = await fetch('/api/bounties/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bountyId, ...validated }),
      });

      if (!response.ok) throw new Error('Failed to submit application');

      setIsSubmitted(true);
      onSuccess?.();
    } catch (err) {
      if (err instanceof z.ZodError) {
        // Map zod issues to per-field errors for aria-describedby linkage.
        const mapped: FieldErrors = {};
        for (const issue of err.issues) {
          const key = issue.path[0] as keyof ApplicationFormData;
          if (key && !mapped[key]) mapped[key] = issue.message;
        }
        setFieldErrors(mapped);
      } else {
        setApiError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-accent/20 border border-accent rounded-lg p-6 text-center"
      >
        <CheckCircle size={48} className="text-accent mx-auto mb-4" aria-hidden="true" />
        <h3 className="text-xl font-bold text-foreground mb-2">Application Submitted!</h3>
        <p className="text-muted-foreground mb-4">
          Your application for &ldquo;{bountyTitle}&rdquo; has been received. The bounty poster will
          review it soon.
        </p>
        <Button variant="outline" onClick={() => setIsSubmitted(false)}>
          Submit Another Application
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={`Apply for bounty: ${bountyTitle}`}
      className="space-y-6"
    >
      {/* API-level error — announced immediately by assistive technology */}
      {apiError && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-destructive/20 border border-destructive rounded-lg p-4 flex gap-3"
        >
          <AlertCircle className="text-destructive flex-shrink-0" size={20} aria-hidden="true" />
          <p className="text-sm text-destructive">{apiError}</p>
        </div>
      )}

      {/* Proposed Budget */}
      <div>
        <label htmlFor="app-budget" className="block text-sm font-medium text-foreground mb-2">
          Proposed Budget (USD) <span aria-hidden="true">*</span>
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-muted-foreground">$</span>
          <input
            id="app-budget"
            type="number"
            name="proposedBudget"
            value={formData.proposedBudget}
            onChange={handleChange}
            min="100"
            max={maxBudget}
            step="100"
            required
            aria-required="true"
            aria-invalid={!!fieldErrors.proposedBudget}
            aria-describedby={fieldErrors.proposedBudget ? 'app-budget-error' : 'app-budget-hint'}
            className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span id="app-budget-hint" className="text-xs text-muted-foreground">
            Max: ${maxBudget}
          </span>
        </div>
        {fieldErrors.proposedBudget && (
          <p id="app-budget-error" role="alert" className="text-xs text-destructive mt-1">
            {fieldErrors.proposedBudget}
          </p>
        )}
      </div>

      {/* Timeline */}
      <div>
        <label htmlFor="app-timeline" className="block text-sm font-medium text-foreground mb-2">
          Timeline (Days) <span aria-hidden="true">*</span>
        </label>
        <input
          id="app-timeline"
          type="number"
          name="timeline"
          value={formData.timeline}
          onChange={handleChange}
          min="1"
          step="1"
          required
          aria-required="true"
          aria-invalid={!!fieldErrors.timeline}
          aria-describedby={fieldErrors.timeline ? 'app-timeline-error' : undefined}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {fieldErrors.timeline && (
          <p id="app-timeline-error" role="alert" className="text-xs text-destructive mt-1">
            {fieldErrors.timeline}
          </p>
        )}
      </div>

      {/* Proposal */}
      <div>
        <label htmlFor="app-proposal" className="block text-sm font-medium text-foreground mb-2">
          Your Proposal <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="app-proposal"
          name="proposal"
          value={formData.proposal}
          onChange={handleChange}
          placeholder="Explain why you're the right fit for this bounty..."
          rows={5}
          required
          aria-required="true"
          aria-invalid={!!fieldErrors.proposal}
          aria-describedby={
            fieldErrors.proposal ? 'app-proposal-error app-proposal-hint' : 'app-proposal-hint'
          }
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex justify-between mt-1">
          <span id="app-proposal-hint" className="text-xs text-muted-foreground">
            Minimum 50 characters, maximum 2 000
          </span>
          <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {formData.proposal.length}/2000
          </span>
        </div>
        {fieldErrors.proposal && (
          <p id="app-proposal-error" role="alert" className="text-xs text-destructive mt-1">
            {fieldErrors.proposal}
          </p>
        )}
      </div>

      {/* Portfolio */}
      <div>
        <label htmlFor="app-portfolio" className="block text-sm font-medium text-foreground mb-2">
          Portfolio Link <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          id="app-portfolio"
          type="url"
          name="portfolio"
          value={formData.portfolio}
          onChange={handleChange}
          placeholder="https://your-portfolio.com"
          aria-invalid={!!fieldErrors.portfolio}
          aria-describedby={fieldErrors.portfolio ? 'app-portfolio-error' : undefined}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {fieldErrors.portfolio && (
          <p id="app-portfolio-error" role="alert" className="text-xs text-destructive mt-1">
            {fieldErrors.portfolio}
          </p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isLoading}
        aria-busy={isLoading}
      >
        {isLoading && <Loader size={16} className="mr-2 animate-spin" aria-hidden="true" />}
        {isLoading ? 'Submitting…' : 'Submit Application'}
      </Button>
    </form>
  );
}
