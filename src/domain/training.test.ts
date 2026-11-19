import { describe, expect, it } from 'vitest';
import { byDay, dayKey, slotEnd, slotStarts } from './training';

describe('training slots', () => {
  const now = new Date(2026, 10, 1, 12, 0); // Sunday 1 Nov 2026, noon

  it('makes one slot per chosen day and hour', () => {
    const s = slotStarts({ from: '2026-11-01', weeks: 2, days: [0, 2], hours: [18, 17] }, now);
    // Sundays 1, 8 and Tuesdays 3, 10 → 4 days × 2 hours
    expect(s).toHaveLength(8);
    expect(s[0].getHours()).toBe(17);
    expect(dayKey(s[0])).toBe('2026-11-01');
    expect(dayKey(s[s.length - 1])).toBe('2026-11-10');
  });

  it('skips times that already passed', () => {
    const s = slotStarts({ from: '2026-11-01', weeks: 1, days: [0], hours: [9, 13] }, now);
    expect(s.map((d) => d.getHours())).toEqual([13]);
  });

  it('limits weeks and ignores bad input', () => {
    expect(slotStarts({ from: 'bad', weeks: 1, days: [0], hours: [9] }, now)).toEqual([]);
    expect(slotStarts({ from: '2026-11-02', weeks: 50, days: [1], hours: [25, 10] }, now)).toHaveLength(12);
  });

  it('slots last one hour and group by day', () => {
    const a = new Date(2026, 10, 2, 10), b = new Date(2026, 10, 2, 9), c = new Date(2026, 10, 3, 9);
    expect(slotEnd(a).getHours()).toBe(11);
    const g = byDay([a, c, b], (x) => x);
    expect(g.map(([k, xs]) => [k, xs.length])).toEqual([['2026-11-02', 2], ['2026-11-03', 1]]);
    expect(g[0][1][0]).toBe(b);
  });
});
