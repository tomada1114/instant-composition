import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOCAL_SUBJECT } from "@instant-composition/api";
import { learnerId } from "@instant-composition/application";
import {
  profileSchema,
  roundPayloadSchema,
  roundSummarySchema,
  settingsPageViewSchema,
  talkEndedSchema,
  talkOpenedSchema,
  turnResultSchema,
  vocabHubSchema,
  vocabSessionSchema,
  vocabSummarySchema,
} from "@instant-composition/contracts";

import {
  batchFor,
  makeApi,
  startedPlacement,
  subjectAuthenticator,
} from "./api-harness";
import { NOON } from "./application-harness";
import { localTables } from "./dynamodb-local";

// The API over the DynamoDB store on DynamoDB local: the round's whole life, a
// vocabulary session's, the learner's profile and the grade keys through HTTP,
// as `pnpm api` serves it. Needs `pnpm db:up`; `pnpm
// test:dynamodb` runs it, never the default suite.

const tables = localTables();

beforeAll(async () => {
  await tables.reachable();
});

afterAll(async () => {
  await tables.close();
});

describe("the API on DynamoDB local", () => {
  it("runs a talk to its last turn and keeps it, never found by another learner", async () => {
    const backing = await tables.freshBacking();
    const a = makeApi({ ...backing, authenticator: subjectAuthenticator("subject-a") });
    const b = makeApi({
      ...backing,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });

    const opened = talkOpenedSchema.parse(
      await (await a.call("POST", "/v1/talks", { talkId: "t1" })).json(),
    );
    for (const turn of [1, 2, 3, 4, 5, 6]) {
      const sent = await a.call("POST", "/v1/talks/t1/turns", {
        turn,
        japanese: "こんにちは",
        english: turn === 2 ? null : "Hello.",
      });
      expect(turnResultSchema.parse(await sent.json()).reply?.closing).toBe(turn === 6);
    }
    const stored = await a.stores.forLearner(learnerId("learner-1")).talk("t1");
    const other = await b.call("POST", "/v1/talks/t1/end");
    const ended = await a.call("POST", "/v1/talks/t1/end");

    expect(opened.talkId).toBe("t1");
    expect(other.status).toBe(404);
    expect(talkEndedSchema.parse(await ended.json())).toStrictEqual({ kept: true });
    expect(stored?.value.status).toBe("finished");
    expect(stored?.value.expiresAt).toBeUndefined();
    expect(await a.stores.forLearner(learnerId("learner-1")).talk("t1")).toStrictEqual(
      stored,
    );
  });

  it("registers the learner, then starts, records, finishes and reads back a round", async () => {
    const api = makeApi(await tables.freshBacking());
    const round = await startedPlacement(api);
    const batch = batchFor(round);

    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    const finished = await api.call("POST", "/v1/rounds/p1/finish", { answers: [] });
    const summary = roundSummarySchema.parse(await finished.json());
    const read = await api.call("GET", "/v1/rounds/p1/summary");

    expect(summary.roundId).toBe("p1");
    expect(roundSummarySchema.parse(await read.json())).toStrictEqual(summary);
    expect(api.lines.map((line) => line.outcome)).toStrictEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(new Set(api.lines.map((line) => line.learnerId))).toStrictEqual(
      new Set(["learner-1"]),
    );
    expect((await api.directory.learnerOf(LOCAL_SUBJECT))?.learnerId).toBe("learner-1");
  });

  it("reads a round back with the answers it holds, oldest first", async () => {
    const api = makeApi(await tables.freshBacking());
    const round = await startedPlacement(api);
    api.advance(10_000);
    const held = batchFor(round)
      .answers.slice(0, 2)
      .map((answer, index) => ({ ...answer, answeredAt: NOON + 5_000 - index }));
    expect(
      (await api.call("POST", "/v1/rounds/p1/answers", { answers: held })).status,
    ).toBe(204);

    const read = roundPayloadSchema.parse(
      await (await api.call("GET", "/v1/rounds/p1")).json(),
    );

    expect(read.deck).toStrictEqual(round.deck);
    expect(read.answered.map((answer) => [answer.id, answer.answeredAt])).toStrictEqual(
      held.map((answer) => [answer.id, answer.answeredAt]).reverse(),
    );
  });

  it("changes nothing when the same batch is posted twice, before and after finish", async () => {
    const api = makeApi(await tables.freshBacking());
    const round = await startedPlacement(api);
    const batch = batchFor(round);
    const store = api.stores.forLearner(learnerId("learner-1"));
    const held = async () =>
      Promise.all([
        store.round("p1"),
        store.reviewsOf("p1"),
        store.stats(),
        store.items(),
      ]);

    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    const once = await held();
    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    expect(await held()).toStrictEqual(once);

    expect(
      (await api.call("POST", "/v1/rounds/p1/finish", { answers: [] })).status,
    ).toBe(200);
    const finished = await held();
    expect((await api.call("POST", "/v1/rounds/p1/answers", batch)).status).toBe(204);
    expect(await held()).toStrictEqual(finished);
  });

  it("changes the profile registration wrote, and signs the next request in with it", async () => {
    const backing = await tables.freshBacking();
    const a = makeApi({ ...backing, authenticator: subjectAuthenticator("subject-a") });
    const b = makeApi({
      ...backing,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });

    const changed = await a.call("PATCH", "/v1/me", {
      timeZone: "America/Los_Angeles",
    });
    const again = await a.call("PATCH", "/v1/me", { uiLocale: "ja" });
    const other = await b.call("PATCH", "/v1/me", { timeZone: "Europe/London" });
    const round = await startedPlacement(a);

    const la = {
      timeZone: "America/Los_Angeles",
      l1: "ja",
      target: "en",
      uiLocale: "ja",
    };
    expect(profileSchema.parse(await changed.json())).toStrictEqual(la);
    expect(profileSchema.parse(await again.json())).toStrictEqual(la);
    expect(profileSchema.parse(await other.json())).toMatchObject({
      timeZone: "Europe/London",
    });
    expect(
      profileSchema.parse(await (await a.call("GET", "/v1/me")).json()),
    ).toStrictEqual(la);
    // NOON is 12:00 on 2026-09-22 in Tokyo, and still 20:00 on the 21st in Los Angeles.
    expect(round.day).toBe("2026-09-21");
    expect(
      await backing.stores.forLearner(learnerId("learner-1")).profile(),
    ).toStrictEqual({
      value: la,
      version: 2,
    });
  });

  it("reads → and ← and 2 for hard until the learner sets a pair, then the pair stored and hard derived", async () => {
    const backing = await tables.freshBacking();
    const api = makeApi(backing);
    const read = async () =>
      settingsPageViewSchema.parse(await (await api.call("GET", "/v1/settings")).json())
        .settings.gradeKeys;

    expect(await read()).toStrictEqual({
      ok: "ArrowRight",
      ng: "ArrowLeft",
      hard: "Digit2",
    });
    expect(await backing.stores.forLearner(learnerId("learner-1")).settings()).toBe(
      undefined,
    );

    const gradeKeys = { ok: "KeyL", ng: "Digit1" };
    expect(
      (await api.call("PATCH", "/v1/settings", { topics: ["work"], gradeKeys })).status,
    ).toBe(200);

    expect(await read()).toStrictEqual({ ...gradeKeys, hard: "Digit2" });
    expect(
      (await backing.stores.forLearner(learnerId("learner-1")).settings())?.value
        .gradeKeys,
    ).toStrictEqual(gradeKeys);
  });

  it("runs a vocabulary session to its summary, never found by another learner", async () => {
    const backing = await tables.freshBacking();
    const a = makeApi({ ...backing, authenticator: subjectAuthenticator("subject-a") });
    const b = makeApi({
      ...backing,
      authenticator: subjectAuthenticator("subject-b"),
      newLearnerId: () => learnerId("learner-b"),
    });
    const session = vocabSessionSchema.parse(
      await (
        await a.call("POST", "/v1/vocab/sessions", { sessionId: "s1", kind: "today" })
      ).json(),
    );
    const firsts = session.cards.map((card) => ({
      id: `f:${card.id}`,
      cardId: card.id,
      pass: "first",
      grade: "again",
      elapsedMs: 2_000,
    }));
    const reasks = firsts.map((answer) => ({
      ...answer,
      id: `r:${answer.cardId}`,
      pass: "retry",
      grade: "good",
    }));
    const batch = { answers: [...firsts, ...reasks] };

    expect(session.cards).toHaveLength(10);
    expect((await a.call("POST", "/v1/vocab/sessions/s1/answers", batch)).status).toBe(
      204,
    );
    expect((await a.call("POST", "/v1/vocab/sessions/s1/answers", batch)).status).toBe(
      204,
    );
    expect((await b.call("POST", "/v1/vocab/sessions/s1/finish", batch)).status).toBe(
      404,
    );
    const summary = vocabSummarySchema.parse(
      await (
        await a.call("POST", "/v1/vocab/sessions/s1/finish", { answers: [] })
      ).json(),
    );
    const hub = vocabHubSchema.parse(await (await a.call("GET", "/v1/vocab")).json());
    const mine = backing.stores.forLearner(learnerId("learner-1"));

    expect(summary).toMatchObject({ answered: 10, new: 10, tomorrow: 10 });
    expect(summary.again).toHaveLength(10);
    expect(await mine.vocabReviewsOf("s1")).toHaveLength(20);
    expect(
      [...(await mine.vocabItems()).values()].map(({ version }) => version),
    ).toStrictEqual(Array.from({ length: 10 }, () => 1));
    expect(await mine.items()).toStrictEqual(new Map());
    expect(hub.today).toStrictEqual({ due: 0, new: 0, minutes: 0 });
    expect(hub.tomorrow).toBe(10);
  });
});
