import { describe, expect, it } from 'vitest';
import {
  addExtraPlayer, createTournament, duplicateTournament, extraCandidates, groupMatches, groupOf, groupStandings, groupsOf,
  movePlayer, qualifyingRows, removeExtraPlayer, removePlayerFromSetup, reshuffleGroups, saveResult, startGroups, startKnockout,
} from './tournament';
import type { Tournament } from './types';

/** 7 players in 2 groups: the first has 3, the second 4 (g1 = full group, g2 = short one). */
function seven(): Tournament {
  return createTournament({
    name: 'T', date: '2026-11-20', playerNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], groupCount: 2,
    formats: { group: 3, early: 3, semi: 3, final: 3 }, consolation: { enabled: true, name: 'ترضية' },
  });
}

/** Player `winnerId` wins 2-0. */
const win = (t: Tournament, mId: string, winnerId: string) =>
  saveResult(t, mId, [], null, t.matches[mId].aId === winnerId ? { a: 2, b: 0 } : { a: 0, b: 2 });

describe('a player filling a second group', () => {
  it('adds the player to the second group as a filler, home group unchanged', () => {
    const t = seven();
    const [g2, g1] = t.groups;
    const p = g1.playerIds[0];
    expect(extraCandidates(t, g2.id).map((x) => x.id)).toContain(p);
    addExtraPlayer(t, p, g2.id);
    expect(g2.playerIds).toHaveLength(4);
    expect(groupOf(t, p)).toBe(g1);
    expect(groupsOf(t, p)).toEqual([g1, g2]);
    expect(extraCandidates(t, g2.id).map((x) => x.id)).not.toContain(p);
    expect(() => addExtraPlayer(t, p, g2.id)).toThrow();
    expect(() => addExtraPlayer(t, g2.playerIds[0], g2.id)).toThrow();
  });

  it('plays every match of both groups, counted separately', () => {
    const t = seven();
    const [g2, g1] = t.groups;
    const p = g1.playerIds[0];
    addExtraPlayer(t, p, g2.id);
    startGroups(t);
    const inG1 = groupMatches(t, g1.id).filter((m) => m.aId === p || m.bId === p);
    const inG2 = groupMatches(t, g2.id).filter((m) => m.aId === p || m.bId === p);
    expect(inG1).toHaveLength(3);
    expect(inG2).toHaveLength(3);
    for (const m of inG2) win(t, m.id, p);
    expect(groupStandings(t, g2).rows.find((r) => r.playerId === p)!.wins).toBe(3);
    expect(groupStandings(t, g1).rows.find((r) => r.playerId === p)!.played).toBe(0);
  });

  it('qualifies only from the home group: the next player takes the filler place', () => {
    const t = seven();
    const [g2, g1] = t.groups;
    const p = g1.playerIds[0];
    addExtraPlayer(t, p, g2.id);
    startGroups(t);
    // p wins everything in both groups; others: earlier entry beats later entry.
    const order = (g: typeof g1) => [p, ...g.playerIds.filter((x) => x !== p)];
    for (const g of [g1, g2]) {
      const rank = order(g);
      for (const m of groupMatches(t, g.id)) {
        const w = rank.indexOf(m.aId!) < rank.indexOf(m.bId!) ? m.aId! : m.bId!;
        win(t, m.id, w);
      }
    }
    expect(groupStandings(t, g2).rows[0].playerId).toBe(p);
    const q2 = qualifyingRows(t, g2);
    expect(q2.map((r) => r.playerId)).toEqual(g2.playerIds.filter((x) => x !== p));
    expect(q2[0].rank).toBe(1);
    startKnockout(t);
    const main = t.brackets.find((b) => b.kind === 'main')!;
    const seeded = main.rounds[0].flatMap((id) => [t.matches[id].aId, t.matches[id].bId]).filter(Boolean);
    expect(seeded.filter((x) => x === p)).toHaveLength(1);
    expect(seeded).toHaveLength(4);
    const cons = t.brackets.find((b) => b.kind === 'consolation')!;
    const consSeeded = cons.rounds[0].flatMap((id) => [t.matches[id].aId, t.matches[id].bId]).filter(Boolean);
    expect(consSeeded).not.toContain(p);
  });

  it('remove, move, reshuffle, delete and duplicate keep things clean', () => {
    const t = seven();
    const [g2, g1] = t.groups;
    const p = g1.playerIds[0];
    addExtraPlayer(t, p, g2.id);
    removeExtraPlayer(t, p, g2.id);
    expect(g2.playerIds).not.toContain(p);
    expect(g2.extraIds).toBeUndefined();

    // Moving into the group they fill makes it home, with one place only.
    addExtraPlayer(t, p, g2.id);
    movePlayer(t, p, g2.id);
    expect(g1.playerIds).not.toContain(p);
    expect(g2.playerIds.filter((x) => x === p)).toHaveLength(1);
    expect(g2.extraIds ?? []).not.toContain(p);

    // Moving the home place elsewhere keeps the filler place.
    const q = g1.playerIds[0];
    addExtraPlayer(t, q, g2.id);
    const d = duplicateTournament(t, 'copy');
    expect(d.groups[0].extraIds).toHaveLength(1);
    expect(d.groups[0].playerIds).toContain(d.groups[0].extraIds![0]);

    removePlayerFromSetup(t, q);
    expect(g2.extraIds).toBeUndefined();
    addExtraPlayer(t, g1.playerIds[0], g2.id);
    reshuffleGroups(t);
    expect(t.groups.every((g) => !g.extraIds)).toBe(true);
    expect(t.groups.flatMap((g) => g.playerIds)).toHaveLength(t.players.length);
  });

  it('cannot change fillers after the groups start', () => {
    const t = seven();
    startGroups(t);
    expect(() => addExtraPlayer(t, t.groups[0].playerIds[0], t.groups[1].id)).toThrow('locked');
  });
});
