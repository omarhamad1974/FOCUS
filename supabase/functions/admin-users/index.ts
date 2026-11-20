// Supabase Edge Function: account actions that need the service-role key.
// Only signed-in organizers and admins may call it; the key never leaves Supabase.
//
// POST JSON { action: 'unconfirmed' }                      -> { users: [{ id, email, full_name, created_at }] }
// POST JSON { action: 'confirm', user_id }                 -> { ok: true }
// POST JSON { action: 'create', email, password, full_name, phone?, club?, birth_year?, roles? } -> { id }
//   roles: ['organizer' | 'seller' | 'trainer'], admins only.
// POST JSON { action: 'claim', code, email, password, gender? } -> { ok: true }
//   Anyone holding a player's claim code (made by batch entry, migration 0008): creates a
//   ready-to-use account for that player and attaches their directory row and results.
// POST JSON { action: 'batch', names: [...], club?, gender?, tournament_id? } -> { rows: [...] }   admins only.
//   Each name without an account gets a temporary account (no real email) with a claim code
//   (migration 0011). With tournament_id, every name is put on that tournament's waiting list.
//   The player completes registration later with action 'claim' on the same account.
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

  // Who is calling? Verify their session token, then their role.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await service.auth.getUser(token);
  if (!caller?.user) return json({ error: 'not signed in' }, 401);
  const { data: me } = await service.from('profiles').select('role, is_organizer').eq('id', caller.user.id).maybeSingle();
  const isAdmin = me?.role === 'admin';
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
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    const full_name = String(body.full_name ?? '').trim();
    if (!email || password.length < 6 || !full_name) return json({ error: 'email, password (6+) and full_name required' }, 400);
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        phone: String(body.phone ?? ''),
        club: String(body.club ?? ''),
        birth_year: String(body.birth_year ?? ''),
      },
    });
    if (error) return json({ error: error.message }, 400);
    const roles = Array.isArray(body.roles) ? body.roles.map(String) : [];
    if (roles.length && data.user) {
      if (!isAdmin) return json({ id: data.user.id, warning: 'only an admin can give roles' });
      await service.from('profiles').update({
        is_organizer: roles.includes('organizer'),
        is_seller: roles.includes('seller'),
        is_trainer: roles.includes('trainer'),
      }).eq('id', data.user.id);
    }
    return json({ id: data.user?.id });
  }

  if (body.action === 'batch') {
    if (!isAdmin) return json({ error: 'only an admin' }, 403);
    try {
      return json(await batch(service, body));
    } catch (e) {
      return json({ error: `batch failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }
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

const TEMP_DOMAIN = 'temp.pingo.example';

// deno-lint-ignore no-explicit-any
async function batch(service: any, body: Record<string, unknown>) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of Array.isArray(body.names) ? body.names : []) {
    const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 80 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  if (!names.length) throw new Error('names required');
  if (names.length > 300) throw new Error('too many names');
  const club = String(body.club ?? '').trim() || null;
  const gender = ['male', 'female'].includes(String(body.gender)) ? String(body.gender) : null;
  const tournament = String(body.tournament_id ?? '').trim() || null;

  const { data: matches, error: mErr } = await service.rpc('batch_match_names', { names });
  if (mErr) throw new Error(`match names: ${mErr.message}`);
  type Row = { name: string; account: string | null; kind: string; claim_code: string | null };
  const rows: Row[] = (matches ?? []).map((m: Row) => ({ ...m }));

  // New temporary accounts, a few at a time.
  const fresh = rows.filter((r) => !r.account);
  for (let i = 0; i < fresh.length; i += 8) {
    await Promise.all(fresh.slice(i, i + 8).map(async (r) => {
      const { data, error } = await service.auth.admin.createUser({
        email: `p-${crypto.randomUUID()}@${TEMP_DOMAIN}`,
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: r.name, club: club ?? '', gender: gender ?? '', temp: true },
      });
      if (error || !data.user) { r.kind = 'failed'; return; }
      const { data: code, error: sErr } = await service.rpc('setup_temp_player', { account: data.user.id, club, gender });
      if (sErr) { await service.auth.admin.deleteUser(data.user.id); r.kind = 'failed'; return; }
      r.account = data.user.id;
      r.claim_code = code;
      r.kind = r.kind === 'many' ? 'new_many' : 'new';
    }));
  }

  let waitlisted = 0;
  if (tournament) {
    const ids = rows.filter((r) => r.account).map((r) => r.account);
    const { data: n, error: wErr } = await service.rpc('waitlist_add', { t: tournament, accounts: ids });
    if (wErr) throw new Error(`waiting list: ${wErr.message}`);
    waitlisted = n ?? 0;
  }
  return {
    waitlisted,
    rows: rows.map((r) => ({ full_name: r.name, id: r.account, kind: r.kind, claim_code: r.claim_code })),
  };
}
