// Supabase Edge Function: account actions that need the service-role key.
// Only signed-in organizers and admins may call it; the key never leaves Supabase.
//
// POST JSON { action: 'unconfirmed' }                      -> { users: [{ id, email, full_name, created_at }] }
// POST JSON { action: 'confirm', user_id }                 -> { ok: true }
// POST JSON { action: 'create', email, password, full_name, phone?, club?, birth_year?, roles? } -> { id }
//   roles: ['organizer' | 'seller' | 'trainer' | 'hall'], admins only.
// POST JSON { action: 'claim', code, email, password, gender? } -> { ok: true }
//   Anyone holding a player's claim code (made by batch entry, migration 0008): creates a
//   ready-to-use account for that player and attaches their directory row and results.
// POST JSON { action: 'signup', full_name, mobile, password, gender?, club?, birth_year?, wants? } -> { ok: true }
//   Anyone: a new account that signs in with its mobile number (migration 0014). No SMS, no email.
// POST JSON { action: 'players', rows: [{ full_name, mobile, club?, gender?, birth_year?, directory_id?, photo? }], tournament_id? }
//   -> { rows: [...], waitlisted }   organizers one row at a time, the admin any number and a waiting list.
//   Each new mobile gets an account with the password "pingo123" (changed by the player at first sign-in);
//   a mobile that already has an account reuses it.
// POST JSON { action: 'set_mobile', user_id?, mobile } -> { ok: true }
//   Change the mobile an account signs in with: your own, or anyone's for the admin.
// POST JSON { action: 'reset_password', user_id } -> { ok: true }   admins only: password back to "pingo123".
// POST JSON { action: 'delete_users', user_ids: [...] }   -> { deleted, skipped }   admins only.
//   Admin accounts and the caller's own account are never deleted. Tournaments and
//   articles of a deleted account move to the calling admin so they are not lost.
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// to every Edge Function automatically by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // A player claiming their profile: no session needed, the personal code is the proof.
  if (body.action === 'claim') return claim(service, body);
  // A new player signing themselves up with their mobile number.
  if (body.action === 'signup') return signup(service, body);

  // Who is calling? Verify their session token, then their role.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await service.auth.getUser(token);
  if (!caller?.user) return json({ error: 'not signed in' }, 401);
  const { data: me } = await service.from('profiles').select('role, is_organizer').eq('id', caller.user.id).maybeSingle();
  const isAdmin = me?.role === 'admin';

  // Anyone signed in may change the mobile they sign in with; the admin may change anyone's.
  if (body.action === 'set_mobile') {
    const target = String(body.user_id ?? '') || caller.user.id;
    if (target !== caller.user.id && !isAdmin) return json({ error: 'only an admin' }, 403);
    return setMobile(service, target, body.mobile, target === caller.user.id);
  }
  if (!me || !(isAdmin || me.role === 'organizer' || me.is_organizer)) return json({ error: 'only organizers' }, 403);

  if (body.action === 'unconfirmed') {
    const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return json({ error: error.message }, 500);
    const users = data.users
      .filter((u) => !u.email_confirmed_at)
      .map((u) => ({ id: u.id, email: u.email, full_name: u.user_metadata?.full_name ?? '', created_at: u.created_at }));
    return json({ users });
  }

  if (body.action === 'confirm') {
    const id = String(body.user_id ?? '');
    if (!id) return json({ error: 'user_id required' }, 400);
    const { error } = await service.auth.admin.updateUserById(id, { email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === 'create') {
    // One account made by an organizer or the admin. With a mobile it signs in with the mobile
    // (password "pingo123" unless one is given); an email still works for staff accounts.
    const full_name = String(body.full_name ?? '').trim();
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '').trim();
    if (!full_name) return json({ error: 'full_name required' }, 400);
    if (password && password !== DEFAULT_PASSWORD && password.length < 6) return json({ error: 'Password should be at least 6 characters' }, 400);
    const roles = Array.isArray(body.roles) ? body.roles.map(String) : [];
    let id: string | undefined;
    if (body.mobile) {
      try {
        const r = await addPlayers(service, [{ full_name, mobile: body.mobile, club: body.club, birth_year: body.birth_year, gender: body.gender }], password && password !== DEFAULT_PASSWORD ? password : '');
        const row = r[0];
        if (row.kind === 'bad_mobile') return json({ error: 'bad mobile' }, 400);
        if (row.kind === 'account') return json({ error: 'mobile already registered' }, 400);
        if (!row.id) return json({ error: row.error ?? 'could not create account' }, 400);
        id = row.id;
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    } else {
      if (!email || password.length < 6) return json({ error: 'mobile required' }, 400);
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name, phone: String(body.phone ?? ''), club: String(body.club ?? ''), birth_year: String(body.birth_year ?? '') },
      });
      if (error) return json({ error: error.message }, 400);
      id = data.user?.id;
    }
    if (roles.length && id) {
      if (!isAdmin) return json({ id, warning: 'only an admin can give roles' });
      await service.from('profiles').update({
        is_organizer: roles.includes('organizer'),
        is_seller: roles.includes('seller'),
        is_trainer: roles.includes('trainer'),
        is_hall: roles.includes('hall'),
      }).eq('id', id);
    }
    return json({ id });
  }

  if (body.action === 'players') {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return json({ error: 'rows required' }, 400);
    if (rows.length > 300) return json({ error: 'too many players' }, 400);
    const tournament = String(body.tournament_id ?? '').trim() || null;
    if (!isAdmin && (rows.length > 1 || tournament)) return json({ error: 'only an admin' }, 403);
    try {
      const out = await addPlayers(service, rows, '');
      let waitlisted = 0;
      if (tournament) {
        const ids = out.filter((r) => r.id).map((r) => r.id);
        const { data: n, error: wErr } = await service.rpc('waitlist_add', { t: tournament, accounts: ids });
        if (wErr) throw new Error(`waiting list: ${wErr.message}`);
        waitlisted = n ?? 0;
      }
      return json({ rows: out, waitlisted });
    } catch (e) {
      return json({ error: `players failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }
  }

  if (body.action === 'reset_password') {
    if (!isAdmin) return json({ error: 'only an admin' }, 403);
    const id = String(body.user_id ?? '');
    if (!id) return json({ error: 'user_id required' }, 400);
    const { error } = await service.rpc('reset_default_password', { account: id });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === 'delete_users') {
    if (!isAdmin) return json({ error: 'only an admin can delete accounts' }, 403);
    try {
      return json(await deleteUsers(service, caller.user.id, body.user_ids));
    } catch (e) {
      // Always answer with a readable reason so the admin screen can show it.
      return json({ error: `delete failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }
  }

  return json({ error: 'unknown action' }, 400);
});

