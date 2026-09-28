import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "@instant-composition/adapters";
import { LOCAL_SUBJECT } from "@instant-composition/api";
import {
  learnerId,
  type LearnerDirectory,
  type LearnerId,
} from "@instant-composition/application";
import { errorResponseSchema } from "@instant-composition/contracts";

import { makeApi, startedPlacement, subjectAuthenticator } from "./api-harness";

// The edge signs every request in before it runs: the subject the
// authenticator verified is resolved to its learner, a first one registered,
// and the RequestContext's learner built from the stored profile.

/** An id source that records every id it hands out. */
function mintingFrom(...ids: string[]): { next: () => LearnerId; minted: string[] } {
  const minted: string[] = [];
  return {
    minted,
    next: () => {
      const id = ids[minted.length] ?? `spare-${String(minted.length)}`;
      minted.push(id);
      return learnerId(id);
    },
  };
}

describe("signing a request in", () => {
  it("registers the learner on the first request, with the default profile", async () => {
    const ids = mintingFrom("learner-x");
    const api = makeApi({ newLearnerId: ids.next });

    expect((await api.call("GET", "/v1/home")).status).toBe(200);

    expect(await api.directory.learnerOf(LOCAL_SUBJECT)).toStrictEqual({
      learnerId: "learner-x",
      profile: { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" },
    });
    expect(api.lines.map((line) => line.learnerId)).toStrictEqual(["learner-x"]);
  });

  it("reuses the registered learner on every later request, minting no other id", async () => {
    const ids = mintingFrom("learner-x");
    const api = makeApi({ newLearnerId: ids.next });

    await startedPlacement(api);
    const home = await api.call("GET", "/v1/home");

    expect(home.status).toBe(200);
    expect(ids.minted).toStrictEqual(["learner-x"]);
    expect(api.lines.map((line) => line.learnerId)).toStrictEqual([
      "learner-x",
      "learner-x",
      "learner-x",
    ]);
    expect(
      (await api.stores.forLearner(learnerId("learner-x")).round("p1"))?.value.kind,
    ).toBe("placement");
  });

  it("finds a learner registered by an earlier process, whatever id this one would mint", async () => {
    const directory = createMemoryDirectory();
    const first = makeApi({ directory, newLearnerId: mintingFrom("learner-x").next });
    await startedPlacement(first);
    const later = mintingFrom("learner-y");
    const second = makeApi({
      stores: first.stores,
      directory,
      newLearnerId: later.next,
    });

    const home = await second.call("GET", "/v1/home");

    expect(home.status).toBe(200);
    expect(later.minted).toStrictEqual([]);
    expect(second.lines.map((line) => line.learnerId)).toStrictEqual(["learner-x"]);
  });

  it("gives two subjects two learners", async () => {
    const directory = createMemoryDirectory();
    const ids = mintingFrom("learner-a", "learner-b");
    const a = makeApi({
      directory,
      newLearnerId: ids.next,
      authenticator: subjectAuthenticator("subject-a"),
    });
    const b = makeApi({
      stores: a.stores,
      directory,
      newLearnerId: ids.next,
      authenticator: subjectAuthenticator("subject-b"),
    });

    await a.call("GET", "/v1/home");
    await b.call("GET", "/v1/home");

    expect((await directory.learnerOf("subject-a"))?.learnerId).toBe("learner-a");
    expect((await directory.learnerOf("subject-b"))?.learnerId).toBe("learner-b");
  });

  it("derives the practice day in the stored profile's time zone", async () => {
    const directory = createMemoryDirectory();
    await directory.register(LOCAL_SUBJECT, {
      learnerId: learnerId("learner-la"),
      profile: {
        timeZone: "America/Los_Angeles",
        l1: "ja",
        target: "en",
        uiLocale: "ja",
      },
    });
    // NOON is 12:00 on 2026-09-22 in Tokyo, and still 20:00 on the 21st in Los Angeles.
    const api = makeApi({ directory });

    await startedPlacement(api);

    expect(
      (await api.stores.forLearner(learnerId("learner-la")).round("p1"))?.value.day,
    ).toBe("2026-09-21");
  });

  it("answers 409 ERR_CONFLICT, running nothing, when registering keeps losing", async () => {
    const losing: LearnerDirectory = {
      learnerOf: () => Promise.resolve(undefined),
      register: () => Promise.resolve({ ok: false, error: { code: "ERR_CONFLICT" } }),
    };
    const api = makeApi({ directory: losing });

    const response = await api.call("PATCH", "/v1/settings", {
      topics: ["work"],
      dailySize: 10,
    });

    expect(response.status).toBe(409);
    expect(errorResponseSchema.parse(await response.json()).error.code).toBe(
      "ERR_CONFLICT",
    );
    expect(api.lines).toMatchObject([
      { operation: "updateSettings", outcome: "ERR_CONFLICT", learnerId: null },
    ]);
    expect(
      await api.stores.forLearner(learnerId("learner-1")).settings(),
    ).toBeUndefined();
  });
});
