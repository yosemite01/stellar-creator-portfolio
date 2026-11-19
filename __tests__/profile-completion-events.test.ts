import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  syncCreatorProfileCompletion,
  checkAndSendProfileNudge,
  handleProfileEvent,
  batchEvaluateProfileNudges,
  PROFILE_NUDGE_THRESHOLD,
  PROFILE_NUDGE_COOLDOWN_DAYS,
} from '@/server/services/profile-events';
import {
  scoreCreatorBountyPair,
  rankCreatorsForBounty,
  type BountyFeatures,
  type CreatorFeatures,
} from '@/lib/matching-engine';
import { computeProfileCompletion } from '@/lib/profile-completion';

describe('Profile Completion Scoring, Events, and Nudges (Issue #1825)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncCreatorProfileCompletion', () => {
    it('computes 0% score and returns updated=false if profile not found', async () => {
      const mockPrisma = {
        creatorProfile: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
      };

      const res = await syncCreatorProfileCompletion('non-existent-user', mockPrisma);
      expect(res.percentage).toBe(0);
      expect(res.updated).toBe(false);
      expect(mockPrisma.creatorProfile.update).not.toHaveBeenCalled();
    });

    it('computes profile score and updates database when score changes', async () => {
      const mockProfile = {
        id: 'prof-1',
        userId: 'u-1',
        displayName: 'Alice Engineer',
        avatar: 'https://example.com/avatar.jpg',
        bio: 'Senior full-stack dev',
        skills: ['react', 'typescript', 'rust'],
        portfolio: { items: [{ url: 'https://project.com' }] },
        githubUrl: 'https://github.com/alice',
        linkedinUrl: null,
        verified: true,
        completionScore: 0, // Stale in DB
      };

      const mockPrisma = {
        creatorProfile: {
          findUnique: vi.fn().mockResolvedValue(mockProfile),
          update: vi.fn().mockResolvedValue({ ...mockProfile, completionScore: 100 }),
        },
      };

      const res = await syncCreatorProfileCompletion('u-1', mockPrisma);
      expect(res.percentage).toBe(100);
      expect(res.updated).toBe(true);
      expect(mockPrisma.creatorProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        data: { completionScore: 100 },
      });
    });

    it('does not write to DB if completion score has not changed', async () => {
      const mockProfile = {
        id: 'prof-2',
        userId: 'u-2',
        displayName: 'Bob Dev',
        avatar: null,
        bio: null,
        skills: [],
        portfolio: null,
        githubUrl: null,
        linkedinUrl: null,
        verified: false,
        completionScore: 10, // Display name only = 10%
      };

      const mockPrisma = {
        creatorProfile: {
          findUnique: vi.fn().mockResolvedValue(mockProfile),
          update: vi.fn(),
        },
      };

      const res = await syncCreatorProfileCompletion('u-2', mockPrisma);
      expect(res.percentage).toBe(10);
      expect(res.updated).toBe(false);
      expect(mockPrisma.creatorProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('checkAndSendProfileNudge', () => {
    it('skips nudge if completion percentage meets or exceeds threshold', async () => {
      const mockPrisma = {
        notification: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
      };

      const completion = computeProfileCompletion({
        displayName: 'Complete User',
        avatar: 'https://example.com/avatar.jpg',
        bio: 'Bio text',
        skills: ['a', 'b', 'c'],
        portfolio: [{ title: 'Item' }],
        githubUrl: 'https://github.com/complete',
      });

      expect(completion.percentage).toBeGreaterThanOrEqual(PROFILE_NUDGE_THRESHOLD);

      const nudge = await checkAndSendProfileNudge('u-complete', completion, mockPrisma);
      expect(nudge.shouldNudge).toBe(false);
      expect(mockPrisma.notification.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('creates a nudge notification when profile is below threshold and no recent nudge exists', async () => {
      const mockPrisma = {
        notification: {
          findFirst: vi.fn().mockResolvedValue(null), // No recent notification
          create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
        },
      };

      const completion = computeProfileCompletion({
        displayName: 'Incomplete User', // 10%
      });

      const nudge = await checkAndSendProfileNudge('u-incomplete', completion, mockPrisma);
      expect(nudge.shouldNudge).toBe(true);
      expect(nudge.notificationId).toBe('notif-1');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-incomplete',
          type: 'profile_nudge',
          title: 'Complete your profile to unlock more opportunities',
          body: expect.stringContaining('10%'),
        }),
      });
    });

    it('respects the 7-day cooldown and does not send duplicate nudge', async () => {
      const mockPrisma = {
        notification: {
          findFirst: vi.fn().mockResolvedValue({ id: 'recent-notif', createdAt: new Date() }),
          create: vi.fn(),
        },
      };

      const completion = computeProfileCompletion({ displayName: 'User' });
      const nudge = await checkAndSendProfileNudge('u-cooldown', completion, mockPrisma);

      expect(nudge.shouldNudge).toBe(false);
      expect(nudge.reason).toBe('Nudge cooldown period active');
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('handleProfileEvent', () => {
    it('handles profile.updated event and coordinates score sync and nudge check', async () => {
      const mockProfile = {
        id: 'prof-3',
        userId: 'u-3',
        displayName: 'Carol',
        avatar: null,
        bio: 'Hello world',
        skills: ['react', 'nextjs', 'tailwind'],
        portfolio: null,
        githubUrl: null,
        linkedinUrl: null,
        verified: false,
        completionScore: 10,
      };

      const mockPrisma = {
        creatorProfile: {
          findUnique: vi.fn().mockResolvedValue(mockProfile),
          update: vi.fn().mockResolvedValue({ ...mockProfile, completionScore: 45 }),
        },
        notification: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'notif-3' }),
        },
      };

      const eventRes = await handleProfileEvent(
        { type: 'profile.updated', userId: 'u-3' },
        mockPrisma,
      );

      expect(eventRes.completion.percentage).toBe(45);
      expect(eventRes.completion.updated).toBe(true);
      expect(eventRes.nudge.shouldNudge).toBe(true);
      expect(eventRes.nudge.notificationId).toBe('notif-3');
    });
  });

  describe('Matching Engine Integration with Profile Completion', () => {
    const bounty: BountyFeatures = {
      id: 'b-react',
      title: 'Full Stack React Application',
      description: 'Build responsive frontend dashboard in React and TypeScript',
      budget: 5000,
      category: 'Development',
      tags: ['react', 'typescript'],
    };

    const baseCreator: CreatorFeatures = {
      profileId: 'c-base',
      userId: 'u-base',
      displayName: 'Dev Name',
      bio: 'Full Stack Developer with React and TypeScript experience',
      discipline: 'Development',
      skills: ['react', 'typescript'],
      rating: 4.8,
      completedProjects: 15,
      acceptingWork: true,
    };

    it('awards higher reputation and overall score to creators with high completionScore', () => {
      const creatorComplete: CreatorFeatures = {
        ...baseCreator,
        profileId: 'c-complete',
        completionScore: 100,
      };

      const creatorIncomplete: CreatorFeatures = {
        ...baseCreator,
        profileId: 'c-incomplete',
        completionScore: 15,
      };

      const breakdownComplete = scoreCreatorBountyPair(bounty, creatorComplete);
      const breakdownIncomplete = scoreCreatorBountyPair(bounty, creatorIncomplete);

      expect(breakdownComplete.components.reputation).toBeGreaterThan(
        breakdownIncomplete.components.reputation,
      );
      expect(breakdownComplete.score).toBeGreaterThan(breakdownIncomplete.score);
      expect(breakdownComplete.components.profileCompletion).toBe(1);
      expect(breakdownIncomplete.components.profileCompletion).toBe(0.15);
      expect(breakdownComplete.reasons).toContain('High profile completeness score');
      expect(breakdownIncomplete.reasons).toContain(
        'Incomplete profile details may affect match ranking',
      );
    });

    it('ranks completed profiles above incomplete profiles when all other metrics are equal', () => {
      const creatorA: CreatorFeatures = {
        ...baseCreator,
        profileId: 'c-a',
        userId: 'u-a',
        completionScore: 95,
      };
      const creatorB: CreatorFeatures = {
        ...baseCreator,
        profileId: 'c-b',
        userId: 'u-b',
        completionScore: 30,
      };

      const ranked = rankCreatorsForBounty(bounty, [creatorB, creatorA], 'control');
      expect(ranked[0].creator.profileId).toBe('c-a');
      expect(ranked[1].creator.profileId).toBe('c-b');
    });
  });

  describe('batchEvaluateProfileNudges', () => {
    it('evaluates batches of incomplete creators and dispatches nudges', async () => {
      const mockCreators = [
        {
          userId: 'u-10',
          displayName: 'Low Completion User 1',
          completionScore: 20,
          skills: [],
        },
        {
          userId: 'u-11',
          displayName: 'Low Completion User 2',
          completionScore: 35,
          skills: ['a'],
        },
      ];

      const mockPrisma = {
        creatorProfile: {
          findMany: vi.fn().mockResolvedValue(mockCreators),
        },
        notification: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'notif-batch' }),
        },
      };

      const result = await batchEvaluateProfileNudges({ limit: 10, threshold: 80 }, mockPrisma);
      expect(result.evaluated).toBe(2);
      expect(result.nudged).toBe(2);
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
    });
  });
});
