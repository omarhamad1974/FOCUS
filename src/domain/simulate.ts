/**
 * Step-by-step tournament simulation for organizers: add random players to the
 * waiting list, place them in groups (by hand or at random), then play random
 * results round by round until the final. Every step uses the normal rules
 * (best of 3/5 per stage, walkovers, 1st/2nd qualify, 3rd/4th to class B).
 */
import { bracketMatches, roundName, type RoundName } from './bracket';
import { randomResult, sampleNames } from './sample';
import { hasResult, summarize } from './scoring';
import { groupMatches, groupStandings, groupsComplete, isExtra, roundRobinRounds, saveResult, topTwo, uid } from './tournament';
import type { Match, Tournament } from './types';

export type Rand = () => number;

/** Players who are in the tournament but not in any group yet. */
export function waitingPlayers(t: Tournament): string[] {
  const placed = new Set(t.groups.flatMap((g) => g.playerIds));
  return t.players.filter((p) => !placed.has(p.id)).map((p) => p.id);
}

/** A registered demo person (account with a real-looking photo) the simulation may use. */
export interface SimPerson { name: string; accountId: string }

/**
 * Add `count` random players to the waiting list (names not already in the tournament). Setup stage only.
 * When `people` are given (registered demo players with photos), they are used first, in random
 * order, so the simulated players show real faces; plain names fill the rest.
 */
