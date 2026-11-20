import { describe, expect, it } from 'vitest';
import { duplicateTournament, groupOf, numberTables, setGroupTable } from './tournament';
import { sampleTournament } from './sample';

describe('group tables', () => {
  it('sets, edits and clears a table at any stage', () => {
    const t = sampleTournament('groupsHalf', 1, 8, 2);
    const g = t.groups[0];
    setGroupTable(t, g.id, '  ٣ ');
    expect(g.table).toBe('3');
    setGroupTable(t, g.id, 'الصالة   الكبرى');
    expect(g.table).toBe('الصالة الكبرى');
    setGroupTable(t, g.id, 'x'.repeat(50));
    expect(g.table).toHaveLength(20);
    setGroupTable(t, g.id, ' ');
    expect('table' in g).toBe(false);
  });

  it('numbers tables in group order and keeps them on a copy', () => {
    const t = sampleTournament('setup', 2, 12, 3);
    expect(t.groups.every((g) => g.table === undefined)).toBe(true);
    numberTables(t);
    expect(t.groups.map((g) => g.table)).toEqual(['1', '2', '3']);
    expect(duplicateTournament(t, 'copy').groups.map((g) => g.table)).toEqual(['1', '2', '3']);
  });

  it('finds the group of a player', () => {
    const t = sampleTournament('setup', 3, 8, 2);
    const pid = t.groups[1].playerIds[0];
    expect(groupOf(t, pid)?.id).toBe(t.groups[1].id);
    expect(groupOf(t, 'nobody')).toBeUndefined();
  });
});
