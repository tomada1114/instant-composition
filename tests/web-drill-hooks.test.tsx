import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAnswerQueue,
  drillReducer,
  feedbackMs,
  initDrill,
  useAnswerQueue,
  useQueuedDrill,
  useDrillClock,
  useDrillKeys,
  useRoundFinish,
  type AnswerInput,
  type DrillEvent,
  type DrillState,
} from "@instant-composition/web";
import { fakeTimers } from "./web-harness";

const LIMIT = 7000;
const DEFAULT_KEYS = { ok: "ArrowRight", ng: "ArrowLeft", hard: "Digit2" };

function fresh(): DrillState {
  return initDrill({
    roundId: "r",
    deck: ["c1", "c2"],
    limits: { c1: LIMIT, c2: LIMIT },
    fastThresholds: { c1: 3500, c2: 3500 },
    isNew: {},
    answered: [],
    retries: true,
    intro: false,
  });
}

/** The round `r`, as far as its answer queue reads it. */
const ROUND_R = { id: "r", deck: ["c1", "c2"], answered: [] };

function answer(cardId: string): AnswerInput {
  return {
    id: `r:f:${cardId}`,
    roundId: "r",
    cardId,
    pass: "first",
    grade: "good",
    timedOut: false,
    elapsedMs: 900,
  };
}

beforeEach(fakeTimers);

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

/** Runs the clock hook over a live reducer, as the session does. */
function useClockedDrill() {
  const [state, dispatch] = useReducer(drillReducer, undefined, fresh);
  useDrillClock(state, dispatch);
  return { state, dispatch };
}

describe("feedbackMs", () => {
  it("holds a fast ○ or △ longest, a ○ or △ shorter, and × shortest, all within 320 ms", () => {
    expect(feedbackMs({ grade: "good", fast: true })).toBe(320);
    expect(feedbackMs({ grade: "hard", fast: true })).toBe(320);
    expect(feedbackMs({ grade: "good", fast: false })).toBe(240);
    expect(feedbackMs({ grade: "hard", fast: false })).toBe(240);
    expect(feedbackMs({ grade: "again", fast: false })).toBe(160);
  });
});

describe("useDrillClock", () => {
  it("starts the front's clock on the next frame and times it out at the limit", () => {
    const { result } = renderHook(useClockedDrill);
    expect(result.current.state.phase).toMatchObject({ runningSince: null });

    act(() => void vi.advanceTimersToNextFrame());
    expect(result.current.state.phase).toMatchObject({ kind: "front" });
    expect(result.current.state.phase).not.toMatchObject({ runningSince: null });

    act(() => void vi.advanceTimersByTime(LIMIT + 100));
    expect(result.current.state.phase).toMatchObject({ kind: "back", mode: "timeout" });
  });

  it("stops ticking while paused", () => {
    const { result } = renderHook(useClockedDrill);
    act(() => void vi.advanceTimersToNextFrame());
    act(() => result.current.dispatch({ type: "pause", at: performance.now() }));
    act(() => void vi.advanceTimersByTime(LIMIT * 3));
    expect(result.current.state.phase.kind).toBe("front");
  });

  it("moves past the feedback after its duration", () => {
    const { result } = renderHook(useClockedDrill);
    act(() => void vi.advanceTimersToNextFrame());
    act(() => void vi.advanceTimersByTime(4000));
    act(() => result.current.dispatch({ type: "flip", at: performance.now() }));
    act(() =>
      result.current.dispatch({
        type: "grade",
        grade: "again",
        at: performance.now(),
        wall: Date.now(),
        key: false,
      }),
    );
    expect(result.current.state.phase.kind).toBe("feedback");
    act(() => void vi.advanceTimersByTime(160));
    expect(result.current.state.card?.cardId).toBe("c2");

    act(() => void vi.advanceTimersToNextFrame());
    act(() => void vi.advanceTimersByTime(LIMIT + 100));
    expect(result.current.state.phase).toMatchObject({ kind: "back", mode: "timeout" });
  });
});

