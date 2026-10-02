import { useTranslations } from "use-intl";

import type { RoundPayload } from "../openapi";
import { currentCard, type DrillState } from "./drill-state";

/**
 * What a screen reader hears as the drill moves: a front with its prompt (a
 * re-ask with "again" first), "timed out", and each grade by its name —
 * never the seconds ticking.
 */
export function useAnnouncement(state: DrillState, round: RoundPayload): string {
  const t = useTranslations("Drill");
  const card = currentCard(state);
  const content = card === undefined ? undefined : round.cards[card.cardId];
  const { phase } = state;
  if (card === undefined || content === undefined) return "";
  if (phase.kind === "feedback") return t(`grade.${phase.grade}`);
  if (phase.kind === "back" && phase.mode === "timeout") return t("announce.timeout");
  const front = { ja: content.prompt, seconds: content.limitMs / 1000 };
  return card.pass === "retry"
    ? t("announce.againFront", front)
    : t("announce.front", front);
}
