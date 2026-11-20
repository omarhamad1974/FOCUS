import { describe, expect, it } from 'vitest';
import { hasResult } from './scoring';
import {
  addRandomPlayers, distributeWaiting, finished, groupRoundInfo, groupsReady, moveToWaiting, nextKoRound, simGroupRound, simKoRound, waitingPlayers,
} from './simulate';
import { createTournament, movePlayer, roundRobin, roundRobinRounds, startGroups, startKnockout, topTwo } from './tournament';

/** Seeded random so tests are repeatable. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const empty = (groupCount = 4, pointsPerGame = false) => createTournament({
  name: 'Sim', date: '2026-11-20', playerNames: [], groupCount,
  formats: { group: 3, early: 3, semi: 5, final: 5 }, consolation: { enabled: true, name: 'بطولة الترضية' }, pointsPerGame,
});

describe('tournament simulation', () => {
  it('adds random players to the waiting list, not to groups', () => {
    const t = empty();
    const ids = addRandomPlayers(t, 16, 7);
    expect(ids).toHaveLength(16);
    expect(new Set(t.players.map((p) => p.name)).size).toBe(16);
    expect(waitingPlayers(t)).toEqual(ids);
    expect(t.groups.every((g) => g.playerIds.length === 0)).toBe(true);
    expect(() => startGroups(t)).toThrow();
  });

  it('keeps manual moves and spreads the rest evenly at random', () => {
    const t = empty();
    const ids = addRandomPlayers(t, 15, 3);
    movePlayer(t, ids[0], t.groups[0].id);
    movePlayer(t, ids[1], t.groups[0].id);
    movePlayer(t, ids[2], t.groups[2].id);
    expect(waitingPlayers(t)).toHaveLength(12);
    expect(distributeWaiting(t, seeded(5))).toBe(12);
    expect(waitingPlayers(t)).toHaveLength(0);
    expect(t.groups[0].playerIds.slice(0, 2)).toEqual([ids[0], ids[1]]);
    const sizes = t.groups.map((g) => g.playerIds.length).sort();
    expect(sizes).toEqual([3, 4, 4, 4]);
    moveToWaiting(t, ids[0]);
    expect(waitingPlayers(t)).toEqual([ids[0]]);
  });

  it('numbers round-robin rounds so nobody plays twice in a round', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const rr = roundRobinRounds(ids);
    expect(rr.map(([a, b]) => [a, b])).toEqual(roundRobin(ids));
    for (let r = 0; r < 5; r++) {
      const inRound = rr.filter((x) => x[2] === r).flatMap(([a, b]) => [a, b]);
      expect(new Set(inRound).size).toBe(inRound.length);
    }
  });

  for (const points of [false, true]) {
    it(`plays round by round to a champion (${points ? 'points per game' : 'result only'})`, () => {
      const rand = seeded(points ? 11 : 42);
      const t = empty(4, points);
      addRandomPlayers(t, 16, 9);
      distributeWaiting(t, rand);
      startGroups(t);
      const info = groupRoundInfo(t);
      expect(info).toEqual({ next: 0, total: 3 });
      expect(simGroupRound(t, rand)).toBe(0);
      expect(groupRoundInfo(t).next).toBe(1);
      expect(Object.values(t.matches).filter(hasResult)).toHaveLength(8);
      while (simGroupRound(t, rand) !== null);
      expect(groupsReady(t)).toBe(true);
      startKnockout(t);
      expect(t.brackets).toHaveLength(2);
      const played: string[] = [];
      for (let r = nextKoRound(t); r; r = nextKoRound(t)) played.push(simKoRound(t, rand)!);
      expect(played).toEqual(['quarter', 'semi', 'final']);
      expect(finished(t)).toBe(true);
      expect(topTwo(t)).not.toBeNull();
      // Every knockout match with two players has a result, including the third-place playoffs.
      for (const m of Object.values(t.matches)) if (m.aId && m.bId) expect(hasResult(m)).toBe(true);
    });
  }
});
