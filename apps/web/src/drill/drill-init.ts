import { initStudy } from "../study/study-init";
import type { DrillInit, DrillState } from "./drill-state";

/** Resumes a timed drill past saved first answers, omitting unavailable cards. */
export function initDrill(init: DrillInit): DrillState {
  return {
    ...initStudy({
      sessionId: init.roundId,
      deck: init.deck.filter((id) => init.limits[id] !== undefined),
      isNew: init.isNew,
      answered: init.answered,
      retries: init.retries,
      intro: init.intro,
    }),
    limits: init.limits,
    fastThresholds: init.fastThresholds,
    combo: 0,
  };
}
