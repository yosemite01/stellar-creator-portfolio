'use client';

import { BadgeCheck, AlertCircle, Clock } from 'lucide-react';

interface VerificationBadgeProps {
  status: 'verified' | 'pending' | 'unverified';
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
}

export function VerificationBadge({
  status,
  size = 'md',
  showTooltip = true,
}: VerificationBadgeProps) {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  };

  const tooltips = {
    verified: 'Verified creator with completed bounties',
    pending: 'Verification in progress',
    unverified: 'Not yet verified',
  };

  if (status === 'verified') {
    return (
      <div title={showTooltip ? tooltips.verified : undefined}>
        <BadgeCheck className={`${sizes[size]} text-accent fill-accent`} />
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div title={showTooltip ? tooltips.pending : undefined}>
        <Clock className={`${sizes[size]} text-yellow-500 animate-spin`} />
      </div>
    );
  }

  return null;
}

// Creator card with verification
export function CreatorHeader({
  name,
  title,
  verificationStatus,
}: {
  name: string;
  title: string;
  verificationStatus: 'verified' | 'pending' | 'unverified';
}) {
  return (
    <div className="flex items-center gap-2">
      <div>
        <h3 className="font-bold text-foreground">{name}</h3>
        <p className="text-sm text-muted-foreground">{title}</p>
      </div>
      {verificationStatus !== 'unverified' && (
        <VerificationBadge status={verificationStatus} />
      )}
    </div>
  );
}
