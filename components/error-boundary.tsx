'use client';

import React, { ReactNode, ReactElement } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactElement;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex items-center justify-center h-64 text-red-600 bg-red-50 rounded border border-red-200">
            <div className="text-center">
              <p className="font-semibold">Something went wrong</p>
              <p className="text-sm mt-1">{this.state.error?.message}</p>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
