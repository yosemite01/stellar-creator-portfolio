'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { CreatorCard } from '@/components/cards/creator-card';
import { disciplines, searchCreators, ALL_SKILLS } from '@/lib/services/creators-data';
import { Button } from '@/components/ui/button';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from '@/components/ui/empty';
import { Pagination, parsePaginationParams } from '@/components/pagination';
import { SearchInput } from '@/components/common/search-input';
import { useCreatorFilters, EXPERIENCE_RANGES, SortOption } from '@/hooks/useCreatorFilters';
import { Users, SlidersHorizontal, X } from 'lucide-react';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'relevance',        label: 'Relevance' },
  { value: 'most-experienced', label: 'Most Experienced' },
  { value: 'highest-rated',    label: 'Highest Rated' },
  { value: 'most-reviewed',    label: 'Most Reviewed' },
];

export default function CreatorsPage() {
  const searchParams = useSearchParams();
  const { filters, update, clear, activeFilterCount } = useCreatorFilters();

  const { page, pageSize } = parsePaginationParams({
    page:     searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
  });

  const filtered = searchCreators({
    query:           filters.query,
    discipline:      filters.discipline,
    skills:          filters.skills,
    experienceRange: filters.experienceRange,
    sort:            filters.sort,
  });

  const totalCount = filtered.length;
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

  const toggleSkill = (skill: string) => {
    const next = filters.skills.includes(skill)
      ? filters.skills.filter((s) => s !== skill)
      : [...filters.skills, skill];
    update({ skills: next });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero */}
        <section className="border-b border-border bg-muted/30 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-3">Creator Directory</h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Explore our community of world-class creators. Search and filter to find the perfect talent.
            </p>
          </div>
        </section>

        {/* Filters */}
        <section className="border-b border-border py-6 sticky top-16 bg-background/80 backdrop-blur-md z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">

            {/* Row 1: search + sort + clear */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <SearchInput
                  value={filters.query}
                  onChange={(q) => update({ query: q })}
                  placeholder="Search by name, skill, or expertise..."
                />
              </div>

              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-muted-foreground shrink-0" />
                <select
                  value={filters.sort}
                  onChange={(e) => update({ sort: e.target.value as SortOption })}
                  aria-label="Sort creators"
                  className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {activeFilterCount > 0 && (
                  <Button variant="outline" size="sm" onClick={clear} className="gap-1.5 shrink-0">
                    <X size={13} />
                    Clear
                    <span className="bg-primary text-primary-foreground rounded-full text-xs w-4 h-4 flex items-center justify-center leading-none">
                      {activeFilterCount}
                    </span>
                  </Button>
                )}
              </div>
            </div>

            {/* Row 2: discipline */}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by discipline">
              {disciplines.map((d) => (
                <Button
                  key={d}
                  variant={filters.discipline === d ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => update({ discipline: d })}
                  className="transition-all"
                >
                  {d}
                </Button>
              ))}
            </div>

            {/* Row 3: experience range */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Experience:</span>
              {['All', ...Object.keys(EXPERIENCE_RANGES)].map((range) => (
                <button
                  key={range}
                  onClick={() => update({ experienceRange: range })}
                  aria-pressed={filters.experienceRange === range}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filters.experienceRange === range
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {range === 'All' ? 'Any' : range === '10+' ? '10+ yrs' : `${range} yrs`}
                </button>
              ))}
            </div>

            {/* Row 4: skills multi-select */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Skills:</span>
              {ALL_SKILLS.map((skill) => (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  aria-pressed={filters.skills.includes(skill)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    filters.skills.includes(skill)
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {skill}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="py-16 sm:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {paginated.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground mb-8">
                  {totalCount} creator{totalCount !== 1 ? 's' : ''} found
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {paginated.map((creator) => (
                    <CreatorCard key={creator.id} creator={creator} />
                  ))}
                </div>
                <Pagination total={totalCount} page={page} pageSize={pageSize} />
              </>
            ) : (
              <Empty className="min-h-[400px]">
                <EmptyMedia variant="icon">
                  <Users className="size-6" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No creators found</EmptyTitle>
                  <EmptyDescription>
                    No creators match your filters. Try adjusting your search or clearing all filters.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={clear}>Clear All Filters</Button>
                </EmptyContent>
              </Empty>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border bg-muted/30 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">Ready to Collaborate?</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Found the perfect creator? Reach out directly through their social profiles or contact us for partnership inquiries.
            </p>
            <a
              href="mailto:contact@stellar.com"
              className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              Get In Touch
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
