import { bracketMatches, canEditKo, createBracket, type Seed, syncBracket } from './bracket';
import { checkMatch, isDone } from './scoring';
import { computeStandings, type Standings } from './standings';
import type { BestOf, Game, Group, Match, Player, Side, StageFormats, Tournament } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const GROUP_LETTERS = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ';

export function groupName(i: number): string {
  return GROUP_LETTERS[i] ?? String(i + 1);
}

export interface NewTournament {
  name: string;
  date: string;
  playerNames: string[];
  groupCount: number;
  formats: StageFormats;
  consolation: { enabled: boolean; name: string };
}

/** Snake distribution so the strongest entries (listed first) spread across groups. */
export function snakeGroups(playerIds: string[], groupCount: number): string[][] {
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  playerIds.forEach((id, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    groups[row % 2 === 0 ? col : groupCount - 1 - col].push(id);
  });
  return groups;
}

export function createTournament(input: NewTournament): Tournament {
  const players: Player[] = input.playerNames.map((name) => ({ id: uid(), name }));
  const groups: Group[] = snakeGroups(players.map((p) => p.id), input.groupCount).map((ids, i) => ({
    id: uid(), name: groupName(i), playerIds: ids, manualOrder: [],
  }));
  return {
    id: uid(),
    name: input.name,
    date: input.date,
    createdAt: new Date().toISOString(),
    players,
    formats: { ...input.formats },
    consolation: { ...input.consolation },
    groups,
    matches: {},
    brackets: [],
    stage: 'setup',
  };
}

/** Copy settings and players into a brand-new tournament with no results. */
export function duplicateTournament(t: Tournament, name: string): Tournament {
  const idMap = new Map(t.players.map((p) => [p.id, uid()]));
  return {
    id: uid(),
    name,
    date: t.date,
    createdAt: new Date().toISOString(),
    players: t.players.map((p) => ({ id: idMap.get(p.id)!, name: p.name })),
    formats: { ...t.formats },
    consolation: { ...t.consolation },
    groups: t.groups.map((g) => ({ id: uid(), name: g.name, playerIds: g.playerIds.map((id) => idMap.get(id)!), manualOrder: [] })),
    matches: {},
    brackets: [],
    stage: 'setup',
  };
}

export function movePlayer(t: Tournament, playerId: string, toGroupId: string, index?: number): void {
  if (t.stage !== 'setup') throw new Error('locked');
  for (const g of t.groups) g.playerIds = g.playerIds.filter((id) => id !== playerId);
  const target = t.groups.find((g) => g.id === toGroupId)!;
  const i = index === undefined ? target.playerIds.length : Math.min(index, target.playerIds.length);
  target.playerIds.splice(i, 0, playerId);
}

/** Round-robin order (circle method) so players rest between matches. */
export function roundRobin(ids: string[]): [string, string][] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const out: [string, string][] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) out.push(r % 2 ? [b, a] : [a, b]);
    }
    list.splice(1, 0, list.pop()!);
  }
  return out;
}

export function startGroups(t: Tournament): void {
  if (t.groups.some((g) => g.playerIds.length < 2)) throw new Error('smallGroup');
  t.matches = {};
  for (const g of t.groups) {
    roundRobin(g.playerIds).forEach(([a, b], i) => {
      const id = `${g.id}-${i}`;
      t.matches[id] = { id, stage: 'group', groupId: g.id, aId: a, bId: b, bestOf: t.formats.group, games: [], walkover: null, history: [] };
    });
  }
  t.stage = 'groups';
}

export function groupMatches(t: Tournament, groupId: string): Match[] {
  return Object.values(t.matches).filter((m) => m.groupId === groupId);
}

export function groupStandings(t: Tournament, g: Group): Standings {
  return computeStandings(g.playerIds, groupMatches(t, g.id), g.manualOrder);
}

export function groupsComplete(t: Tournament): boolean {
  return t.groups.every((g) => groupStandings(t, g).complete);
}

export type SaveError = ReturnType<typeof checkMatch> | { ok: false; error: 'locked' };

/** Save (or correct) a match result. Earlier results are kept in history. */
export function saveResult(t: Tournament, matchId: string, games: Game[], walkover: Side | null): SaveError {
  const m = t.matches[matchId];
  if (m.stage === 'group' && t.stage !== 'groups') return { ok: false, error: 'locked' };
  if (m.stage === 'ko') {
    const b = t.brackets.find((x) => x.id === m.bracketId)!;
    if (!canEditKo(m, b, t.matches) || !m.aId || !m.bId) return { ok: false, error: 'locked' };
  }
  if (!walkover) {
    const check = checkMatch(games, m.bestOf);
    if (!check.ok) return check;
  }
  if (m.games.length || m.walkover) {
    m.history.push({ at: new Date().toISOString(), games: m.games, walkover: m.walkover });
  }
  m.games = walkover ? [] : games.map((g) => ({ a: g.a, b: g.b }));
  m.walkover = walkover;
  if (m.stage === 'group') {
    // A changed result may change which ties exist: clear manual decisions.
    const g = t.groups.find((x) => x.id === m.groupId)!;
    g.manualOrder = [];
  } else {
    syncBracket(t.brackets.find((x) => x.id === m.bracketId)!, t.matches);
  }
  return { ok: true };
}

export function startKnockout(t: Tournament): void {
  if (!groupsComplete(t)) throw new Error('groupsOpen');
  const tables = t.groups.map((g) => ({ g, rows: groupStandings(t, g).rows }));
  const at = (rank: number): Seed[] =>
    tables.filter(({ rows }) => rows[rank]).map(({ g, rows }) => ({ playerId: rows[rank].playerId, groupId: g.id }));
  t.brackets = [createBracket(uid(), 'main', '', [...at(0), ...at(1)], t.formats, t.matches)];
  const cons = [...at(2), ...at(3)];
  if (t.consolation.enabled && cons.length >= 2) {
    t.brackets.push(createBracket(uid(), 'consolation', t.consolation.name, cons, t.formats, t.matches));
  }
  t.stage = 'knockout';
}

export function playerName(t: Tournament, id: string | null): string {
  if (!id) return '';
  return t.players.find((p) => p.id === id)?.name ?? '';
}

export function progress(t: Tournament): { done: number; total: number } {
  const ms = t.stage === 'knockout'
    ? t.brackets.flatMap((b) => bracketMatches(b, t.matches)).filter((m) => m.aId && m.bId)
    : Object.values(t.matches).filter((m) => m.stage === 'group');
  return { done: ms.filter(isDone).length, total: ms.length };
}

export function formatsSummary(f: StageFormats): BestOf[] {
  return [f.group, f.early, f.semi, f.final];
}
