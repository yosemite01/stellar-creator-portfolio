'use client';

import Link from 'next/link';
import { computeProfileCompletion, type CreatorProfileFields } from '@/lib/profile-completion';
import { cn } from '@/lib/utils';

interface ProfileCompletionIndicatorProps {
  profile: CreatorProfileFields;
  className?: string;
}

export function ProfileCompletionIndicator({
  profile,
  className,
}: ProfileCompletionIndicatorProps) {
  const { percentage, missing } = computeProfileCompletion(profile);

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className={cn('rounded-lg border p-6 space-y-4', className)}>
      <div className="flex items-center gap-6">
        <div className="relative h-24 w-24 shrink-0">
          <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-muted"
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className="text-primary transition-all duration-300"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">
            {percentage}%
          </span>
        </div>
        <div>
          <h3 className="font-semibold">Profile completion</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Profiles with &gt;80% completion get 3× more inquiries.
          </p>
        </div>
      </div>

      {missing.length > 0 && (
        <ul className="space-y-2">
          {missing.map((field) => (
            <li key={field.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{field.label}</span>
              <Link href={field.href} className="text-primary hover:underline font-medium">
                Complete
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
