import { describe, expect, it } from 'vitest';


describe('home slider', () => {
  it('lists running tournaments and recent champions', async () => {
    const { sampleTournament } = await import('./sample');
    const { homeTournaments, topTwo } = await import('./tournament');
    const done = sampleTournament('finished', 3, 16, 4);
    const running = sampleTournament('groupsHalf', 4, 8, 2);
    const setup = sampleTournament('setup', 5, 8, 2);
    const old = sampleTournament('finished', 6, 8, 2);
    old.date = '2020-01-01';
    done.date = new Date().toISOString().slice(0, 10);
    const top = topTwo(done)!;
    expect(top.first).not.toBe(top.second);
    expect(topTwo(running)).toBeNull();
    const h = homeTournaments([done, running, setup, old]);
    expect(h.live.map((x) => x.id)).toEqual([running.id]);
    expect(h.recent.map((x) => x.id)).toEqual([done.id]);
  });
});
