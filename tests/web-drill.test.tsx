import { act, cleanup, fireEvent, screen } from "@testing-library/react";
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
  landmarks,
  navigations,
  press,
  refusal,
  renderApp,
  settle,
  type ApiCall,
  warmUp,
} from "./web-harness";
import { makeSummary } from "./web-summary-fixture";

// The web client's drill, mounted as the whole app at `/drill` over a stand-in
// API: a round run by keys and by taps to its summary, the pause dialog, the placement
// intro, and each way a round cannot start or cannot be saved.

const READY = homeView({ kind: "ready", streak: COUNT });
const ANSWERS = "/api/v1/rounds/round-1/answers";
const FINISH = "/api/v1/rounds/round-1/finish";

interface Serve {
  readonly home?: HomeView;
  /** The home view once a round has been asked for, when it differs from `home`. */
  readonly homeLater?: HomeView;
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
      const later = rounds > 0 ? options.homeLater : undefined;
      return Response.json(later ?? options.home ?? READY);
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
    grade: "good",
    timedOut: false,
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
async function grade(key: "j" | "k" | "2" | "ArrowLeft" | "ArrowRight"): Promise<void> {
  press(" ");
  await settle(200);
  press(key);
  await settle(400);
  await settle(16);
}

/** Each answer sent one at a time, as its id, grade and whether it timed out. */
function sentAnswers(calls: readonly ApiCall[]): [string, string, boolean][] {
  return (posted(calls, ANSWERS) as { answers: AnswerInput[] }[]).flatMap((body) =>
    body.answers.map((a): [string, string, boolean] => [a.id, a.grade, a.timedOut]),
  );
}

/** The grade button for `grade`, found by its name ahead of any interval. */
function gradeButton(grade: "again" | "hard" | "good"): HTMLElement {
  return screen.getByRole("button", {
    name: (name) => name.startsWith(ja.Drill.grade[grade]),
  });
}

/** The three grade buttons' names, with their intervals when shown. */
function trio(): (string | null)[] {
  return (["again", "hard", "good"] as const).map((grade) =>
    gradeButton(grade).getAttribute("aria-label"),
  );
}

/** A round of `count` cards, `c1` onwards. */
function roundOf(count: number, overrides: Partial<RoundPayload> = {}): RoundPayload {
  const deck = Array.from({ length: count }, (_, index) => `c${String(index + 1)}`);
  return {
    ...ROUND,
    deck,
    cards: Object.fromEntries(deck.map((id) => [id, drillCard(id)])),
    total: count,
    ...overrides,
  };
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
  it("runs a round by keys, asks a △ again, and finishes with nothing left unrecorded", async () => {
    const calls = serve();
    await openRound("/drill?kind=today");
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.announce.front, { ja: "prompt-c1", seconds: 7 })),
    ).toBeInTheDocument();

    await settle(2000);
    press(" ");
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    press("j");
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    await settle(200);
    press("k");
    expect(
      screen.getByText(ja.Drill.grade.good, { selector: "[aria-live]" }),
    ).toBeInTheDocument();
    await settle(400);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    // React flushes an update when its act() ends, so the frame that starts
    // the clock and the ticks after it are awaited separately.
    await settle(16);
    await settle(7100);
    expect(
      screen.getByText(ja.Drill.card.timedOut, { selector: "span" }),
    ).toBeInTheDocument();
    await settle(200);
    press("2");
    await settle(400);
    await settle(16);
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    press(" ");
    await settle(200);
    press("k");
    await settle(400);
    expect(screen.getByRole("heading", { name: ja.Summary.title.today })).toHaveFocus();

