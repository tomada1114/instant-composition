import { describe, expect, it } from "vitest";
import {
  StorageSchemaError,
  STORAGE_SCHEMA_VERSION,
} from "@instant-composition/adapters";
import {
  learnerId,
  type LearnerStores,
  type ReadModelMaintenance,
} from "@instant-composition/application";
import { makeProfile, makeSettings } from "./application-fixtures";

export interface RawReadModelHarness {
  readonly stores: LearnerStores;
  readonly maintenance: ReadModelMaintenance;
}
const checkpoint = {
  schema: 1 as const,
  cursor: null,
  pending: [],
  index: 1,
  passCompletedAt: 1000,
};
function registry(
  schemaVersion: number,
  value: unknown,
): Readonly<Record<string, unknown>> {
  return {
    PK: "SYSTEM#READMODEL_LEARNERS",
    SK: "a",
    type: "readModelLearner",
    version: 1,
    schemaVersion,
    value,
  };
}
/** The raw-destination refusal contract is shared by memory, wire and real DynamoDB. */
export function describeRawReadModelContract(
  name: string,
  fresh: (
    rows: readonly Readonly<Record<string, unknown>>[],
  ) => RawReadModelHarness | Promise<RawReadModelHarness>,
): void {
  describe(`${name}: strict raw read-model destinations`, () => {
    it.each([0, 1, 2, 3, STORAGE_SCHEMA_VERSION + 1])(
      "refuses registry schema%s before the complete learner transaction",
      async (schema) => {
        const h = await fresh([
          registry(schema, { schema: 1, id: "a", profile: makeProfile() }),
        ]);
        const store = h.stores.forLearner(learnerId("a"));
        expect(
          await store.commit({
            puts: [
              { type: "profile", value: makeProfile() },
              { type: "settings", value: makeSettings() },
            ],
            updates: [],
            expect: [],
          }),
        ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
        expect(await store.profile()).toBeUndefined();
        expect(await store.settings()).toBeUndefined();
      },
    );
    it.each([
      { schema: 1, id: "a", profile: makeProfile(), future: true },
      { schema: 1, id: "other", profile: makeProfile() },
    ])(
      "refuses registry shape/key mismatch before any sibling write %j",
      async (value) => {
        const h = await fresh([registry(4, value)]);
        const store = h.stores.forLearner(learnerId("a"));
        await expect(
          store.commit({
            puts: [
              { type: "profile", value: makeProfile() },
              { type: "settings", value: makeSettings() },
            ],
            updates: [],
            expect: [],
          }),
        ).rejects.toBeInstanceOf(StorageSchemaError);
        expect(await store.profile()).toBeUndefined();
        expect(await store.settings()).toBeUndefined();
      },
    );
    it.each([3, STORAGE_SCHEMA_VERSION + 1])(
      "refuses checkpoint schema%s even when the supplied version expects absence",
      async (schemaVersion) => {
        const h = await fresh([
          {
            PK: "SYSTEM#READMODEL",
            SK: "CHECKPOINT",
            type: "readModelMaintenance",
            version: 1,
            schemaVersion,
            value: checkpoint,
          },
        ]);
        await expect(h.maintenance.checkpoint()).rejects.toBeInstanceOf(
          StorageSchemaError,
        );
        await expect(h.maintenance.save(checkpoint, null)).rejects.toBeInstanceOf(
          StorageSchemaError,
        );
      },
    );
    it("refuses malformed current checkpoint before replacing it", async () => {
      const h = await fresh([
        {
          PK: "SYSTEM#READMODEL",
          SK: "CHECKPOINT",
          type: "readModelMaintenance",
          version: 1,
          schemaVersion: 4,
          value: { ...checkpoint, future: true },
        },
      ]);
      await expect(h.maintenance.save(checkpoint, 1)).rejects.toBeInstanceOf(
        StorageSchemaError,
      );
      await expect(h.maintenance.checkpoint()).rejects.toBeInstanceOf(
        StorageSchemaError,
      );
    });
  });
}
