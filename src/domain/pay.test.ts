import { describe, expect, it } from 'vitest';
import { canCancel, cancelDeadline, tournamentStart, waNumber } from '../data/pay';

describe('payment helpers', () => {
  it('turns Egyptian mobiles into wa.me numbers', () => {
    expect(waNumber('01006552256')).toBe('201006552256');
    expect(waNumber('+20 100 655 2256')).toBe('201006552256');
    expect(waNumber('00201006552256')).toBe('201006552256');
    expect(waNumber('')).toBeNull();
  });
  it('works out the cancel deadline', () => {
    const start = new Date('2026-12-01T18:00:00Z');
    expect(cancelDeadline(start, null)).toBeNull();
    expect(cancelDeadline(start, 24)?.toISOString()).toBe('2026-11-30T18:00:00.000Z');
    expect(canCancel(start, 24, new Date('2026-11-30T17:59:00Z'))).toBe(true);
    expect(canCancel(start, 24, new Date('2026-11-30T18:01:00Z'))).toBe(false);
    expect(canCancel(start, undefined, new Date('2026-12-02T00:00:00Z'))).toBe(true);
  });
  it('reads a tournament start in Cairo time', () => {
    expect(tournamentStart('2026-12-01', '18:30')?.toISOString()).toBe('2026-12-01T16:30:00.000Z');
    expect(tournamentStart(undefined)).toBeNull();
  });
});