    expect(posted(calls, "/api/v1/rounds")).toHaveLength(1);
    const [start] = posted(calls, "/api/v1/rounds") as {
      roundId: string;
      kind: string;
    }[];
    expect(start?.kind).toBe("today");
    expect(start?.roundId).toMatch(/^[\w-]{1,64}$/u);
    expect(sentAnswers(calls)).toStrictEqual([
      ["round-1:f:c1", "good", false],
      ["round-1:f:c2", "hard", true],
      ["round-1:r1:c2", "good", false],
    ]);
    expect(
      (posted(calls, ANSWERS) as { answers: Record<string, unknown>[] }[]).some(
        (body) => body.answers.some((a) => "result" in a),
      ),
    ).toBe(false);
    expect(posted(calls, FINISH)).toStrictEqual([{ answers: [] }]);
  });

  it("shows each grade's dealt interval on a back flipped by hand, and grades ○ on → (example 1)", async () => {
    const calls = serve({
      round: {
        ...ROUND,
        cards: {
          c1: drillCard("c1", { intervals: { again: 1, hard: 3, good: 8 } }),
          c2: drillCard("c2"),
        },
      },
    });
    await openRound("/drill?kind=today");
    press(" ");
    await settle(200);
    expect(trio()).toStrictEqual([
      `${ja.Drill.grade.again} ${ja.Drill.grade.tomorrow}`,
      `${ja.Drill.grade.hard} ${fill(ja.Drill.grade.days, { count: 3 })}`,
      `${ja.Drill.grade.good} ${fill(ja.Drill.grade.days, { count: 8 })}`,
    ]);
    expect(gradeButton("again")).toHaveTextContent(ja.Drill.grade.tomorrow);
    expect(gradeButton("good")).toHaveTextContent(
      fill(ja.Drill.grade.days, { count: 8 }),
    );
    press("ArrowRight");
    await settle(400);
    expect(sentAnswers(calls)).toStrictEqual([["round-1:f:c1", "good", false]]);
  });

  it("brings × on the third of ten back four cards later, with 「もう一度」 and no intervals, until ○ (example 2)", async () => {
    const calls = serve({ round: roundOf(10) });
    await openRound("/drill?kind=today");
    await grade("k");
    await grade("k");
    expect(screen.getByText("prompt-c3")).toBeInTheDocument();
    await grade("j");
    expect(
      screen.getByText(fill(ja.Drill.card.reAsks, { count: 1 })),
    ).toBeInTheDocument();
    for (const card of ["c4", "c5", "c6", "c7"]) {
      expect(screen.getByText(`prompt-${card}`)).toBeInTheDocument();
      expect(screen.queryByText(ja.Drill.card.again)).not.toBeInTheDocument();
      await grade("k");
    }
    expect(screen.getByText("prompt-c3")).toBeInTheDocument();
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    expect(
      screen.getByText(
        fill(ja.Drill.announce.againFront, { ja: "prompt-c3", seconds: 7 }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.card.progress, { current: 7, total: 10 })),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(fill(ja.Drill.card.reAsks, { count: 1 })),
    ).not.toBeInTheDocument();
    press(" ");
    await settle(200);
    expect(trio()).toStrictEqual([
      ja.Drill.grade.again,
      ja.Drill.grade.hard,
      ja.Drill.grade.good,
    ]);
    press("k");
    await settle(400);
    await settle(16);
    expect(screen.getByText("prompt-c8")).toBeInTheDocument();
    expect(sentAnswers(calls).filter(([id]) => id.endsWith(":c3"))).toStrictEqual([
      ["round-1:f:c3", "again", false],
      ["round-1:r1:c3", "good", false],
    ]);
  });

  it("offers the trio on a timed-out back, ignores Space and Enter, and grades △ on 2 as timed out (example 3)", async () => {
    const calls = serve();
    await openRound("/drill?kind=today");
    await settle(7100);
    expect(
      screen.getByText(ja.Drill.card.timedOut, { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(ja.Drill.announce.timeout, { selector: "[aria-live]" }),
    ).toBeInTheDocument();
    expect(trio()).toHaveLength(3);
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).not.toContain("次へ");
    await settle(200);
    press(" ");
    press("Enter");
    await settle(400);
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    expect(sentAnswers(calls)).toStrictEqual([]);
    press("2");
    await settle(16);
    expect(
      screen.getByText(ja.Drill.grade.hard, { selector: "[aria-live]" }),
    ).toBeInTheDocument();
    await settle(400);
    expect(sentAnswers(calls)).toStrictEqual([["round-1:f:c1", "hard", true]]);
  });

  it("sends the unrecorded answers of a round of 25 cards and 40 answers in batches of at most 60, and shows the summary (example 4)", async () => {
    const calls = serve({
      round: roundOf(25),
      answers: () => Promise.reject(new TypeError("fetch failed")),
    });
    await openRound("/drill?kind=today");
    const missed = new Set<string>();
    for (let shown = 0; shown < 60; shown += 1) {
      if (screen.queryByRole("heading", { name: ja.Summary.title.today }) !== null)
        break;
      const prompt = screen.getByText(/^prompt-c\d+$/u).textContent;
      const firstPass = screen.queryByText(ja.Drill.card.again) === null;
      // The first 15 cards are missed once, and said on their re-ask.
      const miss = firstPass && Number(prompt.replace("prompt-c", "")) <= 15;
      if (miss) missed.add(prompt);
      await grade(miss ? "j" : "k");
    }
    await settle(16);
    expect(missed.size).toBe(15);
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    const finishes = posted(calls, FINISH) as { answers: AnswerInput[] }[];
    const recorded = posted(calls, ANSWERS) as { answers: AnswerInput[] }[];
    expect([...recorded, ...finishes].every((body) => body.answers.length <= 60)).toBe(
      true,
    );
    expect(finishes).toHaveLength(1);
    expect(finishes[0]?.answers).toHaveLength(40);
    expect(new Set(finishes[0]?.answers.map((a) => a.id)).size).toBe(40);
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

describe("the drill's grade keys", () => {
  const CHOSEN = homeView(
    { kind: "ready", streak: COUNT },
    { gradeKeys: { ok: "KeyL", ng: "Digit1", hard: "KeyS" } },
  );

  /** The text of the grade button for `grade`: its name, its interval and its key hint. */
  function hintOf(grade: "again" | "hard" | "good"): string | null {
    return gradeButton(grade).textContent;
  }

  it("grades with the three keys the learner chose, and shows them on the buttons", async () => {
    const calls = serve({ home: CHOSEN, round: roundOf(3) });
    await openRound("/drill?kind=today");
    press(" ");
    await settle(200);
    expect(hintOf("again")).toBe(`${ja.Drill.grade.again}${ja.Drill.grade.tomorrow}1`);
    expect(hintOf("hard")).toBe(
      `${ja.Drill.grade.hard}${fill(ja.Drill.grade.days, { count: 2 })}S`,
    );
    expect(hintOf("good")).toBe(
      `${ja.Drill.grade.good}${fill(ja.Drill.grade.days, { count: 3 })}L`,
    );

    press("l", "KeyL");
    await settle(400);
    await settle(16);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();
    press(" ");
    await settle(200);
    press("s", "KeyS");
    await settle(400);
    await settle(16);
    press(" ");
    await settle(200);
    press("!", "Digit1");
    await settle(400);

    expect(sentAnswers(calls).map(([, grade]) => grade)).toStrictEqual([
      "good",
      "hard",
      "again",
    ]);
  });

  it("puts the trio under the back, × on the left, △ in the middle and ○ on the right", async () => {
    serve({ home: CHOSEN });
    await openRound("/drill?kind=today");
    press(" ");
    await settle(200);
    const card = document.querySelector("[data-part=card]");
    const again = gradeButton("again");
    const hard = gradeButton("hard");
    const good = gradeButton("good");
    expect(card?.compareDocumentPosition(again)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(again.compareDocumentPosition(hard)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(hard.compareDocumentPosition(good)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("ignores the default keys — → ←, 1 2 3, K/F and J/D — once another trio is chosen", async () => {
    const calls = serve({
      home: homeView(
        { kind: "ready", streak: COUNT },
        { gradeKeys: { ok: "KeyL", ng: "KeyA", hard: "KeyS" } },
      ),
    });
    await openRound("/drill?kind=today");
    press(" ");
    await settle(200);
    for (const [key, code] of [
      ["ArrowRight", "ArrowRight"],
      ["ArrowLeft", "ArrowLeft"],
      ["1", "Digit1"],
      ["2", "Digit2"],
      ["3", "Digit3"],
      ["k", "KeyK"],
      ["f", "KeyF"],
      ["j", "KeyJ"],
      ["d", "KeyD"],
    ] as const) {
      press(key, code);
    }
    await settle(400);
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    expect(posted(calls, ANSWERS)).toStrictEqual([]);
  });

  it("shows ←, 2 and → on the buttons while the learner keeps the default", async () => {
    serve();
    await openRound("/drill?kind=today");
    press(" ");
    await settle(200);
    expect(hintOf("again")?.endsWith("←")).toBe(true);
    expect(hintOf("hard")?.endsWith("2")).toBe(true);
    expect(hintOf("good")?.endsWith("→")).toBe(true);
  });

  it("grades × on 1 and ○ on 3 while the learner keeps the default", async () => {
    const calls = serve();
    await openRound("/drill?kind=today");
    await grade("k");
    press(" ");
    await settle(200);
    press("1", "Digit1");
    await settle(400);
    expect(sentAnswers(calls).map(([, grade]) => grade)).toStrictEqual([
      "good",
      "again",
    ]);
  });
});

describe("the drill, a round run by taps", () => {
  /** A button whose name starts with `label`, ahead of its key hint. */
  function tap(label: string): void {
    fireEvent.click(
      screen.getByRole("button", { name: (name) => name.startsWith(label) }),
    );
  }

  it("flips on the card and the flip button, and grades by button, a timed-out back included", async () => {
    const calls = serve();
    await renderApp("/drill?kind=today");
    tap(ja.Drill.ready.start);
    await settle(16);

    fireEvent.click(screen.getByText("prompt-c1"));
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    await settle(200);
    tap(ja.Drill.grade.good);
    await settle(400);
    await settle(16);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    await settle(7100);
    expect(
      screen.getByText(ja.Drill.card.timedOut, { selector: "span" }),
    ).toBeInTheDocument();
    tap(ja.Drill.grade.again);
    await settle(400);
    await settle(16);
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();

    tap(ja.Drill.card.flip);
    expect(screen.getByText("answer-c2")).toBeInTheDocument();
    await settle(200);
    tap(ja.Drill.grade.good);
    await settle(400);
    expect(screen.getByRole("heading", { name: ja.Summary.title.today })).toHaveFocus();

    expect(sentAnswers(calls)).toStrictEqual([
      ["round-1:f:c1", "good", false],
      ["round-1:f:c2", "again", true],
      ["round-1:r1:c2", "good", false],
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
    expect(screen.queryByText(ja.Drill.card.timedOut, { selector: "span" })).toBeNull();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    await settle(23_000);
    expect(
      screen.getByText(ja.Drill.card.timedOut, { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("pauses from the top strip's pause button", async () => {
    serve();
    await openRound("/drill?kind=today");
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.card.pause }));
    expect(
      screen.getByRole("dialog", { name: ja.Drill.dialog.title }),
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

  it("drops the re-asks a resumed round had waiting, going straight to the summary", async () => {
    const missed = (cardId: string): RoundPayload["answered"][number] => ({
      ...firstPassOf(cardId),
      result: "ng",
      grade: "again",
    });
    const calls = serve({
      round: { ...ROUND, offset: 8, total: 10, answered: [missed("c1"), missed("c2")] },
    });
    await renderApp("/drill?kind=today");
    await settle(16);
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    expect(timerBar()).toBeNull();
    expect(posted(calls, FINISH)).toStrictEqual([{ answers: [] }]);
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

describe("the drill's pause dialog", () => {
  it("pauses on Escape with the card hidden, and continues on Escape", async () => {
    serve();
    await openRound("/drill?kind=today");
    press("Escape");
    expect(
      screen.getByRole("dialog", { name: ja.Drill.dialog.title }),
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
      screen.getByText(fill(ja.Drill.dialog.hint, { hour: 4, position: 1 })),
    ).toBeInTheDocument();
  });

  it("goes home on its stop button without asking again", async () => {
    serve();
    await openRound("/drill?kind=today");
    press("Escape");
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.dialog.quit }));
    await settle();
    expect(where()).toBe("/");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pauses when the page is hidden", async () => {
    serve();
    await openRound("/drill?kind=today");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(
      screen.getByRole("dialog", { name: ja.Drill.dialog.title }),
    ).toBeInTheDocument();
  });

  it("names the next first pass in the pause hint during a re-ask, never past the round", async () => {
    serve({ round: roundOf(3) });
    await openRound("/drill?kind=today");
    await grade("j");
    await grade("j");
    await grade("k");
    // c1 is back after c2 and c3; c2 waits behind it.
    expect(screen.getByText(ja.Drill.card.again)).toBeInTheDocument();
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.card.progress, { current: 3, total: 3 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.card.reAsks, { count: 1 })),
    ).toBeInTheDocument();
    press("Escape");
    expect(
      screen.getByText(fill(ja.Drill.dialog.hint, { hour: 4, position: 3 })),
    ).toBeInTheDocument();
  });

  it("lists the three grade keys", async () => {
    serve();
    await openRound("/drill?kind=today");
    press("Escape");
    const legend = screen.getByRole("dialog").querySelector("dl");
    expect(legend).toHaveTextContent(ja.Drill.grade.again);
    expect(legend).toHaveTextContent(ja.Drill.grade.hard);
    expect(legend).toHaveTextContent(ja.Drill.grade.good);
  });
});

describe("the drill's focus layout", () => {
  function leaveDialog(): HTMLElement | null {
    return screen.queryByRole("dialog", { name: ja.Drill.leave.title });
  }

  function back(): void {
    act(() => {
      window.history.back();
    });
  }

  /** Starts today's round from home, as a press does, so Back has home to go to. */
  async function startFromHome(): Promise<void> {
    await renderApp("/");
    fireEvent.click(screen.getByRole("button", { name: ja.Home.today.start }));
    await settle();
    await settle(16);
  }

  it("shows no navigation on the start screen or mid-round, only main", async () => {
    serve();
    await renderApp("/drill?kind=today");
    expect(navigations()).toStrictEqual([]);
    expect(landmarks()).toStrictEqual(["main"]);
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    expect(navigations()).toStrictEqual([]);
    expect(landmarks()).toStrictEqual(["main"]);
  });

  it("pauses mid-round on the strip's ✕ at the top left", async () => {
    serve();
    await openRound("/drill?kind=today");
    const close = screen.getByRole("button", { name: ja.Drill.card.pause });
    expect(close.closest("[data-part=focus-strip]")).not.toBeNull();
    fireEvent.click(close);
    await settle(16);
    expect(
      screen.getByRole("dialog", { name: ja.Drill.dialog.title }),
    ).toBeInTheDocument();
  });

  it("leaves the start screen at once on ✕, with nothing to lose", async () => {
    serve();
    await renderApp("/drill?kind=today");
    fireEvent.click(screen.getByRole("link", { name: ja.Nav.close }));
    await settle();
    expect(where()).toBe("/");
    expect(leaveDialog()).toBeNull();
  });

  it("pauses the timer mid-round and asks before Back leaves, staying on continue", async () => {
    serve();
    await startFromHome();
    await settle(2000);
    back();
    await settle();
    await settle(16);
    expect(leaveDialog()).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.dialog.hint, { hour: 4, position: 1 })),
    ).toBeInTheDocument();
    expect(screen.queryByText("prompt-c1")).not.toBeInTheDocument();

    // Well past the card's 7 s while the dialog is open, and still not timed out.
    await settle(10_000);
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.dialog.continue }));
    await settle();
    await settle(16);
    expect(leaveDialog()).toBeNull();
    expect(where()).toBe("/drill?kind=today");
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
    await settle(4900);
    expect(screen.queryByText(ja.Drill.card.timedOut, { selector: "span" })).toBeNull();
    await settle(200);
    expect(
      screen.getByText(ja.Drill.card.timedOut, { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("stays on Escape, as continue does", async () => {
    serve();
    await startFromHome();
    back();
    await settle();
    await settle(16);
    expect(leaveDialog()).toBeInTheDocument();
    press("Escape");
    await settle();
    await settle(16);
    expect(leaveDialog()).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(where()).toBe("/drill?kind=today");
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();
  });

  it("goes home on leave, and home then resumes the round at the same card", async () => {
    const calls = serve({
      homeLater: homeView({
        kind: "in-progress",
        portion: "today",
        progress: 1,
        target: 2,
        resumeKind: "today",
        streak: COUNT,
      }),
      next: { ...ROUND, answered: [firstPassOf("c1")] },
    });
    await startFromHome();
    await grade("k");
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    back();
    await settle();
    await settle(16);
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.leave.go }));
    await settle();
    await settle(16);
    expect(where()).toBe("/");
    expect(leaveDialog()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: ja.Home.progress.resume }));
    await settle();
    await settle(16);
    expect(where()).toBe("/drill?kind=today");
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.card.progress, { current: 2, total: 2 })),
    ).toBeInTheDocument();
    expect(posted(calls, FINISH)).toHaveLength(0);
  });

  it("asks before Back leaves a round, and stays where it was on continue", async () => {
    serve();
    await renderApp("/");
    fireEvent.click(screen.getByRole("button", { name: ja.Home.today.start }));
    await settle();
    await settle(16);
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();

    act(() => {
      window.history.back();
    });
    await settle();
    await settle(16);
    expect(leaveDialog()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.dialog.continue }));
    await settle();
    await settle(16);
    expect(where()).toBe("/drill?kind=today");
    expect(screen.getByText("prompt-c1")).toBeInTheDocument();

    act(() => {
      window.history.back();
    });
    await settle();
    await settle(16);
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.leave.go }));
    await settle();
    await settle(16);
    expect(where()).toBe("/");
    expect(leaveDialog()).toBeNull();
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
    press("k");
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
    await grade("k");
    await grade("k");
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
    await grade("k");
    await grade("k");
    await settle(16);
    expect(
      screen.getByText(fill(ja.Drill.save.unsaved, { count: 1 })),
    ).toBeInTheDocument();
  });
});

