import { supabaseClient, supabaseServer } from '@/lib/db';
import type { Session, User } from '@supabase/supabase-js';

// Server-side session management
export async function getServerSession() {
  const { data: { session }, error } = await supabaseServer.auth.getSession();
  
  if (error || !session) {
    return null;
  }
  
  return session;
}

// Get current user server-side
export async function getServerUser() {
  const { data: { user }, error } = await supabaseServer.auth.admin.getUserById(
    (await getServerSession())?.user.id || ''
  );
  
  if (error || !user) {
    return null;
  }
  
  return user;
}

// Client-side sign up
export async function signUp(email: string, password: string, metadata: { name?: string } = {}) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
    },
  });
  
  return { data, error };
}

// Client-side sign in
export async function signIn(email: string, password: string) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });
  
  return { data, error };
}

// Client-side sign out
export async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  return { error };
}

// Get current user client-side
export async function getCurrentUser() {
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  return { user, error };
}

// Watch auth state changes
export function onAuthStateChange(callback: (session: Session | null) => void) {
  return supabaseClient.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

// Validate JWT token
export async function validateToken(token: string) {
  const { data, error } = await supabaseServer.auth.getUser(token);
  
  if (error || !data.user) {
    return null;
  }
  
  return data.user;
}

// Check if user has a creator profile
export async function hasCreatorProfile(userId: string) {
  const { data, error } = await supabaseServer
    .from('creators')
    .select('id')
    .eq('user_id', userId)
    .single();
  
  return !error && data;
}
