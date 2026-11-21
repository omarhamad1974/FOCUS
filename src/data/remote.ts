import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, online } from '../config';
import { registrationOf, remoteStatus } from '../domain/tournament';
import type { Tournament } from '../domain/types';
import { loginEmail, mobileOfEmail, type PlayerRow } from '../domain/mobile';

export type Role = 'player' | 'organizer' | 'admin';

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  birth_year: number | null;
  club: string | null;
  role: Role;
  is_organizer?: boolean;
  is_seller?: boolean;
  is_trainer?: boolean;
  bio?: string | null;
  avatar_url?: string | null;
  gender?: Gender | null;
  /** Still on the starting password "pingo123" (migration 0014). */
  must_change_password?: boolean;
}

export type Gender = 'male' | 'female';

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
  /** The username: the player's mobile number. */
  mobile: string;
  password: string;
  full_name: string;
  birth_year: string;
  club: string;
  /** 'male' or 'female': picks the default avatar. */
  gender: string;
  /** Roles the person asks for at sign-up, comma separated. */
  wants?: string;
}

/** A new account that signs in with its mobile number (no email, no SMS), then signed in. */
export async function signUp(input: SignUpInput): Promise<void> {
  await adminUsers<{ ok: true }>({ action: 'signup', ...input });
  await signIn(input.mobile, input.password);
}

/** Sign in with a mobile number (or, for older accounts, an email). */
export async function signIn(identifier: string, password: string): Promise<void> {
  const email = loginEmail(identifier);
  if (!email) throw new Error('bad mobile');
  const res = await db().auth.signInWithPassword({ email, password });
  if (res.error) throw new Error(res.error.message);
}

/** The mobile the signed-in account uses as its username, or null when it signs in with an email. */
export async function myLoginMobile(): Promise<string | null> {
  const s = await getSession();
  return mobileOfEmail(s?.user.email);
}

/** The signed-in user picks a new password; the "change your password" reminder stops. */
export async function changePassword(password: string): Promise<void> {
  const res = await db().auth.updateUser({ password });
  if (res.error) throw new Error(res.error.message);
  check(await db().rpc('password_changed'));
}

/** Change the mobile an account signs in with (your own; the admin: anyone's). */
export const setMobile = (mobile: string, userId?: string) =>
  adminUsers<{ ok: true }>({ action: 'set_mobile', mobile, ...(userId ? { user_id: userId } : {}) });

/** Admin: the account's password goes back to "pingo123" and the player is asked to change it. */
export const resetToDefaultPassword = (userId: string) => adminUsers<{ ok: true }>({ action: 'reset_password', user_id: userId });

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

export async function updateProfile(id: string, p: Partial<Pick<Profile, 'full_name' | 'phone' | 'birth_year' | 'club' | 'bio' | 'avatar_url' | 'gender'>>): Promise<void> {
  const res = await db().from('profiles').update(p).eq('id', id);
  // Before migration 0007 is run there is no gender column: save the rest.
  if (res.error && 'gender' in p && /gender/.test(res.error.message)) {
    const { gender: _skip, ...rest } = p;
    if (Object.keys(rest).length) check(await db().from('profiles').update(rest).eq('id', id));
    return;
  }
  check(res);
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

/** Assistants save results through a database function that only lets match results change. */
export async function assistantSaveTournament(t: Tournament): Promise<void> {
  const { organizerId: _ignored, ...state } = t;
  check(await db().rpc('assistant_save_state', { t: t.id, new_state: state, new_status: remoteStatus(t) }));
}

export async function deleteTournament(id: string): Promise<void> {
  check(await db().from('tournaments').delete().eq('id', id));
}

export async function deleteTournaments(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) check(await db().from('tournaments').delete().in('id', ids.slice(i, i + 100)));
}

/* ---------------------------------------------------------- registrations */

