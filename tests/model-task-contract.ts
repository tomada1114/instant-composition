import { beforeEach, describe, expect, it } from "vitest";

import {
  learnerId,
  startTalk,
  sendTurn,
  retryReply,
  makeCandidates,
  type AbortSignalLike,
  type LearnerStores,
  type LearnerStore,
  type LanguageModel,
  type ModelRequest,
  type ModelReply,
  type ModelFailure,
  type TalkDeps,
} from "@instant-composition/application";
import {
  TALK_TUNING,
  type ModelTaskKey,
  type Result,
} from "@instant-composition/domain";

import { makeTalkHarness, CANDIDATES } from "./application-talk-harness";
import { makeTalk, makeTurn, without } from "./application-fixtures";
import { NOON } from "./application-harness";

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve() {
      if (resolve === undefined) throw new Error("Uninitialized barrier.");
      resolve();
    },
  };
}

const TURN = {
  talkId: "t1",
  turn: 1,
  japanese: "先週ここへ引っ越してきました。",
  english: "I moved here last week.",
};
function key(
  task: ModelTaskKey["task"] = "talk-scene",
  turn = 0,
  talkId = "t1",
): ModelTaskKey {
  return {
    talkId,
    task,
    turn,
    promptVersion: `${task}@1`,
    ...(task === "talk-scene" ? {} : { generation: NOON }),
  };
}

