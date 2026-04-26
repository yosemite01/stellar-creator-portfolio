'use client';

import { notFound } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { AggregateRating } from '@/lib/services/review-service';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { ProjectCard } from '@/components/cards/project-card';
import { Button } from '@/components/ui/button';
import { creators, type Project } from '@/lib/services/creators-data';
import {
  projectCategoryOptions,
  filterProjectsByCategory,
} from '@/lib/utils/project-helpers';
import { ArrowLeft, Linkedin, Twitter, ExternalLink, Star, Settings2, LayoutGrid, List } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { AggregateRatingDisplay } from '@/components/widgets/rating-display';
import { SocialShare } from '@/components/common/social-share';
import Image from 'next/image';
import { buildOptimizationProps, buildSizes } from '@/lib/utils/image-utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ProjectModal } from '@/components/widgets/project-modal';

interface CreatorProfilePageProps {
  params: {
    id: string;
  };
}

export default function CreatorProfilePage({ params }: CreatorProfilePageProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const creator = creators.find((c) => c.id === params.id);
  const [aggregate, setAggregate] = useState<AggregateRating | null>(null);
  const [modalProject, setModalProject] = useState<Project | null>(null);
  const [projectFilter, setProjectFilter] = useState('All');
  const [galleryLayout, setGalleryLayout] = useState<'grid' | 'list'>('grid');
  const heroSizes = buildSizes({
    mobile: '100vw',
    tablet: '100vw',
    desktop: '100vw',
    largeDesktop: '100vw',
  });

  // Fetch aggregate rating
  useEffect(() => {
    if (!creator) return;
    fetch(`/api/reviews?creatorId=${creator.id}&limit=1000`)
      .then((r) => r.json())
      .then((d) => setAggregate(d.aggregate))
      .catch(() => {});
  }, [creator]);

  const projectCategories = projectCategoryOptions(creator?.projects ?? []);
  const filteredProjects = filterProjectsByCategory(creator?.projects ?? [], projectFilter);

  if (!creator) {
    notFound();
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero Section with Cover */}
        <section className="relative h-64 sm:h-80 bg-gradient-to-br from-primary/20 to-accent/20 overflow-hidden">
          {creator.coverImage && (
            <Image
              src={creator.coverImage}
              alt={`${creator.name} cover image`}
              fill
              className="object-cover"
              {...buildOptimizationProps({ priority: true, sizes: heroSizes })}
              sizes={heroSizes}
              placeholder="empty"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />

          {/* Back Button */}
          <div className="absolute top-6 left-4 sm:left-6 lg:left-8">
            <Button 
              variant="ghost" 
              size="icon" 
              className="bg-background/80 backdrop-blur-sm hover:bg-background/90"
              onClick={() => router.back()}
            >
              <ArrowLeft size={20} />
            </Button>
          </div>

          {/* Customize Button - only visible to the creator */}
          {session && (
            <div className="absolute top-6 right-4 sm:right-6 lg:right-8">
              <Button
                variant="ghost"
                size="sm"
                className="bg-background/80 backdrop-blur-sm hover:bg-background/90 gap-1.5"
                onClick={() => router.push(`/creators/${creator.id}/customize`)}
              >
                <Settings2 size={16} />
                Customize
              </Button>
            </div>
          )}
        </section>

        {/* Profile Section */}
        <section className="border-b border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Main Content */}
              <div className="md:col-span-2">
                {/* Name & Title */}
                <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-2">
                  {creator.name}
                </h1>
                <p className="text-2xl text-primary font-semibold mb-4">
                  {creator.title}
                </p>

                {/* Discipline Badge */}
                <div className="inline-block mb-6">
                  <span className="px-4 py-2 bg-accent/20 text-accent rounded-full font-semibold text-sm">
                    {creator.discipline}
                  </span>
                </div>

                {/* Tagline */}
                <p className="text-lg italic text-muted-foreground mb-6">
                  "{creator.tagline}"
                </p>

                {/* Bio */}
                <p className="text-lg text-foreground leading-relaxed mb-8">
                  {creator.bio}
                </p>

                {/* Social Links */}
                <div className="flex flex-wrap gap-3 mb-8">
                  {creator.linkedIn && (
                    <a
                      href={creator.linkedIn}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-semibold"
                    >
                      <Linkedin size={18} />
                      LinkedIn
                    </a>
                  )}
                  {creator.twitter && (
                    <a
                      href={creator.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors font-semibold"
                    >
                      <Twitter size={18} />
                      Twitter
                    </a>
                  )}
                  {creator.portfolio && (
                    <a
                      href={creator.portfolio}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-secondary/30 transition-colors font-semibold"
                    >
                      <ExternalLink size={18} />
                      Portfolio
                    </a>
                  )}
                  <SocialShare
                    title={`Check out ${creator.name} on Stellar Creators`}
                    description={creator.tagline}
                    url={`/creators/${creator.id}`}
                  />
                </div>
              </div>

              {/* Sidebar - Stats */}
              {creator.stats && (
                <div className="md:col-span-1">
                  <div className="bg-card border border-border rounded-lg p-6 sticky top-24">
                    <h3 className="text-lg font-bold text-foreground mb-6">Experience</h3>
                    
                    <div className="space-y-6">
                      <div>
                        <div className="text-3xl font-bold text-primary mb-1">
                          {creator.stats.projects}
                        </div>
                        <p className="text-sm text-muted-foreground">Projects Completed</p>
                      </div>

                      <div>
                        <div className="text-3xl font-bold text-primary mb-1">
                          {creator.stats.clients}
                        </div>
                        <p className="text-sm text-muted-foreground">Happy Clients</p>
                      </div>

                      <div>
                        <div className="text-3xl font-bold text-primary mb-1">
                          {creator.stats.experience} years
                        </div>
                        <p className="text-sm text-muted-foreground">Industry Experience</p>
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-border">
                      <a
                        href={creator.linkedIn}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full text-center px-4 py-3 bg-accent text-accent-foreground rounded-lg hover:bg-accent/90 transition-colors font-semibold"
                      >
                        Contact Creator
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Skills Section */}
        {creator.skills.length > 0 && (
          <section className="border-b border-border bg-muted/30 py-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-bold text-foreground mb-6">Skills & Expertise</h2>
              <div className="flex flex-wrap gap-3">
                {creator.skills.map((skill) => (
                  <span
                    key={skill}
                    className="px-4 py-2 bg-primary/10 text-primary rounded-full font-medium text-sm"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Projects Section */}
        {creator.projects.length > 0 && (
          <section className="py-16 sm:py-24">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-bold text-foreground">Featured Work</h2>
                  <p className="text-muted-foreground mt-2 max-w-xl text-sm sm:text-base">
                    Filter by category, switch between grid and list, and open a project for the full
                    brief, timeline, and tech stack.
                  </p>
                </div>
                <ToggleGroup
                  type="single"
                  value={galleryLayout}
                  onValueChange={(v) => {
                    if (v === 'grid' || v === 'list') setGalleryLayout(v);
                  }}
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-start sm:self-auto"
                  aria-label="Gallery layout"
                >
                  <ToggleGroupItem value="grid" aria-label="Grid gallery">
                    <LayoutGrid className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label="List gallery">
                    <List className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div
                className="flex flex-wrap gap-2 mb-8"
                role="group"
                aria-label="Filter projects by category"
              >
                {projectCategories.map((cat) => (
                  <Button
                    key={cat}
                    type="button"
                    variant={projectFilter === cat ? 'default' : 'outline'}
                    size="sm"
                    className="rounded-full"
                    onClick={() => setProjectFilter(cat)}
                  >
                    {cat}
                  </Button>
                ))}
              </div>

              {filteredProjects.length === 0 ? (
                <p className="text-muted-foreground">No projects in this category.</p>
              ) : (
                <div
                  className={
                    galleryLayout === 'grid'
                      ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
                      : 'flex flex-col gap-4'
                  }
                >
                  {filteredProjects.map((project, idx) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      layout={galleryLayout}
                      imageIndex={idx}
                      onViewDetails={setModalProject}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <ProjectModal
          project={modalProject}
          open={modalProject !== null}
          onOpenChange={(open) => {
            if (!open) setModalProject(null);
          }}
        />

        {/* Reviews Section */}
        {aggregate && aggregate.total > 0 && (
          <section className="border-b border-border py-12">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-foreground">Reviews</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/creators/${creator.id}/reviews`)}
                  className="gap-1.5"
                >
                  <Star size={14} />
                  See all {aggregate.total} reviews
                </Button>
              </div>
              <AggregateRatingDisplay aggregate={aggregate} />
            </div>
          </section>
        )}

        {/* CTA Section */}
        <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Interested in Collaborating?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Reach out directly through {creator.name}'s social profiles or contact us for partnership inquiries.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {creator.linkedIn && (
                <a
                  href={creator.linkedIn}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Linkedin size={18} className="mr-2" />
                  Connect on LinkedIn
                </a>
              )}
              <Button 
                variant="outline" 
                size="lg"
                onClick={() => router.push('/creators')}
              >
                Back to Directory
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
