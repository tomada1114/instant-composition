import { describe, expect, it } from "vitest";
import { runReadModelBootstrap } from "@instant-composition/api";
import {
  advanceReadModelBootstrap,
  vocabReadModelsReady,
  type ReadModelBootstrapDriver,
  type ReadModelBootstrapResult,
} from "@instant-composition/application";
import { DAY_MS, makeHarness, NOON } from "./application-harness";

async function registered() {
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
  return { ...h, maintenance: h.stores.maintenance() };
}

describe("deployment read-model bootstrap", () => {
  it("resumes fixed legacy discovery pages and completes only after independently prepared models verify", async () => {
    const h = await registered();
    const cursors: (string | null)[] = [];
    const backfill: ReadModelBootstrapDriver["backfill"] = (cursor) => {
      cursors.push(cursor);
      return Promise.resolve({
        cursor: cursor === null ? JSON.stringify({ PK: "legacy", SK: "page-2" }) : null,
        rows: 100,
      });
    };
    const step = (checkpoint: string | null) =>
      runReadModelBootstrap(
        h.deps,
        h.maintenance,
        backfill,
        NOON,
        checkpoint,
        (context) => vocabReadModelsReady(h.deps, context),
      );
    const first = await step(null);
    expect(first).toMatchObject({
      complete: false,
      phase: "discovery",
      rows: 100,
      learners: 0,
    });
    const second = await step(first.checkpoint);
    expect(second).toMatchObject({ complete: false, phase: "preparation", rows: 100 });
    const third = await step(second.checkpoint);
    expect(third).toMatchObject({ complete: false, phase: "verification", rows: 80 });
    expect(await step(third.checkpoint)).toStrictEqual({
      complete: true,
      phase: "verification",
      checkpoint: null,
      rows: 0,
      learners: 1,
    });
    expect(cursors).toStrictEqual([
      null,
      JSON.stringify({ PK: "legacy", SK: "page-2" }),
    ]);
  });

  it("keeps the deployment paused while another required slice or an old-day request is incomplete", async () => {
    const h = await registered();
    const step = (
      checkpoint: string | null,
      ready: ReadModelBootstrapDriver["ready"],
    ) =>
      runReadModelBootstrap(
        h.deps,
        h.maintenance,
        () => Promise.resolve({ cursor: null, rows: 1 }),
        NOON,
        checkpoint,
        ready,
      );
    const discovered = await step(null, () => Promise.resolve(undefined));
    const prepared = await step(discovered.checkpoint, () =>
      Promise.resolve(undefined),
    );
    expect(
      await step(prepared.checkpoint, () => Promise.resolve(undefined)),
    ).toMatchObject({ complete: false, phase: "preparation" });
    await h.stores.forLearner(h.learner).commit({
      puts: [
        { type: "vocabReadModelRequest", value: { schema: 1, day: "2026-09-01" } },
      ],
      updates: [],
      expect: [],
    });
    expect(
      await vocabReadModelsReady(h.deps, {
        ...h.context(),
        actor: { kind: "system", job: "rebuild-projections", onBehalfOf: h.learner },
      }),
    ).toBeUndefined();
  });

  it("restarts verification when a previously checked learner crosses its local day boundary", async () => {
    const h = await registered();
    let pages = 0;
    const maintenance = {
      ...h.maintenance,
      profiles: () => {
        pages += 1;
        return Promise.resolve({
          learners: [{ id: h.learner, profile: h.context().learner }],
          cursor: JSON.stringify({ PK: "SYSTEM#READMODEL_LEARNERS", SK: "page-2" }),
        });
      },
    };
    const driver: ReadModelBootstrapDriver = {
      backfill: () => Promise.resolve({ cursor: null, rows: 1 }),
      prepare: () => Promise.resolve({ status: "idle", rows: 0, learners: 0 }),
      ready: () => Promise.resolve(NOON + 3 * DAY_MS),
    };
    let progress: ReadModelBootstrapResult = await advanceReadModelBootstrap(
      h.deps,
      maintenance,
      driver,
      NOON,
      null,
    );
    progress = await advanceReadModelBootstrap(
      h.deps,
      maintenance,
      driver,
      NOON,
      progress.checkpoint,
    );
    progress = await advanceReadModelBootstrap(
      h.deps,
      maintenance,
      driver,
      NOON,
      progress.checkpoint,
    );
    expect(progress).toMatchObject({
      complete: false,
      phase: "verification",
      learners: 1,
    });
    expect(
      await advanceReadModelBootstrap(
        h.deps,
        maintenance,
        driver,
        NOON + DAY_MS,
        progress.checkpoint,
      ),
    ).toMatchObject({ complete: false, phase: "preparation", learners: 0 });
    expect(pages).toBe(1);
  });

  it.each(["[]", "{}", "x".repeat(8_193)])(
    "rejects unsupported operator checkpoint %j",
    async (checkpoint) => {
      const h = await registered();
      await expect(
        runReadModelBootstrap(
          h.deps,
          h.maintenance,
          () => Promise.resolve({ cursor: null, rows: 0 }),
          NOON,
          checkpoint,
          () => Promise.resolve(undefined),
        ),
      ).rejects.toThrow();
    },
  );
});
