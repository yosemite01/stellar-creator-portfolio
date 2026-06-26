import Database from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { synchronize } from '@nozbe/watermelondb/sync';
import { schema } from './schema';

// SQLiteAdapter configuration for offline persistence
const adapter = new SQLiteAdapter({
  schema,
  dbName: 'stellar-portfolio',
  onSetUpError: (error) => {
    console.error('Database setup error:', error);
  },
});

// Initialize WatermelonDB instance
export const db = new Database({
  adapter,
  modelClasses: [],
});

export interface SyncTimestamp {
  lastSyncedAt: number;
}

export interface SyncChanges {
  bounties?: {
    created?: Record<string, unknown>[];
    updated?: Record<string, unknown>[];
    deleted?: string[];
  };
  applications?: {
    created?: Record<string, unknown>[];
    updated?: Record<string, unknown>[];
    deleted?: string[];
  };
  messages?: {
    created?: Record<string, unknown>[];
    updated?: Record<string, unknown>[];
    deleted?: string[];
  };
}

/**
 * Sync function using WatermelonDB's synchronize() helper.
 * Pulls changes from backend since last sync and pushes local changes.
 *
 * Conflict Resolution: Server-Wins
 * When conflicts occur, the server version is treated as source of truth
 * and local changes are discarded in favor of the latest server state.
 * This ensures data consistency across devices and prevents sync issues.
 *
 * @param apiBaseUrl Base URL for API calls (e.g., "https://api.example.com")
 * @param accessToken Authentication token for API requests
 */
export async function synchronizeDatabase(
  apiBaseUrl: string,
  accessToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await synchronize({
      database: db,
      pullChanges: async ({ lastPulledAt }) => {
        // Fetch changes from backend since last pull
        const response = await fetch(`${apiBaseUrl}/api/sync/pull`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Pull sync failed: ${response.statusText}`);
        }

        // WatermelonDB expects response shape: { changes, timestamp }
        // where timestamp is the server's current time (milliseconds)
        const result = await response.json();
        return result;
      },

      pushChanges: async ({ changes, lastPulledAt }) => {
        // Push local changes to backend
        const response = await fetch(`${apiBaseUrl}/api/sync/push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            changes,
            lastPulledAt,
          }),
        });

        if (!response.ok) {
          throw new Error(`Push sync failed: ${response.statusText}`);
        }
      },
    });

    return { success: true };
  } catch (error) {
    console.error('Sync error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown sync error',
    };
  }
}

/**
 * Get all portfolios from local database
 * Used for offline-first rendering
 */
export async function getPortfolios() {
  const table = db.get('portfolios');
  return await table.query().fetch();
}

/**
 * Get all bounties from local database
 * Used for offline-first rendering
 */
export async function getBounties() {
  const table = db.get('bounties');
  return await table.query().fetch();
}

/**
 * Get bounties by status from local database
 */
export async function getBountiesByStatus(status: string) {
  const table = db.get('bounties');
  return await table.query().where('status', status).fetch();
}
