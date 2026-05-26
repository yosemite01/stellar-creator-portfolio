'use client';

import Image from 'next/image';
import type { Project } from '@/lib/services/creators-data';
import { getProjectStatus, getProjectTechStack } from '@/lib/utils/project-helpers';
import { ExternalLink, Calendar, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { buildOptimizationProps, buildSizes } from '@/lib/utils/image-utils';
import { cn } from '@/lib/utils';

const statusClass: Record<string, string> = {
  completed: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
  'in-progress': 'bg-amber-500/12 text-amber-900 dark:text-amber-200',
  archived: 'bg-muted text-muted-foreground',
};

function formatStatus(status: string): string {
  return status.replace(/-/g, ' ');
}

export interface ProjectCardProps {
  project: Project;
  layout?: 'grid' | 'list';
  /** For LCP / eager loading on first tiles */
  imageIndex?: number;
  onViewDetails?: (project: Project) => void;
}

export function ProjectCard({
  project,
  layout = 'grid',
  imageIndex = 0,
  onViewDetails,
}: ProjectCardProps) {
  const status = getProjectStatus(project);
  const tech = getProjectTechStack(project);
  const previewTech = tech.slice(0, 4);
  const moreTech = tech.length - previewTech.length;

  const cardSizes = buildSizes({
    mobile: '100vw',
    tablet: layout === 'list' ? '200px' : '50vw',
    desktop: layout === 'list' ? '240px' : '33vw',
    largeDesktop: layout === 'list' ? '280px' : '400px',
  });

  const imgProps = buildOptimizationProps({
    index: imageIndex,
    aboveFoldCount: 3,
    sizes: cardSizes,
  });

  const interactive = Boolean(onViewDetails);

  return (
    <article
      className={cn(
        'group bg-card border border-border rounded-xl overflow-hidden transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        layout === 'list' && 'flex flex-col sm:flex-row sm:items-stretch gap-0',
        interactive && 'cursor-pointer',
      )}
      onClick={interactive ? () => onViewDetails?.(project) : undefined}
    >
      <div
        className={cn(
          'relative bg-gradient-to-br from-primary/15 to-accent/15 overflow-hidden shrink-0',
          layout === 'grid' && 'aspect-video w-full',
          layout === 'list' && 'aspect-video w-full sm:w-52 md:w-60 sm:min-h-[140px]',
        )}
      >
        {project.image ? (
          <Image
            src={project.image}
            alt=""
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            sizes={cardSizes}
            {...imgProps}
            placeholder="empty"
          />
        ) : null}
        <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-xs font-medium shadow-sm">
            {project.category}
          </Badge>
          <Badge
            variant="secondary"
            className={cn('text-xs capitalize shadow-sm', statusClass[status] ?? statusClass.completed)}
          >
            {formatStatus(status)}
          </Badge>
        </div>
      </div>

      <div className={cn('p-4 sm:p-5 flex flex-col flex-1 min-w-0', layout === 'list' && 'sm:py-4')}>
        <h3 className="text-lg font-bold text-foreground mb-2 line-clamp-2 leading-snug">{project.title}</h3>

        <p className="text-sm text-muted-foreground mb-3 line-clamp-3 leading-relaxed">{project.description}</p>

        {project.duration ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{project.duration}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5 mb-4">
          {previewTech.map((t) => (
            <span
              key={t}
              className="text-xs px-2 py-0.5 rounded-md bg-secondary/80 text-secondary-foreground font-medium"
            >
              {t}
            </span>
          ))}
          {moreTech > 0 ? (
            <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground">+{moreTech}</span>
          ) : null}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 justify-between">
          <span className="text-xs font-semibold text-muted-foreground">{project.year}</span>
          <div className="flex items-center gap-2">
            {onViewDetails ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails(project);
                }}
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                Details
              </Button>
            ) : null}
            {project.link ? (
              <a
                href={project.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-accent hover:bg-secondary transition-colors"
                aria-label={`Open ${project.title} in new tab`}
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
