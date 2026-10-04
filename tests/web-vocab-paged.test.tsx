import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { VocabPage } from "@instant-composition/web";
import {
  fakeApi,
  fakeTimers,
  homeView,
  COUNT,
  ja,
  press,
  refusal,
  renderApp,
  settle,
  warmUp,
  type ApiCall,
} from "./web-harness";
import { vocabCard, vocabHub, vocabSession, vocabSummary } from "./web-vocab-fixtures";
import { outboxAnswer } from "./paged-outbox-harness";

beforeAll(warmUp);
beforeEach(fakeTimers);
afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
function pagedApi() {
  let id = "";
  let nextFailed = true;
  let offline = false;
  const calls = fakeApi((call) => {
    if (call.url === "/api/v1/home")
      return Response.json(homeView({ kind: "ready", streak: COUNT }));
    if (call.url === "/api/v1/vocab") return Response.json(vocabHub());
    if (call.url === "/api/v1/vocab/paged-sessions") {
      id = (call.body as { sessionId: string }).sessionId;
      return Response.json({
        sessionId: id,
        generation: 1,
        status: "ready",
        total: 67,
      });
    }
    if (call.url.endsWith("/page")) {
      const cursor = (call.body as { cursor: string | null }).cursor;
      if (cursor === "1:1" && nextFailed) return refusal(503, "ERR_CONFLICT");
      const index = cursor === null ? 0 : Number(cursor.split(":")[1]);
      const page: VocabPage = {
        ...vocabSession({ sessionId: id }),
        generation: 1,
        page: index,
        total: 67,
        answered: [],
        retained: [],
        continuation: index === 0 ? "1:1" : null,
        cards: Array.from({ length: index === 0 ? 64 : 3 }, (_, slot) => ({
          ...vocabCard(`v_${String(index * 64 + slot)}`),
          slot,
        })),
      };
      return Response.json(page);
    }
    if (call.url.endsWith("/answers"))
      return offline
        ? refusal(503, "ERR_CONFLICT")
        : new Response(null, { status: 204 });
    if (call.url.endsWith("/finish"))
      return Response.json({
        ...vocabSummary({ sessionId: id, answered: 67 }),
        againCount: 1,
      });
    return undefined;
  });
  return {
    calls,
    id: () => id,
    resume() {
      nextFailed = false;
      offline = false;
    },
    failAnswers() {
      offline = true;
    },
  };
}
async function grade(key = "3") {
  await settle(16);
  press(" ");
  await settle(151);
  press(key);
  await settle();
  await settle(360);
}
function front(index: number) {
  expect(
    screen.getByText(vocabCard(`v_${String(index)}`).definition, { selector: "p" }),
  ).toBeInTheDocument();
}
function starts(calls: readonly ApiCall[]) {
  return calls
    .filter((call) => call.url === "/api/v1/vocab/paged-sessions")
    .map((call) => call.body);
}

