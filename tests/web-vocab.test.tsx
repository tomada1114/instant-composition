import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type VocabSession, type VocabSummary } from "@instant-composition/web";
import {
  fakeApi,
  fakeTimers,
  fill,
  homeView,
  COUNT,
  ja,
  landmarks,
  navigations,
  press,
  refusal,
  renderApp,
  settle,
  warmUp,
} from "./web-harness";
import { vocabCard, vocabHub, vocabSession, vocabSummary } from "./web-vocab-fixtures";

beforeAll(warmUp);
beforeEach(fakeTimers);
afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
function serve(
  options: {
    session?: VocabSession;
    summary?: VocabSummary;
    offline?: boolean;
    exhausted?: boolean;
  } = {},
) {
  return fakeApi((call) => {
    if (call.url === "/api/v1/home")
      return Response.json(homeView({ kind: "ready", streak: COUNT }));
    if (call.url === "/api/v1/vocab")
      return Response.json(
        vocabHub(
          options.exhausted
            ? {
                extra: 0,
                weak: 0,
                categories: vocabHub().categories.map((row) => ({
                  ...row,
                  extra: 0,
                  weak: 0,
                })),
              }
            : {},
        ),
      );
    if (call.url === "/api/v1/vocab/sessions")
      return Response.json(options.session ?? vocabSession());
    if (call.url.endsWith("/answers"))
      return options.offline
        ? refusal(503, "ERR_CONFLICT")
        : new Response(null, { status: 204 });
    if (call.url.endsWith("/finish"))
      return Response.json(options.summary ?? vocabSummary());
    return undefined;
  });
}
async function flipAndGrade(key = "3"): Promise<void> {
  await settle(16);
  press(" ");
  await settle(151);
  press(key);
  await settle(300);
}

describe("the vocabulary hub", () => {
  it("shows the accepted 22-card, four-minute mix and the five sections in order", async () => {
    serve();
    await renderApp("/vocab");
    expect(
      screen.getByText(fill(ja.Vocab.size, { count: 22, minutes: 4 })),
    ).toBeInTheDocument();
    expect(navigations()).toStrictEqual([
      [
        ["/", null],
        ["/vocab", "page"],
        ["/talk", null],
        ["/records", null],
        ["/settings", null],
      ],
    ]);
    expect(landmarks()).toStrictEqual(["navigation", "main"]);
    press(" ");
    await settle();
    expect(window.location.pathname).toBe("/vocab/study");
    expect(screen.queryByRole("navigation")).toBeNull();
  });
  it("restricts category and weak sessions, and refuses an empty category", async () => {
    serve();
    await renderApp("/vocab");
    const empty = screen.getByRole("link", {
      name: new RegExp(ja.Vocab.categories.phrase),
    });
    expect(empty).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(empty);
    await settle();
    expect(window.location.pathname).toBe("/vocab");
    expect(
      screen.getByRole("link", { name: new RegExp(ja.Vocab.categories.word) }),
    ).toHaveAttribute("href", "/vocab/study?kind=today&category=word");
    expect(
      screen.getByRole("link", { name: new RegExp(ja.Vocab.weak) }),
    ).toHaveAttribute("href", "/vocab/study?kind=weak");
  });
  it("shows done with extra and tomorrow, and Esc returns home", async () => {
    fakeApi((call) =>
      call.url === "/api/v1/vocab"
        ? Response.json(vocabHub({ today: { due: 0, new: 0, minutes: 0 } }))
        : undefined,
    );
    await renderApp("/vocab");
    expect(screen.getByText(ja.Vocab.done)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ja.Vocab.extra })).toHaveAttribute(
      "href",
      "/vocab/study?kind=extra",
    );
    press("Escape");
    await settle();
    expect(window.location.pathname).toBe("/");
  });
  it("keeps navigation while loading and retries a failed hub read", async () => {
    let failed = true;
    fakeApi((call) =>
      call.url === "/api/v1/vocab"
        ? failed
          ? refusal(503, "ERR_CONTENT_UNREADABLE")
          : Response.json(vocabHub())
        : undefined,
    );
    await renderApp("/vocab");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(screen.getByRole("heading", { name: ja.Vocab.title })).toBeInTheDocument();
  });
  it("shows a pair with no cards without an action, and refuses empty weak", async () => {
    fakeApi(() => Response.json(vocabHub({ empty: true, weak: 0, extra: 0 })));
    await renderApp("/vocab");
    expect(screen.getByRole("heading", { name: ja.Vocab.empty })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Vocab.start })).toBeNull();
    cleanup();
    fakeApi(() => Response.json(vocabHub({ weak: 0 })));
    await renderApp("/vocab");
    const weak = screen.getByRole("link", { name: new RegExp(ja.Vocab.weak) });
    expect(weak).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(weak);
    await settle();
    expect(window.location.pathname).toBe("/vocab");
  });
});

