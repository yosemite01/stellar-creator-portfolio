'use client';

import { Project } from '@/lib/creators-data';
import { ExternalLink } from 'lucide-react';

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <div className="group bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-all duration-300">
      {/* Image */}
      <div className="aspect-video bg-gradient-to-br from-primary/20 to-accent/20 overflow-hidden relative">
        {project.image && (
          <img
            src={project.image}
            alt={project.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        {/* Category Badge */}
        <div className="inline-block mb-2">
          <span className="text-xs font-semibold px-2.5 py-1 bg-secondary/30 text-secondary rounded-full">
            {project.category}
          </span>
        </div>

        {/* Title */}
        <h4 className="text-base font-bold text-foreground mb-2 line-clamp-2">
          {project.title}
        </h4>

        {/* Description */}
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
          {project.description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-3">
          {project.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-1 bg-muted rounded text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {project.tags.length > 2 && (
            <span className="text-xs px-2 py-1 bg-muted rounded text-muted-foreground">
              +{project.tags.length - 2}
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground font-medium">
            {project.year}
          </span>
          {project.link && (
            <a
              href={project.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-accent hover:text-primary transition-colors"
            >
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
