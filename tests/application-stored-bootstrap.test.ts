import { describe, expect, it } from "vitest";
import {
  advanceStoredReadModelBootstrap,
  learnerId,
  compositionReadModelsValidity,
  vocabReadModelsReady,
  type ReadModelBootstrapStorage,
  type ReadModelBootstrapState,
  type ReadModelBootstrapDriver,
  type ReadModelMaintenance,
  type StorageBootstrapRelease,
  type Stored,
} from "@instant-composition/application";
import {
  runReadModelWorker,
  runStoredReadModelBootstrap,
  createReadModelWorkerHandler,
  readModelBootstrapValidity,
} from "@instant-composition/api";
import {
  makeHarness,
  fixedCatalog,
  makeSnapshot,
  NOON,
  DAY_MS,
} from "./application-harness";
import { makeProfile, makeItem } from "./application-fixtures";

const RELEASE: StorageBootstrapRelease = {
  sha: "a".repeat(40),
  contract: "read-model-v1",
  schemaFingerprint: "b".repeat(64),
};
function durable() {
  let value: Stored<ReadModelBootstrapState> | undefined;
  const storage: ReadModelBootstrapStorage = {
    checkpoint: () => Promise.resolve(value),
    save(state, version) {
      if (version !== (value?.version ?? null))
        return Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } });
      value = { value: state, version: (value?.version ?? 0) + 1 };
      return Promise.resolve({ ok: true, value: undefined });
    },
  };
  return { storage, current: () => value };
}

describe("scheduled read-model worker", () => {
  it("ends its invocation without failing when an overlapping one won the shared checkpoint", async () => {
    const h = makeHarness();
    const shared = h.stores.maintenance();
    let saves = 0;
    const maintenance: ReadModelMaintenance = {
      checkpoint: () => shared.checkpoint(),
      profiles: (cursor) => shared.profiles(cursor),
      save: () => {
        saves += 1;
        return Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } });
      },
    };
    await expect(runReadModelWorker(h.deps, maintenance, NOON)).resolves.toStrictEqual({
      status: "idle",
      learners: 0,
      rows: 0,
    });
    expect(saves).toBe(1);
  });
});

