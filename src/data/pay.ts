/**
 * Payments between players and providers (organizer, trainer, seller, hall owner), migration 0017.
 * - Provider settings: accepted methods (wallet numbers and/or cash), WhatsApp, cancel deadline.
 * - A payment row per thing paid for. The payer sends "wallet + receipt" or "cash on the spot";
 *   the provider approves (with or without a receipt) or rejects. Approving ticks "paid".
 * No money moves through the app.
 */
import { db, getSession } from './remote';
import { chunks } from './content';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export type PayKind = 'tournament' | 'training' | 'hall' | 'order';
export type WalletKind = 'vodafone' | 'instapay' | 'fawry' | 'etisalat' | 'orange' | 'we' | 'other';
export const WALLET_KINDS: WalletKind[] = ['instapay', 'vodafone', 'fawry', 'etisalat', 'orange', 'we', 'other'];

export interface Wallet {
  kind: WalletKind;
  number: string;
  label?: string;
}

export interface PaySettings {
  user_id: string;
  accepts_cash: boolean;
  accepts_wallet: boolean;
  wallets: Wallet[];
  whatsapp: string | null;
  note: string | null;
  cancel_hours: number | null;
}

export interface Payment {
  id: string;
  kind: PayKind;
  ref: string;
  provider_id: string;
  payer_id: string;
  amount: number;
  method: 'wallet' | 'cash';
  wallet_kind: string | null;
  receipt_path: string | null;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Settings a provider has not saved yet: cash only. */
export const defaultSettings = (userId: string): PaySettings => ({
  user_id: userId, accepts_cash: true, accepts_wallet: false, wallets: [], whatsapp: null, note: null, cancel_hours: null,
});

const settingsCache = new Map<string, PaySettings | null>();

/** Payment settings of these providers (null when one never saved any), cached. */
export async function settingsOf(ids: string[]): Promise<Map<string, PaySettings | null>> {
  const missing = [...new Set(ids)].filter((id) => id && !settingsCache.has(id));
  for (const part of chunks(missing)) {
    const rows = check(await db().from('pay_settings').select('*').in('user_id', part)) as PaySettings[];
    for (const id of part) settingsCache.set(id, null);
    for (const r of rows) settingsCache.set(r.user_id, { ...r, wallets: Array.isArray(r.wallets) ? r.wallets : [] });
  }
  return settingsCache;
}
export const settingsNow = (id: string) => settingsCache.get(id);
export const forgetSettings = (id?: string) => { if (id) settingsCache.delete(id); else settingsCache.clear(); };

export async function saveSettings(s: Omit<PaySettings, 'user_id'>): Promise<void> {
  const me = (await getSession())?.user.id;
  if (!me) throw new Error('not signed in');
  check(await db().from('pay_settings').upsert({ user_id: me, ...s, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
  settingsCache.delete(me);
}

const clean = (rows: Payment[]) => rows.map((r) => ({ ...r, amount: Number(r.amount) }));

/** Payments for these refs of one kind (the caller sees only own and provided ones). */
export async function paymentsFor(kind: PayKind, refs: string[]): Promise<Map<string, Payment>> {
  const out = new Map<string, Payment>();
  for (const part of chunks([...new Set(refs)])) {
    if (!part.length) continue;
    for (const p of clean(check(await db().from('payments').select('*').eq('kind', kind).in('ref', part)) as Payment[])) out.set(p.ref, p);
  }
  return out;
}

/** Shrink a receipt photo and upload it to the private receipts bucket. Returns its path. */
export async function uploadReceipt(file: File): Promise<string> {
  const s = await getSession();
  if (!s) throw new Error('not signed in');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('image'))), 'image/jpeg', 0.85));
  const path = `${s.user.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const up = await db().storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(up.error.message);
  return path;
}

/** A link to look at a receipt (valid for 10 minutes). Simulated receipts use the demo picture. */
export async function receiptUrl(path: string): Promise<string> {
  if (path === 'demo') return `${import.meta.env.BASE_URL}demo/receipt.svg`;
  const res = await db().storage.from('receipts').createSignedUrl(path, 600);
  if (res.error) throw new Error(res.error.message);
  return res.data.signedUrl;
}

export async function submitPayment(kind: PayKind, ref: string, method: 'wallet' | 'cash', wallet: string | null, receipt: string | null, note = ''): Promise<string> {
  return check(await db().rpc('submit_payment', { k: kind, r: ref, m: method, wallet, receipt, note })) as string;
}

export async function decidePayment(id: string, approve: boolean): Promise<void> {
  check(await db().rpc('decide_payment', { pay: id, approve }));
}

/** Provider ticks "paid" by hand (cash received, or approving without a receipt). */
export async function setPaid(kind: PayKind, ref: string, paid: boolean): Promise<void> {
  check(await db().rpc('set_paid', { k: kind, r: ref, p: paid }));
}

/** Demo players send payments for the caller's unpaid items. */
export async function simPay(kind: PayKind, tournamentId?: string): Promise<number> {
  return check(await db().rpc('sim_pay', { k: kind, t: tournamentId ?? null })) as number;
}

/* ------------------------------------------------------- tournaments */

export interface TournamentPay {
  registration_id: string;
  player_id: string;
  status: string;
  paid: boolean;
  payment_id: string | null;
  method: 'wallet' | 'cash' | null;
  wallet_kind: string | null;
  receipt_path: string | null;
  pay_status: Payment['status'] | null;
  pay_note: string | null;
  paid_at: string | null;
}

/** Organizer: every registration with its payment, paid ones first. */
export async function tournamentPayments(t: string): Promise<TournamentPay[]> {
  return check(await db().rpc('tournament_payments', { t })) as TournamentPay[];
}

/** Player: own registration id and paid flag. */
export async function myRegistration(t: string): Promise<{ registration_id: string; status: string; paid: boolean } | null> {
  const rows = check(await db().rpc('my_registration', { t })) as { registration_id: string; status: string; paid: boolean }[];
  return rows[0] ?? null;
}

/** A TournamentPay row as a Payment (for the shared proof chip). */
export function asPayment(r: TournamentPay, providerId: string, amount: number): Payment | null {
  if (!r.payment_id || !r.method || !r.pay_status) return null;
  return {
    id: r.payment_id, kind: 'tournament', ref: r.registration_id, provider_id: providerId, payer_id: r.player_id, amount,
    method: r.method, wallet_kind: r.wallet_kind, receipt_path: r.receipt_path, status: r.pay_status, note: r.pay_note,
    created_at: r.paid_at ?? '', decided_at: null,
  };
}

/* -------------------------------------------------------- deadlines */

/** Last moment a player may cancel or withdraw: start minus the provider's hours (null = no limit). */
export function cancelDeadline(start: Date | null, hours: number | null | undefined): Date | null {
  if (!start || hours == null) return null;
  return new Date(start.getTime() - hours * 3_600_000);
}

export const canCancel = (start: Date | null, hours: number | null | undefined, now = new Date()) => {
  const d = cancelDeadline(start, hours);
  return !d || now <= d;
};

/** Start of a tournament day + "HH:MM" (Cairo, like the database), or null without a date. */
export function tournamentStart(date: string | undefined, time?: string): Date | null {
  if (!date) return null;
  const [h, m] = (time && /^\d{1,2}:\d{2}$/.test(time) ? time : '00:00').split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d) return null;
  // Egypt is UTC+2 (UTC+3 in summer time); close enough for showing a deadline, the database decides.
  const utc = Date.UTC(y, mo - 1, d, h, m) - cairoOffset(new Date(Date.UTC(y, mo - 1, d, 12))) * 60_000;
  return new Date(utc);
}

function cairoOffset(at: Date): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
    const m = s.match(/GMT([+-]\d+)(?::(\d+))?/);
    return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 120;
  } catch { return 120; }
}

/** Phone number as wa.me wants it: Egyptian 01… becomes 201…; digits only. */
export function waNumber(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0') && d.length === 11) return `2${d}`;
  return d.length >= 8 ? d : null;
}
