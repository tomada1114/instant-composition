import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnswerInput } from "../src/core/api";
import { drillReducer } from "../src/core/drill-machine";
import { initDrill, type DrillState } from "../src/core/drill-state";
import {
  feedbackMs,
  useAnswerSync,
  useDrillClock,
  useDrillKeys,
  useRoundFinish,
} from "../src/components/drill/use-drill";

const LIMIT = 7000;

function fresh(): DrillState {
  return initDrill({
    roundId: "r",
    deck: ["c1", "c2"],
    limits: { c1: LIMIT, c2: LIMIT },
    answered: [],
    retries: true,
    intro: false,
  });
}

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

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});

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
    act(() => result.current.dispatch({ type: "flip", at: performance.now() }));
    act(() =>
      result.current.dispatch({
        type: "grade",
        result: "ng",
        at: performance.now(),
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

describe("useAnswerSync", () => {
  it("sends each new answer once, and reports a failed save", async () => {
    const posted: string[] = [];
    vi.stubGlobal("fetch", (_: string, init: RequestInit) => {
      posted.push(init.body as string);
      return Promise.resolve(
        new Response(null, { status: posted.length === 1 ? 503 : 204 }),
      );
    });
    const onFailure = vi.fn();
    const { rerender } = renderHook(
      ({ answers }: { answers: readonly AnswerInput[] }) =>
        useAnswerSync("r", answers, onFailure),
      { initialProps: { answers: [answer("c1")] } },
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(JSON.parse(sessionStorage.getItem("drill-answers:r") ?? "[]")).toHaveLength(
      1,
    );

    rerender({ answers: [answer("c1"), answer("c2")] });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(
      posted.map((body) => (JSON.parse(body) as AnswerInput).cardId),
    ).toStrictEqual(["c1", "c1", "c2"]);
    expect(sessionStorage.getItem("drill-answers:r")).toBeNull();
  });
});

describe("useRoundFinish", () => {
  it("asks for the summary once finishing, and retries on demand after a failure", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
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
  });
});
