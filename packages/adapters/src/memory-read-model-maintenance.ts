import type { ReadModelMaintenance } from "@instant-composition/application";
import { maintenancePageKey } from "./read-model-maintenance-key";
import { READ_MODEL_REGISTRY, registryLearner } from "./read-model-registry";
import { memorySystemRecord, type MemorySystemRows } from "./memory-system";
import { observeStorageRow } from "./storage-observed";
import { maintenanceCheckpointOf } from "./read-model-maintenance-schema";

/** Histories never participate in the bounded primary registry pages. */
export function memoryReadModelMaintenance(
  rows: MemorySystemRows,
): ReadModelMaintenance {
  return {
    ...memorySystemRecord(
      rows,
      "readModelMaintenance",
      { PK: "SYSTEM#READMODEL", SK: "CHECKPOINT" },
      maintenanceCheckpointOf,
    ),
    async profiles(cursor) {
      const key = maintenancePageKey(cursor);
      if (key !== undefined && key.PK !== READ_MODEL_REGISTRY)
        throw new RangeError("A registry cursor names one system range.");
      const entries = [...rows.values()]
        .filter(
          (row) =>
            row["PK"] === READ_MODEL_REGISTRY &&
            (key === undefined || String(row["SK"]) > key.SK),
        )
        .sort((a, b) => (String(a["SK"]) < String(b["SK"]) ? -1 : 1));
      const selected = entries.slice(0, 100);
      return Promise.resolve({
        learners: selected.map((raw) => {
          const row = observeStorageRow(
            "readModelLearner",
            { PK: READ_MODEL_REGISTRY, SK: String(raw["SK"]) },
            raw,
          );
          if (row === undefined) throw new TypeError("A registry row is absent.");
          return registryLearner(row.value);
        }),
        cursor:
          entries.length > 100
            ? JSON.stringify({ PK: READ_MODEL_REGISTRY, SK: selected.at(-1)?.["SK"] })
            : null,
      });
    },
  };
}
