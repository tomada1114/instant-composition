import type { CompositionCandidate } from "@instant-composition/application";

export function compositionCandidatePrefix(
  candidate: Pick<CompositionCandidate, "day" | "generation" | "mode">,
): string {
  return `READMODEL#COMPOSITION#${encodeURIComponent(candidate.day)}#${encodeURIComponent(candidate.generation)}#CANDIDATE#${candidate.mode}#`;
}
export function compositionCandidateSortKey(candidate: CompositionCandidate): string {
  return `${compositionCandidatePrefix(candidate)}${candidate.order}#${encodeURIComponent(candidate.id)}`;
}
