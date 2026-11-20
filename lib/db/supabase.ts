/**
 * Supabase Client Configuration
 *
 * NOTE (#1760): Dual data access paths for application tables (users, creators,
 * bounties, applications, reviews) have been unified on Prisma (`@/lib/prisma`).
 *
 * Supabase client is reserved strictly for external auth or bucket storage if configured.
 * All relational entity reads and writes must go through Prisma to ensure ACID guarantees,
 * consistent transaction boundaries, and to prevent RLS bypass or schema desynchronisation.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder_anon_key';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder_service_key';

// Client-side Supabase instance (storage/auth only)
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase instance (storage/admin only)
export const supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey);

// Deprecated: All application tables are now managed through Prisma.
// Retained for type compatibility during deprecation window.
export type DeprecatedDatabase = {
  public: {
    Tables: {
      users: Record<string, unknown>;
      creators: Record<string, unknown>;
      bounties: Record<string, unknown>;
      bounty_applications: Record<string, unknown>;
      reviews: Record<string, unknown>;
    };
  };
};

export type Database = DeprecatedDatabase;
