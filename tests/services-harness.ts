import { createContentSource } from "../src/server/content";
import { openProgressStore, type ProgressStore } from "../src/server/db";
import { createServices, type Services } from "../src/server/services";
import type { AnswerInput } from "../src/core/api";
import type { RoundPayload } from "../src/core/views";
import { makeContentRoot, writeCards } from "./cards-fixture";
import { makeShownCell } from "./progress-fixture";

// A running service layer over a throwaway content root and an in-memory
// database, with a clock the test moves. Nothing here asserts.

export interface Harness {
  readonly services: Services;
  readonly store: ProgressStore;
  readonly root: string;
  /** Local wall-clock time; each later read of the clock adds a millisecond. */
  setTime(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute?: number,
  ): void;
  close(): void;
}

/** Four shown cards per level 1..10 in each of the fixture's three cells. */
export function writeStandardCards(root: string, perLevel = 4): void {
  const cells = [
    ["work/meetings.json", "work", "meetings", "m"],
    ["work/requests.json", "work", "requests", "q"],
    ["daily/home.json", "daily", "home", "h"],
  ] as const;
  for (const [file, topic, subtopic, prefix] of cells) {
    const cards = Array.from({ length: 10 }, (_, index) =>
      makeShownCell(`${prefix}${String(index + 1)}x`, perLevel, {
        topic,
        subtopic,
        level: index + 1,
      }),
    ).flat();
    writeCards(root, file, cards);
  }
}

export function makeHarness(options: { cards?: (root: string) => void } = {}): Harness {
  const root = makeContentRoot();
  (options.cards ?? writeStandardCards)(root);
  const store = openProgressStore(":memory:");
  let now = new Date(2026, 8, 23, 10, 0).getTime();
  let sequence = 0;
  const services = createServices({
    store,
    content: createContentSource(root),
    // Each read moves the clock on a millisecond, so everything recorded in one
    // test has a distinct, ordered timestamp.
    now: () => {
      now += 1;
      return now;
    },
    newId: () => {
      sequence += 1;
      return `id${String(sequence)}`;
    },
  });
  return {
    services,
    store,
    root,
    setTime(year, month, day, hour, minute = 0) {
      now = new Date(year, month - 1, day, hour, minute).getTime();
    },
    close() {
      store.close();
    },
  };
}

let answerSequence = 0;

/** Answers for the first pass of `round`, `results` in deck order (default all ok, 3 s). */
export function firstPassAnswers(
  round: RoundPayload,
  results: readonly AnswerInput["result"][] = [],
  elapsedMs = 3_000,
): AnswerInput[] {
  return round.deck.map((cardId, index) => {
    answerSequence += 1;
    const result = results[index] ?? "ok";
    return {
      id: `ans${String(answerSequence)}`,
      roundId: round.id,
      cardId,
      pass: "first",
      result,
      elapsedMs: result === "timeout" ? 60_000 : elapsedMs,
    };
  });
}

/** Answers for the retry pass: every first-pass miss, answered `result`. */
export function retryAnswers(
  round: RoundPayload,
  first: readonly AnswerInput[],
  result: AnswerInput["result"] = "ok",
): AnswerInput[] {
  return first
    .filter((answer) => answer.result !== "ok")
    .map((answer) => {
      answerSequence += 1;
      return {
        id: `ans${String(answerSequence)}`,
        roundId: round.id,
        cardId: answer.cardId,
        pass: "retry",
        result,
        elapsedMs: 3_000,
      };
    });
}
