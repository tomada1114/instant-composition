import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type VocabSession, type VocabSummary } from "@instant-composition/web";
import {
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
import { fakeFiniteVocabApi as fakeApi } from "./web-vocab-finite-api";
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
    delete?: () => Response | Promise<Response>;
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
    if (call.url === "/api/v1/vocab/paged-sessions")
      return Response.json(options.session ?? vocabSession());
    if (call.method === "DELETE")
      return options.delete?.() ?? new Response(null, { status: 204 });
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
  await settle();
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
    expect(
      screen.getByRole("link", { name: fill(ja.Vocab.extra, { count: 10 }) }),
    ).toHaveAttribute("href", "/vocab/study?kind=extra");
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
  it("offers exactly the three extra cards available at the hub", async () => {
    fakeApi(() =>
      Response.json(vocabHub({ extra: 3, today: { due: 0, new: 0, minutes: 0 } })),
    );
    await renderApp("/vocab");
    expect(
      screen.getByRole("link", { name: fill(ja.Vocab.extra, { count: 3 }) }),
    ).toHaveAttribute("href", "/vocab/study?kind=extra");
    expect(
      screen.queryByRole("link", { name: fill(ja.Vocab.extra, { count: 10 }) }),
    ).toBeNull();
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
  it("marks English front and back fragments while retaining Japanese meaning and controls", async () => {
    const card = vocabCard();
    serve();
    await renderApp("/vocab/study");
    expect(screen.getByText(card.definition, { selector: "p" })).toHaveAttribute(
      "lang",
      "en",
    );
    expect(screen.getByLabelText("…").closest("p")).toHaveAttribute("lang", "en");
    expect(
      screen.getByText(ja.Vocab.categories.phrase).closest('[lang="en"]'),
    ).toBeNull();
    fireEvent.click(
      screen.getAllByRole("button", { name: ja.Drill.card.flip })[0] ?? document.body,
    );
    expect(screen.getByText(card.headword)).toHaveAttribute("lang", "en");
    expect(
      screen.getByText("No worries", { selector: "strong" }).closest("p"),
    ).toHaveAttribute("lang", "en");
    expect(screen.getByText(card.example2)).toHaveAttribute("lang", "en");
    expect(screen.getByText(card.meaning).closest('[lang="en"]')).toBeNull();
    expect(
      screen.getByRole("button", { name: "忘れた 明日" }).closest('[lang="en"]'),
    ).toBeNull();
  });
  it("announces the English definition with its language while keeping pause and feedback Japanese", async () => {
    const card = vocabCard();
    serve({ session: vocabSession({ cards: [card, vocabCard("v_next")] }) });
    await renderApp("/vocab/study");
    const definition = screen.getByText(card.definition, { selector: "span" });
    expect(definition).toHaveAttribute("lang", "en");
    const announcement = definition.closest("p");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).not.toHaveAttribute("lang", "en");
    expect(announcement).toHaveTextContent(ja.Vocab.front);
    press("?");
    expect(announcement).toBeEmptyDOMElement();
    press("Escape");
    expect(screen.getByText(card.definition, { selector: "span" })).toHaveAttribute(
      "lang",
      "en",
    );
    await settle(16);
    press(" ");
    await settle(151);
    press("3");
    await settle();
    expect(announcement).toHaveTextContent(ja.Drill.grade.good);
    expect(announcement?.querySelector('[lang="en"]')).toBeNull();
  });
  it.each([
    [100, -1],
    [200, -1],
    [400, 0],
  ])(
    "makes only an overflowing back tabbable when its height is %s",
    async (height, tabIndex) => {
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(height);
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
      serve();
      await renderApp("/vocab/study");
      const area =
        screen
          .getByText(vocabCard().definition, { selector: "p" })
          .closest<HTMLElement>("[data-part=back-scroll]") ?? document.body;
      expect(area).not.toHaveAttribute("tabindex");
      const flip =
        screen.getAllByRole("button", { name: ja.Drill.card.flip })[0] ?? document.body;
      flip.focus();
      expect(flip).toHaveFocus();
      fireEvent.click(flip);
      expect(area.tabIndex).toBe(tabIndex);
    },
  );
  it("remeasures a back on resize, allows focus and arrow scrolling, and resets for the next front", async () => {
    let height = 100;
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      () => height,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    serve({ session: vocabSession({ cards: [vocabCard(), vocabCard("v_next")] }) });
    await renderApp("/vocab/study");
    const area =
      screen
        .getByText(vocabCard().definition, { selector: "p" })
        .closest<HTMLElement>("[data-part=back-scroll]") ?? document.body;
    const scrollBy = vi.fn();
    Object.defineProperty(area, "scrollBy", { value: scrollBy });
    await settle(16);
    press(" ");
    expect(area).not.toHaveAttribute("tabindex");
    height = 400;
    fireEvent(window, new Event("resize"));
    expect(area).toHaveAttribute("tabindex", "0");
    area.focus();
    expect(area).toHaveFocus();
    expect(area).not.toHaveClass("outline-none", "focus-visible:outline-none");
    await settle(151);
    press("ArrowDown");
    press("ArrowUp");
    expect(scrollBy.mock.calls).toStrictEqual([[{ top: 48 }], [{ top: -48 }]]);
    press("3");
    await settle();
    await settle(300);
    expect(
      screen.getByText(vocabCard("v_next").definition, { selector: "p" }),
    ).toBeInTheDocument();
    expect(area).not.toHaveAttribute("tabindex");
  });
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
    await settle();
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
      expect(
        screen.getByText(cards[index]?.definition ?? "", { selector: "p" }),
      ).toBeInTheDocument();
      await flipAndGrade();
    }
    expect(
      screen.getByText(cards[0]?.definition ?? "", { selector: "p" }),
    ).toBeInTheDocument();
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
  it("waits for the in-flight last answer and its retry deadline before finishing", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let resolve: (response: Response) => void = () => undefined;
    const sending = new Promise<Response>((done) => {
      resolve = done;
    });
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab") return Response.json(vocabHub());
      if (call.url === "/api/v1/vocab/paged-sessions")
        return Response.json(vocabSession());
      if (call.url.endsWith("/answers"))
        return now < 20_000 ? sending : new Response(null, { status: 204 });
      if (call.url.endsWith("/finish")) return Response.json(vocabSummary());
      return undefined;
    });
    await renderApp("/vocab/study?kind=today");
    await flipAndGrade();
    expect(calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(0);
    resolve(new Response("down", { status: 429, headers: { "Retry-After": "10" } }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(0);
    expect(calls.filter((call) => call.url.endsWith("/answers"))).toHaveLength(1);
    now += 10_000;
    await settle();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(1);
    expect(screen.getByText(ja.Vocab.done)).toBeInTheDocument();
  });
  it("keeps failed paged answers until retry acknowledges them before logical finish", async () => {
    const options = { offline: true };
    const calls = serve(options);
    await renderApp("/vocab/study?kind=today");
    await flipAndGrade();
    expect(calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(0);
    expect(localStorage.getItem("vocab-outbox:session-1:page:0")).toContain("p:0:0:0");
    options.offline = false;
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(calls.find((call) => call.url.endsWith("/finish"))?.body).toStrictEqual({
      generation: 1,
      answers: [],
    });
    expect(
      JSON.parse(localStorage.getItem("vocab-outbox:session-1") ?? "{}"),
    ).toMatchObject({ count: 0 });
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
    ).toStrictEqual([
      "/api/v1/vocab/sessions/old/answers",
      "/api/v1/vocab/paged-sessions",
      calls.find((call) => call.url.endsWith("/page"))?.url,
    ]);
    expect(
      calls.find((call) => call.url === "/api/v1/vocab/paged-sessions")?.body,
    ).toMatchObject({ kind: "today" });
  });
  it("keeps a failed earlier answer and retries it before dealing a fresh queue", async () => {
    const arrival = "11111111-1111-4111-8111-111111111111";
    const ids = vi.spyOn(crypto, "randomUUID").mockReturnValue(arrival);
    const pending = JSON.stringify([
      {
        id: "old:f:v_old",
        roundId: "old",
        cardId: "v_old",
        pass: "first",
        grade: "again",
        timedOut: false,
        elapsedMs: 2000,
      },
    ]);
    sessionStorage.setItem("vocab-answers:old", pending);
    let offline = true;
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url.endsWith("/answers"))
        return offline
          ? refusal(503, "ERR_CONTENT_UNREADABLE")
          : new Response(null, { status: 204 });
      if (call.url === "/api/v1/vocab/paged-sessions")
        return Response.json(vocabSession());
      return undefined;
    });
    await renderApp("/vocab/study");
    expect(
      calls.filter((call) => call.method === "POST").map((call) => call.url),
    ).toStrictEqual(["/api/v1/vocab/sessions/old/answers"]);
    expect(sessionStorage.getItem("vocab-answers:old")).toBe(pending);
    offline = false;
    fireEvent.click(screen.getByRole("button", { name: ja.Home.loadFailed.reload }));
    await settle();
    expect(
      calls.filter((call) => call.method === "POST").map((call) => call.url),
    ).toStrictEqual([
      "/api/v1/vocab/sessions/old/answers",
      "/api/v1/vocab/sessions/old/answers",
      "/api/v1/vocab/paged-sessions",
      calls.find((call) => call.url.endsWith("/page"))?.url,
    ]);
    const sends = calls.filter((call) => call.url.endsWith("/answers"));
    expect(sends[1]?.body).toStrictEqual(sends[0]?.body);
    expect(sessionStorage.getItem("vocab-answers:old")).toBeNull();
    expect(
      calls.find((call) => call.url === "/api/v1/vocab/paged-sessions")?.body,
    ).toStrictEqual({ sessionId: arrival, kind: "today" });
    expect(ids).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(vocabCard().definition, { selector: "p" }),
    ).toBeInTheDocument();
  });
  it("retries a failed start under the same id and closes to the hub", async () => {
    let fails = true;
    const calls = fakeApi((call) =>
      call.url === "/api/v1/home"
        ? Response.json(homeView({ kind: "ready", streak: COUNT }))
        : call.url === "/api/v1/vocab/paged-sessions"
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
        .filter((call) => call.url === "/api/v1/vocab/paged-sessions")
        .map((call) => call.body),
    ).toStrictEqual([
      calls.find((call) => call.url === "/api/v1/vocab/paged-sessions")?.body,
      calls.find((call) => call.url === "/api/v1/vocab/paged-sessions")?.body,
    ]);
    expect(
      screen.getByText(vocabCard().definition, { selector: "p" }),
    ).toBeInTheDocument();
  });
});