// deno-lint-ignore no-explicit-any
async function claim(service: any, body: Record<string, unknown>): Promise<Response> {
  const code = String(body.code ?? '');
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  const gender = ['male', 'female'].includes(String(body.gender)) ? String(body.gender) : '';
  if (!code || !email || password.length < 6) return json({ error: 'code, email and password (6+) required' }, 400);

  // A temporary account (admin batch, 0011): the same account gets the player's email and password.
  const { data: tempId, error: tempErr } = await service.rpc('temp_account_for', { code });
  if (tempErr && !/temp_account_for/.test(tempErr.message)) return json({ error: tempErr.message }, 500);
  if (tempId) {
    const { data: prof } = await service.from('profiles').select('full_name, club, gender').eq('id', tempId).maybeSingle();
    const { error } = await service.auth.admin.updateUserById(tempId, {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: prof?.full_name ?? '', club: prof?.club ?? '', gender: gender || prof?.gender || '', temp: false },
    });
    if (error) return json({ error: error.message }, 400);
    const { error: finErr } = await service.rpc('finish_temp_account', { account: tempId, gender: gender || null });
    if (finErr) return json({ error: finErr.message }, 500);
    return json({ ok: true });
  }

  const { data: info, error: infoErr } = await service.rpc('claim_info', { code });
  if (infoErr) return json({ error: infoErr.message }, 500);
  const player = Array.isArray(info) ? info[0] : null;
  if (!player) return json({ error: 'claim code not found' }, 404);

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: player.full_name, club: player.club ?? '', gender: gender || player.gender || '' },
  });
  if (error || !data.user) return json({ error: error?.message ?? 'could not create account' }, 400);

  const { error: claimErr } = await service.rpc('claim_player_for', { code, account: data.user.id });
  if (claimErr) {
    // Someone used the code at the same moment: undo the new account.
    await service.auth.admin.deleteUser(data.user.id);
    return json({ error: claimErr.message }, 409);
  }
  return json({ ok: true });
}

