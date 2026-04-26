'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  THEMES,
  type PortfolioCustomization,
  type LayoutOption,
  type ThemeId,
  type CustomSection,
  validateCustomization,
} from '@/lib/utils/portfolio-customization';
import { Grid3X3, LayoutGrid, GalleryHorizontal, Monitor, Smartphone, Check, GripVertical, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PortfolioEditorProps {
  config: PortfolioCustomization;
  onChange: (config: PortfolioCustomization) => void;
  onSave: () => void;
  saving?: boolean;
}

const LAYOUTS: { value: LayoutOption; label: string; icon: React.ReactNode }[] = [
  { value: 'grid', label: 'Grid', icon: <Grid3X3 size={18} /> },
  { value: 'masonry', label: 'Masonry', icon: <LayoutGrid size={18} /> },
  { value: 'carousel', label: 'Carousel', icon: <GalleryHorizontal size={18} /> },
];

export function PortfolioEditor({ config, onChange, onSave, saving }: PortfolioEditorProps) {
  const [activeTab, setActiveTab] = useState<'theme' | 'layout' | 'sections' | 'display'>('theme');
  const [errors, setErrors] = useState<string[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const update = useCallback(
    (patch: Partial<PortfolioCustomization>) => {
      const next = { ...config, ...patch };
      const errs = validateCustomization(next);
      setErrors(errs);
      if (errs.length === 0) onChange(next);
    },
    [config, onChange]
  );

  const updateSection = (id: string, patch: Partial<CustomSection>) => {
    update({
      sections: config.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };

  // Drag-and-drop reorder
  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    const reordered = [...config.sections];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    const withOrder = reordered.map((s, i) => ({ ...s, order: i }));
    setDragIndex(index);
    onChange({ ...config, sections: withOrder });
  };
  const handleDragEnd = () => setDragIndex(null);

  const tabs = ['theme', 'layout', 'sections', 'display'] as const;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-3 text-sm font-medium capitalize transition-colors',
              activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-5">
        {/* Theme tab */}
        {activeTab === 'theme' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Choose a theme for your portfolio.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => update({ themeId: theme.id as ThemeId })}
                  className={cn(
                    'relative rounded-lg border-2 p-3 text-left transition-all hover:shadow-md',
                    config.themeId === theme.id ? 'border-primary' : 'border-border'
                  )}
                >
                  <div
                    className="h-10 rounded-md mb-2"
                    style={{ background: theme.preview }}
                  />
                  <p className="text-xs font-semibold text-foreground">{theme.name}</p>
                  <p className="text-xs text-muted-foreground">{theme.description}</p>
                  {config.themeId === theme.id && (
                    <span className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-0.5">
                      <Check size={10} />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Accent color override */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Accent Color Override
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={config.accentColor || '#3b82f6'}
                  onChange={(e) => update({ accentColor: e.target.value })}
                  className="h-9 w-16 rounded border border-border cursor-pointer bg-background"
                />
                <input
                  type="text"
                  value={config.accentColor}
                  onChange={(e) => update({ accentColor: e.target.value })}
                  placeholder="#hex or empty for theme default"
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
                />
                {config.accentColor && (
                  <Button variant="ghost" size="sm" onClick={() => update({ accentColor: '' })}>
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Layout tab */}
        {activeTab === 'layout' && (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium text-foreground mb-3">Project Layout</p>
              <div className="flex gap-3">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => update({ layout: l.value })}
                    className={cn(
                      'flex-1 flex flex-col items-center gap-2 py-4 rounded-lg border-2 transition-all text-sm font-medium',
                      config.layout === l.value
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    {l.icon}
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-foreground mb-3">Hero Style</p>
              <div className="flex gap-3">
                {(['cover', 'minimal', 'centered'] as const).map((style) => (
                  <button
                    key={style}
                    onClick={() => update({ heroStyle: style })}
                    className={cn(
                      'flex-1 py-2.5 rounded-lg border-2 text-sm font-medium capitalize transition-all',
                      config.heroStyle === style
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    )}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Sections tab */}
        {activeTab === 'sections' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Drag to reorder. Toggle visibility per section.</p>
            {[...config.sections]
              .sort((a, b) => a.order - b.order)
              .map((section, index) => (
                <div
                  key={section.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border border-border bg-background transition-all',
                    dragIndex === index && 'opacity-50 border-primary'
                  )}
                >
                  <span className="mt-1 cursor-grab text-muted-foreground">
                    <GripVertical size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={section.title}
                      onChange={(e) => updateSection(section.id, { title: e.target.value })}
                      className="w-full text-sm font-medium bg-transparent border-none outline-none text-foreground"
                      maxLength={80}
                    />
                    {(section.type === 'text' || section.type === 'testimonial' || section.type === 'cta') && (
                      <textarea
                        value={section.content}
                        onChange={(e) => updateSection(section.id, { content: e.target.value })}
                        rows={2}
                        maxLength={2000}
                        placeholder="Custom content..."
                        className="w-full mt-1 text-xs bg-muted/50 border border-border rounded px-2 py-1 text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                      />
                    )}
                  </div>
                  <button
                    onClick={() => updateSection(section.id, { visible: !section.visible })}
                    className={cn(
                      'mt-0.5 shrink-0 transition-colors',
                      section.visible ? 'text-primary' : 'text-muted-foreground'
                    )}
                    aria-label={section.visible ? 'Hide section' : 'Show section'}
                  >
                    {section.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* Display tab */}
        {activeTab === 'display' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Toggle which blocks appear on your portfolio.</p>
            {[
              { key: 'showStats', label: 'Experience Stats' },
              { key: 'showReviews', label: 'Reviews Section' },
              { key: 'showServices', label: 'Services Section' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-foreground">{label}</span>
                <button
                  role="switch"
                  aria-checked={config[key as keyof PortfolioCustomization] as boolean}
                  onClick={() => update({ [key]: !config[key as keyof PortfolioCustomization] })}
                  className={cn(
                    'relative inline-flex h-6 w-11 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    config[key as keyof PortfolioCustomization] ? 'bg-primary' : 'bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5',
                      config[key as keyof PortfolioCustomization] ? 'translate-x-5' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </label>
            ))}
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 space-y-1">
            {errors.map((e, i) => (
              <p key={i} className="text-xs text-destructive">{e}</p>
            ))}
          </div>
        )}

        {/* Save */}
        <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Last saved: {new Date(config.updatedAt).toLocaleTimeString()}
          </p>
          <Button onClick={onSave} disabled={saving || errors.length > 0} size="sm">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Mobile/Desktop preview toggle
export function PreviewToggle({
  mode,
  onChange,
}: {
  mode: 'desktop' | 'mobile';
  onChange: (m: 'desktop' | 'mobile') => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
      <button
        onClick={() => onChange('desktop')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          mode === 'desktop' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
        )}
      >
        <Monitor size={14} /> Desktop
      </button>
      <button
        onClick={() => onChange('mobile')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          mode === 'mobile' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
        )}
      >
        <Smartphone size={14} /> Mobile
      </button>
    </div>
  );
}