describe("continuous vocabulary pages in the DOM", () => {
  it("automatically crosses64 cards without an intermediate result or continue action and preserves a retry's four-card spacing", async () => {
    const api = pagedApi();
    await renderApp("/vocab/study");
    for (let index = 0; index < 62; index += 1) await grade();
    front(62);
    await grade("1");
    front(63);
    await grade();
    expect(screen.queryByRole("heading", { name: ja.Vocab.done })).toBeNull();
    expect(screen.queryByRole("button", { name: ja.Drill.dialog.continue })).toBeNull();
    expect(api.calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.retryLoad }));
    await settle();
    expect(screen.getByText(ja.Vocab.loadFailed)).toBeInTheDocument();
    api.resume();
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.retryLoad }));
    await settle();
    front(64);
    await grade();
    front(65);
    await grade();
    front(66);
    await grade();
    front(62);
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    await grade();
    expect(screen.getByRole("heading", { name: ja.Vocab.done })).toBeInTheDocument();
    const continuation = api.calls.filter(
      (call) =>
        call.url.endsWith("/page") &&
        (call.body as { cursor: string | null }).cursor !== null,
    );
    expect(continuation.map((call) => call.body)).toStrictEqual([
      { cursor: "1:1" },
      { cursor: "1:1" },
      { cursor: "1:1" },
    ]);
    expect(api.calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(1);
    const answers = api.calls
      .filter((call) => call.url.endsWith("/answers"))
      .flatMap(
        (call) =>
          (
            call.body as {
              answers: { id: string; page: number; cardId: string; pass: string }[];
            }
          ).answers,
      );
    expect(
      new Set(
        answers
          .filter((answer) => answer.pass === "first")
          .map((answer) => answer.cardId),
      ).size,
    ).toBe(67);
    expect(answers.find((answer) => answer.pass === "retry")).toMatchObject({
      id: "p:0:1:62",
      page: 0,
      cardId: "v_62",
    });
  });
  it("retains the original grade when durable page bytes save before a quota failure and a different grade key retries the save", async () => {
    const api = pagedApi();
    api.failAnswers();
    await renderApp("/vocab/study");
    const localWrite = localStorage.setItem.bind(localStorage);
    const sessionWrite = sessionStorage.setItem.bind(sessionStorage);
    let writes = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ): void {
      if (key === `vocab-outbox:${api.id()}` && ++writes === 2)
        throw new Error("Fixture quota failure.");
      if (this === localStorage) localWrite(key, value);
      else sessionWrite(key, value);
    });
    await settle(16);
    press(" ");
    await settle(151);
    press("1");
    await settle();
    expect(screen.getByText(ja.Drill.save.failed)).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem(`vocab-outbox:${api.id()}:page:0`) ?? "[]"),
    ).toMatchObject([{ id: "p:0:0:0", grade: "again" }]);
    press("3");
    await settle();
    await settle(360);
    front(1);
    expect(
      api.calls.filter((call) => call.url.endsWith("/answers")).at(-1)?.body,
    ).toMatchObject({ answers: [{ id: "p:0:0:0", grade: "again" }] });
    expect(
      JSON.parse(localStorage.getItem(`vocab-outbox:${api.id()}`) ?? "{}"),
    ).toMatchObject({ count: 1 });
  });
  it("retains all unsent answers when stopped during a failed continuation, reloads the same checkpoint and resends their original identities", async () => {
    const api = pagedApi();
    api.failAnswers();
    await renderApp("/vocab/study");
    for (let index = 0; index < 64; index += 1) await grade();
    const meta = localStorage.getItem(`vocab-outbox:${api.id()}`);
    const pending = JSON.stringify(
      Array.from(
        { length: 4 },
        (_, index) =>
          JSON.parse(
            localStorage.getItem(`vocab-outbox:${api.id()}:page:${String(index)}`) ??
              "[]",
          ) as unknown[],
      ).flat(),
    );
    expect(pending).not.toBeNull();
    expect(JSON.parse(pending)).toHaveLength(64);
    const checkpoint = sessionStorage.getItem(`vocab-checkpoint:${api.id()}`);
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.close }));
    await settle();
    expect(window.location.pathname).toBe("/vocab");
    expect(localStorage.getItem(`vocab-outbox:${api.id()}`)).toBe(meta);
    expect(sessionStorage.getItem(`vocab-checkpoint:${api.id()}`)).toBe(checkpoint);
    cleanup();
    await renderApp("/vocab/study");
    expect(starts(api.calls)).toStrictEqual([
      starts(api.calls)[0],
      starts(api.calls)[0],
    ]);
    expect(screen.getByText(ja.Vocab.loadFailed)).toBeInTheDocument();
    api.resume();
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.retryLoad }));
    await settle();
    front(64);
    await grade();
    front(65);
    await grade();
    front(66);
    await grade();
    expect(screen.getByRole("heading", { name: ja.Vocab.done })).toBeInTheDocument();
    expect(localStorage.getItem(`vocab-outbox:${api.id()}`)).toBeNull();
    expect(localStorage.getItem(`vocab-outbox:${api.id()}:owner`)).toBeNull();
    expect(localStorage.getItem(`vocab-outbox:${api.id()}:recent`)).toBeNull();
    expect(sessionStorage.getItem(`vocab-checkpoint:${api.id()}`)).toBeNull();
    const originals = JSON.parse(pending) as { id: string }[];
    const transmitted = api.calls
      .filter((call) => call.url.endsWith("/answers") || call.url.endsWith("/finish"))
      .flatMap((call) => (call.body as { answers: { id: string }[] }).answers);
    for (const answer of originals)
      expect(transmitted.some((sent) => sent.id === answer.id)).toBe(true);
  });
  it("stops after the current bounded preparation request and resumes that logical id after reload", async () => {
    let resolve: (response: Response) => void = () => {
      throw new Error("No pending preparation.");
    };
    let prepares = 0;
    let id = "";
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab") return Response.json(vocabHub());
      if (call.url === "/api/v1/vocab/paged-sessions") {
        id = (call.body as { sessionId: string }).sessionId;
        return Response.json({
          sessionId: id,
          status: "building",
          generation: 1,
          total: 1,
        });
      }
      if (call.url.endsWith("/prepare")) {
        prepares += 1;
        return prepares === 1
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : Response.json({ sessionId: id, status: "ready", generation: 1, total: 1 });
      }
      if (call.url.endsWith("/page"))
        return Response.json({
          ...vocabSession({ sessionId: id }),
          generation: 1,
          page: 0,
          total: 1,
          answered: [],
          retained: [],
          continuation: null,
          cards: [{ ...vocabCard(), slot: 0 }],
        });
      return undefined;
    });
    await renderApp("/vocab/study");
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.close }));
    await settle();
    await act(async () => {
      resolve(
        Response.json({ sessionId: id, status: "building", generation: 1, total: 1 }),
      );
      await Promise.resolve();
    });
    expect(prepares).toBe(1);
    cleanup();
    await renderApp("/vocab/study");
    expect(prepares).toBe(2);
    expect(starts(calls)).toStrictEqual([starts(calls)[0], starts(calls)[0]]);
    expect(
      screen.getByText(vocabCard().definition, { selector: "p" }),
    ).toBeInTheDocument();
  });
});

