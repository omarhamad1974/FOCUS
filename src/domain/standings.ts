import { summarize } from './scoring';
import type { Match } from './types';

export interface StandingRow {
  playerId: string;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  /** Standings points: 1 per match win. */
  points: number;
  gamesWon: number;
  gamesLost: number;
  pointsWon: number;
  pointsLost: number;
  /** How this player's position against equal-points rivals was settled. */
  tiebreak: 'none' | 'headToHead' | 'gameDiff' | 'pointsDiff' | 'manual' | 'unresolved';
}

export interface Standings {
  rows: StandingRow[];
  /** Groups of players still tied after all rules (organizer must decide). */
  unresolved: string[][];
  complete: boolean;
}

type Tally = Omit<StandingRow, 'rank' | 'tiebreak'>;

function emptyTally(playerId: string): Tally {
  return { playerId, played: 0, wins: 0, losses: 0, points: 0, gamesWon: 0, gamesLost: 0, pointsWon: 0, pointsLost: 0 };
}

function tally(playerIds: string[], matches: Match[]): Map<string, Tally> {
  const map = new Map(playerIds.map((id) => [id, emptyTally(id)]));
  for (const m of matches) {
    const s = summarize(m);
    if (!s.winner || !m.aId || !m.bId) continue;
    const a = map.get(m.aId);
    const b = map.get(m.bId);
    if (!a || !b) continue;
    a.played++; b.played++;
    a.gamesWon += s.gamesA; a.gamesLost += s.gamesB;
    b.gamesWon += s.gamesB; b.gamesLost += s.gamesA;
    a.pointsWon += s.pointsA; a.pointsLost += s.pointsB;
    b.pointsWon += s.pointsB; b.pointsLost += s.pointsA;
    if (s.winner === 'a') { a.wins++; a.points++; b.losses++; }
    else { b.wins++; b.points++; a.losses++; }
  }
  return map;
}

function among(ids: string[], matches: Match[]): Match[] {
  const set = new Set(ids);
  return matches.filter((m) => m.aId && m.bId && set.has(m.aId) && set.has(m.bId));
}

/** Split `ids` into buckets of equal key, best key first. */
function bucket(ids: string[], key: (id: string) => number): string[][] {
  const sorted = [...ids].sort((x, y) => key(y) - key(x));
  const out: string[][] = [];
  for (const id of sorted) {
    const last = out[out.length - 1];
    if (last && key(last[0]) === key(id)) last.push(id);
    else out.push([id]);
  }
  return out;
}

type Resolved = { order: string[]; how: StandingRow['tiebreak']; unresolved: string[][] };

function headToHead(pair: string[], matches: Match[]): string[] | null {
  const m = among(pair, matches).find((x) => summarize(x).winner);
  if (!m) return null;
  const w = summarize(m).winner === 'a' ? m.aId! : m.bId!;
  return w === pair[0] ? pair : [pair[1], pair[0]];
}

/**
 * Settled rules:
 *  - exactly two tied players: head-to-head result decides;
 *  - three or more: game difference, then points difference, counted in the
 *    matches played among the tied players. If two remain level after that,
 *    their head-to-head decides; three or more still level go to the organizer.
 */
function resolveTie(ids: string[], matches: Match[]): Resolved {
  if (ids.length === 1) return { order: ids, how: 'none', unresolved: [] };
  if (ids.length === 2) {
    const h = headToHead(ids, matches);
    return h ? { order: h, how: 'headToHead', unresolved: [] } : { order: ids, how: 'unresolved', unresolved: [ids] };
  }
  const t = tally(ids, among(ids, matches));
  const gd = (id: string) => t.get(id)!.gamesWon - t.get(id)!.gamesLost;
  const pd = (id: string) => t.get(id)!.pointsWon - t.get(id)!.pointsLost;
  const order: string[] = [];
  const unresolved: string[][] = [];
  let how: StandingRow['tiebreak'] = 'gameDiff';
  for (const byGames of bucket(ids, gd)) {
    if (byGames.length === 1) { order.push(...byGames); continue; }
    if (byGames.length === 2) {
      const r = resolveTie(byGames, matches);
      order.push(...r.order); unresolved.push(...r.unresolved);
      continue;
    }
    how = 'pointsDiff';
    for (const byPoints of bucket(byGames, pd)) {
      if (byPoints.length === 1) { order.push(...byPoints); continue; }
      if (byPoints.length === 2) {
        const r = resolveTie(byPoints, matches);
        order.push(...r.order); unresolved.push(...r.unresolved);
        continue;
      }
      order.push(...byPoints);
      unresolved.push(byPoints);
    }
  }
  return { order, how, unresolved };
}

/**
 * Compute a group table. `manualOrder` is the organizer's order used only to
 * settle ties that the rules leave unresolved.
 */
export function computeStandings(playerIds: string[], matches: Match[], manualOrder: string[] = []): Standings {
  const t = tally(playerIds, matches);
  const rows: StandingRow[] = [];
  const unresolved: string[][] = [];
  const manualPos = (id: string) => {
    const i = manualOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  // Stable base order: entry order.
  for (const tied of bucket(playerIds, (id) => t.get(id)!.points)) {
    const r = resolveTie(tied, matches);
    let order = r.order;
    const stillOpen: string[][] = [];
    for (const group of r.unresolved) {
      if (group.every((id) => manualOrder.includes(id))) {
        const sortedGroup = [...group].sort((x, y) => manualPos(x) - manualPos(y));
        const start = Math.min(...group.map((id) => order.indexOf(id)));
        order = [...order];
        order.splice(start, group.length, ...sortedGroup);
      } else {
        stillOpen.push(group);
      }
    }
    unresolved.push(...stillOpen);
    const manualIds = new Set(r.unresolved.filter((g) => !stillOpen.includes(g)).flat());
    const openIds = new Set(stillOpen.flat());
    for (const id of order) {
      rows.push({
        ...t.get(id)!,
        rank: 0,
        tiebreak: tied.length === 1 ? 'none' : openIds.has(id) ? 'unresolved' : manualIds.has(id) ? 'manual' : r.how,
      });
    }
  }
  rows.forEach((row, i) => (row.rank = i + 1));
  const allPlayed = matches.every((m) => summarize(m).winner !== null);
  return { rows, unresolved, complete: allPlayed && unresolved.length === 0 };
}
