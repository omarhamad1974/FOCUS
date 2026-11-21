import { describe, expect, it } from 'vitest';
import { feeLines, isPaid, payKey, setFee, setPaid, simulatePayments, totals } from './payments';
import { createTournament } from './tournament';

const make = () => createTournament({
  name: 'x', date: '2026-12-01', playerNames: ['أ', 'ب', 'ج'], groupCount: 1,
  formats: { group: 3, early: 3, semi: 5, final: 5 }, consolation: { enabled: false, name: '' },
});

describe('payments', () => {
  it('adds up totals', () => {
    expect(totals([{ amount: 100, paid: true }, { amount: 100, paid: false }, { amount: 50, paid: true }]))
      .toEqual({ total: 250, collected: 150, due: 100, count: 3, paidCount: 2 });
  });

  it('keys players by account first', () => {
    expect(payKey({ id: 'p1' })).toBe('p1');
    expect(payKey({ id: 'p1', accountId: 'a1' })).toBe('a1');
    expect(payKey({ id: 'p1', profileId: 'u1', accountId: 'a1' })).toBe('u1');
  });

  it('ticks and unticks entry fees', () => {
    const t = make();
    setFee(t, 150);
    const keys = t.players.map(payKey);
    setPaid(t, keys[0], true);
    expect(isPaid(t, keys[0])).toBe(true);
    expect(totals(feeLines(t, keys))).toMatchObject({ total: 450, collected: 150, due: 300 });
    setPaid(t, keys[0], false);
    expect(t.paid).toBeUndefined();
    setFee(t, 0);
    expect(t.fee).toBeUndefined();
  });

  it('simulates some payments', () => {
    const t = make();
    const keys = t.players.map(payKey);
    expect(simulatePayments(t, keys, 1)).toBe(3);
    expect(simulatePayments(t, keys, 1)).toBe(0);
  });
});
