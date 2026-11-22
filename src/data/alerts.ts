/** Notifications (migration 0020): the bell's alerts, per-type settings, phone push devices and followed shops. */
import { db } from './remote';

export const KINDS = ['invites', 'entries', 'results', 'payments', 'bookings', 'orders', 'promos',
  'requests', 'capacity', 'products', 'roles'] as const;
export type AlertKind = (typeof KINDS)[number];

export interface Alert {
  id: string;
  kind: AlertKind;
  key: string | null;
  icon: string | null;
  title: string;
  body: string | null;
  link: string | null;
  count: number;
  read_at: string | null;
  created_at: string;
}

export interface Prefs { app_off: AlertKind[]; push_off: AlertKind[] }

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** True when the database has no notifications yet (migration 0020 not applied). */
export const isMissing = (e: unknown) => /notifications|schema cache|does not exist|Could not find/i.test(e instanceof Error ? e.message : String(e));

export async function list(limit = 60): Promise<Alert[]> {
  return check(await db().from('notifications').select('*').order('created_at', { ascending: false }).limit(limit)) as Alert[];
}

export async function unread(): Promise<number> {
  return Number(check(await db().rpc('notifications_unread'))) || 0;
}

export async function markRead(ids: string[] | null = null): Promise<void> {
  check(await db().rpc('notifications_read', { ids }));
}

export async function remove(id: string): Promise<void> {
  check(await db().from('notifications').delete().eq('id', id));
}

export async function clearRead(): Promise<void> {
  check(await db().rpc('notifications_clear'));
}

/** Subscription reminders and clean-up; the database does real work at most every few hours. */
export async function refresh(): Promise<void> {
  await db().rpc('notifications_refresh');
}

export async function prefs(): Promise<Prefs> {
  const row = check(await db().from('notification_prefs').select('app_off, push_off').maybeSingle()) as Prefs | null;
  return row ?? { app_off: [], push_off: [] };
}

export async function setPrefs(p: Prefs): Promise<void> {
  check(await db().rpc('set_notification_prefs', { app_off: p.app_off, push_off: p.push_off }));
}

/* ------------------------------------------------------------ phone push */

/** Public VAPID key a device subscribes with (made by the send-push function on first use). */
export async function pushKey(): Promise<string> {
  const { data, error } = await db().functions.invoke('send-push', { body: { action: 'key' } });
  if (error) throw new Error(error.message);
  const key = (data as { key?: string } | null)?.key;
  if (!key) throw new Error('no push key');
  return key;
}

export async function saveDevice(endpoint: string, p256dh: string, auth: string, device: string): Promise<void> {
  check(await db().rpc('save_push_subscription', { ep: endpoint, key_p256dh: p256dh, key_auth: auth, device_name: device }));
}

export async function removeDevice(endpoint: string): Promise<void> {
  check(await db().rpc('remove_push_subscription', { ep: endpoint }));
}

export async function myDevices(): Promise<number> {
  const res = await db().from('push_subscriptions').select('id', { count: 'exact', head: true });
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

/* ------------------------------------------------------------ followed shops */

export async function followedShops(): Promise<string[]> {
  return (check(await db().from('shop_follows').select('shop_id')) as { shop_id: string }[]).map((r) => r.shop_id);
}

export async function follow(shop: string, on: boolean): Promise<void> {
  if (on) check(await db().from('shop_follows').insert({ shop_id: shop }));
  else check(await db().from('shop_follows').delete().eq('shop_id', shop));
}

export async function followers(shop: string): Promise<number> {
  return Number(check(await db().rpc('shop_followers', { s: shop }))) || 0;
}

/* ------------------------------------------------------------ organizer WhatsApp */

export interface Contact { player_id: string; full_name: string; phone: string | null; status: 'pending' | 'approved'; paid: boolean }

export async function tournamentContacts(t: string): Promise<Contact[]> {
  return check(await db().rpc('tournament_contacts', { t })) as Contact[];
}
