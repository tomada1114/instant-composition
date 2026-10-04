import {
  CANDIDATE_PAGE_SIZE,
  type CandidatePageRequest,
  type Commit,
  type VocabCandidate,
} from "@instant-composition/application";

export const READ_MODEL_SOURCE_KEY = "READMODEL#SOURCE";

/** Source changes invalidate old generations in the same transaction. */
export function changesReadModelSource(commit: Commit): boolean {
  const reserved = [...commit.puts, ...commit.updates.map(({ entry }) => entry)].some(
    (entry) => entry.type === "readModelSource",
  );
  const source = (type: string): boolean => type === "card" || type === "vocabItem";
  const changed =
    [...commit.puts, ...commit.updates.map(({ entry }) => entry)].some((entry) =>
      source(entry.type),
    ) || (commit.deletes ?? []).some(({ key }) => source(key.type));
  if (changed && reserved)
    throw new RangeError(
      "Source records and their reserved epoch use separate restore commits.",
    );
  return changed;
}

export function candidatePrefix(
  candidate: Pick<VocabCandidate, "day" | "generation" | "mode" | "category" | "level">,
): string {
  const part = (value: string): string => encodeURIComponent(value);
  return `READMODEL#VOCAB#${part(candidate.day)}#${part(candidate.generation)}#${candidate.mode}#${candidate.category ?? "all"}#${String(candidate.level ?? "all")}#`;
}

export function candidateSortKey(candidate: VocabCandidate): string {
  return `${candidatePrefix(candidate)}${candidate.order}#${encodeURIComponent(candidate.cardId)}`;
}

/** Cursors cannot move a read into another learner or candidate bucket. */
export function pageStart(
  partition: string,
  prefix: string,
  cursor: string | null,
): string | undefined {
  if (cursor === null) return undefined;
  const marker = `${encodeURIComponent(partition)}|${encodeURIComponent(prefix)}|`;
  if (!cursor.startsWith(marker))
    throw new RangeError("A cursor belongs to one learner and one page range.");
  const key = cursor.slice(marker.length);
  if (!key.startsWith(prefix))
    throw new RangeError("A cursor belongs to one page range.");
  return key;
}

export function pageCursor(partition: string, prefix: string, key: string): string {
  return `${encodeURIComponent(partition)}|${encodeURIComponent(prefix)}|${key}`;
}

export function checkCandidatePage(request: CandidatePageRequest): void {
  if (
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > CANDIDATE_PAGE_SIZE
  ) {
    throw new RangeError(
      `A candidate page contains 1 to ${String(CANDIDATE_PAGE_SIZE)} rows.`,
    );
  }
}
