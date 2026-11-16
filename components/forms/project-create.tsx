'use client';

import { useEffect, useState } from 'react';
import { RichTextEditor } from '@/components/ui/rich-text';
import { hasRichTextContent } from '@/lib/rich-text/sanitize';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc-client';
import { BOUNTY_TEMPLATES, renderSafeTemplate, type BountyTemplate } from '@/lib/bounty-templates';

/**
 * Loads templates from `GET /api/bounty-templates` — system templates plus
 * any the signed-in user has saved themselves (Issue #1611) — falling back
 * to the static `BOUNTY_TEMPLATES` list (signed out, offline, or the
 * request fails) so the picker never shows an empty state.
 */
function useTemplates(): { templates: BountyTemplate[]; categories: string[] } {
  const [templates, setTemplates] = useState<BountyTemplate[]>(BOUNTY_TEMPLATES);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/bounty-templates')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((data: { templates: BountyTemplate[] }) => {
        if (!cancelled && Array.isArray(data.templates) && data.templates.length > 0) {
          setTemplates(data.templates.map(renderSafeTemplate));
        }
      })
      .catch(() => {
        // Keep the static fallback already in state — e.g. signed out
        // (401), offline, or a transient server error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = [...new Set(templates.map((t) => t.category))];
  return { templates, categories };
}

interface ProjectFormData {
  title: string;
  category: string;
  description: string;
  tags: string;
  year: number;
  link?: string;
}

interface ProjectCreateFormProps {
  onSubmit: (data: ProjectFormData) => Promise<void>;
  onCancel?: () => void;
}

type Step = 'template' | 'form';

// ─── Template Picker Step ─────────────────────────────────────────────────────

function TemplatePicker({ onSelect, onSkip }: { onSelect: (t: BountyTemplate) => void; onSkip: () => void }) {
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const { templates, categories } = useTemplates();

  const filtered = activeCategory === 'All'
    ? templates
    : templates.filter(t => t.category === activeCategory);

  return (
    <div className="space-y-5" aria-label="Select a bounty template">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Start from a template</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a template to pre-fill your bounty, or skip to start from scratch.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {['All', ...categories].map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            aria-pressed={activeCategory === cat}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid gap-3 max-h-[420px] overflow-y-auto pr-1" role="list">
        {filtered.map(tpl => (
          <button
            key={tpl.id}
            role="listitem"
            onClick={() => onSelect(tpl)}
            className="text-left p-4 rounded-lg border border-input bg-background hover:border-primary hover:bg-accent/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{tpl.title}</span>
              <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {tpl.category}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{tpl.description}</p>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span>~${tpl.suggestedBudget.toLocaleString()}</span>
              <span>{tpl.suggestedTimeline} days</span>
            </div>
          </button>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="button" variant="outline" onClick={onSkip}>
          Skip — start from scratch
        </Button>
      </div>
    </div>
  );
}

// ─── Main Form ────────────────────────────────────────────────────────────────

/**
 * Two-step project/bounty creation form: an optional template picker
 * (pre-fills fields from `GET /api/bounty-templates` — system templates
 * plus the signed-in user's own saved ones, Issue #1611 — falling back to
 * the static `BOUNTY_TEMPLATES` list) followed by the editable form
 * fields. On submit it calls the `projects.create` tRPC mutation, then the
 * `onSubmit` callback with the entered values, and resets the form.
 */
export function ProjectCreateForm({ onSubmit, onCancel }: ProjectCreateFormProps) {
  const [step, setStep] = useState<Step>('template');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createProjectMutation = trpc.projects.create.useMutation({
    onSuccess: async () => {
      await onSubmit({ title: title.trim(), category: category.trim(), description, tags: tags.trim(), year, link: link.trim() || undefined });
      setTitle(''); setCategory(''); setDescription(''); setTags('');
      setYear(new Date().getFullYear()); setLink('');
    },
    onError: (err) => console.error('Project creation failed:', err),
  });

  const handleTemplateSelect = (tpl: BountyTemplate) => {
    const safe = renderSafeTemplate(tpl);
    setTitle(safe.title);
    setCategory(safe.category);
    setDescription(safe.description);
    setTags(safe.requiredSkills.join(', '));
    setStep('form');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError(null);
    try {
      await createProjectMutation.mutateAsync({
        title: title.trim(), category: category.trim(), description,
        tags: tags.trim().split(',').map(t => t.trim()).filter(Boolean),
        year, link: link.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    }
  };

  const isValid = title.trim().length > 0 && category.trim().length > 0 && hasRichTextContent(description);
  const submitting = createProjectMutation.isPending;

  const field = (label: string, required: boolean, children: React.ReactNode) => (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );

  const inputCls = 'w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground';

  // ── Step: template picker ──────────────────────────────────────────────────
  if (step === 'template') {
    return (
      <TemplatePicker
        onSelect={handleTemplateSelect}
        onSkip={() => setStep('form')}
      />
    );
  }

  // ── Step: editable form ────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="Create project">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          All fields are editable — customise before submitting.
        </p>
        <button
          type="button"
          onClick={() => setStep('template')}
          className="text-xs text-primary underline underline-offset-2"
        >
          ← Back to templates
        </button>
      </div>

      {field('Project Title', true,
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Brand Identity Redesign" className={inputCls} required />
      )}

      {field('Category', true,
        <input type="text" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Brand Strategy" className={inputCls} required />
      )}

      {field('Project Details', true,
        <RichTextEditor value={description} onChange={setDescription} placeholder="Describe the project, your role, outcomes, and any relevant context..." />
      )}

      {field('Tags', false,
        <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="Comma-separated: branding, figma, ux" className={inputCls} />
      )}

      <div className="grid grid-cols-2 gap-4">
        {field('Year', true,
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2000} max={new Date().getFullYear()} className={inputCls} required />
        )}
        {field('Project URL', false,
          <input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." className={inputCls} />
        )}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3 justify-end pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
        )}
        <Button type="submit" disabled={!isValid || submitting}>
          {submitting ? 'Creating...' : 'Create Project'}
        </Button>
      </div>
    </form>
  );
}
