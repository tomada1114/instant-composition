import { beforeEach, describe, expect, it } from "vitest";

import {
  endTalk,
  learnerId,
  recordRecital,
  retryReply,
  sendTurn,
  startTalk,
  type LanguageModel,
  type SendTurnCommand,
} from "@instant-composition/application";
import { TALK_TUNING } from "@instant-composition/domain";

import { DAY_MS, NOON } from "./application-harness";
import {
  JUDGMENT,
  makeTalkHarness,
  SCENE,
  tasksOf,
  type TalkHarness,
} from "./application-talk-harness";

// The five talk commands over the stand-in model and the in-memory store:
// what each answers, what it keeps, and which model calls it makes.

let h: TalkHarness;

beforeEach(() => {
  h = makeTalkHarness();
});

const TURN: SendTurnCommand = {
  talkId: "t1",
  turn: 1,
  japanese: "先週引っ越してきました。",
  english: "I moved here last week.",
};

const stored = () => h.stores.forLearner(h.learner).talk("t1");

async function started(): Promise<void> {
  const opened = await startTalk(h.talkDeps, h.context(), { talkId: "t1" });
  if (!opened.ok) {
    throw new Error("Starting the talk failed.");
  }
}

/** Sends turns 1 to `count` of talk `t1`, each answered. */
async function sentThrough(count: number): Promise<void> {
  for (let turn = 1; turn <= count; turn += 1) {
    const sent = await sendTurn(h.talkDeps, h.context(), { ...TURN, turn });
    if (!sent.ok) {
      throw new Error(`Sending turn ${String(turn)} failed.`);
    }
  }
}

describe("startTalk", () => {
  it("makes one scene call for two starts with the same talk id, and answers the same talk both times", async () => {
    const first = await startTalk(h.talkDeps, h.context(), { talkId: "t1" });
    const second = await startTalk(h.talkDeps, h.context(NOON + 1_000), {
      talkId: "t1",
    });

    expect(first).toStrictEqual({
      ok: true,
      value: {
        talkId: "t1",
        scene: {
          partner: SCENE.partner,
          place: SCENE.place,
          relation: SCENE.relation,
          description: SCENE.description,
        },
        opening: SCENE.opening,
      },
    });
    expect(second).toStrictEqual(first);
    expect(tasksOf(h.model)).toStrictEqual(["talk-scene"]);
  });

  it("keeps the talk open, expiring a day later, with the model and the prompt versions it ran at", async () => {
    await started();

    expect((await stored())?.value).toMatchObject({
      id: "t1",
      status: "open",
      startedAt: NOON,
      expiresAt: (NOON + DAY_MS) / 1000,
      turns: [],
      model: {
        provider: "stand-in",
        modelId: "stand-in",
        prompts: {
          "talk-scene": "talk-scene@1",
          "talk-teacher": "talk-teacher@1",
          "talk-partner": "talk-partner@1",
        },
      },
    });
  });

  it("answers ERR_MODEL_UNAVAILABLE and keeps nothing when the scene call fails", async () => {
    h.failing.add("talk-scene");

    expect(await startTalk(h.talkDeps, h.context(), { talkId: "t1" })).toStrictEqual({
      ok: false,
      error: { code: "ERR_MODEL_UNAVAILABLE", reason: "malformed" },
    });
    expect(await stored()).toBeUndefined();
  });

  it.each([
    ["a blank opening", { ...SCENE, opening: "" }],
    ["a blank scene field", { ...SCENE, place: " " }],
  ])("answers ERR_MODEL_UNAVAILABLE and keeps nothing for %s", async (_, scene) => {
    h.scene = scene;

    expect(await startTalk(h.talkDeps, h.context(), { talkId: "t1" })).toStrictEqual({
      ok: false,
      error: { code: "ERR_MODEL_UNAVAILABLE", reason: "malformed" },
    });
    expect(await stored()).toBeUndefined();
  });

  it("starts afresh over an expired talk with the same id", async () => {
    await started();
    await sentThrough(1);

    const again = await startTalk(h.talkDeps, h.context(NOON + DAY_MS), {
      talkId: "t1",
    });

    expect(again.ok).toBe(true);
    expect(tasksOf(h.model).filter((task) => task === "talk-scene")).toHaveLength(2);
    expect(await stored()).toMatchObject({ version: 3, value: { turns: [] } });
  });

  it("bounds every model call by the tuned timeout", async () => {
    await started();
    await sentThrough(1);

    expect(h.deadlines).toStrictEqual([
      TALK_TUNING.modelTimeoutMs,
      TALK_TUNING.modelTimeoutMs,
      TALK_TUNING.modelTimeoutMs,
    ]);
  });
});

