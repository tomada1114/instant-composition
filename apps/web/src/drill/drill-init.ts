import {
  currentCard,
  FRESH_FRONT,
  limitOf,
  type DrillInit,
  type DrillState,
  type Submission,
} from "./drill-state";

function dealt(init: DrillInit): DrillState {
  const shown = (id: string): boolean => init.limits[id] !== undefined;
  const first = init.answered.filter((a) => a.pass === "first");
  const answeredFirst = new Set(first.map((a) => a.cardId));
  const retryPile = init.retries
    ? first.filter((a) => a.result !== "ok" && shown(a.cardId)).map((a) => a.cardId)
    : [];
  const retryDone = init.answered.filter((a) => a.pass === "retry").length;
  const queue = init.deck.filter((id) => !answeredFirst.has(id) && shown(id));
  const base: DrillState = {
    roundId: init.roundId,
    retries: init.retries,
    typed: init.typed ?? false,
    limits: init.limits,
    paces: init.paces,
    queue,
    firstDone: first.length,
    retryPile,
    pass: "first",
    index: 0,
    combo: 0,
    paused: false,
    answers: [],
    phase: init.intro ? { kind: "intro" } : FRESH_FRONT,
  };
  if (queue.length > 0) return base;
  if (init.retries && retryDone < retryPile.length) {
    return { ...base, pass: "retry", index: retryDone, phase: base.phase };
  }
  return { ...base, phase: { kind: "finishing" } };
}

/** Opens a typed round on the back of the card it stopped at, when that card was submitted and not yet graded. */
function reopened(state: DrillState, submitted: Submission | undefined): DrillState {
  const card = currentCard(state);
  if (!state.typed || submitted === undefined || card === undefined) return state;
  if (card.cardId !== submitted.cardId || card.pass !== submitted.pass) return state;
  const back = {
    kind: "back",
    mode: "self",
    elapsedMs: Math.min(submitted.elapsedMs, limitOf(state)),
    since: 0,
  } as const;
  return {
    ...state,
    phase: submitted.text === undefined ? back : { ...back, text: submitted.text },
  };
}

/** The drill a round opens on, past what the server and this tab's queue already hold. */
export function initDrill(init: DrillInit): DrillState {
  return reopened(dealt(init), init.submitted);
}
