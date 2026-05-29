'use client';

import { useState } from 'react';
import { RichTextEditor } from '@/components/ui/rich-text';
import { Button } from '@/components/ui/button';

interface ProjectFormData {
  title: string;
  category: string;
  description: string; // sanitized HTML from TipTap
  tags: string;
  year: number;
  link?: string;
}

interface ProjectCreateFormProps {
  onSubmit: (data: ProjectFormData) => Promise<void>;
  onCancel?: () => void;
}

export function ProjectCreateForm({ onSubmit, onCancel }: ProjectCreateFormProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = title.trim().length > 0 && category.trim().length > 0 && description.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), category: category.trim(), description, tags: tags.trim(), year, link: link.trim() || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save project.');
    } finally {
      setSubmitting(false);
    }
  };

  const field = (label: string, required: boolean, children: React.ReactNode) => (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );

  const inputCls = 'w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="Create project">
      {field('Project Title', true,
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Brand Identity Redesign" className={inputCls} required />
      )}

      {field('Category', true,
        <input type="text" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Brand Strategy" className={inputCls} required />
      )}

      {field('Project Details', true,
        <RichTextEditor
          value={description}
          onChange={setDescription}
          placeholder="Describe the project, your role, outcomes, and any relevant context..."
        />
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
          {submitting ? 'Saving...' : 'Save Project'}
        </Button>
      </div>
    </form>
  );
}
