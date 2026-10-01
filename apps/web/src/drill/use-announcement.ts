import { useTranslations } from "use-intl";

import type { RoundPayload } from "../openapi";
import { currentCard, type DrillState } from "./drill-state";

/**
 * What a screen reader hears as the drill moves: never the seconds ticking.
 */
export function useAnnouncement(state: DrillState, round: RoundPayload): string {
  const t = useTranslations("Drill.announce");
  const card = currentCard(state);
  const content = card === undefined ? undefined : round.cards[card.cardId];
  const { phase } = state;
  if (content === undefined) return "";
  if (phase.kind === "feedback") return phase.result === "ok" ? t("said") : t("review");
  if (phase.kind === "back" && phase.mode === "timeout") return t("timeout");
  return t("front", { ja: content.prompt, seconds: content.limitMs / 1000 });
}
