/** Training schedule helpers. Slots are always one hour long. */

export const SLOT_MINUTES = 60;

export interface WeeklyPattern {
  /** First day to schedule, YYYY-MM-DD (local time). */
  from: string;
  /** How many weeks to fill, 1–12. */
  weeks: number;
  /** Days of the week, 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Start hours, 0–23 (each makes one 1-hour slot). */
  hours: number[];
}

/** Every slot start (local time) the pattern describes, in order, skipping times before `now`. */
export function slotStarts(p: WeeklyPattern, now = new Date()): Date[] {
  const [y, m, d] = p.from.split('-').map(Number);
  if (!y || !m || !d) return [];
  const weeks = Math.max(1, Math.min(12, Math.floor(p.weeks)));
  const days = new Set(p.days.filter((x) => x >= 0 && x <= 6));
  const hours = [...new Set(p.hours.filter((h) => h >= 0 && h <= 23))].sort((a, b) => a - b);
  const out: Date[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = new Date(y, m - 1, d + i);
    if (!days.has(day.getDay())) continue;
    for (const h of hours) {
      const at = new Date(y, m - 1, d + i, h, 0, 0, 0);
      if (at > now) out.push(at);
    }
  }
  return out;
}

export function slotEnd(start: Date): Date {
  return new Date(start.getTime() + SLOT_MINUTES * 60_000);
}

/** Local calendar key YYYY-MM-DD for grouping slots by day. */
export function dayKey(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Group items by local day, days in order. */
export function byDay<T>(items: T[], at: (x: T) => Date): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const x of [...items].sort((a, b) => at(a).getTime() - at(b).getTime())) {
    const k = dayKey(at(x));
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(x);
  }
  return [...map.entries()];
}
