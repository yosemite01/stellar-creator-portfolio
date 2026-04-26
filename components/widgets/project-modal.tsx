'use client'

import Image from 'next/image'
import type { Project } from '@/lib/services/creators-data'
import {
  getProjectDetail,
  getProjectStatus,
  getProjectTechStack,
} from '@/lib/utils/project-helpers'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ExternalLink, Calendar, Layers } from 'lucide-react'
import { buildOptimizationProps, buildSizes } from '@/lib/utils/image-utils'
import { cn } from '@/lib/utils'

const statusStyles: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  'in-progress': 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30',
  archived: 'bg-muted text-muted-foreground border-border',
}

export interface ProjectModalProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectModal({ project, open, onOpenChange }: ProjectModalProps) {
  if (!project) return null

  const status = getProjectStatus(project)
  const tech = getProjectTechStack(project)
  const detail = getProjectDetail(project)
  const modalSizes = buildSizes({
    mobile: '100vw',
    tablet: '90vw',
    desktop: 'min(720px, 90vw)',
    largeDesktop: '720px',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(92vh,900px)] overflow-y-auto p-0 gap-0 sm:max-w-2xl"
      >
        <div className="relative aspect-video w-full bg-muted">
          {project.image ? (
            <Image
              src={project.image}
              alt={project.title}
              fill
              className="object-cover"
              sizes={modalSizes}
              {...buildOptimizationProps({ priority: false, sizes: modalSizes })}
              placeholder="empty"
            />
          ) : null}
        </div>

        <div className="space-y-4 p-6">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-normal">
                {project.category}
              </Badge>
              <Badge
                variant="outline"
                className={cn('capitalize border', statusStyles[status] ?? statusStyles.completed)}
              >
                {status.replace(/-/g, ' ')}
              </Badge>
              <span className="text-sm text-muted-foreground">{project.year}</span>
            </div>
            <DialogTitle className="text-xl sm:text-2xl pr-8">{project.title}</DialogTitle>
            <DialogDescription asChild>
              <p className="text-base text-foreground leading-relaxed whitespace-pre-wrap">
                {detail}
              </p>
            </DialogDescription>
          </DialogHeader>

          {project.duration ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <span className="font-medium text-foreground">Timeline</span>
                <p>{project.duration}</p>
              </div>
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Layers className="h-4 w-4" aria-hidden />
              Tech stack
            </div>
            <div className="flex flex-wrap gap-2">
              {tech.map((t) => (
                <Badge key={t} variant="secondary" className="font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          {project.link ? (
            <Button className="w-full sm:w-auto" asChild>
              <a href={project.link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open live project
              </a>
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