describe("earlier durable queues before a paged session request", () => {
  it.each(["unreadable", "future"])(
    "blocks a new start for %s metadata without changing bytes or sending answers",
    async (kind) => {
      const api = pagedApi();
      const raw =
        kind === "unreadable"
          ? "{broken"
          : JSON.stringify({
              head: 0,
              tail: 0,
              offset: 0,
              tailLength: 0,
              count: 0,
              retryAt: 0,
              future: 1,
            });
      localStorage.setItem("vocab-outbox:earlier", raw);
      localStorage.setItem(
        "vocab-outbox:earlier:page:0",
        JSON.stringify([{ ...outboxAnswer(0), roundId: "earlier" }]),
      );
      const before = Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index) ?? "";
        return [key, localStorage.getItem(key)];
      });
      await renderApp("/vocab/study");
      expect(starts(api.calls)).toStrictEqual([]);
      expect(api.calls.filter((call) => call.url.endsWith("/answers"))).toStrictEqual(
        [],
      );
      for (const [key, value] of before)
        expect(localStorage.getItem(key ?? "")).toBe(value);
    },
  );
  it("recovers a count-zero interrupted append, sends its original ID, then starts and advances past empty metadata", async () => {
    const api = pagedApi();
    localStorage.setItem(
      "vocab-outbox:earlier",
      JSON.stringify({
        head: 3,
        tail: 3,
        offset: 0,
        tailLength: 0,
        count: 0,
        retryAt: 0,
      }),
    );
    const answer = { ...outboxAnswer(0), roundId: "earlier" };
    localStorage.setItem("vocab-outbox:earlier:page:3", JSON.stringify([answer]));
    await renderApp("/vocab/study");
    front(0);
    const writes = api.calls.filter(
      (call) =>
        call.url.endsWith("/answers") || call.url === "/api/v1/vocab/paged-sessions",
    );
    expect(writes.map((call) => call.url)).toStrictEqual([
      "/api/v1/vocab/paged-sessions/earlier/answers",
      "/api/v1/vocab/paged-sessions",
    ]);
    expect(writes[0]?.body).toMatchObject({
      generation: 1,
      answers: [{ id: answer.id, cardId: answer.cardId }],
    });
    expect(
      JSON.parse(localStorage.getItem("vocab-outbox:earlier") ?? "null"),
    ).toMatchObject({ head: 4, tail: 4, count: 0 });
    expect(localStorage.getItem("vocab-outbox:earlier:page:3")).toBeNull();
  });
});
