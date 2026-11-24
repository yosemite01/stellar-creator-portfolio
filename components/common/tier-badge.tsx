'use client';

/**
 * TierBadge — Issue #832
 *
 * Displays the creator's verification tier badge:
 *   VERIFIED → ✓ Blue checkmark
 *   TRUSTED  → ⭐ Gold star
 *   ELITE    → 💎 Diamond
 *
 * Used on: creator card, profile header, search results.
 */

import { VerificationTier } from '@/lib/generated/prisma/browser';

interface TierBadgeProps {
  tier: VerificationTier;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

interface TierConfig {
  emoji: string;
  label: string;
  title: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
}

const TIER_CONFIG: Record<VerificationTier, TierConfig | null> = {
  NONE: null, // No badge shown
  VERIFIED: {
    emoji: '✓',
    label: 'Verified',
    title: 'KYC verified creator',
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/40',
    text: 'text-blue-400',
    dot: 'bg-blue-500',
  },
  TRUSTED: {
    emoji: '⭐',
    label: 'Trusted',
    title: '10+ completed bounties, avg rating ≥ 4.0',
    bg: 'bg-yellow-500/15',
    border: 'border-yellow-500/40',
    text: 'text-yellow-400',
    dot: 'bg-yellow-500',
  },
  ELITE: {
    emoji: '💎',
    label: 'Elite',
    title: '50+ bounties, avg rating ≥ 4.5, 1+ year active',
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/40',
    text: 'text-purple-300',
    dot: 'bg-purple-500',
  },
};

const SIZE_CLASSES = {
  sm: { wrap: 'gap-1 px-1.5 py-0.5 text-xs rounded', emoji: 'text-xs' },
  md: { wrap: 'gap-1.5 px-2 py-1 text-sm rounded-md', emoji: 'text-sm' },
  lg: { wrap: 'gap-2 px-3 py-1.5 text-base rounded-lg', emoji: 'text-base' },
};

export function TierBadge({
  tier,
  size = 'md',
  showLabel = true,
  className = '',
}: TierBadgeProps) {
  const config = TIER_CONFIG[tier];
  if (!config) return null;

  const sizes = SIZE_CLASSES[size];

  return (
    <span
      title={config.title}
      role="img"
      aria-label={`${config.label} creator`}
      className={[
        'inline-flex items-center font-semibold border backdrop-blur-sm select-none',
        sizes.wrap,
        config.bg,
        config.border,
        config.text,
        className,
      ].join(' ')}
    >
      <span className={sizes.emoji} aria-hidden="true">
        {config.emoji}
      </span>
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

/**
 * Inline icon-only variant — suitable for tight spaces like table rows.
 */
export function TierIcon({ tier, size = 'md' }: Pick<TierBadgeProps, 'tier' | 'size'>) {
  return <TierBadge tier={tier} size={size} showLabel={false} />;
}

/**
 * Returns the display label for a tier (useful in headless contexts).
 */
export function tierLabel(tier: VerificationTier): string {
  return TIER_CONFIG[tier]?.label ?? 'Unverified';
}
