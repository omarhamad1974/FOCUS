// Supabase Edge Function: account actions that need the service-role key.
// Only signed-in organizers and admins may call it; the key never leaves Supabase.
//
// POST JSON { action: 'unconfirmed' }                      -> { users: [{ id, email, full_name, created_at }] }
// POST JSON { action: 'confirm', user_id }                 -> { ok: true }
// POST JSON { action: 'create', email, password, full_name, phone?, club?, birth_year? } -> { id }
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

  // Who is calling? Verify their session token, then their role.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await service.auth.getUser(token);
  if (!caller?.user) return json({ error: 'not signed in' }, 401);
  const { data: me } = await service.from('profiles').select('role').eq('id', caller.user.id).maybeSingle();
  if (!me || (me.role !== 'organizer' && me.role !== 'admin')) return json({ error: 'only organizers' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

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
    return json({ id: data.user?.id });
  }

  return json({ error: 'unknown action' }, 400);
});