describe("durable deployment bootstrap", () => {
  it("requires the trusted second-handler release context and keeps the operator response on five fields", async () => {
    const h = makeHarness();
    const saved = durable();
    const backfill = () => Promise.resolve({ cursor: null, rows: 0 });
    const ready = () => Promise.resolve(undefined);
    await expect(
      runStoredReadModelBootstrap(
        h.deps,
        h.stores.maintenance(),
        saved.storage,
        {},
        backfill,
        NOON,
        null,
        ready,
      ),
    ).rejects.toThrow("trusted storage guard release context");
    const result = await runStoredReadModelBootstrap(
      h.deps,
      h.stores.maintenance(),
      saved.storage,
      { storageRelease: RELEASE },
      backfill,
      NOON,
      null,
      ready,
    );
    expect(Object.keys(result).sort()).toStrictEqual([
      "checkpoint",
      "complete",
      "learners",
      "phase",
      "rows",
    ]);
    expect(saved.current()?.value.release).toStrictEqual(RELEASE);
  });

  it("resumes a fresh job's null checkpoint and ignores operator cursors until worker-owned discovery, preparation and verification finish", async () => {
    const h = makeHarness();
    const store = h.stores.forLearner(h.learner);
    await store.commit({
      puts: [
        {
          type: "profile",
          value: {
            timeZone: h.context().learner.timeZone,
            l1: h.context().learner.l1,
            target: h.context().learner.target,
            uiLocale: h.context().learner.uiLocale,
          },
        },
      ],
      updates: [],
      expect: [],
    });
    const saved = durable();
    const cursors: (string | null)[] = [];
    const cursor = JSON.stringify({ PK: "legacy", SK: "page2" });
    const driver: ReadModelBootstrapDriver = {
      backfill(position) {
        cursors.push(position);
        return Promise.resolve({
          cursor: position === null ? cursor : null,
          rows: 100,
        });
      },
      prepare: (now) => runReadModelWorker(h.deps, h.stores.maintenance(), now),
      async ready(context) {
        const [a, b] = await Promise.all([
          compositionReadModelsValidity(h.deps, context),
          vocabReadModelsReady(h.deps, context),
        ]);
        return a === undefined || b === undefined ? undefined : Math.min(a, b);
      },
    };
    const step = (now = NOON, caller: string | null = null) =>
      advanceStoredReadModelBootstrap(
        h.deps,
        h.stores.maintenance(),
        driver,
        saved.storage,
        RELEASE,
        now,
        caller,
      );
    const forged = JSON.stringify({
      schema: 1,
      phase: "verification",
      catalog: "sha256:fixture",
      cursor: null,
      validUntil: null,
    });
    expect(await step(NOON, forged)).toMatchObject({
      complete: false,
      phase: "discovery",
      rows: 100,
    });
    expect(await step(NOON, forged)).toMatchObject({
      complete: false,
      phase: "preparation",
      rows: 100,
    });
    expect(await step()).toMatchObject({ complete: false, phase: "verification" });
    expect(await step()).toStrictEqual({
      complete: true,
      phase: "verification",
      checkpoint: null,
      rows: 0,
      learners: 1,
    });
    expect(cursors).toStrictEqual([null, cursor]);
    expect(saved.current()?.value.maintenanceVersion).toBeGreaterThan(0);
    expect(saved.current()?.value.validUntil).toBeGreaterThan(NOON);
    // A completed cache still verifies current source and profile on the next fresh job.
    await store.commit({
      puts: [{ type: "item", value: makeItem() }],
      updates: [],
      expect: [],
    });
    expect(await step()).toMatchObject({ complete: false, phase: "preparation" });
    expect(cursors).toHaveLength(2);
    await step(NOON + 60_000);
    expect(await step(NOON + 60_000)).toMatchObject({ complete: true });
    const profile = await store.profile();
    if (profile === undefined) throw new Error("The profile is missing.");
    await store.commit({
      puts: [],
      updates: [
        {
          entry: {
            type: "profile",
            value: makeProfile({ timeZone: "America/Los_Angeles" }),
          },
          version: profile.version,
        },
      ],
      expect: [],
    });
    expect(await step()).toMatchObject({ complete: false, phase: "preparation" });
  });

  it("restarts a completed release on day/catalog change and restarts discovery for a different trusted release", async () => {
    const h = makeHarness();
    await h.stores.forLearner(h.learner).commit({
      puts: [
        {
          type: "profile",
          value: {
            timeZone: h.context().learner.timeZone,
            l1: h.context().learner.l1,
            target: h.context().learner.target,
            uiLocale: h.context().learner.uiLocale,
          },
        },
      ],
      updates: [],
      expect: [],
    });
    const saved = durable();
    let discoveries = 0;
    const driver: ReadModelBootstrapDriver = {
      backfill: () => {
        discoveries += 1;
        return Promise.resolve({ cursor: null, rows: 1 });
      },
      prepare: () => Promise.resolve({ status: "idle", rows: 0, learners: 0 }),
      ready: (context) => Promise.resolve(context.now + DAY_MS),
    };
    const step = (deps = h.deps, now = NOON, release = RELEASE) =>
      advanceStoredReadModelBootstrap(
        deps,
        h.stores.maintenance(),
        driver,
        saved.storage,
        release,
        now,
        null,
      );
    await step();
    await step();
    expect((await step()).complete).toBe(true);
    let readyCalls = 0;
    driver.ready = () => {
      readyCalls += 1;
      return Promise.resolve(undefined);
    };
    expect(await step(h.deps, NOON + DAY_MS)).toMatchObject({
      complete: false,
      phase: "preparation",
    });
    expect(readyCalls).toBe(1);
    const changed = {
      ...h.deps,
      catalog: fixedCatalog({ ...makeSnapshot(), version: "next-catalog" }),
    };
    expect(await step(changed)).toMatchObject({
      complete: false,
      phase: "verification",
    });
    expect(saved.current()?.value.catalog).toBe("next-catalog");
    expect(
      await step(changed, NOON, { ...RELEASE, sha: "c".repeat(40) }),
    ).toMatchObject({ complete: false, phase: "preparation", rows: 1 });
    expect(discoveries).toBe(2);
  });

  it("resumes a worker-owned verification cursor across fresh jobs with more than one registry page", async () => {
    const h = makeHarness();
    for (let index = 0; index < 101; index += 1) {
      await h.stores
        .forLearner(learnerId(`registered-${String(index).padStart(3, "0")}`))
        .commit({
          puts: [{ type: "profile", value: makeProfile() }],
          updates: [],
          expect: [],
        });
    }
    const saved = durable();
    const verified: string[] = [];
    const driver: ReadModelBootstrapDriver = {
      backfill: () => Promise.resolve({ cursor: null, rows: 0 }),
      prepare: () => Promise.resolve({ status: "idle", rows: 0, learners: 0 }),
      ready(context) {
        verified.push(context.learner.id);
        return Promise.resolve(NOON + DAY_MS);
      },
    };
    const step = () =>
      advanceStoredReadModelBootstrap(
        h.deps,
        h.stores.maintenance(),
        driver,
        saved.storage,
        RELEASE,
        NOON,
        null,
      );
    await step();
    await step();
    expect(await step()).toMatchObject({
      complete: false,
      phase: "verification",
      learners: 100,
    });
    expect(saved.current()?.value.checkpoint).toContain("SYSTEM#READMODEL_LEARNERS");
    expect(await step()).toStrictEqual({
      complete: true,
      phase: "verification",
      checkpoint: null,
      rows: 0,
      learners: 1,
    });
    expect(verified).toHaveLength(101);
    expect(new Set(verified).size).toBe(101);
    // Completion is a cache: a fresh job starts a new verification pass at its first page.
    expect(await step()).toMatchObject({ complete: false, learners: 100 });
    expect(verified).toHaveLength(201);
  });

  it("does not report progress after a durable CAS conflict", async () => {
    const h = makeHarness();
    const storage: ReadModelBootstrapStorage = {
      checkpoint: () => Promise.resolve(undefined),
      save: () => Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } }),
    };
    await expect(
      advanceStoredReadModelBootstrap(
        h.deps,
        h.stores.maintenance(),
        {
          backfill: () => Promise.resolve({ cursor: null, rows: 0 }),
          prepare: () => Promise.resolve({ status: "idle", rows: 0, learners: 0 }),
          ready: () => Promise.resolve(undefined),
        },
        storage,
        RELEASE,
        NOON,
        null,
      ),
    ).rejects.toThrow("ERR_CONFLICT");
  });
});