describe("sendTurn", () => {
  beforeEach(started);

  it("answers the judgment and the partner's reply, made by one teacher and one partner call", async () => {
    expect(await sendTurn(h.talkDeps, h.context(), TURN)).toStrictEqual({
      ok: true,
      value: {
        judgment: JUDGMENT,
        reply: { line: "Reply after 3 messages.", closing: false },
      },
    });
    expect(tasksOf(h.model)).toStrictEqual([
      "talk-scene",
      "talk-teacher",
      "talk-partner",
    ]);
  });

  it("sends no English to the teacher on a give-up, and keeps its correction", async () => {
    const sent = await sendTurn(h.talkDeps, h.context(), { ...TURN, english: null });

    const teacher = h.model.requests.find((request) => request.task === "talk-teacher");
    expect(teacher?.messages.map((message) => message.text).join("\n")).not.toContain(
      "<english>",
    );
    expect(sent.ok && sent.value.judgment).toStrictEqual(JUDGMENT);
  });

  it.each([
    ["fine on a give-up", { verdict: "fine", modelAnswer: "", point: "" }, null],
    [
      "corrected with a blank model answer",
      { ...JUDGMENT, modelAnswer: "  " },
      TURN.english,
    ],
    ["corrected with a blank point", { ...JUDGMENT, point: "" }, TURN.english],
  ])(
    "keeps a turn whose teacher answered %s as failed, never as an empty correction",
    async (_, answer, english) => {
      h.teacher = answer;

      const sent = await sendTurn(h.talkDeps, h.context(), { ...TURN, english });

      expect(sent.ok && sent.value.judgment).toStrictEqual({
        verdict: "failed",
        modelAnswer: "",
        point: "",
      });
    },
  );

  it("keeps a turn whose teacher failed as failed, and still answers the reply", async () => {
    h.failing.add("talk-teacher");

    const sent = await sendTurn(h.talkDeps, h.context(), TURN);

    expect(sent).toStrictEqual({
      ok: true,
      value: {
        judgment: { verdict: "failed", modelAnswer: "", point: "" },
        reply: { line: "Reply after 3 messages.", closing: false },
      },
    });
    expect((await stored())?.value.turns[0]?.judgment.verdict).toBe("failed");
  });

  it("keeps a turn whose partner failed without a reply, and answers reply null", async () => {
    h.failing.add("talk-partner");

    const sent = await sendTurn(h.talkDeps, h.context(), TURN);

    expect(sent).toStrictEqual({
      ok: true,
      value: { judgment: JUDGMENT, reply: null },
    });
    expect((await stored())?.value.turns[0]).not.toHaveProperty("reply");
  });

  it("keeps no blank reply, so a retry asks the partner again", async () => {
    h.partnerLine = "   ";

    const sent = await sendTurn(h.talkDeps, h.context(), TURN);
    const kept = (await stored())?.value.turns[0];
    h.partnerLine = undefined;
    const retried = await retryReply(h.talkDeps, h.context(), { talkId: "t1" });

    expect(sent.ok && sent.value.reply).toBeNull();
    expect(kept).not.toHaveProperty("reply");
    expect(retried).toStrictEqual({
      ok: true,
      value: { line: "Reply after 3 messages.", closing: false },
    });
    expect(tasksOf(h.model).filter((task) => task === "talk-partner")).toHaveLength(2);
  });

  it("answers a resent turn as it was kept, with no model call", async () => {
    const first = await sendTurn(h.talkDeps, h.context(), TURN);
    h.teacher = { verdict: "fine", modelAnswer: "", point: "" };

    const resent = await sendTurn(h.talkDeps, h.context(), TURN);

    expect(resent).toStrictEqual(first);
    expect(tasksOf(h.model)).toHaveLength(3);
  });

  it("answers two sends of one turn racing each other with the result kept first", async () => {
    const [a, b] = await Promise.all([
      sendTurn(h.talkDeps, h.context(), TURN),
      sendTurn(h.talkDeps, h.context(), { ...TURN, english: "I came here last week." }),
    ]);

    expect(b).toStrictEqual(a);
    expect((await stored())?.value.turns).toHaveLength(1);
  });

  it("keeps the turn when a recital lands while the model answers", async () => {
    await sentThrough(1);
    const racing: LanguageModel = {
      generate: async (request, signal) => {
        if (request.task === "talk-teacher") {
          await recordRecital(h.talkDeps, h.context(), {
            talkId: "t1",
            turn: 1,
            revealCount: 2,
          });
        }
        return h.model.generate(request, signal);
      },
    };

    const sent = await sendTurn(h.withModel(racing), h.context(), { ...TURN, turn: 2 });

    expect(sent.ok).toBe(true);
    expect((await stored())?.value.turns.map((turn) => turn.revealCount)).toStrictEqual(
      [2, undefined],
    );
  });

  it("answers ERR_CONFLICT for a turn other than the next", async () => {
    await sentThrough(1);

    expect(await sendTurn(h.talkDeps, h.context(), { ...TURN, turn: 3 })).toStrictEqual(
      {
        ok: false,
        error: { code: "ERR_CONFLICT" },
      },
    );
  });

  it("answers ERR_BAD_REQUEST for an English holding Japanese, with no model call", async () => {
    expect(
      await sendTurn(h.talkDeps, h.context(), { ...TURN, english: "I moved 先週." }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_BAD_REQUEST" } });
    expect(tasksOf(h.model)).toStrictEqual(["talk-scene"]);
  });

  it("finishes the talk on turn 6, closing the reply, after 13 model calls in all", async () => {
    await sentThrough(5);

    const sixth = await sendTurn(h.talkDeps, h.context(), { ...TURN, turn: 6 });

    expect(sixth.ok && sixth.value.reply).toStrictEqual({
      line: "Reply after 13 messages.",
      closing: true,
    });
    expect((await stored())?.value).toMatchObject({
      status: "finished",
      endedAt: NOON,
    });
    expect((await stored())?.value).not.toHaveProperty("expiresAt");
    expect(h.model.requests).toHaveLength(13);
  });

  it.each([
    ["finished", 6],
    ["ended", 1],
  ])("answers ERR_TALK_CLOSED for a new turn on a %s talk", async (_, kept) => {
    await sentThrough(kept);
    await endTalk(h.talkDeps, h.context(), { talkId: "t1" });

    expect(
      await sendTurn(h.talkDeps, h.context(), { ...TURN, turn: kept + 1 }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_TALK_CLOSED" } });
  });

  it.each([
    ["an unknown talk", "t2", NOON, "learner-a"],
    ["an expired talk", "t1", NOON + DAY_MS, "learner-a"],
    ["another learner's talk", "t1", NOON, "learner-b"],
  ])("answers ERR_TALK_NOT_FOUND for %s", async (_, talkId, now, learner) => {
    const id = learnerId(learner);
    const context = {
      ...h.context(now),
      actor: { kind: "learner" as const, learnerId: id },
      learner: { ...h.context(now).learner, id },
    };

    expect(await sendTurn(h.talkDeps, context, { ...TURN, talkId })).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_NOT_FOUND" },
    });
  });

  it("answers ERR_TALK_CLOSED when the talk ended while the model answered", async () => {
    const ending: LanguageModel = {
      generate: async (request, signal) => {
        if (request.task === "talk-teacher") {
          await endTalk(h.talkDeps, h.context(), { talkId: "t1" });
        }
        return h.model.generate(request, signal);
      },
    };

    expect(await sendTurn(h.withModel(ending), h.context(), TURN)).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_CLOSED" },
    });
    expect((await stored())?.value).toMatchObject({ status: "discarded", turns: [] });
  });
});

