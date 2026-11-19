export type BestOf = 3 | 5;

export interface Player {
  id: string;
  /** Shown exactly as entered (Arabic or Latin). */
  name: string;
}

export interface Game {
  a: number;
  b: number;
}

export type Side = 'a' | 'b';

export interface ScoreChange {
  at: string;
  games: Game[];
  walkover: Side | null;
}

export interface Match {
  id: string;
  stage: 'group' | 'ko';
  groupId?: string;
  bracketId?: string;
  /** Knockout round index, 0 = first round. -1 = third-place playoff. */
  round?: number;
  slot?: number;
  aId: string | null;
  bId: string | null;
  bestOf: BestOf;
  games: Game[];
  /** Winner of a walkover, or null. */
  walkover: Side | null;
  /** Previous saved results, oldest first (score correction audit trail). */
  history: ScoreChange[];
}

export interface Group {
  id: string;
  name: string;
  playerIds: string[];
  /** Order chosen by the organizer for ties the rules cannot break. */
  manualOrder: string[];
}

export interface StageFormats {
  group: BestOf;
  /** Knockout rounds before the semifinals. */
  early: BestOf;
  semi: BestOf;
  /** Final and third-place playoff. */
  final: BestOf;
}

export interface Bracket {
  id: string;
  kind: 'main' | 'consolation';
  name: string;
  size: number;
  /** Match ids per round. */
  rounds: string[][];
  thirdPlaceId: string | null;
}

export type TournamentStage = 'setup' | 'groups' | 'knockout';

export interface Tournament {
  id: string;
  name: string;
  date: string;
  createdAt: string;
  players: Player[];
  formats: StageFormats;
  consolation: { enabled: boolean; name: string };
  groups: Group[];
  matches: Record<string, Match>;
  brackets: Bracket[];
  stage: TournamentStage;
}