describe("hosted worker bootstrap dispatch", () => {
  it.each([
    undefined,
    {},
    { storageRelease: { ...RELEASE, sha: "chosen" } },
    { storageRelease: { ...RELEASE, unknown: true } },
  ])("refuses invalid trusted context before runtime creation %j", async (context) => {
    let created = 0;
    const handler = createReadModelWorkerHandler(() => {
      created += 1;
      throw new Error("Runtime creation is forbidden.");
    });
    await expect(
      handler({ storageBootstrap: true, checkpoint: null }, context),
    ).rejects.toBeInstanceOf(TypeError);
    expect(created).toBe(0);
  });
  it("refuses event-supplied release identity before runtime creation", async () => {
    let created = 0;
    const handler = createReadModelWorkerHandler(() => {
      created += 1;
      throw new Error("Runtime creation is forbidden.");
    });
    await expect(
      handler(
        { storageBootstrap: true, checkpoint: null, storageRelease: RELEASE },
        { storageRelease: RELEASE },
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(created).toBe(0);
  });
  it("uses durable null-checkpoint progress and both released slices on the actual handler branch", async () => {
    const h = makeHarness();
    const store = h.stores.forLearner(h.learner);
    await store.commit({
      puts: [{ type: "profile", value: makeProfile() }],
      updates: [],
      expect: [],
    });
    const saved = durable();
    let created = 0,
      closed = 0,
      discoveries = 0;
    const handler = createReadModelWorkerHandler(() => {
      created += 1;
      return {
        deps: h.deps,
        maintenance: h.stores.maintenance(),
        storage: saved.storage,
        now: NOON,
        backfill: () => {
          discoveries += 1;
          return Promise.resolve({ cursor: null, rows: 1 });
        },
        ready: (context) => readModelBootstrapValidity(h.deps, context),
        close: () => {
          closed += 1;
        },
      };
    });
    const step = () =>
      handler(
        { storageBootstrap: true, checkpoint: null },
        { storageRelease: RELEASE },
      );
    expect(await step()).toMatchObject({ complete: false, phase: "preparation" });
    expect(await step()).toMatchObject({ complete: false, phase: "verification" });
    expect(await step()).toStrictEqual({
      complete: true,
      phase: "verification",
      checkpoint: null,
      rows: 0,
      learners: 1,
    });
    const context = {
      ...h.context(),
      actor: {
        kind: "system" as const,
        job: "rebuild-projections" as const,
        onBehalfOf: h.learner,
      },
    };
    const model = await store.compositionReadModel("2026-09-22");
    if (model === undefined)
      throw new Error("The released composition generation is absent.");
    const expiresAt = Math.floor(NOON / 1000) + 60;
    await store.commit({
      puts: [],
      updates: [
        {
          entry: { type: "compositionReadModel", value: { ...model.value, expiresAt } },
          version: model.version,
        },
      ],
      expect: [],
    });
    expect(await readModelBootstrapValidity(h.deps, context)).toBe(expiresAt * 1000);
    const changed = await store.compositionReadModel("2026-09-22");
    if (changed === undefined)
      throw new Error("The released composition generation is absent.");
    await store.commit({
      puts: [],
      updates: [
        {
          entry: {
            type: "compositionReadModel",
            value: { ...changed.value, expiresAt: Math.floor(NOON / 1000) },
          },
          version: changed.version,
        },
      ],
      expect: [],
    });
    expect(await step()).toMatchObject({ complete: false, phase: "preparation" });
    expect(discoveries).toBe(1);
    expect(created).toBe(4);
    expect(closed).toBe(4);
  });
  it("closes the created runtime after a durable checkpoint refusal", async () => {
    const h = makeHarness();
    let closed = 0;
    const handler = createReadModelWorkerHandler(() => ({
      deps: h.deps,
      maintenance: h.stores.maintenance(),
      storage: {
        checkpoint: () => Promise.resolve(undefined),
        save: () => Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } }),
      },
      backfill: () => Promise.resolve({ cursor: null, rows: 0 }),
      ready: () => Promise.resolve(undefined),
      now: NOON,
      close: () => {
        closed += 1;
      },
    }));
    await expect(
      handler(
        { storageBootstrap: true, checkpoint: null },
        { storageRelease: RELEASE },
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(closed).toBe(1);
  });
});
