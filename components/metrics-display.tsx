'use client';

import { LucideIcon } from 'lucide-react';

interface MetricProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color?: 'primary' | 'accent' | 'secondary';
}

interface MetricsDisplayProps {
  metrics: MetricProps[];
  columns?: 1 | 2 | 3 | 4;
}

export function MetricsDisplay({
  metrics,
  columns = 3,
}: MetricsDisplayProps) {
  const colorMap = {
    primary: 'text-primary bg-primary/15',
    accent: 'text-accent bg-accent/15',
    secondary: 'text-secondary bg-secondary/15',
  };

  const gridColsMap = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className={`grid ${gridColsMap[columns]} gap-6`}>
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        const color = metric.color || 'primary';
        const colorStyles = colorMap[color];

        return (
          <div
            key={index}
            className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-all duration-300"
          >
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${colorStyles}`}>
              <Icon size={24} />
            </div>
            <p className="text-sm font-semibold text-muted-foreground mb-2">
              {metric.label}
            </p>
            <p className="text-2xl sm:text-3xl font-bold text-foreground">
              {metric.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
