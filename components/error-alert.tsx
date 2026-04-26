'use client';

import { AlertCircle, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface ErrorAlertProps {
  title?: string;
  message: string;
  onDismiss?: () => void;
  fieldErrors?: Record<string, string>;
}

export function ErrorAlert({
  title = 'Error',
  message,
  onDismiss,
  fieldErrors,
}: ErrorAlertProps) {
  return (
    <div className="space-y-2">
      <Alert variant="destructive" className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-sm mt-1">{message}</p>
          </div>
        </div>
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </Alert>

      {/* Field-specific errors */}
      {fieldErrors && Object.keys(fieldErrors).length > 0 && (
        <div className="ml-7 space-y-1 text-sm">
          {Object.entries(fieldErrors).map(([field, error]) => (
            <p key={field} className="text-destructive">
              <span className="font-medium">{field}:</span> {error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
