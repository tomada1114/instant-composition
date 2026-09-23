import type { AnswerRecord, DayKey, RoundKind, Settings } from "../../core/types";

export type LevelReason = "placement" | "up" | "down";

export interface LevelEntry {
  readonly level: number;
  readonly reason: LevelReason;
  readonly roundId: string | null;
  readonly at: number;
}

export interface NewRound {
  readonly id: string;
  readonly kind: RoundKind;
  readonly day: DayKey;
  /** The day whose portion this round counts toward, or null for an extra round. */
  readonly portionDay: DayKey | null;
  /** Card ids of the first pass, in the order they are shown. */
  readonly deck: readonly string[];
  readonly startedAt: number;
}

export interface RoundRow extends NewRound {
  readonly finishedAt: number | null;
  readonly abandonedAt: number | null;
  /** The summary saved at finish, as the JSON it was stored as. */
  readonly summary: unknown;
}

export interface PortionRow {
  readonly creditDay: DayKey;
  readonly target: number;
  readonly completedAt: number | null;
  readonly completedRound: string | null;
}

export interface TitleRow {
  readonly key: string;
  readonly awardedAt: number;
  readonly roundId: string;
}

/** Everything the services read and write, over one SQLite connection. */
export interface ProgressStore {
  schemaVersion(): number;
  close(): void;
  /** Runs `body` in one transaction, rolled back if it throws. */
  transaction<T>(body: () => T): T;

  getSettings(): Settings | undefined;
  putSettings(settings: Settings): void;

  currentLevel(): LevelEntry | undefined;
  addLevel(entry: LevelEntry): void;

  insertRound(round: NewRound): void;
  getRound(id: string): RoundRow | undefined;
  /** The latest round started on `day` that is neither finished nor abandoned. */
  activeRound(day: DayKey): RoundRow | undefined;
  roundsOn(day: DayKey): RoundRow[];
  finishedRounds(): RoundRow[];
  updateDeck(id: string, deck: readonly string[]): void;
  finishRound(id: string, at: number, summary: unknown): void;
  abandonRound(id: string, at: number): void;
  abandonOpenRoundsBefore(day: DayKey, at: number): void;

  getPortion(creditDay: DayKey): PortionRow | undefined;
  insertPortion(creditDay: DayKey, target: number): void;
  setPortionTarget(creditDay: DayKey, target: number): void;
  completePortion(creditDay: DayKey, at: number, roundId: string): void;
  completedDays(): Set<DayKey>;
  completedPortions(): PortionRow[];

  /** False when an answer with the same id was already stored. */
  insertAnswer(answer: AnswerRecord): boolean;
  allAnswers(): AnswerRecord[];
  answersOfRound(roundId: string): AnswerRecord[];

  titles(): TitleRow[];
  awardTitle(key: string, at: number, roundId: string): void;
}
