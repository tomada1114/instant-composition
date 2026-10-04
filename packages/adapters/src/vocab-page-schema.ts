import { z } from "zod";
import { category, count, day } from "./storage-common";
import { candidatePrefix } from "./read-model-keys";
import { candidateCursorKey } from "./vocab-page-cursor";

const id = z.string().min(1).max(200);
const identity = { sessionId: id, generation: count, page: count };
const ids = (limit: number) =>
  z
    .array(id)
    .max(limit)
    .refine((values) => new Set(values).size === values.length);

function pageSessionSchema() {
  return z
    .strictObject({
      id,
      kind: z.enum(["today", "extra", "weak"]),
      category: category.nullable(),
      day,
      startedAt: count,
      finishedAt: count.nullable(),
      tomorrow: count.nullable(),
      status: z.enum(["building", "ready"]),
      generation: count,
      catalog: z.string().max(256),
      sourceVersion: count,
      modelVersion: count,
      settingsVersion: count.nullable(),
      statsVersion: count.nullable(),
      candidateGeneration: z.string().max(1024),
      dueCount: count,
      fresh: ids(200),
      dueCursor: z.string().max(4096).nullable(),
      dueRead: count,
      freshRead: count.max(200),
      pages: count,
      total: count,
      answered: count,
      introduced: count,
      againCount: count,
      again: z
        .array(
          z.strictObject({
            cardId: id,
            headword: z.string().max(2048),
            meaning: z.string().max(20),
            category,
            level: count,
          }),
        )
        .max(32),
    })
    .refine((session) => {
      const read = session.dueRead + session.freshRead;
      const prefix = candidatePrefix({
        day: session.day,
        generation: session.candidateGeneration,
        mode: "due",
        category: null,
        level: null,
      });
      if (
        session.dueCursor !== null &&
        candidateCursorKey(session.dueCursor, prefix) === undefined
      )
        return false;
      if (
        !Number.isSafeInteger(read) ||
        session.dueRead > session.dueCount ||
        (session.dueRead === 0 && session.dueCursor !== null) ||
        (session.dueRead > 0 &&
          session.dueRead < session.dueCount &&
          session.dueCursor === null) ||
        session.answered > session.total ||
        session.introduced > session.answered ||
        session.againCount > session.answered ||
        session.again.length > session.againCount ||
        new Set(session.again.map((row) => row.cardId)).size !== session.again.length ||
        (session.finishedAt === null) !== (session.tomorrow === null) ||
        session.pages !== Math.ceil(read / 64)
      )
        return false;
      if (session.status === "building") {
        const size = session.dueCount + session.fresh.length;
        return (
          Number.isSafeInteger(size) &&
          session.total <= size &&
          read < size &&
          session.freshRead <= session.fresh.length &&
          session.finishedAt === null &&
          session.answered === 0 &&
          session.introduced === 0 &&
          session.againCount === 0 &&
          session.again.length === 0
        );
      }
      // A category with no cards can be ready without consuming global positions.
      return (
        session.total === 0 ||
        (session.total <= read &&
          session.dueRead === session.dueCount &&
          session.fresh.length === 0 &&
          session.pages > 0)
      );
    });
}

/** The shared declared-history graph validates these families before normalization. */
export function vocabPageSchemas(): ReturnType<typeof makePageSchemas> {
  return makePageSchemas();
}

function makePageSchemas() {
  return {
    vocabPagedSession: pageSessionSchema(),
    vocabSessionGuard: z.strictObject({ id, finishedAt: count.nullable() }),
    vocabDeckPage: z.strictObject({
      ...identity,
      cards: z
        .array(z.strictObject({ id, isNew: z.boolean() }))
        .max(64)
        .refine((cards) => new Set(cards.map((card) => card.id)).size === cards.length),
    }),
    vocabPageProgress: z.strictObject({ ...identity, answered: ids(64) }),
  };
}
