import { bracketMatches, canEditKo, createBracket, type Seed, syncBracket } from './bracket';
import { checkMatch, checkResult, hasResult, isDone, summarize } from './scoring';
import { computeStandings, type Standings, type StandingRow } from './standings';
import type { BestOf, Game, GamesResult, Group, Match, Player, Side, StageFormats, Tournament } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const GROUP_LETTERS = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ';

export function groupName(i: number): string {
  return GROUP_LETTERS[i] ?? String(i + 1);
}

/** Longest table label the organizer can type. */
export const TABLE_MAX = 20;

/** Sets or clears (empty value) the table of a group. Allowed at every stage. */
export function setGroupTable(t: Tournament, groupId: string, value: string): void {
  const g = t.groups.find((x) => x.id === groupId);
  if (!g) return;
  const v = value.replace(/\s+/g, ' ').trim().slice(0, TABLE_MAX)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  if (v) g.table = v; else delete g.table;
}

/** Numbers the tables 1, 2, 3… in group order. */
export function numberTables(t: Tournament): void {
  t.groups.forEach((g, i) => (g.table = String(i + 1)));
}

/** Whether the player only fills this group (their home group is another one). */
export function isExtra(g: Group, playerId: string): boolean {
  return !!g.extraIds?.includes(playerId);
}

/** The player's own (home) group, if any. A player who also fills a second group still has one home group. */
export function groupOf(t: Tournament, playerId: string): Group | undefined {
  return t.groups.find((g) => g.playerIds.includes(playerId) && !isExtra(g, playerId));
}

/** Every group the player plays in: the home group first, then groups they fill. */
export function groupsOf(t: Tournament, playerId: string): Group[] {
  const home = groupOf(t, playerId);
  const extra = t.groups.filter((g) => isExtra(g, playerId));
  return home ? [home, ...extra] : extra;
}

/**
 * Add a player who already has a group to a second group, to fill it (e.g. an
 * odd group). They play that group's matches and their results there count in
 * that group's table only. Setup stage only.
 */
export function addExtraPlayer(t: Tournament, playerId: string, groupId: string): void {
  if (t.stage !== 'setup') throw new Error('locked');
  const g = t.groups.find((x) => x.id === groupId);
  const home = groupOf(t, playerId);
  if (!g || !home) throw new Error('noGroup');
  if (g.playerIds.includes(playerId)) throw new Error('duplicate');
  g.playerIds.push(playerId);
  g.extraIds = [...(g.extraIds ?? []), playerId];
}

/** Take a filling player out of a group they do not belong to. Setup stage only. */
export function removeExtraPlayer(t: Tournament, playerId: string, groupId: string): void {
  if (t.stage !== 'setup') throw new Error('locked');
  const g = t.groups.find((x) => x.id === groupId);
  if (!g || !isExtra(g, playerId)) return;
  g.playerIds = g.playerIds.filter((id) => id !== playerId);
  g.extraIds = g.extraIds!.filter((id) => id !== playerId);
  if (!g.extraIds.length) delete g.extraIds;
}

/** Players who can be added to fill `groupId`: everyone with another home group who is not in it yet. */
export function extraCandidates(t: Tournament, groupId: string): Player[] {
  const g = t.groups.find((x) => x.id === groupId);
  if (!g) return [];
  return t.players.filter((p) => !g.playerIds.includes(p.id) && groupOf(t, p.id));
}

/** Snake redistribution of every player; filling players are cleared. Setup stage only. */
export function reshuffleGroups(t: Tournament): void {
  if (t.stage !== 'setup') throw new Error('locked');
  snakeGroups(t.players.map((p) => p.id), t.groups.length).forEach((ids, i) => {
    t.groups[i].playerIds = ids;
    t.groups[i].manualOrder = [];
    delete t.groups[i].extraIds;
  });
}

