import { describe, expect, it } from 'vitest';
import { checkResult, hasResult, possibleResults, summarize } from '../src/domain/scoring';
import { computeStandings } from '../src/domain/standings';
import { createTournament, recordsPoints, saveResult, startGroups } from '../src/domain/tournament';
import type { BestOf, Match } from '../src/domain/types';

let n = 0;
function res(aId: string, bId: string, a: number, b: number, bestOf: BestOf = 5): Match {
  return { id: `r${n++}`, stage: 'group', aId, bId, bestOf, games: [], walkover: null, result: { a, b }, history: [] };
}

describe('match result in games only', () => {
  it('lists the possible losing-game counts per format', () => {
    expect(possibleResults(5)).toEqual([0, 1, 2]);
    expect(possibleResults(3)).toEqual([0, 1]);
  });
  it('validates results', () => {
    expect(checkResult({ a: 3, b: 1 }, 5)).toEqual({ ok: true });
    expect(checkResult({ a: 0, b: 2 }, 3)).toEqual({ ok: true });
    expect(checkResult({ a: 2, b: 1 }, 5).ok).toBe(false);
    expect(checkResult({ a: 3, b: 3 }, 5).ok).toBe(false);
    expect(checkResult({ a: 4, b: 0 }, 5).ok).toBe(false);
  });
  it('summarizes a games-only result with no points', () => {
    expect(summarize(res('x', 'y', 1, 3))).toMatchObject({ gamesA: 1, gamesB: 3, pointsA: 0, pointsB: 0, winner: 'b' });
    expect(hasResult(res('x', 'y', 3, 0))).toBe(true);
  });
  it('breaks a 3-way tie on games difference among the tied players', () => {
    // A beat B 3-0, B beat C 3-1, C beat A 3-2 → games among them: A 5-3 (+2), B 3-4 (-1), C 4-5 (-1)
    const ms = [res('A', 'B', 3, 0), res('B', 'C', 3, 1), res('C', 'A', 3, 2)];
    const s = computeStandings(['A', 'B', 'C'], ms);
    expect(s.rows[0].playerId).toBe('A');
    // B and C level on games: two players → head-to-head (B beat C)
    expect(s.rows.map((r) => r.playerId)).toEqual(['A', 'B', 'C']);
    expect(s.unresolved).toEqual([]);
  });
  it('sends a 3-way tie level on games to the organizer (no points difference)', () => {
    const ms = [res('A', 'B', 3, 1), res('B', 'C', 3, 1), res('C', 'A', 3, 1)];
    const s = computeStandings(['A', 'B', 'C'], ms);
    expect(s.unresolved).toHaveLength(1);
    expect(s.unresolved[0].sort()).toEqual(['A', 'B', 'C']);
    const fixed = computeStandings(['A', 'B', 'C'], ms, ['C', 'A', 'B']);
    expect(fixed.rows.map((r) => r.playerId)).toEqual(['C', 'A', 'B']);
    expect(fixed.complete).toBe(true);
  });
  it('a walkover among games-only results does not decide on points', () => {
    const ms = [res('A', 'B', 3, 1), res('B', 'C', 3, 1),
      { ...res('C', 'A', 0, 0), result: null, walkover: 'a' as const }];
    // C beat A 3-0 by walkover → A 3-4 (-1), B 4-4 (0), C 4-3 (+1): no tie
    const s = computeStandings(['A', 'B', 'C'], ms);
    expect(s.rows.map((r) => r.playerId)).toEqual(['C', 'B', 'A']);
  });
  it('saves, corrects and keeps history of games-only results', () => {
    const t = createTournament({ name: 'T', date: '2026-11-20', playerNames: ['a', 'b', 'c', 'd'], groupCount: 1,
      formats: { group: 5, early: 3, semi: 5, final: 5 }, consolation: { enabled: false, name: '' } });
    expect(recordsPoints(t)).toBe(false);
    startGroups(t);
    const m = Object.values(t.matches)[0];
    expect(saveResult(t, m.id, [], null, { a: 3, b: 2 })).toEqual({ ok: true });
    expect(summarize(m).winner).toBe('a');
    expect(saveResult(t, m.id, [], null, { a: 1, b: 3 })).toEqual({ ok: true });
    expect(m.history[0].result).toEqual({ a: 3, b: 2 });
    expect(saveResult(t, m.id, [], 'a')).toEqual({ ok: true });
    expect(m.result).toBeNull();
    expect(saveResult(t, m.id, [], null, { a: 2, b: 2 }).ok).toBe(false);
  });
  it('older tournaments with game points keep detailed scoring', () => {
    const t = createTournament({ name: 'T', date: '2026-11-20', playerNames: ['a', 'b', 'c'], groupCount: 1,
      formats: { group: 3, early: 3, semi: 3, final: 3 }, consolation: { enabled: false, name: '' } });
    delete t.pointsPerGame;
    startGroups(t);
    const m = Object.values(t.matches)[0];
    saveResult(t, m.id, [{ a: 11, b: 4 }, { a: 11, b: 6 }], null);
    expect(recordsPoints(t)).toBe(true);
  });
});
