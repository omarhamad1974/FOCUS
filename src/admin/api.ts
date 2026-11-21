/** Supabase calls used only by the role tools (simulation players, simulations, payments). */
import { db } from '../data/remote';
import type { Booking, Order } from '../data/content';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export interface SimPlayer {
  id: string;
  full_name: string;
  club: string | null;
  avatar_url: string | null;
  gender: 'male' | 'female' | null;
  birth_year: number | null;
}

let simCache: SimPlayer[] | null = null;
let simLoading: Promise<SimPlayer[]> | null = null;

/** The 40 registered demo players (accounts sim01..sim40), cached for the session. */
export function simPlayers(): Promise<SimPlayer[]> {
  if (simCache) return Promise.resolve(simCache);
  simLoading ??= (async () => {
    try {
      simCache = check(await db().rpc('sim_players')) as SimPlayer[];
      return simCache;
    } finally { simLoading = null; }
  })();
  return simLoading;
}
export const simPlayersNow = () => simCache;
export const simById = (id: string) => simCache?.find((p) => p.id === id);
export const forgetSim = () => { simCache = null; };

/** Demo players ask to join a tournament (follows its auto-accept and player limit). */
export async function simJoin(tournamentId: string, players: string[]): Promise<number> {
  return check(await db().rpc('sim_join', { t: tournamentId, players })) as number;
}

/** Demo players book the trainer's next free slots. */
export async function simBook(n: number, players: string[] | null): Promise<number> {
  return check(await db().rpc('sim_book', { n, players: players?.length ? players : null })) as number;
}

/** Demo customers order the seller's products. */
export async function simOrder(n: number, players: string[] | null): Promise<number> {
  return check(await db().rpc('sim_order', { n, players: players?.length ? players : null })) as number;
}

export async function simClear(kind: 'organizer' | 'trainer' | 'seller', tournamentId?: string): Promise<number> {
  return check(await db().rpc('sim_clear', { kind, t: tournamentId ?? null })) as number;
}

export async function setBookingPaid(id: string, paid: boolean): Promise<void> {
  check(await db().rpc('set_booking_paid', { b: id, p: paid }));
}

export async function setOrderPaid(id: string, paid: boolean): Promise<void> {
  check(await db().rpc('set_order_paid', { o: id, p: paid }));
}

export type PaidBooking = Booking & { paid: boolean };
export type PaidOrder = Order & { paid: boolean };

/** All the trainer's bookings that are still on (past and upcoming), newest slots last. */
export async function trainerBookings(trainerId: string): Promise<PaidBooking[]> {
  return check(await db().from('bookings').select('*').eq('trainer_id', trainerId).eq('status', 'booked')) as PaidBooking[];
}

export async function sellerOrders(sellerId: string): Promise<PaidOrder[]> {
  const rows = check(await db().from('orders').select('*').eq('seller_id', sellerId).order('created_at', { ascending: false })) as PaidOrder[];
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}