describe("authorization", () => {
  const agent = () => ({
    ...h.context(),
    actor: { kind: "agent" as const, onBehalfOf: h.learner, grants: [] },
  });

  it.each([
    ["startTalk", () => startTalk(h.talkDeps, agent(), { talkId: "t1" })],
    ["sendTurn", () => sendTurn(h.talkDeps, agent(), TURN)],
    ["retryReply", () => retryReply(h.talkDeps, agent(), { talkId: "t1" })],
    [
      "recordRecital",
      () =>
        recordRecital(h.talkDeps, agent(), { talkId: "t1", turn: 1, revealCount: 0 }),
    ],
    ["endTalk", () => endTalk(h.talkDeps, agent(), { talkId: "t1" })],
  ])("refuses %s to an agent not granted it, with no model call", async (_, run) => {
    expect(await run()).toStrictEqual({ ok: false, error: { code: "ERR_FORBIDDEN" } });
    expect(h.model.requests).toHaveLength(0);
  });
});

describe("retryReply", () => {
  beforeEach(started);

  it("asks the partner again for a missing reply and keeps it", async () => {
    h.failing.add("talk-partner");
    await sentThrough(1);
    h.failing.clear();

    const retried = await retryReply(h.talkDeps, h.context(), { talkId: "t1" });

    expect(retried).toStrictEqual({
      ok: true,
      value: { line: "Reply after 3 messages.", closing: false },
    });
    expect((await stored())?.value.turns[0]?.reply).toBe("Reply after 3 messages.");
  });

  it("answers a kept reply without a model call", async () => {
    await sentThrough(1);

    const retried = await retryReply(h.talkDeps, h.context(), { talkId: "t1" });

    expect(retried).toStrictEqual({
      ok: true,
      value: { line: "Reply after 3 messages.", closing: false },
    });
    expect(tasksOf(h.model)).toHaveLength(3);
  });

  it("answers ERR_MODEL_UNAVAILABLE when the partner fails again, keeping nothing", async () => {
    h.failing.add("talk-partner");
    await sentThrough(1);

    expect(await retryReply(h.talkDeps, h.context(), { talkId: "t1" })).toStrictEqual({
      ok: false,
      error: { code: "ERR_MODEL_UNAVAILABLE", reason: "malformed" },
    });
    expect((await stored())?.version).toBe(2);
  });

  it("answers two retries racing each other with the reply kept first", async () => {
    h.failing.add("talk-partner");
    await sentThrough(1);
    h.failing.clear();

    const [a, b] = await Promise.all([
      retryReply(h.talkDeps, h.context(), { talkId: "t1" }),
      retryReply(h.talkDeps, h.context(), { talkId: "t1" }),
    ]);

    expect(b).toStrictEqual(a);
    expect((await stored())?.version).toBe(3);
  });

  it("answers ERR_TALK_CLOSED when the talk ended while the partner answered", async () => {
    h.failing.add("talk-partner");
    await sentThrough(1);
    h.failing.clear();
    const ending: LanguageModel = {
      generate: async (request, signal) => {
        await endTalk(h.talkDeps, h.context(), { talkId: "t1" });
        return h.model.generate(request, signal);
      },
    };

    expect(
      await retryReply(h.withModel(ending), h.context(), { talkId: "t1" }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_TALK_CLOSED" } });
  });

  it("answers ERR_TALK_NOT_FOUND for an unknown talk", async () => {
    expect(await retryReply(h.talkDeps, h.context(), { talkId: "t2" })).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_NOT_FOUND" },
    });
  });

  it("asks for the closing line of a talk finished without one", async () => {
    await sentThrough(5);
    h.failing.add("talk-partner");
    await sentThrough(6);
    h.failing.clear();

    const retried = await retryReply(h.talkDeps, h.context(), { talkId: "t1" });

    expect(retried.ok && retried.value.closing).toBe(true);
  });
});

