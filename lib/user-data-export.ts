/**
 * GDPR data export payload builder (#1539).
 *
 * Every Prisma model linked to a User (via a `userId` field or a relation to
 * `User`) must appear as a key in the export, even when the user has no rows
 * in it, so a data subject can see which categories of data we hold.
 * `__tests__/data-export.test.ts` compares this list against the generated
 * client's data model and fails when a new user-linked model is added but
 * not listed here.
 */

export const USER_LINKED_MODELS = [
  'Account',
  'AdminSkill',
  'ApiKey',
  'AuditLog',
  'Balance',
  'Bounty',
  'BountyApplication',
  'BountyTemplate',
  'CSPViolation',
  'ClientProfile',
  'CreatorProfile',
  'DisputeEvidence',
  'EmailDeliveryLog',
  'Endorsement',
  'FeatureFlagEvaluation',
  'InAppNotification',
  'KYCSubmission',
  'MatchFeedback',
  'MatchNotification',
  'Message',
  'Notification',
  'NotificationPreference',
  'PinnedFile',
  'Project',
  'PushDeviceToken',
  'PushSubscription',
  'ReviewVote',
  'Sep24Transaction',
  'Session',
  'SkillSynonym',
  'SwapSession',
  'Team',
  'TeamMember',
  'Testimonial',
  'ThreadMember',
  'Transaction',
  'VerificationToken',
] as const;

export type UserLinkedModel = (typeof USER_LINKED_MODELS)[number];

type AnyRecord = Record<string, unknown>;

/** Field names that must never leave the system, regardless of model. */
const SENSITIVE_FIELD_PATTERN =
  /(password|hash|secret|token|seed|privatekey|apikey|keyencrypted|encryptedkey)/i;

export interface UserDataExportInput {
  userId: string;
  /** Rows per model, already scoped to the user by the caller. */
  records: Partial<Record<string, AnyRecord[]>>;
  exportedAt?: Date;
}

export type UserDataExport = {
  userId: string;
  exportedAt: string;
} & Record<UserLinkedModel, AnyRecord[]>;

function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const clean: AnyRecord = {};
    for (const [key, inner] of Object.entries(value as AnyRecord)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
      clean[key] = stripSensitive(inner);
    }
    return clean;
  }
  return value;
}

/**
 * Builds the export payload: one key per user-linked model (empty array when
 * the user has no rows), with secret/hash/token fields removed recursively.
 */
export function buildUserDataExport(input: UserDataExportInput): UserDataExport {
  const payload = {
    userId: input.userId,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
  } as UserDataExport;

  for (const model of USER_LINKED_MODELS) {
    const rows = input.records[model] ?? [];
    payload[model] = rows.map((row) => stripSensitive(row) as AnyRecord);
  }

  return payload;
}
