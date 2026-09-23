import { compose, countAvailable, type Composition } from "../../core/compose";
import { err, ok, type Result } from "../../core/result";
import { limitMsForWords } from "../../core/timer";
import { TUNING } from "../../core/tuning";
import type { DrillCard, RoundPayload } from "../../core/views";
import type { RoundKind } from "../../core/types";
import type { RoundRow } from "../db";
import type { ServiceDeps, ServiceError } from "./deps";
import { portionProgress, type Progress } from "./progress";

function levelOf(progress: Progress): number {
  return progress.level?.level ?? 1;
}

function exclusion(progress: Progress, extra: readonly string[]): Set<string> {
  return new Set([...progress.answeredToday, ...extra]);
}

/** How many cards could be dealt today, leaving out `extra` besides today's answers. */
export function availableFor(
  progress: Progress,
  extra: readonly string[] = [],
): number {
  return countAvailable({
    level: levelOf(progress),
    topics: progress.settings?.topics ?? [],
    cards: progress.meta,
    states: progress.states,
    exclude: exclusion(progress, extra),
  });
}

/** The seed a round of `kind` started now would use, so a preview deals the same cards. */
export function seedFor(
  deps: ServiceDeps,
  progress: Progress,
  kind: RoundKind,
): string {
  return `${progress.today}:${kind}:${String(deps.store.roundsOn(progress.today).length)}`;
}

export function deal(
  progress: Progress,
  options: {
    readonly size: number;
    readonly seed: string;
    readonly exclude?: readonly string[];
    readonly minSize?: number;
  },
): Result<Composition, ServiceError> {
  const dealt = compose({
    size: options.size,
    minSize: options.minSize ?? Math.min(TUNING.minDeckSize, options.size),
    today: progress.today,
    level: levelOf(progress),
    topics: progress.settings?.topics ?? [],
    focus: progress.settings?.focus ?? [],
    cards: progress.meta,
    states: progress.states,
    exclude: exclusion(progress, options.exclude ?? []),
    seed: options.seed,
  });
  return dealt.ok
    ? ok(dealt.value)
    : err({ code: "ERR_NOT_ENOUGH_CARDS", available: dealt.error.available });
}

/** The round as the drill needs it: its cards with their limits, and where it stands. */
export function toPayload(
  deps: ServiceDeps,
  progress: Progress,
  round: RoundRow,
): RoundPayload {
  const answers = deps.store.answersOfRound(round.id);
  const cards: Record<string, DrillCard> = {};
  for (const id of round.deck) {
    const card = progress.content.known.get(id);
    if (card !== undefined) {
      cards[id] = { ...card, limitMs: limitMsForWords(card.words) };
    }
  }

  let offset = 0;
  let total = round.deck.length;
  const portion =
    round.portionDay === null || round.kind === "placement"
      ? undefined
      : deps.store.getPortion(round.portionDay);
  if (portion !== undefined && round.portionDay !== null) {
    const inRound = answers.filter((answer) => answer.pass === "first").length;
    offset = portionProgress(deps, progress.answers, round.portionDay) - inRound;
    total = portion.target;
  }

  return {
    id: round.id,
    kind: round.kind,
    day: round.day,
    portionDay: round.portionDay,
    deck: round.deck,
    cards,
    answered: answers.map(({ cardId, pass, result }) => ({ cardId, pass, result })),
    offset,
    total,
    retries: round.kind !== "placement",
  };
}

/** The ids given a first-pass answer in `round`, which are always the front of its deck. */
export function answeredIn(deps: ServiceDeps, round: RoundRow): Set<string> {
  return new Set(
    deps.store
      .answersOfRound(round.id)
      .filter((answer) => answer.pass === "first")
      .map((answer) => answer.cardId),
  );
}

/**
 * Rewrites the unanswered tail of `round`'s deck to `remaining` cards: cards
 * no longer shown are dropped, then the tail is cut or topped up by the same
 * dealing rules. A placement deck is only ever cut.
 */
export function refitDeck(
  deps: ServiceDeps,
  progress: Progress,
  round: RoundRow,
  remaining: number,
): readonly string[] {
  const answered = answeredIn(deps, round);
  const done = round.deck.filter((id) => answered.has(id));
  const open = round.deck.filter(
    (id) => !answered.has(id) && progress.content.shown.has(id),
  );
  let tail = open.slice(0, Math.max(0, remaining));
  const missing = remaining - tail.length;
  if (missing > 0 && round.kind !== "placement") {
    const topUp = deal(progress, {
      size: missing,
      minSize: 1,
      seed: `${round.id}:${String(round.deck.length)}`,
      exclude: [...round.deck],
    });
    if (topUp.ok) {
      tail = [...tail, ...topUp.value.cardIds];
    }
  }
  const deck = [...done, ...tail];
  if (deck.join() !== round.deck.join()) {
    deps.store.updateDeck(round.id, deck);
  }
  return deck;
}