// deno-lint-ignore no-explicit-any
async function deleteUsers(service: any, adminId: string, raw: unknown) {
  const asked = Array.isArray(raw) ? [...new Set(raw.map(String))].filter(Boolean) : [];
  if (!asked.length) throw new Error('user_ids required');
  if (asked.length > 200) throw new Error('too many at once');
  const { data: rows, error: readErr } = await service.from('profiles').select('id, role').in('id', asked);
  if (readErr) throw new Error(`read profiles: ${readErr.message}`);
  const found = new Set((rows ?? []).map((r: { id: string }) => r.id));
  const ids = (rows ?? []).filter((r: { id: string; role: string }) => r.role !== 'admin' && r.id !== adminId).map((r: { id: string }) => r.id);
  if (ids.length) {
    // Keep tournaments and articles: they move to the admin who deletes the accounts.
    const t = await service.from('tournaments').update({ organizer_id: adminId }).in('organizer_id', ids);
    if (t.error) throw new Error(`move tournaments: ${t.error.message}`);
    const p = await service.from('posts').update({ author_id: adminId }).in('author_id', ids);
    if (p.error) throw new Error(`move articles: ${p.error.message}`);
  }
  let deleted = 0;
  const failed: { id: string; error: string }[] = [];
  // A few at a time keeps the call short without hitting the auth API too hard.
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async (id: string) => {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) failed.push({ id, error: error.message });
      else deleted++;
    }));
  }
  // Ids with no profile (already deleted) count as done, admins and yourself as skipped.
  const gone = asked.filter((id) => !found.has(id)).length;
  return { deleted: deleted + gone, skipped: asked.length - ids.length - gone, failed };
}

/* ------------------------------------------------- mobile number as username */
// Same rules as src/domain/mobile.ts and public.norm_mobile (migration 0014).

const MOBILE_DOMAIN = 'phone.pingo.example';
const DEFAULT_PASSWORD = 'pingo123';

function normalizeMobile(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim();
  if (!s || /[a-z@]/i.test(s)) return null;
  s = s.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/\D/.test(s)) return null;
  if (/^201[0-9]{9}$/.test(s)) s = '0' + s.slice(2);
  else if (/^1[0-9]{9}$/.test(s)) s = '0' + s;
  if (s.length < 8 || s.length > 15) return null;
  return s;
}
const mobileEmail = (m: string) => `${m}@${MOBILE_DOMAIN}`;
const text = (v: unknown, max = 80) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const genderOf = (v: unknown) => (['male', 'female'].includes(String(v)) ? String(v) : '');
const yearOf = (v: unknown) => { const y = Number(String(v ?? '').replace(/\D/g, '')); return y >= 1920 && y <= 2025 ? y : null; };

// deno-lint-ignore no-explicit-any
async function signup(service: any, body: Record<string, unknown>): Promise<Response> {
  const full_name = text(body.full_name);
  const mobile = normalizeMobile(body.mobile);
  const password = String(body.password ?? '');
  if (!full_name) return json({ error: 'full_name required' }, 400);
  if (!mobile) return json({ error: 'bad mobile' }, 400);
  if (password.length < 6) return json({ error: 'Password should be at least 6 characters' }, 400);
  const { data: existing, error: exErr } = await service.rpc('account_by_mobile', { m: mobile });
  if (exErr) return json({ error: exErr.message }, 500);
  if (existing) return json({ error: 'mobile already registered' }, 400);
  const year = yearOf(body.birth_year);
  const { error } = await service.auth.admin.createUser({
    email: mobileEmail(mobile),
    password,
    email_confirm: true,
    user_metadata: {
      full_name, phone: mobile, club: text(body.club), gender: genderOf(body.gender),
      birth_year: year ? String(year) : '', wants: text(body.wants, 60),
    },
  });
  if (error) return json({ error: /already/i.test(error.message) ? 'mobile already registered' : error.message }, 400);
  return json({ ok: true });
}

