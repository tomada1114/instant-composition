import {
  compositionCandidateId,
  type LearnerStore,
} from "@instant-composition/application";
import type { GetEntry, EntryPage } from "./read-model-reads";
import { compositionCandidatePrefix } from "./composition-candidate-keys";

export function compositionCandidateReads(
  get: GetEntry,
  page: EntryPage,
): Pick<LearnerStore, "compositionCandidates" | "compositionCandidatesByKeys"> {
  return {
    compositionCandidates(request) {
      if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 250)
        throw new RangeError("A composition candidate page contains 1 to 250 rows.");
      return page(
        "compositionCandidate",
        compositionCandidatePrefix(request),
        request.limit,
        request.cursor,
      );
    },
    async compositionCandidatesByKeys(candidates) {
      const unique = new Map(
        candidates.map((candidate) => [compositionCandidateId(candidate), candidate]),
      );
      const rows = await Promise.all(
        [...unique].map(async ([id, candidate]) => {
          const stored = await get({ type: "compositionCandidate", candidate });
          return stored === undefined ? [] : [[id, stored] as const];
        }),
      );
      return new Map(rows.flat());
    },
  };
}
