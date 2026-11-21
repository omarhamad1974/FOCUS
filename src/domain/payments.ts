/**
 * Payment tracking for the role tools: tournament entry fees (kept in the
 * tournament state), training bookings and shop orders (paid flag in the
 * database). Money is recorded by hand: the organizer, trainer or seller ticks
 * "paid" when the money is received. No online payment.
 */
import type { Player, Tournament } from './types';

export interface PayLine {
  amount: number;
  paid: boolean;
}

export interface PayTotals {
  /** Everything that should be collected. */
  total: number;
  collected: number;
  due: number;
  count: number;
  paidCount: number;
}

export function totals(lines: PayLine[]): PayTotals {
  const out: PayTotals = { total: 0, collected: 0, due: 0, count: lines.length, paidCount: 0 };
  for (const l of lines) {
    const a = Math.max(0, Number(l.amount) || 0);
    out.total += a;
    if (l.paid) { out.collected += a; out.paidCount++; } else out.due += a;
  }
  return out;
}

/** Key that identifies a player's entry fee: the account when known (works before and after registration closes). */
export function payKey(p: Pick<Player, 'id' | 'profileId' | 'accountId'>): string {
  return p.profileId ?? p.accountId ?? p.id;
}

export const feeOf = (t: Tournament) => Math.max(0, Number(t.fee) || 0);

export function isPaid(t: Tournament, key: string): boolean {
  return !!t.paid?.includes(key);
}

export function setPaid(t: Tournament, key: string, paid: boolean): void {
  const set = new Set(t.paid ?? []);
  if (paid) set.add(key); else set.delete(key);
  t.paid = [...set];
  if (!t.paid.length) delete t.paid;
}

export function setFee(t: Tournament, fee: number): void {
  const f = Math.max(0, Math.round((Number(fee) || 0) * 100) / 100);
  if (f) t.fee = f; else delete t.fee;
}

/** Entry fee lines for the given payment keys (players in the tournament, or approved registrants before groups). */
export function feeLines(t: Tournament, keys: string[]): PayLine[] {
  const fee = feeOf(t);
  return keys.map((k) => ({ amount: fee, paid: isPaid(t, k) }));
}

/** Mark about `share` of the unpaid keys as paid at random (simulation). Returns how many changed. */
export function simulatePayments(t: Tournament, keys: string[], share = 0.7, rand: () => number = Math.random): number {
  let n = 0;
  for (const k of keys) {
    if (!isPaid(t, k) && rand() < share) { setPaid(t, k, true); n++; }
  }
  return n;
}
