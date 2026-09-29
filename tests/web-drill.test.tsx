import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnswerInput, HomeView, RoundPayload } from "@instant-composition/web";

import {
  COUNT,
  ROUND,
  drillCard,
  fakeApi,
  fakeTimers,
  fill,
  homeView,
  ja,
  press,
  refusal,
  renderApp,
  settle,
  type ApiCall,
  warmUp,
} from "./web-harness";
import { makeSummary } from "./web-summary-fixture";

// The web client's drill, mounted as the whole app at `/drill` over a stand-in
// API: a round run by keys and by taps to its summary, the pause sheet, the placement
// intro, and each way a round cannot start or cannot be saved.

const READY = homeView({ kind: "ready", streak: COUNT });
const ANSWERS = "/api/v1/rounds/round-1/answers";
const FINISH = "/api/v1/rounds/round-1/finish";

interface Serve {
  readonly home?: HomeView;
  readonly round?: RoundPayload | Response;
  /** The round every later request gets, when it differs from the first. */
  readonly next?: RoundPayload;
  readonly answers?: () => Response | Promise<Response>;
  readonly finish?: () => Response | Promise<Response>;
}

/** An API that answers the home view, the round, each answer and the finish. */
function serve(options: Serve = {}): ApiCall[] {
  let rounds = 0;
  return fakeApi((call) => {
    if (call.method === "GET" && call.url === "/api/v1/home") {
      return Response.json(options.home ?? READY);
    }
    if (call.method === "POST" && call.url === "/api/v1/rounds") {
      const asked = rounds;
      rounds += 1;
      const round =
        asked > 0 && options.next !== undefined
          ? options.next
          : (options.round ?? ROUND);
      return round instanceof Response ? round : Response.json(round);
    }
    if (call.method === "POST" && call.url === ANSWERS) {
      return options.answers?.() ?? new Response(null, { status: 204 });
    }
    if (call.method === "POST" && call.url === FINISH) {
      return options.finish?.() ?? Response.json(makeSummary({ roundId: "round-1" }));
    }
    return undefined;
  });
}

/** A correct first pass the server already holds for `cardId`. */
function firstPassOf(cardId: string): RoundPayload["answered"][number] {
  return {
    id: `round-1:f:${cardId}`,
    cardId,
    pass: "first",
    result: "ok",
    answeredAt: Date.UTC(2026, 8, 22, 3, 0),
  };
}

function posted(calls: readonly ApiCall[], url: string): unknown[] {
  return calls
    .filter((call) => call.method === "POST" && call.url === url)
    .map((call) => call.body);
}

