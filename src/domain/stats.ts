/**
 * Player statistics across tournaments, computed from the tournaments already
 * loaded in the app (no extra tables): wins, losses, win rate, games, recent
 * form, finish in each tournament and a simple ranking across players.
 *
 * A player is followed by their account (accountId, else profileId), so typed
 * players without an account have no profile stats.
 *
 * Walkovers follow the project rules: the winner gets a straight-games win
 * (3-0, or 2-0 in best of 3) and the other player a loss. Byes (no opponent)
 * are not matches and are not counted.
 */
import { placements, roundName, type RoundName } from './bracket';
import { summarize } from './scoring';
import { accountOf, groupStandings, isExtra, publicStatus } from './tournament';
import type { Bracket, Match, Tournament } from './types';

/** How far a player went in one tournament. */
export type Finish =
  | { kind: 'place'; place: 1 | 2 | 3 | 4; bracket: 'main' | 'consolation'; bracketName: string }
  /** Lost in a knockout round (or still playing in it when `alive`). */
  | { kind: 'round'; round: RoundName; bracket: 'main' | 'consolation'; bracketName: string; alive: boolean }
  /** Out after the groups (or still playing them when `alive`), with the group rank. */
  | { kind: 'group'; rank: number; alive: boolean }
  /** Registered; the tournament has not started. */
  | { kind: 'registered' };

export interface TournamentLine {
  tournamentId: string;
  name: string;
  date: string;
  finished: boolean;
  finish: Finish;
  wins: number;
  losses: number;
}

export interface MatchLine {
  tournamentId: string;
  matchId: string;
  opponentName: string;
  opponentAccount?: string;
  won: boolean;
  /** Games of this player first, e.g. 3-1. */
  games: [number, number];
  walkover: boolean;
  /** Date of the tournament (matches have no time of their own). */
  date: string;
}

export interface PlayerStats {
  accountId: string;
  played: number;
  wins: number;
  losses: number;
  /** 0–100, rounded; null before the first match. */
  winRate: number | null;
  gamesWon: number;
  gamesLost: number;
  walkoverWins: number;
  titles: number;
  runnerUps: number;
  podiums: number;
  tournaments: TournamentLine[];
  /** Latest matches first. */
  recent: MatchLine[];
  /** Current run of wins (positive) or losses (negative), latest matches first. */
  streak: number;
  /** Ranking points, see `rankingPoints`. */
  points: number;
}

/** Bonus ranking points for a finish in the main draw (consolation earns half, rounded down). */
export const PLACE_BONUS: Record<1 | 2 | 3 | 4, number> = { 1: 10, 2: 6, 3: 4, 4: 3 };

/** Ranking points: 1 per match win, plus a bonus for each top-4 finish. */
export function rankingPoints(wins: number, lines: TournamentLine[]): number {
  return wins + lines.reduce((sum, l) => {
    if (l.finish.kind !== 'place') return sum;
    const b = PLACE_BONUS[l.finish.place];
    return sum + (l.finish.bracket === 'main' ? b : Math.floor(b / 2));
  }, 0);
}

const when = (t: Tournament) => new Date(t.date || t.createdAt).getTime() || 0;

/** Player ids (inside one tournament) that belong to an account. */
function idsOf(t: Tournament, account: string): Set<string> {
  return new Set(t.players.filter((p) => accountOf(p) === account).map((p) => p.id));
}

function finishIn(t: Tournament, pids: Set<string>): Finish {
  if (t.stage === 'setup') return { kind: 'registered' };
  const has = (id: string | null) => !!id && pids.has(id);
  // Knockout first: main draw, then the consolation draw.
  const order: Bracket[] = [...t.brackets].sort((a, b) => (a.kind === 'main' ? -1 : 0) - (b.kind === 'main' ? -1 : 0));
  for (const b of order) {
    const kind = b.kind;
    const place = placements(b, t.matches).find((p) => has(p.playerId));
    if (place) return { kind: 'place', place: place.place as 1 | 2 | 3 | 4, bracket: kind, bracketName: b.name };
    // Furthest round the player reached in this draw.
    let reached = -1;
    let lost = false;
    b.rounds.forEach((ids, r) => ids.forEach((id) => {
      const m = t.matches[id];
      if (!m || !(has(m.aId) || has(m.bId))) return;
      if (r >= reached) {
        reached = r;
        const s = summarize(m);
        lost = !!s.winner && !!m.aId && !!m.bId && !has(s.winner === 'a' ? m.aId : m.bId);
      }
    }));
    if (reached >= 0) {
      // Losing a semifinal sends the player to the third-place match: still alive until it is played.
      const semiLoser = lost && roundName(reached, b.rounds.length) === 'semi' && !!b.thirdPlaceId;
      return { kind: 'round', round: roundName(reached, b.rounds.length), bracket: kind, bracketName: b.name, alive: !lost || semiLoser };
    }
  }
  const g = t.groups.find((x) => x.playerIds.some((id) => has(id) && !isExtra(x, id)));
  if (g) {
    const row = groupStandings(t, g).rows.filter((r) => !isExtra(g, r.playerId)).findIndex((r) => has(r.playerId));
    return { kind: 'group', rank: row + 1, alive: t.stage === 'groups' };
  }
  return { kind: 'registered' };
}

