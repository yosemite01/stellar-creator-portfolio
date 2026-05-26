import { BadgeCheck, Clock, Star, Zap, Award, TrendingUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { VerificationStatus, SpecialBadge } from '@/lib/services/creators-data';

interface VerificationBadgeProps {
  status: VerificationStatus;
  verifiedAt?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const sizeMap = {
  sm: 14,
  md: 16,
  lg: 20,
};

export function VerificationBadge({ status, verifiedAt, size = 'md', showLabel = false }: VerificationBadgeProps) {
  if (status === 'unverified') return null;

  const iconSize = sizeMap[size];
  const date = verifiedAt ? new Date(verifiedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null;

  if (status === 'pending') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('inline-flex items-center gap-1 text-amber-500', showLabel && 'bg-amber-500/10 px-2 py-0.5 rounded-full text-xs font-medium')}>
              <Clock size={iconSize} />
              {showLabel && 'Pending'}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Verification pending review</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center gap-1 text-primary', showLabel && 'bg-primary/10 px-2 py-0.5 rounded-full text-xs font-medium')}>
            <BadgeCheck size={iconSize} />
            {showLabel && 'Verified'}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">Verified Creator</p>
          {date && <p className="text-xs text-muted-foreground">Since {date}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const specialBadgeConfig: Record<SpecialBadge, { icon: React.ElementType; label: string; color: string; description: string }> = {
  'top-rated': {
    icon: Star,
    label: 'Top Rated',
    color: 'text-yellow-500',
    description: 'Consistently high ratings from clients',
  },
  'responsive': {
    icon: Zap,
    label: 'Responsive',
    color: 'text-blue-500',
    description: 'Replies within 2 hours on average',
  },
  'certified': {
    icon: Award,
    label: 'Certified',
    color: 'text-purple-500',
    description: 'Passed Stellar skills certification',
  },
  'rising-star': {
    icon: TrendingUp,
    label: 'Rising Star',
    color: 'text-green-500',
    description: 'Fast-growing creator with exceptional momentum',
  },
};

interface SpecialBadgeProps {
  badge: SpecialBadge;
  size?: 'sm' | 'md';
}

export function SpecialBadgeIcon({ badge, size = 'sm' }: SpecialBadgeProps) {
  const config = specialBadgeConfig[badge];
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 13 : 16;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center', config.color)}>
            <Icon size={iconSize} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{config.label}</p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface BadgeRowProps {
  badges: SpecialBadge[];
  size?: 'sm' | 'md';
}

export function BadgeRow({ badges, size = 'sm' }: BadgeRowProps) {
  if (!badges.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {badges.map((b) => (
        <SpecialBadgeIcon key={b} badge={b} size={size} />
      ))}
    </span>
  );
}
