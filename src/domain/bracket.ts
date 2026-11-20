import { hasResult, isDone, loserId, summarize, winnerId } from './scoring';
import type { BestOf, Bracket, Match, StageFormats } from './types';

/** Standard seed positions, e.g. size 8 → [1,8,4,5,2,7,3,6]. */
export function seedPositions(size: number): number[] {
  let pos = [1];
  while (pos.length < size) {
    const n = pos.length * 2;
    pos = pos.flatMap((s) => [s, n + 1 - s]);
  }
  return pos;
}

export function nextPowerOfTwo(n: number): number {
  let s = 2;
  while (s < n) s *= 2;
  return s;
}

export interface Seed {
  playerId: string;
  /** Group the player came from, used to avoid same-group first-round matches. */
  groupId: string;
}

/**
 * Place seeds into first-round slots. Seeds must be ordered best first:
 * all group winners (group order), then all runners-up (group order).
 * Byes go to the top seeds. A first-round pairing of two players from the
 * same group is fixed by swapping with another first-round pairing when possible.
 */
export function placeSeeds(seeds: Seed[]): (Seed | null)[] {
  const size = nextPowerOfTwo(Math.max(seeds.length, 2));
  const slots: (Seed | null)[] = seedPositions(size).map((p) => seeds[p - 1] ?? null);
  const pairs = size / 2;
  const clash = (i: number) => {
    const a = slots[2 * i], b = slots[2 * i + 1];
    return !!a && !!b && a.groupId === b.groupId;
  };
  for (let i = 0; i < pairs; i++) {
    if (!clash(i)) continue;
    for (let j = 0; j < pairs; j++) {
      if (j === i || !slots[2 * j + 1]) continue;
      // Swap the lower seeds (second slot) of the two pairings.
      [slots[2 * i + 1], slots[2 * j + 1]] = [slots[2 * j + 1], slots[2 * i + 1]];
      if (!clash(i) && !clash(j)) break;
      [slots[2 * i + 1], slots[2 * j + 1]] = [slots[2 * j + 1], slots[2 * i + 1]];
    }
  }
  return slots;
}

export function roundFormat(formats: StageFormats, round: number, totalRounds: number): BestOf {
  if (round === -1 || round === totalRounds - 1) return formats.final;
  if (round === totalRounds - 2) return formats.semi;
  return formats.early;
}

export type RoundName = 'final' | 'semi' | 'quarter' | 'r16' | 'r32' | 'r64' | 'third';

export function roundName(round: number, totalRounds: number): RoundName {
  if (round === -1) return 'third';
  const fromEnd = totalRounds - 1 - round;
  return (['final', 'semi', 'quarter', 'r16', 'r32', 'r64'] as const)[Math.min(fromEnd, 5)];
}

function newMatch(id: string, bracketId: string, round: number, slot: number, bestOf: BestOf): Match {
  return { id, stage: 'ko', bracketId, round, slot, aId: null, bId: null, bestOf, games: [], walkover: null, history: [] };
}

/** Build a knockout bracket and its matches (written into `matches`). */
export function createBracket(
  id: string,
  kind: Bracket['kind'],
  name: string,
  seeds: Seed[],
  formats: StageFormats,
  matches: Record<string, Match>,
): Bracket {
  const slots = placeSeeds(seeds);
  const size = slots.length;
  const totalRounds = Math.log2(size);
  const rounds: string[][] = [];
  for (let r = 0; r < totalRounds; r++) {
    const count = size / 2 ** (r + 1);
    const ids: string[] = [];
    for (let s = 0; s < count; s++) {
      const mid = `${id}-r${r}-${s}`;
      matches[mid] = newMatch(mid, id, r, s, roundFormat(formats, r, totalRounds));
      ids.push(mid);
    }
    rounds.push(ids);
  }
  rounds[0].forEach((mid, s) => {
    matches[mid].aId = slots[2 * s]?.playerId ?? null;
    matches[mid].bId = slots[2 * s + 1]?.playerId ?? null;
  });
  let thirdPlaceId: string | null = null;
  if (totalRounds >= 2) {
    thirdPlaceId = `${id}-third`;
    matches[thirdPlaceId] = newMatch(thirdPlaceId, id, -1, 0, formats.final);
  }
  const bracket: Bracket = { id, kind, name, size, rounds, thirdPlaceId };
  syncBracket(bracket, matches);
  return bracket;
}

/** A first-round slot with exactly one player and no opponent is a bye. */
export function isBye(m: Match, bracket: Bracket): boolean {
  return m.round === 0 && bracket.rounds.length > 0 && (m.aId === null) !== (m.bId === null);
}

/** Who advances out of a match: the winner, or the lone player of a bye. */
function advancing(m: Match, bracket: Bracket): string | null {
  if (isBye(m, bracket)) return m.aId ?? m.bId;
  return winnerId(m);
}

/** Fill later-round participants from earlier results. */
export function syncBracket(bracket: Bracket, matches: Record<string, Match>): void {
  for (let r = 1; r < bracket.rounds.length; r++) {
    bracket.rounds[r].forEach((mid, s) => {
      const m = matches[mid];
      m.aId = advancing(matches[bracket.rounds[r - 1][2 * s]], bracket);
      m.bId = advancing(matches[bracket.rounds[r - 1][2 * s + 1]], bracket);
    });
  }
  if (bracket.thirdPlaceId) {
    const semis = bracket.rounds[bracket.rounds.length - 2];
    const t = matches[bracket.thirdPlaceId];
    const semiLoser = (mid: string) => {
      const m = matches[mid];
      // A semifinal reached through a bye in a tiny bracket has no loser.
      return m.aId && m.bId ? loserId(m) : null;
    };
    t.aId = semiLoser(semis[0]);
    t.bId = semiLoser(semis[1]);
  }
}

/** Matches whose participants depend on `m`'s result. */
export function dependents(m: Match, bracket: Bracket, matches: Record<string, Match>): Match[] {
  if (m.round === undefined || m.round < 0) return [];
  const out: Match[] = [];
  const nextRound = bracket.rounds[m.round + 1];
  if (nextRound) out.push(matches[nextRound[Math.floor(m.slot! / 2)]]);
  if (bracket.thirdPlaceId && m.round === bracket.rounds.length - 2) out.push(matches[bracket.thirdPlaceId]);
  return out;
}

/** A knockout result may be changed only while no later match has a result. */
export function canEditKo(m: Match, bracket: Bracket, matches: Record<string, Match>): boolean {
  return dependents(m, bracket, matches).every((d) => !hasResult(d));
}

export interface Placement {
  place: number;
  playerId: string;
}

/** Places 1–2 from the final, 3–4 from the third-place playoff. */
export function placements(bracket: Bracket, matches: Record<string, Match>): Placement[] {
  const out: Placement[] = [];
  const final = matches[bracket.rounds[bracket.rounds.length - 1][0]];
  if (isDone(final)) {
    out.push({ place: 1, playerId: winnerId(final)! }, { place: 2, playerId: loserId(final)! });
  }
  if (bracket.thirdPlaceId) {
    const t = matches[bracket.thirdPlaceId];
    if (t.aId && t.bId && summarize(t).winner) {
      out.push({ place: 3, playerId: winnerId(t)! }, { place: 4, playerId: loserId(t)! });
    }
  }
  return out;
}

export function bracketMatches(bracket: Bracket, matches: Record<string, Match>): Match[] {
  const ids = bracket.rounds.flat();
  if (bracket.thirdPlaceId) ids.push(bracket.thirdPlaceId);
  return ids.map((id) => matches[id]);
}
