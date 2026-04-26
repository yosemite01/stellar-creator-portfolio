'use client';

import { useCallback } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export type SortOption = 'relevance' | 'most-reviewed' | 'highest-rated' | 'most-experienced';

export interface CreatorFilters {
  query: string;
  discipline: string;
  skills: string[];
  experienceRange: string;
  sort: SortOption;
}

export const EXPERIENCE_RANGES: Record<string, [number, number]> = {
  '0-2':  [0, 2],
  '3-5':  [3, 5],
  '6-10': [6, 10],
  '10+':  [10, 999],
};

const DEFAULTS: CreatorFilters = {
  query: '',
  discipline: 'All',
  skills: [],
  experienceRange: 'All',
  sort: 'relevance',
};

export function useCreatorFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters: CreatorFilters = {
    query:           searchParams.get('q') ?? DEFAULTS.query,
    discipline:      searchParams.get('discipline') ?? DEFAULTS.discipline,
    skills:          searchParams.get('skills') ? searchParams.get('skills')!.split(',').filter(Boolean) : [],
    experienceRange: searchParams.get('exp') ?? DEFAULTS.experienceRange,
    sort:            (searchParams.get('sort') as SortOption) ?? DEFAULTS.sort,
  };

  const activeFilterCount = [
    filters.query !== '',
    filters.discipline !== 'All',
    filters.skills.length > 0,
    filters.experienceRange !== 'All',
    filters.sort !== 'relevance',
  ].filter(Boolean).length;

  const update = useCallback((patch: Partial<CreatorFilters>) => {
    const params = new URLSearchParams(searchParams.toString());
    const next = { ...filters, ...patch };

    if (next.query) { params.set('q', next.query); } else { params.delete('q'); }
    if (next.discipline !== 'All') { params.set('discipline', next.discipline); } else { params.delete('discipline'); }
    if (next.skills.length) { params.set('skills', next.skills.join(',')); } else { params.delete('skills'); }
    if (next.experienceRange !== 'All') { params.set('exp', next.experienceRange); } else { params.delete('exp'); }
    if (next.sort !== 'relevance') { params.set('sort', next.sort); } else { params.delete('sort'); }
    params.set('page', '1');

    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [filters, pathname, router, searchParams]);

  const clear = useCallback(() => {
    router.push(pathname, { scroll: false });
  }, [pathname, router]);

  return { filters, update, clear, activeFilterCount };
}
