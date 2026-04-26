'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { paymentFlowSchema, validatePaymentFlow, type PaymentFlowData } from '@/lib/payment-validation';

export const Sep24Flow: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
  } = useForm<PaymentFlowData>({
    resolver: zodResolver(paymentFlowSchema),
    mode: 'onChange',
  });

  const amount = watch('amount');

  const onSubmit = async (data: PaymentFlowData) => {
    // Validate before submission
    const validation = validatePaymentFlow(data);
    if (!validation.valid) {
      console.error('Validation failed:', validation.errors);
      return;
    }

    setIsSubmitting(true);
    try {
      // Submit payment flow
      console.log('Submitting payment:', data);
      // TODO: Call API endpoint
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="recipientAddress">Recipient Stellar Address</Label>
        <Input
          id="recipientAddress"
          placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
          {...register('recipientAddress')}
          aria-invalid={!!errors.recipientAddress}
        />
        {errors.recipientAddress && (
          <p className="text-sm text-destructive">{errors.recipientAddress.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="amount">Amount (XLM)</Label>
        <Input
          id="amount"
          type="number"
          step="0.0001"
          placeholder="0.0000"
          {...register('amount', { valueAsNumber: true })}
          aria-invalid={!!errors.amount}
        />
        {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
        {amount && <p className="text-xs text-muted-foreground">Amount: {amount} XLM</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          placeholder="Payment description"
          {...register('description')}
          aria-invalid={!!errors.description}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="memo">Memo (Optional)</Label>
        <Input
          id="memo"
          placeholder="Transaction memo"
          maxLength={28}
          {...register('memo')}
          aria-invalid={!!errors.memo}
        />
        {errors.memo && <p className="text-sm text-destructive">{errors.memo.message}</p>}
      </div>

      <Button type="submit" disabled={!isValid || isSubmitting} className="w-full">
        {isSubmitting ? 'Processing...' : 'Continue to Payment'}
      </Button>
    </form>
  );
};
