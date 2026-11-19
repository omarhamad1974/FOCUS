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

export const DEFAULT_REGISTRATION = { open: false, autoAccept: false, maxPlayers: null } as const;

export function registrationOf(t: Tournament): NonNullable<Tournament['registration']> {
  return t.registration ?? { ...DEFAULT_REGISTRATION };
}

export interface Registrant {
  profileId: string;
  name: string;
  directoryId?: string;
}

/**
 * Close online registration: add approved registrants who are not in the
 * tournament yet, drop website players who are no longer approved, and
 * redistribute everyone into groups. Only allowed before the groups start.
 */
export function closeRegistration(t: Tournament, approved: Registrant[]): void {
  if (t.stage !== 'setup') throw new Error('locked');
  const keep = new Set(approved.map((r) => r.profileId));
  t.players = t.players.filter((p) => !p.profileId || keep.has(p.profileId));
  for (const r of approved) {
    if (!t.players.some((p) => p.profileId === r.profileId || (r.directoryId && p.directoryId === r.directoryId))) {
      t.players.push({ id: uid(), name: r.name, profileId: r.profileId, directoryId: r.directoryId, accountId: r.profileId });
    }
  }
  t.registration = { ...registrationOf(t), open: false };
  snakeGroups(t.players.map((p) => p.id), t.groups.length).forEach((ids, i) => {
    t.groups[i].playerIds = ids;
    t.groups[i].manualOrder = [];
  });
}

/** Status column stored in Supabase (drives who can see and join). */
export function remoteStatus(t: Tournament): 'draft' | 'registration' | 'running' | 'finished' {
  if (t.stage === 'setup') return registrationOf(t).open ? 'registration' : 'draft';
  const main = t.brackets.find((b) => b.kind === 'main');
  if (main) {
    const final = t.matches[main.rounds[main.rounds.length - 1][0]];
    if (final && (final.games.length || final.walkover)) return 'finished';
  }
  return 'running';
}

/** Add one player during setup; they go into the smallest group. */
export function addPlayerToSetup(t: Tournament, name: string, directoryId?: string, accountId?: string): string {
  if (t.stage !== 'setup') throw new Error('locked');
  if (directoryId && t.players.some((p) => p.directoryId === directoryId)) throw new Error('duplicate');
  const id = uid();
  t.players.push({ id, name, directoryId, ...(accountId ? { accountId } : {}) });
  const smallest = [...t.groups].sort((a, b) => a.playerIds.length - b.playerIds.length)[0];
  smallest.playerIds.push(id);
  return id;
}

export function removePlayerFromSetup(t: Tournament, playerId: string): void {
  if (t.stage !== 'setup') throw new Error('locked');
  t.players = t.players.filter((p) => p.id !== playerId);
  for (const g of t.groups) g.playerIds = g.playerIds.filter((id) => id !== playerId);
}

/** Compare names loosely: spacing, case and Arabic letter variants (أ/إ/آ → ا, ى → ي, ة → ه). */
export function nameKey(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u0652]/g, '');
}

export interface DirectoryEntry {
  id: string;
  full_name: string;
}

/** Directory entries whose name matches `query` (prefix or contains), best first. */
export function searchDirectory<T extends DirectoryEntry>(dir: T[], query: string, limit = 8): T[] {
  const q = nameKey(query);
  if (!q) return [];
  const scored = dir
    .map((d) => {
      const k = nameKey(d.full_name);
      return { d, score: k === q ? 0 : k.startsWith(q) ? 1 : k.includes(q) ? 2 : 9 };
    })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score || a.d.full_name.localeCompare(b.d.full_name, 'ar'));
  return scored.slice(0, limit).map((x) => x.d);
}

/** The directory entry with exactly this name (loosely compared), if any. */
export function exactDirectoryMatch<T extends DirectoryEntry>(dir: T[], name: string): T | undefined {
  const k = nameKey(name);
  return dir.find((d) => nameKey(d.full_name) === k);
}

/** Account behind a player, for photos. */
export const accountOf = (p: { accountId?: string; profileId?: string }) => p.accountId ?? p.profileId;

/** Champion and runner-up of the main draw, once the final is played. */
export function topTwo(t: Tournament): { first: string; second: string } | null {
  const main = t.brackets.find((b) => b.kind === 'main');
  if (!main) return null;
  const final = t.matches[main.rounds[main.rounds.length - 1][0]];
  if (!final?.aId || !final.bId) return null;
  const s = summarizeMatch(final);
  if (!s) return null;
  return s === 'a' ? { first: final.aId, second: final.bId } : { first: final.bId, second: final.aId };
}

function summarizeMatch(m: Match): Side | null {
  if (m.walkover) return m.walkover;
  const need = Math.ceil(m.bestOf / 2);
  let a = 0, b = 0;
  for (const g of m.games) { if (g.a > g.b) a++; else if (g.b > g.a) b++; }
  return a >= need ? 'a' : b >= need ? 'b' : null;
}

/** Tournaments for the home slider: open or running ones, and ones that ended in the last `days` days. */
export function homeTournaments(list: Tournament[], now = new Date(), days = 30): { live: Tournament[]; recent: Tournament[] } {
  const since = now.getTime() - days * 86_400_000;
  const live: Tournament[] = [], recent: Tournament[] = [];
  for (const t of list) {
    if (topTwo(t)) {
      const when = new Date(t.date || t.createdAt).getTime();
      if (when >= since) recent.push(t);
    } else if (t.stage !== 'setup' || registrationOf(t).open) live.push(t);
  }
  return { live, recent };
}
