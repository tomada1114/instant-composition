import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
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

function fresh(): DrillState {
  return initDrill({
    roundId: "r",
    deck: ["c1", "c2"],
    limits: { c1: LIMIT, c2: LIMIT },
    paces: { c1: LIMIT, c2: LIMIT },
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
    result: "ok",
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
  it("holds a fast ○ longest, a ○ shorter, and × shortest, all within 320 ms", () => {
    expect(feedbackMs({ result: "ok", fast: true })).toBe(320);
    expect(feedbackMs({ result: "ok", fast: false })).toBe(240);
    expect(feedbackMs({ result: "ng", fast: false })).toBe(160);
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
    act(() =>
      result.current.dispatch({
        type: "flip",
        at: performance.now(),
        wall: Date.now(),
      }),
    );
    act(() =>
      result.current.dispatch({
        type: "grade",
        result: "ng",
        at: performance.now(),
        wall: Date.now(),
        key: false,
      }),
    );
    expect(result.current.state.phase.kind).toBe("feedback");
    act(() => void vi.advanceTimersByTime(160));
    expect(result.current.state.index).toBe(1);

    act(() => void vi.advanceTimersToNextFrame());
    act(() => void vi.advanceTimersByTime(LIMIT + 100));
    expect(result.current.state.phase).toMatchObject({ kind: "back", mode: "timeout" });
  });
});

describe("useDrillKeys", () => {
  it("hands a mapped key to the handler and stops its default", () => {
    const onAction = vi.fn();
    renderHook(() => useDrillKeys(fresh(), onAction));
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
    renderHook(() => useDrillKeys(fresh(), onAction));
    window.dispatchEvent(new KeyboardEvent("keydown", init));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("pauses when the page is hidden, and does nothing when it shows again", () => {
    const onAction = vi.fn();
    renderHook(() => useDrillKeys(fresh(), onAction));
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
    dispatch({ type: "flip", at: at + 1000, wall: Date.now() });
    dispatch({
      type: "grade",
      result: "ok",
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
      result.current[1]({ type: "grade", result: "ng", at: 2100, wall: 0, key: false });
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

describe("useRoundFinish", () => {
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
    const { result, rerender } = renderHook(
      ({ finishing }: { finishing: boolean }) =>
        useRoundFinish({ roundId: "r", finishing, answers: [answer("c1")], onDone }),
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
