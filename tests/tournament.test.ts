import { describe, expect, it } from 'vitest';
import { createTournament, duplicateTournament, groupStandings, roundRobin, saveResult, startGroups, startKnockout } from '../src/domain/tournament';
import { sampleTournament } from '../src/domain/sample';
import { placements } from '../src/domain/bracket';
import { ar } from '../src/i18n/ar';

const base = {
  name: 'كأس', date: '2026-11-20', groupCount: 2,
  formats: { group: 3, early: 3, semi: 5, final: 5 } as const,
  consolation: { enabled: true, name: 'بطولة الترضية' },
};

describe('tournament flow', () => {
  it('keeps player names exactly as typed', () => {
    const t = createTournament({ ...base, playerNames: ['  أحمد  ', 'Omar K.', 'مريم', 'Lina'].map((s) => s), groupCount: 2 });
    expect(t.players.map((p) => p.name)).toEqual(['  أحمد  ', 'Omar K.', 'مريم', 'Lina']);
  });

  it('round robin has every pair exactly once', () => {
    const pairs = roundRobin(['a', 'b', 'c', 'd', 'e']).map((p) => [...p].sort().join());
    expect(pairs).toHaveLength(10);
    expect(new Set(pairs).size).toBe(10);
  });

  it('uses the group format for group matches and keeps an audit trail', () => {
    const t = createTournament({ ...base, playerNames: ['a', 'b', 'c', 'd'] });
    startGroups(t);
    const m = Object.values(t.matches)[0];
    expect(m.bestOf).toBe(3);
    expect(saveResult(t, m.id, [{ a: 11, b: 2 }, { a: 11, b: 2 }], null)).toEqual({ ok: true });
    expect(saveResult(t, m.id, [], 'b')).toEqual({ ok: true });
    expect(m.history).toHaveLength(1);
    expect(m.walkover).toBe('b');
  });

  it('rejects extra games after the match is decided', () => {
    const t = createTournament({ ...base, playerNames: ['a', 'b', 'c', 'd'] });
    startGroups(t);
    const m = Object.values(t.matches)[0];
    const r = saveResult(t, m.id, [{ a: 11, b: 2 }, { a: 11, b: 2 }, { a: 2, b: 11 }], null);
    expect(r).toEqual({ ok: false, error: 'extraGames' });
  });

  it('sends 1st/2nd to the main draw and 3rd/4th to the consolation draw', () => {
    const t = sampleTournament('groupsDone', 42, 16, 4);
    startKnockout(t);
    const [main, cons] = t.brackets;
    expect(main.size).toBe(8);
    expect(cons.kind).toBe('consolation');
    expect(cons.name).toBe('بطولة الترضية');
    const firsts = new Set(t.groups.flatMap((g) => groupStandings(t, g).rows.slice(0, 2).map((r) => r.playerId)));
    const mainPlayers = main.rounds[0].flatMap((id) => [t.matches[id].aId, t.matches[id].bId]);
    expect(new Set(mainPlayers)).toEqual(firsts);
  });

  it('a finished sample tournament has places 1 to 4 in both draws', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const t = sampleTournament('finished', seed, 12, 3);
      for (const b of t.brackets) expect(placements(b, t.matches).map((p) => p.place)).toEqual([1, 2, 3, 4]);
    }
  });

  it('duplicate copies players and settings but no results', () => {
    const t = sampleTournament('finished', 7);
    const c = duplicateTournament(t, 'copy');
    expect(c.stage).toBe('setup');
    expect(Object.keys(c.matches)).toHaveLength(0);
    expect(c.players.map((p) => p.name)).toEqual(t.players.map((p) => p.name));
    expect(c.players.every((p) => !t.players.some((q) => q.id === p.id))).toBe(true);
    expect(c.formats).toEqual(t.formats);
    c.formats.final = 3;
    expect(t.formats.final).toBe(5);
  });
});

describe('arabic dictionary', () => {
  it('has no empty messages', () => {
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), k).not.toBe('');
  });
});

import { closeRegistration, remoteStatus } from '../src/domain/tournament';

describe('online registration', () => {
  it('adds approved registrants once and drops withdrawn ones', () => {
    const t = createTournament({ ...base, playerNames: ['Typed'] });
    t.registration = { open: true, autoAccept: false, maxPlayers: null };
    expect(remoteStatus(t)).toBe('registration');
    closeRegistration(t, [{ profileId: 'u1', name: 'لينا' }, { profileId: 'u2', name: 'Sam' }]);
    expect(t.players.map((p) => p.name)).toEqual(['Typed', 'لينا', 'Sam']);
    expect(t.registration!.open).toBe(false);
    expect(remoteStatus(t)).toBe('draft');
    expect(t.groups.flatMap((g) => g.playerIds)).toHaveLength(3);
    closeRegistration(t, [{ profileId: 'u2', name: 'Sam' }]);
    expect(t.players.map((p) => p.name)).toEqual(['Typed', 'Sam']);
  });

  it('reports running and finished', () => {
    const t = sampleTournament('groupsHalf', 3);
    expect(remoteStatus(t)).toBe('running');
    expect(remoteStatus(sampleTournament('finished', 3))).toBe('finished');
  });
});

import { addPlayerToSetup, exactDirectoryMatch, nameKey, removePlayerFromSetup, searchDirectory } from '../src/domain/tournament';

describe('player directory helpers', () => {
  const dir = [
    { id: '1', full_name: 'أحمد السيد' },
    { id: '2', full_name: 'Lina Adel' },
    { id: '3', full_name: 'محمد أحمد' },
    { id: '4', full_name: 'مريم' },
  ];
  it('matches names regardless of hamza, spacing and case', () => {
    expect(nameKey('  احمد   السيد ')).toBe(nameKey('أحمد السيد'));
    expect(exactDirectoryMatch(dir, 'lina  adel')?.id).toBe('2');
    expect(exactDirectoryMatch(dir, 'لينا')).toBeUndefined();
  });
  it('searches prefix matches before contains matches', () => {
    expect(searchDirectory(dir, 'احمد').map((d) => d.id)).toEqual(['1', '3']);
    expect(searchDirectory(dir, '')).toEqual([]);
  });
  it('adds a player to the smallest group and refuses duplicates', () => {
    const t = createTournament({ ...base, playerNames: ['a', 'b', 'c'] });
    const id = addPlayerToSetup(t, 'Lina Adel', '2');
    expect(t.groups.map((g) => g.playerIds.length)).toEqual([2, 2]);
    expect(() => addPlayerToSetup(t, 'Lina Adel', '2')).toThrow('duplicate');
    removePlayerFromSetup(t, id);
    expect(t.players).toHaveLength(3);
    expect(t.groups.flatMap((g) => g.playerIds)).toHaveLength(3);
  });
});
