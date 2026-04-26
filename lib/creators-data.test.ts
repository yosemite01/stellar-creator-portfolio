import { describe, it, expect } from 'vitest';
import {
  getCreatorsByDiscipline,
  searchCreators,
  formatAvailability,
  formatBudget,
  getBountiesByCategory,
  getBountiesByDifficulty,
  creators,
  bounties,
} from './creators-data';

describe('getCreatorsByDiscipline', () => {
  it('returns all creators for "All"', () => {
    expect(getCreatorsByDiscipline('All')).toHaveLength(creators.length);
  });

  it('filters by discipline', () => {
    const result = getCreatorsByDiscipline('UI/UX Design');
    expect(result.every(c => c.discipline === 'UI/UX Design')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown discipline', () => {
    expect(getCreatorsByDiscipline('Astrology')).toHaveLength(0);
  });
});

describe('searchCreators', () => {
  it('returns all creators for empty query', () => {
    expect(searchCreators('')).toHaveLength(creators.length);
  });

  it('matches by name (case-insensitive)', () => {
    const result = searchCreators('alex');
    expect(result.some(c => c.name.toLowerCase().includes('alex'))).toBe(true);
  });

  it('matches by skill', () => {
    const result = searchCreators('figma');
    expect(result.some(c => c.skills.some(s => s.toLowerCase() === 'figma'))).toBe(true);
  });

  it('matches by bio keyword', () => {
    const result = searchCreators('accessibility');
    expect(result.length).toBeGreaterThan(0);
  });

  it('filters by discipline alongside query', () => {
    const result = searchCreators('', 'Writing');
    expect(result.every(c => c.discipline === 'Writing')).toBe(true);
  });

  it('returns empty for no match', () => {
    expect(searchCreators('zzznomatch')).toHaveLength(0);
  });
});

describe('formatAvailability', () => {
  it('formats available', () => {
    expect(formatAvailability('available')).toBe('Available now');
  });

  it('formats limited', () => {
    expect(formatAvailability('limited')).toBe('Limited availability');
  });

  it('formats unavailable', () => {
    expect(formatAvailability('unavailable')).toBe('Unavailable');
  });

  it('handles undefined', () => {
    expect(formatAvailability(undefined)).toBe('Status unknown');
  });
});

describe('formatBudget', () => {
  it('formats USD', () => {
    expect(formatBudget(3000)).toBe('$3,000');
  });

  it('formats zero', () => {
    expect(formatBudget(0)).toBe('$0');
  });
});

describe('getBountiesByCategory', () => {
  it('returns all for "All"', () => {
    expect(getBountiesByCategory('All')).toHaveLength(bounties.length);
  });

  it('filters by category', () => {
    const result = getBountiesByCategory('Brand Strategy');
    expect(result.every(b => b.category === 'Brand Strategy')).toBe(true);
  });
});

describe('getBountiesByDifficulty', () => {
  it('returns all for "All"', () => {
    expect(getBountiesByDifficulty('All')).toHaveLength(bounties.length);
  });

  it('filters by difficulty', () => {
    const result = getBountiesByDifficulty('expert');
    expect(result.every(b => b.difficulty === 'expert')).toBe(true);
  });
});
