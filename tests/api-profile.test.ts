import { describe, expect, it } from "vitest";

import { learnerId } from "@instant-composition/application";
import { errorResponseSchema, profileSchema } from "@instant-composition/contracts";

import {
  makeApi,
  startedPlacement,
  subjectAuthenticator,
  type ApiHarness,
} from "./api-harness";
import { unreadableCatalog } from "./application-harness";

// `GET` and `PATCH /v1/me` driven with `new Request(…)` over the in-memory
// store and directory: what a change may set, that the next request is signed
// in with it, and that one learner's credential never reaches another's profile.

const DEFAULT = { timeZone: "Asia/Tokyo", l1: "ja", target: "en", uiLocale: "ja" };

async function profileOf(response: Response): Promise<unknown> {
  expect(response.status).toBe(200);
  return profileSchema.parse(await response.json());
}

async function refusal(response: Response): Promise<[number, string]> {
  const body = errorResponseSchema.parse(await response.json());
  return [response.status, body.error.code];
}

/** Learner A and learner B, each with their own credential, over one store and directory. */
function twoLearners(): { a: ApiHarness; b: ApiHarness } {
  const a = makeApi({
    authenticator: subjectAuthenticator("subject-a"),
    newLearnerId: () => learnerId("learner-a"),
  });
  const b = makeApi({
    stores: a.stores,
    directory: a.directory,
    authenticator: subjectAuthenticator("subject-b"),
    newLearnerId: () => learnerId("learner-b"),
  });
  return { a, b };
}

describe("GET /v1/me", () => {
  it("answers the profile a first sign-in registered", async () => {
    const api = makeApi();

    expect(await profileOf(await api.call("GET", "/v1/me"))).toStrictEqual(DEFAULT);
    expect(api.lines).toMatchObject([
      { operation: "getProfile", outcome: "ok", learnerId: "learner-1" },
    ]);
  });
});

describe("PATCH /v1/me", () => {
  it("changes the fields the body sets and answers the profile saved", async () => {
    const api = makeApi();

    const changed = await api.call("PATCH", "/v1/me", {
      timeZone: "America/Los_Angeles",
    });

    const expected = { ...DEFAULT, timeZone: "America/Los_Angeles" };
    expect(await profileOf(changed)).toStrictEqual(expected);
    expect(await profileOf(await api.call("GET", "/v1/me"))).toStrictEqual(expected);
  });

  it("signs the next request in with the new time zone, so the practice day follows it", async () => {
    const api = makeApi();
    await api.call("PATCH", "/v1/me", { timeZone: "America/Los_Angeles" });

    const round = await startedPlacement(api);

    // NOON is 12:00 on 2026-09-22 in Tokyo, and still 20:00 on the 21st in Los Angeles.
    expect(round.day).toBe("2026-09-21");
  });

  it("takes the pair the catalog serves and the UI locale there is a catalog for", async () => {
    const api = makeApi();

    const same = await api.call("PATCH", "/v1/me", {
      l1: "ja",
      target: "en",
      uiLocale: "ja",
    });

    expect(await profileOf(same)).toStrictEqual(DEFAULT);
  });

  it.each([
    ["a name no time zone has", { timeZone: "Mars/Olympus_Mons" }],
    ["a UTC offset", { timeZone: "+09:00" }],
    ["a first language the catalog does not serve", { l1: "fr" }],
    ["a target the catalog does not serve", { target: "de" }],
    ["a UI locale with no catalog", { uiLocale: "en" }],
    ["a time zone that is not a string", { timeZone: 9 }],
  ])("refuses %s with 400 ERR_BAD_REQUEST, changing nothing", async (_, body) => {
    const api = makeApi();

    expect(await refusal(await api.call("PATCH", "/v1/me", body))).toStrictEqual([
      400,
      "ERR_BAD_REQUEST",
    ]);
    expect(await profileOf(await api.call("GET", "/v1/me"))).toStrictEqual(DEFAULT);
  });

  it("answers 503 when a language is to be checked and the catalog cannot be read", async () => {
    const api = makeApi({ catalog: unreadableCatalog });

    expect(
      await refusal(await api.call("PATCH", "/v1/me", { l1: "ja" })),
    ).toStrictEqual([503, "ERR_CONTENT_UNREADABLE"]);
    expect(api.lines.at(-1)).toMatchObject({ reason: "missing" });
  });
});

describe("whose profile a request reaches", () => {
  it("never lets B's credential read or change A's profile", async () => {
    const { a, b } = twoLearners();
    await a.call("PATCH", "/v1/me", { timeZone: "Europe/London" });
    const before = await a.stores.forLearner(learnerId("learner-a")).profile();

    const read = await profileOf(await b.call("GET", "/v1/me"));
    const changed = await profileOf(
      await b.call("PATCH", "/v1/me", {
        timeZone: "Pacific/Auckland",
        learnerId: "learner-a",
      }),
    );

    expect(read).toStrictEqual(DEFAULT);
    expect(changed).toStrictEqual({ ...DEFAULT, timeZone: "Pacific/Auckland" });
    expect(await a.stores.forLearner(learnerId("learner-a")).profile()).toStrictEqual(
      before,
    );
    expect(await profileOf(await a.call("GET", "/v1/me"))).toStrictEqual({
      ...DEFAULT,
      timeZone: "Europe/London",
    });
    expect(b.lines.map((line) => line.learnerId)).toStrictEqual([
      "learner-b",
      "learner-b",
    ]);
  });
});