describe("vocabulary completion", () => {
  it("moves focus from grading to the completion heading", async () => {
    serve({ session: vocabSession({ cards: [vocabCard()] }) });
    await renderApp("/vocab/study");
    await flipAndGrade();
    const heading = screen.getByRole("heading", { name: ja.Vocab.done, level: 1 });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
  });
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
      expect(screen.getByText("give up")).toHaveAttribute("lang", "en");
      expect(screen.getByText("あきらめる").closest('[lang="en"]')).toBeNull();
      expect(
        screen.queryByRole("button", { name: fill(ja.Vocab.extra, { count: 10 }) }),
      ).toBeNull();
      press(" ");
      await settle();
      expect(window.location.pathname).toBe("/vocab");
    },
  );
  it("offers exactly the three extras remaining in the completed category", async () => {
    fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab")
        return Response.json(
          vocabHub({
            categories: vocabHub().categories.map((row) =>
              row.category === "word" ? { ...row, extra: 3 } : row,
            ),
          }),
        );
      if (call.url === "/api/v1/vocab/paged-sessions")
        return Response.json(vocabSession({ cards: [], category: "word" }));
      if (call.url.endsWith("/finish"))
        return Response.json(vocabSummary({ category: "word" }));
      return undefined;
    });
    await renderApp("/vocab/study?kind=today&category=word");
    expect(
      screen.getByRole("button", { name: fill(ja.Vocab.extra, { count: 3 }) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: fill(ja.Vocab.extra, { count: 10 }) }),
    ).toBeNull();
  });
  it("opens another extra session under a new id even when the path stays the same", async () => {
    const calls = serve({ session: vocabSession({ cards: [], kind: "extra" }) });
    await renderApp("/vocab/study?kind=extra");
    fireEvent.click(
      screen.getByRole("button", { name: fill(ja.Vocab.extra, { count: 10 }) }),
    );
    await settle();
    const starts = calls.filter((call) => call.url === "/api/v1/vocab/paged-sessions");
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
      if (call.url === "/api/v1/vocab/paged-sessions")
        return Response.json(vocabSession());
      if (call.url.endsWith("/answers")) return new Response(null, { status: 204 });
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
    expect(localStorage.getItem("vocab-outbox:session-1:recent")).toContain("p:0:0:0");
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
      if (call.url === "/api/v1/vocab/paged-sessions")
        return Response.json(vocabSession({ cards: [], category: "word" }));
      if (call.url.endsWith("/finish"))
        return Response.json(vocabSummary({ category: "word" }));
      return undefined;
    });
    await renderApp("/vocab/study?kind=today&category=word");
    expect(
      screen.getByRole("heading", { name: "単語の今日の分は完了" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: fill(ja.Vocab.extra, { count: 10 }) }),
    ).toBeNull();
  });
  it("a weak continuation starts another session and displays its new front", async () => {
    let next = false;
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab") return Response.json(vocabHub({ weak: 20 }));
      if (call.url === "/api/v1/vocab/paged-sessions")
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
    fireEvent.click(
      screen.getByRole("button", { name: fill(ja.Vocab.extra, { count: 20 }) }),
    );
    await settle(16);
    expect(
      screen.getByText(vocabCard("v_next").definition, { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(ja.Vocab.weakDone)).toBeNull();
    expect(
      calls.filter((call) => call.url === "/api/v1/vocab/paged-sessions"),
    ).toHaveLength(2);
  });
});

