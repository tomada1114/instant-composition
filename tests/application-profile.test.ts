import { describe, expect, it } from "vitest";

import { createMemoryStores } from "@instant-composition/adapters";
import {
  profile,
  updateProfile,
  type LearnerStores,
  type Profile,
  type RequestContext,
} from "@instant-composition/application";

import { makeProfile } from "./application-fixtures";
import { fixedCatalog, makeHarness, unreadableCatalog } from "./application-harness";

// The profile query and command over the in-memory store: what a change may
// set, what it refuses, and how it meets a change made beside it.

const TOKYO: Profile = {
  timeZone: "Asia/Tokyo",
  l1: "ja",
  target: "en",
  uiLocale: "ja",
};
const BAD_REQUEST = { ok: false, error: { code: "ERR_BAD_REQUEST" } };

/** A harness whose learner already has `stored` as the profile registration wrote. */
async function registered(stored: Profile = makeProfile()) {
  const h = makeHarness();
  await h.stores
    .forLearner(h.learner)
    .commit({ puts: [{ type: "profile", value: stored }], updates: [], expect: [] });
  return h;
}

function agent(context: RequestContext): RequestContext {
  return {
    ...context,
    actor: { kind: "agent", onBehalfOf: context.learner.id, grants: ["home"] },
  };
}

describe("profile", () => {
  it("answers the profile the request signed in with, without the id or the day boundary", async () => {
    const h = makeHarness();

    expect(await profile(h.deps, h.context())).toStrictEqual({
      ok: true,
      value: TOKYO,
    });
  });

  it("refuses an actor not granted it", async () => {
    const h = makeHarness();

    expect(await profile(h.deps, agent(h.context()))).toStrictEqual({
      ok: false,
      error: { code: "ERR_FORBIDDEN" },
    });
  });
});

describe("updateProfile", () => {
  it("changes only the fields the patch sets, one version on", async () => {
    const h = await registered();

    const changed = await updateProfile(h.deps, h.context(), {
      timeZone: "America/New_York",
    });

    const expected = makeProfile({ timeZone: "America/New_York" });
    expect(changed).toStrictEqual({ ok: true, value: expected });
    expect(await h.stores.forLearner(h.learner).profile()).toStrictEqual({
      value: expected,
      version: 2,
    });
  });

  it("stores a time zone in the spelling the runtime resolves it to", async () => {
    const h = await registered();

    const changed = await updateProfile(h.deps, h.context(), {
      timeZone: "asia/tokyo",
    });

    expect(changed.ok && changed.value.timeZone).toBe("Asia/Tokyo");
  });

  it.each([["Nowhere/City"], ["+09:00"], ["Asia/Tokyo "]])(
    "refuses the time zone %j and writes nothing",
    async (timeZone) => {
      const h = await registered();

      expect(await updateProfile(h.deps, h.context(), { timeZone })).toStrictEqual(
        BAD_REQUEST,
      );
      expect((await h.stores.forLearner(h.learner).profile())?.version).toBe(1);
    },
  );

  it("takes the first and target language the catalog serves", async () => {
    const h = await registered();

    expect(
      await updateProfile(h.deps, h.context(), {
        l1: "ja",
        target: "en",
        uiLocale: "ja",
      }),
    ).toStrictEqual({ ok: true, value: makeProfile() });
  });

  it.each([
    ["a first language the catalog has no snapshot for", { l1: "fr" }],
    ["a target the catalog has no snapshot for", { target: "de" }],
    ["the pair the other way round", { l1: "en", target: "ja" }],
  ])("refuses %s", async (_, patch) => {
    const h = await registered();

    expect(await updateProfile(h.deps, h.context(), patch)).toStrictEqual(BAD_REQUEST);
    expect(await h.stores.forLearner(h.learner).profile()).toStrictEqual({
      value: makeProfile(),
      version: 1,
    });
  });

  it("needs the catalog only for a language, not for a time zone", async () => {
    const h = makeHarness(unreadableCatalog);
    await h.stores.forLearner(h.learner).commit({
      puts: [{ type: "profile", value: makeProfile() }],
      updates: [],
      expect: [],
    });

    expect(await updateProfile(h.deps, h.context(), { l1: "ja" })).toStrictEqual({
      ok: false,
      error: { code: "ERR_CONTENT_UNREADABLE", reason: "missing" },
    });
    expect(
      (await updateProfile(h.deps, h.context(), { timeZone: "Europe/Paris" })).ok,
    ).toBe(true);
  });

  it("writes nothing for a patch that changes nothing", async () => {
    const h = await registered();

    expect(await updateProfile(h.deps, h.context(), {})).toStrictEqual({
      ok: true,
      value: makeProfile(),
    });
    await updateProfile(h.deps, h.context(), { timeZone: "Europe/London" });

    expect((await h.stores.forLearner(h.learner).profile())?.version).toBe(1);
  });

  it("puts the profile the request signed in with when the store holds none", async () => {
    const h = makeHarness();

    const changed = await updateProfile(h.deps, h.context(), { uiLocale: "ja" });

    expect(changed).toStrictEqual({ ok: true, value: TOKYO });
    expect(await h.stores.forLearner(h.learner).profile()).toStrictEqual({
      value: TOKYO,
      version: 1,
    });
  });

  it("decides again over a change that won the race, keeping both", async () => {
    const h = await registered();
    const memory = h.stores;
    let raced = false;
    // Another request changes the UI locale between this command's read and its commit.
    const racing: LearnerStores = {
      forLearner(id) {
        const store = memory.forLearner(id);
        return {
          ...store,
          async commit(commit) {
            if (!raced) {
              raced = true;
              await store.commit({
                puts: [],
                updates: [
                  {
                    entry: { type: "profile", value: makeProfile({ uiLocale: "en" }) },
                    version: 1,
                  },
                ],
                expect: [],
              });
            }
            return store.commit(commit);
          },
        };
      },
    };

    const changed = await updateProfile(
      { stores: racing, catalog: fixedCatalog() },
      h.context(),
      { timeZone: "Europe/Paris" },
    );

    const both = makeProfile({ timeZone: "Europe/Paris", uiLocale: "en" });
    expect(changed).toStrictEqual({ ok: true, value: both });
    expect(await memory.forLearner(h.learner).profile()).toStrictEqual({
      value: both,
      version: 3,
    });
  });

  it("answers ERR_CONFLICT when every attempt loses its race", async () => {
    const memory = createMemoryStores();
    const losing: LearnerStores = {
      forLearner(id) {
        const store = memory.forLearner(id);
        return {
          ...store,
          commit: () => Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } }),
        };
      },
    };
    const h = makeHarness();

    expect(
      await updateProfile({ stores: losing, catalog: fixedCatalog() }, h.context(), {
        timeZone: "Europe/Paris",
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
  });

  it("refuses an actor not granted it, writing nothing", async () => {
    const h = await registered();

    expect(
      await updateProfile(h.deps, agent(h.context()), { timeZone: "Europe/Paris" }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_FORBIDDEN" } });
    expect((await h.stores.forLearner(h.learner).profile())?.version).toBe(1);
  });
});