/** The same persisted execution/recovery contract runs on both store adapters. */
export function describeModelTaskContract(
  name: string,
  fresh: () => LearnerStores | Promise<LearnerStores>,
): void {
  describe(`${name}: claims`, () => {
    let stores: LearnerStores;
    let h: ReturnType<typeof makeTalkHarness>;
    let deps: TalkDeps;
    let store: LearnerStore;
    beforeEach(async () => {
      stores = await fresh();
      h = makeTalkHarness();
      deps = { ...h.talkDeps, stores };
      store = stores.forLearner(h.learner);
    });

    it.each(["scene", "turn", "candidates"] as const)(
      "reserves parallel %s work before the model barrier, once per job",
      async (step) => {
        if (step !== "scene") await startTalk(deps, h.context(), { talkId: "t1" });
        if (step === "candidates") {
          const talk = await store.talk("t1");
          expect(
            (
              await store.commit({
                puts: [],
                updates: [
                  {
                    entry: {
                      type: "talk",
                      value: without(
                        makeTalk({ status: "ended", turns: [makeTurn()] }),
                        "expiresAt",
                      ),
                    },
                    version: talk?.version ?? 0,
                  },
                ],
                expect: [],
              })
            ).ok,
          ).toBe(true);
          h.cards = { candidates: [{ ...CANDIDATES[0], turn: 1 }] };
        }
        const arrived = deferred();
        const release = deferred();
        const calls: string[] = [];
        const execution: ModelRequest<unknown>["execution"][] = [];
        const expected = step === "turn" ? 2 : 1;
        const model: LanguageModel = {
          async generate<T>(
            request: ModelRequest<T>,
            signal: AbortSignalLike,
          ): Promise<Result<ModelReply<T>, ModelFailure>> {
            calls.push(request.task);
            execution.push(request.execution);
            if (calls.length === expected) arrived.resolve();
            await release.promise;
            return h.model.generate(request, signal);
          },
        };
        const use = { ...deps, model };
        const run = () =>
          step === "scene"
            ? startTalk(use, h.context(), { talkId: "t1" })
            : step === "turn"
              ? sendTurn(use, h.context(), TURN)
              : makeCandidates({ ...use, catalog: h.deps.catalog }, h.context(), {
                  talkId: "t1",
                });
        const pending = [run(), run()];
        try {
          await arrived.promise;
          expect(await Promise.race(pending)).toStrictEqual({
            ok: false,
            error: { code: "ERR_MODEL_UNAVAILABLE", reason: "in-flight" },
          });
          expect(calls).toStrictEqual(
            step === "scene"
              ? ["talk-scene"]
              : step === "turn"
                ? ["talk-teacher", "talk-partner"]
                : ["talk-cards"],
          );
        } finally {
          release.resolve();
        }
        const results = await Promise.all(pending);
        const result = results.find((answer) => answer.ok);
        expect(result?.ok).toBe(true);
        expect(await run()).toStrictEqual(result);
        expect(calls).toHaveLength(expected);
        expect(execution).toStrictEqual(
          Array.from({ length: expected }, () => ({
            attempt: 1,
            duplicatePossible: false,
          })),
        );
      },
    );

    it("rolls back both turn claims when one condition loses, paying for neither task", async () => {
      await startTalk(deps, h.context(), { talkId: "t1" });
      let injected = false;
      const raced: LearnerStore = {
        ...store,
        async commit(commit) {
          if (
            !injected &&
            commit.puts.filter((entry) => entry.type === "modelTask").length === 2
          ) {
            injected = true;
            const competing = commit.puts.find(
              (entry) =>
                entry.type === "modelTask" && entry.value.key.task === "talk-partner",
            );
            if (competing === undefined)
              throw new Error("Missing competing partner claim.");
            expect(
              (await store.commit({ puts: [competing], updates: [], expect: [] })).ok,
            ).toBe(true);
          }
          return store.commit(commit);
        },
      };
      expect(
        await sendTurn(
          { ...deps, stores: { forLearner: () => raced } },
          h.context(),
          TURN,
        ),
      ).toStrictEqual({
        ok: false,
        error: { code: "ERR_MODEL_UNAVAILABLE", reason: "in-flight" },
      });
      expect(await store.modelTask(key("talk-teacher", 1))).toBeUndefined();
      expect((await store.modelTask(key("talk-partner", 1)))?.value.state).toBe(
        "in-flight",
      );
      expect((await store.talk("t1"))?.value.turns).toStrictEqual([]);
      expect(h.model.requests).toHaveLength(1);
    });

    it("checks the talk snapshot atomically with the claim before paying for a call", async () => {
      await startTalk(deps, h.context(), { talkId: "t1" });
      let injected = false;
      const raced: LearnerStore = {
        ...store,
        async commit(commit) {
          if (!injected && commit.puts.some((entry) => entry.type === "modelTask")) {
            injected = true;
            const talk = await store.talk("t1");
            if (talk === undefined) throw new Error("Missing talk.");
            expect(
              (
                await store.commit({
                  puts: [],
                  updates: [
                    {
                      entry: {
                        type: "talk",
                        value: { ...talk.value, status: "discarded" },
                      },
                      version: talk.version,
                    },
                  ],
                  expect: [],
                })
              ).ok,
            ).toBe(true);
          }
          return store.commit(commit);
        },
      };
      expect(
        await sendTurn(
          { ...deps, stores: { forLearner: () => raced } },
          h.context(),
          TURN,
        ),
      ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      expect(await store.modelTask(key("talk-teacher", 1))).toBeUndefined();
      expect(await store.modelTask(key("talk-partner", 1))).toBeUndefined();
      expect(h.model.requests).toHaveLength(1);
    });

    it("replays a saved scene result after the talk commit crashed", async () => {
      const crash = new Error("commit interrupted");
      const faulted: LearnerStore = {
        ...store,
        commit(commit) {
          if (commit.puts.some((entry) => entry.type === "talk")) throw crash;
          return store.commit(commit);
        },
      };
      await expect(
        startTalk({ ...deps, stores: { forLearner: () => faulted } }, h.context(), {
          talkId: "t1",
        }),
      ).rejects.toBe(crash);
      expect(await store.talk("t1")).toBeUndefined();
      expect((await store.modelTask(key()))?.value.state).toBe("result");
      expect((await startTalk(deps, h.context(), { talkId: "t1" })).ok).toBe(true);
      expect(h.model.requests).toHaveLength(1);
    });

    it("retains an abandoned in-flight claim when the provider answered but result storage crashed, then fences its lease", async () => {
      const crash = new Error("result storage interrupted");
      const faulted: LearnerStore = {
        ...store,
        commit(commit) {
          if (
            commit.updates.some(
              ({ entry }) =>
                entry.type === "modelTask" && entry.value.state === "result",
            )
          )
            throw crash;
          return store.commit(commit);
        },
      };
      await expect(
        startTalk({ ...deps, stores: { forLearner: () => faulted } }, h.context(), {
          talkId: "t1",
        }),
      ).rejects.toBe(crash);
      expect((await store.modelTask(key()))?.value.state).toBe("in-flight");
      expect(
        await startTalk(deps, h.context(NOON + TALK_TUNING.modelLeaseMs - 1), {
          talkId: "t1",
        }),
      ).toStrictEqual({
        ok: false,
        error: { code: "ERR_MODEL_UNAVAILABLE", reason: "in-flight" },
      });
      expect(
        (
          await startTalk(deps, h.context(NOON + TALK_TUNING.modelLeaseMs), {
            talkId: "t1",
          })
        ).ok,
      ).toBe(true);
      expect(h.model.requests.map((request) => request.execution)).toStrictEqual([
        { attempt: 1, duplicatePossible: false },
        { attempt: 2, duplicatePossible: true },
      ]);
    });

    it("refuses an expired claim reclaim after deletion and recreation at the same version, without invoking the provider", async () => {
      const crash = new Error("Result storage interrupted.");
      const interrupted: LearnerStore = {
        ...store,
        commit(commit) {
          if (commit.updates.some(({ entry }) => entry.type === "modelTask"))
            throw crash;
          return store.commit(commit);
        },
      };
      await expect(
        startTalk({ ...deps, stores: { forLearner: () => interrupted } }, h.context(), {
          talkId: "t1",
        }),
      ).rejects.toBe(crash);
      const original = await store.modelTask(key());
      if (original?.value.state !== "in-flight")
        throw new Error("Missing abandoned claim.");
      const now = NOON + TALK_TUNING.modelLeaseMs;
      const replacement = {
        ...original.value,
        claimId: "replacement:1",
        startedAt: now,
        leaseUntil: now + TALK_TUNING.modelLeaseMs,
      };
      let injected = false;
      const raced: LearnerStore = {
        ...store,
        async commit(commit) {
          if (
            !injected &&
            commit.updates.some(({ entry }) => entry.type === "modelTask")
          ) {
            injected = true;
            expect(
              (
                await store.commit({
                  puts: [],
                  updates: [],
                  expect: [],
                  deletes: [
                    {
                      key: { type: "modelTask", task: key() },
                      version: original.version,
                    },
                  ],
                })
              ).ok,
            ).toBe(true);
            expect(
              (
                await store.commit({
                  puts: [{ type: "modelTask", value: replacement }],
                  updates: [],
                  expect: [],
                })
              ).ok,
            ).toBe(true);
          }
          return store.commit(commit);
        },
      };
      expect(
        await startTalk(
          { ...deps, stores: { forLearner: () => raced } },
          h.context(now),
          {
            talkId: "t1",
          },
        ),
      ).toStrictEqual({
        ok: false,
        error: { code: "ERR_MODEL_UNAVAILABLE", reason: "in-flight" },
      });
      expect(injected).toBe(true);
      expect(await store.modelTask(key())).toStrictEqual({
        value: replacement,
        version: original.version,
      });
      expect(await store.talk("t1")).toBeUndefined();
      expect(h.model.requests).toHaveLength(1);
    });

    it.each(["timeout", "transport", "denied", "malformed"] as const)(
      "persists %s failure and retries only a new endpoint invocation",
      async (reason) => {
        const model: LanguageModel = {
          generate: () =>
            Promise.resolve({
              ok: false,
              error: { code: "ERR_MODEL_UNAVAILABLE", reason },
            }),
        };
        expect(
          await startTalk({ ...deps, model }, h.context(), { talkId: "t1" }),
        ).toStrictEqual({
          ok: false,
          error: { code: "ERR_MODEL_UNAVAILABLE", reason },
        });
        expect((await store.modelTask(key()))?.value).toMatchObject({
          state: "failed",
          reason,
          outcome: reason === "timeout" || reason === "transport" ? "unknown" : "known",
        });
        expect(h.model.requests).toHaveLength(0);
        expect((await startTalk(deps, h.context(), { talkId: "t1" })).ok).toBe(true);
        expect(h.model.requests[0]?.execution).toStrictEqual({
          attempt: 2,
          duplicatePossible: reason === "timeout" || reason === "transport",
        });
      },
    );

    it("records a thrown provider failure as unknown and preserves the original exception", async () => {
      const crash = new Error("provider accepted then connection failed");
      const model: LanguageModel = { generate: () => Promise.reject(crash) };
      await expect(
        startTalk({ ...deps, model }, h.context(), { talkId: "t1" }),
      ).rejects.toBe(crash);
      expect((await store.modelTask(key()))?.value).toMatchObject({
        state: "failed",
        outcome: "unknown",
        reason: "crash",
      });
      expect((await startTalk(deps, h.context(), { talkId: "t1" })).ok).toBe(true);
      expect(h.model.requests[0]?.execution).toStrictEqual({
        attempt: 2,
        duplicatePossible: true,
      });
    });

    it("uses /reply to explicitly retry an unknown partner outcome after the turn was kept", async () => {
      await startTalk(deps, h.context(), { talkId: "t1" });
      const model: LanguageModel = {
        generate(request, signal) {
          return request.task === "talk-partner"
            ? Promise.resolve({
                ok: false,
                error: { code: "ERR_MODEL_UNAVAILABLE", reason: "timeout" },
              })
            : h.model.generate(request, signal);
        },
      };
      const sent = await sendTurn({ ...deps, model }, h.context(), TURN);
      expect(sent.ok && sent.value.reply).toBeNull();
      expect((await retryReply(deps, h.context(), { talkId: "t1" })).ok).toBe(true);
      expect(h.model.requests.at(-1)?.execution).toStrictEqual({
        attempt: 2,
        duplicatePossible: true,
      });
      expect((await store.modelTask(key("talk-partner", 1)))?.value.state).toBe(
        "result",
      );
    });

    it("keeps learners, task kinds, turns and prompt versions in separate claim keys", async () => {
      const other = learnerId("learner-b");
      const context = {
        ...h.context(),
        actor: { kind: "learner" as const, learnerId: other },
        learner: { ...h.context().learner, id: other },
      };
      const opened = await Promise.all([
        startTalk(deps, h.context(), { talkId: "t1" }),
        startTalk(deps, context, { talkId: "t1" }),
        startTalk(deps, h.context(), { talkId: "t2" }),
      ]);
      expect(opened.every((result) => result.ok)).toBe(true);
      expect(h.model.requests).toHaveLength(3);
      expect(await store.modelTask(key("talk-scene", 1))).toBeUndefined();
      expect(
        await store.modelTask({ ...key(), promptVersion: "talk-scene@2" }),
      ).toBeUndefined();
      await sendTurn(deps, h.context(), TURN);
      await sendTurn(deps, h.context(), {
        ...TURN,
        turn: 2,
        english: "Another answer.",
      });
      expect((await store.modelTask(key("talk-teacher", 1)))?.value.state).toBe(
        "result",
      );
      expect((await store.modelTask(key("talk-partner", 1)))?.value.state).toBe(
        "result",
      );
      expect((await store.modelTask(key("talk-teacher", 2)))?.value.state).toBe(
        "result",
      );
      expect(
        await stores.forLearner(other).modelTask(key("talk-teacher", 1)),
      ).toBeUndefined();
    });

    it("refuses a changed pending turn input before either paid call, preserving the first job", async () => {
      await startTalk(deps, h.context(), { talkId: "t1" });
      const arrived = deferred();
      const release = deferred();
      const model: LanguageModel = {
        async generate(request, signal) {
          arrived.resolve();
          await release.promise;
          return h.model.generate(request, signal);
        },
      };
      const first = sendTurn({ ...deps, model }, h.context(), TURN);
      try {
        await arrived.promise;
        expect(
          await sendTurn(deps, h.context(), { ...TURN, english: "Different input." }),
        ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
        expect(h.model.requests).toHaveLength(1);
      } finally {
        release.resolve();
      }
      expect((await first).ok).toBe(true);
      expect((await store.talk("t1"))?.value.turns[0]?.english).toBe(TURN.english);
    });

    it("starts new turn work after an expired talk id is reused while old turn tasks are still live", async () => {
      await startTalk(deps, h.context(), { talkId: "t1" });
      await sendTurn(deps, h.context(NOON + 1_000), TURN);
      const later = NOON + TALK_TUNING.expiresAfterMs;
      expect((await startTalk(deps, h.context(later), { talkId: "t1" })).ok).toBe(true);
      expect(
        (
          await sendTurn(deps, h.context(later), {
            ...TURN,
            english: "New talk answer.",
          })
        ).ok,
      ).toBe(true);
      expect((await store.modelTask(key("talk-teacher", 1)))?.value.state).toBe(
        "result",
      );
      expect(
        (await store.modelTask({ ...key("talk-teacher", 1), generation: later }))?.value
          .state,
      ).toBe("result");
      expect((await store.talk("t1"))?.value.turns[0]?.english).toBe(
        "New talk answer.",
      );
      expect(h.model.requests).toHaveLength(6);
    });

    it.each(["turn", "reply", "candidates"] as const)(
      "refuses late %s adoption after the same talk id has been recreated",
      async (step) => {
        await startTalk(deps, h.context(), { talkId: "t1" });
        const initial = await store.talk("t1");
        if (initial === undefined) throw new Error("Missing original talk.");
        if (step !== "turn") {
          expect(
            (
              await store.commit({
                puts: [],
                updates: [
                  {
                    entry: {
                      type: "talk",
                      value: {
                        ...initial.value,
                        status: step === "candidates" ? "ended" : "open",
                        turns: [without(makeTurn(), "reply")],
                      },
                    },
                    version: initial.version,
                  },
                ],
                expect: [],
              })
            ).ok,
          ).toBe(true);
        }
        const arrived = deferred();
        const release = deferred();
        const held: LanguageModel = {
          async generate(request, signal) {
            arrived.resolve();
            await release.promise;
            return h.model.generate(request, signal);
          },
        };
        const use = { ...deps, model: held };
        const pending =
          step === "turn"
            ? sendTurn(use, h.context(), TURN)
            : step === "reply"
              ? retryReply(use, h.context(), { talkId: "t1" })
              : makeCandidates({ ...use, catalog: h.deps.catalog }, h.context(), {
                  talkId: "t1",
                });
        let replacement;
        try {
          await arrived.promise;
          const later = NOON + TALK_TUNING.expiresAfterMs;
          expect((await startTalk(deps, h.context(later), { talkId: "t1" })).ok).toBe(
            true,
          );
          const reopened = await store.talk("t1");
          if (reopened === undefined) throw new Error("Missing replacement talk.");
          if (step !== "turn") {
            expect(
              (
                await store.commit({
                  puts: [],
                  updates: [
                    {
                      entry: {
                        type: "talk",
                        value: {
                          ...reopened.value,
                          status: step === "candidates" ? "ended" : "open",
                          turns: [
                            without(
                              makeTurn({ english: "Replacement answer." }),
                              "reply",
                            ),
                          ],
                        },
                      },
                      version: reopened.version,
                    },
                  ],
                  expect: [],
                })
              ).ok,
            ).toBe(true);
          }
          replacement = await store.talk("t1");
        } finally {
          release.resolve();
        }
        expect(await pending).toStrictEqual({
          ok: false,
          error: { code: "ERR_CONFLICT" },
        });
        expect(await store.talk("t1")).toStrictEqual(replacement);
      },
    );

    it("fences a late executor after lease recovery so it cannot overwrite the new result or talk", async () => {
      const arrived = deferred();
      const release = deferred();
      const model: LanguageModel = {
        async generate(request, signal) {
          arrived.resolve();
          await release.promise;
          return h.model.generate(request, signal);
        },
      };
      const first = startTalk({ ...deps, model }, h.context(), { talkId: "t1" });
      try {
        await arrived.promise;
        h.scene = { ...(h.scene as object), opening: "Recovered opening." };
        expect(
          (
            await startTalk(deps, h.context(NOON + TALK_TUNING.modelLeaseMs), {
              talkId: "t1",
            })
          ).ok,
        ).toBe(true);
        h.scene = { ...(h.scene as object), opening: "Late opening." };
      } finally {
        release.resolve();
      }
      expect(await first).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
      expect((await store.talk("t1"))?.value.opening).toBe("Recovered opening.");
      expect((await store.modelTask(key()))?.version).toBe(3);
    });
  });
}
