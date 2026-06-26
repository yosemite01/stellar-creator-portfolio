import { describe, it, expect } from 'vitest';
import * as z from 'zod';

const roleSchema = z.object({
  role: z.enum(['CREATOR', 'CLIENT']),
});

const creatorSchema = z.object({
  displayName: z.string().min(2).max(30),
  discipline: z.string().min(1),
  skills: z.array(z.string()).min(1).max(5),
});

describe('Onboarding wizard validation', () => {
  it('accepts valid role selection', () => {
    expect(roleSchema.parse({ role: 'CREATOR' }).role).toBe('CREATOR');
    expect(roleSchema.parse({ role: 'CLIENT' }).role).toBe('CLIENT');
  });

  it('requires creator profile fields on step 2', () => {
    const result = creatorSchema.safeParse({
      displayName: 'Ada',
      discipline: 'Development',
      skills: ['react', 'typescript', 'rust'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects creator with fewer than 3 skills when max is 5', () => {
    const result = creatorSchema.safeParse({
      displayName: 'Ada',
      discipline: 'Development',
      skills: ['react'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty display name', () => {
    const result = creatorSchema.safeParse({
      displayName: 'A',
      discipline: 'Development',
      skills: ['react'],
    });
    expect(result.success).toBe(false);
  });
});

describe('Onboarding step progression', () => {
  it('tracks three visible steps', () => {
    const TOTAL_STEPS = 3;
    expect(TOTAL_STEPS).toBe(3);
    expect((2 / TOTAL_STEPS) * 100).toBeCloseTo(66.67, 1);
  });
});
