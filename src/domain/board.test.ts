import { describe, expect, it } from 'vitest';
import {
  addExtraPlayer, addPlayerToWaiting, boardSummary, createTournament, groupsVisible, publishGroups, startGroups,
} from './tournament';
import { moveToWaiting, waitingPlayers } from './simulate';

function seven() {
  return createTournament({
    name: 'ب', date: '2026-11-22', groupCount: 2,
    playerNames: ['1', '2', '3', '4', '5', '6', '7'],
    formats: { group: 3, early: 3, semi: 5, final: 5 }, consolation: { enabled: false, name: '' },
  });
}

describe('group board summary', () => {
  it('counts a filler twice and lists every group', () => {
    const t = seven();
    const [g1, g2] = t.groups;
    const before = boardSummary(t);
    expect(before.places).toBe(7);
    const short = before.groups.find((g) => g.count === 3)!;
    expect(short.short).toBe(true);
    const from = (short.id === g1.id ? g2 : g1).playerIds[0];
    addExtraPlayer(t, from, short.id);
    const s = boardSummary(t);
    expect(s.places).toBe(8);
    expect(s.placed).toBe(7);
    expect(s.extra).toBe(1);
    expect(s.groups.every((g) => g.count === 4 && !g.short)).toBe(true);
  });

  it('counts the waiting list apart', () => {
    const t = seven();
    moveToWaiting(t, t.groups[0].playerIds[0]);
    addPlayerToWaiting(t, 'جديد', 'dir-1', 'acc-1');
    const s = boardSummary(t);
    expect(s.waiting).toBe(2);
    expect(s.places).toBe(6);
    expect(waitingPlayers(t)).toHaveLength(2);
  });
});

describe('waiting list quick add', () => {
  it('refuses the same directory player or account twice', () => {
    const t = seven();
    addPlayerToWaiting(t, 'أ', 'dir-1', 'acc-1');
    expect(() => addPlayerToWaiting(t, 'أ', 'dir-1')).toThrow('duplicate');
    expect(() => addPlayerToWaiting(t, 'أ', undefined, 'acc-1')).toThrow('duplicate');
  });

  it('is closed once groups start', () => {
    const t = seven();
    startGroups(t);
    expect(() => addPlayerToWaiting(t, 'x')).toThrow('locked');
  });
});

describe('publishing groups', () => {
  it('hides the draw during setup until published, always shows it after the start', () => {
    const t = seven();
    expect(groupsVisible(t)).toBe(false);
    publishGroups(t);
    expect(groupsVisible(t)).toBe(true);
    publishGroups(t, false);
    expect(groupsVisible(t)).toBe(false);
    startGroups(t);
    expect(groupsVisible(t)).toBe(true);
  });
});
