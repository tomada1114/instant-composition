import { keyOf, type Entry } from "@instant-composition/application";
import { sortKeyOf } from "./keys";
import { candidatePrefix } from "./read-model-keys";
import { candidateCursorKey } from "./vocab-page-cursor";
import type { StorageFamily } from "./storage-families";

function canonicalPart(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 && encodeURIComponent(decoded) === value;
  } catch {
    return false;
  }
}
/** Value-only validation omits both transport keys; actual rows must bind both. */
export function storageKeysMatch(
  type: StorageFamily,
  value: unknown,
  partition?: string,
  sort?: string,
): boolean {
  if (partition === undefined && sort === undefined) return true;
  if (partition === undefined || sort === undefined) return false;
  switch (type) {
    case "identity":
      return (
        partition.startsWith("IDENTITY#") &&
        canonicalPart(partition.slice(9)) &&
        sort === "LEARNER"
      );
    case "readModelMaintenance":
      return partition === "SYSTEM#READMODEL" && sort === "CHECKPOINT";
    case "readModelBootstrap":
      return partition === "SYSTEM#READMODEL" && sort === "BOOTSTRAP";
    case "readModelLearner":
      return (
        typeof value === "object" &&
        value !== null &&
        partition === "SYSTEM#READMODEL_LEARNERS" &&
        typeof Reflect.get(value, "id") === "string" &&
        sort === encodeURIComponent(String(Reflect.get(value, "id")))
      );
    default: {
      if (type === "vocabPagedSession") {
        const session = value as Extract<Entry, { type: "vocabPagedSession" }>["value"];
        if (
          session.dueCursor !== null &&
          candidateCursorKey(
            session.dueCursor,
            candidatePrefix({
              day: session.day,
              generation: session.candidateGeneration,
              mode: "due",
              category: null,
              level: null,
            }),
            partition,
          ) === undefined
        )
          return false;
      }
      if (!partition.startsWith("LEARNER#") || !canonicalPart(partition.slice(8)))
        return false;
      // The owning decoder has validated the exhaustive Entry value before binding it.
      return sort === sortKeyOf(keyOf({ type, value } as Entry));
    }
  }
}