describe("deleting a vocabulary card from a talk", () => {
  async function personalBack(
    cards = [vocabCard("v_own", { personal: true }), vocabCard("v_next")],
    options: Parameters<typeof serve>[0] = {},
  ) {
    options.session = vocabSession({ cards });
    const calls = serve(options);
    await renderApp("/vocab/study");
    expect(screen.getByText(ja.Vocab.fromTalk)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ja.Vocab.delete.go })).toBeNull();
    await settle(16);
    press(" ");
    return calls;
  }
  function openDelete(): void {
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.delete.go }));
  }
  function confirmDelete(): void {
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.delete.confirm }));
  }
  it("never offers origin or deletion on a catalog card's back", async () => {
    serve();
    await renderApp("/vocab/study");
    await settle(16);
    press(" ");
    expect(screen.queryByText(ja.Vocab.fromTalk)).toBeNull();
    expect(screen.queryByRole("button", { name: ja.Vocab.delete.go })).toBeNull();
  });
  it("focuses keep, traps Tab, and Esc closes without grading or deleting", async () => {
    const calls = await personalBack();
    openDelete();
    expect(screen.getByRole("dialog")).toHaveTextContent(ja.Vocab.delete.title);
    expect(screen.getByRole("dialog")).toHaveTextContent(ja.Vocab.delete.caption);
    const keep = screen.getByRole("button", { name: ja.Vocab.delete.keep });
    expect(keep).toHaveFocus();
    fireEvent.keyDown(keep, { key: "Tab" });
    expect(screen.getByRole("button", { name: ja.Vocab.delete.confirm })).toHaveFocus();
    await settle(200);
    press("3");
    expect(calls.filter((call) => call.url.endsWith("/answers"))).toHaveLength(0);
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(screen.getByText("No worries v_own")).toBeInTheDocument();
  });
  it("accepts an empty 204 and advances without a fabricated grade", async () => {
    const calls = await personalBack();
    openDelete();
    confirmDelete();
    await settle(16);
    expect(calls.filter((call) => call.method === "DELETE")).toMatchObject([
      { url: "/api/v1/vocab/cards/v_own", body: null },
    ]);
    expect(calls.filter((call) => call.url.endsWith("/answers"))).toHaveLength(0);
    expect(
      screen.getByText(vocabCard("v_next").definition, { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(ja.Vocab.fromTalk)).toBeNull();
  });
  it("coalesces pending deletion and blocks keep, grades and background navigation until completion", async () => {
    let resolve!: (response: Response) => void;
    const calls = await personalBack(undefined, {
      delete: () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    });
    openDelete();
    confirmDelete();
    await settle();
    confirmDelete();
    press("3");
    press("Escape");
    fireEvent.click(screen.getByRole("button", { name: ja.Vocab.delete.keep }));
    act(() => {
      window.history.back();
    });
    await settle();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent(ja.Vocab.delete.title);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/answers"))).toHaveLength(0);
    resolve(new Response(null, { status: 204 }));
    await settle(16);
    expect(window.location.pathname).toBe("/vocab/study");
    expect(
      screen.getByText(vocabCard("v_next").definition, { selector: "p" }),
    ).toBeInTheDocument();
  });
  it("keeps a refused card, announces failure and allows an explicit retry", async () => {
    let fail = true;
    const calls = await personalBack(undefined, {
      delete: () =>
        fail ? refusal(503, "ERR_CONFLICT") : new Response(null, { status: 204 }),
    });
    openDelete();
    confirmDelete();
    await settle();
    expect(screen.getByText(ja.Vocab.delete.failed)).toBeInTheDocument();
    expect(screen.getByText("No worries v_own")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fail = false;
    confirmDelete();
    await settle(16);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(2);
    expect(
      screen.getByText(vocabCard("v_next").definition, { selector: "p" }),
    ).toBeInTheDocument();
  });
  it("preserves the answer retry deadline after deleting the last re-ask", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab") return Response.json(vocabHub());
      if (call.url === "/api/v1/vocab/paged-sessions")
        return Response.json(
          vocabSession({ cards: [vocabCard("v_own", { personal: true })] }),
        );
      if (call.url.endsWith("/answers"))
        return new Response("down", { status: 429, headers: { "Retry-After": "10" } });
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      if (call.url.endsWith("/finish")) return Response.json(vocabSummary());
      return undefined;
    });
    await renderApp("/vocab/study");
    await flipAndGrade("1");
    await settle(16);
    press(" ");
    openDelete();
    confirmDelete();
    await settle();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(0);
    now = 20_000;
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(calls.filter((call) => call.url.endsWith("/answers"))).toHaveLength(1);
    expect(calls.find((call) => call.url.endsWith("/finish"))?.body).toStrictEqual({
      generation: 1,
      answers: [],
    });
    expect(screen.getByRole("heading", { name: ja.Vocab.done })).toBeInTheDocument();
    expect(sessionStorage.getItem("vocab-answers:session-1")).toBeNull();
  });
  it("finishes after deleting the last card with an empty answer batch", async () => {
    const calls = await personalBack([vocabCard("v_own", { personal: true })]);
    openDelete();
    confirmDelete();
    await settle();
    expect(screen.getByRole("heading", { name: ja.Vocab.done })).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith("/finish"))?.body).toStrictEqual({
      generation: 1,
      answers: [],
    });
  });
  it("retains unrelated pending answers after deleting a re-ask and acknowledges them before finish", async () => {
    const options = { offline: true };
    const calls = await personalBack(undefined, options);
    await settle(151);
    press("1");
    await settle();
    await settle(300);
    await flipAndGrade("3");
    expect(
      screen.getByText(vocabCard("v_own").definition, { selector: "p" }),
    ).toBeInTheDocument();
    await settle(16);
    press(" ");
    openDelete();
    confirmDelete();
    await settle();
    expect(calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(0);
    expect(localStorage.getItem("vocab-outbox:session-1:removed:v_own")).toBe("1");
    options.offline = false;
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(calls.find((call) => call.url.endsWith("/finish"))?.body).toStrictEqual({
      generation: 1,
      answers: [],
    });
    expect(
      calls.filter((call) => call.url.endsWith("/answers")).at(-1)?.body,
    ).toMatchObject({ answers: [{ cardId: "v_next", grade: "good" }] });
    expect(screen.getByText(ja.Vocab.done)).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("vocab-outbox:session-1") ?? "{}"),
    ).toMatchObject({ count: 0 });
  });
  it("waits for an in-flight answer before deleting its re-ask and does not resend it afterwards", async () => {
    let resolve!: (response: Response) => void;
    let answering = true;
    const cards = [vocabCard("v_own", { personal: true }), vocabCard("v_next")];
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/home")
        return Response.json(homeView({ kind: "ready", streak: COUNT }));
      if (call.url === "/api/v1/vocab") return Response.json(vocabHub());
      if (call.url === "/api/v1/vocab/paged-sessions")
        return Response.json(vocabSession({ cards }));
      if (call.url.endsWith("/answers"))
        return answering
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : new Response(null, { status: 204 });
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      if (call.url.endsWith("/finish")) return Response.json(vocabSummary());
      return undefined;
    });
    await renderApp("/vocab/study");
    await flipAndGrade("1");
    await flipAndGrade("3");
    await settle(16);
    press(" ");
    openDelete();
    confirmDelete();
    await settle();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    answering = false;
    resolve(new Response(null, { status: 204 }));
    await settle();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/answers"))).toHaveLength(2);
    expect(calls.find((call) => call.url.endsWith("/finish"))?.body).toStrictEqual({
      generation: 1,
      answers: [],
    });
  });
});
