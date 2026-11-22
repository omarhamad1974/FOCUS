/** Table tennis halls: tables, one-hour slots per table and players' booking requests (migration 0017). */
import { db, getSession } from './remote';
import { chunks } from './content';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export interface Hall {
  id: string;
  owner_id: string;
  name: string;
  address: string | null;
  map_url: string | null;
  photo_url: string | null;
  tables: number;
  price_hour: number;
  note: string | null;
  created_at: string;
}

export interface HallSlot {
  id: string;
  hall_id: string;
  owner_id: string;
  table_no: number;
  starts_at: string;
  taken: boolean;
}

export type HallBookingStatus = 'requested' | 'confirmed' | 'rejected' | 'cancelled';

export interface HallBooking {
  id: string;
  slot_id: string;
  hall_id: string;
  owner_id: string;
  player_id: string;
  amount: number;
  status: HallBookingStatus;
  paid: boolean;
  created_at: string;
  decided_at: string | null;
}

const hallRow = (r: Hall): Hall => ({ ...r, price_hour: Number(r.price_hour) });

export async function listHalls(ownerId?: string): Promise<Hall[]> {
  let q = db().from('halls').select('*').order('name');
  if (ownerId) q = q.eq('owner_id', ownerId);
  return (check(await q) as Hall[]).map(hallRow);
}

export async function getHall(id: string): Promise<Hall | null> {
  const r = check(await db().from('halls').select('*').eq('id', id).maybeSingle()) as Hall | null;
  return r ? hallRow(r) : null;
}

export async function saveHall(h: Partial<Hall> & { name: string }): Promise<Hall> {
  const { id, owner_id: _o, created_at: _c, ...fields } = h;
  const q = id ? db().from('halls').update(fields).eq('id', id) : db().from('halls').insert(fields);
  return hallRow(check(await q.select('*').single()) as Hall);
}

/** Slots of a hall from the start of today for `days` days. */
export async function listSlots(hallId: string, days = 14): Promise<HallSlot[]> {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86_400_000);
  return check(await db().from('hall_slots').select('*').eq('hall_id', hallId)
    .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('starts_at').order('table_no')) as HallSlot[];
}

export async function slotsById(ids: string[]): Promise<HallSlot[]> {
  const out: HallSlot[] = [];
  for (const part of chunks([...new Set(ids)])) if (part.length) out.push(...(check(await db().from('hall_slots').select('*').in('id', part)) as HallSlot[]));
  return out;
}

/** Open hours: one row per table and start; hours the hall already has are skipped. */
export async function addSlots(hallId: string, rows: { table_no: number; starts_at: string }[]): Promise<number> {
  let n = 0;
  for (const part of chunks(rows, 400)) {
    const res = check(await db().from('hall_slots').upsert(part.map((r) => ({ ...r, hall_id: hallId })),
      { onConflict: 'hall_id,table_no,starts_at', ignoreDuplicates: true }).select('id')) as { id: string }[];
    n += res.length;
  }
  return n;
}

/** Remove free hours (taken ones stay). */
export async function deleteSlots(ids: string[]): Promise<void> {
  for (const part of chunks(ids)) check(await db().from('hall_slots').delete().in('id', part).eq('taken', false));
}

/** How many open requests each slot of the hall has. */
export async function slotRequests(hallId: string): Promise<Map<string, number>> {
  const rows = check(await db().rpc('hall_slot_requests', { h: hallId })) as { slot_id: string; requests: number }[];
  return new Map(rows.map((r) => [r.slot_id, r.requests]));
}

export async function book(slotIds: string[]): Promise<number> {
  return check(await db().rpc('book_hall_slots', { slots: slotIds })) as number;
}

export async function cancel(id: string): Promise<void> {
  check(await db().rpc('cancel_hall_booking', { b: id }));
}

export async function decide(id: string, approve: boolean): Promise<void> {
  check(await db().rpc('decide_hall_booking', { b: id, approve }));
}

const bookingRows = (rows: HallBooking[]) => rows.map((r) => ({ ...r, amount: Number(r.amount) }));

export async function myBookings(): Promise<HallBooking[]> {
  const s = await getSession();
  if (!s) return [];
  return bookingRows(check(await db().from('hall_bookings').select('*').eq('player_id', s.user.id)
    .in('status', ['requested', 'confirmed', 'rejected']).order('created_at', { ascending: false }).limit(60)) as HallBooking[]);
}

/** Owner: every booking of the owner's halls that is still on, or was decided lately. */
export async function ownerBookings(ownerId: string): Promise<HallBooking[]> {
  return bookingRows(check(await db().from('hall_bookings').select('*').eq('owner_id', ownerId)
    .in('status', ['requested', 'confirmed']).order('created_at')) as HallBooking[]);
}

export async function ownerPlayers(): Promise<Map<string, { full_name: string; phone: string | null }>> {
  const rows = check(await db().rpc('my_hall_players')) as { booking_id: string; full_name: string; phone: string | null }[];
  return new Map(rows.map((r) => [r.booking_id, r]));
}

export async function simHall(n: number, players: string[] | null, hallId?: string): Promise<number> {
  return check(await db().rpc('sim_hall', { n, players: players?.length ? players : null, hall: hallId ?? null })) as number;
}
