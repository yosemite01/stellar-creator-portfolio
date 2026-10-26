import { z } from 'zod';

/** Cap from issue #1519. One request must not fan out past this many creators. */
export const MAX_CREATOR_BATCH = 50;

const creatorIdList = z.array(z.string().cuid()).min(1).max(MAX_CREATOR_BATCH);

/**
 * Existing clients send `creatorIds`. `ids` is accepted as the same list so
 * either shape is validated the same way.
 */
const creatorBatchBodySchema = z
  .object({
    creatorIds: creatorIdList.optional(),
    ids: creatorIdList.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.creatorIds && !value.ids) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'creatorIds must be a non-empty array of at most 50 cuids',
      });
    }
  })
  .transform((value) => ({
    creatorIds: (value.creatorIds ?? value.ids) as string[],
  }));

export function parseCreatorBatchBody(
  input: unknown,
): { ok: true; creatorIds: string[] } | { ok: false; error: string } {
  const parsed = creatorBatchBodySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'creatorIds must be 1–50 cuid values' };
  }
  return { ok: true, creatorIds: parsed.data.creatorIds };
}
