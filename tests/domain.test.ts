import { describe, expect, it } from 'vitest';
import { checkGame, checkMatch, summarize } from '../src/domain/scoring';
import { computeStandings } from '../src/domain/standings';
import { canEditKo, createBracket, placeSeeds, placements, syncBracket } from '../src/domain/bracket';
import type { BestOf, Game, Match, StageFormats } from '../src/domain/types';

let n = 0;
function match(aId: string, bId: string, games: [number, number][], bestOf: BestOf = 5): Match {
  return {
    id: `m${n++}`, stage: 'group', aId, bId, bestOf,
    games: games.map(([a, b]) => ({ a, b })), walkover: null, history: [],
  };
}
const W3 = [[11, 5], [11, 5], [11, 5]] as [number, number][]; // a wins 3-0
const L3 = [[5, 11], [5, 11], [5, 11]] as [number, number][]; // b wins 3-0

describe('game scoring', () => {
  it('accepts 11-9 and deuce wins by exactly two', () => {
    expect(checkGame({ a: 11, b: 9 })).toBe('ok');
    expect(checkGame({ a: 12, b: 10 })).toBe('ok');
    expect(checkGame({ a: 9, b: 11 })).toBe('ok');
    expect(checkGame({ a: 11, b: 0 })).toBe('ok');
  });
  it('rejects unfinished or impossible games', () => {
    expect(checkGame({ a: 11, b: 10 })).toBe('notFinished');
    expect(checkGame({ a: 10, b: 8 })).toBe('notFinished');
    expect(checkGame({ a: 14, b: 10 })).toBe('badMargin');
    expect(checkGame({ a: -1, b: 11 })).toBe('negative');
    expect(checkGame({ a: NaN, b: 11 } as Game)).toBe('empty');
  });
  it('validates match length per format', () => {
    expect(checkMatch([{ a: 11, b: 3 }, { a: 11, b: 3 }], 3)).toEqual({ ok: true });
    expect(checkMatch([{ a: 11, b: 3 }, { a: 11, b: 3 }], 5)).toEqual({ ok: false, error: 'notDecided' });
    expect(checkMatch([{ a: 11, b: 3 }, { a: 11, b: 3 }, { a: 3, b: 11 }], 3)).toEqual({ ok: false, error: 'extraGames' });
  });
  it('walkover counts as a full straight-games win', () => {
    expect(summarize({ games: [], bestOf: 5, walkover: 'b' })).toMatchObject({ gamesA: 0, gamesB: 3, winner: 'b' });
    expect(summarize({ games: [], bestOf: 3, walkover: 'a' })).toMatchObject({ gamesA: 2, gamesB: 0, winner: 'a' });
  });
});

describe('group standings', () => {
  it('gives exactly one point per match win', () => {
    const s = computeStandings(['A', 'B', 'C'], [match('A', 'B', W3), match('A', 'C', W3), match('B', 'C', W3)]);
    expect(s.rows.map((r) => [r.playerId, r.points])).toEqual([['A', 2], ['B', 1], ['C', 0]]);
    expect(s.complete).toBe(true);
  });

  it('two-way tie uses head-to-head even against better game difference', () => {
    // A and B both 2 wins. B beat A narrowly; A crushed everyone else.
    const ms = [
      match('B', 'A', [[11, 9], [9, 11], [11, 9], [9, 11], [11, 9]]), // B beats A 3-2
      match('A', 'C', W3), match('A', 'D', W3),
      match('B', 'C', [[11, 9], [9, 11], [11, 9], [9, 11], [11, 9]]),
      match('C', 'B', W3), // C beats B
      match('B', 'D', W3),
      match('D', 'C', W3), // D beats C
    ];
    // Wins: A: C,D =2 ; B: A,C,D = 3? adjust: B beat A, C and D -> 3. Remove one.
    const s = computeStandings(['A', 'B', 'C', 'D'], ms.filter((_, i) => i !== 3));
    const pts = Object.fromEntries(s.rows.map((r) => [r.playerId, r.points]));
    expect(pts.A).toBe(2);
    expect(pts.B).toBe(2);
    expect(s.rows[0].playerId).toBe('B');
    expect(s.rows[0].tiebreak).toBe('headToHead');
  });

  it('three-way tie uses game difference then points difference', () => {
    // Circle: A beats B 3-0, B beats C 3-1, C beats A 3-2 -> all 1 point.
    const ms = [
      match('A', 'B', W3),
      match('B', 'C', [[11, 5], [11, 5], [5, 11], [11, 5]]),
      match('C', 'A', [[11, 5], [11, 5], [5, 11], [5, 11], [11, 5]]),
    ];
    const s = computeStandings(['A', 'B', 'C'], ms);
    // Game diff among tied: A 3-0 + 2-3 = +2; B 0-3 + 3-1 = -1; C 1-3 + 3-2 = -1
    expect(s.rows[0].playerId).toBe('A');
    // B and C both -1: exactly two left -> head-to-head (B beat C)
    expect(s.rows.map((r) => r.playerId)).toEqual(['A', 'B', 'C']);
    expect(s.unresolved).toEqual([]);
  });

  it('three-way tie on games falls through to points difference', () => {
    const ms = [
      match('A', 'B', [[11, 0], [11, 0], [11, 0]]),
      match('B', 'C', [[11, 5], [11, 5], [11, 5]]),
      match('C', 'A', [[11, 9], [11, 9], [11, 9]]),
    ];
    const s = computeStandings(['A', 'B', 'C'], ms);
    // Games all +0. Points: A 33-0 + 27-33 = +27; B 0-33 + 33-15 = -15; C 15-33 + 33-27 = -12
    expect(s.rows.map((r) => r.playerId)).toEqual(['A', 'C', 'B']);
    expect(s.rows[0].tiebreak).toBe('pointsDiff');
  });

  it('leaves a perfectly symmetric three-way tie to the organizer', () => {
    const ms = [match('A', 'B', W3), match('B', 'C', W3), match('C', 'A', W3)];
    const s = computeStandings(['A', 'B', 'C'], ms);
    expect(s.unresolved).toEqual([['A', 'B', 'C']]);
    expect(s.complete).toBe(false);
    const m = computeStandings(['A', 'B', 'C'], ms, ['C', 'A', 'B']);
    expect(m.rows.map((r) => r.playerId)).toEqual(['C', 'A', 'B']);
    expect(m.rows[0].tiebreak).toBe('manual');
    expect(m.complete).toBe(true);
  });

  it('is incomplete while matches are unplayed', () => {
    const s = computeStandings(['A', 'B'], [match('A', 'B', [])]);
    expect(s.complete).toBe(false);
  });

  it('keeps tied players with different points separate (mixed subsets)', () => {
    // 4 players: A 3 wins; B, C, D 1 win each in a circle.
    const ms = [
      match('A', 'B', W3), match('A', 'C', W3), match('A', 'D', W3),
      match('B', 'C', W3), match('C', 'D', W3), match('D', 'B', L3.map(([a, b]) => [b, a]) as [number, number][]),
    ];
    const s = computeStandings(['A', 'B', 'C', 'D'], ms);
    expect(s.rows[0].playerId).toBe('A');
    expect(s.unresolved).toEqual([['B', 'C', 'D']]);
  });
});