function where(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Flips the current card and grades it with `key`, letting the next one start. */
async function grade(key: "ArrowLeft" | "ArrowRight"): Promise<void> {
  press(" ");
  await settle(200);
  press(key);
  await settle(400);
  await settle(16);
}

/** Opens `path` as a fresh load does, and starts the round from its start screen. */
async function openRound(path: string): Promise<void> {
  await renderApp(path);
  press("Enter");
  await settle(16);
}

beforeAll(warmUp);

beforeEach(() => {
  fakeTimers();
});

afterEach(() => {
  act(() => {
    window.history.replaceState(null, "", "/");
  });
  sessionStorage.clear();
});

describe("the drill, a round run to its summary", () => {
  it("runs a round by keys, retries the miss, and finishes with every answer", async () => {
    const calls = serve();
    await openRound("/drill?kind=today");
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.announce.front, { ja: "prompt-c1", seconds: 7 })),
    ).toBeInTheDocument();

    await settle(2000);
    press(" ");
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    press("ArrowLeft");
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    await settle(200);
    press("k");
    await settle(400);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    // React flushes an update when its act() ends, so the frame that starts
    // the clock and the ticks after it are awaited separately.
    await settle(16);
    await settle(7100);
    expect(screen.getByText(ja.Drill.card.timedOut)).toBeInTheDocument();
    press(" ");
    await settle(16);
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    press(" ");
    await settle(200);
    press("ArrowRight");
    await settle(400);
    expect(screen.getByRole("heading", { name: ja.Summary.title.today })).toHaveFocus();

    expect(posted(calls, "/api/v1/rounds")).toHaveLength(1);
    const [start] = posted(calls, "/api/v1/rounds") as {
      roundId: string;
      kind: string;
    }[];
    expect(start?.kind).toBe("today");
    expect(start?.roundId).toMatch(/^[\w-]{1,64}$/u);
    const answers = posted(calls, ANSWERS) as { answers: AnswerInput[] }[];
    expect(answers.map((body) => body.answers.map((a) => a.result))).toStrictEqual([
      ["ok"],
      ["timeout"],
      ["ok"],
    ]);
    const [finish] = posted(calls, FINISH) as { answers: unknown[] }[];
    expect(finish?.answers).toHaveLength(3);
  });

  it("starts one more round from the summary, in place", async () => {
    const calls = serve({
      round: {
        ...ROUND,
        answered: [firstPassOf("c1"), firstPassOf("c2")],
      },
      next: { ...ROUND, id: "round-2", kind: "extra" },
    });
    await renderApp("/drill?kind=today");
    await settle(16);
    fireEvent.click(
      screen.getByRole("button", {
        name: fill(ja.Summary.actions.more, { count: 10 }),
      }),
    );
    await settle();
    await settle(16);
    expect(where()).toBe("/drill?kind=extra");
    expect(
      posted(calls, "/api/v1/rounds").map((body) => (body as { kind: string }).kind),
    ).toStrictEqual(["today", "extra"]);
    expect(
      screen.queryByRole("button", { name: ja.Drill.ready.start }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("goes home from the summary's end button", async () => {
    serve({
      round: {
        ...ROUND,
        answered: [firstPassOf("c1"), firstPassOf("c2")],
      },
    });
    await renderApp("/drill?kind=today");
    await settle(16);
    fireEvent.click(screen.getByRole("button", { name: ja.Summary.actions.end }));
    await settle();
    expect(where()).toBe("/");
  });

  it("reads an unknown kind as today's portion", async () => {
    const calls = serve();
    await openRound("/drill?kind=bonus");
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(posted(calls, "/api/v1/rounds")).toMatchObject([{ kind: "today" }]);
  });
});

describe("the drill, a round run by taps", () => {
  /** A button whose name starts with `label`, ahead of its key hint. */
  function tap(label: string): void {
    fireEvent.click(
      screen.getByRole("button", { name: (name) => name.startsWith(label) }),
    );
  }

  it("flips on the card and the flip button, grades by button, and moves on after a timeout", async () => {
    const calls = serve();
    await renderApp("/drill?kind=today");
    tap(ja.Drill.ready.start);
    await settle(16);

    fireEvent.click(screen.getByText("prompt-c1"));
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    await settle(200);
    tap(ja.Drill.card.said);
    await settle(400);
    await settle(16);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    await settle(7100);
    expect(screen.getByText(ja.Drill.card.timedOut)).toBeInTheDocument();
    tap(ja.Drill.card.next);
    await settle(16);
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();

    tap(ja.Drill.card.flip);
    expect(screen.getByText("answer-c2")).toBeInTheDocument();
    await settle(200);
    tap(ja.Drill.card.notSaid);
    await settle(400);
    expect(screen.getByRole("heading", { name: ja.Summary.title.today })).toHaveFocus();

    const answers = posted(calls, ANSWERS) as { answers: AnswerInput[] }[];
    expect(answers.map((body) => body.answers.map((a) => a.result))).toStrictEqual([
      ["ok"],
      ["timeout"],
      ["ng"],
    ]);
  });

  it("runs each front for the limit the round was dealt, not the card's pace", async () => {
    const long = { limitMs: 30_000, paceMs: 7000 };
    serve({
      round: {
        ...ROUND,
        cards: { c1: drillCard("c1", long), c2: drillCard("c2", long) },
      },
    });
    await openRound("/drill?kind=today");

    await settle(7100);
    expect(screen.queryByText(ja.Drill.card.timedOut)).toBeNull();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    await settle(23_000);
    expect(screen.getByText(ja.Drill.card.timedOut)).toBeInTheDocument();
  });

  it("pauses from the top strip's pause button", async () => {
    serve();
    await openRound("/drill?kind=today");
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.card.pause }));
    expect(
      screen.getByRole("dialog", { name: ja.Drill.sheet.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText("prompt-c1")).not.toBeInTheDocument();
  });
});

/** The text of one `select` branch of a catalog template, for a branch with no arguments. */
function selectBranch(template: string, branch: string): string {
  const match = new RegExp(`\\b${branch} \\{([^{}]*)\\}`, "u").exec(template);
  if (match?.[1] === undefined) throw new Error(`no branch ${branch}`);
  return match[1];
}

describe("the drill's start screen", () => {
  function timerBar(): Element | null {
    return document.querySelector("[data-part=fill]");
  }

  it("opens a round nobody started on a start screen, and starts the timer on its button", async () => {
    serve();
    await renderApp("/drill?kind=today");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: selectBranch(ja.Drill.ready.title, "today"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        fill(ja.Drill.ready.resume, { position: 1, total: ROUND.total }),
      ),
    ).toBeInTheDocument();
    expect(timerBar()).toBeNull();
    expect(screen.queryByText("prompt-c1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.ready.start }));
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(timerBar()).not.toBeNull();
  });

  it("names the place a resumed round picks up from", async () => {
    serve({ round: { ...ROUND, answered: [firstPassOf("c1")] } });
    await renderApp("/drill?kind=today");
    expect(
      screen.getByText(
        fill(ja.Drill.ready.resume, { position: 2, total: ROUND.total }),
      ),
    ).toBeInTheDocument();
    expect(timerBar()).toBeNull();
    press(" ");
    await settle(16);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();
  });

  it("counts a resumed retry pass the way the card screen will", async () => {
    const missed = (cardId: string): RoundPayload["answered"][number] => ({
      ...firstPassOf(cardId),
      result: "ng",
    });
    serve({
      round: { ...ROUND, offset: 8, total: 10, answered: [missed("c1"), missed("c2")] },
    });
    await renderApp("/drill?kind=today");
    expect(
      screen.getByText(fill(ja.Drill.ready.resumeRetry, { position: 1, total: 2 })),
    ).toBeInTheDocument();
    expect(timerBar()).toBeNull();
    press("Enter");
    await settle(16);
    expect(
      screen.getByText(fill(ja.Drill.card.retryProgress, { current: 1, total: 2 })),
    ).toBeInTheDocument();
  });

  it("shows the first front at once when the round starts from home's button", async () => {
    serve();
    await renderApp("/");
    fireEvent.click(screen.getByRole("button", { name: ja.Home.today.start }));
    await settle();
    await settle(16);
    expect(where()).toBe("/drill?kind=today");
    expect(
      screen.queryByRole("button", { name: ja.Drill.ready.start }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(timerBar()).not.toBeNull();
  });
});

describe("the drill's pause sheet", () => {
  it("pauses on Escape with the card hidden, and continues on Escape", async () => {
    serve();
    await openRound("/drill?kind=today");
    press("Escape");
    expect(
      screen.getByRole("dialog", { name: ja.Drill.sheet.title }),
    ).toBeInTheDocument();
    expect(screen.queryByText("prompt-c1")).not.toBeInTheDocument();
    press("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("says quitting keeps the place until the day turns at 04:00", async () => {
    serve();
    await openRound("/drill?kind=today");
    press("Escape");
    expect(
      screen.getByText(fill(ja.Drill.sheet.hint, { hour: 4, position: 1 })),
    ).toBeInTheDocument();
  });

  it("shows no navigation, so the sheet's stop button is the way home", async () => {
    serve();
    await openRound("/drill?kind=today");
    expect(screen.queryByRole("navigation")).toBeNull();
    press("Escape");
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.sheet.quit }));
    await settle();
    expect(where()).toBe("/");
  });

  it("pauses when the page is hidden", async () => {
    serve();
    await openRound("/drill?kind=today");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(
      screen.getByRole("dialog", { name: ja.Drill.sheet.title }),
    ).toBeInTheDocument();
  });

  it("counts the cards shown so far in the pause hint during the retry pass", async () => {
    serve();
    await openRound("/drill?kind=today");
    for (let card = 0; card < 3; card += 1) {
      press(" ");
      await settle(200);
      press("ArrowLeft");
      await settle(200);
      await settle(16);
    }
    expect(
      screen.getByText(fill(ja.Drill.card.retryProgress, { current: 2, total: 2 })),
    ).toBeInTheDocument();
    press("Escape");
    expect(
      screen.getByText(fill(ja.Drill.sheet.hint, { hour: 4, position: 4 })),
    ).toBeInTheDocument();
  });
});

describe("the drill's placement round", () => {
  it("explains the round before the first placement", async () => {
    serve({
      home: homeView({ kind: "placement" }),
      round: { ...ROUND, kind: "placement", retries: false },
    });
    await renderApp("/drill?kind=placement");
    expect(
      screen.getByRole("heading", {
        name: fill(ja.Drill.intro.titleFirst, { count: 2 }),
      }),
    ).toBeInTheDocument();
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("calls a later placement a re-measure", async () => {
    serve({ round: { ...ROUND, kind: "placement", retries: false } });
    await renderApp("/drill?kind=placement");
    expect(
      screen.getByRole("heading", {
        name: fill(ja.Drill.intro.titleAgain, { count: 2 }),
      }),
    ).toBeInTheDocument();
  });
});

describe("the drill when a round cannot start", () => {
  it("says when there are too few cards, with the count the home view knows", async () => {
    serve({
      home: homeView({ kind: "not-enough", available: 3, streak: COUNT }),
      round: refusal(409, "ERR_NOT_ENOUGH_CARDS"),
    });
    await renderApp("/drill?kind=today");
    expect(
      screen.getByRole("heading", { name: ja.Drill.error.notEnoughTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.error.notEnough, { count: 3 })),
    ).toBeInTheDocument();
  });

  it("leaves the count out when the home view does not know it", async () => {
    serve({ round: refusal(409, "ERR_NOT_ENOUGH_CARDS") });
    await renderApp("/drill?kind=today");
    expect(
      screen.getByRole("heading", { name: ja.Drill.error.notEnoughTitle }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(fill(ja.Drill.error.notEnough, { count: 3 })),
    ).not.toBeInTheDocument();
  });

  it("offers a reload when the round could not be loaded", async () => {
    let rounds = 0;
    fakeApi((call) => {
      if (call.url === "/api/v1/home") return Response.json(READY);
      if (call.url !== "/api/v1/rounds") return undefined;
      rounds += 1;
      return rounds === 1
        ? Promise.reject(new TypeError("fetch failed"))
        : Response.json(ROUND);
    });
    await renderApp("/drill?kind=today");
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.error.reload }));
    await settle();
    await settle(16);
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("offers a reload when the home view could not be read, and starts after it", async () => {
    let homes = 0;
    const calls = fakeApi((call) => {
      if (call.url === "/api/v1/rounds") return Response.json(ROUND);
      if (call.url !== "/api/v1/home") return undefined;
      homes += 1;
      return homes === 1
        ? refusal(503, "ERR_CONTENT_UNREADABLE")
        : Response.json(READY);
    });
    await renderApp("/drill?kind=today");
    expect(posted(calls, "/api/v1/rounds")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.error.reload }));
    await settle();
    await settle(16);
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("calls an unreachable home view a network error", async () => {
    fakeApi(() => Promise.reject(new TypeError("fetch failed")));
    await renderApp("/drill?kind=today");
    expect(
      screen.getByRole("button", { name: ja.Drill.error.reload }),
    ).toBeInTheDocument();
  });
});

describe("the drill when answers cannot be saved", () => {
  it("shows a toast when an answer cannot be saved, and keeps going", async () => {
    serve({ answers: () => Promise.reject(new TypeError("fetch failed")) });
    await openRound("/drill?kind=today");
    press(" ");
    await settle(200);
    press("ArrowRight");
    await settle(400);
    expect(screen.getByText(ja.Drill.save.failed)).toBeInTheDocument();
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();
    await settle(4000);
    expect(screen.queryByText(ja.Drill.save.failed)).not.toBeInTheDocument();
  });

  it("counts only the answers still waiting when the round cannot be finished", async () => {
    let finishes = 0;
    serve({
      answers: () => Promise.reject(new TypeError("fetch failed")),
      finish: () => {
        finishes += 1;
        return finishes === 1
          ? new Response("down", { status: 503 })
          : Response.json(makeSummary({ roundId: "round-1" }));
      },
    });
    await openRound("/drill?kind=today");
    await grade("ArrowRight");
    await grade("ArrowRight");
    await settle(16);
    expect(
      screen.getByText(fill(ja.Drill.save.unsaved, { count: 2 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.save.resend }));
    await settle();
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
  });

  it("counts the round itself as unsaved when only the finish failed", async () => {
    serve({ finish: () => new Response("down", { status: 503 }) });
    await openRound("/drill?kind=today");
    await grade("ArrowRight");
    await grade("ArrowRight");
    await settle(16);
    expect(
      screen.getByText(fill(ja.Drill.save.unsaved, { count: 1 })),
    ).toBeInTheDocument();
  });
});
