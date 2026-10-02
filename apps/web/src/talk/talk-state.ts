import type { PartnerReply, Scene, TalkOpened, TurnResult } from "../openapi";

/** One turn as the screen holds it: each field arrives as its step is passed. */
export interface TalkTurn {
  readonly n: number;
  /** The line this turn answers: the opening, or the previous turn's reply. */
  readonly partnerLine: string;
  readonly japanese?: string;
  /** The learner's English once sent; `null` when they gave up. */
  readonly english?: string | null;
  /** Present once the server kept the turn. */
  readonly judgment?: TurnResult["judgment"];
  /** The partner's reply, held until it is shown; `null` when it did not arrive. */
  readonly reply?: PartnerReply | null;
  /** Presses of 「もう一度見る」 during the recital. */
  readonly revealCount: number;
}

/**
 * The bottom panel's step: input, waiting, feedback, recital, retry or end.
 * W3a–W3h and their visible behavior are recorded in ux-screens.md.
 */
export type TalkStep =
  | "japanese"
  | "english"
  | "teacher"
  | "fine"
  | "model"
  | "hidden"
  | "partner"
  | "replyFailed"
  | "turnFailed"
  | "ended";

export interface Talk {
  readonly talkId: string;
  readonly scene: Scene;
  readonly turnCount: number;
  /** Every turn begun, the current one last. */
  readonly turns: readonly TalkTurn[];
  readonly step: TalkStep;
  /** Set when W3h came from the last reply being shown, not from 終える. */
  readonly closed?: true;
}

/** W2's three states, then the talk itself. */
export type TalkState =
  | { readonly kind: "idle" | "preparing" | "failed" }
  | { readonly kind: "talk"; readonly talk: Talk };

export type TalkEvent =
  | { readonly type: "start" | "startFailed" | "resumeMissing" }
  | { readonly type: "resumed"; readonly talk: Talk }
  | { readonly type: "opened"; readonly opened: TalkOpened }
  | { readonly type: "japanese"; readonly text: string }
  | { readonly type: "english"; readonly text: string | null }
  | { readonly type: "answered"; readonly talkId: string; readonly result: TurnResult }
  | { readonly type: "replied"; readonly talkId: string; readonly reply: PartnerReply }
  | {
      readonly type: "turnFailed" | "replyFailed" | "shown" | "retrying" | "gone";
      readonly talkId: string;
    }
  | { readonly type: "hide" | "lookAgain" | "said" | "end" };

export const IDLE: TalkState = { kind: "idle" };

/** The current turn: the last one begun. */
export function currentTurn(talk: Talk): TalkTurn {
  const turn = talk.turns.at(-1);
  if (turn === undefined) throw new Error("A talk always holds its first turn.");
  return turn;
}

/** How many turns the server has kept: what ending the talk now would keep. */
export function keptTurns(talk: Talk): number {
  return talk.turns.filter((turn) => turn.judgment !== undefined).length;
}

/** The same check the API makes: hiragana, katakana or kanji in the English is refused. */
export function hasJapanese(text: string): boolean {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text);
}

function withCurrent(talk: Talk, patch: Partial<TalkTurn>, step: TalkStep): Talk {
  const last = currentTurn(talk);
  return { ...talk, turns: [...talk.turns.slice(0, -1), { ...last, ...patch }], step };
}

/**
 * Shows the held reply: the next turn begins on it, the last turn's closing ends the
 * talk, and a reply that did not arrive is W3g.
 */
export function revealReply(talk: Talk): Talk {
  const turn = currentTurn(talk);
  if (turn.reply === undefined || turn.reply === null) {
    return { ...talk, step: "replyFailed" };
  }
  if (turn.reply.closing || turn.n >= talk.turnCount)
    return { ...talk, step: "ended", closed: true };
  const next: TalkTurn = {
    n: turn.n + 1,
    partnerLine: turn.reply.line,
    revealCount: 0,
  };
  return { ...talk, turns: [...talk.turns, next], step: "japanese" };
}

function answered(talk: Talk, result: TurnResult): Talk {
  const { verdict } = result.judgment;
  const kept = withCurrent(
    talk,
    { judgment: result.judgment, reply: result.reply },
    verdict === "fine" ? "fine" : "model",
  );
  return verdict === "failed" ? revealReply(kept) : kept;
}

/** The talk's next state on `event`, which arrives for the step it was made in or not at all. */
function talkStep(talk: Talk, event: TalkEvent): Talk {
  const { step } = talk;
  if (step === "ended") return talk;
  if ("talkId" in event && event.talkId !== talk.talkId) return talk;
  switch (event.type) {
    case "japanese":
      return step === "japanese"
        ? withCurrent(talk, { japanese: event.text }, "english")
        : talk;
    case "english":
      return step === "english"
        ? withCurrent(talk, { english: event.text }, "teacher")
        : talk;
    case "answered":
      return step === "teacher" ? answered(talk, event.result) : talk;
    case "turnFailed":
      return step === "teacher" ? { ...talk, step: "turnFailed" } : talk;
    case "shown":
      return step === "fine" ? revealReply(talk) : talk;
    case "hide":
      return step === "model" && currentTurn(talk).judgment?.verdict === "corrected"
        ? { ...talk, step: "hidden" }
        : talk;
    case "lookAgain":
      return step === "hidden"
        ? withCurrent(talk, { revealCount: currentTurn(talk).revealCount + 1 }, "model")
        : talk;
    case "said":
      return step === "hidden" ? revealReply(talk) : talk;
    case "retrying":
      if (step === "turnFailed") return { ...talk, step: "teacher" };
      return step === "replyFailed" ? { ...talk, step: "partner" } : talk;
    case "replied":
      return step === "partner"
        ? revealReply(withCurrent(talk, { reply: event.reply }, step))
        : talk;
    case "replyFailed":
      return step === "partner" ? { ...talk, step: "replyFailed" } : talk;
    case "gone":
      return step === "teacher" || step === "partner"
        ? { ...talk, step: "ended" }
        : talk;
    case "end":
      return { ...talk, step: "ended" };
    default:
      return talk;
  }
}

/** The talk screen's reducer: W2's start, then each step of each turn. */
export function talkReducer(state: TalkState, event: TalkEvent): TalkState {
  if (event.type === "start") return { kind: "preparing" };
  if (event.type === "resumeMissing") return state.kind === "preparing" ? IDLE : state;
  if (event.type === "resumed")
    return state.kind === "preparing" ? { kind: "talk", talk: event.talk } : state;
  if (event.type === "startFailed")
    return state.kind === "preparing" ? { kind: "failed" } : state;
  if (event.type === "opened") {
    if (state.kind !== "preparing") return state;
    const { talkId, scene, opening, turnCount } = event.opened;
    return {
      kind: "talk",
      talk: {
        talkId,
        scene,
        turnCount,
        turns: [{ n: 1, partnerLine: opening, revealCount: 0 }],
        step: "japanese",
      },
    };
  }
  if (state.kind !== "talk") return state;
  const talk = talkStep(state.talk, event);
  return talk === state.talk ? state : { kind: "talk", talk };
}
