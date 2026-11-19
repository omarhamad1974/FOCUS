/**
 * Supabase connection. The anon key is public by design: Row Level Security
 * in supabase/migrations decides what each user may read and change.
 * Leave both empty to run fully offline with browser storage.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const online = (): boolean => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