describe("an untimed vocabulary session", () => {
  it("shows a dialogue with a fixed blank, flips by click, and emphasizes the filled answer", async () => {
    serve();
    await renderApp("/vocab/study?kind=today");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(
      screen.getByText("A: Sorry I'm late. B:", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("…")).toHaveClass("w-[6ch]");
    await settle(120000);
    expect(screen.queryByText("No worries v_card0001")).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: ja.Drill.card.flip })[0] ?? document.body,
    );
    expect(screen.getByText("No worries", { selector: "strong" })).toHaveClass(
      "font-extrabold",
      "underline",
    );
    expect(screen.getByRole("button", { name: "忘れた 明日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "微妙 3 日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "覚えてた 8 日" })).toBeInTheDocument();
  });
  it("locks grading after flip, refuses Space on a back, and records seconds once", async () => {
    const calls = serve();
    await renderApp("/vocab/study?kind=today");
    await settle(2000);
    press("Enter");
    press("3");
    expect(calls.filter((call) => call.url.endsWith("/answers"))).toStrictEqual([]);
    press(" ");
    expect(screen.getByText("No worries v_card0001")).toBeInTheDocument();
    await settle(151);
    press("2");
    await settle(300);
    expect(calls.find((call) => call.url.endsWith("/answers"))?.body).toMatchObject({
      answers: [
        { cardId: "v_card0001", pass: "first", grade: "hard", elapsedMs: 2000 },
      ],
    });
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "微妙 3 日" })).toBeNull();
  });
  it("asks an Again card after four other cards and hides intervals on the re-ask", async () => {
    const cards = Array.from({ length: 6 }, (_, index) =>
      vocabCard(`v_${String(index)}`),
    );
    serve({ session: vocabSession({ cards }) });
    await renderApp("/vocab/study?kind=today");
    await flipAndGrade("1");
    for (const index of [1, 2, 3, 4]) {
      expect(screen.getByText(cards[index]?.definition ?? "")).toBeInTheDocument();
      await flipAndGrade();
    }
    expect(screen.getByText(cards[0]?.definition ?? "")).toBeInTheDocument();
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    await settle(16);
    press(" ");
    expect(
      screen.getByRole("button", { name: ja.Drill.grade.good }),
    ).toBeInTheDocument();
  });
  it("pauses on ? and resumes on Esc, keeping paused time out of the answer", async () => {
    const calls = serve();
    await renderApp("/vocab/study?kind=today");
    await settle(1000);
    press("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await settle(9000);
    press("Escape");
    await settle(1000);
    await flipAndGrade();
    expect(calls.find((call) => call.url.endsWith("/answers"))?.body).toMatchObject({
      answers: [{ elapsedMs: 2016 }],
    });
    expect(screen.getByText(ja.Vocab.done)).toBeInTheDocument();
  });
  it("asks before Back, lets continue restore the session, and quit goes to the hub", async () => {
    serve();
    await renderApp("/vocab");
    press(" ");
    await settle();
    act(() => {
      window.history.back();
    });
    await settle();
    await settle(16);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    press("Escape");
    await settle();
    await settle(16);
    expect(window.location.pathname).toBe("/vocab/study");
    press("Escape");
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.dialog.quit }));
    await settle();
    expect(window.location.pathname).toBe("/vocab");
  });
  it("keeps failed answers in the vocabulary queue and finishes by resending their fixed ids", async () => {
    const calls = serve({ offline: true });
    await renderApp("/vocab/study?kind=today");
    await flipAndGrade();
    expect(calls.find((call) => call.url.endsWith("/finish"))?.body).toMatchObject({
      answers: [{ id: "session-1:f:v_card0001", grade: "good" }],
    });
    expect(sessionStorage.getItem("vocab-answers:session-1")).toBeNull();
    expect(screen.getByText(ja.Vocab.done)).toBeInTheDocument();
  });
  it("resends abandoned sessions before starting a fresh session on reload", async () => {
    sessionStorage.setItem(
      "vocab-answers:old",
      JSON.stringify([
        {
          id: "old:f:v_old",
          roundId: "old",
          cardId: "v_old",
          pass: "first",
          grade: "again",
          timedOut: false,
          elapsedMs: 2000,
        },
      ]),
    );
    const calls = serve();
    await renderApp("/vocab/study?kind=today");
    expect(
      calls.filter((call) => call.method === "POST").map((call) => call.url),
    ).toStrictEqual(["/api/v1/vocab/sessions/old/answers", "/api/v1/vocab/sessions"]);
    expect(
      calls.find((call) => call.url === "/api/v1/vocab/sessions")?.body,
    ).toMatchObject({ kind: "today" });
  });
  it("retries a failed start under the same id and closes to the hub", async () => {
    let fails = true;
    const calls = fakeApi((call) =>
      call.url === "/api/v1/home"
        ? Response.json(homeView({ kind: "ready", streak: COUNT }))
        : call.url === "/api/v1/vocab/sessions"
          ? fails
            ? refusal(503, "ERR_CONTENT_UNREADABLE")
            : Response.json(vocabSession())
          : undefined,
    );
    await renderApp("/vocab/study?kind=weak");
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(
      calls
        .filter((call) => call.url === "/api/v1/vocab/sessions")
        .map((call) => call.body),
    ).toStrictEqual([
      calls.find((call) => call.url === "/api/v1/vocab/sessions")?.body,
      calls.find((call) => call.url === "/api/v1/vocab/sessions")?.body,
    ]);
    expect(screen.getByText(vocabCard().definition)).toBeInTheDocument();
  });
});

