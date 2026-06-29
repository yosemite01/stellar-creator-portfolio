'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { creators as allCreators, Creator } from '@/lib/services/creators-data';

export default function ComparePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [comparedCreators, setComparedCreators] = useState<Creator[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const ids = searchParams.get('ids');
    if (!ids) {
      router.push('/creators');
      return;
    }

    const idList = ids.split(',').filter(Boolean);
    const matched = allCreators.filter((c) => idList.includes(c.id));

    if (matched.length < 2) {
      router.push('/creators');
      return;
    }

    setComparedCreators(matched);
    setIsLoading(false);
  }, [searchParams, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading comparison...</p>
      </div>
    );
  }

  // Calculate skills overlap
  const allSkills = Array.from(
    new Set(comparedCreators.flatMap((c) => c.skills || []))
  );

  const getSkillOverlap = (skill: string) => {
    return comparedCreators.filter((c) => c.skills?.includes(skill)).length;
  };

  const getSharedSkills = () => {
    return allSkills.filter((skill) => getSkillOverlap(skill) === comparedCreators.length);
  };

  const sharedSkills = getSharedSkills();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Header */}
        <section className="border-b border-border bg-muted/30 py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4 mb-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
                className="gap-2"
              >
                <ChevronLeft size={16} />
                Back
              </Button>
            </div>
            <h1 className="text-4xl font-bold text-foreground mb-2">
              Creator Comparison
            </h1>
            <p className="text-lg text-muted-foreground">
              Side-by-side comparison of {comparedCreators.length} creators
            </p>
          </div>
        </section>

        {/* Comparison Table */}
        <section className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {comparedCreators.map((creator) => (
                <div
                  key={creator.id}
                  className="bg-card border border-border rounded-lg overflow-hidden"
                >
                  {/* Creator Header */}
                  <div className="aspect-video bg-gradient-to-br from-primary/20 to-accent/20 overflow-hidden">
                    {creator.coverImage && (
                      <img
                        src={creator.coverImage}
                        alt={creator.name}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>

                  <div className="p-6">
                    {/* Name & Title */}
                    <h3 className="text-xl font-bold text-foreground mb-1">
                      {creator.name}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {creator.title}
                    </p>

                    {/* Stats */}
                    {creator.stats && (
                      <div className="grid grid-cols-3 gap-3 mb-6 py-4 border-y border-border">
                        <div className="text-center">
                          <div className="text-lg font-bold text-primary">
                            {creator.stats.projects}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Projects
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-primary">
                            {creator.stats.clients}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Clients
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-primary">
                            {creator.stats.experience}y
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Experience
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Rating */}
                    {creator.rating !== undefined && (
                      <div className="mb-4">
                        <p className="text-xs text-muted-foreground font-semibold uppercase mb-2">
                          Rating
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-primary">
                            {creator.rating}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({creator.rating === 0 ? 'No' : creator.rating} reviews)
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Response Time */}
                    <div className="mb-4">
                      <p className="text-xs text-muted-foreground font-semibold uppercase mb-2">
                        Response Time
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        Within 24 hours
                      </p>
                    </div>

                    {/* Price Range */}
                    {creator.hourlyRate && (
                      <div className="mb-4">
                        <p className="text-xs text-muted-foreground font-semibold uppercase mb-2">
                          Hourly Rate
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          ${creator.hourlyRate}/hour
                        </p>
                      </div>
                    )}

                    {/* Availability */}
                    <div className="mb-6">
                      <p className="text-xs text-muted-foreground font-semibold uppercase mb-2">
                        Availability
                      </p>
                      <p className="text-sm font-medium text-green-600">
                        ✓ Available
                      </p>
                    </div>

                    {/* Skills */}
                    <div className="mb-6">
                      <p className="text-xs text-muted-foreground font-semibold uppercase mb-3">
                        Skills
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {creator.skills?.map((skill) => (
                          <span
                            key={skill}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                              sharedSkills.includes(skill)
                                ? 'bg-green-100 text-green-800'
                                : 'bg-secondary text-secondary-foreground'
                            }`}
                          >
                            {skill}
                            {sharedSkills.includes(skill) && ' ✓'}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Hire Button */}
                    <Button
                      className="w-full"
                      onClick={() => router.push(`/creators/${creator.id}`)}
                    >
                      View Profile & Hire
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Skills Summary */}
            {sharedSkills.length > 0 && (
              <div className="mt-12 bg-green-50 border border-green-200 rounded-lg p-6">
                <h3 className="text-lg font-bold text-green-900 mb-3">
                  Shared Skills
                </h3>
                <div className="flex flex-wrap gap-2">
                  {sharedSkills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center px-3 py-1 rounded-full bg-green-200 text-green-800 text-sm font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