/** Played matches with a result and two players, in a stable order (groups, then knockout rounds). */
function playedMatches(t: Tournament): Match[] {
  const ko = (m: Match) => (m.stage === 'group' ? -1 : m.round === -1 ? 999 : m.round ?? 0);
  return Object.values(t.matches)
    .filter((m) => m.aId && m.bId && summarize(m).winner)
    .sort((a, b) => ko(a) - ko(b));
}

/** Statistics of one account across tournaments. */
export function playerStats(list: Tournament[], account: string): PlayerStats {
  const s: PlayerStats = {
    accountId: account, played: 0, wins: 0, losses: 0, winRate: null, gamesWon: 0, gamesLost: 0, walkoverWins: 0,
    titles: 0, runnerUps: 0, podiums: 0, tournaments: [], recent: [], streak: 0, points: 0,
  };
  const all: MatchLine[] = [];
  for (const t of [...list].sort((a, b) => when(a) - when(b))) {
    const pids = idsOf(t, account);
    if (!pids.size) continue;
    let w = 0, l = 0;
    for (const m of playedMatches(t)) {
      const mine = pids.has(m.aId!) ? 'a' : pids.has(m.bId!) ? 'b' : null;
      if (!mine) continue;
      const r = summarize(m);
      const won = r.winner === mine;
      const opp = t.players.find((p) => p.id === (mine === 'a' ? m.bId : m.aId));
      const games: [number, number] = mine === 'a' ? [r.gamesA, r.gamesB] : [r.gamesB, r.gamesA];
      if (won) w++; else l++;
      if (won && m.walkover) s.walkoverWins++;
      s.gamesWon += games[0];
      s.gamesLost += games[1];
      all.push({ tournamentId: t.id, matchId: m.id, opponentName: opp?.name ?? '', opponentAccount: opp ? accountOf(opp) : undefined, won, games, walkover: !!m.walkover, date: t.date });
    }
    const finish = finishIn(t, pids);
    if (finish.kind === 'place' && finish.bracket === 'main') {
      if (finish.place === 1) s.titles++;
      if (finish.place === 2) s.runnerUps++;
      if (finish.place <= 3) s.podiums++;
    }
    s.wins += w;
    s.losses += l;
    s.tournaments.push({ tournamentId: t.id, name: t.name, date: t.date, finished: publicStatus(t) === 'finished', finish, wins: w, losses: l });
  }
  s.played = s.wins + s.losses;
  s.winRate = s.played ? Math.round((s.wins / s.played) * 100) : null;
  s.recent = all.reverse();
  for (const m of s.recent) {
    if (s.streak === 0) s.streak = m.won ? 1 : -1;
    else if (m.won === s.streak > 0) s.streak += s.streak > 0 ? 1 : -1;
    else break;
  }
  s.tournaments.reverse();
  s.points = rankingPoints(s.wins, s.tournaments);
  return s;
}

export interface RankRow {
  accountId: string;
  /** Name as written in the latest tournament (the profile name is shown when known). */
  name: string;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  played: number;
  winRate: number | null;
  titles: number;
}

/**
 * Ranking of every account that played at least one match: ranking points,
 * then win rate, then more wins, then fewer losses. Equal players share a rank.
 */
export function ranking(list: Tournament[]): RankRow[] {
  const names = new Map<string, string>();
  for (const t of [...list].sort((a, b) => when(a) - when(b))) {
    for (const p of t.players) { const a = accountOf(p); if (a) names.set(a, p.name); }
  }
  const rows: RankRow[] = [];
  for (const [acc, name] of names) {
    const s = playerStats(list, acc);
    if (!s.played) continue;
    rows.push({ accountId: acc, name, rank: 0, points: s.points, wins: s.wins, losses: s.losses, played: s.played, winRate: s.winRate, titles: s.titles });
  }
  const cmp = (a: RankRow, b: RankRow) => b.points - a.points || (b.winRate ?? 0) - (a.winRate ?? 0) || b.wins - a.wins || a.losses - b.losses;
  rows.sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'ar'));
  rows.forEach((r, i) => { r.rank = i > 0 && cmp(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}
