import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_ANSWER_TEXT } from "@instant-composition/contracts";
import type { AnswerInput, RoundPayload } from "@instant-composition/web";

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
  renderApp,
  settle,
  type ApiCall,
  warmUp,
} from "./web-harness";
import { makeSummary } from "./web-summary-fixture";

// The drill in a typed round, mounted as the whole app at `/drill`: a field in
// place of the timer, Enter to turn the card over, the text typed over the
// model answer, the grade keys once the field is gone, and the text sent with
// the answer — against a spoken round, which keeps its timer and its flip.

const CAP = 600_000;
const ANSWERS = "/api/v1/rounds/round-1/answers";
const FINISH = "/api/v1/rounds/round-1/finish";

const TYPED: RoundPayload = {
  ...ROUND,
  answerMode: "typed",
  cards: {
    c1: drillCard("c1", { limitMs: CAP, paceMs: 9000 }),
    c2: drillCard("c2", { limitMs: CAP, paceMs: 9000 }),
  },
};

/** An API that deals `round` and takes every answer and the finish. */
function serve(round: RoundPayload = TYPED): ApiCall[] {
  return fakeApi((call) => {
    if (call.method === "GET" && call.url === "/api/v1/home")
      return Response.json(homeView({ kind: "ready", streak: COUNT }));
    if (call.method === "POST" && call.url === "/api/v1/rounds")
      return Response.json(round);
    if (call.method === "POST" && call.url === ANSWERS)
      return new Response(null, { status: 204 });
    if (call.method === "POST" && call.url === FINISH)
      return Response.json(makeSummary({ roundId: "round-1" }));
    return undefined;
  });
}

function sent(calls: readonly ApiCall[]): AnswerInput[] {
  return calls
    .filter((call) => call.method === "POST" && call.url === ANSWERS)
    .flatMap((call) => (call.body as { answers: AnswerInput[] }).answers);
}

function field(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name: ja.Drill.card.typed });
}

function type(text: string): void {
  fireEvent.change(field(), { target: { value: text } });
}

function enter(init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(field(), { key: "Enter", code: "Enter", ...init });
}

