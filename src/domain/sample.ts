import { createTournament, saveResult, startGroups, startKnockout, groupsComplete, groupStandings } from './tournament';
import { bracketMatches } from './bracket';
import { gamesToWin } from './scoring';
import type { Game, Side, Tournament } from './types';

const FIRST = ['أحمد', 'محمد', 'عمر', 'يوسف', 'كريم', 'مصطفى', 'خالد', 'حسن', 'علي', 'طارق', 'ياسين', 'مروان', 'سيف', 'زياد', 'آدم', 'مازن', 'نور', 'سارة', 'مريم', 'ليلى', 'هنا', 'جنى', 'فرح', 'سلمى', 'ملك', 'رنا', 'دينا', 'ندى', 'Adam', 'Lina', 'Omar K.', 'Sam'];
const LAST = ['حمد', 'السيد', 'عبد الله', 'منصور', 'فاروق', 'الشريف', 'سالم', 'رمضان', 'النجار', 'حسني', 'زكي', 'بكر'];

/** Small seeded random generator so sample data is reproducible per seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function sampleNames(count: number, seed = Date.now()): string[] {
  const r = rng(seed);
  const used = new Set<string>();
  const out: string[] = [];
  while (out.length < count) {
    const f = FIRST[Math.floor(r() * FIRST.length)];
    const name = /[A-Za-z]/.test(f) ? f : `${f} ${LAST[Math.floor(r() * LAST.length)]}`;
    if (!used.has(name)) { used.add(name); out.push(name); }
    if (used.size >= FIRST.length * LAST.length) break;
  }
  return out;
}

function randomGame(r: () => number, winner: Side): Game {
  const deuce = r() < 0.2;
  const hi = deuce ? 12 + Math.floor(r() * 3) : 11;
  const lo = deuce ? hi - 2 : Math.floor(r() * 10);
  return winner === 'a' ? { a: hi, b: lo } : { a: lo, b: hi };
}

/** Random but valid games for a match, with player A slightly favoured. */
export function randomResult(r: () => number, bestOf: 3 | 5, bias = 0.5): Game[] {
  const need = gamesToWin(bestOf);
  const matchWinner: Side = r() < bias ? 'a' : 'b';
  const games: Game[] = [];
  let w = 0, l = 0;
  while (w < need) {
    const gameWinner: Side = l < need - 1 && r() < 0.35 ? (matchWinner === 'a' ? 'b' : 'a') : matchWinner;
    games.push(randomGame(r, gameWinner));
    if (gameWinner === matchWinner) w++; else l++;
  }
  return games;
}

export type SampleLevel = 'setup' | 'groupsHalf' | 'groupsDone' | 'finished';

/** Build a demo tournament at a chosen stage of progress. */
export function sampleTournament(level: SampleLevel, seed = Date.now(), playerCount = 16, groupCount = 4): Tournament {
  const r = rng(seed);
  const t = createTournament({
    name: 'بطولة تجريبية',
    date: new Date().toISOString().slice(0, 10),
    playerNames: sampleNames(playerCount, seed),
    groupCount,
    formats: { group: 3, early: 3, semi: 5, final: 5 },
    consolation: { enabled: true, name: 'بطولة الترضية' },
  });
  if (level === 'setup') return t;
  startGroups(t);
  const groupMs = Object.values(t.matches);
  const toPlay = level === 'groupsHalf' ? groupMs.slice(0, Math.ceil(groupMs.length / 2)) : groupMs;
  for (const m of toPlay) {
    if (r() < 0.05) saveResult(t, m.id, [], r() < 0.5 ? 'a' : 'b');
    else saveResult(t, m.id, randomResult(r, m.bestOf), null);
  }
  if (level === 'groupsHalf') return t;
  // Settle any tie the rules leave open, as an organizer would.
  for (const g of t.groups) {
    const s = groupStandings(t, g);
    if (s.unresolved.length) g.manualOrder = s.rows.map((x) => x.playerId);
  }
  if (!groupsComplete(t)) return t;
  if (level === 'groupsDone') return t;
  startKnockout(t);
  for (const b of t.brackets) {
    for (let round = 0; round < b.rounds.length; round++) {
      for (const m of bracketMatches(b, t.matches)) {
        if (m.round === round && m.aId && m.bId && !m.games.length) saveResult(t, m.id, randomResult(r, m.bestOf), null);
      }
      if (round === b.rounds.length - 2 && b.thirdPlaceId) {
        const third = t.matches[b.thirdPlaceId];
        if (third.aId && third.bId) saveResult(t, third.id, randomResult(r, third.bestOf), null);
      }
    }
  }
  return t;
}
