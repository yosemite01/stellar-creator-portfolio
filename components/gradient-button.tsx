'use client';

import { Button } from '@/components/ui/button';
import React from 'react';

interface GradientButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  icon?: React.ReactNode;
  variant?: 'default' | 'secondary';
}

export function GradientButton({
  children,
  icon,
  variant = 'default',
  className = '',
  ...props
}: GradientButtonProps) {
  const gradientStyles =
    variant === 'default'
      ? 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90'
      : 'bg-gradient-to-r from-secondary to-muted hover:from-secondary/90 hover:to-muted/90';

  return (
    <Button
      className={`${gradientStyles} text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-300 ${className}`}
      {...props}
    >
      {children}
      {icon && <span className="ml-2">{icon}</span>}
    </Button>
  );
}
