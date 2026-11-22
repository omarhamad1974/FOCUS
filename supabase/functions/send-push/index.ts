// Supabase Edge Function: phone notifications (Web Push) for Pingo's alerts (migration 0020).
//
// POST JSON { action: 'key' }  -> { key }   anyone: the public VAPID key a device subscribes with.
//   The first call makes the VAPID key pair and keeps it in public.push_config (service role only),
//   and records this function's own URL there so the database knows where to send. Nothing to set by hand.
// POST JSON { id }  + header x-push-key   -> { sent, gone }
//   Called by the database (pg_net, public.push_dispatch) right after an alert is made: pushes that
//   alert to every device of its person. The key is a secret only the database holds.
//   Devices the push service reports as gone (404/410) are removed.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to every Edge Function automatically.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Push services ask for a contact; the public site address is enough.
const CONTACT = 'https://omarhamad1974.github.io/FOCUS/';

interface Config {
  secret: string;
  endpoint: string | null;
  vapid_public: string | null;
  vapid_keys: webpush.ExportedVapidKeys | null;
}

let server: webpush.ApplicationServer | null = null;

async function config(db: SupabaseClient): Promise<Config> {
  const { data, error } = await db.from('push_config').select('secret, endpoint, vapid_public, vapid_keys').eq('id', 1).single();
  if (error) throw new Error(error.message);
  let cfg = data as Config;
  const endpoint = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`;
  if (!cfg.vapid_keys || cfg.endpoint !== endpoint) {
    const patch: Partial<Config> = { endpoint };
    if (!cfg.vapid_keys) {
      const keys = await webpush.generateVapidKeys({ extractable: true });
      patch.vapid_keys = await webpush.exportVapidKeys(keys);
      patch.vapid_public = await webpush.exportApplicationServerKey(keys);
    }
    // Only fills empty keys, so two first calls at the same moment cannot end with different keys.
    let q = db.from('push_config').update(patch).eq('id', 1);
    if (patch.vapid_keys) q = q.is('vapid_keys', null);
    await q;
    const again = await db.from('push_config').select('secret, endpoint, vapid_public, vapid_keys').eq('id', 1).single();
    cfg = again.data as Config;
  }
  return cfg;
}

async function appServer(cfg: Config): Promise<webpush.ApplicationServer> {
  if (!server) {
    const vapidKeys = await webpush.importVapidKeys(cfg.vapid_keys!, { extractable: false });
    server = await webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys });
  }
  return server;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'bad request' }, 400); }

  try {
    const cfg = await config(db);
    if (body.action === 'key') return json({ key: cfg.vapid_public });

    if (req.headers.get('x-push-key') !== cfg.secret) return json({ error: 'forbidden' }, 403);
    const id = String(body.id ?? '');
    const { data: n } = await db.from('notifications').select('id, user_id, kind, key, icon, title, body, link, count, pushed_at').eq('id', id).maybeSingle();
    if (!n || n.pushed_at) return json({ sent: 0, gone: 0 });
    const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id);
    const app = await appServer(cfg);
    const message = JSON.stringify({
      title: n.count > 1 ? `${n.title} (${n.count})` : n.title,
      body: n.body ?? '',
      link: n.link ?? '#/alerts',
      tag: n.key ?? n.id,
      id: n.id,
    });
    let sent = 0;
    const gone: string[] = [];
    for (const s of subs ?? []) {
      try {
        await app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as webpush.PushSubscription)
          .pushTextMessage(message, { ttl: 86400, urgency: webpush.Urgency.High });
        sent++;
        await db.from('push_subscriptions').update({ last_ok: new Date().toISOString() }).eq('id', s.id);
      } catch (e) {
        if (e instanceof webpush.PushMessageError && (e.isGone() || e.response.status === 404)) gone.push(s.id);
        else console.error('push failed', s.id, e instanceof webpush.PushMessageError ? e.response.status : String(e));
      }
    }
    if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
    await db.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', n.id);
    return json({ sent, gone: gone.length });
  } catch (e) {
    console.error(e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
