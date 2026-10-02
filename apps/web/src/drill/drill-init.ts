import { FRESH_FRONT, type DrillInit, type DrillState } from "./drill-state";
import { nextCard } from "./re-asks";

/**
 * The drill a round opens on, past what the server and this tab's queue
 * already hold. Only first passes count: a re-ask that was waiting when the
 * page went away is dropped, as the first answer already set the schedule.
 */
export function initDrill(init: DrillInit): DrillState {
  const shown = (id: string): boolean => init.limits[id] !== undefined;
  const answeredFirst = new Set(
    init.answered.filter((a) => a.pass === "first").map((a) => a.cardId),
  );
  const base: DrillState = {
    roundId: init.roundId,
    retries: init.retries,
    limits: init.limits,
    paces: init.paces,
    isNew: init.isNew,
    fresh: init.deck.filter((id) => !answeredFirst.has(id) && shown(id)),
    firstShown: answeredFirst.size,
    card: undefined,
    reAsks: [],
    step: 0,
    asked: {},
    goods: {},
    combo: 0,
    paused: false,
    answers: [],
    phase: init.intro ? { kind: "intro" } : FRESH_FRONT,
  };
  return nextCard(base) ?? { ...base, phase: { kind: "finishing" } };
}
