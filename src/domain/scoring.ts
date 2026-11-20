import type { BestOf, Game, GamesResult, Match, Side } from './types';

export const GAME_POINTS = 11;

export type GameCheck = 'ok' | 'empty' | 'negative' | 'notFinished' | 'badMargin';

/**
 * A game ends when a player reaches 11 with a lead of at least 2.
 * Past 10–10 the winner must lead by exactly 2 (e.g. 12–10, 15–13).
 */
export function checkGame(g: Game): GameCheck {
  if (!Number.isInteger(g.a) || !Number.isInteger(g.b)) return 'empty';
  if (g.a < 0 || g.b < 0) return 'negative';
  const hi = Math.max(g.a, g.b);
  const lo = Math.min(g.a, g.b);
  if (hi < GAME_POINTS || hi - lo < 2) return 'notFinished';
  if (hi > GAME_POINTS && hi - lo !== 2) return 'badMargin';
  return 'ok';
}

export function gamesToWin(bestOf: BestOf): number {
  return Math.ceil(bestOf / 2);
}

export interface MatchSummary {
  gamesA: number;
  gamesB: number;
  pointsA: number;
  pointsB: number;
  winner: Side | null;
}

export function summarize(m: Pick<Match, 'games' | 'bestOf' | 'walkover' | 'result'>): MatchSummary {
  if (m.walkover) {
    const need = gamesToWin(m.bestOf);
    const w = m.walkover === 'a';
    return {
      gamesA: w ? need : 0,
      gamesB: w ? 0 : need,
      pointsA: w ? need * GAME_POINTS : 0,
      pointsB: w ? 0 : need * GAME_POINTS,
      winner: m.walkover,
    };
  }
  if (m.result && !m.games.length) {
    const need = gamesToWin(m.bestOf);
    const { a, b } = m.result;
    return { gamesA: a, gamesB: b, pointsA: 0, pointsB: 0, winner: a >= need ? 'a' : b >= need ? 'b' : null };
  }
  let gamesA = 0, gamesB = 0, pointsA = 0, pointsB = 0;
  for (const g of m.games) {
    pointsA += g.a;
    pointsB += g.b;
    if (g.a > g.b) gamesA++;
    else gamesB++;
  }
  const need = gamesToWin(m.bestOf);
  const winner: Side | null = gamesA >= need ? 'a' : gamesB >= need ? 'b' : null;
  return { gamesA, gamesB, pointsA, pointsB, winner };
}

export type MatchCheck =
  | { ok: true }
  | { ok: false; error: 'game'; index: number; reason: GameCheck }
  | { ok: false; error: 'extraGames' | 'notDecided' | 'tooManyGames' };

/** Validate a full set of games for a finished match. */
export function checkMatch(games: Game[], bestOf: BestOf): MatchCheck {
  if (games.length > bestOf) return { ok: false, error: 'tooManyGames' };
  const need = gamesToWin(bestOf);
  let a = 0, b = 0;
  for (let i = 0; i < games.length; i++) {
    if (a >= need || b >= need) return { ok: false, error: 'extraGames' };
    const r = checkGame(games[i]);
    if (r !== 'ok') return { ok: false, error: 'game', index: i, reason: r };
    if (games[i].a > games[i].b) a++;
    else b++;
  }
  if (a < need && b < need) return { ok: false, error: 'notDecided' };
  return { ok: true };
}

/** All possible final results in games for a format, e.g. best of 5 → 3-0, 3-1, 3-2. */
export function possibleResults(bestOf: BestOf): number[] {
  const need = gamesToWin(bestOf);
  return Array.from({ length: need }, (_, i) => i);
}

/** Validate a result entered in games only (e.g. 3-1 in best of 5). */
export function checkResult(r: GamesResult, bestOf: BestOf): MatchCheck {
  const need = gamesToWin(bestOf);
  if (![r.a, r.b].every((x) => Number.isInteger(x) && x >= 0)) return { ok: false, error: 'notDecided' };
  const hi = Math.max(r.a, r.b), lo = Math.min(r.a, r.b);
  if (hi < need) return { ok: false, error: 'notDecided' };
  if (hi > need || lo >= need) return { ok: false, error: 'tooManyGames' };
  return { ok: true };
}

/** A result (points per game, games only, or walkover) has been saved. */
export function hasResult(m: Pick<Match, 'games' | 'walkover' | 'result'>): boolean {
  return m.games.length > 0 || !!m.walkover || !!m.result;
}

/** The match has a result whose game points are not known (games only). */
export function pointsUnknown(m: Pick<Match, 'games' | 'walkover' | 'result'>): boolean {
  return !m.walkover && !m.games.length && !!m.result;
}

export function isDone(m: Match): boolean {
  return summarize(m).winner !== null;
}

export function winnerId(m: Match): string | null {
  const w = summarize(m).winner;
  if (!w) return null;
  return w === 'a' ? m.aId : m.bId;
}

export function loserId(m: Match): string | null {
  const w = summarize(m).winner;
  if (!w) return null;
  return w === 'a' ? m.bId : m.aId;
}