describe("recordRecital", () => {
  beforeEach(started);

  it("keeps the reveal count, and writes nothing when the same count is sent again", async () => {
    await sentThrough(1);

    const first = await recordRecital(h.talkDeps, h.context(), {
      talkId: "t1",
      turn: 1,
      revealCount: 1,
    });
    const again = await recordRecital(h.talkDeps, h.context(), {
      talkId: "t1",
      turn: 1,
      revealCount: 1,
    });

    expect([first, again]).toStrictEqual([
      { ok: true, value: undefined },
      { ok: true, value: undefined },
    ]);
    expect(await stored()).toMatchObject({
      version: 3,
      value: { turns: [{ revealCount: 1 }] },
    });
  });

  it("answers ERR_CONFLICT for a turn not kept yet", async () => {
    expect(
      await recordRecital(h.talkDeps, h.context(), {
        talkId: "t1",
        turn: 1,
        revealCount: 0,
      }),
    ).toStrictEqual({ ok: false, error: { code: "ERR_CONFLICT" } });
  });
});

describe("endTalk", () => {
  beforeEach(started);

  it("keeps a talk ended after one turn, no longer expiring", async () => {
    await sentThrough(1);

    expect(await endTalk(h.talkDeps, h.context(), { talkId: "t1" })).toStrictEqual({
      ok: true,
      value: { kept: true },
    });
    expect((await stored())?.value).toMatchObject({ status: "ended", endedAt: NOON });
    expect((await stored())?.value).not.toHaveProperty("expiresAt");
  });

  it("discards a talk ended before any turn, left to expire", async () => {
    expect(await endTalk(h.talkDeps, h.context(), { talkId: "t1" })).toStrictEqual({
      ok: true,
      value: { kept: false },
    });
    expect((await stored())?.value).toMatchObject({
      status: "discarded",
      expiresAt: (NOON + DAY_MS) / 1000,
    });
  });

  it("answers the same kept when ended again, writing nothing", async () => {
    await sentThrough(1);
    const first = await endTalk(h.talkDeps, h.context(), { talkId: "t1" });

    const again = await endTalk(h.talkDeps, h.context(), { talkId: "t1" });

    expect(again).toStrictEqual(first);
    expect((await stored())?.version).toBe(3);
  });

  it("answers ERR_TALK_NOT_FOUND for an unknown talk", async () => {
    expect(await endTalk(h.talkDeps, h.context(), { talkId: "t2" })).toStrictEqual({
      ok: false,
      error: { code: "ERR_TALK_NOT_FOUND" },
    });
  });
});