describe("useDrillKeys", () => {
  it("hands a mapped key to the handler and stops its default", () => {
    const onAction = vi.fn();
    renderHook(() => useDrillKeys(fresh(), DEFAULT_KEYS, onAction));
    const event = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    window.dispatchEvent(event);
    expect(onAction).toHaveBeenCalledWith({ type: "flip" });
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ["a held key", { key: " ", repeat: true }],
    ["a key with a modifier", { key: " ", metaKey: true }],
    ["a key with no meaning here", { key: "x" }],
  ])("ignores %s", (_, init) => {
    const onAction = vi.fn();
    renderHook(() => useDrillKeys(fresh(), DEFAULT_KEYS, onAction));
    window.dispatchEvent(new KeyboardEvent("keydown", init));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("grades a flipped back by the code of the key the learner chose, and follows a new choice", () => {
    const onAction = vi.fn();
    const flipped = drillReducer(drillReducer(fresh(), { type: "shown", at: 0 }), {
      type: "flip",
      at: 1000,
    });
    const { rerender } = renderHook(
      ({ ok }: { ok: string }) =>
        useDrillKeys(flipped, { ok, ng: "KeyA", hard: "KeyS" }, onAction),
      { initialProps: { ok: "KeyL" } },
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK" }));
    rerender({ ok: "KeyK" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL" }));
    expect(onAction.mock.calls).toStrictEqual([
      [{ type: "grade", grade: "good" }],
      [{ type: "grade", grade: "good" }],
    ]);
  });

  it("pauses when the page is hidden, and does nothing when it shows again", () => {
    const onAction = vi.fn();
    renderHook(() => useDrillKeys(fresh(), DEFAULT_KEYS, onAction));
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onAction.mock.calls).toStrictEqual([[{ type: "hide" }]]);
  });
});

describe("useQueuedDrill", () => {
  /** Shows, flips and grades the current card ○, as one burst of events. */
  function gradeOk(dispatch: (event: DrillEvent) => void, at: number): void {
    dispatch({ type: "shown", at });
    dispatch({ type: "flip", at: at + 1000 });
    dispatch({
      type: "grade",
      grade: "good",
      at: at + 2000,
      wall: Date.now(),
      key: false,
    });
  }

  function stored(): string[] {
    return (
      JSON.parse(sessionStorage.getItem("drill-answers:r") ?? "[]") as AnswerInput[]
    ).map((a) => a.id);
  }

  it("stores an answer before React renders, delivers it once, and reports a failed save", async () => {
    let down = true;
    const delivered: string[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      if (!down) delivered.push(init.body as string);
      return Promise.resolve(new Response(null, { status: down ? 503 : 204 }));
    });
    const onFailure = vi.fn();
    const { result } = renderHook(() =>
      useQueuedDrill(useAnswerQueue(ROUND_R).queue, fresh, onFailure),
    );

    act(() => {
      gradeOk(result.current[1], 0);
      expect(stored()).toStrictEqual(["r:f:c1"]);
      // Graded already: the reducer ignores a second grade, so nothing is queued twice.
      result.current[1]({
        type: "grade",
        grade: "again",
        at: 2100,
        wall: 0,
        key: false,
      });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(onFailure).toHaveBeenCalled();
    expect(stored()).toStrictEqual(["r:f:c1"]);

    down = false;
    act(() => {
      result.current[1]({ type: "advance", at: 3000 });
      gradeOk(result.current[1], 4000);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(
      delivered.map((body) =>
        (JSON.parse(body) as { answers: AnswerInput[] }).answers.map((a) => a.id),
      ),
    ).toStrictEqual([["r:f:c1"], ["r:f:c2"]]);
    expect(result.current[0].answers.map((a) => a.id)).toStrictEqual([
      "r:f:c1",
      "r:f:c2",
    ]);
    expect(sessionStorage.getItem("drill-answers:r")).toBeNull();
  });

  it("sends what an earlier page of the tab left unsent as soon as it mounts", async () => {
    sessionStorage.setItem("drill-answers:r", JSON.stringify([answer("c1")]));
    const posted: string[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      posted.push(init.body as string);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const { result } = renderHook(() => {
      const arrived = useAnswerQueue(ROUND_R);
      useQueuedDrill(arrived.queue, fresh, vi.fn());
      return arrived;
    });
    expect(result.current.unsaved).toStrictEqual([answer("c1")]);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(
      posted.map((body) =>
        (JSON.parse(body) as { answers: AnswerInput[] }).answers.map((a) => a.id),
      ),
    ).toStrictEqual([["r:f:c1"]]);
    expect(sessionStorage.getItem("drill-answers:r")).toBeNull();
  });
});

describe("useAnswerQueue on arrival at a new round", () => {
  it("sends what an abandoned round left queued, apart from the new round's queue", async () => {
    sessionStorage.setItem("drill-answers:r", JSON.stringify([answer("c1")]));
    const posted: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      posted.push(url);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const { result } = renderHook(() =>
      useAnswerQueue({ id: "next", deck: ["c1"], answered: [] }),
    );
    expect(result.current.unsaved).toStrictEqual([]);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("/v1/rounds/r/answers");
    expect(sessionStorage.getItem("drill-answers:r")).toBeNull();
  });

  it("clears a finished round's leftover once the server refuses it", async () => {
    sessionStorage.setItem("drill-answers:r", JSON.stringify([answer("c1")]));
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { error: { code: "ERR_ROUND_CLOSED", message: "closed" } },
          { status: 409 },
        ),
      ),
    );
    renderHook(() => useAnswerQueue({ id: "next", deck: ["c1"], answered: [] }));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(sessionStorage.getItem("drill-answers:r")).toBeNull();
  });
});

describe("useRoundFinish", () => {
  it("waits for the last answer in flight before consulting its deadline", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    let resolve: (outcome: { status: "failed"; retryAt: number }) => void = () =>
      undefined;
    const sending = new Promise<{ status: "failed"; retryAt: number }>((done) => {
      resolve = done;
    });
    const queue = createAnswerQueue({ key: "test", send: () => sending });
    const queued = queue.enqueue(answer("c1"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useRoundFinish({ roundId: "r", finishing: true, queue, onDone: vi.fn() }),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.status).toBe("sending");
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      resolve({ status: "failed", retryAt: 20_000 });
      await queued;
    });
    expect(result.current.status).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
    expect(queue.pending()).toStrictEqual([answer("c1")]);
  });
  it("stores finish retry hints and waits for the queue deadline on manual retry", async () => {
    let now = 10_000;
    const queue = createAnswerQueue({
      key: "test",
      send: () => Promise.resolve("failed"),
    });
    await queue.enqueue(answer("c1"));
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response("down", { status: 429, headers: { "Retry-After": "10" } }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useRoundFinish({
        roundId: "r",
        finishing: true,
        queue,
        onDone: vi.fn(),
      }),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(queue.retryAt()).toBe(20_000);
    act(() => result.current.retry());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(fetch).toHaveBeenCalledOnce();
    now = 20_000;
    act(() => result.current.retry());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("asks for the summary once finishing, and retries on demand after a failure", async () => {
    let calls = 0;
    const urls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls += 1;
      urls.push(url);
      return Promise.resolve(
        calls === 1
          ? new Response("down", { status: 503 })
          : new Response(JSON.stringify({ roundId: "r" }), { status: 200 }),
      );
    });
    const onDone = vi.fn();
    const queue = createAnswerQueue({
      key: "test",
      send: () => Promise.resolve("failed"),
    });
    await queue.enqueue(answer("c1"));
    const { result, rerender } = renderHook(
      ({ finishing }: { finishing: boolean }) =>
        useRoundFinish({
          roundId: "r",
          finishing,
          queue,
          onDone,
        }),
      { initialProps: { finishing: false } },
    );
    expect(result.current.status).toBe("idle");

    rerender({ finishing: true });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.status).toBe("failed");

    act(() => result.current.retry());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current).toMatchObject({ status: "done", summary: { roundId: "r" } });
    expect(onDone).toHaveBeenCalledOnce();
    expect(urls).toStrictEqual(["/api/v1/rounds/r/finish", "/api/v1/rounds/r/finish"]);
  });
});