async function withNames(regs: Registration[]): Promise<Registration[]> {
  const ids = [...new Set(regs.map((r) => r.player_id))];
  if (!ids.length) return regs;
  const people = check(await db().from('player_directory').select('profile_id, full_name, club').in('profile_id', ids)) as { profile_id: string; full_name: string; club: string | null }[];
  const byId = new Map(people.map((p) => [p.profile_id, p]));
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

/* ------------------------------------------------------- player directory */

export interface DirPlayer {
  id: string;
  full_name: string;
  phone: string | null;
  club: string | null;
  birth_year: number | null;
  profile_id: string | null;
  merged_into: string | null;
  /** Personal code the player uses to take over this profile (migration 0008). */
  claim_code?: string | null;
  gender?: Gender | null;
}

export async function listPlayers(): Promise<DirPlayer[]> {
  const rows = check(await db().from('players').select('*').order('full_name')) as DirPlayer[];
  return rows.filter((r) => !r.merged_into);
}

export async function addPlayer(p: { full_name: string; phone?: string | null; club?: string | null; birth_year?: number | null }): Promise<DirPlayer> {
  return check(await db().from('players').insert(p).select('*').single()) as DirPlayer;
}

export async function updatePlayer(id: string, p: Partial<Pick<DirPlayer, 'full_name' | 'phone' | 'club' | 'birth_year'>>): Promise<void> {
  check(await db().from('players').update(p).eq('id', id));
}

export async function playerForProfile(profileId: string): Promise<string> {
  return check(await db().rpc('player_for_profile', { p: profileId })) as string;
}

export async function linkPlayer(playerId: string, profileId: string): Promise<void> {
  check(await db().rpc('link_player', { player: playerId, account: profileId }));
}

/* ------------------------------------------------ batch entry and claim codes */

/** How a name + mobile row was handled. */
export type AddKind = 'new' | 'account' | 'bad_mobile' | 'failed';

export interface AddedPlayer {
  full_name: string;
  mobile: string;
  /** Account id; null when it could not be made. */
  id: string | null;
  /** Directory row (players.id) of that account. */
  player_id: string | null;
  kind: AddKind;
  error?: string;
}

/**
 * Accounts for name + mobile rows: each new mobile signs in with password "pingo123"; a mobile that
 * already has an account reuses it. Organizers one row at a time, the admin any number and a
 * tournament's waiting list (Edge Function admin-users, action 'players').
 */
export const addPlayers = (rows: (PlayerRow & { directory_id?: string; photo?: string })[], tournament_id: string | null = null) =>
  adminUsers<{ rows: AddedPlayer[]; waitlisted: number }>({ action: 'players', rows, tournament_id });

/** Temporary accounts and their claim codes (admin). */
export async function tempAccounts(): Promise<{ id: string; claim_code: string | null }[]> {
  return check(await db().from('profiles').select('id, claim_code').eq('is_temp', true).is('merged_into', null)) as { id: string; claim_code: string | null }[];
}

/** A new claim code for one player (the old code stops working). */
export async function renewClaimCode(playerId: string): Promise<string> {
  return check(await db().rpc('renew_claim_code', { player: playerId })) as string;
}

export interface ClaimInfo {
  full_name: string;
  club: string | null;
  gender: Gender | null;
  tournaments: number;
}

/** Who a claim code belongs to; null when the code is unknown or already used. */
export async function claimInfo(code: string): Promise<ClaimInfo | null> {
  const rows = check(await db().rpc('claim_info', { code })) as ClaimInfo[];
  return rows[0] ?? null;
}

/** Attach the profile behind a code to the signed-in account. */
export async function claimForMe(code: string): Promise<void> {
  check(await db().rpc('claim_player', { code }));
}

/* ------------------------------------------- accounts (Edge Function) */

export interface PendingUser {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

async function adminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke('admin-users', { body });
  if (error) {
    // Surface the function's own message when it sent one.
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    try { if (ctx) msg = (await ctx.json()).error ?? msg; } catch { /* keep message */ }
    throw new Error(msg);
  }
  return data as T;
}

export const unconfirmedUsers = () => adminUsers<{ users: PendingUser[] }>({ action: 'unconfirmed' }).then((r) => r.users ?? []);
export const confirmUser = (userId: string) => adminUsers<{ ok: true }>({ action: 'confirm', user_id: userId });
export const createAccount = (a: { mobile: string; password: string; full_name: string; club: string; birth_year: string; roles?: string[] }) =>
  adminUsers<{ id: string }>({ action: 'create', ...a });
/** Admins only: deletes the accounts (never admins or yourself). Their tournaments and articles move to you. */
export const deleteAccounts = (userIds: string[]) =>
  adminUsers<{ deleted: number; skipped: number; failed: { id: string; error: string }[] }>({ action: 'delete_users', user_ids: userIds });

/** Make an account for the player behind a claim code (no sign-in needed), then sign in. */
export async function claimAccount(a: { code: string; email: string; password: string; gender: string }): Promise<void> {
  await adminUsers<{ ok: true }>({ action: 'claim', ...a });
  await signIn(a.email, a.password);
}

/** Map server error text to an Arabic message key suffix. */
export function errorCode(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/registration closed/i.test(m)) return 'closed';
  if (/tournament full/i.test(m)) return 'full';
  if (/invitation not found/i.test(m)) return 'inviteGone';
  if (/Invalid login credentials/i.test(m)) return 'badLogin';
  if (/mobile already registered/i.test(m)) return 'mobileTaken';
  if (/bad mobile/i.test(m)) return 'badMobile';
  if (/^required$/.test(m)) return 'required';
  if (/same_password|should be different/i.test(m)) return 'samePassword';
  if (/Email not confirmed/i.test(m)) return 'notConfirmed';
  if (/already registered|already been registered/i.test(m)) return 'exists';
  if (/Password should be/i.test(m)) return 'weakPassword';
  if (/row-level security|permission denied|only an admin/i.test(m)) return 'forbidden';
  if (/rate limit|over_email_send_rate_limit|429/i.test(m)) return 'rateLimit';
  if (/admin cannot claim/i.test(m)) return 'claimAdmin';
  if (/claim code not found/i.test(m)) return 'claimCode';
  if (/already claimed/i.test(m)) return 'claimed';
  if (/slot taken/i.test(m)) return 'slotTaken';
  if (/slot passed/i.test(m)) return 'slotPassed';
  if (/own slot|own product/i.test(m)) return 'own';
  if (/out of stock|product unavailable/i.test(m)) return 'outOfStock';
  if (/order closed/i.test(m)) return 'orderClosed';
  if (/Bucket not found|mime type|exceeded the maximum allowed size|payload too large/i.test(m)) return 'upload';
  if (/not authorized|Error sending confirmation/i.test(m)) return 'emailSend';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'network';
  if (/Failed to send a request|FunctionsFetchError|404/i.test(m)) return 'noFunction';
  if (/already been registered|already exists/i.test(m)) return 'exists';
  return 'unknown';
}
