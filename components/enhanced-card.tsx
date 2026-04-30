'use client';

import React from 'react';

interface EnhancedCardProps {
  children: React.ReactNode;
  clickable?: boolean;
  onClick?: () => void;
  className?: string;
  animated?: boolean;
}

export function EnhancedCard({
  children,
  clickable = false,
  onClick,
  className = '',
  animated = true,
}: EnhancedCardProps) {
  const baseStyles =
    'bg-card border border-border rounded-lg overflow-hidden transition-all duration-300';

  const interactiveStyles = clickable
    ? 'cursor-pointer hover:shadow-lg hover:-translate-y-1'
    : '';

  const animationStyles = animated ? 'group' : '';

  return (
    <div
      onClick={onClick}
      className={`${baseStyles} ${interactiveStyles} ${animationStyles} ${className}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          onClick?.();
        }
      }}
    >
      {children}
    </div>
  );
}
