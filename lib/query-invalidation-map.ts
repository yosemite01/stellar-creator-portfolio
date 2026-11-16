import type { QueryClient } from '@tanstack/react-query';

export type MutationEvent =
  | 'bounty.create'
  | 'bounty.update'
  | 'bounty.apply'
  | 'bounty.complete'
  | 'projects.create'
  | 'review.submit'
  | 'escrow.fund'
  | 'escrow.release'
  | 'creator.updateProfile'
  | 'template.create'
  | 'template.update';

export interface MutationContext {
  bountyId?: string;
  creatorId?: string;
  applicantId?: string;
  escrowId?: string;
  templateId?: string;
}

/**
 * Standard hierarchical query keys for TanStack Query.
 * Shared across tRPC hooks and REST client functions.
 */
export const queryKeys = {
  all: ['api'] as const,
  creators: {
    all: ['creators'] as const,
    list: (filters?: Record<string, unknown>) => ['creators', 'list', filters] as const,
    detail: (id: string) => ['creators', 'detail', id] as const,
    reputation: (id: string) => ['creators', 'reputation', id] as const,
    reviews: (id: string, filters?: Record<string, unknown>) => ['creators', 'reviews', id, filters] as const,
  },
  freelancers: {
    all: ['freelancers'] as const,
    list: (filters?: Record<string, unknown>) => ['freelancers', 'list', filters] as const,
    detail: (id: string) => ['freelancers', 'detail', id] as const,
  },
  bounties: {
    all: ['bounties'] as const,
    list: (filters?: Record<string, unknown>) => ['bounties', 'list', filters] as const,
    detail: (id: string) => ['bounties', 'detail', id] as const,
  },
  reviews: {
    all: ['reviews'] as const,
    list: (filters?: Record<string, unknown>) => ['reviews', 'list', filters] as const,
  },
  escrow: {
    all: ['escrow'] as const,
    detail: (id: string) => ['escrow', 'detail', id] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: () => ['templates', 'list'] as const,
    detail: (id: string, version?: number) => ['templates', 'detail', id, version] as const,
  },
};

/**
 * Invalidation map defining which dependent query caches must be purged
 * when a given mutation succeeds (Issue #1827).
 */
export const MUTATION_INVALIDATION_MAP: Record<
  MutationEvent,
  (ctx?: MutationContext) => (string | readonly unknown[])[]
> = {
  'bounty.create': () => [
    queryKeys.bounties.all,
    ['bounty'], // tRPC router cache key
    ['dashboard'],
  ],
  'bounty.update': (ctx) => [
    queryKeys.bounties.all,
    ctx?.bountyId ? queryKeys.bounties.detail(ctx.bountyId) : ['bounties'],
    ['bounty'],
  ],
  'bounty.apply': (ctx) => [
    ctx?.bountyId ? queryKeys.bounties.detail(ctx.bountyId) : ['bounties'],
    ['bounty'],
  ],
  'bounty.complete': (ctx) => [
    queryKeys.bounties.all,
    ctx?.bountyId ? queryKeys.bounties.detail(ctx.bountyId) : ['bounties'],
    ['bounty'],
    ['earnings'],
  ],
  'projects.create': (ctx) => [
    queryKeys.creators.all,
    ctx?.creatorId ? queryKeys.creators.detail(ctx.creatorId) : ['creators'],
    queryKeys.bounties.all,
    ['projects'],
  ],
  'review.submit': (ctx) => [
    queryKeys.reviews.all,
    ['reviews'],
    ...(ctx?.creatorId
      ? [
          queryKeys.creators.detail(ctx.creatorId),
          queryKeys.creators.reputation(ctx.creatorId),
          queryKeys.creators.reviews(ctx.creatorId),
        ]
      : [queryKeys.creators.all]),
    ...(ctx?.bountyId ? [queryKeys.bounties.detail(ctx.bountyId)] : []),
  ],
  'escrow.fund': (ctx) => [
    queryKeys.escrow.all,
    ...(ctx?.escrowId ? [queryKeys.escrow.detail(ctx.escrowId)] : []),
    ...(ctx?.bountyId ? [queryKeys.bounties.detail(ctx.bountyId)] : [queryKeys.bounties.all]),
    ['bounty'],
  ],
  'escrow.release': (ctx) => [
    queryKeys.escrow.all,
    ...(ctx?.escrowId ? [queryKeys.escrow.detail(ctx.escrowId)] : []),
    ['bounty'],
    ['earnings'],
  ],
  'creator.updateProfile': (ctx) => [
    queryKeys.creators.all,
    ctx?.creatorId ? queryKeys.creators.detail(ctx.creatorId) : ['creators'],
  ],
  'template.create': () => [
    queryKeys.templates.all,
    ['templates'],
  ],
  'template.update': (ctx) => [
    queryKeys.templates.all,
    ctx?.templateId ? queryKeys.templates.detail(ctx.templateId) : ['templates'],
  ],
};

/**
 * Executes dependent cache invalidation across the shared QueryClient.
 */
export async function invalidateMutationDependencies(
  client: QueryClient,
  mutation: MutationEvent,
  ctx?: MutationContext,
): Promise<void> {
  const getKeys = MUTATION_INVALIDATION_MAP[mutation];
  if (!getKeys) return;

  const targetKeys = getKeys(ctx);
  await Promise.all(
    targetKeys.map((key) =>
      client.invalidateQueries({
        queryKey: Array.isArray(key) ? (key as unknown[]) : [key],
        exact: false,
      }),
    ),
  );
}
