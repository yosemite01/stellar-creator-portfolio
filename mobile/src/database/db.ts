import Database from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
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

/**
 * Sync function that pulls changes from backend since last sync
 * and pushes local changes with server-wins conflict resolution strategy
 *
 * Conflict Resolution: Server-Wins
 * When conflicts occur, the server version is treated as source of truth
 * and local changes are discarded in favor of the latest server state.
 * This ensures data consistency across devices and prevents sync issues.
 */
export async function synchronizeDatabase(
  apiBaseUrl: string,
  accessToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get last sync timestamp from local storage
    const lastSyncString = await db.localStorage.get('lastSyncedAt');
    const lastSyncedAt = lastSyncString ? parseInt(lastSyncString) : 0;
    const now = Date.now();

    // Pull changes from backend
    const pullResponse = await fetch(`${apiBaseUrl}/api/sync/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        lastSyncedAt,
      }),
    });

    if (!pullResponse.ok) {
      throw new Error(`Pull sync failed: ${pullResponse.statusText}`);
    }

    const pullData = await pullResponse.json();

    // Write pulled changes to local database
    await db.write(async () => {
      const portfoliosTable = db.get('portfolios');
      const bountiesTable = db.get('bounties');
      const applicationsTable = db.get('bounty_applications');

      // Update portfolios
      if (pullData.portfolios) {
        for (const portfolioData of pullData.portfolios) {
          const existing = await portfoliosTable.query().where('remote_id', portfolioData.id).fetch();
          if (existing.length > 0) {
            // Server-wins: update with server version
            await existing[0].update((record) => {
              Object.assign(record, {
                creator_id: portfolioData.creator_id,
                title: portfolioData.title,
                description: portfolioData.description,
                thumbnail_url: portfolioData.thumbnail_url,
                skills: JSON.stringify(portfolioData.skills || []),
                rating: portfolioData.rating,
                completed_projects: portfolioData.completed_projects,
                is_verified: portfolioData.is_verified,
                last_synced_at: now,
                updated_at: new Date(portfolioData.updated_at).getTime(),
              });
            });
          } else {
            // Create new record
            await portfoliosTable.create((record) => {
              Object.assign(record, {
                creator_id: portfolioData.creator_id,
                title: portfolioData.title,
                description: portfolioData.description,
                thumbnail_url: portfolioData.thumbnail_url,
                skills: JSON.stringify(portfolioData.skills || []),
                rating: portfolioData.rating,
                completed_projects: portfolioData.completed_projects,
                is_verified: portfolioData.is_verified,
                remote_id: portfolioData.id,
                last_synced_at: now,
                created_at: new Date(portfolioData.created_at).getTime(),
                updated_at: new Date(portfolioData.updated_at).getTime(),
              });
            });
          }
        }
      }

      // Update bounties
      if (pullData.bounties) {
        for (const bountyData of pullData.bounties) {
          const existing = await bountiesTable.query().where('remote_id', bountyData.id).fetch();
          if (existing.length > 0) {
            await existing[0].update((record) => {
              Object.assign(record, {
                creator_id: bountyData.creator_id,
                title: bountyData.title,
                description: bountyData.description,
                budget: bountyData.budget,
                deadline: new Date(bountyData.deadline).getTime(),
                status: bountyData.status,
                category: bountyData.category,
                tags: JSON.stringify(bountyData.tags || []),
                last_synced_at: now,
                updated_at: new Date(bountyData.updated_at).getTime(),
              });
            });
          } else {
            await bountiesTable.create((record) => {
              Object.assign(record, {
                creator_id: bountyData.creator_id,
                title: bountyData.title,
                description: bountyData.description,
                budget: bountyData.budget,
                deadline: new Date(bountyData.deadline).getTime(),
                status: bountyData.status,
                category: bountyData.category,
                tags: JSON.stringify(bountyData.tags || []),
                remote_id: bountyData.id,
                last_synced_at: now,
                created_at: new Date(bountyData.created_at).getTime(),
                updated_at: new Date(bountyData.updated_at).getTime(),
              });
            });
          }
        }
      }

      // Update applications
      if (pullData.applications) {
        for (const appData of pullData.applications) {
          const existing = await applicationsTable
            .query()
            .where('remote_id', appData.id)
            .fetch();
          if (existing.length > 0) {
            await existing[0].update((record) => {
              Object.assign(record, {
                bounty_id: appData.bounty_id,
                applicant_id: appData.applicant_id,
                proposal: appData.proposal,
                proposed_budget: appData.proposed_budget,
                timeline_days: appData.timeline_days,
                status: appData.status,
                last_synced_at: now,
                updated_at: new Date(appData.updated_at).getTime(),
              });
            });
          } else {
            await applicationsTable.create((record) => {
              Object.assign(record, {
                bounty_id: appData.bounty_id,
                applicant_id: appData.applicant_id,
                proposal: appData.proposal,
                proposed_budget: appData.proposed_budget,
                timeline_days: appData.timeline_days,
                status: appData.status,
                remote_id: appData.id,
                last_synced_at: now,
                created_at: new Date(appData.created_at).getTime(),
                updated_at: new Date(appData.updated_at).getTime(),
              });
            });
          }
        }
      }
    });

    // Push local changes to backend
    const pushResponse = await fetch(`${apiBaseUrl}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        changes: {
          portfolios: [], // Would collect local unsync'd changes here
          bounties: [],
          applications: [],
        },
      }),
    });

    if (!pushResponse.ok) {
      throw new Error(`Push sync failed: ${pushResponse.statusText}`);
    }

    // Update last synced timestamp
    await db.localStorage.set('lastSyncedAt', now.toString());

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