export function addRandomPlayers(t: Tournament, count: number, seed = Date.now(), people: SimPerson[] = []): string[] {
  if (t.stage !== 'setup') throw new Error('locked');
  const taken = new Set(t.players.map((p) => p.name));
  const accounts = new Set(t.players.map((p) => p.accountId ?? p.profileId).filter(Boolean));
  const ids: string[] = [];
  let r = seed % 2147483647 || 1;
  const rand = () => (r = (r * 48271) % 2147483647) / 2147483647;
  const pool = people.filter((p) => !accounts.has(p.accountId) && !taken.has(p.name))
    .map((p) => ({ p, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  for (const p of pool.slice(0, count)) {
    const id = uid();
    t.players.push({ id, name: p.name, accountId: p.accountId });
    taken.add(p.name);
    ids.push(id);
  }
  const rest = count - ids.length;
  if (rest > 0) {
    const names = sampleNames(rest + taken.size + 8, seed).filter((x) => !taken.has(x)).slice(0, rest);
    for (const name of names) {
      const id = uid();
      t.players.push({ id, name });
      ids.push(id);
    }
  }
  return ids;
}

/** Take a player out of every group and back to the waiting list. Setup stage only. */
export function moveToWaiting(t: Tournament, playerId: string): void {
  if (t.stage !== 'setup') throw new Error('locked');
  for (const g of t.groups) {
    g.playerIds = g.playerIds.filter((id) => id !== playerId);
    if (g.extraIds) { g.extraIds = g.extraIds.filter((id) => id !== playerId); if (!g.extraIds.length) delete g.extraIds; }
  }
}

/** Put every waiting player in a group at random, always into one of the smallest groups. */
export function distributeWaiting(t: Tournament, rand: Rand = Math.random): number {
  if (t.stage !== 'setup') throw new Error('locked');
  if (!t.groups.length) return 0;
  const waiting = waitingPlayers(t);
  for (let i = waiting.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [waiting[i], waiting[j]] = [waiting[j], waiting[i]];
  }
  // Fillers play in a second group but do not count for its size here.
  const size = (g: Tournament['groups'][number]) => g.playerIds.filter((id) => !isExtra(g, id)).length;
  for (const id of waiting) {
    const min = Math.min(...t.groups.map(size));
    const smallest = t.groups.filter((g) => size(g) === min);
    smallest[Math.floor(rand() * smallest.length)].playerIds.push(id);
  }
  return waiting.length;
}

/** Random result for one match, saved through the normal rules. About 1 match in 20 is a walkover. */
export function playRandom(t: Tournament, m: Match, rand: Rand = Math.random): void {
  if (rand() < 0.05) { saveResult(t, m.id, [], rand() < 0.5 ? 'a' : 'b'); return; }
  const games = randomResult(rand, m.bestOf);
  if (t.pointsPerGame) { saveResult(t, m.id, games, null); return; }
  const s = summarize({ games, bestOf: m.bestOf, walkover: null });
  saveResult(t, m.id, [], null, { a: s.gamesA, b: s.gamesB });
}

/** Round number (0-based) of every group match, following the round-robin order. */
export function groupRounds(t: Tournament): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of t.groups) {
    roundRobinRounds(g.playerIds).forEach(([, , r], i) => out.set(`${g.id}-${i}`, r));
  }
  return out;
}

export interface RoundInfo {
  /** Round to play next (0-based), or null when nothing is left. */
  next: number | null;
  total: number;
}

export function groupRoundInfo(t: Tournament): RoundInfo {
  const rounds = groupRounds(t);
  let total = 0;
  let next: number | null = null;
  for (const m of Object.values(t.matches)) {
    if (m.stage !== 'group') continue;
    const r = rounds.get(m.id) ?? 0;
    total = Math.max(total, r + 1);
    if (!hasResult(m) && (next === null || r < next)) next = r;
  }
  return { next, total };
}

/** Play every unplayed group match of the next round in every group. Returns the round played, or null. */
export function simGroupRound(t: Tournament, rand: Rand = Math.random): number | null {
  if (t.stage !== 'groups') return null;
  const { next } = groupRoundInfo(t);
  if (next === null) return null;
  const rounds = groupRounds(t);
  for (const m of Object.values(t.matches)) {
    if (m.stage === 'group' && !hasResult(m) && rounds.get(m.id) === next) playRandom(t, m, rand);
  }
  settleTies(t);
  return next;
}

/** Ties the rules leave open are settled in table order, as an organizer would decide. */
export function settleTies(t: Tournament): void {
  for (const g of t.groups) {
    if (!groupMatches(t, g.id).every(hasResult)) continue;
    const s = groupStandings(t, g);
    if (s.unresolved.length) g.manualOrder = s.rows.map((x) => x.playerId);
  }
}

export function groupsReady(t: Tournament): boolean {
  return t.stage === 'groups' && groupsComplete(t);
}

/** Knockout matches ready to play now, grouped by the earliest round that has any. */
function playableKo(t: Tournament): { round: number; matches: Match[]; name: RoundName } | null {
  let best: { round: number; matches: Match[]; name: RoundName; fromEnd: number } | null = null;
  for (const b of t.brackets) {
    const total = b.rounds.length;
    for (const m of bracketMatches(b, t.matches)) {
      if (!m.aId || !m.bId || hasResult(m)) continue;
      // The third-place playoff is played with the final.
      const round = m.round === -1 ? total - 1 : m.round!;
      const fromEnd = total - 1 - round;
      if (!best || fromEnd > best.fromEnd) best = { round, matches: [m], name: roundName(round, total), fromEnd };
      else if (fromEnd === best.fromEnd) best.matches.push(m);
    }
  }
  return best && { round: best.round, matches: best.matches, name: best.name };
}

/** Name of the next knockout round to play (in every draw), or null when the knockout is over. */
export function nextKoRound(t: Tournament): RoundName | null {
  return t.stage === 'knockout' ? playableKo(t)?.name ?? null : null;
}

/**
 * Play the next knockout round in every draw at once (main and class B). Rounds
 * are matched by distance from the final, so a smaller class B draw catches up.
 */
export function simKoRound(t: Tournament, rand: Rand = Math.random): RoundName | null {
  if (t.stage !== 'knockout') return null;
  const next = playableKo(t);
  if (!next) return null;
  for (const m of next.matches) playRandom(t, m, rand);
  return next.name;
}

export function finished(t: Tournament): boolean {
  return t.stage === 'knockout' && !!topTwo(t) && !playableKo(t);
}
