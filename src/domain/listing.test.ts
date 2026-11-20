import { describe, expect, it } from 'vitest';
import { sampleTournament } from './sample';
import { daysUntil, publicStatus, sortForListing } from './tournament';

describe('tournament listing', () => {
  it('labels and orders tournaments by status', () => {
    const done = sampleTournament('finished', 1, 8, 2);
    const running = sampleTournament('groupsHalf', 2, 8, 2);
    const upcoming = sampleTournament('setup', 3, 8, 2);
    const open = sampleTournament('setup', 4, 8, 2);
    open.registration = { open: true, autoAccept: false, maxPlayers: null };
    upcoming.registration = { open: false, autoAccept: false, maxPlayers: null };
    expect(publicStatus(done)).toBe('finished');
    expect(publicStatus(running)).toBe('running');
    expect(publicStatus(upcoming)).toBe('upcoming');
    expect(publicStatus(open)).toBe('open');
    expect(sortForListing([done, upcoming, running, open]).map(publicStatus)).toEqual(['open', 'running', 'upcoming', 'finished']);
  });

  it('counts days to the tournament date', () => {
    const tm = sampleTournament('setup', 5, 8, 2);
    const now = new Date(2026, 10, 20, 15, 0);
    tm.date = '2026-11-25';
    expect(daysUntil(tm, now)).toBe(5);
    tm.date = '2026-11-20';
    expect(daysUntil(tm, now)).toBe(0);
    tm.date = '';
    expect(daysUntil(tm, now)).toBeNull();
  });
});

describe('time and location filters', () => {
  it('filters by date window and place', async () => {
    const { matchesTime, matchesLocation, tournamentLocations } = await import('./tournament');
    const now = new Date(2026, 10, 20, 9, 0);
    const a = sampleTournament('setup', 7, 8, 2); a.date = '2026-11-24'; a.location = 'نادي الزمالك';
    const b = sampleTournament('setup', 8, 8, 2); b.date = '2026-12-15'; b.location = ' نادي  الزمالك ';
    const c = sampleTournament('setup', 9, 8, 2); c.date = '2026-10-01'; c.location = 'الإسكندرية';
    expect([a, b, c].filter((x) => matchesTime(x, 'week', now))).toEqual([a]);
    expect([a, b, c].filter((x) => matchesTime(x, 'month', now))).toEqual([a, b]);
    expect([a, b, c].filter((x) => matchesTime(x, 'past', now))).toEqual([c]);
    expect(tournamentLocations([a, b, c])).toEqual(['الإسكندرية', 'نادي الزمالك']);
    expect([a, b, c].filter((x) => matchesLocation(x, 'نادي الزمالك'))).toEqual([a, b]);
  });
});
