'use client';

import React, { ReactNode, ReactElement } from 'react';
import { errorTracker } from '@/lib/error-tracking';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactElement;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorId: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    errorTracker.captureError(error, {
      component: 'ErrorBoundary',
      metadata: { componentStack: errorInfo.componentStack },
    }).then((id) => {
      this.setState({ errorId: id || null });
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { error, errorId } = this.state;
      return (
        <div className="flex items-center justify-center min-h-[16rem] p-6 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
          <div className="text-center max-w-md">
            <p className="text-2xl mb-2">⚠️</p>
            <p className="font-semibold text-red-700 dark:text-red-400 text-lg mb-1">
              Something went wrong
            </p>
            <p className="text-sm text-red-600 dark:text-red-300 mb-2">
              {error?.message || 'An unexpected error occurred. Please try reloading the page.'}
            </p>
            {errorId && (
              <p className="text-xs text-red-400 dark:text-red-500 mb-4 font-mono">
                Error ID: {errorId}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
