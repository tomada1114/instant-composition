import { describe, expect, it } from "vitest";
import {
  decodeStorageRecord,
  encodeStorageValue,
  StorageSchemaError,
  STORAGE_SCHEMA_VERSION,
} from "@instant-composition/adapters";
import { makeVocabPagedSession } from "./application-fixtures";

const session = makeVocabPagedSession();
const families = [
  { type: "vocabPagedSession", value: session, SK: "VOCAB_PAGED#s1" },
  {
    type: "vocabDeckPage",
    value: {
      sessionId: "s1",
      generation: 1,
      page: 0,
      cards: [{ id: "v1", isNew: false }],
    },
    SK: "VOCAB_PAGED#s1#GEN#1#DECK#0",
  },
  {
    type: "vocabPageProgress",
    value: { sessionId: "s1", generation: 1, page: 0, answered: ["v1"] },
    SK: "VOCAB_PAGED#s1#GEN#1#PROGRESS#0",
  },
  {
    type: "vocabSessionGuard",
    value: { id: "s1", finishedAt: null },
    SK: "VOCAB#s1#GUARD",
  },
] as const;
function row(
  family: (typeof families)[number],
  schemaVersion = STORAGE_SCHEMA_VERSION,
) {
  return { ...family, PK: "LEARNER#owner", version: 1, schemaVersion };
}

describe("strict schema5 paged vocabulary history", () => {
  it.each(families)(
    "binds complete $type rows to canonical keys and preserves raw input",
    (family) => {
      const original = row(family);
      const retained = JSON.stringify(original);
      expect(decodeStorageRecord(original).value).toStrictEqual(family.value);
      expect(encodeStorageValue(family.type, family.value)).toStrictEqual(family.value);
      expect(JSON.stringify(original)).toBe(retained);
      expect(() =>
        decodeStorageRecord({ ...original, SK: `${original.SK}#extra` }),
      ).toThrow(StorageSchemaError);
      expect(() => decodeStorageRecord({ ...original, expiresAt: 0 })).toThrow(
        StorageSchemaError,
      );
      expect(() =>
        decodeStorageRecord({ ...original, value: { ...family.value, future: true } }),
      ).toThrow(StorageSchemaError);
    },
  );

  it.each([0, 1, 2, 3, 4, STORAGE_SCHEMA_VERSION + 1])(
    "refuses birth/future schema %s before normalization",
    (schema) => {
      for (const family of families)
        expect(() => decodeStorageRecord(row(family, schema))).toThrow(
          StorageSchemaError,
        );
    },
  );

  it("refuses duplicate immutable membership, adoption and new-card lists", () => {
    expect(() =>
      encodeStorageValue("vocabDeckPage", {
        sessionId: "s1",
        generation: 1,
        page: 0,
        cards: [
          { id: "v1", isNew: false },
          { id: "v1", isNew: true },
        ],
      }),
    ).toThrow(StorageSchemaError);
    expect(() =>
      encodeStorageValue("vocabPageProgress", {
        sessionId: "s1",
        generation: 1,
        page: 0,
        answered: ["v1", "v1"],
      }),
    ).toThrow(StorageSchemaError);
    expect(() =>
      encodeStorageValue(
        "vocabPagedSession",
        makeVocabPagedSession({
          status: "building",
          dueCount: 0,
          dueRead: 0,
          pages: 0,
          total: 2,
          fresh: ["v1", "v1"],
        }),
      ),
    ).toThrow(StorageSchemaError);
  });

  it("refuses nested unknown snapshot fields and duplicate preview card IDs", () => {
    const snapshot = {
      cardId: "v1",
      headword: "one",
      meaning: "一",
      category: "word" as const,
      level: 1,
    };
    const header = makeVocabPagedSession({
      total: 2,
      dueCount: 2,
      dueRead: 2,
      answered: 2,
      againCount: 2,
    });
    expect(() =>
      encodeStorageValue("vocabPagedSession", {
        ...header,
        again: [snapshot, snapshot],
      }),
    ).toThrow(StorageSchemaError);
    expect(() =>
      encodeStorageValue("vocabPagedSession", {
        ...header,
        again: [{ ...snapshot, future: true }],
      }),
    ).toThrow(StorageSchemaError);
    expect(() =>
      encodeStorageValue("vocabDeckPage", {
        sessionId: "s1",
        generation: 1,
        page: 0,
        cards: [{ id: "v1", isNew: false, future: true }],
      }),
    ).toThrow(StorageSchemaError);
  });

  it.each([
    { day: "2026-02-30" },
    { generation: Number.MAX_SAFE_INTEGER + 1 },
    { answered: 2 },
    { introduced: 1 },
    { againCount: 1 },
    { finishedAt: 2000, tomorrow: null },
    { pages: 0 },
    { total: 2 },
    { status: "building" as const, dueCount: 2 },
    { status: "building" as const, answered: 1 },
  ])("refuses invalid checkpoint relationships %j", (change) => {
    expect(() =>
      encodeStorageValue("vocabPagedSession", { ...session, ...change }),
    ).toThrow(StorageSchemaError);
  });

  it("admits filtered empty pages, retained generations, and zero-ready shortcuts", () => {
    expect(
      encodeStorageValue("vocabDeckPage", {
        sessionId: "s1",
        generation: 0,
        page: 0,
        cards: [],
      }),
    ).toStrictEqual({ sessionId: "s1", generation: 0, page: 0, cards: [] });
    expect(
      encodeStorageValue("vocabPageProgress", {
        sessionId: "s1",
        generation: 1,
        page: 1,
        answered: [],
      }),
    ).toStrictEqual({ sessionId: "s1", generation: 1, page: 1, answered: [] });
    const filtered = makeVocabPagedSession({
      dueCount: 65,
      dueRead: 65,
      pages: 2,
      total: 2,
    });
    expect(encodeStorageValue("vocabPagedSession", filtered)).toStrictEqual(filtered);
    const zero = makeVocabPagedSession({
      dueCount: 130,
      dueRead: 0,
      fresh: ["v_new"],
      pages: 0,
      total: 0,
    });
    expect(encodeStorageValue("vocabPagedSession", zero)).toStrictEqual(zero);
    const finite = makeVocabPagedSession({
      dueCount: 0,
      dueRead: 0,
      fresh: [],
      freshRead: 1,
    });
    expect(encodeStorageValue("vocabPagedSession", finite)).toStrictEqual(finite);
  });
});
