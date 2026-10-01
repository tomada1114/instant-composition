import { FRESH_FRONT, type DrillInit, type DrillState } from "./drill-state";

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

/** The drill a round opens on, past what the server and this tab's queue already hold. */
export function initDrill(init: DrillInit): DrillState {
  return dealt(init);
}
