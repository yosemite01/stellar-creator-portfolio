import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Client-side Supabase instance
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase instance with service role
export const supabaseServer = createClient(supabaseUrl, supabaseServiceRoleKey);

// Database schemas and types exported here for type safety across the app
export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          name: string;
          avatar_url?: string;
          bio?: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'updated_at'>;
      };
      creators: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          discipline: string;
          tagline: string;
          cover_image?: string;
          skills: string[];
          hourly_rate?: number;
          availability: 'available' | 'limited' | 'unavailable';
          rating: number;
          review_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['creators']['Row'], 'id' | 'created_at' | 'updated_at'>;
      };
      bounties: {
        Row: {
          id: string;
          title: string;
          description: string;
          budget: number;
          currency: string;
          deadline: string;
          difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
          category: string;
          tags: string[];
          status: 'open' | 'in-progress' | 'completed' | 'cancelled';
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['bounties']['Row'], 'id' | 'created_at' | 'updated_at'>;
      };
      bounty_applications: {
        Row: {
          id: string;
          bounty_id: string;
          creator_id: string;
          proposed_budget: number;
          timeline_days: number;
          proposal_text: string;
          status: 'pending' | 'accepted' | 'rejected';
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['bounty_applications']['Row'], 'id' | 'created_at' | 'updated_at'>;
      };
      reviews: {
        Row: {
          id: string;
          creator_id: string;
          reviewer_id: string;
          rating: number;
          text: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['reviews']['Row'], 'id' | 'created_at' | 'updated_at'>;
      };
    };
  };
};

export default supabaseClient;