describe("the drill after a reload", () => {
  /** A send the server never answers before the page goes away. */
  const inFlight = (): Promise<Response> => new Promise(() => undefined);

  /** Leaves the page as F5 does: the tab's storage stays, everything else starts over. */
  async function reload(
    options: Serve,
    path = "/drill?kind=today",
  ): Promise<ApiCall[]> {
    cleanup();
    const calls = serve(options);
    await renderApp(path);
    return calls;
  }

  function ids(body: unknown): string[] {
    return (body as { answers: AnswerInput[] }).answers.map((answer) => answer.id);
  }

  it("resumes past an answer still on its way, and sends it again under its own id", async () => {
    serve({ answers: inFlight });
    await openRound("/drill?kind=today");
    await grade("k");
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    const calls = await reload({});
    expect(
      screen.getByText(
        fill(ja.Drill.ready.resume, { position: 2, total: ROUND.total }),
      ),
    ).toBeInTheDocument();
    expect(posted(calls, ANSWERS).map(ids)).toStrictEqual([["round-1:f:c1"]]);
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    await grade("k");
    await settle(16);
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    expect(posted(calls, ANSWERS).map(ids)).toStrictEqual([
      ["round-1:f:c1"],
      ["round-1:f:c2"],
    ]);
    // Both are recorded by then, so the finish carries nothing.
    expect(posted(calls, FINISH).map(ids)).toStrictEqual([[]]);
  });

  it("stores a graded answer in the same moment the grade is given", async () => {
    serve({ answers: inFlight });
    await openRound("/drill?kind=today");
    press(" ");
    await settle(200);
    // Inside act() React has not rendered or run an effect yet: the page could go now.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", cancelable: true }),
      );
      expect(
        (
          JSON.parse(
            sessionStorage.getItem("drill-answers:round-1") ?? "[]",
          ) as AnswerInput[]
        ).map((answer) => answer.id),
      ).toStrictEqual(["round-1:f:c1"]);
    });
  });

  it("stores nothing when the time runs out, and the grade given then as timed out", async () => {
    serve({ answers: inFlight });
    await openRound("/drill?kind=today");
    await settle(7100);
    expect(
      screen.getByText(ja.Drill.card.timedOut, { selector: "span" }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem("drill-answers:round-1")).toBeNull();
    await settle(200);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "1", code: "Digit1", cancelable: true }),
      );
      expect(
        JSON.parse(sessionStorage.getItem("drill-answers:round-1") ?? "[]"),
      ).toMatchObject([{ id: "round-1:f:c1", grade: "again", timedOut: true }]);
    });
  });

  it("finishes with an answer the reloaded page could not send either", async () => {
    const offline = (): Promise<Response> =>
      Promise.reject(new TypeError("fetch failed"));
    serve({ answers: offline });
    await openRound("/drill?kind=today");
    await grade("k");

    const calls = await reload({ answers: offline });
    press("Enter");
    await settle(16);
    await grade("k");
    await settle(16);
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    expect(posted(calls, FINISH).map(ids)).toStrictEqual([
      ["round-1:f:c1", "round-1:f:c2"],
    ]);
    expect(sessionStorage.getItem("drill-answers:round-1")).toBeNull();
  });

  it("counts an answer once when the server took it just before the reload", async () => {
    serve({ answers: inFlight });
    await openRound("/drill?kind=today");
    await grade("k");

    const calls = await reload({ round: { ...ROUND, answered: [firstPassOf("c1")] } });
    expect(
      screen.getByText(
        fill(ja.Drill.ready.resume, { position: 2, total: ROUND.total }),
      ),
    ).toBeInTheDocument();
    press("Enter");
    await settle(16);
    await grade("k");
    await settle(16);
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    expect(posted(calls, FINISH).map(ids)).toStrictEqual([[]]);
  });

  it("finishes at once when the reload came after the last answer", async () => {
    serve({ answers: inFlight, finish: inFlight });
    await openRound("/drill?kind=today");
    await grade("k");
    await grade("k");

    const calls = await reload({});
    await settle(16);
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    expect(posted(calls, ANSWERS).flatMap(ids)).toStrictEqual([
      "round-1:f:c1",
      "round-1:f:c2",
    ]);
    expect(posted(calls, FINISH).map(ids)).toStrictEqual([[]]);
    expect(sessionStorage.getItem("drill-answers:round-1")).toBeNull();
  });

  it("drops the re-ask an unsaved miss had waiting, and sends the miss itself", async () => {
    serve({ answers: inFlight });
    await openRound("/drill?kind=today");
    await grade("j");

    const calls = await reload({});
    press("Enter");
    await settle(16);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();
    await grade("ArrowRight");
    await settle(16);
    expect(
      screen.getByRole("heading", { name: ja.Summary.title.today }),
    ).toBeInTheDocument();
    expect(screen.queryByText(ja.Drill.card.again)).not.toBeInTheDocument();
    expect(sentAnswers(calls)).toStrictEqual([
      ["round-1:f:c1", "again", false],
      ["round-1:f:c2", "good", false],
    ]);
  });

  it("leaves an unsaved answer of another round to that round", async () => {
    sessionStorage.setItem(
      "drill-answers:round-1",
      JSON.stringify([
        {
          id: "round-0:f:c1",
          roundId: "round-0",
          cardId: "c1",
          pass: "first",
          result: "ok",
          elapsedMs: 900,
          answeredAt: Date.UTC(2026, 8, 22, 3, 0),
        },
      ]),
    );
    serve();
    await renderApp("/drill?kind=today");
    expect(
      screen.getByText(
        fill(ja.Drill.ready.resume, { position: 1, total: ROUND.total }),
      ),
    ).toBeInTheDocument();
  });
});
