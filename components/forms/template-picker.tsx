'use client';

import { useState, useMemo } from 'react';
import {
  getSeedTemplates,
  getTemplateCategories,
  getTemplatesByCategory,
  loadCustomTemplates,
  type BountyTemplate,
  type CustomTemplate,
} from '@/lib/bounty-templates';
import { Button } from '@/components/ui/button';

interface TemplatePickerProps {
  onSelect: (template: BountyTemplate) => void;
  onSkip: () => void;
}

export function TemplatePicker({ onSelect, onSkip }: TemplatePickerProps) {
  const [category, setCategory] = useState('All');
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);

  // Load custom templates on mount (client-side only)
  useMemo(() => {
    setCustomTemplates(loadCustomTemplates());
  }, []);

  const seedTemplates = getTemplatesByCategory(category);
  const categories = getTemplateCategories();
  const allTemplates = [...seedTemplates, ...customTemplates.filter(
    (t) => category === 'All' || t.category === category
  )];

  return (
    <div className="space-y-4" aria-label="Template picker">
      <div className="text-center space-y-1">
        <h3 className="text-lg font-semibold">Start from a template</h3>
        <p className="text-sm text-muted-foreground">
          Pick a pre-built template to pre-fill the form, or start from scratch.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 justify-center">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
              category === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto p-1">
        {allTemplates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            className="text-left p-4 rounded-lg border border-border hover:border-primary hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm group-hover:text-primary transition-colors truncate">
                  {template.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {template.category}
                </p>
              </div>
              <span className="text-sm font-semibold text-primary whitespace-nowrap">
                ${template.suggestedBudget.toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
              {template.description}
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span>{template.suggestedTimeline} days</span>
              <span className="capitalize">{template.difficulty}</span>
              <span>{template.requiredSkills.length} skills</span>
            </div>
          </button>
        ))}
      </div>

      {/* Skip button */}
      <div className="flex justify-center pt-2">
        <Button type="button" variant="ghost" onClick={onSkip}>
          Start from scratch
        </Button>
      </div>
    </div>
  );
}
