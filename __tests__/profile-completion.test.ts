import { describe, it, expect } from 'vitest';
import { computeProfileCompletion } from '@/lib/profile-completion';

describe('computeProfileCompletion', () => {
  it('returns 0% for empty profile', () => {
    const result = computeProfileCompletion({});
    expect(result.percentage).toBe(0);
    expect(result.missing.length).toBe(7);
  });

  it('returns 100% for fully complete profile', () => {
    const result = computeProfileCompletion({
      displayName: 'Ada Lovelace',
      avatar: 'https://example.com/avatar.png',
      bio: 'Full-stack developer',
      skills: ['react', 'typescript', 'rust'],
      portfolio: { items: [{ title: 'Project' }] },
      githubUrl: 'https://github.com/ada',
      verified: true,
    });
    expect(result.percentage).toBe(100);
    expect(result.missing).toHaveLength(0);
  });

  it('counts display name as 10%', () => {
    const result = computeProfileCompletion({ displayName: 'Ada' });
    expect(result.percentage).toBe(10);
  });

  it('requires 3+ skills for skills field', () => {
    const twoSkills = computeProfileCompletion({ skills: ['a', 'b'] });
    const threeSkills = computeProfileCompletion({ skills: ['a', 'b', 'c'] });
    expect(twoSkills.percentage).toBe(0);
    expect(threeSkills.percentage).toBe(15);
  });

  it('accepts github or linkedin for social field', () => {
    const github = computeProfileCompletion({ linkedinUrl: 'https://linkedin.com/in/ada' });
    expect(github.percentage).toBe(10);
  });
});
