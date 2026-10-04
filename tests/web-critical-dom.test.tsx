import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { learnerId } from "@instant-composition/application";
import { roundPayloadSchema } from "@instant-composition/contracts";
import { TALK_STORAGE_KEY } from "@instant-composition/web";
import { makePersonalCard } from "./application-fixtures";
import { fixedCatalog, makeSnapshot, vocabItem } from "./application-harness";
import { makeApi } from "./api-harness";
import { connectClient } from "./critical-flow-harness";
import { fakeTimers, ja, press, renderApp, settle, warmUp } from "./web-harness";
import { begin, say } from "./web-talk-harness";

beforeAll(warmUp);
beforeEach(fakeTimers);
afterEach(() => {
  sessionStorage.clear();
  localStorage.removeItem(TALK_STORAGE_KEY);
  window.history.replaceState(null, "", "/");
});

async function readyApi() {
  const snapshot = makeSnapshot({ vocab: [vocabItem("word", 4, 0)] });
  const cards = [...snapshot.shown.values()]
    .filter((card) => card.level === 4)
    .slice(0, 5);
  const api = makeApi({
    catalog: fixedCatalog({
      ...snapshot,
      shown: new Map(cards.map((card) => [card.id, card])),
    }),
  });
  expect(
    (
      await api.call("PATCH", "/v1/settings", {
        topics: ["work", "travel"],
        dailySize: 5,
        sound: false,
      })
    ).status,
  ).toBe(200);
  expect(
    (await api.call("PATCH", "/v1/level", { mode: "manual", level: 4 })).status,
  ).toBe(200);
  return api;
}

async function grade(key: string) {
  await settle(16);
  press(" ");
  await settle(200);
  press(key, key);
  await settle(400);
  await settle(16);
}

describe("DOM interaction connected to actual client/API/application/persistence", () => {
  it("grades with a keyboard, preserves an offline grade across remount, and finishes without grading it again", async () => {
    const api = await readyApi();
    const round = roundPayloadSchema.parse(
      await (
        await api.call("POST", "/v1/rounds", { roundId: "dom-round", kind: "today" })
      ).json(),
    );
    expect(round.deck).toHaveLength(5);
    expect(
      (
        await api.call("POST", "/v1/rounds/dom-round/answers", {
          answers: round.deck.slice(0, 4).map((cardId) => ({
            id: `seed:${cardId}`,
            cardId,
            pass: "first",
            grade: "good",
            elapsedMs: 1000,
          })),
        })
      ).status,
    ).toBe(204);
    const wire = connectClient(api);
    await renderApp("/drill?kind=today");
    fireEvent.click(
      screen.getByRole("button", {
        name: (name) => name.startsWith(ja.Drill.ready.start),
      }),
    );
    await settle(16);
    wire.disconnected(true);
    await grade("ArrowRight");
    expect(
      [
        ...Array.from({ length: sessionStorage.length }, (_, index) =>
          sessionStorage.key(index),
        ),
      ].some((key) => key?.startsWith("drill-answers:")),
    ).toBe(true);
    cleanup();
    wire.disconnected(false);
    await renderApp("/drill?kind=today");
    await settle(400);
    await settle(16);
    expect(
      screen.getByRole("button", { name: ja.Summary.actions.end }),
    ).toBeInTheDocument();
    const store = api.stores.forLearner(learnerId("learner-1"));
    expect((await store.reviews()).map((entry) => entry.detail.result)).toStrictEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(await store.reviews()).toHaveLength(5);
    expect((await store.items()).size).toBe(5);
    expect(sessionStorage.length).toBe(0);
  });

  it("traps deletion focus, cancels a leave guard, removes a personal card, re-asks an again grade and persists the finished vocabulary session", async () => {
    const api = await readyApi();
    const card = makePersonalCard({ category: "word", level: 3 });
    const store = api.stores.forLearner(learnerId("learner-1"));
    expect(
      (
        await store.commit({
          puts: [{ type: "card", value: card }],
          updates: [],
          expect: [],
        })
      ).ok,
    ).toBe(true);
    const wire = connectClient(api);
    await renderApp("/vocab/study");
    press("Escape");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    press(" ");
    await settle(200);
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.delete.go }));
    const keep = screen.getByRole("button", { name: ja.Vocab.delete.keep });
    expect(keep).toHaveFocus();
    fireEvent.keyDown(keep, { key: "Tab" });
    expect(screen.getByRole("button", { name: ja.Vocab.delete.confirm })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.delete.confirm }));
    await settle(16);
    expect(await store.card(card.id)).toBeUndefined();
    await grade("1");
    await grade("3");
    await grade("3");
    await settle(16);
    expect(screen.getByRole("button", { name: ja.Vocab.end })).toBeInTheDocument();
    const request = wire.requests.find((value) => value.url.endsWith("/sessions"));
    if (request === undefined) throw new Error("No session request");
    const body = (await request.json()) as { sessionId: string };
    expect(await store.vocabReviewsOf(body.sessionId)).toMatchObject([
      { pass: "first", grade: "again" },
      { pass: "retry", grade: "good" },
      { pass: "retry", grade: "good" },
    ]);
    expect((await store.vocabSession(body.sessionId))?.value.finishedAt).toBe(
      1790046000000,
    );
    expect((await store.vocabItems()).get("v_word-4-0")?.value.state).toMatchObject({
      reps: 1,
      dueDay: "2026-09-23",
    });
  });

  it("sends typed talk turns, resumes after remount with focus in the next field, and keeps early end through its leave guard", async () => {
    const api = await readyApi();
    const wire = connectClient(api);
    await renderApp("/talk");
    await begin();
    await say("こんにちは", "Hello.");
    await settle(320);
    const request = wire.requests.find((value) => value.url.endsWith("/turns"));
    if (request === undefined) throw new Error("No turn request");
    const talkId = new URL(request.url).pathname.split("/")[4] ?? "missing";
    cleanup();
    await renderApp("/talk");
    await settle(320);
    expect(screen.getByRole("textbox", { name: ja.Talk.step.japanese })).toHaveFocus();
    expect(screen.getAllByText("Hello.")).toHaveLength(2);
    press("Escape");
    expect(screen.getByRole("button", { name: ja.Talk.leave.stay })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: ja.Talk.leave.stay }));
    expect(screen.queryByRole("dialog")).toBeNull();
    press("Escape");
    fireEvent.click(screen.getByRole("button", { name: ja.Talk.leave.end }));
    await settle();
    expect(
      screen.getByText(ja.Talk.end.mark, { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      (await api.stores.forLearner(learnerId("learner-1")).talk(talkId))?.value.status,
    ).toBe("ended");
    act(() => {
      window.history.replaceState(null, "", "/");
    });
  });
});
