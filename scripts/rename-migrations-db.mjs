#!/usr/bin/env node
/**
 * One-shot script to update _prisma_migrations row names after the
 * migration folder rename in issue #1589.
 *
 * Run once against each existing database (staging / production) after
 * deploying the branch that renames the folders.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/rename-migrations-db.mjs
 *
 * The script is idempotent — running it twice will not break anything.
 */

import postgres from 'postgres';

// Map: old migration name → new migration name
const RENAMES = [
  ['20260530_add_escrow_deadlock_prevention',       '20260530100000_add_escrow_deadlock_prevention'],
  ['20260530_add_soroban_sequence_management',      '20260530110000_add_soroban_sequence_management'],
  ['20260624_add_messages_fts',                     '20260624090000_add_messages_fts'],
  ['20260624_add_skill_taxonomy',                   '20260624100000_add_skill_taxonomy'],
  ['20260624_add_testimonials',                     '20260624110000_add_testimonials'],
  ['20260625_add_bounty_templates_gdpr',            '20260625090000_add_bounty_templates_gdpr'],
  ['20260625_add_stellar_corridor_analytics',       '20260625100000_add_stellar_corridor_analytics'],
  ['20260625_add_verification_tiers_feature_flags', '20260625110000_add_verification_tiers_feature_flags'],
  ['20260626_add_user_suspension_tracking',         '20260626090000_add_user_suspension_tracking'],
  ['20260630_bounty_search_view',                   '20260630090000_bounty_search_view'],
  ['20260723_add_kyc_submission',                   '20260723090000_add_kyc_submission'],
  ['20260930_add_project_rich_text',                '20260930090000_add_project_rich_text'],
  ['20261002_balance_user_unique',                  '20261002090000_balance_user_unique'],
  ['20261002_transaction_status',                   '20261002100000_transaction_status'],
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  let updated = 0;
  for (const [oldName, newName] of RENAMES) {
    const result = await sql`
      UPDATE _prisma_migrations
      SET migration_name = ${newName}
      WHERE migration_name = ${oldName}
    `;
    if (result.count > 0) {
      console.log(`  renamed: ${oldName} → ${newName}`);
      updated++;
    }
  }
  console.log(`\nDone. ${updated} row(s) updated.`);
} finally {
  await sql.end();
}
