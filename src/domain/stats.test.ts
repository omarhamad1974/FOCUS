import { describe, expect, it } from 'vitest';
import { sampleTournament } from './sample';
import { playerStats, ranking, rankingPoints } from './stats';
import { saveResult, topTwo } from './tournament';
import { summarize } from './scoring';
import type { Tournament } from './types';

/** A finished sample tournament whose players all have accounts acc-<name>. */
function withAccounts(seed: number, date: string, level: 'finished' | 'groupsHalf' = 'finished'): Tournament {
  const t = sampleTournament(level, seed, 16, 4);
  t.id = `t${seed}`;
  t.date = date;
  t.players.forEach((p) => { p.accountId = `acc-${p.name}`; });
  return t;
}

describe('player stats', () => {
  it('counts wins, losses, games and win rate from every played match', () => {
    const t = withAccounts(11, '2026-11-01');
    for (const p of t.players) {
      const s = playerStats([t], p.accountId!);
      const mine = Object.values(t.matches).filter((m) => (m.aId === p.id || m.bId === p.id) && m.aId && m.bId && summarize(m).winner);
      expect(s.played).toBe(mine.length);
      expect(s.wins + s.losses).toBe(s.played);
      expect(s.winRate).toBe(Math.round((s.wins / s.played) * 100));
      expect(s.tournaments).toHaveLength(1);
    }
  });

  it('gives the champion place 1 and the runner-up place 2', () => {
    const t = withAccounts(12, '2026-11-01');
    const top = topTwo(t)!;
    const acc = (id: string) => t.players.find((p) => p.id === id)!.accountId!;
    const champ = playerStats([t], acc(top.first));
    expect(champ.tournaments[0].finish).toMatchObject({ kind: 'place', place: 1, bracket: 'main' });
    expect(champ.titles).toBe(1);
    expect(playerStats([t], acc(top.second)).tournaments[0].finish).toMatchObject({ kind: 'place', place: 2 });
  });

  it('counts a walkover as a straight-games win and a loss for the other player', () => {
    const t = withAccounts(13, '2026-11-01', 'groupsHalf');
    const m = Object.values(t.matches).find((x) => x.stage === 'group' && !summarize(x).winner)!;
    saveResult(t, m.id, [], 'b');
    const winner = t.players.find((p) => p.id === m.bId)!.accountId!;
    const loser = t.players.find((p) => p.id === m.aId)!.accountId!;
    const w = playerStats([t], winner);
    const line = w.recent.find((x) => x.matchId === m.id)!;
    expect(line).toMatchObject({ won: true, walkover: true, games: [2, 0] });
    expect(w.walkoverWins).toBeGreaterThanOrEqual(1);
    expect(playerStats([t], loser).recent.find((x) => x.matchId === m.id)).toMatchObject({ won: false, games: [0, 2] });
  });

  it('marks players still in the groups as alive with their group rank', () => {
    const t = withAccounts(14, '2026-11-01', 'groupsHalf');
    const s = playerStats([t], t.players[0].accountId!);
    expect(s.tournaments[0].finish).toMatchObject({ kind: 'group', alive: true });
  });

  it('adds stats over several tournaments, latest first', () => {
    const a = withAccounts(15, '2026-10-01');
    const b = withAccounts(15, '2026-11-01');
    b.id = 'later';
    const acc = a.players[0].accountId!;
    const one = playerStats([a], acc);
    const two = playerStats([a, b], acc);
    expect(two.played).toBe(one.played * 2);
    expect(two.tournaments.map((x) => x.tournamentId)).toEqual(['later', a.id]);
    expect(two.recent[0].tournamentId).toBe('later');
  });

  it('ignores typed players without an account', () => {
    const t = sampleTournament('finished', 16, 16, 4);
    expect(ranking([t])).toEqual([]);
  });
});

describe('ranking', () => {
  it('ranks by points (wins + finish bonus) and puts the champion near the top', () => {
    const t = withAccounts(17, '2026-11-01');
    const rows = ranking([t]);
    expect(rows).toHaveLength(16);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].points).toBeGreaterThanOrEqual(rows[i].points);
    const champ = t.players.find((p) => p.id === topTwo(t)!.first)!.accountId!;
    expect(rows.find((r) => r.accountId === champ)!.rank).toBe(1);
  });

  it('gives half the bonus for consolation places', () => {
    const line = (bracket: 'main' | 'consolation') => ({ tournamentId: 'x', name: '', date: '', finished: true, wins: 0, losses: 0,
      finish: { kind: 'place' as const, place: 1 as const, bracket, bracketName: '' } });
    expect(rankingPoints(3, [line('main')])).toBe(13);
    expect(rankingPoints(3, [line('consolation')])).toBe(8);
  });
});