/** Opens `/drill` as a fresh load does, and starts the round from its start screen. */
async function openRound(): Promise<void> {
  await renderApp("/drill?kind=today");
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

describe("a typed round's front", () => {
  it("shows a focused field and no timer, and never runs out", async () => {
    const calls = serve();
    await openRound();
    expect(field()).toHaveFocus();
    expect(document.querySelector("[data-part=fill]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: ja.Drill.card.flip }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(fill(ja.Drill.announce.frontTyped, { ja: "prompt-c1" })),
    ).toBeInTheDocument();

    await settle(CAP + 60_000);
    expect(field()).toBeInTheDocument();
    expect(screen.queryByText(ja.Drill.card.timedOut)).not.toBeInTheDocument();
    expect(sent(calls)).toStrictEqual([]);
  });

  it("holds the field to the API's text cap", async () => {
    serve();
    await openRound();
    expect(field().maxLength).toBe(MAX_ANSWER_TEXT);
  });

  it("leaves Space and ? typed into the field to the field", async () => {
    serve();
    await openRound();
    fireEvent.keyDown(field(), { key: " ", code: "Space" });
    fireEvent.keyDown(field(), { key: "?", code: "Slash" });
    expect(field()).toBeInTheDocument();
    expect(screen.queryByText(ja.Drill.sheet.title)).not.toBeInTheDocument();
  });

  it("does not submit on the Enter that confirms an input method's conversion", async () => {
    serve();
    await openRound();
    type("I");
    enter({ isComposing: true });
    expect(field()).toBeInTheDocument();

    // Safari: the confirming Enter comes after compositionend, with isComposing false.
    fireEvent.compositionEnd(field());
    enter();
    expect(field()).toBeInTheDocument();
    fireEvent.keyUp(field(), { key: "Enter", code: "Enter" });

    enter();
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
  });

  it("keeps what was typed through a pause, and takes focus again on continue", async () => {
    serve();
    await openRound();
    type("Can we");
    fireEvent.keyDown(field(), { key: "Escape", code: "Escape" });
    expect(screen.getByText(ja.Drill.sheet.title)).toBeInTheDocument();
    press("Escape");
    await settle(16);
    expect(screen.queryByText(ja.Drill.sheet.title)).not.toBeInTheDocument();
    expect(field()).toHaveValue("Can we");
    expect(field()).toHaveFocus();
  });
});

describe("a typed round's back", () => {
  it("turns over on Enter with the text beside the model answer, and grades by key once the field is gone", async () => {
    const calls = serve();
    await openRound();
    await settle(2000);
    type("  Can we move the meeting?  ");
    enter();
    expect(screen.getByText(ja.Drill.card.yours)).toBeInTheDocument();
    expect(screen.getByText("Can we move the meeting?")).toBeInTheDocument();
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);

    await settle(200);
    press("ArrowRight");
    await settle(400);
    expect(sent(calls)).toStrictEqual([
      expect.objectContaining({
        id: "round-1:f:c1",
        result: "ok",
        text: "Can we move the meeting?",
      }),
    ]);
    const [answer] = sent(calls);
    expect(answer?.elapsedMs).toBeGreaterThanOrEqual(2000);
    expect(answer?.elapsedMs).toBeLessThan(2100);
  });

  it("turns over from the button, and grades by button", async () => {
    const calls = serve();
    await openRound();
    type("Hi.");
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.card.submit }));
    expect(screen.getByText("Hi.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ja.Drill.card.notSaid }));
    await settle(400);
    expect(sent(calls)).toStrictEqual([
      expect.objectContaining({ result: "ng", text: "Hi." }),
    ]);
  });

  it("turns over on an empty field with no text shown or sent", async () => {
    const calls = serve();
    await openRound();
    enter();
    expect(screen.getByText("answer-c1")).toBeInTheDocument();
    expect(screen.queryByText(ja.Drill.card.yours)).not.toBeInTheDocument();
    await settle(200);
    press("ArrowLeft");
    await settle(400);
    const [answer] = sent(calls);
    expect(answer?.result).toBe("ng");
    expect(answer).not.toHaveProperty("text");
  });

  it("finishes with every answer's text", async () => {
    const calls = serve();
    await openRound();
    for (const text of ["One.", "Two."]) {
      type(text);
      enter();
      await settle(200);
      press("ArrowRight");
      await settle(400);
      await settle(16);
    }
    const finish = calls.find((call) => call.url === FINISH)?.body as {
      answers: AnswerInput[];
    };
    expect(finish.answers.map((answer) => answer.text)).toStrictEqual(["One.", "Two."]);
  });
});

describe("a typed round resumed", () => {
  it("reopens on the back of the card submitted before the page went away, with its text", async () => {
    serve();
    await openRound();
    type("Can we move it?");
    enter();

    cleanup();
    const calls = serve();
    await renderApp("/drill?kind=today");
    expect(screen.getByText("Can we move it?")).toBeInTheDocument();
    expect(screen.getByText("answer-c1")).toBeInTheDocument();

    await settle(200);
    press("ArrowRight");
    await settle(400);
    await settle(16);
    expect(sent(calls)).toStrictEqual([
      expect.objectContaining({ id: "round-1:f:c1", text: "Can we move it?" }),
    ]);
    expect(screen.getByText("prompt-c2")).toBeInTheDocument();

    // Graded, the submission is forgotten: the same card dealt again opens on its front.
    cleanup();
    serve();
    await renderApp("/drill?kind=today");
    press("Enter");
    await settle(16);
    expect(field()).toBeInTheDocument();
  });
});

describe("a spoken round beside it", () => {
  it("keeps its timer and flip, has no field, and sends no text", async () => {
    const calls = serve(ROUND);
    await openRound();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelector("[data-part=fill]")).not.toBeNull();
    press(" ");
    await settle(200);
    press("ArrowRight");
    await settle(400);
    const [answer] = sent(calls);
    expect(answer?.result).toBe("ok");
    expect(answer).not.toHaveProperty("text");
  });
});
