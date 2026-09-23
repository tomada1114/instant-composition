import { addDays } from "./day";
import { refitDeck, seedFor, type PracticeState } from "./deck";
import type { PracticeError } from "./errors";
import { emptyTally } from "./empty";
import type { DayTally, LearnerStats, Portion, Round } from "./records";
import { err, ok, type Result } from "./result";
import { dealExtra, dealPlacement, dealPortion, type Dealt } from "./start-deal";
import { isYesterdayRecoverable } from "./streak";
import type { DayKey, RoundKind } from "./types";

export interface StartCommand {
  readonly kind: RoundKind;
  /** Made by the client, so a retried start cannot open two rounds. */
  readonly roundId: string;
}

export interface StartState {
  readonly now: number;
  readonly practice: PracticeState;
  readonly hasSettings: boolean;
  readonly stats: LearnerStats;
  /** The round with the command's id, when a retried start already made it. */
  readonly existing: Round | undefined;
  /** The learner's open round, and the cards it already has a first pass for. */
  readonly open: Round | undefined;
  readonly openAnswered: ReadonlySet<string>;
  /** Today's and yesterday's portions, where they exist. */
  readonly portions: ReadonlyMap<DayKey, Portion>;
  readonly tally: DayTally | undefined;
}

export interface StartChange {
  /** The round to hand back: a new one, or the open one resumed. */
  readonly round: Round;
  readonly created: boolean;
  /** The round as resumed differs from the one stored. */
  readonly refitted: boolean;
  readonly abandoned: Round | undefined;
  readonly portion: Portion | undefined;
  readonly tally: DayTally | undefined;
  readonly stats: LearnerStats;
}

/**
 * Starts a round of the command's kind, or resumes today's open round of the
 * same kind so a reload resumes rather than restarts. An open round of another
 * kind, or one left over from an earlier day, is abandoned; its answers count.
 */
export function decideStart(
  state: StartState,
  command: StartCommand,
): Result<StartChange, PracticeError> {
  const unchanged = {
    created: false,
    refitted: false,
    abandoned: undefined,
    portion: undefined,
    tally: undefined,
    stats: state.stats,
  };
  if (state.existing !== undefined) {
    return ok({ ...unchanged, round: state.existing });
  }
  if (!state.hasSettings) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const { practice, now } = state;
  const today = practice.today;
  const completed = new Set(state.stats.completedDays);
  const kind =
    command.kind === "today" && completed.has(today) ? "extra" : command.kind;
  const open = state.open;
  if (open?.day === today && open.kind === kind) {
    const deck = refitDeck(
      practice,
      open,
      state.openAnswered,
      open.deck.length - state.openAnswered.size,
    );
    const refitted = deck.join() !== open.deck.join();
    return ok({ ...unchanged, round: { ...open, deck }, refitted });
  }
  const abandoned = open === undefined ? undefined : { ...open, abandonedAt: now };

  const seed = (seeded: RoundKind): string =>
    seedFor(today, seeded, state.tally?.roundsStarted ?? 0);
  let dealt: Dealt;
  switch (kind) {
    case "placement":
      dealt = dealPlacement(state, seed("placement"), completed);
      break;
    case "today":
      dealt = dealPortion(state, "today", today, seed);
      break;
    case "yesterday":
      dealt = isYesterdayRecoverable(completed, today)
        ? dealPortion(state, "yesterday", addDays(today, -1), seed)
        : err({ code: "ERR_ROUND_CLOSED" });
      break;
    case "extra":
      dealt = dealExtra(state, seed("extra"));
      break;
  }
  if (!dealt.ok) {
    return dealt;
  }
  const round: Round = {
    id: command.roundId,
    kind: dealt.value.kind,
    day: today,
    portionDay: dealt.value.portionDay,
    deck: dealt.value.deck,
    startedAt: now,
    finishedAt: null,
    abandonedAt: null,
    firstPass: 0,
    outcome: null,
  };
  const tally = state.tally ?? emptyTally(today);
  return ok({
    round,
    created: true,
    refitted: false,
    abandoned,
    portion: dealt.value.portion,
    tally: { ...tally, roundsStarted: tally.roundsStarted + 1 },
    stats: { ...state.stats, openRound: { id: round.id, day: today } },
  });
}
