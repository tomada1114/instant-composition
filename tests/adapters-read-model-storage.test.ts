import { describeRawReadModelContract } from "./raw-read-model-contract";
import { describe, expect, it } from "vitest";
import {
  createMemoryStores,
  decodeStorageRow,
  encodeStorageValue,
  STORAGE_FAMILIES,
  StorageSchemaError,
} from "@instant-composition/adapters";
import { learnerId } from "@instant-composition/application";
import { makeStats } from "./application-fixtures";
import { makeCompositionCandidate } from "./composition-fixtures";

function row(type: string, value: unknown, schemaVersion = 4) {
  return { type, value, schemaVersion, version: 1 };
}
describe("cap4 storage declarations", () => {
  it("activates exactly28 families", () => {
    expect(STORAGE_FAMILIES).toHaveLength(28);
    expect(new Set(STORAGE_FAMILIES).size).toBe(28);
  });
  it.each([-1, -0.5, 0])("retains signed historical candidate mark %s", (at) => {
    const value = makeCompositionCandidate({ at });
    expect(encodeStorageValue("compositionCandidate", value)).toStrictEqual(value);
  });
  it.each([undefined, 0, 1, 2, 3, 5])(
    "refuses readmodel source declaration %s",
    (schemaVersion) => {
      const input = {
        type: "readModelSource",
        version: 1,
        value: { schema: 1 },
        ...(schemaVersion === undefined ? {} : { schemaVersion }),
      };
      expect(() => decodeStorageRow("readModelSource", input)).toThrow(
        StorageSchemaError,
      );
    },
  );
  it("admits both exact Stats forms and refuses hybrid/neither before normalization", () => {
    const compact = makeStats(),
      { streak, ...base } = compact;
    expect(streak).toStrictEqual({ schema: 1, longest: 0 });
    const legacy = { ...base, completedDays: ["2026-09-22"] };
    expect(encodeStorageValue("stats", legacy)).toStrictEqual(legacy);
    expect(encodeStorageValue("stats", compact)).toStrictEqual(compact);
    expect(() => encodeStorageValue("stats", { ...legacy, streak })).toThrow(
      StorageSchemaError,
    );
    expect(() => encodeStorageValue("stats", base)).toThrow(StorageSchemaError);
    expect(() => decodeStorageRow("stats", row("stats", compact, 3))).toThrow(
      StorageSchemaError,
    );
    expect(decodeStorageRow("stats", row("stats", legacy, 3)).value).toStrictEqual(
      legacy,
    );
  });
  it("admits the reachable empty completed maintenance page", () => {
    const value = {
      schema: 1,
      cursor: null,
      pending: [],
      index: 1,
      passCompletedAt: 1000,
    };
    expect(encodeStorageValue("readModelMaintenance", value)).toStrictEqual(value);
    expect(() =>
      encodeStorageValue("readModelMaintenance", { ...value, index: 2 }),
    ).toThrow(StorageSchemaError);
  });
  it.each([0, 101])(
    "refuses duplicate registry learners regardless of index %s",
    (index) => {
      const learner = {
        id: "a",
        profile: { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" },
      };
      expect(() =>
        encodeStorageValue("readModelMaintenance", {
          schema: 1,
          cursor: null,
          pending: [learner, learner],
          index,
          passCompletedAt: null,
        }),
      ).toThrow(StorageSchemaError);
    },
  );
  it("refuses a future global registry before changing the learner", async () => {
    const profile = { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" };
    const stores = createMemoryStores({
      systemRows: [
        {
          PK: "SYSTEM#READMODEL_LEARNERS",
          SK: "a",
          schemaVersion: 5,
          type: "readModelLearner",
          version: 1,
          value: { schema: 1, id: "a", profile },
        },
      ],
    });
    const store = stores.forLearner(learnerId("a"));
    expect(
      await store.commit({
        puts: [{ type: "profile", value: profile }],
        updates: [],
        expect: [],
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
    expect(await store.profile()).toBeUndefined();
  });
  it("refuses a malformed supported registry before changing the learner", async () => {
    const profile = { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" };
    const stores = createMemoryStores({
      systemRows: [
        {
          PK: "SYSTEM#READMODEL_LEARNERS",
          SK: "a",
          schemaVersion: 4,
          type: "readModelLearner",
          version: 1,
          value: { schema: 1, id: "a", profile, future: true },
        },
      ],
    });
    const store = stores.forLearner(learnerId("a"));
    await expect(
      store.commit({
        puts: [{ type: "profile", value: profile }],
        updates: [],
        expect: [],
      }),
    ).rejects.toBeInstanceOf(StorageSchemaError);
    expect(await store.profile()).toBeUndefined();
  });
});

describeRawReadModelContract("memory", (systemRows) => {
  const stores = createMemoryStores({ systemRows });
  return { stores, maintenance: stores.maintenance() };
});

it.each(["future", "malformed"])(
  "decodes exactly the chosen registry page and refuses its %s continuation",
  async (kind) => {
    const profile = { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" };
    const systemRows = Array.from({ length: 101 }, (_, at) => {
      const id = `registered-${String(at).padStart(3, "0")}`;
      return {
        PK: "SYSTEM#READMODEL_LEARNERS",
        SK: id,
        type: "readModelLearner",
        version: 1,
        schemaVersion: at === 100 && kind === "future" ? 5 : 4,
        value: {
          schema: 1,
          id,
          profile,
          ...(at === 100 && kind === "malformed" ? { unsupported: true } : {}),
        },
      };
    });
    const maintenance = createMemoryStores({ systemRows }).maintenance();
    const first = await maintenance.profiles(null);
    expect(first.learners).toHaveLength(100);
    expect(first.learners[0]?.id).toBe("registered-000");
    expect(first.learners[99]?.id).toBe("registered-099");
    await expect(maintenance.profiles(first.cursor)).rejects.toBeInstanceOf(
      StorageSchemaError,
    );
  },
);
