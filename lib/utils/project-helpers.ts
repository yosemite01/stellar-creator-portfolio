import type { Project, ProjectStatus } from '@/lib/services/creators-data'

export function getProjectStatus(project: Project): ProjectStatus {
  return project.status ?? 'completed'
}

export function getProjectTechStack(project: Project): string[] {
  if (project.techStack?.length) return project.techStack
  return project.tags
}

export function getProjectDetail(project: Project): string {
  return project.detail ?? project.description
}

export function projectCategoryOptions(projects: Project[]): string[] {
  const set = new Set<string>()
  for (const p of projects) set.add(p.category)
  return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
}

export function filterProjectsByCategory(projects: Project[], category: string): Project[] {
  if (category === 'All') return projects
  return projects.filter((p) => p.category === category)
}
