import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, online } from '../config';
import { registrationOf, remoteStatus } from '../domain/tournament';
import type { Tournament } from '../domain/types';

export type Role = 'player' | 'organizer' | 'admin';

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  birth_year: number | null;
  club: string | null;
  role: Role;
}

export type RegStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface Registration {
  id: string;
  tournament_id: string;
  player_id: string;
  status: RegStatus;
  created_at: string;
  /** Joined from player_directory (or profiles for organizers). */
  full_name?: string;
  club?: string | null;
}

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    if (!online()) throw new Error('offline');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/* ------------------------------------------------------------------- auth */

export async function getSession(): Promise<Session | null> {
  return (await db().auth.getSession()).data.session;
}

export function onAuthChange(cb: () => void): void {
  db().auth.onAuthStateChange(() => cb());
}

export interface SignUpInput {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  birth_year: string;
  club: string;
}

/** Returns true when the account still needs email confirmation. */
export async function signUp(input: SignUpInput): Promise<boolean> {
  const { email, password, ...meta } = input;
  const res = await db().auth.signUp({
    email,
    password,
    options: { data: meta, emailRedirectTo: location.origin + location.pathname },
  });
  if (res.error) throw new Error(res.error.message);
  return !res.data.session;
}

export async function signIn(email: string, password: string): Promise<void> {
  const res = await db().auth.signInWithPassword({ email, password });
  if (res.error) throw new Error(res.error.message);
}

export async function resetPassword(email: string): Promise<void> {
  const res = await db().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (res.error) throw new Error(res.error.message);
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}

/* ---------------------------------------------------------------- profile */

export async function myProfile(): Promise<Profile | null> {
  const s = await getSession();
  if (!s) return null;
  return check(await db().from('profiles').select('*').eq('id', s.user.id).maybeSingle()) as Profile | null;
}

export async function updateProfile(id: string, p: Partial<Pick<Profile, 'full_name' | 'phone' | 'birth_year' | 'club'>>): Promise<void> {
  check(await db().from('profiles').update(p).eq('id', id));
}

export async function listProfiles(): Promise<Profile[]> {
  return check(await db().from('profiles').select('*').order('created_at', { ascending: false })) as Profile[];
}

export async function setRole(id: string, role: Role): Promise<void> {
  check(await db().from('profiles').update({ role }).eq('id', id));
}

/* ------------------------------------------------------------ tournaments */

interface TournamentRow {
  id: string;
  organizer_id: string;
  state: Tournament;
}

export async function listTournaments(): Promise<Tournament[]> {
  const rows = check(await db().from('tournaments').select('id, organizer_id, state').order('created_at', { ascending: false })) as TournamentRow[];
  return rows.map((r) => ({ ...r.state, id: r.id, organizerId: r.organizer_id }));
}

export async function saveTournament(t: Tournament): Promise<void> {
  const reg = registrationOf(t);
  const { organizerId: _ignored, ...state } = t;
  check(await db().from('tournaments').upsert({
    id: t.id,
    name: t.name,
    date: t.date || null,
    status: remoteStatus(t),
    auto_accept: reg.autoAccept,
    max_players: reg.maxPlayers,
    state,
  }));
}

export async function deleteTournament(id: string): Promise<void> {
  check(await db().from('tournaments').delete().eq('id', id));
}

/* ---------------------------------------------------------- registrations */

async function withNames(regs: Registration[]): Promise<Registration[]> {
  const ids = [...new Set(regs.map((r) => r.player_id))];
  if (!ids.length) return regs;
  const people = check(await db().from('player_directory').select('id, full_name, club').in('id', ids)) as { id: string; full_name: string; club: string | null }[];
  const byId = new Map(people.map((p) => [p.id, p]));
  return regs.map((r) => ({ ...r, full_name: byId.get(r.player_id)?.full_name ?? '', club: byId.get(r.player_id)?.club ?? null }));
}

export async function tournamentRegistrations(tournamentId: string): Promise<Registration[]> {
  const regs = check(await db().from('registrations').select('*').eq('tournament_id', tournamentId).order('created_at')) as Registration[];
  return withNames(regs);
}

export async function myRegistrations(): Promise<Registration[]> {
  const s = await getSession();
  if (!s) return [];
  return check(await db().from('registrations').select('*').eq('player_id', s.user.id)) as Registration[];
}

export async function joinTournament(tournamentId: string): Promise<RegStatus> {
  return check(await db().rpc('join_tournament', { t: tournamentId })) as RegStatus;
}

export async function withdraw(tournamentId: string): Promise<void> {
  check(await db().rpc('withdraw_from_tournament', { t: tournamentId }));
}

export async function decide(registrationId: string, status: 'approved' | 'rejected' | 'pending'): Promise<void> {
  check(await db().from('registrations').update({ status, decided_at: new Date().toISOString() }).eq('id', registrationId));
}

/** Map server error text to an Arabic message key suffix. */
export function errorCode(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/registration closed/i.test(m)) return 'closed';
  if (/tournament full/i.test(m)) return 'full';
  if (/Invalid login credentials/i.test(m)) return 'badLogin';
  if (/Email not confirmed/i.test(m)) return 'notConfirmed';
  if (/already registered|already been registered/i.test(m)) return 'exists';
  if (/Password should be/i.test(m)) return 'weakPassword';
  if (/row-level security|permission denied|only an admin/i.test(m)) return 'forbidden';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'network';
  return 'unknown';
}
