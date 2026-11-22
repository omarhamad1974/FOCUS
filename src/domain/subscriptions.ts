/**
 * Subscriptions for organizers, trainers and sellers (players are free).
 * Prices are admin settings (table plan_settings). Payments are offline: the
 * admin records each period and ticks "paid", which moves the expiry date.
 * Nothing is blocked when a subscription expires: the app only warns
 * (Omar's choice, 2026-11-22).
 */

export type SubRole = 'organizer' | 'trainer' | 'seller';
export type SubPlan = 'monthly' | 'yearly' | 'per_product' | 'unlimited';
export const SUB_ROLES: SubRole[] = ['organizer', 'trainer', 'seller'];

export interface PlanSettings {
  org_month: number;
  org_year: number;
  trainer_month: number;
  trainer_year: number;
  seller_per_product: number;
  seller_max_products: number;
  seller_unlimited: number;
}

/** Omar's starting prices (EGP). */
export const DEFAULT_PRICES: PlanSettings = {
  org_month: 500, org_year: 5000,
  trainer_month: 500, trainer_year: 5000,
  seller_per_product: 20, seller_max_products: 20, seller_unlimited: 500,
};

export interface Subscription {
  id: string;
  user_id: string;
  role: SubRole;
  plan: SubPlan;
  products: number | null;
  amount: number;
  /** Dates as YYYY-MM-DD; both days are included. */
  starts_on: string;
  ends_on: string;
  paid: boolean;
  paid_at: string | null;
  note: string | null;
  created_at: string;
}

/** Days before the end when the badge turns orange. */
export const SOON_DAYS = 7;

export const plansFor = (role: SubRole): SubPlan[] =>
  role === 'seller' ? ['per_product', 'unlimited'] : ['monthly', 'yearly'];

export const defaultPlan = (role: SubRole): SubPlan => plansFor(role)[0];

/** Numbers from the database may arrive as strings (numeric columns). */
export function cleanSettings(row: Partial<Record<keyof PlanSettings, unknown>> | null | undefined): PlanSettings {
  const out = { ...DEFAULT_PRICES };
  for (const k of Object.keys(out) as (keyof PlanSettings)[]) {
    const v = Number(row?.[k]);
    if (row && row[k] != null && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  out.seller_max_products = Math.max(1, Math.round(out.seller_max_products));
  return out;
}

/** Products a per-product plan can cover: at least 1, at most the admin's maximum. */
export const clampProducts = (n: number, s: PlanSettings) =>
  Math.min(s.seller_max_products, Math.max(1, Math.round(Number(n) || 0)));

/** Price of one period of `plan` (a month, or a year for "yearly"). */
export function priceOf(s: PlanSettings, role: SubRole, plan: SubPlan, products = 1): number {
  if (role === 'seller') return plan === 'unlimited' ? s.seller_unlimited : s.seller_per_product * clampProducts(products, s);
  const [m, y] = role === 'organizer' ? [s.org_month, s.org_year] : [s.trainer_month, s.trainer_year];
  return plan === 'yearly' ? y : m;
}

/** How much a yearly plan saves against 12 monthly payments (0 when it does not). */
export function yearlySaving(s: PlanSettings, role: 'organizer' | 'trainer'): { amount: number; pct: number } {
  const m = role === 'organizer' ? s.org_month : s.trainer_month;
  const y = role === 'organizer' ? s.org_year : s.trainer_year;
  const amount = Math.max(0, m * 12 - y);
  return { amount, pct: m > 0 ? Math.round((amount / (m * 12)) * 100) : 0 };
}

/* ------------------------------------------------------------ dates */

const parse = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000);

/** Add calendar months, keeping the day where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: string, months: number): string {
  const x = parse(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return fmt(x);
}

/** Last day (included) of a period that starts on `start`: one month, or twelve for "yearly". */
export const periodEnd = (start: string, plan: SubPlan) => addDays(addMonths(start, plan === 'yearly' ? 12 : 1), -1);

/* ------------------------------------------------------------ status */

export type SubState = 'none' | 'active' | 'soon' | 'expired';

export interface SubStatus {
  state: SubState;
  /** Last paid day, or null when nothing was ever paid. */
  endsOn: string | null;
  /** Days from today to the end (negative after it). */
  daysLeft: number | null;
  /** The paid period that covers today (or the last one paid), for the plan name. */
  current: Subscription | null;
  /** Periods recorded but not paid yet. */
  unpaid: Subscription[];
  due: number;
}

/** Where one person stands for one role. `subs` may hold other people's and roles' periods. */
export function statusOf(subs: Subscription[], userId: string, role: SubRole, today = todayIso()): SubStatus {
  const mine = subs.filter((s) => s.user_id === userId && s.role === role);
  const paid = mine.filter((s) => s.paid).sort((a, b) => a.ends_on.localeCompare(b.ends_on));
  const unpaid = mine.filter((s) => !s.paid).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const due = unpaid.reduce((t, s) => t + (Number(s.amount) || 0), 0);
  if (!paid.length) return { state: 'none', endsOn: null, daysLeft: null, current: null, unpaid, due };
  const last = paid[paid.length - 1];
  const covering = paid.filter((s) => s.starts_on <= today && s.ends_on >= today);
  const current = covering.length ? covering[covering.length - 1] : last;
  const daysLeft = daysBetween(today, last.ends_on);
  const state: SubState = daysLeft < 0 ? 'expired' : daysLeft < SOON_DAYS ? 'soon' : 'active';
  return { state, endsOn: last.ends_on, daysLeft, current, unpaid, due };
}

/** First day of the next period: the day after the paid end, or today when that has passed. */
export function nextStart(st: SubStatus, today = todayIso()): string {
  if (!st.endsOn) return today;
  const after = addDays(st.endsOn, 1);
  return after > today ? after : today;
}

/** Products the seller's current plan covers: a number, or null for unlimited / no plan. */
export function productsCovered(st: SubStatus): number | null {
  if (!st.current || st.state === 'expired') return 0;
  return st.current.plan === 'unlimited' ? null : st.current.products ?? 0;
}

/**
 * What to suggest for the next period: same plan as now (or the role's first plan),
 * and for a per-product seller the number of active products, within the maximum.
 */
export function suggestion(st: SubStatus, role: SubRole, s: PlanSettings, activeProducts = 0, today = todayIso()) {
  const plan: SubPlan = st.current?.plan ?? defaultPlan(role);
  const products = clampProducts(plan === 'per_product' && activeProducts > 0 ? activeProducts : st.current?.products ?? Math.max(1, activeProducts), s);
  const start = nextStart(st, today);
  return { plan, products, start, end: periodEnd(start, plan), amount: priceOf(s, role, plan, products) };
}

/* ------------------------------------------------------------ revenue */

export interface Revenue {
  collected: number;
  /** Paid during the current calendar month. */
  thisMonth: number;
  due: number;
  byRole: Record<SubRole, number>;
  paidCount: number;
  count: number;
}

export function revenue(subs: Subscription[], today = todayIso()): Revenue {
  const month = today.slice(0, 7);
  const out: Revenue = { collected: 0, thisMonth: 0, due: 0, byRole: { organizer: 0, trainer: 0, seller: 0 }, paidCount: 0, count: subs.length };
  for (const s of subs) {
    const a = Math.max(0, Number(s.amount) || 0);
    if (!s.paid) { out.due += a; continue; }
    out.collected += a;
    out.paidCount++;
    out.byRole[s.role] += a;
    if ((s.paid_at ? todayIso(new Date(s.paid_at)) : s.starts_on).slice(0, 7) === month) out.thisMonth += a;
  }
  return out;
}