export interface NewTournament {
  name: string;
  date: string;
  playerNames: string[];
  groupCount: number;
  formats: StageFormats;
  consolation: { enabled: boolean; name: string };
  /** Record points of every game (default: match result in games only). */
  pointsPerGame?: boolean;
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
    pointsPerGame: input.pointsPerGame ?? false,
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
    pointsPerGame: recordsPoints(t),
    groups: t.groups.map((g) => ({
      id: uid(), name: g.name, playerIds: g.playerIds.map((id) => idMap.get(id)!), manualOrder: [], ...(g.table ? { table: g.table } : {}),
      ...(g.extraIds?.length ? { extraIds: g.extraIds.map((id) => idMap.get(id)!) } : {}),
    })),
    matches: {},
    brackets: [],
    stage: 'setup',
  };
}

export function movePlayer(t: Tournament, playerId: string, toGroupId: string, index?: number): void {
  if (t.stage !== 'setup') throw new Error('locked');
  const target0 = t.groups.find((g) => g.id === toGroupId)!;
  // Moving into a group the player only filled makes it their home group: drop the extra place.
  if (isExtra(target0, playerId)) removeExtraPlayer(t, playerId, toGroupId);
  const home = groupOf(t, playerId);
  if (home) home.playerIds = home.playerIds.filter((id) => id !== playerId);
  const target = t.groups.find((g) => g.id === toGroupId)!;
  const i = index === undefined ? target.playerIds.length : Math.min(index, target.playerIds.length);
  target.playerIds.splice(i, 0, playerId);
}

/** Round-robin order (circle method) so players rest between matches. */
export function roundRobin(ids: string[]): [string, string][] {
  return roundRobinRounds(ids).map(([a, b]) => [a, b]);
}

/** Round-robin pairs with their round number (0-based), in the same order as `roundRobin`. */
export function roundRobinRounds(ids: string[]): [string, string, number][] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const out: [string, string, number][] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) out.push(r % 2 ? [b, a, r] : [a, b, r]);
    }
    list.splice(1, 0, list.pop()!);
  }
  return out;
}

