import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { ProjectCard } from '@/components/project-card';
import { RichTextContent } from '@/components/ui/rich-text';
import { CreatorProfileSkeleton } from '@/components/ui/skeleton-group';
import { creators } from '@/lib/creators-data';

// Simulate async data fetch (replace with real DB/API call)
async function getCreator(id: string) {
  // Artificial delay to demonstrate streaming
  await new Promise((r) => setTimeout(r, 0));
  return creators.find((c) => c.id === id) ?? null;
}

async function CreatorProfile({ id }: { id: string }) {
  const creator = await getCreator(id);
  if (!creator) notFound();

  return (
    <>
      {/* Cover */}
      <div className="relative h-48 sm:h-64 w-full bg-muted overflow-hidden">
        <Image
          src={creator.coverImage}
          alt={`${creator.name} cover`}
          fill
          className="object-cover"
          priority
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {/* Avatar + name */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-12 mb-8">
          <div className="relative w-24 h-24 rounded-full overflow-hidden border-4 border-background bg-muted shrink-0">
            <Image src={creator.avatar} alt={creator.name} fill className="object-cover" />
          </div>
          <div className="pb-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{creator.name}</h1>
            <p className="text-muted-foreground">{creator.title} · {creator.discipline}</p>
          </div>
          <div className="sm:ml-auto flex gap-3 pb-1">
            <a href={creator.linkedIn} target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors">
              LinkedIn
            </a>
            <a href={creator.twitter} target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors">
              Twitter
            </a>
          </div>
        </div>

        {/* Tagline */}
        <p className="text-lg italic text-muted-foreground mb-4">&ldquo;{creator.tagline}&rdquo;</p>

        {/* Bio — supports rich HTML if stored, falls back to plain text */}
        <div className="mb-8 max-w-3xl">
          {creator.bio.startsWith('<') ? (
            <RichTextContent html={creator.bio} />
          ) : (
            <p className="text-foreground leading-relaxed">{creator.bio}</p>
          )}
        </div>

        {/* Skills */}
        <div className="flex flex-wrap gap-2 mb-12">
          {creator.skills.map((skill) => (
            <span key={skill} className="px-3 py-1 text-sm bg-muted rounded-full text-foreground">
              {skill}
            </span>
          ))}
        </div>

        {/* Projects — wrapped in its own Suspense for granular streaming */}
        <section>
          <h2 className="text-xl font-semibold text-foreground mb-6">Projects</h2>
          <Suspense fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-lg overflow-hidden animate-pulse">
                  <div className="aspect-video bg-muted" />
                  <div className="p-4 space-y-2">
                    <div className="h-5 bg-muted rounded w-3/4" />
                    <div className="h-4 bg-muted rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          }>
            {creator.projects.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {creator.projects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No projects yet.</p>
            )}
          </Suspense>
        </section>

        {/* CTA */}
        <div className="mt-16 text-center border border-border rounded-xl p-10 bg-muted/30">
          <h3 className="text-2xl font-bold text-foreground mb-3">Work with {creator.name}</h3>
          <p className="text-muted-foreground mb-6">Reach out directly to discuss your project.</p>
          <a href={creator.linkedIn} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors">
            Get In Touch
          </a>
        </div>
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
          <CreatorProfile id={id} />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
