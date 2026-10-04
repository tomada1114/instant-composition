import { learnerStorageRevision } from "../lib/learner-storage";
import {
  object,
  natural,
  strings,
  numericMap,
  cardShape,
  phaseShape,
} from "./paged-checkpoint-shape";
import type { VocabPagedState } from "./paged-state";
import type { VocabSearch } from "./sessions";
import { sessionStore } from "../study/answer-queue";
import { readAnswer } from "../study/stored-answer";

const ACTIVE = "vocab-active:";
export function checkpointKey(sessionId: string): string {
  return `vocab-checkpoint:${sessionId}`;
}
function activeKey(search: VocabSearch): string {
  return `${ACTIVE}${search.kind}:${search.category ?? "all"}`;
}

function activeId(raw: string | null | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return object(value) &&
      value["revision"] === learnerStorageRevision() &&
      typeof value["id"] === "string" &&
      value["id"].length <= 64
      ? value["id"]
      : undefined;
  } catch {
    return undefined;
  }
}
/** The request id is saved before start, so a reload resumes preparation rather than creating another deck. */
export function vocabSessionId(search: VocabSearch): string {
  const storage = sessionStore();
  try {
    const kept = activeId(storage?.getItem(activeKey(search)));
    if (kept !== undefined) return kept;
    const id = crypto.randomUUID();
    storage?.setItem(
      activeKey(search),
      JSON.stringify({ id, revision: learnerStorageRevision() }),
    );
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearVocabCheckpoint(sessionId: string): void {
  const storage = sessionStore();
  if (storage === undefined) return;
  try {
    storage.removeItem(checkpointKey(sessionId));
    for (let index = 0; index < storage.length;) {
      const key = storage.key(index);
      if (
        key?.startsWith(ACTIVE) === true &&
        activeId(storage.getItem(key)) === sessionId
      )
        storage.removeItem(key);
      else index += 1;
    }
  } catch {
    /* The live state still closes if browser storage is blocked. */
  }
}

/** A checkpoint is bounded and validated; queued answers remain separate even if it is unreadable. */
export function readVocabCheckpoint(
  sessionId: string,
  generation: number,
): VocabPagedState | undefined {
  try {
    const raw = sessionStore()?.getItem(checkpointKey(sessionId));
    if (raw === undefined || raw === null || raw.length > 400_000) return undefined;
    const state: unknown = JSON.parse(raw);
    if (
      !object(state) ||
      state["sessionId"] !== sessionId ||
      state["storageRevision"] !== learnerStorageRevision() ||
      state["generation"] !== generation ||
      !strings(state["fresh"], 64) ||
      !numericMap(state["asked"]) ||
      !numericMap(state["goods"]) ||
      !natural(state["loadedPage"]) ||
      !natural(state["firstShown"]) ||
      !natural(state["step"]) ||
      !natural(state["total"]) ||
      typeof state["paused"] !== "boolean" ||
      state["retries"] !== true ||
      typeof state["hasMore"] !== "boolean" ||
      !(
        state["continuation"] === null ||
        (typeof state["continuation"] === "string" &&
          /^\d{1,16}:\d{1,16}$/u.test(state["continuation"]))
      ) ||
      !object(state["isNew"]) ||
      Object.keys(state["isNew"]).length > 80 ||
      !Object.values(state["isNew"]).every((value) => typeof value === "boolean") ||
      !Array.isArray(state["reAsks"]) ||
      state["reAsks"].length > 16 ||
      !state["reAsks"].every(
        (value: unknown) =>
          object(value) && typeof value["cardId"] === "string" && natural(value["due"]),
      ) ||
      !Array.isArray(state["answers"]) ||
      state["answers"].length > 1 ||
      !state["answers"].every((value: unknown) => readAnswer(value) !== undefined) ||
      !object(state["cards"]) ||
      Object.keys(state["cards"]).length > 80 ||
      !Object.values(state["cards"]).every(cardShape) ||
      !phaseShape(state["phase"])
    )
      return undefined;
    const card = state["card"];
    if (
      card !== undefined &&
      (!object(card) ||
        typeof card["cardId"] !== "string" ||
        !["first", "retry"].includes(String(card["pass"])) ||
        !natural(card["ask"]))
    )
      return undefined;
    const checkpoint = state as unknown as VocabPagedState;
    if (checkpoint.phase.kind === "front")
      return {
        ...checkpoint,
        phase: {
          ...checkpoint.phase,
          spentMs:
            checkpoint.phase.spentMs +
            Math.max(
              0,
              (checkpoint.phase.now ?? 0) -
                (checkpoint.phase.runningSince ?? checkpoint.phase.now ?? 0),
            ),
          runningSince: null,
          now: null,
        },
      };
    return checkpoint.phase.kind === "back"
      ? { ...checkpoint, phase: { ...checkpoint.phase, since: 0 } }
      : checkpoint;
  } catch {
    return undefined;
  }
}

export function saveVocabCheckpoint(state: VocabPagedState): boolean {
  try {
    const storage = sessionStore();
    if (storage === undefined || state.storageRevision !== learnerStorageRevision())
      return false;
    storage.setItem(checkpointKey(state.sessionId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