export function startGroups(t: Tournament): void {
  if (t.groups.some((g) => g.playerIds.length < 2)) throw new Error('smallGroup');
  // Players still on the waiting list (in the tournament but in no group) must be placed first.
  const placed = new Set(t.groups.flatMap((g) => g.playerIds));
  if (t.players.some((p) => !placed.has(p.id))) throw new Error('waiting');
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

/**
 * Standing rows that can qualify: filling players are left out, so the next
 * player of the group takes their place. Ranks are renumbered 1, 2, 3…
 */
export function qualifyingRows(t: Tournament, g: Group): StandingRow[] {
  return groupStandings(t, g).rows.filter((r) => !isExtra(g, r.playerId)).map((r, i) => ({ ...r, rank: i + 1 }));
}

export function groupsComplete(t: Tournament): boolean {
  return t.groups.every((g) => groupStandings(t, g).complete);
}

export type SaveError = ReturnType<typeof checkMatch> | { ok: false; error: 'locked' };

/**
 * Save (or correct) a match result. Earlier results are kept in history.
 * Pass `result` (games only, e.g. 3-1) instead of `games` when points per game are not recorded.
 */
export function saveResult(t: Tournament, matchId: string, games: Game[], walkover: Side | null, result: GamesResult | null = null): SaveError {
  const m = t.matches[matchId];
  if (m.stage === 'group' && t.stage !== 'groups') return { ok: false, error: 'locked' };
  if (m.stage === 'ko') {
    const b = t.brackets.find((x) => x.id === m.bracketId)!;
    if (!canEditKo(m, b, t.matches) || !m.aId || !m.bId) return { ok: false, error: 'locked' };
  }
  if (!walkover) {
    const check = result ? checkResult(result, m.bestOf) : checkMatch(games, m.bestOf);
    if (!check.ok) return check;
  }
  if (hasResult(m)) {
    m.history.push({ at: new Date().toISOString(), games: m.games, walkover: m.walkover, result: m.result ?? null });
  }
  m.games = walkover || result ? [] : games.map((g) => ({ a: g.a, b: g.b }));
  m.walkover = walkover;
  m.result = walkover || !result ? null : { a: result.a, b: result.b };
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
  const tables = t.groups.map((g) => ({ g, rows: qualifyingRows(t, g) }));
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
  reshuffleGroups(t);
}

/** Status column stored in Supabase (drives who can see and join). */
export function remoteStatus(t: Tournament): 'draft' | 'registration' | 'running' | 'finished' {
  if (t.stage === 'setup') return registrationOf(t).open ? 'registration' : 'draft';
  const main = t.brackets.find((b) => b.kind === 'main');
  if (main) {
    const final = t.matches[main.rounds[main.rounds.length - 1][0]];
    if (final && hasResult(final)) return 'finished';
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
  for (const g of t.groups) {
    g.playerIds = g.playerIds.filter((id) => id !== playerId);
    if (g.extraIds) { g.extraIds = g.extraIds.filter((id) => id !== playerId); if (!g.extraIds.length) delete g.extraIds; }
  }
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
  return summarize(m).winner;
}

/**
 * Whether the organizer records the points of every game. Older tournaments
 * without the setting keep detailed scoring if they already have game points.
 */
export function recordsPoints(t: Tournament): boolean {
  return t.pointsPerGame ?? Object.values(t.matches).some((m) => m.games.length > 0);
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

/** Where a tournament stands, for cards and filters. */
export type PublicStatus = 'open' | 'upcoming' | 'running' | 'finished';
export const PUBLIC_STATUSES: PublicStatus[] = ['open', 'running', 'upcoming', 'finished'];

export function publicStatus(t: Tournament): PublicStatus {
  if (topTwo(t) || remoteStatus(t) === 'finished') return 'finished';
  if (t.stage !== 'setup') return 'running';
  return registrationOf(t).open ? 'open' : 'upcoming';
}

/** Every tournament for the "all tournaments" page: open first, then running, upcoming, finished; newest first inside each. */
export function sortForListing(list: Tournament[]): Tournament[] {
  const rank = (t: Tournament) => PUBLIC_STATUSES.indexOf(publicStatus(t));
  const when = (t: Tournament) => new Date(t.date || t.createdAt).getTime() || 0;
  return [...list].sort((a, b) => rank(a) - rank(b) || (publicStatus(a) === 'finished' ? when(b) - when(a) : when(a) - when(b)));
}

/** Whole days from `now` to the tournament date (negative = in the past), or null without a date. */
export function daysUntil(t: Tournament, now = new Date()): number | null {
  if (!t.date) return null;
  const [y, m, d] = t.date.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const day = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((day - today) / 86_400_000);
}

/** Time filter on the "all tournaments" page. */
export type TimeFilter = 'any' | 'week' | 'month' | 'upcoming' | 'past';
export const TIME_FILTERS: TimeFilter[] = ['any', 'week', 'month', 'upcoming', 'past'];

export function matchesTime(t: Tournament, f: TimeFilter, now = new Date()): boolean {
  if (f === 'any') return true;
  const d = daysUntil(t, now);
  if (d === null) return false;
  if (f === 'week') return d >= 0 && d <= 7;
  if (f === 'month') return d >= 0 && d <= 30;
  if (f === 'upcoming') return d >= 0;
  return d < 0;
}

const placeKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Distinct places used by tournaments, for the location filter. */
export function tournamentLocations(list: Tournament[]): string[] {
  const seen = new Map<string, string>();
  for (const t of list) if (t.location?.trim() && !seen.has(placeKey(t.location))) seen.set(placeKey(t.location), t.location.trim());
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'ar'));
}

export function matchesLocation(t: Tournament, place: string): boolean {
  return !place || placeKey(t.location ?? '') === placeKey(place);
}
