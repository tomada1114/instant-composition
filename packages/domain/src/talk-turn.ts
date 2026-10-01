import type { TalkError } from "./errors";
import { err, ok, type Result } from "./result";
import type { Judgment, Talk, Turn } from "./talk";
import { keptTalk } from "./talk-start";
import { TALK_TUNING } from "./tuning";

/** One turn the learner sends: what they wanted to say, and their English or nothing. */
export interface TurnCommand {
  /** 1 to `TALK_TUNING.turns`; only the next one is taken. */
  readonly turn: number;
  readonly japanese: string;
  /** Null when the learner gave up with "I don't know". */
  readonly english: string | null;
}

/** What the teacher's call answered; it never answers `failed`. */
export interface TeacherJudgment {
  readonly verdict: "fine" | "corrected";
  readonly modelAnswer: string;
  readonly point: string;
}

/**
 * A turn already kept, answered as it was; or the next turn, with the line it
 * answers and whether its reply closes the talk.
 */
export type TurnDecision =
  | { readonly kind: "kept"; readonly turn: Turn }
  | {
      readonly kind: "next";
      readonly talk: Talk;
      readonly n: number;
      readonly partnerLine: string;
      readonly closing: boolean;
    };

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

function fits(text: string): boolean {
  return text.trim() !== "" && Array.from(text).length <= TALK_TUNING.maxChars;
}

/** Whether the learner's text holds the rule the talk screen's fields apply. */
function textsFit(command: TurnCommand): boolean {
  return (
    fits(command.japanese) &&
    (command.english === null ||
      (fits(command.english) && !JAPANESE.test(command.english)))
  );
}

function isTurnNumber(turn: number): boolean {
  return Number.isInteger(turn) && turn >= 1 && turn <= TALK_TUNING.turns;
}

/**
 * What `sendTurn` does with `command` on `talk` (already read through
 * `liveTalk`). A resend of a kept turn answers it unchanged, so the model is
 * not called twice; a closed talk takes no other, past its last turn
 * included; any other turn than the next is `ERR_CONFLICT`, as is the next one
 * while the previous reply is still missing.
 */
export function decideTurn(
  talk: Talk | undefined,
  command: TurnCommand,
): Result<TurnDecision, TalkError> {
  if (talk === undefined) {
    return err({ code: "ERR_TALK_NOT_FOUND" });
  }
  if (!textsFit(command)) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const kept = talk.turns.find((turn) => turn.n === command.turn);
  if (kept !== undefined) {
    return ok({ kind: "kept", turn: kept });
  }
  if (talk.status !== "open") {
    return err({ code: "ERR_TALK_CLOSED" });
  }
  if (!isTurnNumber(command.turn)) {
    return err({ code: "ERR_BAD_REQUEST" });
  }
  const previous = talk.turns.at(-1);
  const partnerLine = previous === undefined ? talk.opening : previous.reply;
  if (command.turn !== talk.turns.length + 1 || partnerLine === undefined) {
    return err({ code: "ERR_CONFLICT" });
  }
  return ok({
    kind: "next",
    talk,
    n: command.turn,
    partnerLine,
    closing: command.turn === TALK_TUNING.turns,
  });
}

/**
 * The judgment a turn keeps: `failed` when the teacher's call produced
 * nothing, always `corrected` on a give-up, and nothing to show when `fine`.
 */
function judgmentOf(
  english: string | null,
  teacher: TeacherJudgment | undefined,
): Judgment {
  if (teacher === undefined) {
    return { verdict: "failed", modelAnswer: "", point: "" };
  }
  if (teacher.verdict === "fine" && english !== null) {
    return { verdict: "fine", modelAnswer: "", point: "" };
  }
  return {
    verdict: "corrected",
    modelAnswer: teacher.modelAnswer,
    point: teacher.point,
  };
}

/**
 * The next turn as kept, whatever the model calls produced, and the talk
 * holding it. The last turn finishes the talk, which is then kept for good and
 * no longer expires.
 */
export function keepTurn(
  next: Extract<TurnDecision, { kind: "next" }>,
  command: TurnCommand,
  answers: {
    readonly teacher: TeacherJudgment | undefined;
    readonly reply: string | undefined;
  },
  now: number,
): { readonly talk: Talk; readonly turn: Turn } {
  const turn: Turn = {
    n: next.n,
    partnerLine: next.partnerLine,
    japanese: command.japanese,
    english: command.english,
    judgment: judgmentOf(command.english, answers.teacher),
    ...(answers.reply === undefined ? {} : { reply: answers.reply }),
  };
  const kept = { ...next.talk, turns: [...next.talk.turns, turn] };
  return { talk: next.closing ? keptTalk(kept, "finished", now) : kept, turn };
}
