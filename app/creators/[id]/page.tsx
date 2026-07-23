import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { CreatorProfileSkeleton } from '@/components/ui/skeleton-group';
import { CardSkeleton, TextSkeleton } from '@/components/skeletons/card-skeleton';
import { CreatorHeroSection, CreatorCtaSection } from '@/components/streaming/creator-hero-section';
import { CreatorBioSection } from '@/components/streaming/creator-bio-section';
import { CreatorProjectsSection } from '@/components/streaming/creator-projects-section';
import { fetchCreatorCore } from '@/lib/streaming/chunk-data';
import { getCreatorById } from '@/lib/services/creators-data';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const creator = getCreatorById(id);

  if (!creator) {
    return { title: 'Creator Not Found' };
  }

  return {
    title: `${creator.name} — ${creator.title}`,
    description: creator.bio || `View ${creator.name}'s portfolio, projects, and skills on Stellar Creator Portfolio.`,
    openGraph: {
      title: `${creator.name} — ${creator.title} | Stellar Creator Portfolio`,
      description: creator.bio,
      images: creator.avatar
        ? [{ url: creator.avatar, width: 400, height: 400, alt: creator.name }]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${creator.name} — ${creator.title} | Stellar Creator Portfolio`,
      description: creator.bio,
    },
  };
}

async function CreatorProfileShell({ id }: { id: string }) {
  const creator = await fetchCreatorCore(id);
  if (!creator) notFound();

  return (
    <>
      <Suspense fallback={
        <div className="animate-pulse">
          <div className="h-48 sm:h-64 bg-muted w-full" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-end gap-4 -mt-12 mb-6">
              <div className="w-24 h-24 rounded-full bg-muted border-4 border-background" />
              <div className="h-7 bg-muted rounded w-48" />
            </div>
          </div>
        </div>
      }>
        <CreatorHeroSection id={id} />
      </Suspense>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <Suspense fallback={<div className="mb-8"><TextSkeleton lines={4} /></div>}>
          <CreatorBioSection id={id} />
        </Suspense>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-6">Projects</h2>
          <Suspense fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          }>
            <CreatorProjectsSection id={id} />
          </Suspense>
        </section>

        <Suspense fallback={<div className="mt-16 h-40 bg-muted rounded-xl animate-pulse" />}>
          <CreatorCtaSection id={id} />
        </Suspense>
      </div>
    </>
  );
}

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow">
        <Suspense fallback={<CreatorProfileSkeleton />}>
          <CreatorProfileShell id={id} />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