interface PlayerOut { full_name: string; mobile: string; id: string | null; player_id: string | null; kind: 'new' | 'account' | 'bad_mobile' | 'failed'; error?: string }

/** New accounts for name + mobile rows (password "pingo123", or `password` when given); existing mobiles reuse their account. */
// deno-lint-ignore no-explicit-any
async function addPlayers(service: any, raw: unknown[], password: string): Promise<PlayerOut[]> {
  const seen = new Set<string>();
  const out: PlayerOut[] = [];
  const todo: { out: PlayerOut; club: string; gender: string; year: number | null; directory: string | null; photo: string | null }[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const full_name = text(r?.full_name);
    const mobile = normalizeMobile(r?.mobile);
    const o: PlayerOut = { full_name, mobile: mobile ?? text(r?.mobile, 30), id: null, player_id: null, kind: 'bad_mobile' };
    out.push(o);
    if (!full_name || !mobile || seen.has(mobile)) continue;
    seen.add(mobile);
    todo.push({ out: o, club: text(r.club), gender: genderOf(r.gender), year: yearOf(r.birth_year), directory: text(r.directory_id, 40) || null,
      // Simulation: one of the demo portraits shipped with the app (public/demo/players).
      photo: /^demo\/players\/sp-\d{2}\.jpg$/.test(String(r.photo ?? '')) ? String(r.photo) : null });
  }
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (x) => {
      const o = x.out;
      const { data: existing, error: exErr } = await service.rpc('account_by_mobile', { m: o.mobile });
      if (exErr) { o.kind = 'failed'; o.error = exErr.message; return; }
      if (existing) {
        o.kind = 'account'; o.id = existing;
        const { data: pl } = await service.from('players').select('id').eq('profile_id', existing).maybeSingle();
        o.player_id = pl?.id ?? null;
        return;
      }
      const { data, error } = await service.auth.admin.createUser({
        email: mobileEmail(o.mobile),
        password: password || crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: o.full_name, phone: o.mobile, club: x.club, gender: x.gender, birth_year: x.year ? String(x.year) : '' },
      });
      if (error || !data.user) { o.kind = 'failed'; o.error = error?.message; return; }
      const { data: playerId, error: sErr } = await service.rpc('setup_mobile_player', {
        account: data.user.id, mobile: o.mobile, club: x.club || null, gender: x.gender || null,
        birth_year: x.year, directory: x.directory, default_password: !password,
      });
      if (sErr) { await service.auth.admin.deleteUser(data.user.id); o.kind = 'failed'; o.error = sErr.message; return; }
      if (x.photo) await service.from('profiles').update({ avatar_url: x.photo }).eq('id', data.user.id);
      o.kind = 'new'; o.id = data.user.id; o.player_id = playerId ?? null;
    }));
  }
  return out;
}

/** Point an account's login at a mobile number. A temporary account (old batch) also gets the password "pingo123". */
// deno-lint-ignore no-explicit-any
async function setMobile(service: any, target: string, raw: unknown, self: boolean): Promise<Response> {
  const mobile = normalizeMobile(raw);
  if (!mobile) return json({ error: 'bad mobile' }, 400);
  const { data: existing, error: exErr } = await service.rpc('account_by_mobile', { m: mobile });
  if (exErr) return json({ error: exErr.message }, 500);
  if (existing && existing !== target) return json({ error: 'mobile already registered' }, 400);
  const { data: prof } = await service.from('profiles').select('is_temp').eq('id', target).maybeSingle();
  if (!prof) return json({ error: 'account not found' }, 404);
  const { error } = await service.auth.admin.updateUserById(target, { email: mobileEmail(mobile), email_confirm: true });
  if (error) return json({ error: /already/i.test(error.message) ? 'mobile already registered' : error.message }, 400);
  const { error: sErr } = await service.rpc('setup_mobile_player', {
    account: target, mobile, club: null, gender: null, birth_year: null, directory: null,
    default_password: !self && !!prof.is_temp,
  });
  if (sErr) return json({ error: sErr.message }, 500);
  return json({ ok: true });
}
