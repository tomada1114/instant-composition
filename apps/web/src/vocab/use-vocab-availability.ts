import { useQuery } from "@tanstack/react-query";
import { VOCAB_QUERY } from "../lib/queries";
import type { VocabSession } from "../openapi";

/** Completion reads its category's remaining cards, after invalidating stale hub data. */
export function useVocabAvailability(session: VocabSession, enabled: boolean): number {
  const { data } = useQuery({
    ...VOCAB_QUERY,
    queryKey: ["vocab", "after", session.sessionId],
    enabled,
  });
  const category = data?.categories.find((row) => row.category === session.category);
  const extra = session.category === null ? data?.extra : category?.extra;
  const weak = session.category === null ? data?.weak : category?.weak;
  return (session.kind === "weak" ? weak : extra) ?? 0;
}
