import { appSchema, tableSchema } from '@nozbe/watermelondb';

// WatermelonDB schema that mirrors remote entities
// Supports offline-first architecture with local data persistence
export const schema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: 'portfolios',
      columns: [
        { name: 'creator_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'thumbnail_url', type: 'string', isOptional: true },
        { name: 'skills', type: 'string' }, // JSON array stored as string
        { name: 'rating', type: 'number' },
        { name: 'completed_projects', type: 'number' },
        { name: 'is_verified', type: 'boolean' },
        { name: 'remote_id', type: 'string', isIndexed: true },
        { name: 'last_synced_at', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'bounties',
      columns: [
        { name: 'creator_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'budget', type: 'number' },
        { name: 'deadline', type: 'number' }, // Unix timestamp
        { name: 'status', type: 'string' }, // OPEN, IN_PROGRESS, COMPLETED, CANCELLED
        { name: 'category', type: 'string', isOptional: true },
        { name: 'tags', type: 'string' }, // JSON array stored as string
        { name: 'remote_id', type: 'string', isIndexed: true },
        { name: 'last_synced_at', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'bounty_applications',
      columns: [
        { name: 'bounty_id', type: 'string', isIndexed: true },
        { name: 'applicant_id', type: 'string', isIndexed: true },
        { name: 'proposal', type: 'string' },
        { name: 'proposed_budget', type: 'number' },
        { name: 'timeline_days', type: 'number' },
        { name: 'status', type: 'string' }, // PENDING, ACCEPTED, REJECTED, WITHDRAWN
        { name: 'remote_id', type: 'string', isIndexed: true },
        { name: 'last_synced_at', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'offline_queue',
      columns: [
        { name: 'remote_id', type: 'string', isIndexed: true },
        { name: 'op_type', type: 'string' },
        { name: 'endpoint', type: 'string' },
        { name: 'payload', type: 'string' },
        { name: 'retries', type: 'number' },
        { name: 'next_retry_at', type: 'number' },
        { name: 'created_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'offline_dead_letter',
      columns: [
        { name: 'remote_id', type: 'string', isIndexed: true },
        { name: 'op_type', type: 'string' },
        { name: 'endpoint', type: 'string' },
        { name: 'payload', type: 'string' },
        { name: 'retries', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'failed_at', type: 'number' },
      ],
    }),
  ],
});
