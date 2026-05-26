import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatCurrency,
  formatDate,
  formatRelativeDate,
  formatDeadline,
  capitalise,
  formatRating,
  formatExperience,
  truncate,
} from './utils';

describe('formatCurrency', () => {
  it('formats USD by default', () => {
    expect(formatCurrency(3000)).toBe('$3,000');
  });

  it('formats EUR', () => {
    expect(formatCurrency(1500, 'EUR')).toContain('1,500');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0');
  });
});

describe('formatDate', () => {
  it('formats an ISO string', () => {
    expect(formatDate('2025-08-12')).toBe('Aug 12, 2025');
  });

  it('formats a Date object', () => {
    expect(formatDate(new Date('2024-01-01'))).toBe('Jan 1, 2024');
  });
});

describe('formatRelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-09-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Today for same day', () => {
    expect(formatRelativeDate(new Date('2025-09-01T00:00:00Z'))).toBe('Today');
  });

  it('returns Yesterday for 1 day ago', () => {
    expect(formatRelativeDate(new Date('2025-08-31T00:00:00Z'))).toBe('Yesterday');
  });

  it('returns N days ago for < 7 days', () => {
    expect(formatRelativeDate(new Date('2025-08-26T00:00:00Z'))).toBe('6 days ago');
  });

  it('returns N weeks ago for < 30 days', () => {
    expect(formatRelativeDate(new Date('2025-08-11T00:00:00Z'))).toBe('3 weeks ago');
  });

  it('returns N months ago for < 365 days', () => {
    expect(formatRelativeDate(new Date('2025-03-01T00:00:00Z'))).toBe('6 months ago');
  });

  it('returns N years ago for >= 365 days', () => {
    expect(formatRelativeDate(new Date('2024-08-31T00:00:00Z'))).toBe('1 years ago');
  });
});

describe('formatDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-09-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Expired for past date', () => {
    expect(formatDeadline(new Date('2025-08-30T00:00:00Z'))).toBe('Expired');
  });

  it('returns Due today for same day', () => {
    expect(formatDeadline(new Date('2025-09-01T00:00:00Z'))).toBe('Due today');
  });

  it('returns 1 day left', () => {
    expect(formatDeadline(new Date('2025-09-02T00:00:00Z'))).toBe('1 day left');
  });

  it('returns N days left', () => {
    expect(formatDeadline(new Date('2025-09-15T00:00:00Z'))).toBe('14 days left');
  });
});

describe('capitalise', () => {
  it('capitalises first letter', () => {
    expect(capitalise('hello')).toBe('Hello');
  });

  it('handles already capitalised', () => {
    expect(capitalise('World')).toBe('World');
  });

  it('handles empty string', () => {
    expect(capitalise('')).toBe('');
  });
});

describe('formatRating', () => {
  it('formats rating with review count', () => {
    expect(formatRating(4.8, 82)).toBe('4.8 / 5 (82)');
  });

  it('formats rating without review count', () => {
    expect(formatRating(4.5)).toBe('4.5 / 5');
  });

  it('returns no ratings message when undefined', () => {
    expect(formatRating(undefined)).toBe('No ratings yet');
  });
});

describe('formatExperience', () => {
  it('formats plural years', () => {
    expect(formatExperience(8)).toBe('8 yrs exp');
  });

  it('formats singular year', () => {
    expect(formatExperience(1)).toBe('1 yr exp');
  });

  it('returns < 1 yr for zero', () => {
    expect(formatExperience(0)).toBe('< 1 yr exp');
  });

  it('returns < 1 yr for undefined', () => {
    expect(formatExperience(undefined)).toBe('< 1 yr exp');
  });
});

describe('truncate', () => {
  it('returns string unchanged when within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and appends ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });

  it('does not truncate at exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});