describe("vocabulary completion", () => {
  it.each([
    [null, "today", ja.Vocab.done],
    ["word", "today", "単語の今日の分は完了"],
    [null, "weak", ja.Vocab.weakDone],
  ] as const)(
    "shows %s %s completion and figures without celebrations",
    async (category, kind, title) => {
      serve({
        session: vocabSession({ cards: [], category, kind }),
        summary: vocabSummary({
          category,
          kind,
          answered: 22,
          new: 10,
          again: [{ cardId: "v_again", headword: "give up", meaning: "あきらめる" }],
        }),
        exhausted: true,
      });
      await renderApp(`/vocab/study?kind=${kind}`);
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByText("22 枚")).toBeInTheDocument();
      expect(screen.getByText("10 枚")).toBeInTheDocument();
      expect(screen.getByText("14 枚")).toBeInTheDocument();
      expect(screen.getByText("give up")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: ja.Vocab.extra })).toBeNull();
      press(" ");
      await settle();
      expect(window.location.pathname).toBe("/vocab");
    },
  );
  it("opens another extra session under a new id even when the path stays the same", async () => {
    const calls = serve({ session: vocabSession({ cards: [], kind: "extra" }) });
    await renderApp("/vocab/study?kind=extra");
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.extra }));
    await settle();
    const starts = calls.filter((call) => call.url === "/api/v1/vocab/sessions");
    expect(starts).toHaveLength(2);
    expect(starts[1]?.body).not.toStrictEqual(starts[0]?.body);
  });
});

describe("vocabulary recovery and scoped continuation", () => {
  it("keeps the front paused after the page becomes visible again", async () => {
    serve();
    await renderApp("/vocab/study?kind=today");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.dialog.continue }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("retries a failed finish with the same pending answers and then presents the summary", async () => {
    let finishFails = true;
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab") return Response.json(vocabHub());
      if (call.url === "/api/v1/vocab/sessions") return Response.json(vocabSession());
      if (call.url.endsWith("/answers")) return refusal(503, "ERR_CONFLICT");
      if (call.url.endsWith("/finish"))
        return finishFails
          ? refusal(503, "ERR_CONFLICT")
          : Response.json(vocabSummary());
      return undefined;
    });
    await renderApp("/vocab/study?kind=today");
    await flipAndGrade();
    expect(
      screen.getByRole("button", { name: ja.Drill.save.resend }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem("vocab-answers:session-1")).toContain(
      "session-1:f:v_card0001",
    );
    finishFails = false;
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(screen.getByText(ja.Vocab.done)).toBeInTheDocument();
    expect(
      calls.filter((call) => call.url.endsWith("/finish")).map((call) => call.body),
    ).toStrictEqual([
      calls.find((call) => call.url.endsWith("/finish"))?.body,
      calls.find((call) => call.url.endsWith("/finish"))?.body,
    ]);
  });
  it("does not offer another category session when only other categories have extras", async () => {
    fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab")
        return Response.json(
          vocabHub({
            categories: vocabHub().categories.map((row) =>
              row.category === "word" ? { ...row, extra: 0, weak: 0 } : row,
            ),
          }),
        );
      if (call.url === "/api/v1/vocab/sessions")
        return Response.json(vocabSession({ cards: [], category: "word" }));
      if (call.url.endsWith("/finish"))
        return Response.json(vocabSummary({ category: "word" }));
      return undefined;
    });
    await renderApp("/vocab/study?kind=today&category=word");
    expect(
      screen.getByRole("heading", { name: "単語の今日の分は完了" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Vocab.extra })).toBeNull();
  });
  it("a weak continuation starts another session and displays its new front", async () => {
    let next = false;
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab") return Response.json(vocabHub());
      if (call.url === "/api/v1/vocab/sessions")
        return Response.json(
          next
            ? vocabSession({
                sessionId: "session-2",
                kind: "weak",
                cards: [vocabCard("v_next")],
              })
            : vocabSession({ cards: [], kind: "weak" }),
        );
      if (call.url.endsWith("/finish"))
        return Response.json(vocabSummary({ kind: "weak" }));
      return undefined;
    });
    await renderApp("/vocab/study?kind=weak");
    next = true;
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.extra }));
    await settle(16);
    expect(screen.getByText(vocabCard("v_next").definition)).toBeInTheDocument();
    expect(screen.queryByText(ja.Vocab.weakDone)).toBeNull();
    expect(calls.filter((call) => call.url === "/api/v1/vocab/sessions")).toHaveLength(
      2,
    );
  });
});
