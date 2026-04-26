'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { PortfolioEditor, PreviewToggle } from '@/components/widgets/portfolio-editor';
import { creators } from '@/lib/services/creators-data';
import {
  loadCustomization,
  saveCustomization,
  applyThemeVars,
  resetThemeVars,
  type PortfolioCustomization,
} from '@/lib/utils/portfolio-customization';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CustomizePageProps {
  params: { id: string };
}

export default function CustomizePortfolioPage({ params }: CustomizePageProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const creator = creators.find((c) => c.id === params.id);

  const [config, setConfig] = useState<PortfolioCustomization | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  // Auth guard - only the creator themselves (or admin) can customize
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push(`/auth/login?callbackUrl=/creators/${params.id}/customize`);
    }
  }, [status, params.id, router]);

  useEffect(() => {
    if (!creator) return;
    const loaded = loadCustomization(creator.id);
    setConfig(loaded);
  }, [creator]);

  // Apply theme preview live
  useEffect(() => {
    if (!config) return;
    applyThemeVars(config.themeId, config.accentColor || undefined);
    return () => resetThemeVars();
  }, [config?.themeId, config?.accentColor]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    // Simulate async save (replace with API call in production)
    await new Promise((r) => setTimeout(r, 400));
    saveCustomization(config);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [config]);

  if (!creator) {
    router.replace('/creators');
    return null;
  }

  if (status === 'loading' || !config) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-7xl mx-auto px-4 py-16 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading editor...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Top bar */}
        <div className="border-b border-border bg-card sticky top-16 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => router.push(`/creators/${creator.id}`)}
              >
                <ArrowLeft size={15} />
                Back
              </Button>
              <span className="text-sm font-medium text-foreground hidden sm:inline">
                Customizing: {creator.name}
              </span>
            </div>

            <PreviewToggle mode={previewMode} onChange={setPreviewMode} />

            <div className="flex items-center gap-2">
              {saved && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  Saved
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => window.open(`/creators/${creator.id}`, '_blank')}
              >
                <ExternalLink size={13} />
                Preview
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>

        {/* Editor + Preview layout */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8 items-start">
            {/* Editor panel */}
            <div className="lg:sticky lg:top-32">
              <PortfolioEditor
                config={config}
                onChange={setConfig}
                onSave={handleSave}
                saving={saving}
              />
            </div>

            {/* Live preview */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-full transition-all duration-300 border border-border rounded-xl overflow-hidden shadow-lg bg-background',
                  previewMode === 'mobile' ? 'max-w-[390px]' : 'max-w-full'
                )}
              >
                {/* Preview header bar */}
                <div className="bg-muted/50 border-b border-border px-4 py-2 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-400" />
                    <span className="w-3 h-3 rounded-full bg-yellow-400" />
                    <span className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <span className="text-xs text-muted-foreground mx-auto">
                    stellar.app/creators/{creator.id}
                  </span>
                </div>

                {/* Preview content */}
                <div className="p-6 space-y-6 min-h-[500px]">
                  {/* Hero preview */}
                  <div
                    className={cn(
                      'rounded-lg overflow-hidden',
                      config.heroStyle === 'cover' && 'h-32 bg-gradient-to-br from-primary/30 to-accent/30',
                      config.heroStyle === 'minimal' && 'h-16 bg-muted/50',
                      config.heroStyle === 'centered' && 'h-24 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 flex items-center justify-center'
                    )}
                  >
                    {config.heroStyle === 'centered' && (
                      <p className="text-sm font-bold text-foreground">{creator.name}</p>
                    )}
                  </div>

                  {/* Name & title */}
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{creator.name}</h2>
                    <p className="text-sm text-primary font-medium">{creator.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 italic">"{creator.tagline}"</p>
                  </div>

                  {/* Stats preview */}
                  {config.showStats && creator.stats && (
                    <div className="grid grid-cols-3 gap-3 py-3 border-y border-border">
                      {[
                        { v: creator.stats.projects, l: 'Projects' },
                        { v: creator.stats.clients, l: 'Clients' },
                        { v: `${creator.stats.experience}y`, l: 'Experience' },
                      ].map(({ v, l }) => (
                        <div key={l} className="text-center">
                          <div className="text-lg font-bold text-primary">{v}</div>
                          <div className="text-xs text-muted-foreground">{l}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Projects layout preview */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      Featured Work — {config.layout}
                    </p>
                    <div
                      className={cn(
                        'gap-3',
                        config.layout === 'grid' && 'grid grid-cols-2',
                        config.layout === 'masonry' && 'columns-2',
                        config.layout === 'carousel' && 'flex overflow-x-auto gap-3'
                      )}
                    >
                      {creator.projects.slice(0, 4).map((p, i) => (
                        <div
                          key={p.id}
                          className={cn(
                            'rounded-lg bg-muted/60 border border-border p-3',
                            config.layout === 'masonry' && i % 2 === 0 ? 'h-20' : 'h-14',
                            config.layout === 'carousel' && 'shrink-0 w-36'
                          )}
                        >
                          <p className="text-xs font-medium text-foreground line-clamp-1">{p.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{p.category}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Visible sections preview */}
                  {config.sections
                    .filter((s) => s.visible)
                    .sort((a, b) => a.order - b.order)
                    .map((s) => (
                      <div key={s.id} className="border-t border-border pt-4">
                        <p className="text-xs font-semibold text-foreground mb-1">{s.title}</p>
                        {s.content && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{s.content}</p>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-3">
                {previewMode === 'mobile' ? 'Mobile preview (390px)' : 'Desktop preview'}
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