const F: StageFormats = { group: 3, early: 3, semi: 5, final: 5 };

function play(m: Match, winner: 'a' | 'b') {
  m.games = winner === 'a' ? [{ a: 11, b: 1 }, { a: 11, b: 1 }, { a: 11, b: 1 }] : [{ a: 1, b: 11 }, { a: 1, b: 11 }, { a: 1, b: 11 }];
}

describe('knockout', () => {
  it('pairs group winners against runners-up of other groups', () => {
    const slots = placeSeeds([
      { playerId: 'A1', groupId: 'A' }, { playerId: 'B1', groupId: 'B' },
      { playerId: 'A2', groupId: 'A' }, { playerId: 'B2', groupId: 'B' },
    ]);
    expect(slots.map((s) => s?.playerId)).toEqual(['A1', 'B2', 'B1', 'A2']);
  });

  it('avoids same-group first-round matches with three groups', () => {
    const seeds = ['A', 'B', 'C'].flatMap((g) => [g]).map((g) => ({ playerId: `${g}1`, groupId: g }))
      .concat(['A', 'B', 'C'].map((g) => ({ playerId: `${g}2`, groupId: g })));
    const slots = placeSeeds(seeds);
    for (let i = 0; i < slots.length; i += 2) {
      if (slots[i] && slots[i + 1]) expect(slots[i]!.groupId).not.toBe(slots[i + 1]!.groupId);
    }
  });

  it('semifinal winners play the final, losers play for third place', () => {
    const matches: Record<string, Match> = {};
    const b = createBracket('k', 'main', 'main', [
      { playerId: 'A1', groupId: 'A' }, { playerId: 'B1', groupId: 'B' },
      { playerId: 'A2', groupId: 'A' }, { playerId: 'B2', groupId: 'B' },
    ], F, matches);
    const [s1, s2] = b.rounds[0].map((id) => matches[id]);
    expect(s1.bestOf).toBe(5);
    play(s1, 'a'); // A1 beats B2
    play(s2, 'b'); // A2 beats B1
    syncBracket(b, matches);
    const final = matches[b.rounds[1][0]];
    const third = matches[b.thirdPlaceId!];
    expect([final.aId, final.bId]).toEqual(['A1', 'A2']);
    expect([third.aId, third.bId]).toEqual(['B2', 'B1']);
    expect(canEditKo(s1, b, matches)).toBe(true);
    play(final, 'b');
    play(third, 'a');
    expect(canEditKo(s1, b, matches)).toBe(false);
    expect(placements(b, matches)).toEqual([
      { place: 1, playerId: 'A2' }, { place: 2, playerId: 'A1' },
      { place: 3, playerId: 'B2' }, { place: 4, playerId: 'B1' },
    ]);
  });

  it('gives byes to top seeds and uses per-stage formats', () => {
    const matches: Record<string, Match> = {};
    const seeds = ['A', 'B', 'C'].map((g) => ({ playerId: `${g}1`, groupId: g }))
      .concat(['A', 'B', 'C'].map((g) => ({ playerId: `${g}2`, groupId: g })));
    const b = createBracket('k', 'main', 'main', seeds, F, matches);
    expect(b.size).toBe(8);
    expect(matches[b.rounds[0][0]].bestOf).toBe(3);
    // A1 has a bye and is already in the semifinal.
    expect(matches[b.rounds[1][0]].aId).toBe('A1');
  });
});
