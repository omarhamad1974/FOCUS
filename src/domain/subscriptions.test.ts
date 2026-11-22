import { describe, expect, it } from 'vitest';
import {
  addMonths, cleanSettings, DEFAULT_PRICES, nextStart, periodEnd, priceOf, revenue, statusOf, suggestion, yearlySaving,
  type Subscription,
} from './subscriptions';

const sub = (p: Partial<Subscription>): Subscription => ({
  id: Math.random().toString(36), user_id: 'u1', role: 'organizer', plan: 'monthly', products: null, amount: 500,
  starts_on: '2026-11-01', ends_on: '2026-11-30', paid: true, paid_at: '2026-11-01T10:00:00Z', note: null, created_at: '', ...p,
});

describe('prices', () => {
  const s = DEFAULT_PRICES;
  it('uses Omar defaults', () => {
    expect(priceOf(s, 'organizer', 'monthly')).toBe(500);
    expect(priceOf(s, 'trainer', 'yearly')).toBe(5000);
    expect(priceOf(s, 'seller', 'per_product', 7)).toBe(140);
    expect(priceOf(s, 'seller', 'unlimited')).toBe(500);
  });
  it('caps per-product at the maximum', () => {
    expect(priceOf(s, 'seller', 'per_product', 35)).toBe(400);
    expect(priceOf(s, 'seller', 'per_product', 0)).toBe(20);
  });
  it('yearly saving', () => expect(yearlySaving(s, 'organizer')).toEqual({ amount: 1000, pct: 17 }));
  it('reads database strings', () => expect(cleanSettings({ org_month: '450.00', seller_max_products: '0' })).toMatchObject({ org_month: 450, seller_max_products: 1, org_year: 5000 }));
});

describe('dates', () => {
  it('months keep the day or clamp to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(periodEnd('2026-11-22', 'monthly')).toBe('2026-12-21');
    expect(periodEnd('2026-11-22', 'yearly')).toBe('2027-11-21');
  });
});

describe('status', () => {
  it('none without paid periods, unpaid counts as due', () => {
    const st = statusOf([sub({ paid: false })], 'u1', 'organizer', '2026-11-10');
    expect(st.state).toBe('none');
    expect(st.due).toBe(500);
  });
  it('active, soon and expired', () => {
    const list = [sub({})];
    expect(statusOf(list, 'u1', 'organizer', '2026-11-10').state).toBe('active');
    expect(statusOf(list, 'u1', 'organizer', '2026-11-26').state).toBe('soon');
    const ex = statusOf(list, 'u1', 'organizer', '2026-12-05');
    expect(ex.state).toBe('expired');
    expect(ex.daysLeft).toBe(-5);
    expect(nextStart(ex, '2026-12-05')).toBe('2026-12-05');
  });
  it('next period starts after the paid end', () => {
    const st = statusOf([sub({})], 'u1', 'organizer', '2026-11-20');
    expect(nextStart(st, '2026-11-20')).toBe('2026-12-01');
  });
  it('ignores other people and roles', () => {
    expect(statusOf([sub({ user_id: 'u2' }), sub({ role: 'trainer' })], 'u1', 'organizer', '2026-11-10').state).toBe('none');
  });
  it('suggests per-product renewal from active products', () => {
    const st = statusOf([sub({ role: 'seller', plan: 'per_product', products: 5, amount: 100 })], 'u1', 'seller', '2026-11-20');
    expect(suggestion(st, 'seller', DEFAULT_PRICES, 8, '2026-11-20')).toMatchObject({ plan: 'per_product', products: 8, amount: 160, start: '2026-12-01', end: '2026-12-31' });
  });
});

describe('revenue', () => {
  it('sums paid, due, this month and by role', () => {
    const r = revenue([
      sub({}), sub({ role: 'seller', plan: 'unlimited', paid_at: '2026-10-03T09:00:00Z' }), sub({ paid: false, amount: 5000 }),
    ], '2026-11-22');
    expect(r).toMatchObject({ collected: 1000, thisMonth: 500, due: 5000, paidCount: 2, count: 3 });
    expect(r.byRole).toEqual({ organizer: 500, trainer: 0, seller: 500, hall: 0 });
  });
});

describe('hall owners', () => {
  it('pay monthly or yearly like trainers, with their own prices', () => {
    const s = cleanSettings({ hall_month: '300', hall_year: 3000 });
    expect(priceOf(s, 'hall', 'monthly')).toBe(300);
    expect(priceOf(s, 'hall', 'yearly')).toBe(3000);
    expect(yearlySaving(s, 'hall').amount).toBe(600);
  });
});
