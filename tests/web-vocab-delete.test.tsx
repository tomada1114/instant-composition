import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginVisit,
  createPagedOutbox,
  initStudy,
  useVocabDelete,
  createQueryClient,
  QueryClientProvider,
  type StudyState,
} from "@instant-composition/web";
import { outboxAnswer, outboxLocks, outboxStorage } from "./paged-outbox-harness";
import { fakeApi, fakeTimers, settle, warmUp } from "./web-harness";

beforeAll(warmUp);
beforeEach(fakeTimers);

describe("deletion admission after durable answer drain", () => {
  it.each(["false", "deferred", "throw"] as const)(
    "retains grades and permits retry after flush %s, then acknowledges before DELETE",
    async (failure) => {
      beginVisit();
      let now = 1_000,
        available = false;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const order: string[] = [];
      const saved = outboxStorage();
      const actual = createPagedOutbox({
        key: "vocab-outbox:s",
        storage: saved,
        locks: outboxLocks(),
        send: () => {
          if (!available) return Promise.resolve("failed" as const);
          order.push("answers acknowledged");
          return Promise.resolve("sent" as const);
        },
      });
      expect(await actual.append(outboxAnswer(0))).toBe(true);
      if (failure === "deferred") await actual.deferUntil(2_000);
      const grade = saved.values.get("vocab-outbox:s:page:0");
      const flush = vi.fn(() => actual.flush());
      if (failure === "throw")
        flush.mockRejectedValueOnce(new Error("fixture drain failed"));
      const removeCard = vi.fn(async (id: string) => {
        order.push("remove marker");
        return actual.removeCard(id);
      });
      const queue = { ...actual, flush, removeCard };
      const calls = fakeApi((call) => {
        if (call.method !== "DELETE") return undefined;
        order.push("DELETE");
        return new Response(null, { status: 204 });
      });
      const state: StudyState = {
        ...initStudy({
          sessionId: "s",
          deck: ["v_0"],
          isNew: {},
          answered: [],
          retries: true,
          intro: false,
        }),
        phase: { kind: "back", mode: "self", elapsedMs: 1, since: 0 },
      };
      const dispatch = vi.fn(),
        close = vi.fn(),
        client = createQueryClient();
      const { result } = renderHook(
        () => useVocabDelete(state, dispatch, queue, close),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
          ),
        },
      );
      act(() => {
        result.current.ask();
      });
      act(() => {
        result.current.confirm();
      });
      await settle();
      expect(result.current).toMatchObject({
        asking: true,
        pending: false,
        failures: 1,
      });
      expect(saved.values.get("vocab-outbox:s:page:0")).toBe(grade);
      expect(actual.count()).toBe(1);
      expect(calls).toStrictEqual([]);
      expect(removeCard).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      available = true;
      now = 2_000;
      act(() => {
        result.current.confirm();
      });
      await settle();
      expect(order).toStrictEqual(["answers acknowledged", "DELETE", "remove marker"]);
      expect(calls).toMatchObject([
        { method: "DELETE", url: "/api/v1/vocab/cards/v_0" },
      ]);
      expect(result.current).toMatchObject({ asking: false, pending: false });
      expect(actual.count()).toBe(0);
      expect(dispatch).toHaveBeenCalledWith({ type: "remove", cardId: "v_0" });
      expect(close).toHaveBeenCalledTimes(1);
    },
  );
});
